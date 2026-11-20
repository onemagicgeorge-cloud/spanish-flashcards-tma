import { loadDefaultCards, parseCSV, loadUserData, saveUserData, loadSettings, saveSettings } from './storage.js';

// Bump whenever the default deck is replaced: old custom cards and SRS state
// must not survive a deck change (ids are reused by the new deck).
const DECK_VERSION = 'laropa-59-20261120';
const DECK_VERSION_KEY = '_deckVersion';

class App {
    constructor() {
        this.cards = [];
        this.defaultCardKeys = new Set();
        this.progress = {}; // cardId -> { status, interval, easeFactor, reps, dueDate }
        this.settings = loadSettings();
        this.currentQueue = [];
        this.currentIndex = 0;
        this.isFlipped = false;
        this.activeTopic = null;
        this.studyMode = 'due'; // 'due' or 'all'
        this.shuffleEnabled = this.settings.shuffle;
        this.cardDirections = new Map(); // cardId -> 'es-uk' | 'uk-es' (random mode)
        this.audioWarningShown = false;
        this.currentAudio = null; // <audio> used by the online TTS fallback
        this.speechWatchdog = null; // timer that detects silent speechSynthesis failures
        this.speakGeneration = 0; // invalidates callbacks from superseded playbacks
        this.cachedVoices = []; // getVoices() is populated asynchronously in many WebViews
        this.voicesListenerAttached = false;
        this.activeSpeech = null; // state of the current Web Speech attempt
    }

    async init() {
        // Init Telegram WebApp
        if (window.Telegram && window.Telegram.WebApp) {
            window.Telegram.WebApp.ready();
            window.Telegram.WebApp.expand();
        }

        // Voice lists arrive asynchronously. Start listening on page load so the
        // voices are already cached by the time the user taps a speaker button.
        this.ensureVoiceListener();

        // Load default CSV cards
        const defaultCards = await loadDefaultCards();
        
        // Load user progress
        const savedProgress = await loadUserData();
        const savedDeckVersion = savedProgress[DECK_VERSION_KEY];
        delete savedProgress[DECK_VERSION_KEY];
        const deckChanged = savedDeckVersion !== DECK_VERSION;
        if (deckChanged) {
            // Old decks and their progress are no longer valid for this deck.
            for (const key of Object.keys(savedProgress)) delete savedProgress[key];
        }

        // Merge cards (default + custom imported saved in progress or extra storage)
        const customCards = deckChanged ? [] : (savedProgress._customCards || []);
        this.cards = [...defaultCards, ...customCards];
        this.defaultCardKeys = new Set(defaultCards.map(card => `${card.id}\u0000${card.es}\u0000${card.uk}`));

        // Remove meta keys from progress map if any
        delete savedProgress._customCards;
        this.progress = savedProgress;

        // Initialize progress for new cards
        const now = Date.now();
        let updated = deckChanged;
        this.cards.forEach(card => {
            if (!this.progress[card.id]) {
                this.progress[card.id] = {
                    status: 'new', // new, learning, review, ignored
                    interval: 0,
                    easeFactor: 2.5,
                    reps: 0,
                    dueDate: now
                };
                updated = true;
            }
        });

        if (updated) {
            await this.save();
        }

        this.initUI();
        this.renderDashboard();
    }

    async save() {
        const payload = { ...this.progress };
        // Persist the deck version so a future replacement can reset stale data.
        payload[DECK_VERSION_KEY] = DECK_VERSION;
        // Store only genuinely imported cards; default cards always come from the CSV.
        payload._customCards = this.cards.filter(
            card => !this.defaultCardKeys.has(`${card.id}\u0000${card.es}\u0000${card.uk}`)
        );
        await saveUserData(payload);
    }

    initUI() {
        // Navigation / Views
        document.getElementById('btn-start-due').addEventListener('click', () => this.startStudy('due', null));
        document.getElementById('btn-start-all').addEventListener('click', () => this.startStudy('all', null));
        document.getElementById('btn-back-dashboard').addEventListener('click', () => this.showView('view-dashboard'));

        // Flashcard flip & actions
        const flashcard = document.getElementById('flashcard');
        flashcard.addEventListener('click', () => this.flipCard());

        document.getElementById('btn-shuffle').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleShuffle();
        });

        document.querySelectorAll('.btn-speak').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // do not flip the card when using the speaker
                this.speakCardSide(btn.dataset.side);
            });
        });

        document.getElementById('btn-show-answer').addEventListener('click', (e) => {
            e.stopPropagation();
            this.flipCard();
        });

        // Rating buttons
        document.querySelectorAll('.btn-rate').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const rating = btn.getAttribute('data-rating');
                this.answerCard(rating);
            });
        });

        document.getElementById('btn-ignore-card').addEventListener('click', (e) => {
            e.stopPropagation();
            this.ignoreCurrentCard();
        });

        // Modals
        document.getElementById('btn-import').addEventListener('click', () => {
            document.getElementById('modal-import').classList.remove('hidden');
        });
        document.getElementById('btn-cancel-import').addEventListener('click', () => {
            document.getElementById('modal-import').classList.add('hidden');
        });
        document.getElementById('btn-confirm-import').addEventListener('click', () => this.handleImport());

        document.getElementById('btn-settings').addEventListener('click', () => {
            this.renderSettingsModal();
            document.getElementById('modal-settings').classList.remove('hidden');
        });
        document.getElementById('btn-close-settings').addEventListener('click', () => {
            document.getElementById('modal-settings').classList.add('hidden');
        });

        // Settings: study direction and pronunciation voice
        const dirSelect = document.getElementById('select-direction');
        dirSelect.value = this.settings.direction;
        dirSelect.addEventListener('change', (e) => {
            this.settings = saveSettings({ ...this.settings, direction: e.target.value });
            this.cardDirections.clear();
            this.refreshCardIfStudying();
        });

        const voiceSelect = document.getElementById('select-voice');
        voiceSelect.value = this.settings.audioVoice;
        voiceSelect.addEventListener('change', (e) => {
            this.settings = saveSettings({ ...this.settings, audioVoice: e.target.value });
            this.updateSpeakButtons();
        });

        // CSV File reader
        document.getElementById('csv-file-input').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (event) => {
                document.getElementById('csv-text-input').value = event.target.result;
            };
            reader.readAsText(file);
        });
    }

    showView(viewId) {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(viewId).classList.add('active');
        if (viewId === 'view-dashboard') {
            this.renderDashboard();
        }
    }

    renderDashboard() {
        const now = Date.now();
        let total = 0;
        let learned = 0;
        let due = 0;

        const topicMap = {};

        this.cards.forEach(card => {
            const p = this.progress[card.id];
            if (!p || p.status === 'ignored') return;

            total++;
            if (p.status === 'review' || p.reps >= 3) learned++;
            if (p.dueDate <= now || p.status === 'new') due++;

            if (!topicMap[card.topic]) {
                topicMap[card.topic] = { total: 0, learned: 0, due: 0 };
            }
            topicMap[card.topic].total++;
            if (p.status === 'review' || p.reps >= 3) topicMap[card.topic].learned++;
            if (p.dueDate <= now || p.status === 'new') topicMap[card.topic].due++;
        });

        // Overall stats
        const percent = total > 0 ? Math.round((learned / total) * 100) : 0;
        document.getElementById('overall-progress-bar').style.width = percent + '%';
        document.getElementById('stat-learned').textContent = learned;
        document.getElementById('stat-due').textContent = due;
        document.getElementById('stat-total').textContent = total;
        document.getElementById('count-due-btn').textContent = due;

        // Topics list
        const topicsListEl = document.getElementById('topics-list');
        topicsListEl.innerHTML = '';

        Object.keys(topicMap).forEach(topic => {
            const tData = topicMap[topic];
            const tPercent = tData.total > 0 ? Math.round((tData.learned / tData.total) * 100) : 0;

            const item = document.createElement('div');
            item.className = 'topic-item';
            item.innerHTML = `
                <div class="topic-info">
                    <span class="topic-name">${topic}</span>
                    <span class="topic-stats">Вивчено: ${tData.learned}/${tData.total} (${tPercent}%) • До повторення: ${tData.due}</span>
                </div>
                <div class="topic-badge">${tData.due} готові</div>
            `;
            item.addEventListener('click', () => {
                this.startStudy('due', topic);
            });
            topicsListEl.appendChild(item);
        });
    }

    startStudy(mode, topic) {
        this.studyMode = mode;
        this.activeTopic = topic;
        this.cardDirections.clear();
        const now = Date.now();

        this.currentQueue = this.cards.filter(card => {
            const p = this.progress[card.id];
            if (!p || p.status === 'ignored') return false;
            if (topic && card.topic !== topic) return false;

            if (mode === 'due') {
                return p.dueDate <= now || p.status === 'new';
            }
            return true; // 'all'
        });

        // Cards stay in their original order unless the shuffle toggle is on
        if (this.shuffleEnabled) {
            this.shuffleArray(this.currentQueue);
        }

        if (this.currentQueue.length === 0) {
            alert(mode === 'due' ? 'На сьогодні немає карток для повторення у цій темі!' : 'У цій темі немає карток.');
            return;
        }

        this.currentIndex = 0;
        this.showView('view-study');
        this.renderShuffleButton();
        this.loadCurrentCard();
    }

    loadCurrentCard() {
        if (this.currentIndex >= this.currentQueue.length) {
            alert('Сесію завершено! Чудова робота 🎉');
            this.showView('view-dashboard');
            return;
        }

        this.isFlipped = false;
        document.getElementById('flashcard-inner').classList.remove('flipped');
        document.getElementById('actions-front').classList.remove('hidden');
        document.getElementById('actions-back').classList.add('hidden');

        const card = this.currentQueue[this.currentIndex];
        const direction = this.getCardDirection(card);
        const isUkEs = direction === 'uk-es';
        const directionLabel = isUkEs ? 'UA → ES' : 'ES → UK';

        document.getElementById('study-topic').textContent = card.topic;
        document.getElementById('study-topic-back').textContent = card.topic;
        document.getElementById('study-direction-front').textContent = directionLabel;
        document.getElementById('study-direction-back').textContent = directionLabel;

        document.getElementById('study-question').textContent = isUkEs ? card.uk : card.es;
        document.getElementById('study-answer').textContent = isUkEs ? card.es : card.uk;
        document.getElementById('study-example').textContent = card.example ? `Приклад: ${card.example}` : '';
        document.getElementById('speak-question').dataset.lang = isUkEs ? 'uk' : 'es';
        document.getElementById('speak-answer').dataset.lang = isUkEs ? 'es' : 'uk';
        this.updateSpeakButtons();

        document.getElementById('study-progress-indicator').textContent = `Картка ${this.currentIndex + 1} / ${this.currentQueue.length}`;

        // Calculate intervals preview
        const p = this.progress[card.id] || { interval: 0, easeFactor: 2.5, reps: 0 };
        document.getElementById('hint-hard').textContent = this.formatInterval(1);
        document.getElementById('hint-good').textContent = this.formatInterval(Math.max(1, Math.round((p.interval || 1) * p.easeFactor)));
        document.getElementById('hint-easy').textContent = this.formatInterval(Math.max(2, Math.round((p.interval || 1) * p.easeFactor * 1.3)));
    }

    // --- Shuffle & direction helpers ---

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    toggleShuffle() {
        this.shuffleEnabled = !this.shuffleEnabled;
        this.settings = saveSettings({ ...this.settings, shuffle: this.shuffleEnabled });
        this.renderShuffleButton();

        // Shuffle only cards that have not been studied yet in this session.
        const upcomingStart = this.currentIndex + 1;
        if (this.shuffleEnabled && upcomingStart < this.currentQueue.length - 1) {
            const upcoming = this.shuffleArray(this.currentQueue.slice(upcomingStart));
            this.currentQueue = [
                ...this.currentQueue.slice(0, upcomingStart),
                ...upcoming
            ];
        }
    }

    renderShuffleButton() {
        const btn = document.getElementById('btn-shuffle');
        btn.setAttribute('aria-pressed', String(this.shuffleEnabled));
        btn.title = this.shuffleEnabled ? 'Перемішування увімкнено' : 'Перемішати картки';
    }

    getCardDirection(card) {
        if (this.settings.direction !== 'random') {
            return this.settings.direction;
        }
        // Keep the same direction for a card even if it returns via "Знову".
        if (!this.cardDirections.has(card.id)) {
            this.cardDirections.set(card.id, Math.random() < 0.5 ? 'es-uk' : 'uk-es');
        }
        return this.cardDirections.get(card.id);
    }

    refreshCardIfStudying() {
        const studyView = document.getElementById('view-study');
        if (studyView.classList.contains('active') && this.currentQueue.length > 0) {
            this.loadCurrentCard();
        }
    }

    // --- SpeechSynthesis helpers ---

    updateSpeakButtons() {
        const voice = this.settings.audioVoice;
        document.querySelectorAll('.btn-speak').forEach(btn => {
            const lang = btn.dataset.lang || 'es';
            const enabled = voice !== 'off' && (voice === 'both' || voice === lang);
            btn.classList.toggle('hidden', !enabled);
            const langName = lang === 'es' ? 'іспанською' : 'українською';
            btn.title = `Вимовити ${langName}`;
            btn.setAttribute('aria-label', btn.title);
            btn.querySelector('.speak-lang').textContent = lang === 'es' ? 'ES' : 'UK';
        });
    }

    speakCardSide(side) {
        const btn = document.getElementById(side === 'question' ? 'speak-question' : 'speak-answer');
        const textEl = document.getElementById(side === 'question' ? 'study-question' : 'study-answer');
        if (!btn || !textEl || btn.classList.contains('hidden')) return;

        if (window.Telegram?.WebApp?.HapticFeedback?.impactOccurred) {
            window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
        }
        this.speak(textEl.textContent.trim(), btn.dataset.lang);
    }

    canUseSpeechSynthesis() {
        return typeof window !== 'undefined'
            && 'speechSynthesis' in window
            && typeof window.SpeechSynthesisUtterance === 'function'
            && !!window.speechSynthesis
            && typeof window.speechSynthesis.speak === 'function';
    }

    // getVoices() is empty until the WebView finishes loading its voice list and
    // fires "voiceschanged". Listening (and caching) avoids the old bug where an
    // initially empty list was mistaken for an unsupported engine.
    ensureVoiceListener() {
        if (!this.canUseSpeechSynthesis() || this.voicesListenerAttached) return;
        this.voicesListenerAttached = true;
        const synth = window.speechSynthesis;

        const refresh = () => {
            this.cachedVoices = typeof synth.getVoices === 'function' ? (synth.getVoices() || []) : [];
            if (!this.cachedVoices.length) return;

            const active = this.activeSpeech;
            if (!active || active.started || active.didFallback || active.hadVoices) return;
            if (active.generation !== this.speakGeneration) return;

            // Voices just became available for an utterance that was started
            // without any. Retry once with a real voice instead of waiting for
            // the watchdog and going to the network unnecessarily.
            if (active.utterance) {
                active.utterance.onstart = null;
                active.utterance.onend = null;
                active.utterance.onerror = null;
            }
            try { synth.cancel(); } catch (e) { /* ignore */ }
            this.clearSpeechWatchdog();
            active.hadVoices = true;
            this.startSpeechSynthesis(active.text, active.lang, active.generation, true);
        };

        try {
            if (typeof synth.addEventListener === 'function') {
                synth.addEventListener('voiceschanged', refresh);
            } else if ('onvoiceschanged' in synth) {
                const previous = synth.onvoiceschanged;
                synth.onvoiceschanged = (event) => {
                    if (typeof previous === 'function') previous.call(synth, event);
                    refresh();
                };
            }
        } catch (e) { /* ignore */ }

        // Some WebViews pause speech while the Mini App is in the background.
        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
            document.addEventListener('visibilitychange', () => {
                if (typeof document.hidden !== 'undefined' && document.hidden) return;
                if (!this.canUseSpeechSynthesis()) return;
                try {
                    if (window.speechSynthesis.paused && typeof window.speechSynthesis.resume === 'function') {
                        window.speechSynthesis.resume();
                    }
                } catch (e) { /* ignore */ }
            });
        }
    }

    getVoices() {
        if (this.cachedVoices && this.cachedVoices.length) return this.cachedVoices;
        this.cachedVoices = this.canUseSpeechSynthesis() && typeof window.speechSynthesis.getVoices === 'function'
            ? (window.speechSynthesis.getVoices() || [])
            : [];
        return this.cachedVoices;
    }

    clearSpeechWatchdog() {
        if (this.speechWatchdog) {
            clearTimeout(this.speechWatchdog);
            this.speechWatchdog = null;
        }
    }

    speak(text, lang) {
        if (!text) return;

        // Stop anything already playing, then invalidate callbacks from it.
        this.stopAudio();
        const generation = this.speakGeneration;

        // Telegram WebView on some Android/iOS devices exposes speechSynthesis but
        // cannot actually synthesize. Use it when it works and gracefully fall back
        // to streamed audio on any failure. speak() is called synchronously from the
        // tap handler, which preserves the required user gesture; resume() explicitly
        // because some engines pause the speech queue between cards.
        if (this.canUseSpeechSynthesis()) {
            try {
                this.ensureVoiceListener();
                const synth = window.speechSynthesis;
                if (synth.paused && typeof synth.resume === 'function') {
                    try { synth.resume(); } catch (e) { /* ignore */ }
                }
                this.startSpeechSynthesis(text, lang, generation, false);
                return;
            } catch (e) {
                // Broken or stubbed speechSynthesis -> use the online TTS fallback.
            }
        }

        this.playAudioUrl(text, lang);
    }

    startSpeechSynthesis(text, lang, generation, hadVoices) {
        const synth = window.speechSynthesis;
        const voices = this.getVoices();
        const targetLang = lang === 'uk' ? 'uk-UA' : 'es-ES';
        const utterance = new window.SpeechSynthesisUtterance(text);
        utterance.lang = targetLang;
        utterance.rate = lang === 'es' ? 0.9 : 1;

        const voice = this.findVoice(targetLang, voices);
        if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
        }

        const state = {
            generation,
            text,
            lang,
            hadVoices: hadVoices || voices.length > 0,
            started: false,
            didFallback: false,
            utterance
        };
        this.activeSpeech = state;

        const fallback = () => {
            if (state.didFallback || generation !== this.speakGeneration) return;
            state.didFallback = true;
            this.clearSpeechWatchdog();
            if (this.activeSpeech === state) this.activeSpeech = null;
            try { synth.cancel(); } catch (e) { /* ignore */ }
            this.playAudioUrl(text, lang);
        };

        utterance.onstart = () => {
            if (generation !== this.speakGeneration || state.didFallback) return;
            state.started = true;
            this.clearSpeechWatchdog();
        };

        utterance.onend = () => {
            if (generation !== this.speakGeneration || state.didFallback) return;
            this.clearSpeechWatchdog();
            if (this.activeSpeech === state) this.activeSpeech = null;
            // A few WebViews fire only "end" and never actually produce sound.
            if (!state.started) fallback();
        };

        utterance.onerror = (event) => {
            if (generation !== this.speakGeneration || state.didFallback) return;
            const error = event && event.error;
            // Our own cancel() (re-voice, re-speak, fallback) reports these.
            if (error === 'canceled' || error === 'interrupted') return;
            fallback();
        };

        synth.speak(utterance);

        // Handle engines that fire events synchronously during speak().
        if (state.started || state.didFallback || generation !== this.speakGeneration) return;
        this.clearSpeechWatchdog();

        // Give a voice-less WebView extra time to load voices before giving up.
        const delay = state.hadVoices ? 1500 : 2500;
        this.speechWatchdog = setTimeout(() => {
            if (!state.started && !state.didFallback && generation === this.speakGeneration) {
                fallback();
            }
        }, delay);
    }

    findVoice(locale, voices) {
        const list = voices || this.getVoices() || [];
        const normalized = String(locale || '').toLowerCase().replace('_', '-');
        const prefix = normalized.split('-')[0];
        const langOf = (v) => String((v && v.lang) || '').toLowerCase().replace('_', '-');
        return list.find(v => langOf(v) === normalized)
            || list.find(v => langOf(v).startsWith(prefix))
            || null;
    }

    stopAudio() {
        this.speakGeneration++;
        this.clearSpeechWatchdog();
        this.activeSpeech = null;
        if (this.currentAudio) {
            const audio = this.currentAudio;
            this.currentAudio = null;
            try {
                audio.pause();
                audio.currentTime = 0;
            } catch (e) { /* ignore */ }
        }
        if (this.canUseSpeechSynthesis()) {
            try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
        }
    }

    // No API key needed. Several public mirrors are tried in order because the
    // Google Translate host is blocked/CORS-restricted in some Telegram WebViews.
    // A failed mirror is retried with the next one before moving to the next
    // chunk. Long texts are split to respect the ~200 char TTS limit.
    ttsUrls(text, lang) {
        const tl = lang === 'uk' ? 'uk' : 'es';
        const encoded = encodeURIComponent(text);
        const urls = [
            `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=${tl}&q=${encoded}`,
            `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${tl}&q=${encoded}`
        ];
        // Latin-script-only mirror, useful for Spanish when Google is unreachable.
        if (lang === 'es') {
            urls.push(`https://dict.youdao.com/dictvoice?audio=${encoded}&type=2`);
        }
        return urls;
    }

    playAudioUrl(text, lang) {
        if (!text) return;
        this.stopAudio();
        const generation = this.speakGeneration;
        const chunks = this.chunkText(text, 180);
        let index = 0;
        let failures = 0;

        const finish = () => {
            if (generation !== this.speakGeneration) return;
            this.currentAudio = null;
            if (failures === chunks.length) this.notifyAudioUnavailable();
        };

        const playChunk = (chunk, whenDone) => {
            const urls = this.ttsUrls(chunk, lang);
            let providerIndex = 0;

            const tryProvider = () => {
                if (generation !== this.speakGeneration) return;
                if (providerIndex >= urls.length) {
                    failures++;
                    whenDone();
                    return;
                }

                const url = urls[providerIndex++];
                let audio = null;
                let settled = false;
                let loadTimer = null;

                const clearLoadTimer = () => {
                    if (loadTimer) {
                        clearTimeout(loadTimer);
                        loadTimer = null;
                    }
                };

                const fail = () => {
                    if (settled || generation !== this.speakGeneration) return;
                    settled = true;
                    clearLoadTimer();
                    if (this.currentAudio === audio) this.currentAudio = null;
                    tryProvider(); // next mirror for the same chunk
                };

                const succeeded = () => {
                    if (settled || generation !== this.speakGeneration) return;
                    settled = true;
                    clearLoadTimer();
                    if (this.currentAudio === audio) this.currentAudio = null;
                    whenDone();
                };

                try {
                    audio = new Audio(url);
                } catch (e) {
                    fail();
                    return;
                }

                this.currentAudio = audio;
                audio.onended = succeeded;
                audio.onerror = fail;

                // Some WebViews neither resolve play() nor fire an error event.
                loadTimer = setTimeout(() => {
                    if (!settled && generation === this.speakGeneration) {
                        try { audio.pause(); } catch (e) { /* ignore */ }
                        fail();
                    }
                }, 8000);

                try {
                    const promise = audio.play();
                    if (promise && typeof promise.catch === 'function') promise.catch(fail);
                } catch (e) {
                    fail();
                }
            };

            tryProvider();
        };

        const playNext = () => {
            if (generation !== this.speakGeneration) return;
            if (index >= chunks.length) {
                finish();
                return;
            }
            playChunk(chunks[index++], playNext);
        };

        try {
            playNext();
        } catch (e) {
            this.notifyAudioUnavailable();
        }
    }

    chunkText(text, maxLength) {
        const value = String(text).trim();
        const chunks = [];
        let rest = value;
        while (rest.length > maxLength) {
            let cut = rest.lastIndexOf(' ', maxLength);
            if (cut <= 0) cut = maxLength;
            chunks.push(rest.slice(0, cut).trim());
            rest = rest.slice(cut).trim();
        }
        if (rest) chunks.push(rest);
        return chunks.length ? chunks : [value];
    }

    notifyAudioUnavailable() {
        if (this.audioWarningShown) return;
        this.audioWarningShown = true;
        const message = 'Не вдалося відтворити озвучення. Перевірте підключення до Інтернету.';
        if (window.Telegram?.WebApp?.showAlert) {
            window.Telegram.WebApp.showAlert(message);
        } else {
            alert(message);
        }
    }

        formatInterval(days) {
            if (days < 1) return '<1д';
            if (days === 1) return '1д';
            if (days < 30) return days + 'д';
            return Math.round(days / 30) + ' міс';
        }

    flipCard() {
        this.isFlipped = !this.isFlipped;
        const inner = document.getElementById('flashcard-inner');
        if (this.isFlipped) {
            inner.classList.add('flipped');
            document.getElementById('actions-front').classList.add('hidden');
            document.getElementById('actions-back').classList.remove('hidden');
        } else {
            inner.classList.remove('flipped');
            document.getElementById('actions-front').classList.remove('hidden');
            document.getElementById('actions-back').classList.add('hidden');
        }
    }

    async answerCard(rating) {
        const card = this.currentQueue[this.currentIndex];
        let p = this.progress[card.id];

        const now = Date.now();
        const DAY = 24 * 60 * 60 * 1000;

        if (!p) {
            p = { status: 'new', interval: 0, easeFactor: 2.5, reps: 0, dueDate: now };
        }

        switch (rating) {
            case 'again':
                p.reps = 0;
                p.interval = 0;
                p.easeFactor = Math.max(1.3, p.easeFactor - 0.2);
                p.dueDate = now + 60 * 1000; // repeat in 1 min
                p.status = 'learning';
                // Push back to queue for repetition in this session
                this.currentQueue.push(card);
                break;
            case 'hard':
                p.reps += 1;
                p.interval = 1;
                p.easeFactor = Math.max(1.3, p.easeFactor - 0.15);
                p.dueDate = now + 1 * DAY;
                p.status = 'review';
                break;
            case 'good':
                p.reps += 1;
                p.interval = p.interval === 0 ? 3 : Math.round(p.interval * p.easeFactor);
                p.dueDate = now + p.interval * DAY;
                p.status = 'review';
                break;
            case 'easy':
                p.reps += 1;
                p.easeFactor += 0.15;
                p.interval = p.interval === 0 ? 5 : Math.round(p.interval * p.easeFactor * 1.3);
                p.dueDate = now + p.interval * DAY;
                p.status = 'review';
                break;
        }

        this.progress[card.id] = p;
        await this.save();

        this.currentIndex++;
        this.loadCurrentCard();
    }

    async ignoreCurrentCard() {
        const card = this.currentQueue[this.currentIndex];
        if (!this.progress[card.id]) {
            this.progress[card.id] = {};
        }
        this.progress[card.id].status = 'ignored';
        await this.save();

        alert('Картку перенесено до прихованих.');
        this.currentIndex++;
        this.loadCurrentCard();
    }

    async handleImport() {
        const text = document.getElementById('csv-text-input').value.trim();
        if (!text) {
            alert('Будь ласка, введіть або завантажте CSV текст.');
            return;
        }

        const newCards = parseCSV(text);
        if (newCards.length === 0) {
            alert('Не вдалося розібрати CSV. Перевірте формат.');
            return;
        }

        let addedCount = 0;
        const now = Date.now();

        newCards.forEach(nc => {
            const exists = this.cards.some(c => c.id === nc.id || (c.es === nc.es && c.topic === nc.topic));
            if (!exists) {
                this.cards.push(nc);
                this.progress[nc.id] = {
                    status: 'new',
                    interval: 0,
                    easeFactor: 2.5,
                    reps: 0,
                    dueDate: now
                };
                addedCount++;
            }
        });

        await this.save();
        document.getElementById('modal-import').classList.add('hidden');
        document.getElementById('csv-text-input').value = '';
        document.getElementById('csv-file-input').value = '';

        alert(`Успішно імпортовано нових карток: ${addedCount}`);
        this.renderDashboard();
    }

    renderSettingsModal() {
        document.getElementById('select-direction').value = this.settings.direction;
        document.getElementById('select-voice').value = this.settings.audioVoice;

        const listEl = document.getElementById('ignored-list');
        listEl.innerHTML = '';

        const ignoredCards = this.cards.filter(c => {
            const p = this.progress[c.id];
            return p && p.status === 'ignored';
        });

        document.getElementById('ignored-count').textContent = ignoredCards.length;

        if (ignoredCards.length === 0) {
            listEl.innerHTML = '<div style="color:var(--hint-color); font-size:13px; text-align:center; padding:10px;">Немає прихованих карток</div>';
            return;
        }

        ignoredCards.forEach(card => {
            const item = document.createElement('div');
            item.className = 'ignored-item';
            item.innerHTML = `
                <span><b>${card.es}</b> — ${card.uk}</span>
                <button class="btn-icon" data-id="${card.id}">Відновити</button>
            `;
            item.querySelector('button').addEventListener('click', async () => {
                this.progress[card.id].status = 'new';
                this.progress[card.id].dueDate = Date.now();
                await this.save();
                this.renderSettingsModal();
                this.renderDashboard();
            });
            listEl.appendChild(item);
        });
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
});
