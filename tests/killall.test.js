'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function createGame(mode = 'classic') {
  const canvas = { getContext: () => ({}), addEventListener() {} };
  const noop = () => {};
  const context = vm.createContext({
    document: { querySelector: () => canvas, createElement: () => ({ ...canvas }) },
    matchMedia: () => ({ matches: false }),
    localStorage: { getItem: () => null, setItem() {} },
    performance: { now: () => 100 },
    console,
    UI: { score: noop, strikes: noop, timer: noop, mult: noop, setMode: noop, toast: noop, wardrobe: noop },
    Sfx: Object.fromEntries(['slice', 'hat', 'crit', 'combo', 'fanfare', 'breakpoint', 'agent', 'killall', 'thunk', 'strike', 'boom'].map((key) => [key, noop])),
    banners: [], parts: [],
    ...Object.fromEntries(['gore', 'decal', 'slashFx', 'screenSlash', 'shock', 'sparks', 'flash', 'shake', 'banner', 'popup', 'word', 'confetti', 'vibrate'].map((key) => [key, noop])),
  });
  for (const file of ['core.js', 'entities.js', 'game.js', 'input.js']) {
    vm.runInContext(readFileSync(join(__dirname, '..', 'js', file), 'utf8'), context, { filename: file });
  }
  const evaluate = (source) => vm.runInContext(source, context);
  evaluate(`
    W = 800; H = 600; G = 900; TOP = 30;
    state = 'play'; run = newRun('${mode}');
    spawnHalves = () => {};
    Math.random = () => 0.5;
    function visible(o = {}) { return makeBuddy({ x: 200, y: 300, entered: true, ...o }); }
    const chip = Object.assign(makeKillall(), { x: 400, y: 300, entered: true });
    const group = newGroup();
  `);
  return evaluate;
}

for (const mode of ['classic', 'arcade']) {
  test(`${mode}: pointer slicing killall cuts all visible buddies and credits the swipe once`, () => {
    const evaluate = createGame(mode);
    evaluate(`
      const buddies = [visible(), visible({ x: 650 }), visible({ x: 600, hat: 'baseball-cap' })];
      const bomb = Object.assign(makeBomb(), { x: 100, y: 400, entered: true });
      const hat = makeLooseHat('crown', 700, 400, 0, 0);
      const offscreen = [visible({ x: -S * 2 }), visible({ x: W + S * 2 }), visible({ y: TOP - S * 2 }), visible({ y: H + S * 2 }), visible({ y: H + S * 2, entered: false })];
      ents.push(chip, ...buddies, bomb, hat, ...offscreen);
      cutAlong({ grp: group }, 350, 300, 450, 300);
    `);
    assert.equal(evaluate('run.stats.sliced'), 3);
    assert.equal(evaluate('run.score'), 55);
    assert.equal(evaluate('group.n'), 3);
    assert.equal(evaluate('group.last'), 100);
    assert.equal(evaluate('run.hats["baseball-cap"]'), 1);
    assert.equal(evaluate('ents.includes(chip)'), false);
    assert.equal(evaluate('ents.includes(bomb) && ents.includes(hat) && offscreen.every((b) => ents.includes(b))'), true);
    assert.equal(evaluate('ents.filter((e) => e.type === "hat").length'), 2);
    assert.equal(evaluate('run.stats.bombs'), 0);
    assert.equal(evaluate('run.strikes'), 0);
    assert.equal(evaluate('state'), 'play');
    evaluate('finalizeGroup(group); hitKillall(chip, 0, group);');
    assert.equal(evaluate('run.score'), 145);
    assert.equal(evaluate('run.stats.maxCombo'), 3);
  });
}

test('killall cuts monoliths in one hit and activates other special buddy powers', () => {
  const evaluate = createGame();
  evaluate(`
    ents.push(chip, visible({ special: 'monolith' }), visible({ special: 'breakpoint' }), visible({ special: 'agent' }));
    hitKillall(chip, 0, group);
  `);
  assert.equal(evaluate('ents.length'), 0);
  assert.equal(evaluate('run.stats.sliced'), 3);
  assert.equal(evaluate('run.stats.legacy'), 1);
  assert.equal(evaluate('run.score'), 30);
  assert.equal(evaluate('run.slowT'), 5);
  assert.equal(evaluate('run.frenzyT'), 5);
});

test('killall includes sliceable buddies that are only partly on screen', () => {
  const evaluate = createGame();
  evaluate(`
    ents.push(chip, visible({ x: -1 }), visible({ x: W + 1 }), visible({ y: TOP - 1 }), visible({ y: H + 1 }));
    hitKillall(chip, 0, group);
  `);
  assert.equal(evaluate('ents.length'), 0);
  assert.equal(evaluate('run.stats.sliced'), 4);
});

for (const mode of ['classic', 'arcade']) {
  test(`${mode}: killall slashes partially entering buddies before their centers cross the viewport`, () => {
    const evaluate = createGame(mode);
    evaluate(`
      const rising = visible({ y: H + 10, vy: -S, g: G, entered: false });
      ents.push(chip, rising);
      updateEnts(0.01);
    `);
    assert.equal(evaluate('rising.entered'), false);
    assert.ok(evaluate('rising.y > H && rising.y - radiusOf(rising) < H'));
    evaluate('cutAlong({ grp: group }, 350, 300, 450, 300);');
    assert.equal(evaluate('ents.includes(rising)'), false);
    assert.equal(evaluate('run.stats.sliced'), 1);
    assert.equal(evaluate('run.score'), 10);
    assert.equal(evaluate('group.n'), 1);
  });
}

test('ordinary monolith swipes still require repeated hits', () => {
  const evaluate = createGame();
  evaluate("const mono = visible({ special: 'monolith' }); ents.push(mono); sliceBuddy(mono, 0, group);");
  assert.equal(evaluate('mono.hits'), 1);
  assert.equal(evaluate('ents.includes(mono)'), true);
  assert.equal(evaluate('run.stats.sliced'), 0);
});

test('empty killall activation grants no free points and is ignored outside play', () => {
  const evaluate = createGame();
  evaluate('ents.push(chip); state = "paused"; hitKillall(chip, 0, group);');
  assert.equal(evaluate('ents.includes(chip)'), true);
  evaluate('state = "play"; hitKillall(chip, 0, group);');
  assert.equal(evaluate('ents.length'), 0);
  assert.equal(evaluate('run.score'), 0);
  assert.equal(evaluate('group.n'), 0);
});

test('missing killall does not cost a Classic CI check', () => {
  const evaluate = createGame();
  evaluate('chip.y = H + S * 2; chip.vy = 1; ents.push(chip); run.waveT = 10; updateGame(0, 0);');
  assert.equal(evaluate('ents.length'), 0);
  assert.equal(evaluate('run.strikes'), 0);
});

for (const mode of ['classic', 'arcade']) {
  test(`${mode}: rare wave respects warm-up, cooldown, and special exclusions`, () => {
    const evaluate = createGame(mode);
    evaluate('Math.random = () => 0.999999; run.time = 19; spawnWave();');
    assert.equal(evaluate('ents.some((e) => e.type === "killall")'), false);
    evaluate('ents.length = 0; run.time = 20; spawnWave();');
    assert.equal(evaluate('ents.filter((e) => e.type === "killall").length'), 1);
    assert.equal(evaluate('ents.filter((e) => e.type === "buddy").length'), 3);
    assert.equal(evaluate('run.nextKillall'), 40);
    evaluate('ents.length = 0; run.time = 39; spawnWave();');
    assert.equal(evaluate('ents.some((e) => e.type === "killall")'), false);
    for (const active of ['run.slowT = 1', 'run.frenzyT = 1', 'ents.push(visible({ special: "agent" }))']) {
      evaluate(`ents.length = 0; run.time = 40; run.slowT = run.frenzyT = 0; ${active}; spawnWave();`);
      assert.equal(evaluate('ents.some((e) => e.type === "killall")'), false);
    }
    evaluate('ents.length = 0; run.slowT = run.frenzyT = 0; spawnWave();');
    assert.equal(evaluate('ents.some((e) => e.type === "killall")'), true);
  });
}
