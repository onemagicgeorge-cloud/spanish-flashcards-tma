// Storage & Data Management with Telegram CloudStorage and localStorage fallback
const STORAGE_KEY = 'es_flashcards_progress_v1';
const SETTINGS_KEY = 'es_flashcards_settings_v1';

export async function loadDefaultCards() {
    try {
        const response = await fetch('data/cards.csv');
        const text = await response.text();
        return parseCSV(text);
    } catch (e) {
        console.error('Failed to load default cards:', e);
        return [];
    }
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
        if (saved) return JSON.parse(saved);
    } catch (e) {}
    return { direction: 'es-uk' };
}

export function saveSettings(settings) {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {}
}
