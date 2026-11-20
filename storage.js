// Storage & Data Management with Telegram CloudStorage and localStorage fallback
const STORAGE_KEY = 'es_flashcards_progress_v1';
const SETTINGS_KEY = 'es_flashcards_settings_v1';

export const DEFAULT_SETTINGS = Object.freeze({
    direction: 'es-uk', // 'es-uk' | 'uk-es' | 'random'
    audioVoice: 'both', // 'es' | 'uk' | 'both' | 'off'
    shuffle: false
});

const VALID_DIRECTIONS = ['es-uk', 'uk-es', 'random'];
const VALID_AUDIO_VOICES = ['es', 'uk', 'both', 'off'];

// Keeps settings saved by older app versions valid after new options are added.
export function normalizeSettings(saved) {
    const source = saved && typeof saved === 'object' ? saved : {};
    return {
        direction: VALID_DIRECTIONS.includes(source.direction) ? source.direction : DEFAULT_SETTINGS.direction,
        audioVoice: VALID_AUDIO_VOICES.includes(source.audioVoice) ? source.audioVoice : DEFAULT_SETTINGS.audioVoice,
        shuffle: source.shuffle === true
    };
}

export async function loadDefaultCards() {
    try {
        const response = await fetch('data/cards.csv');
        if (response.ok) {
            const text = await response.text();
            const parsed = parseCSV(text);
            if (parsed.length > 0) return parsed;
        }
    } catch (e) {
        console.error('Failed to fetch data/cards.csv:', e);
    }
    // Hardcoded fallback cards to guarantee default cards are always present even offline or on fetch failure
    return parseCSV(`id;topic;es;uk;example
1;Повсякденні фрази;Hola, ¿qué tal?;Привіт, як справи?;Hola, ¿qué tal? Todo bien, gracias.
2;Повсякденні фрази;Buenos días;Доброго ранку;Buenos días, profesor.
3;Повсякденні фрази;Buenas tardes;Доброго дня;Buenas tardes, amigos.
4;Повсякденні фрази;Buenas noches;Доброї ночі / вечора;Buenas noches a todos.
5;Повсякденні фрази;Por favor;Будь ласка;Un café, por favor.
6;Повсякденні фрази;Muchas gracias;Дуже дякую;Muchas gracias por tu ayuda.
7;Повсякденні фрази;De nada;Нема за що;De nada, amigo mío.
8;Повсякденні фрази;Lo siento;Вибачте;Lo siento, llego tarde.
9;Повсякденні фрази;¿Cómo te llamas?;Як тебе звати?;Hola, ¿cómo te llamas?
10;Повсякденні фрази;Mucho gusto;Приємно познайомитися;Mucho gusto en conocerte.
11;Повсякденні фрази;Hasta luego;До зустрічі;Hasta luego, nos vemos mañana.
12;Повсякденні фрази;Sí / No;Так / Ні;Sí, me gusta mucho el café.
13;Повсякденні фрази;No entiendo;Я не розумію;Lo siento, no entiendo español muy bien.
14;Повсякденні фрази;¿Hablas inglés?;Ти розмовляєш англійською?;Disculpe, ¿hablas inglés?
15;Повсякденні фрази;Ayuda, por favor;Допоможіть, будь ласка;¡Ayuda, por favor! Necesito un médico.
16;Їжа та ресторани;Una mesa para dos, por favor;Столик на двох, будь ласка;Una mesa para dos, por favor, cerca de la ventana.
17;Їжа та ресторани;La cuenta, por favor;Рахунок, будь ласка;La cuenta, por favor, estamos listos.
18;Їжа та ресторани;Tengo hambre;Я голодний;Tengo hambre, vamos a comer algo.
19;Їжа та ресторани;Tengo sed;Я хочу пити;Tengo sed, necesito agua fría.
20;Їжа та ресторани;¿Cuánto cuesta?;Скільки це коштує?;¿Cuánto cuesta esta manzana?
21;Їжа та ресторани;El agua;Вода;Un vaso de agua, por favor.
22;Їжа та ресторани;El café;Кава;Me gusta tomar café por la mañana.
23;Їжа та ресторани;La comida;Їжа;La comida española es deliciosa.
24;Їжа та ресторани;El pan;Хліб;El pan recién horneado es delicioso.
25;Їжа та ресторани;La fruta;Фрукти;Comer fruta fresca es saludable.
26;Подорожі та транспорт;¿Dónde está el baño?;Де знаходиться туалет?;Disculpe, ¿dónde está el baño?
27;Подорожі та транспорт;Quiero ir al aeropuerto;Я хочу поїхати в аеропорт;Quiero ir al aeropuerto en taxi.
28;Подорожі та транспорт;¿A qué hora sale el tren?;О котрій години відправляється поїзд?;¿A qué hora sale el tren a Madrid?
29;Подорожі та транспорт;Un billete de ida y vuelta;Квиток туди і назад;Un billete de ida y vuelta a Barcelona, por favor.
30;Подорожі та транспорт;La calle;Вулиця;Esta calle es muy bonita.
31;Подорожі та транспорт;El hotel;Готель;¿Dónde está el hotel central?
32;Подорожі та транспорт;El autobús;Автобус;El autobús llega a las cinco.
33;Числа та дати;Uno, dos, tres;Один, два, три;Uno, dos, tres, ¡vamos!
34;Числа та дати;Cuatro, cinco, seis;Чотири, п'ять, шість;Tengo cuatro manzanas.
35;Числа та дати;Siete, ocho, nueve, diez;Сім, вісім, дев'ять, десять;Contamos de siete a diez.
36;Числа та дати;Hoy;Сьогодні;Hoy es un día hermoso.
37;Числа та дати;Mañana;Завтра;Nos vemos mañana por la mañana.
38;Числа та дати;Ayer;Учора;Ayer fui al parque.
39;Базові дієслова;Querer;Хотіти;Quiero aprender español.
40;Базові дієслова;Tener;Мати;Tengo una pregunta.
41;Базові дієслова;Hacer;Робити;¿Qué haces hoy?
42;Базові дієслова;Ir;Іти / Їхати;Vamos a la playa este fin de semana.`);
}

export function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    const cards = [];
    
    // Simple CSV parser supporting semicolon separator and basic quoted fields
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const row = parseCSVLine(line);
        if (row.length >= 4) {
            let [id, topic, es, uk, example] = row;
            if (!id || id.trim() === '') {
                id = generateHash(topic + es + uk);
            }
            cards.push({
                id: id.trim(),
                topic: topic.trim(),
                es: es.trim(),
                uk: uk.trim(),
                example: example ? example.trim() : ''
            });
        }
    }
    return cards;
}

function parseCSVLine(line) {
    const result = [];
    let cur = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ';' && !inQuotes) {
            result.push(cur);
            cur = '';
        } else {
            cur += char;
        }
    }
    result.push(cur);
    return result.map(val => val.replace(/^"|"$/g, '').replace(/""/g, '"'));
}

function generateHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return 'card_' + Math.abs(hash);
}

// Storage adapter
export async function loadUserData() {
    let rawData = null;
    
    // Try Telegram CloudStorage if available
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.CloudStorage) {
        try {
            rawData = await new Promise((resolve) => {
                window.Telegram.WebApp.CloudStorage.getItem(STORAGE_KEY, (err, val) => {
                    if (!err && val) resolve(val);
                    else resolve(null);
                });
            });
        } catch (e) {
            console.warn('Telegram CloudStorage failed:', e);
        }
    }

    // Fallback to localStorage
    if (!rawData) {
        rawData = localStorage.getItem(STORAGE_KEY);
    }

    if (rawData) {
        try {
            return JSON.parse(rawData);
        } catch (e) {
            console.error('Failed to parse saved user data', e);
        }
    }

    return {};
}

export async function saveUserData(progressMap) {
    const dataStr = JSON.stringify(progressMap);
    
    // Save to localStorage
    try {
        localStorage.setItem(STORAGE_KEY, dataStr);
    } catch (e) {
        console.error('localStorage save failed:', e);
    }

    // Save to Telegram CloudStorage
    if (window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.CloudStorage) {
        try {
            // Telegram CloudStorage has a 4096 bytes per key limit. If data is large, split into chunks or store keys.
            // For flashcards progress, let's chunk if necessary or store directly if small.
            window.Telegram.WebApp.CloudStorage.setItem(STORAGE_KEY, dataStr, (err) => {
                if (err) console.warn('Telegram CloudStorage setItem error:', err);
            });
        } catch (e) {
            console.warn('Telegram CloudStorage save failed:', e);
        }
    }
}

export function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) return normalizeSettings(JSON.parse(saved));
    } catch (e) {}
    return normalizeSettings();
}

export function saveSettings(settings) {
    const normalized = normalizeSettings(settings);
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    } catch (e) {}
    return normalized;
}
