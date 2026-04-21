/* ── Pokédex App — PokeAPI v2 ── */

const BASE = 'https://pokeapi.co/api/v2';
const TOTAL = 905;     // gens 1-8
const PER_PAGE = 40;

/* ── State ── */
const state = {
  all: [],          // { id, name } flat list after initial load
  filtered: [],     // after search/type/gen filter
  page: 1,
  search: '',
  type: 'all',
  gen: 'all',
  sort: 'id',
  cache: new Map(),  // url → data
};

/* ── Generation ranges ── */
const GEN_RANGES = {
  '1': [1, 151], '2': [152, 251], '3': [252, 386],
  '4': [387, 493], '5': [494, 649], '6': [650, 721],
  '7': [722, 809], '8': [810, 905],
};

/* ── DOM refs ── */
const grid        = document.getElementById('pokemon-grid');
const loader      = document.getElementById('loader');
const emptyState  = document.getElementById('empty-state');
const pagination  = document.getElementById('pagination');
const prevBtn     = document.getElementById('prev-btn');
const nextBtn     = document.getElementById('next-btn');
const pageInfo    = document.getElementById('page-info');
const resultsCount= document.getElementById('results-count');
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');
const typePills   = document.getElementById('type-pills');
const genSelect   = document.getElementById('gen-select');
const sortSelect  = document.getElementById('sort-select');
const modalOverlay= document.getElementById('modal-overlay');
const modalContent= document.getElementById('modal-content');
const modalClose  = document.getElementById('modal-close');

/* ── Fetch helper with cache ── */
async function apiFetch(url) {
  if (state.cache.has(url)) return state.cache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  const data = await res.json();
  state.cache.set(url, data);
  return data;
}

/* ── Type colour for stat bars ── */
const TYPE_COLORS = {
  fire:'#f97316', water:'#3b82f6', grass:'#22c55e', electric:'#eab308',
  psychic:'#ec4899', ice:'#06b6d4', dragon:'#7c3aed', dark:'#374151',
  fairy:'#f9a8d4', normal:'#9ca3af', fighting:'#b45309', flying:'#818cf8',
  poison:'#a855f7', ground:'#d97706', rock:'#78716c', bug:'#84cc16',
  ghost:'#6d28d9', steel:'#94a3b8',
};

/* ──────────────────────────────────────────
   INITIAL LOAD — fetch list of all 905 Pokémon
   ────────────────────────────────────────── */
async function init() {
  showLoader(true);
  try {
    const data = await apiFetch(`${BASE}/pokemon?limit=${TOTAL}&offset=0`);
    state.all = data.results.map((p, i) => ({ id: i + 1, name: p.name, url: p.url }));
    await loadTypes();
    applyFilters();
  } catch (err) {
    console.error(err);
    loader.querySelector('p').textContent = 'Error al cargar. Refresca la página.';
  }
}

/* ── Load all types for pill filter ── */
async function loadTypes() {
  try {
    const data = await apiFetch(`${BASE}/type`);
    const relevant = data.results.filter(t => !['unknown','shadow'].includes(t.name));
    relevant.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'pill';
      btn.dataset.type = t.name;
      btn.textContent = capitalize(t.name);
      btn.addEventListener('click', () => selectType(t.name));
      typePills.appendChild(btn);
    });
  } catch(e) { /* silently skip */ }
}

/* ──────────────────────────────────────────
   FILTERING & SORTING
   ────────────────────────────────────────── */
function applyFilters() {
  let list = [...state.all];

  /* generation */
  if (state.gen !== 'all') {
    const [lo, hi] = GEN_RANGES[state.gen];
    list = list.filter(p => p.id >= lo && p.id <= hi);
  }

  /* search */
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(p =>
      p.name.includes(q) || String(p.id).padStart(4,'0').includes(q) || String(p.id) === q
    );
  }

  /* type filter needs detail data — handled lazily in renderPage */
  state.filtered = list;
  state.page = 1;
  renderPage();
}

function sortList(list) {
  return [...list].sort((a, b) =>
    state.sort === 'name' ? a.name.localeCompare(b.name) : a.id - b.id
  );
}

/* ──────────────────────────────────────────
   RENDER PAGE
   ────────────────────────────────────────── */
async function renderPage() {
  showLoader(true);
  grid.innerHTML = '';
  emptyState.hidden = true;
  pagination.hidden = true;

  let list = sortList(state.filtered);

  /* type filter requires fetching each pokemon — done on current page only */
  if (state.type !== 'all') {
    list = await filterByType(list);
  }

  if (list.length === 0) {
    showLoader(false);
    emptyState.hidden = false;
    resultsCount.textContent = '0 Pokémon encontrados';
    return;
  }

  const totalPages = Math.ceil(list.length / PER_PAGE);
  if (state.page > totalPages) state.page = totalPages;

  const start = (state.page - 1) * PER_PAGE;
  const pageItems = list.slice(start, start + PER_PAGE);

  resultsCount.textContent = `${list.length} Pokémon encontrados`;
  pageInfo.textContent = `Página ${state.page} de ${totalPages}`;
  prevBtn.disabled = state.page === 1;
  nextBtn.disabled = state.page === totalPages;

  /* fetch details for current page in parallel */
  const details = await Promise.all(pageItems.map(p => fetchPokemon(p.id)));

  details.forEach(poke => {
    if (poke) grid.appendChild(buildCard(poke));
  });

  showLoader(false);
  pagination.hidden = false;

  /* scroll to top of grid smoothly */
  grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* filter by type — fetches details for the whole filtered list, paginated internally */
async function filterByType(list) {
  try {
    const typeData = await apiFetch(`${BASE}/type/${state.type}`);
    const names = new Set(typeData.pokemon.map(e => e.pokemon.name));
    return list.filter(p => names.has(p.name));
  } catch(e) {
    return list;
  }
}

/* ──────────────────────────────────────────
   POKEMON CARD
   ────────────────────────────────────────── */
function buildCard(poke) {
  const card = document.createElement('div');
  card.className = 'card';

  const mainType = poke.types[0].type.name;
  card.style.color = TYPE_COLORS[mainType] ?? '#fff';

  const typeBadges = poke.types
    .map(t => `<span class="type-badge type-${t.type.name}">${t.type.name}</span>`)
    .join('');

  const img = poke.sprites.other['official-artwork']?.front_default
    || poke.sprites.front_default
    || '';

  card.innerHTML = `
    <span class="card-num">#${String(poke.id).padStart(4,'0')}</span>
    <img class="card-img" src="${img}" alt="${poke.name}" loading="lazy" />
    <span class="card-name">${poke.name}</span>
    <div class="card-types">${typeBadges}</div>
  `;

  card.addEventListener('click', () => openModal(poke.id));
  return card;
}

/* ──────────────────────────────────────────
   FETCH HELPERS
   ────────────────────────────────────────── */
async function fetchPokemon(id) {
  try { return await apiFetch(`${BASE}/pokemon/${id}`); }
  catch(e) { return null; }
}

async function fetchSpecies(id) {
  try { return await apiFetch(`${BASE}/pokemon-species/${id}`); }
  catch(e) { return null; }
}

async function fetchEvolutionChain(url) {
  try { return await apiFetch(url); }
  catch(e) { return null; }
}

/* ──────────────────────────────────────────
   MODAL
   ────────────────────────────────────────── */
async function openModal(id) {
  modalOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
  modalContent.innerHTML = '<div class="spinner"></div>';

  const [poke, species] = await Promise.all([fetchPokemon(id), fetchSpecies(id)]);
  if (!poke) { modalContent.innerHTML = '<p>Error al cargar.</p>'; return; }

  const mainType = poke.types[0].type.name;
  const color = TYPE_COLORS[mainType] ?? '#555';

  /* evolution chain */
  let evoHtml = '';
  if (species?.evolution_chain?.url) {
    const chain = await fetchEvolutionChain(species.evolution_chain.url);
    if (chain) evoHtml = await buildEvoChain(chain.chain);
  }

  /* flavor text (Spanish or English) */
  let flavor = '';
  if (species) {
    const esEntry = species.flavor_text_entries.find(e => e.language.name === 'es');
    const enEntry = species.flavor_text_entries.find(e => e.language.name === 'en');
    const raw = (esEntry || enEntry)?.flavor_text ?? '';
    flavor = raw.replace(/\f|\n/g, ' ');
  }

  const mainImg = poke.sprites.other['official-artwork']?.front_default
    || poke.sprites.front_default || '';

  const typeBadges = poke.types
    .map(t => `<span class="type-badge type-${t.type.name}">${t.type.name}</span>`)
    .join('');

  const statBars = poke.stats.map(s => {
    const pct = Math.min(100, Math.round(s.base_stat / 255 * 100));
    const col = statColor(s.base_stat);
    return `
      <div class="stat-row">
        <span class="stat-label">${statLabel(s.stat.name)}</span>
        <span class="stat-val">${s.base_stat}</span>
        <div class="stat-bar"><div class="stat-fill" style="width:${pct}%;background:${col}"></div></div>
      </div>`;
  }).join('');

  const abilities = poke.abilities.map(a => `
    <span class="ability-badge ${a.is_hidden ? 'hidden-ability' : ''}">
      ${a.ability.name.replace('-',' ')}${a.is_hidden ? ' ✦' : ''}
    </span>`).join('');

  const height = (poke.height / 10).toFixed(1);
  const weight = (poke.weight / 10).toFixed(1);
  const totalStats = poke.stats.reduce((s, st) => s + st.base_stat, 0);

  /* category from species */
  const catEntry = species?.genera?.find(g => g.language.name === 'es') ||
                   species?.genera?.find(g => g.language.name === 'en');
  const category = catEntry?.genus ?? '—';

  modalContent.innerHTML = `
    <div class="modal-tabs">
      <button class="tab-btn active" data-tab="info">Info</button>
      <button class="tab-btn" data-tab="stats">Stats</button>
      <button class="tab-btn" data-tab="evo">Evolución</button>
    </div>

    <!-- hero -->
    <div class="modal-hero">
      <div class="modal-hero-bg" style="background:linear-gradient(135deg,${color}33,${color}11)">
        <span class="modal-num">#${String(poke.id).padStart(4,'0')}</span>
        <img class="modal-img" src="${mainImg}" alt="${poke.name}" />
        <h2 class="modal-name">${poke.name}</h2>
        <div class="modal-types">${typeBadges}</div>
      </div>
    </div>

    <!-- INFO tab -->
    <div class="tab-panel active" id="tab-info">
      ${flavor ? `<div class="modal-section"><p style="font-size:.88rem;color:var(--text-muted);line-height:1.6">${flavor}</p></div>` : ''}
      <div class="modal-section">
        <h3>Datos</h3>
        <div class="info-grid">
          <div class="info-item"><label>Altura</label><span>${height} m</span></div>
          <div class="info-item"><label>Peso</label><span>${weight} kg</span></div>
          <div class="info-item"><label>Categoría</label><span>${category}</span></div>
          <div class="info-item"><label>Exp. base</label><span>${poke.base_experience ?? '—'}</span></div>
        </div>
      </div>
      <div class="modal-section">
        <h3>Habilidades</h3>
        <div class="abilities">${abilities}</div>
      </div>
    </div>

    <!-- STATS tab -->
    <div class="tab-panel" id="tab-stats">
      <div class="modal-section">
        <h3>Estadísticas base · Total: ${totalStats}</h3>
        ${statBars}
      </div>
    </div>

    <!-- EVO tab -->
    <div class="tab-panel" id="tab-evo">
      <div class="modal-section">
        <h3>Cadena evolutiva</h3>
        <div class="evo-chain">${evoHtml || '<p style="color:var(--text-muted);font-size:.85rem">Sin cadena evolutiva.</p>'}</div>
      </div>
    </div>
  `;

  /* Tab switching */
  modalContent.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modalContent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      modalContent.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      modalContent.querySelector(`#tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

  /* Evo item clicks */
  modalContent.querySelectorAll('.evo-item[data-id]').forEach(el => {
    el.addEventListener('click', () => openModal(Number(el.dataset.id)));
  });
}

function closeModal() {
  modalOverlay.hidden = true;
  document.body.style.overflow = '';
}

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ──────────────────────────────────────────
   EVOLUTION CHAIN
   ────────────────────────────────────────── */
async function buildEvoChain(node) {
  const parts = [];

  async function walk(n) {
    const id = extractId(n.species.url);
    const img = await getPokemonSprite(id);
    parts.push(`
      <div class="evo-item" data-id="${id}">
        <img src="${img}" alt="${n.species.name}" />
        <span>${n.species.name}</span>
      </div>`);

    if (n.evolves_to?.length) {
      parts.push('<span class="evo-arrow">→</span>');
      await walk(n.evolves_to[0]);
    }
  }

  await walk(node);
  return parts.join('');
}

async function getPokemonSprite(id) {
  try {
    const p = await fetchPokemon(id);
    return p?.sprites?.front_default ?? '';
  } catch { return ''; }
}

function extractId(url) {
  return Number(url.replace(/\/$/, '').split('/').pop());
}

/* ──────────────────────────────────────────
   UTILITIES
   ────────────────────────────────────────── */
function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function statLabel(name) {
  const map = { hp:'HP', attack:'Ataque', defense:'Defensa',
    'special-attack':'Sp. Ataque', 'special-defense':'Sp. Defensa', speed:'Velocidad' };
  return map[name] ?? name;
}

function statColor(val) {
  if (val >= 150) return '#22c55e';
  if (val >= 100) return '#84cc16';
  if (val >= 70)  return '#eab308';
  if (val >= 50)  return '#f97316';
  return '#ef4444';
}

function showLoader(show) {
  loader.hidden = !show;
  if (show) { grid.innerHTML = ''; pagination.hidden = true; }
}

/* ──────────────────────────────────────────
   EVENT LISTENERS
   ────────────────────────────────────────── */

/* Search */
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  state.search = searchInput.value.trim();
  searchClear.classList.toggle('visible', state.search.length > 0);
  searchTimer = setTimeout(applyFilters, 350);
});
searchClear.addEventListener('click', () => {
  searchInput.value = '';
  state.search = '';
  searchClear.classList.remove('visible');
  applyFilters();
});

/* Type pills */
function selectType(type) {
  state.type = type;
  typePills.querySelectorAll('.pill').forEach(p => {
    p.classList.toggle('active', p.dataset.type === type);
  });
  state.page = 1;
  applyFilters();
}
typePills.querySelector('[data-type="all"]').addEventListener('click', () => selectType('all'));

/* Gen */
genSelect.addEventListener('change', () => {
  state.gen = genSelect.value;
  applyFilters();
});

/* Sort */
sortSelect.addEventListener('change', () => {
  state.sort = sortSelect.value;
  renderPage();
});

/* Pagination */
prevBtn.addEventListener('click', () => { state.page--; renderPage(); });
nextBtn.addEventListener('click', () => { state.page++; renderPage(); });

/* ── Boot ── */
init();
