// Isolated tests for the pronunciation fallback logic in app.js.
// Run with: node tests/audio.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8')
    .replace(/^import .*;\s*$/m, '');

let passed = 0;
function check(name, fn) {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
}

function makeEnv({ voices, speakThrows = false, silent = false } = {}) {
    const audioInstances = [];
    const alerts = [];
    const timers = [];
    const synthCalls = { cancel: 0, speak: [], utterances: [] };

    class MockAudio {
        constructor(url) {
            this.src = url;
            this.playCount = 0;
            this.onended = null;
            this.onerror = null;
            audioInstances.push(this);
        }
        play() {
            this.playCount++;
            return this.failPlay ? Promise.reject(new Error('blocked')) : Promise.resolve();
        }
        pause() {}
    }

    const window = {
        addEventListener() {},
        speechSynthesis: {
            getVoices: () => voices || [],
            cancel: () => { synthCalls.cancel++; },
            speak: (u) => {
                synthCalls.speak.push(u);
                synthCalls.utterances.push(u);
                if (speakThrows) throw new Error('speak blocked');
                if (!silent && u.onstart) u.onstart();
            },
        },
        SpeechSynthesisUtterance: class {
            constructor(text) { this.text = text; }
        },
    };

    const context = {
        window,
        Audio: MockAudio,
        alert: (m) => alerts.push(m),
        console,
        loadSettings: () => ({}),
        setTimeout: (fn, ms) => {
            const id = timers.length + 1;
            timers.push({ id, fn, ms, cancelled: false });
            return id;
        },
        clearTimeout: (id) => {
            const timer = timers.find(t => t.id === id);
            if (timer) timer.cancelled = true;
        },
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(source + '\nglobalThis.__App = App;', context);

    const app = new context.__App();
    return { app, audioInstances, alerts, timers, synthCalls, window };
}

console.log('Audio pronunciation fallback tests');

check('1. speechSynthesis missing -> online TTS audio, no alert', () => {
    const e = makeEnv();
    delete e.window.speechSynthesis;
    delete e.window.SpeechSynthesisUtterance;
    e.app.speak('hola', 'es');
    assert.equal(e.alerts.length, 0);
    assert.equal(e.audioInstances.length, 1);
    assert.match(e.audioInstances[0].src, /translate\.google\.com\/translate_tts/);
    assert.match(e.audioInstances[0].src, /tl=es/);
    assert.match(e.audioInstances[0].src, /q=hola/);
    assert.equal(e.audioInstances[0].playCount, 1);
});

check('2. speechSynthesis works -> no audio fallback', () => {
    const e = makeEnv({ voices: [{ lang: 'es-ES' }] });
    e.app.speak('hola', 'es');
    assert.equal(e.synthCalls.speak.length, 1);
    assert.equal(e.synthCalls.utterances[0].text, 'hola');
    assert.equal(e.audioInstances.length, 0);
    assert.equal(e.alerts.length, 0);
});

check('3. utterance.onerror -> graceful audio fallback', () => {
    const e = makeEnv({ voices: [{ lang: 'uk-UA' }] });
    e.app.speak('привіт', 'uk');
    assert.equal(e.audioInstances.length, 0);
    e.synthCalls.utterances[0].onerror();
    assert.equal(e.audioInstances.length, 1);
    assert.match(e.audioInstances[0].src, /tl=uk/);
    assert.match(e.audioInstances[0].src, /q=%D0%BF%D1%80%D0%B8%D0%B2%D1%96%D1%82/);
    assert.equal(e.alerts.length, 0);
});

check('4. voices empty -> immediate audio fallback', () => {
    const e = makeEnv({ voices: [] });
    e.app.speak('adios', 'es');
    assert.equal(e.synthCalls.speak.length, 0);
    assert.equal(e.audioInstances.length, 1);
    assert.equal(e.alerts.length, 0);
});

check('5. synth.speak() throws -> immediate audio fallback', () => {
    const e = makeEnv({ voices: [{ lang: 'es-ES' }], speakThrows: true });
    e.app.speak('gracias', 'es');
    assert.equal(e.audioInstances.length, 1);
    assert.equal(e.alerts.length, 0);
});

check('6. silent WebView (no onstart) -> watchdog falls back', () => {
    const e = makeEnv({ voices: [{ lang: 'es-ES' }], silent: true });
    e.app.speak('silencio', 'es');
    assert.equal(e.audioInstances.length, 0);
    const watchdog = e.timers.find(t => t.ms === 1500 && !t.cancelled);
    assert.ok(watchdog, 'watchdog scheduled');
    watchdog.fn();
    assert.equal(e.audioInstances.length, 1);
    assert.equal(e.alerts.length, 0);
});

check('7. onstart cancels watchdog -> no fallback', () => {
    const e = makeEnv({ voices: [{ lang: 'es-ES' }], silent: true });
    e.app.speak('bien', 'es');
    e.synthCalls.utterances[0].onstart();
    assert.equal(e.timers.find(t => t.ms === 1500).cancelled, true);
    assert.equal(e.audioInstances.length, 0);
});

check('8. long text split into chunks, played sequentially', () => {
    const e = makeEnv();
    delete e.window.speechSynthesis;
    delete e.window.SpeechSynthesisUtterance;
    const long = Array.from({ length: 30 }, (_, i) => `palabra${i}`).join(' ');
    const chunks = e.app.chunkText(long, 180);
    assert.ok(chunks.length >= 2, 'text split into multiple chunks');
    e.app.speak(long, 'es');
    for (let i = 0; i < chunks.length; i++) {
        assert.ok(e.audioInstances[i], `chunk ${i} played`);
        const q = decodeURIComponent(new URL(e.audioInstances[i].src).searchParams.get('q'));
        assert.equal(q, chunks[i]);
        assert.ok(q.length <= 180);
        assert.equal(e.audioInstances[i].playCount, 1);
        e.audioInstances[i].onended();
    }
    assert.equal(e.audioInstances.length, chunks.length);
});

check('9. all audio chunks fail -> single alert, no duplicates', () => {
    const e = makeEnv();
    delete e.window.speechSynthesis;
    delete e.window.SpeechSynthesisUtterance;
    e.app.speak('fallo', 'es');
    e.audioInstances[0].failPlay = true;
    e.audioInstances[0].onerror();
    assert.equal(e.alerts.length, 1);
    e.app.speak('otro fallo', 'es');
    e.audioInstances[1].failPlay = true;
    e.audioInstances[1].onerror();
    assert.equal(e.alerts.length, 1, 'warning shown only once');
});

check('10. rapid re-speak invalidates stale callbacks', () => {
    const e = makeEnv({ voices: [{ lang: 'es-ES' }], silent: true });
    e.app.speak('primero', 'es');
    const stale = e.synthCalls.utterances[0];
    e.app.speak('segundo', 'es');
    stale.onerror();
    e.timers.filter(t => t.ms === 1500 && !t.cancelled).forEach(t => t.fn());
    assert.equal(e.audioInstances.length, 1, 'only the newest utterance falls back');
    assert.equal(e.synthCalls.cancel >= 2, true);
});

check('11. locale, rate and matching voice are applied', () => {
    const voices = [{ lang: 'es-ES', name: 'Monica' }, { lang: 'uk-UA', name: 'Ukr' }];
    const es = makeEnv({ voices });
    es.app.speak('hola', 'es');
    const u = es.synthCalls.utterances[0];
    assert.equal(u.lang, 'es-ES');
    assert.equal(u.rate, 0.9);
    assert.equal(u.voice.name, 'Monica');

    const uk = makeEnv({ voices });
    uk.app.speak('привіт', 'uk');
    const v = uk.synthCalls.utterances[0];
    assert.equal(v.lang, 'uk-UA');
    assert.equal(v.rate, 1);
    assert.equal(v.voice.name, 'Ukr');
});

console.log(`\n${passed}/11 checks passed`);
