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
    return parseCSV("1;Одяг та ціни (La ropa y los precios);¿Cuál es el precio de...?;Яка ціна...?;\n2;Одяг та ціни (La ropa y los precios);¿Cuánto es?;Скільки це коштує? / Скільки з мене? (за все);\n3;Одяг та ціни (La ropa y los precios);¿Cuánto es el total?;Яка загальна сума? / Скільки всього?;\n4;Одяг та ціни (La ropa y los precios);costar (o → ue);коштувати (неправильне дієслово);\n5;Одяг та ціни (La ropa y los precios);¿Cuánto cuesta...?;Скільки коштує...? (однина);\n6;Одяг та ціни (La ropa y los precios);¿Cuánto cuestan...?;Скільки коштують...? (множина);\n7;Одяг та ціни (La ropa y los precios);valer;коштувати, мати ціну;\n8;Одяг та ціни (La ropa y los precios);¿Cuánto vale...?;Скільки коштує...? (однина);\n9;Одяг та ціни (La ropa y los precios);¿Cuánto valen...?;Скільки коштують...? (множина);\n10;Одяг та ціни (La ropa y los precios);el precio;ціна;\n11;Одяг та ціни (La ropa y los precios);pedir la cuenta;попросити рахунок;\n12;Одяг та ціни (La ropa y los precios);el euro / los euros;євро;\n13;Одяг та ціни (La ropa y los precios);el céntimo / los céntimos;цент / центи;\n14;Одяг та ціни (La ropa y los precios);doce con cincuenta (12,50);дванадцять п'ятдесят (про ціну);\n15;Одяг та ціни (La ropa y los precios);¡Qué caro! / ¡Qué cara!;Як дорого! (ч.р. / ж.р.);\n16;Одяг та ціни (La ropa y los precios);¡Qué barato! / ¡Qué barata!;Як дешево! (ч.р. / ж.р.);\n17;Одяг та ціни (La ropa y los precios);es gratis;це безкоштовно;\n18;Одяг та ціни (La ropa y los precios);no pagar nada;нічого не платити;\n19;Одяг та ціни (La ropa y los precios);la ropa;одяг;\n20;Одяг та ціни (La ropa y los precios);la ropa de deporte;спортивний одяг;\n21;Одяг та ціни (La ropa y los precios);la camiseta;футболка;\n22;Одяг та ціни (La ropa y los precios);la camiseta de manga corta;футболка з коротким рукавом;\n23;Одяг та ціни (La ropa y los precios);la camiseta de manga larga;лонгслів / футболка з довгим рукавом;\n24;Одяг та ціни (La ropa y los precios);la camisa;сорочка;\n25;Одяг та ціни (La ropa y los precios);el pantalón / los pantalones;штани;\n26;Одяг та ціни (La ropa y los precios);la chaqueta;куртка, піджак, жакет;\n27;Одяг та ціни (La ropa y los precios);el abrigo;пальто, зимова куртка;\n28;Одяг та ціни (La ropa y los precios);el anorak;анорак, тепла куртка;\n29;Одяг та ціни (La ropa y los precios);el chándal;спортивний костюм;\n30;Одяг та ціни (La ropa y los precios);el jersey;светр, джемпер;\n31;Одяг та ціни (La ropa y los precios);el jersey de cuello alto;водолазка / светр з високим горлом;\n32;Одяг та ціни (La ropa y los precios);el vestido;сукня;\n33;Одяг та ціни (La ropa y los precios);la falda;спідниця;\n34;Одяг та ціни (La ropa y los precios);la sudadera;світшот, худі, толстовка;\n35;Одяг та ціни (La ropa y los precios);las bragas;жіночі труси;\n36;Одяг та ціни (La ropa y los precios);los calzoncillos;чоловічі труси;\n37;Одяг та ціни (La ropa y los precios);los calcetines;шкарпетки;\n38;Одяг та ціни (La ropa y los precios);los zapatos;туфлі, взуття;\n39;Одяг та ціни (La ropa y los precios);las zapatillas (de deporte);кросівки;\n40;Одяг та ціни (La ropa y los precios);las botas;чоботи, черевики;\n41;Одяг та ціни (La ropa y los precios);los tacones;підбори / туфлі на підборах;\n42;Одяг та ціни (La ropa y los precios);la gorra;кепка, бейсболка;\n43;Одяг та ціни (La ropa y los precios);el gorro;шапка;\n44;Одяг та ціни (La ropa y los precios);la bufanda;шарф;\n45;Одяг та ціни (La ropa y los precios);el cinturón;ремінь, пояс;\n46;Одяг та ціни (La ropa y los precios);el anillo;каблучка, перстень;\n47;Одяг та ціни (La ropa y los precios);los pendientes;сережки;\n48;Одяг та ціни (La ropa y los precios);la mochila;рюкзак;\n49;Одяг та ціни (La ropa y los precios);la cremallera;блискавка (застібка);\n50;Одяг та ціни (La ropa y los precios);el bolsillo;кишеня;\n51;Одяг та ціни (La ropa y los precios);la tienda de ropa;магазин одягу;\n52;Одяг та ціни (La ropa y los precios);No pasa nada;Нічого страшного / Все гаразд;\n53;Одяг та ціни (La ropa y los precios);No te preocupes;Не хвилюйся;\n54;Одяг та ціни (La ropa y los precios);¡Menos mal!;Слава Богу! / Добре, що так!;\n55;Одяг та ціни (La ropa y los precios);¡Cuidado!;Обережно!;\n56;Одяг та ціни (La ropa y los precios);¡Venga!;Давай! / Нумо!;\n57;Одяг та ціни (La ropa y los precios);¿Cómo se dice en español...?;Як сказати іспанською...?;\n58;Одяг та ціни (La ropa y los precios);Yo necesito...;Мені потрібно...;\n59;Одяг та ціни (La ropa y los precios);Yo quiero...;Я хочу...;");
}

export function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    const cards = [];

    // Skip the first line only when it is really a header. Keeping headerless
    // CSVs intact prevents the first card from silently disappearing.
    const firstLine = (lines[0] || '').replace(/^\uFEFF/, '').trim().toLowerCase();
    const hasHeader = firstLine.split(';').some(cell => cell.trim() === 'topic')
        && firstLine.split(';').some(cell => cell.trim() === 'es')
        && firstLine.split(';').some(cell => cell.trim() === 'uk');
    const start = hasHeader ? 1 : 0;

    // Simple CSV parser supporting semicolon separator and basic quoted fields
    for (let i = start; i < lines.length; i++) {
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
