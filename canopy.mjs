// canopy.mjs — the pure core of UNDERSTORY.
// Every rule, generator, and scorer lives here as pure exported functions.
// No DOM, no WebAudio, no Date.now(), no Math.random() inside any logic path.
// Time and chance always arrive as an injected seed (mulberry32 pattern).

export const GRID_SIZE = 7;                 // 7x7 = 49 cells
export const CELL_COUNT = GRID_SIZE * GRID_SIZE;
export const YEARS = 40;                    // one fell per year, 40 years total
export const MAX_HEIGHT = 9;                // normalizes light calc — tallest mature height (oak)
export const SAPLING_HEIGHT = 2.5;          // below this, a tree is a seedling subject to light mortality
export const LIGHT_RADIUS = 2;              // Chebyshev radius sampled for the light map
export const REPRO_FRACTION = 0.55;         // fraction of mature height needed to cast seed
export const HEIR_MATURE_FRACTION = 0.75;   // fraction of oak.mature that counts as "reached the canopy"
export const ANCIENT_X = 3;
export const ANCIENT_Y = 3;

export const SPECIES = {
  beech:   { mature: 6.5, growthRate: 0.30, lightTolerance: 0.05, seedRange: 2, lifespan: 180, pioneer: false, shrub: false, label: 'beech' },
  oak:     { mature: 9.0, growthRate: 0.34, lightTolerance: 0.22, seedRange: 2, lifespan: 220, pioneer: false, shrub: false, label: 'oak' },
  pine:    { mature: 5.0, growthRate: 0.85, lightTolerance: 0.55, seedRange: 3, lifespan: 60,  pioneer: true,  shrub: false, label: 'pine' },
  birch:   { mature: 4.5, growthRate: 0.75, lightTolerance: 0.50, seedRange: 3, lifespan: 50,  pioneer: true,  shrub: false, label: 'birch' },
  bramble: { mature: 1.6, growthRate: 0.90, lightTolerance: 0.30, seedRange: 2, lifespan: 9,   pioneer: true,  shrub: true,  label: 'bramble' }
};

export const SPECIES_ORDER = ['beech', 'oak', 'pine', 'birch', 'bramble'];

// --- deterministic PRNG -----------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- grid addressing ----------------------------------------------------

export function idx(x, y) { return y * GRID_SIZE + x; }
export function inBounds(x, y) { return x >= 0 && x < GRID_SIZE && y >= 0 && y < GRID_SIZE; }

// --- initial forest: fixed, deterministic, no randomness -----------------
// A closed old-growth canopy of beech, with one marked ancient oak at center.

export function createInitialForest() {
  const grid = new Array(CELL_COUNT);
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      grid[idx(x, y)] = { species: 'beech', height: 6, age: 80, lineage: null, plantedYear: -80 };
    }
  }
  grid[idx(ANCIENT_X, ANCIENT_Y)] = { species: 'oak', height: 8, age: 150, lineage: 'ancient', plantedYear: -150 };
  return {
    grid,
    year: 0,
    fellCount: 0,
    firstMatureHeirYear: null,
    firstMatureHeirFellNumber: null,
    lastEvents: []
  };
}

// --- light -----------------------------------------------------------------

// Pure function of the grid alone. Returns a Float64Array of length CELL_COUNT,
// each value in [0,1] — 1 is bare-floor open sky, 0 is a fully closed canopy.
export function computeLightMap(grid) {
  const light = new Float64Array(CELL_COUNT);
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      let shadeSum = 0;
      let totalWeight = 0;
      for (let dy = -LIGHT_RADIUS; dy <= LIGHT_RADIUS; dy++) {
        for (let dx = -LIGHT_RADIUS; dx <= LIGHT_RADIUS; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d > LIGHT_RADIUS) continue;
          const nx = x + dx, ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const w = 1 / (d + 1);
          const cell = grid[idx(nx, ny)];
          const h = cell ? cell.height : 0;
          shadeSum += w * (h / MAX_HEIGHT);
          totalWeight += w;
        }
      }
      const shade = totalWeight > 0 ? shadeSum / totalWeight : 0;
      light[idx(x, y)] = Math.min(1, Math.max(0, 1 - shade));
    }
  }
  return light;
}

// Pure helper: does a sapling of this species survive at this light level?
export function survivesLight(speciesKey, light) {
  const sp = SPECIES[speciesKey];
  return light >= sp.lightTolerance;
}

function lightFactor(light) {
  return Math.min(1.15, Math.max(0.15, light + 0.15));
}

// --- felling -----------------------------------------------------------------

// Pure: returns { ok, grid } — never mutates the input array.
export function fellAt(grid, x, y) {
  if (!inBounds(x, y)) return { ok: false, grid };
  const cell = grid[idx(x, y)];
  if (!cell) return { ok: false, grid };
  const next = grid.slice();
  next[idx(x, y)] = null;
  return { ok: true, grid: next };
}

// --- one year --------------------------------------------------------------

export function runYear(state, targetX, targetY, seed) {
  if (state.year >= YEARS) {
    return { ok: false, state, events: ['the survey is already complete'] };
  }
  const felled = fellAt(state.grid, targetX, targetY);
  if (!felled.ok) {
    return { ok: false, state, events: ['there is nothing standing there to fell'] };
  }
  const felledSpecies = state.grid[idx(targetX, targetY)].species;
  let grid = felled.grid;
  const events = [`the ${felledSpecies} at (${targetX},${targetY}) comes down — light pours into the gap`];

  // pass 1: sapling mortality by light, evaluated against the post-fell canopy
  let light = computeLightMap(grid);
  const afterMortality = grid.slice();
  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = afterMortality[i];
    if (!cell) continue;
    if (cell.height < SAPLING_HEIGHT && !survivesLight(cell.species, light[i])) {
      afterMortality[i] = null;
      events.push(`a ${cell.species} seedling gives out for lack of light`);
    }
  }
  grid = afterMortality;

  // recompute light once against the post-mortality canopy; this is the light
  // value used for BOTH this year's growth and this year's establishment.
  light = computeLightMap(grid);

  // pass 2: age + growth for survivors
  const afterGrowth = grid.slice();
  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = afterGrowth[i];
    if (!cell) continue;
    const sp = SPECIES[cell.species];
    const nextAge = cell.age + 1;
    if (nextAge > sp.lifespan) {
      afterGrowth[i] = null;
      events.push(`an old ${cell.species} completes its span and falls`);
      continue;
    }
    const grown = Math.min(sp.mature, cell.height + sp.growthRate * lightFactor(light[i]));
    afterGrowth[i] = { ...cell, age: nextAge, height: grown };
  }
  grid = afterGrowth;

  // pass 3: establishment on cells left empty
  const rng = mulberry32(seed >>> 0);
  const afterEstablish = grid.slice();
  let newHeirThisYear = false;
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      const here = idx(x, y);
      if (afterEstablish[here]) continue;
      const hereLight = light[here];

      // gather seed weight per species from mature parents within seedRange
      const weights = {};
      const nearestOakParent = { dist: Infinity, lineage: null };
      let hasBrambleNeighbor = false;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const nx = x + dx, ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          if (dx === 0 && dy === 0) continue;
          const parent = grid[idx(nx, ny)];
          if (!parent) continue;
          const dist = Math.max(Math.abs(dx), Math.abs(dy));
          if (dist <= 1 && parent.species === 'bramble') hasBrambleNeighbor = true;
          const sp = SPECIES[parent.species];
          if (dist > sp.seedRange) continue;
          if (parent.height < REPRO_FRACTION * sp.mature) continue;
          const w = 1 / (dist + 1);
          weights[parent.species] = (weights[parent.species] || 0) + w;
          if (parent.species === 'oak' && dist < nearestOakParent.dist) {
            nearestOakParent.dist = dist;
            nearestOakParent.lineage = parent.lineage;
          }
        }
      }

      // filter to species that could actually survive this light level here
      const candidates = [];
      for (const key of SPECIES_ORDER) {
        if (!weights[key]) continue;
        if (!survivesLight(key, hereLight)) continue;
        let w = weights[key];
        if (hasBrambleNeighbor && (key === 'oak' || key === 'beech')) w *= 1.5;
        candidates.push([key, w]);
      }
      if (candidates.length === 0) continue;

      const total = candidates.reduce((s, [, w]) => s + w, 0);
      let r = rng() * total;
      let chosen = candidates[candidates.length - 1][0];
      for (const [key, w] of candidates) {
        if (r < w) { chosen = key; break; }
        r -= w;
      }

      let lineage = null;
      if (chosen === 'oak') lineage = (nearestOakParent.lineage === 'ancient' || nearestOakParent.lineage === 'heir') ? 'heir' : null;

      afterEstablish[here] = { species: chosen, height: 0.3, age: 0, lineage, plantedYear: state.year + 1 };
      if (lineage === 'heir') events.push('a new heir of the ancient oak takes root');
    }
  }
  grid = afterEstablish;

  // detect a heir crossing into the canopy this year
  const heirThreshold = HEIR_MATURE_FRACTION * SPECIES.oak.mature;
  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = grid[i];
    if (cell && cell.species === 'oak' && cell.lineage === 'heir' && cell.height >= heirThreshold) {
      const prevCell = state.grid[i];
      const wasAlreadyMature = prevCell && prevCell.species === 'oak' && prevCell.lineage === 'heir' && prevCell.height >= heirThreshold;
      if (!wasAlreadyMature) newHeirThisYear = true;
    }
  }

  const nextYear = state.year + 1;
  const nextFellCount = state.fellCount + 1;
  const nextState = {
    grid,
    year: nextYear,
    fellCount: nextFellCount,
    firstMatureHeirYear: state.firstMatureHeirYear,
    firstMatureHeirFellNumber: state.firstMatureHeirFellNumber,
    lastEvents: events
  };
  if (newHeirThisYear && nextState.firstMatureHeirFellNumber === null) {
    nextState.firstMatureHeirYear = nextYear;
    nextState.firstMatureHeirFellNumber = nextFellCount;
    events.push('an heir of the ancient oak reaches the canopy — the line holds');
  }

  return { ok: true, state: nextState, events };
}

// --- survey: what the keeper sees before choosing the fell ------------------

export function surveyState(state) {
  const light = computeLightMap(state.grid);
  const counts = { beech: 0, oak: 0, pine: 0, birch: 0, bramble: 0, empty: 0 };
  let heirCount = 0;
  let matureHeirCount = 0;
  let rivalTallCount = 0;
  let openGapWithoutBramble = false;
  const ancientIdx = idx(ANCIENT_X, ANCIENT_Y);
  for (let i = 0; i < CELL_COUNT; i++) {
    const cell = state.grid[i];
    if (!cell) {
      counts.empty++;
      if (light[i] > 0.6) {
        let brambleNear = false;
        const x = i % GRID_SIZE, y = Math.floor(i / GRID_SIZE);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (inBounds(nx, ny) && state.grid[idx(nx, ny)] && state.grid[idx(nx, ny)].species === 'bramble') brambleNear = true;
        }
        if (!brambleNear) openGapWithoutBramble = true;
      }
      continue;
    }
    counts[cell.species]++;
    if (cell.species === 'oak' && cell.lineage === 'heir') {
      heirCount++;
      if (cell.height >= HEIR_MATURE_FRACTION * SPECIES.oak.mature) matureHeirCount++;
    }
    const isRivalCanopy = cell.height >= SAPLING_HEIGHT && cell.lineage !== 'ancient' && cell.lineage !== 'heir' && i !== ancientIdx;
    if (isRivalCanopy) rivalTallCount++;
  }

  let questText;
  if (state.firstMatureHeirFellNumber !== null) {
    questText = 'the oak\'s line has already reached the canopy — the forest is yours to keep shaping.';
  } else if (heirCount > 0) {
    questText = `${heirCount} heir${heirCount === 1 ? '' : 's'} of the ancient oak stand${heirCount === 1 ? 's' : ''} in the understory, reaching. give one more years of open sky.`;
  } else {
    questText = 'the ancient oak has no heirs yet. open a gap where its seed can fall and find light.';
  }

  const deerText = openGapWithoutBramble
    ? 'deer have found the open floor — they graze wherever nothing thorny stands guard.'
    : null;

  return { light, counts, heirCount, matureHeirCount, rivalTallCount, questText, deerText };
}

// --- ending -----------------------------------------------------------------

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function portraitText(state) {
  const s = surveyState(state);
  const parts = [];
  if (s.counts.oak > 0) parts.push(`${s.counts.oak} oak${s.counts.oak === 1 ? '' : 's'}`);
  if (s.counts.beech > 0) parts.push(`${s.counts.beech} beech`);
  if (s.counts.pine > 0) parts.push(`${s.counts.pine} pine${s.counts.pine === 1 ? '' : 's'}`);
  if (s.counts.birch > 0) parts.push(`${s.counts.birch} birch`);
  if (s.counts.bramble > 0) parts.push(`${s.counts.bramble} bramble${s.counts.bramble === 1 ? '' : 'es'}`);
  const composition = parts.length ? parts.join(', ') : 'bare ground';

  let oakLine;
  if (state.firstMatureHeirFellNumber !== null) {
    oakLine = `your ${ordinal(state.firstMatureHeirFellNumber)} gap raised an heir of the ancient oak into the canopy, in year ${state.firstMatureHeirYear}. the line holds.`;
  } else if (s.heirCount > 0) {
    oakLine = `${s.heirCount} heir${s.heirCount === 1 ? '' : 's'} of the ancient oak grew, but none reached the canopy in forty years. the old oak stood alone at the end.`;
  } else {
    oakLine = 'no heir of the ancient oak ever took root. its line ends with it.';
  }

  return {
    composition,
    oakLine,
    summary: `Forty years, forty gaps. The forest became: ${composition}. ${oakLine}`
  };
}

export function buildShareText(state) {
  if (state.firstMatureHeirFellNumber !== null) {
    return `\u{1F332} UNDERSTORY · year ${state.year} · my ${ordinal(state.firstMatureHeirFellNumber)} gap raised the oak's heir · http://understory.defimagic.io`;
  }
  return `\u{1F332} UNDERSTORY · year ${state.year} · the canopy kept its shape, the old oak stood alone · http://understory.defimagic.io`;
}
