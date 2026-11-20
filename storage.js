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
    return parseCSV("id;topic;es;uk;example\n1;Повсякденні фрази;Hola, ¿qué tal?;Привіт, як справи?;Hola, ¿qué tal? Todo bien, gracias.\n2;Повсякденні фрази;Buenos días;Доброго ранку;Buenos días, profesor.\n3;Повсякденні фрази;Buenas tardes;Доброго дня;Buenas tardes, amigos.\n4;Повсякденні фрази;Buenas noches;Доброї ночі / вечора;Buenas noches a todos.\n5;Повсякденні фрази;Por favor;Будь ласка;Un café, por favor.\n6;Повсякденні фрази;Muchas gracias;Дуже дякую;Muchas gracias por tu ayuda.\n7;Повсякденні фрази;De nada;Нема за що;De nada, amigo mío.\n8;Повсякденні фрази;Lo siento;Вибачте;Lo siento, llego tarde.\n9;Повсякденні фрази;¿Cómo te llamas?;Як тебе звати?;Hola, ¿cómo te llamas?\n10;Повсякденні фрази;Mucho gusto;Приємно познайомитися;Mucho gusto en conocerte.\n11;Повсякденні фрази;Hasta luego;До зустрічі;Hasta luego, nos vemos mañana.\n12;Повсякденні фрази;Sí / No;Так / Ні;Sí, me gusta mucho el café.\n13;Повсякденні фрази;Не entiendo;Я не розумію;Lo siento, no entiendo español muy bien.\n14;Повсякденні фрази;¿Hablas inglés?;Ти розмовляєш англійською?;Disculpe, ¿hablas inglés?\n15;Повсякденні фрази;Ayuda, por favor;Допоможіть, будь ласка;¡Ayuda, por favor! Necesito un médico.\n16;Їжа та ресторани;Una mesa para dos, por favor;Столик на двох, будь ласка;Una mesa para dos, por favor, cerca de la ventana.\n17;Їжа та ресторани;La cuenta, por favor;Рахунок, будь ласка;La cuenta, por favor, estamos listos.\n18;Їжа та ресторани;Tengo hambre;Я голодний;Tengo hambre, vamos a comer algo.\n19;Їжа та ресторани;Tengo sed;Я хочу пити;Tengo sed, necesito agua fría.\n20;Їжа та ресторани;¿Cuánto cuesta?;Скільки це коштує?;¿Cuánto cuesta esta manzana?\n21;Їжа та ресторани;El agua;Вода;Un vaso de agua, por favor.\n22;Їжа та ресторани;El café;Кава;Me gusta tomar café por la mañana.\n23;Їжа та ресторани;La comida;Їжа;La comida española es deliciosa.\n24;Їжа та ресторани;El pan;Хліб;El pan recién horneado es delicioso.\n25;Їжа та ресторани;La fruta;Фрукти;Comer fruta fresca es saludable.\n26;Подорожі та транспорт;¿Dónde está el baño?;Де знаходиться туалет?;Disculpe, ¿dónde está el baño?\n27;Подорожі та транспорт;Quiero ir al aeropuerto;Я хочу поїхати в аеропорт;Quiero ir al aeropuerto en taxi.\n28;Подорожі та транспорт;¿A qué hora sale el tren?;О котрій години відправляється поїзд?;¿A qué hora sale el tren a Madrid?\n29;Подорожі та транспорт;Un billete de ida y vuelta;Квиток туди і назад;Un billete de ida y vuelta a Barcelona, por favor.\n30;Подорожі та транспорт;La calle;Вулиця;Esta calle es muy bonita.\n31;Подорожі та транспорт;El hotel;Готель;¿Dónde está el hotel central?\n32;Подорожі та транспорт;El autobús;Автобус;El autobús llega a las cinco.\n33;Числа та дати;Uno, dos, tres;Один, два, три;Uno, dos, tres, ¡vamos!\n34;Числа та дати;Cuatro, cinco, seis;Чотири, п'ять, шість;Tengo cuatro manzanas.\n35;Числа та дати;Siete, ocho, nueve, diez;Сім, вісім, дев'ять, десять;Contamos de siete a diez.\n36;Числа та дати;Hoy;Сьогодні;Hoy es un día hermoso.\n37;Числа та дати;Mañana;Завтра;Nos vemos mañana por la mañana.\n38;Числа та дати;Ayer;Учора;Ayer fui al parque.\n39;Базові дієслова;Querer;Хотіти;Quiero aprender español.\n40;Базові дієслова;Tener;Мати;Tengo una pregunta.\n41;Базові дієслова;Hacer;Робити;¿Qué haces hoy?\n42;Базові дієслова;Ir;Іти / Їхати;Vamos a la playa este fin de semana.\n43;Одяг та ціни (La ropa y los precios);¿Cuál es el precio de...?;Яка ціна...?;\n44;Одяг та ціни (La ropa y los precios);¿Cuánto es?;Скільки це коштує? / Скільки з мене? (за все);\n45;Одяг та ціни (La ropa y los precios);¿Cuánto es el total?;Яка загальна сума? / Скільки всього?;\n46;Одяг та ціни (La ropa y los precios);costar (o → ue);коштувати (неправильне дієслово);\n47;Одяг та ціни (La ropa y los precios);¿Cuánto cuesta...?;Скільки коштує...? (однина);\n48;Одяг та ціни (La ropa y los precios);¿Cuánto cuestan...?;Скільки коштують...? (множина);\n49;Одяг та ціни (La ropa y los precios);valer;коштувати, мати ціну;\n50;Одяг та ціни (La ropa y los precios);¿Cuánto vale...?;Скільки коштує...? (однина);\n51;Одяг та ціни (La ropa y los precios);¿Cuánto valen...?;Скільки коштують...? (множина);\n52;Одяг та ціни (La ropa y los precios);el precio;ціна;\n53;Одяг та ціни (La ropa y los precios);pedir la cuenta;попросити рахунок;\n54;Одяг та ціни (La ropa y los precios);el euro / los euros;євро;\n55;Одяг та ціни (La ropa y los precios);el céntimo / los céntimos;цент / центи;\n56;Одяг та ціни (La ropa y los precios);doce con cincuenta (12,50);дванадцять п'ятдесят (про ціну);\n57;Одяг та ціни (La ropa y los precios);¡Qué caro! / ¡Qué cara!;Як дорого! (ч.р. / ж.р.);\n58;Одяг та ціни (La ropa y los precios);¡Qué barato! / ¡Qué barata!;Як дешево! (ч.р. / ж.р.);\n59;Одяг та ціни (La ropa y los precios);es gratis;це безкоштовно;\n60;Одяг та ціни (La ropa y los precios);no pagar nada;нічого не платити;\n61;Одяг та ціни (La ropa y los precios);la ropa;одяг;\n62;Одяг та ціни (La ropa y los precios);la ropa de deporte;спортивний одяг;\n63;Одяг та ціни (La ropa y los precios);la camiseta;футболка;\n64;Одяг та ціни (La ropa y los precios);la camiseta de manga corta;футболка з коротким рукавом;\n65;Одяг та ціни (La ropa y los precios);la camiseta de manga larga;лонгслів / футболка з довгим рукавом;\n66;Одяг та ціни (La ropa y los precios);la camisa;сорочка;\n67;Одяг та ціни (La ropa y los precios);el pantalón / los pantalones;штани;\n68;Одяг та ціни (La ropa y los precios);la chaqueta;куртка, піджак, жакет;\n69;Одяг та ціни (La ropa y los precios);el abrigo;пальто, зимова куртка;\n70;Одяг та ціни (La ropa y los precios);el anorak;анорак, тепла куртка;\n71;Одяг та ціни (La ropa y los precios);el chándal;спортивний костюм;\n72;Одяг та ціни (La ropa y los precios);el jersey;светр, джемпер;\n73;Одяг та ціни (La ropa y los precios);el jersey de cuello alto;водолазка / светр з високим горлом;\n74;Одяг та ціни (La ropa y los precios);el vestido;сукня;\n75;Одяг та ціни (La ropa y los precios);la falda;спідниця;\n76;Одяг та ціни (La ropa y los precios);la sudadera;світшот, худі, толстовка;\n77;Одяг та ціни (La ropa y los precios);las bragas;жіночі труси;\n78;Одяг та ціни (La ropa y los precios);los calzoncillos;чоловічі труси;\n79;Одяг та ціни (La ropa y los precios);los calcetines;шкарпетки;\n80;Одяг та ціни (La ropa y los precios);los zapatos;туфлі, взуття;\n81;Одяг та ціни (La ropa y los precios);las zapatillas (de deporte);кросівки;\n82;Одяг та ціни (La ropa y los precios);las botas;чоботи, черевики;\n83;Одяг та ціни (La ropa y los precios);los tacones;підбори / туфлі на підборах;\n84;Одяг та ціни (La ropa y los precios);la gorra;кепка, бейсболка;\n85;Одяг та ціни (La ropa y los precios);el gorro;шапка;\n86;Одяг та ціни (La ropa y los precios);la bufanda;шарф;\n87;Одяг та ціни (La ropa y los precios);el cinturón;ремінь, пояс;\n88;Одяг та ціни (La ropa y los precios);el anillo;каблучка, перстень;\n89;Одяг та ціни (La ropa y los precios);los pendientes;сережки;\n90;Одяг та ціни (La ropa y los precios);la mochila;рюкзак;\n91;Одяг та ціни (La ropa y los precios);la cremallera;блискавка (застібка);\n92;Одяг та ціни (La ropa y los precios);el bolsillo;кишеня;\n93;Одяг та ціни (La ropa y los precios);la tienda de ropa;магазин одягу;\n94;Одяг та ціни (La ropa y los precios);No pasa nada;Нічого страшного / Все гаразд;\n95;Одяг та ціни (La ropa y los precios);No te preocupes;Не хвилюйся;\n96;Одяг та ціни (La ropa y los precios);¡Menos mal!;Слава Богу! / Добре, що так!;\n97;Одяг та ціни (La ropa y los precios);¡Cuidado!;Обережно!;\n98;Одяг та ціни (La ropa y los precios);¡Venga!;Давай! / Нумо!;\n99;Одяг та ціни (La ropa y los precios);¿Cómo se dice en español...?;Як сказати іспанською...?;\n100;Одяг та ціни (La ropa y los precios);Yo necesito...;Мені потрібно...;\n101;Одяг та ціни (La ropa y los precios);Yo quiero...;Я хочу...;");
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
