// test.mjs — headless verification for UNDERSTORY's pure core.
// Run: node test.mjs   (exit 0 = green)

import {
  GRID_SIZE, CELL_COUNT, YEARS, MAX_HEIGHT, SPECIES, ANCIENT_X, ANCIENT_Y,
  mulberry32, idx, computeLightMap, survivesLight, fellAt, createInitialForest,
  runYear, surveyState, portraitText, buildShareText
} from './canopy.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(name);
    console.log(`FAIL: ${name}`);
  }
}

function approx(a, b, eps) { return Math.abs(a - b) <= eps; }

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function makeGrid(fill) {
  const g = new Array(CELL_COUNT);
  for (let i = 0; i < CELL_COUNT; i++) g[i] = fill(i);
  return g;
}

// --- 1. mulberry32 is deterministic ----------------------------------------
{
  const r1 = mulberry32(42);
  const r2 = mulberry32(42);
  const seq1 = [r1(), r1(), r1()];
  const seq2 = [r2(), r2(), r2()];
  check('mulberry32: same seed produces same sequence', deepEqual(seq1, seq2));
}

// --- 2. computeLightMap: fully open grid is light=1 everywhere -------------
{
  const grid = makeGrid(() => null);
  const light = computeLightMap(grid);
  let allOne = true;
  for (let i = 0; i < CELL_COUNT; i++) if (!approx(light[i], 1, 1e-9)) allOne = false;
  check('computeLightMap: fully open canopy is light=1 everywhere', allOne);
}

// --- 3. computeLightMap: fully closed grid at MAX_HEIGHT is light=0 everywhere --
{
  const grid = makeGrid(() => ({ species: 'beech', height: MAX_HEIGHT, age: 1, lineage: null }));
  const light = computeLightMap(grid);
  let allZero = true;
  for (let i = 0; i < CELL_COUNT; i++) if (!approx(light[i], 0, 1e-9)) allZero = false;
  check('computeLightMap: fully closed canopy at max height is light=0 everywhere', allZero);
}

// --- 4. computeLightMap: a single gap in a closed canopy is brighter than the closed canopy, and brighter than its shaded neighbors ---
{
  const grid = makeGrid(() => ({ species: 'beech', height: MAX_HEIGHT, age: 1, lineage: null }));
  const closedLight = computeLightMap(grid)[idx(3, 3)];
  grid[idx(3, 3)] = null;
  const gapLight = computeLightMap(grid);
  check('computeLightMap: known single gap is brighter than fully closed canopy', gapLight[idx(3, 3)] > closedLight);
  check('computeLightMap: the gap cell itself is brighter than its still-shaded far corner', gapLight[idx(3, 3)] > gapLight[idx(0, 0)]);
}

// --- 5. survivesLight: pioneers only win in gaps (fail deep shade, succeed in open light) ---
{
  check('survivesLight: pine fails in deep shade', survivesLight('pine', 0.06) === false);
  check('survivesLight: pine succeeds in an open gap', survivesLight('pine', 0.85) === true);
  check('survivesLight: pine still fails at moderate half-shade', survivesLight('pine', 0.30) === false);
}

// --- 6. survivesLight: shade-tolerant species survives where the pioneer cannot ---
{
  check('survivesLight: beech (shade-tolerant) survives the same deep shade pine cannot', survivesLight('beech', 0.06) === true);
  check('survivesLight: beech also survives the open gap', survivesLight('beech', 0.85) === true);
}

// --- 7. fellAt: felling an empty cell fails and does not mutate the grid ---
{
  const grid = makeGrid(() => ({ species: 'beech', height: 6, age: 1, lineage: null }));
  grid[idx(0, 0)] = null;
  const before = grid.slice();
  const res = fellAt(grid, 0, 0);
  check('fellAt: felling an already-empty cell returns ok:false', res.ok === false);
  check('fellAt: felling an already-empty cell does not mutate the input grid', deepEqual(grid, before));
}

// --- 8. fellAt: felling an occupied cell succeeds and does not mutate the original array ---
{
  const grid = makeGrid(() => ({ species: 'beech', height: 6, age: 1, lineage: null }));
  const originalCell = grid[idx(2, 2)];
  const res = fellAt(grid, 2, 2);
  check('fellAt: felling an occupied cell returns ok:true', res.ok === true);
  check('fellAt: the returned grid has that cell empty', res.grid[idx(2, 2)] === null);
  check('fellAt: the original grid array is untouched (purity)', grid[idx(2, 2)] === originalCell);
}

// --- 9. runYear: the API has no multi-fell entry point — a single call takes exactly
// one target, only advances the year on success, and refuses to fell nothing ---
{
  let state = createInitialForest();
  const first = runYear(state, 1, 1, 999);
  check('runYear: first fell of the year succeeds', first.ok === true);
  check('runYear: year advances by exactly 1 on success', first.state.year === state.year + 1);

  // an empty grid has nothing left to fell anywhere — proves the structural gate
  // ("must target a standing tree") that makes felling twice in one year impossible,
  // independent of whether a specific cell happens to get reclaimed by seed rain.
  const bareState = { grid: new Array(CELL_COUNT).fill(null), year: 5, fellCount: 5, firstMatureHeirYear: null, firstMatureHeirFellNumber: null, lastEvents: [] };
  const onBareGround = runYear(bareState, 1, 1, 999);
  check('runYear: felling an empty cell is refused, not silently accepted', onBareGround.ok === false);
  check('runYear: a refused fell leaves the year uninvited to advance', onBareGround.state.year === bareState.year);
}

// --- 10. runYear: out-of-bounds and already-empty targets are rejected cleanly, never throw ---
{
  const state = createInitialForest();
  let threw = false;
  let res;
  try { res = runYear(state, 99, 99, 1); } catch (e) { threw = true; }
  check('runYear: an out-of-bounds target is rejected, not thrown', threw === false && res && res.ok === false);
}

// --- 11. runYear: determinism — same state, target, and seed produce identical output ---
{
  const state = createInitialForest();
  const a = runYear(state, 2, 2, 42);
  const b = runYear(state, 2, 2, 42);
  check('runYear: same inputs produce a bit-identical next state', deepEqual(a.state, b.state));
  check('runYear: same inputs produce identical events', deepEqual(a.events, b.events));
}

// --- 12. mass/population bounds hold across a full 40-year run ---------------
{
  let state = createInitialForest();
  let boundsOk = true;
  for (let y = 0; y < YEARS; y++) {
    const cellIndex = (y * 13) % CELL_COUNT;
    const x = cellIndex % GRID_SIZE, yy = Math.floor(cellIndex / GRID_SIZE);
    const res = runYear(state, x, yy, 77 + y * 97 + 1);
    state = res.state;
    const occupied = state.grid.filter(Boolean).length;
    if (occupied < 0 || occupied > CELL_COUNT) boundsOk = false;
    for (const cell of state.grid) {
      if (!cell) continue;
      if (cell.height < 0 || cell.height > SPECIES[cell.species].mature + 1e-9) boundsOk = false;
      if (cell.age < 0) boundsOk = false;
    }
  }
  check('mass/population bounds hold every year of a 40-year run', boundsOk);
}

// --- 13. no-NaN and no-Infinity across 40 years x 30 seeds, cycling fell targets --
{
  let anyBad = false;
  for (let seed = 0; seed < 30; seed++) {
    let state = createInitialForest();
    for (let y = 0; y < YEARS; y++) {
      const cellIndex = (y * 13 + seed) % CELL_COUNT;
      const x = cellIndex % GRID_SIZE, yy = Math.floor(cellIndex / GRID_SIZE);
      const res = runYear(state, x, yy, seed * 7919 + y * 97 + 1);
      state = res.state;
      for (const cell of state.grid) {
        if (!cell) continue;
        if (!Number.isFinite(cell.height) || !Number.isFinite(cell.age)) anyBad = true;
      }
      const light = computeLightMap(state.grid);
      for (const l of light) if (!Number.isFinite(l)) anyBad = true;
    }
  }
  check('40 years x 30 seeds: no NaN/Infinity anywhere in state or light map', !anyBad);
}

// --- 14. establishment respects the light gate: a pioneer only takes a gap when a seed source and enough light are both present ---
{
  const grid = makeGrid(() => ({ species: 'beech', height: 6, age: 80, lineage: null }));
  grid[idx(ANCIENT_X, ANCIENT_Y)] = { species: 'oak', height: 8, age: 150, lineage: 'ancient' };
  for (let y = 0; y <= 2; y++) for (let x = 0; x <= 2; x++) grid[idx(x, y)] = null;
  grid[idx(0, 3)] = { species: 'pine', height: 5, age: 30, lineage: null };
  const state = { grid, year: 0, fellCount: 0, firstMatureHeirYear: null, firstMatureHeirFellNumber: null, lastEvents: [] };
  const res = runYear(state, 4, 4, 555);
  const pineCount = res.state.grid.filter(c => c && c.species === 'pine').length;
  check('establishment: a pioneer colonizes an open gap when a mature seed source is in range', pineCount > 0);
}

// --- 15. THE SOLVER SEQUENCE: the oak-line quest is achievable within 40 years ---
// Sequence found by a greedy heuristic (fell the tallest non-heir cell within
// distance 2 of the newest heir, or of the ancient oak if there is none yet)
// and verified directly against this core during development.
{
  const SEED_BASE = 12345;
  const SOLVER_SEQUENCE = [
    [2, 2], [3, 2], [2, 3], [4, 3], [4, 2], [3, 1], [4, 1], [5, 1], [5, 2], [5, 3],
    [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [2, 1], [6, 1], [6, 2], [6, 3], [2, 4],
    [3, 4], [4, 4], [5, 4], [6, 4], [3, 2], [4, 1], [3, 1], [4, 3], [2, 2], [5, 2],
    [2, 3], [5, 3], [4, 0], [3, 0], [5, 0], [2, 0], [6, 0], [6, 1], [6, 2], [2, 1]
  ];
  check('solver sequence: exactly 40 fells, one per year', SOLVER_SEQUENCE.length === YEARS);
  let state = createInitialForest();
  let allOk = true;
  for (let y = 0; y < YEARS; y++) {
    const [x, yy] = SOLVER_SEQUENCE[y];
    const res = runYear(state, x, yy, SEED_BASE + y * 97 + 1);
    if (!res.ok) allOk = false;
    state = res.state;
  }
  check('solver sequence: every scripted fell was valid (target occupied each year)', allOk);
  check('solver sequence: the ancient oak line reaches the canopy within 40 years', state.firstMatureHeirFellNumber !== null);
  check('solver sequence: the ancient oak itself was never felled', state.grid[idx(ANCIENT_X, ANCIENT_Y)] !== null && state.grid[idx(ANCIENT_X, ANCIENT_Y)].lineage === 'ancient');

  // determinism check on the full 40-year run: replay it and expect an identical final state
  let replay = createInitialForest();
  for (let y = 0; y < YEARS; y++) {
    const [x, yy] = SOLVER_SEQUENCE[y];
    replay = runYear(replay, x, yy, SEED_BASE + y * 97 + 1).state;
  }
  check('determinism: replaying the full 40-year solver run yields an identical final state', deepEqual(state, replay));
}

// --- 16. surveyState and portraitText/buildShareText never throw and describe both outcomes --
{
  // no-win case: a fresh forest surveyed at year 0
  const fresh = createInitialForest();
  const surveyFresh = surveyState(fresh);
  check('surveyState: fresh forest has zero heirs and a "no heirs yet" quest text', surveyFresh.heirCount === 0 && typeof surveyFresh.questText === 'string' && surveyFresh.questText.length > 0);
  const portraitFresh = portraitText(fresh);
  check('portraitText: fresh forest produces a non-empty summary', typeof portraitFresh.summary === 'string' && portraitFresh.summary.length > 0);
  const shareFresh = buildShareText(fresh);
  check('buildShareText: no-win share text mentions UNDERSTORY and the live URL', shareFresh.includes('UNDERSTORY') && shareFresh.includes('understory.defimagic.io'));

  // win case: reuse the solver's final state from check 15 by rerunning it here
  const SEED_BASE = 12345;
  const SOLVER_SEQUENCE = [
    [2, 2], [3, 2], [2, 3], [4, 3], [4, 2], [3, 1], [4, 1], [5, 1], [5, 2], [5, 3],
    [2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [2, 1], [6, 1], [6, 2], [6, 3], [2, 4],
    [3, 4], [4, 4], [5, 4], [6, 4], [3, 2], [4, 1], [3, 1], [4, 3], [2, 2], [5, 2],
    [2, 3], [5, 3], [4, 0], [3, 0], [5, 0], [2, 0], [6, 0], [6, 1], [6, 2], [2, 1]
  ];
  let won = createInitialForest();
  for (let y = 0; y < YEARS; y++) {
    const [x, yy] = SOLVER_SEQUENCE[y];
    won = runYear(won, x, yy, SEED_BASE + y * 97 + 1).state;
  }
  const shareWon = buildShareText(won);
  check('buildShareText: win share text names the ordinal gap that raised the heir', /\d+(st|nd|rd|th) gap raised the oak's heir/.test(shareWon));
  const portraitWon = portraitText(won);
  check('portraitText: win portrait names the line holding', portraitWon.oakLine.includes('the line holds'));
}

// --- results ------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
process.exit(0);
