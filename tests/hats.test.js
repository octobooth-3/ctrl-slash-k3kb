'use strict';

const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const { inflateSync } = require('node:zlib');
const { designs, atlas } = require('../scripts/generate-hats');

function createGame(saved = {}) {
  const nodes = new Map(), stored = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', innerHTML: '', hidden: false, children: [],
      classList: { add() {}, remove() {}, toggle() {} },
      style: { setProperty() {} },
      addEventListener(type, handler) { this[type] = handler; },
      querySelector: (selector) => node(`${id} ${selector}`),
      querySelectorAll: () => [],
      insertAdjacentHTML(position, html) { this.innerHTML += html; },
    });
    return nodes.get(id);
  }
  const canvas = { getContext: () => ({}) };
  const context = vm.createContext({
    document: {
      querySelector: () => canvas, createElement: () => ({ ...canvas }),
      getElementById: node,
    },
    matchMedia: () => ({ matches: false }),
    localStorage: {
      getItem: () => JSON.stringify(saved),
      setItem: (key, value) => stored.set(key, JSON.parse(value)),
    },
    Sfx: { hat() {}, fanfare() {} },
    setTimeout() {}, requestAnimationFrame() {},
    performance: { now: () => 0 },
    layoutRings() {}, popup() {}, banner() {}, confetti() {},
    console,
  });
  for (const file of ['core.js', 'entities.js', 'game.js', 'ui.js']) {
    vm.runInContext(readFileSync(join(__dirname, '..', 'js', file), 'utf8'), context, { filename: file });
  }
  const evaluate = (source) => vm.runInContext(source, context);
  evaluate('UI.toast = () => {}; overBuddy = () => {};');
  return { evaluate, node, stored };
}

test('every registered hat has an atlas and a complete blade definition', () => {
  const { evaluate } = createGame();
  const hats = Array.from(evaluate('HATS'));
  assert.equal(hats.length, 25);
  assert.equal(new Set(hats.map((h) => h.id)).size, hats.length);
  assert.deepEqual(hats.map((h) => `${h.id}.png`).sort(),
    readdirSync(join(__dirname, '..', 'assets', 'hats')).sort());
  for (const hat of hats) {
    const png = readFileSync(join(__dirname, '..', 'assets', 'hats', `${hat.id}.png`));
    assert.equal(png.readUInt32BE(16), 384, hat.id);
    assert.equal(png.readUInt32BE(20), 288, hat.id);
    assert.ok(evaluate(`BLADES['${hat.id}'].label`));
    assert.ok(evaluate(`BLADES['${hat.id}'].core`));
    assert.ok(evaluate(`TIERS[${hat.tier}]`));
  }
});

test('original atlases are reproducible, distinct, and aligned for every rig pose', () => {
  const hashes = new Set();
  for (const [id, design] of Object.entries(designs)) {
    const png = readFileSync(join(__dirname, '..', 'assets', 'hats', `${id}.png`));
    assert.deepEqual(png, atlas(design), id);
    hashes.add(png.toString('base64'));
    const compressed = [];
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
        compressed.push(png.subarray(offset + 8, offset + 8 + length));
      }
      offset += length + 12;
    }
    const data = inflateSync(Buffer.concat(compressed)), stride = 384 * 4 + 1;
    const alpha = (x, y) => data[y * stride + 1 + x * 4 + 3];
    let visible = 0;
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
      assert.equal(alpha(x, y), 0, `${id}: empty back layer`);
      assert.equal(alpha(x, 192 + y), 0, `${id}: empty face layer`);
      const front = alpha(x, 96 + y);
      if (front) visible++;
      for (let frame = 1; frame < 3; frame++) {
        assert.equal(alpha(x + frame * 96, 96 + y), front, `${id}: pose ${frame}`);
      }
      if (y < 56) assert.equal(alpha(x + 288, 136 + y), front, `${id}: splat anchor`);
    }
    assert.ok(visible > 200, id);
  }
  assert.equal(hashes.size, 8);
});

test('tier probabilities and equipped 3x weighting remain unchanged', () => {
  const { evaluate } = createGame();
  const hats = Array.from(evaluate('HATS')), tiers = Array.from(evaluate('TIERS'));
  assert.deepEqual(tiers.map((tier) => tier.w), [60, 28, 10, 2.5]);
  assert.deepEqual(tiers.map((tier) => tier.pts), [25, 60, 150, 400]);
  for (const equipped of [null, ...Object.keys(designs)]) {
    evaluate(`save.equipped = ${JSON.stringify(equipped)};`);
    const weights = hats.map((hat) =>
      tiers[hat.tier].w / hats.filter((other) => other.tier === hat.tier).length * (hat.id === equipped ? 3 : 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let start = 0;
    hats.forEach((hat, index) => {
      const random = (start + weights[index] / 2) / total;
      assert.equal(evaluate(`Math.random = () => ${random}; pickHat()`), hat.id);
      start += weights[index];
    });
    for (let tier = 0; tier < tiers.length; tier++) {
      const pool = hats.filter((hat) => hat.tier === tier);
      let sum = 0;
      const total = pool.reduce((sum, hat) => sum + (hat.id === equipped ? 3 : 1), 0);
      for (const hat of pool) {
        const weight = hat.id === equipped ? 3 : 1;
        const random = (sum + weight / 2) / total;
        assert.equal(evaluate(`Math.random = () => ${random}; pickHat(${tier})`), hat.id);
        sum += weight;
      }
    }
  }
});

test('all hats collect, persist, equip, and appear in registry-sized wardrobe UI', () => {
  const { evaluate, node, stored } = createGame({ hats: { crown: 2 }, equipped: 'crown' });
  assert.equal(evaluate('save.hats.crown'), 2);
  assert.equal(evaluate('save.equipped'), 'crown');
  evaluate("run = newRun('arcade'); state = 'play';");
  for (const id of Array.from(evaluate('HATS.map((h) => h.id)'))) {
    evaluate(`collectHat('${id}', 0, 0);`);
    assert.ok(stored.get('ctrlslash.v1').hats[id]);
    node('rack-grid').click({ target: { closest: () => ({ dataset: { id }, disabled: false }) } });
    assert.equal(evaluate('save.equipped'), id);
    assert.ok(node('rack-equip').innerHTML.includes(evaluate(`BLADES['${id}'].label`)));
  }
  assert.equal(evaluate('discoveredCount()'), 25);
  assert.equal(node('rack-count').textContent, '25/25');
  assert.equal((node('rack-grid').innerHTML.match(/class="hat-card/g) || []).length, 25);
  assert.equal(node('w-total').textContent, '/25');
  assert.equal((node('w-pips').innerHTML.match(/<i /g) || []).length, 25);
  assert.equal((node('w-pips').innerHTML.match(/class="ms"/g) || []).length, 4);
  evaluate('UI.showMenu(); UI.showOver(run, 0);');
  assert.equal(node('m-hats').textContent, '25/25');
  assert.ok(node('over-stats').innerHTML.includes('25/25'));
});

test('the 17-hat milestone keeps its original score and multiplier with no extra reward', () => {
  const { evaluate } = createGame();
  assert.deepEqual(JSON.parse(evaluate('JSON.stringify(MILESTONES)')), [
    { n: 3, name: 'HAT TRICK', pts: 150, mult: 2, dur: 8 },
    { n: 6, name: 'FASHIONISTA', pts: 400 },
    { n: 10, name: 'HABERDASHER', pts: 1000, mult: 3, dur: 8 },
    { n: 17, name: 'FULL WARDROBE', pts: 5000, mult: 3, dur: 12 },
  ]);
  evaluate(`
    run = newRun('arcade'); state = 'play';
    for (const hat of HATS) collectHat(hat.id, 0, 0);
  `);
  assert.equal(evaluate('timers.length'), 4);
  evaluate('milestone(MILESTONES[3]);');
  assert.equal(evaluate('run.score'), 5000);
  assert.equal(evaluate('run.mult'), 3);
  assert.equal(evaluate('run.multT'), 12);
});
