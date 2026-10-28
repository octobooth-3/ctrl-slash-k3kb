'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function createGame(saved = {}) {
  const warnings = [];
  const canvas = { getContext: () => ({}) };
  const context = vm.createContext({
    document: { querySelector: () => canvas, createElement: () => ({ ...canvas }) },
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => JSON.stringify(saved), setItem() {} },
    console: { warn: (message) => warnings.push(message) },
    UI: { startRun() {}, timer() {}, mult() {}, setMode() {} },
    Sfx: { combo() {}, tick() {}, resume() {} },
    banners: [],
    banner() {},
  });
  for (const file of ['core.js', 'entities.js', 'game.js']) {
    vm.runInContext(readFileSync(join(__dirname, '..', 'js', file), 'utf8'), context, { filename: file });
  }
  const evaluate = (source) => vm.runInContext(source, context);
  evaluate('W = 800; H = 600; G = 900;');
  return { evaluate, warnings };
}

test('new and existing saves default to Medium without losing progress', () => {
  for (const saved of [{}, { best: { classic: 1234 }, hats: { crown: 2 }, equipped: 'crown' }]) {
    const { evaluate } = createGame(saved);
    assert.equal(evaluate('save.difficulty'), 'medium');
    assert.equal(evaluate("newRun('classic').difficulty"), 'medium');
    assert.equal(evaluate('save.best.classic'), saved.best?.classic || 0);
    assert.equal(evaluate('save.hats.crown'), saved.hats?.crown);
  }
});

test('saved difficulty is restored and invalid saved difficulty is reported', () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const { evaluate, warnings } = createGame({ difficulty });
    assert.equal(evaluate('save.difficulty'), difficulty);
    assert.equal(evaluate("newRun('arcade').difficulty"), difficulty);
    assert.equal(warnings.length, 0);
  }
  for (const difficulty of ['unknown', '__proto__', null, 2]) {
    const { evaluate, warnings } = createGame({ difficulty });
    assert.equal(evaluate('save.difficulty'), 'medium');
    assert.equal(warnings.length, 1);
  }
});

for (const [difficulty, speed, bombStart, bombEnd] of [
  ['easy', 0.8, 0.1, 0.3],
  ['medium', 1, 0.2, 0.5],
  ['hard', 1.25, 0.35, 0.65],
]) {
  test(`${difficulty}: applies the chosen preset to both modes from the start`, () => {
    const { evaluate } = createGame({ difficulty });
    assert.equal(evaluate(`DIFFICULTIES.${difficulty}.speed`), speed);
    for (const mode of ['classic', 'arcade']) {
      evaluate(`startRun('${mode}');`);
      assert.equal(evaluate('run.difficulty'), difficulty);
      assert.equal(evaluate('run.time'), 0);
      assert.equal(evaluate('run.d'), 0);
      assert.equal(evaluate('run.left'), 60);
      assert.equal(evaluate('timeScale'), 1);
    }
  });

  test(`${difficulty}: bomb chance starts immediately and scales with intensity`, () => {
    const { evaluate } = createGame({ difficulty });
    evaluate(`
      run = newRun('classic'); state = 'play';
      Math.random = () => 0;
      const chances = [];
      slot = (chance) => chances.push(chance);
    `);
    for (const intensity of [0, 0.5, 1]) {
      evaluate(`run.d = ${intensity}; chances.length = 0; spawnWave();`);
      const chance = bombStart + (bombEnd - bombStart) * intensity;
      assert.deepEqual(Array.from(evaluate('chances')), [chance * 0.6, chance]);
    }
  });

  test(`${difficulty}: bombs can actually spawn in the first wave`, () => {
    const { evaluate } = createGame({ difficulty });
    evaluate("run = newRun('classic'); state = 'play'; Math.random = () => 0; spawnWave();");
    assert.equal(evaluate('run.time'), 0);
    assert.ok(evaluate("ents.some((e) => e.type === 'bomb')"));
  });

  test(`${difficulty}: speed changes waves and spawn delays, not the Arcade clock`, () => {
    const { evaluate } = createGame({ difficulty });
    evaluate(`
      run = newRun('arcade'); state = 'play'; run.waveT = 10;
      after(10, () => {}); after(10, () => {}, true);
      updateGame(1, 1);
    `);
    assert.equal(evaluate('run.waveT'), 10 - speed);
    assert.equal(evaluate('timers[0].t'), 10 - speed);
    assert.equal(evaluate('timers[1].t'), 9);
    assert.equal(evaluate('run.left'), 59);
    assert.equal(evaluate('run.time'), 1);
    assert.equal(evaluate('run.d'), 1 / 60);
  });

  test(`${difficulty}: frenzy cadence scales but power-up duration stays unchanged`, () => {
    const { evaluate } = createGame({ difficulty });
    evaluate(`
      run = newRun('classic'); state = 'play'; run.waveT = 10;
      run.frenzyT = 5; run.slowT = 5;
      let frenzyDt;
      frenzyTick = (dt) => { frenzyDt = dt; };
      updateGame(0.38, 1);
    `);
    assert.equal(evaluate('frenzyDt'), speed);
    assert.equal(evaluate('run.frenzyT'), 4);
    assert.equal(evaluate('run.slowT'), 4);
    assert.equal(evaluate('run.time'), 0.38);
  });

  test(`${difficulty}: retry resets the run while retaining its difficulty`, () => {
    const { evaluate } = createGame({ difficulty });
    evaluate(`
      startRun('arcade'); run.score = 200; run.time = 20;
      save.difficulty = 'medium';
      startRun(run.mode, run.difficulty);
    `);
    assert.equal(evaluate('run.difficulty'), difficulty);
    assert.equal(evaluate('run.mode'), 'arcade');
    assert.equal(evaluate('run.score'), 0);
    assert.equal(evaluate('run.time'), 0);
  });
}

test('menu simulation keeps its original timing with no active run', () => {
  const { evaluate } = createGame({ difficulty: 'hard' });
  evaluate("state = 'menu'; after(10, () => {}); updateGame(1, 1);");
  assert.equal(evaluate('timers[0].t'), 9);
  assert.equal(evaluate('run'), null);
});

test('real opening waves produce more bombs at each higher difficulty', () => {
  const counts = [];
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const { evaluate } = createGame({ difficulty });
    counts.push(evaluate(`
      run = newRun('classic'); state = 'play';
      let seed = 123456, bombs = 0;
      Math.random = () => {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 1000; i++) {
        ents.length = 0;
        spawnWave();
        for (const timer of timers.splice(0)) timer.fn();
        bombs += ents.filter((entity) => entity.type === 'bomb').length;
      }
      bombs;
    `));
  }
  assert.ok(counts[0] > 0);
  assert.ok(counts[0] < counts[1], `Easy (${counts[0]}) must have fewer bombs than Medium (${counts[1]})`);
  assert.ok(counts[1] < counts[2], `Medium (${counts[1]}) must have fewer bombs than Hard (${counts[2]})`);
});
