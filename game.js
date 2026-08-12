// game.js — DOM, input, and rendering for UNDERSTORY.
// All rules live in canopy.mjs; this file only draws, listens, and calls in.

import * as canopy from './canopy.mjs';

const STORAGE_KEY = 'understory_v1';

const SPECIES_HINT = {
  beech: 'a shade-tolerant elder of the closed canopy. it will hold its ground in the dark for a very long time.',
  oak: 'a rival oak, not of the ancient line. tall and patient, but not the one you are raising.',
  pine: 'a light-loving pioneer. it rushed into an open gap and will not outlive it by much.',
  birch: 'a fast, light-hungry colonizer. thin-barked, quick to rise, quick to fall.',
  bramble: 'a thorny shrub. it shelters young shade-tolerant seedlings from browsing, for a few years.'
};

// --- state ------------------------------------------------------------------

const state = {
  screen: 'title',
  forest: canopy.createInitialForest(),
  baseSeed: Math.floor(Math.random() * 1e9),
  seenHowTo: false,
  selected: null,        // { x, y } of the tapped, not-yet-confirmed tree
  lastEventsShown: []
};

function yearSeed() {
  return state.baseSeed + state.forest.year * 97 + 1;
}

// --- persistence --------------------------------------------------------------

function save() {
  try {
    const payload = { v: 1, forest: state.forest, baseSeed: state.baseSeed, seenHowTo: state.seenHowTo };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) { /* storage unavailable — play on without saving */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const payload = JSON.parse(raw);
    if (payload && payload.v === 1 && payload.forest && Array.isArray(payload.forest.grid) && payload.forest.grid.length === canopy.CELL_COUNT) {
      state.forest = payload.forest;
      state.baseSeed = typeof payload.baseSeed === 'number' ? payload.baseSeed : state.baseSeed;
      state.seenHowTo = !!payload.seenHowTo;
    }
  } catch (e) { /* corrupt or unavailable — start fresh */ }
}

function clearSave() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
}

// --- screens --------------------------------------------------------------

const screens = {};
document.querySelectorAll('[data-screen]').forEach(el => {
  screens[el.getAttribute('data-screen')] = el;
});

function showScreen(name) {
  state.screen = name;
  for (const key in screens) screens[key].classList.toggle('active', key === name);
  if (name === 'play') renderPlay();
  if (name === 'final') renderFinal();
}

// --- play screen: grid rendering --------------------------------------------

const gridEl = document.getElementById('forestGrid');
const cellEls = [];
for (let i = 0; i < canopy.CELL_COUNT; i++) {
  const cell = document.createElement('button');
  cell.className = 'cell';
  cell.type = 'button';
  const plant = document.createElement('div');
  plant.className = 'plant';
  cell.appendChild(plant);
  const x = i % canopy.GRID_SIZE, y = Math.floor(i / canopy.GRID_SIZE);
  cell.addEventListener('click', () => onCellTap(x, y));
  gridEl.appendChild(cell);
  cellEls.push({ cell, plant });
}

function renderGrid() {
  const light = canopy.computeLightMap(state.forest.grid);
  for (let i = 0; i < canopy.CELL_COUNT; i++) {
    const { cell, plant } = cellEls[i];
    const occupant = state.forest.grid[i];
    cell.classList.remove('light-high', 'light-mid');
    if (!occupant) {
      if (light[i] > 0.6) cell.classList.add('light-high');
      else if (light[i] > 0.3) cell.classList.add('light-mid');
      plant.style.width = '0';
      plant.style.height = '0';
      plant.className = 'plant';
    } else {
      const sp = canopy.SPECIES[occupant.species];
      const frac = Math.max(0.12, occupant.height / sp.mature);
      const sizePct = Math.round(30 + frac * 62);
      plant.style.width = sizePct + '%';
      plant.style.height = sizePct + '%';
      plant.className = 'plant sp-' + occupant.species;
      if (occupant.species === 'oak' && occupant.lineage) plant.classList.add('lineage-' + occupant.lineage);
    }
    const x = i % canopy.GRID_SIZE, y = Math.floor(i / canopy.GRID_SIZE);
    cell.classList.toggle('selected', !!state.selected && state.selected.x === x && state.selected.y === y);
  }
}

function renderPlay() {
  document.getElementById('yearLabel').textContent = `Year ${state.forest.year} of ${canopy.YEARS}`;
  const survey = canopy.surveyState(state.forest);
  document.getElementById('questText').textContent = survey.questText;
  document.getElementById('deerText').textContent = survey.deerText || '';
  renderGrid();
}

// --- fell confirmation panel --------------------------------------------------

const selectedPanel = document.getElementById('selectedPanel');
const eventsPanel = document.getElementById('eventsPanel');

function onCellTap(x, y) {
  if (state.screen !== 'play') return;
  if (eventsPanel.classList.contains('open')) return; // must dismiss this year's events first
  const occupant = state.forest.grid[canopy.idx(x, y)];
  if (!occupant) {
    state.selected = null;
    selectedPanel.classList.remove('open');
    document.getElementById('fellLabel').textContent = 'already open to the sky';
    renderGrid();
    return;
  }
  state.selected = { x, y };
  document.getElementById('fellLabel').textContent = 'tap a tree to fell it';
  const isAncient = occupant.lineage === 'ancient';
  const isHeir = occupant.lineage === 'heir';
  document.getElementById('selectedTitle').textContent = isAncient ? 'the ancient oak itself' : isHeir ? `an heir of the ancient oak (${occupant.species})` : occupant.species;
  let hint = SPECIES_HINT[occupant.species] || '';
  if (isAncient) hint = 'this is the ancient oak. its whole line ends here if it falls, unless an heir of its own already stands elsewhere.';
  if (isHeir) hint = 'this seedling descends from the ancient oak. felling it ends its climb to the canopy.';
  document.getElementById('selectedBody').textContent = hint;
  selectedPanel.classList.add('open');
  renderGrid();
}

document.getElementById('fellCancelBtn').addEventListener('click', () => {
  state.selected = null;
  selectedPanel.classList.remove('open');
  renderGrid();
});

document.getElementById('fellConfirmBtn').addEventListener('click', () => {
  if (!state.selected) return;
  const { x, y } = state.selected;
  const seed = yearSeed();
  const res = canopy.runYear(state.forest, x, y, seed);
  if (!res.ok) {
    // nothing standing there anymore (shouldn't happen from the UI path) — just close quietly
    state.selected = null;
    selectedPanel.classList.remove('open');
    renderGrid();
    return;
  }
  state.forest = res.state;
  state.selected = null;
  selectedPanel.classList.remove('open');
  state.lastEventsShown = res.events;
  save();

  document.getElementById('eventsTitle').textContent = `Year ${state.forest.year} settles in`;
  const list = document.getElementById('eventsList');
  list.innerHTML = '';
  for (const ev of res.events) {
    const li = document.createElement('li');
    li.textContent = ev;
    list.appendChild(li);
  }
  eventsPanel.classList.add('open');
  renderGrid();
});

document.getElementById('eventsContinueBtn').addEventListener('click', () => {
  eventsPanel.classList.remove('open');
  if (state.forest.year >= canopy.YEARS) {
    showScreen('final');
  } else {
    renderPlay();
  }
});

// --- title / howto ------------------------------------------------------------

document.getElementById('startBtn').addEventListener('click', () => {
  if (state.forest.year >= canopy.YEARS) { showScreen('final'); return; }
  if (!state.seenHowTo) showScreen('howto');
  else showScreen('play');
});
document.getElementById('howtoBtnFromTitle').addEventListener('click', () => showScreen('howto'));
document.getElementById('howtoBackBtn').addEventListener('click', () => showScreen('title'));
document.getElementById('howtoBeginBtn').addEventListener('click', () => {
  state.seenHowTo = true;
  save();
  showScreen('play');
});

// --- final screen ---------------------------------------------------------------

function renderFinal() {
  const portrait = canopy.portraitText(state.forest);
  document.getElementById('compositionLine').textContent = `The forest became: ${portrait.composition}.`;
  const oakLine = portrait.oakLine;
  document.getElementById('oakLineText').textContent = oakLine.charAt(0).toUpperCase() + oakLine.slice(1);
  document.getElementById('shareText').value = canopy.buildShareText(state.forest);
}

document.getElementById('copyShareBtn').addEventListener('click', () => {
  const el = document.getElementById('shareText');
  el.select();
  el.setSelectionRange(0, 99999);
  try {
    navigator.clipboard.writeText(el.value);
    const btn = document.getElementById('copyShareBtn');
    const original = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = original; }, 1400);
  } catch (e) { /* clipboard unavailable — text is selected for manual copy */ }
});

document.getElementById('playAgainBtn').addEventListener('click', () => {
  state.forest = canopy.createInitialForest();
  state.baseSeed = Math.floor(Math.random() * 1e9);
  state.seenHowTo = true;
  state.selected = null;
  clearSave();
  showScreen('play');
});

// --- boot ---------------------------------------------------------------------

load();
showScreen('title');

// --- dev hook: ?dev=1 exposes window.__g for scripted, human-free QA ------------

if (new URLSearchParams(location.search).get('dev') === '1') {
  window.__g = {
    getState() {
      const survey = canopy.surveyState(state.forest);
      return JSON.parse(JSON.stringify({
        screen: state.screen,
        year: state.forest.year,
        fellCount: state.forest.fellCount,
        firstMatureHeirFellNumber: state.forest.firstMatureHeirFellNumber,
        selected: state.selected,
        counts: survey.counts,
        heirCount: survey.heirCount,
        matureHeirCount: survey.matureHeirCount,
        eventsOpen: eventsPanel.classList.contains('open'),
        selectedOpen: selectedPanel.classList.contains('open'),
        lastEvents: state.lastEventsShown
      }));
    },
    goTitle() { showScreen('title'); },
    goHowTo() { showScreen('howto'); },
    goPlay() { state.seenHowTo = true; showScreen('play'); },
    tapCell(x, y) { onCellTap(x, y); },
    confirmFell() { document.getElementById('fellConfirmBtn').click(); },
    cancelFell() { document.getElementById('fellCancelBtn').click(); },
    continueYear() { document.getElementById('eventsContinueBtn').click(); },
    forceScreen(name) { showScreen(name); },
    restart() { document.getElementById('playAgainBtn').click(); }
  };
}
