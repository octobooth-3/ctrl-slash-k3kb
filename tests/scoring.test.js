'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

function createGame(mode, vy, randomValue = 0.99, special = null, frenzy = false) {
  const context = vm.createContext({
    ents: [],
    halves: [],
    flyers: [],
    banners: [],
    BUDDY_PAL: [],
    rand: (min) => min,
    save: { best: { classic: 0, arcade: 0 }, hats: {}, plays: 0 },
    UI: { score() {}, strikes() {}, toast() {}, mult() {}, setMode() {} },
    Sfx: { slice() {}, crit() {}, breakpoint() {} },
    banner() {},
    flash() {},
    popup() {},
    spawnHalves() {},
    gore() {},
    decal() {},
    slashFx() {},
    vibrate() {},
    shake() {},
  });
  vm.runInContext(readFileSync(join(__dirname, '..', 'js', 'game.js'), 'utf8'), context, { filename: 'game.js' });
  vm.runInContext(`
    W = 800; H = 600; G = 900; S = 96; K = 1;
    state = 'play';
    run = {
      mode: '${mode}', score: 0, strikes: 0, nextLife: 1000, mult: 1,
      stats: { sliced: 0, maxCombo: 0, hats: 0, snipes: 0, sets: 0, runways: 0, crits: 0, bombs: 0, missed: 0, legacy: 0 },
    };
    Math.random = () => ${randomValue};
    const buddy = { x: 100, y: 100, vx: 0, vy: ${vy}, scale: 1, type: 'buddy', special: ${special ? `'${special}'` : 'null'}, frenzy: ${frenzy}, hat: null };
    ents.push(buddy);
    sliceBuddy(buddy, 0, null);
  `, context);
  return vm.runInContext('run.score', context);
}

for (const mode of ['classic', 'arcade']) {
  test(`${mode}: a buddy scores 10 while rising and 20 while falling`, () => {
    assert.equal(createGame(mode, -100), 10);
    assert.equal(createGame(mode, 100), 20);
  });

  test(`${mode}: critical and special buddies keep their existing point values`, () => {
    assert.equal(createGame(mode, 100, 0), 60);
    assert.equal(createGame(mode, 100, 0.99, 'breakpoint'), 10);
    assert.equal(createGame(mode, 100, 0.99, null, true), 10);
  });
}
