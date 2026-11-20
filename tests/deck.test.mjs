// Regression tests for the single active deck (La ropa y los precios).
// Run with: node tests/deck.test.mjs
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseCSV } from '../storage.js';

const cardsFile = new URL('../data/cards.csv', import.meta.url);
const csvText = fs.readFileSync(cardsFile, 'utf8');
const cards = parseCSV(csvText);
const TOPIC = 'Одяг та ціни (La ropa y los precios)';

let passed = 0;
function check(name, fn) {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
}

check('CSV keeps its header row', () => {
    assert.equal(csvText.split(/\r?\n/)[0], 'id;topic;es;uk;example');
});

check('exactly 59 cards of one topic with sequential ids', () => {
    assert.equal(cards.length, 59);
    assert.deepEqual([...new Set(cards.map(card => card.topic))], [TOPIC]);
    assert.deepEqual(cards.map(card => card.id), Array.from({ length: 59 }, (_, i) => String(i + 1)));
});

check('first and last cards match the source material', () => {
    assert.equal(cards[0].es, '¿Cuál es el precio de...?');
    assert.equal(cards[0].uk, 'Яка ціна...?');
    assert.equal(cards[58].es, 'Yo quiero...');
    assert.equal(cards[58].uk, 'Я хочу...');
    assert.ok(!csvText.includes('I want...'), 'English translation leaked into the Ukrainian deck');
});

check('headerless CSV does not lose the first card', () => {
    const body = csvText.split(/\r?\n/).slice(1).join('\n');
    const parsed = parseCSV(body);
    assert.equal(parsed.length, 59);
    assert.equal(parsed[0].es, '¿Cuál es el precio de...?');
});

check('no duplicate ES/UK pairs', () => {
    const pairs = cards.map(card => `${card.es}\u0000${card.uk}`);
    assert.equal(new Set(pairs).size, pairs.length);
});

console.log(`\n${passed}/${passed} checks passed`);
