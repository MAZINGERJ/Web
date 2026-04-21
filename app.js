/* ══════════════════════════════════════════════════════════
   Pokédex  ·  PokeAPI v2  ·  Vanilla JS
   ══════════════════════════════════════════════════════════ */
'use strict';

/* ── Constants ──────────────────────────────────────────── */
const API      = 'https://pokeapi.co/api/v2';
const TOTAL    = 905;
const PER_PAGE = 30;

const ART   = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
const SHINY = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/shiny/${id}.png`;
const SPR   = id => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

const GEN_RANGES = {
  '1':[1,151],'2':[152,251],'3':[252,386],'4':[387,493],
  '5':[494,649],'6':[650,721],'7':[722,809],'8':[810,905],
};

const ALL_TYPES = [
  'normal','fire','water','electric','grass','ice',
  'fighting','poison','ground','flying','psychic','bug',
  'rock','ghost','dragon','dark','steel','fairy',
];

const TYPE_CSS_COLOR = {
  normal:'#9ca3af',  fire:'#f97316',    water:'#3b82f6',  electric:'#fbbf24',
  grass:'#4ade80',   ice:'#67e8f9',     fighting:'#c2410c',poison:'#a855f7',
  ground:'#d97706',  flying:'#818cf8',  psychic:'#f472b6', bug:'#84cc16',
  rock:'#a8825a',    ghost:'#7c3aed',   dragon:'#6d28d9',  dark:'#4b5563',
  steel:'#94a3b8',   fairy:'#f9a8d4',
};

const STAT_LABEL = {
  hp:'HP', attack:'Ataque', defense:'Defensa',
  'special-attack':'Sp.Atq', 'special-defense':'Sp.Def', speed:'Velocidad',
};

/* ── State ──────────────────────────────────────────────── */
const S = {
  all:          [],          /* {id,name}[] — 905 entries                  */
  typeMap:      new Map(),   /* pokemonName → string[]                     */
  cache:        new Map(),   /* url → parsed JSON                          */
  typeMapReady: false,
  typeMapPromise: null,

  /* filters */
  search: '', type: 'all', gen: 'all', sort: 'id',
  page:   1,
  filtered: [],             /* current filtered + sorted list              */

  /* modal */
  modalId:    null,
  modalShiny: false,
};

/* ── DOM helpers ──────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

/* ── API fetch with cache ─────────────────────────────────── */
async function api(url) {
  if (S.cache.has(url)) return S.cache.get(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const data = await res.json();
  S.cache.set(url, data);
  return data;
}

/* ── Type index ───────────────────────────────────────────── */
function ensureTypeMap() {
  if (!S.typeMapPromise) S.typeMapPromise = buildTypeMap();
  return S.typeMapPromise;
}

async function buildTypeMap() {
  for (let i = 0; i < ALL_TYPES.length; i += 6) {
    const chunk = ALL_TYPES.slice(i, i + 6);
    const results = await Promise.all(
      chunk.map(t => api(`${API}/type/${t}`).catch(() => null))
    );
    results.forEach((d, j) => {
      if (!d) return;
      d.pokemon.forEach(({ pokemon: p }) => {
        const list = S.typeMap.get(p.name) || [];
        list.push(chunk[j]);
        S.typeMap.set(p.name, list);
      });
    });
  }
  S.typeMapReady = true;
}

/* ── Init ─────────────────────────────────────────────────── */
async function init() {
  setLoader(true);
  renderTypePills();

  try {
    const d = await api(`${API}/pokemon?limit=${TOTAL}&offset=0`);
    S.all = d.results.map((p, i) => ({ id: i + 1, name: p.name }));
    /* kick off type map in parallel; don't await */
    ensureTypeMap();
    applyFilters();
  } catch (e) {
    setLoader(false);
    $('pokemon-grid').innerHTML =
      '<p style="color:var(--text3);padding:3rem 0;text-align:center">No se pudo conectar con PokéAPI.<br>Comprueba tu conexión e intenta de nuevo.</p>';
  }
}

/* ── Filtering & sorting ──────────────────────────────────── */
function applyFilters() {
  let list = S.all.slice();

  /* generation */
  if (S.gen !== 'all') {
    const [lo, hi] = GEN_RANGES[S.gen];
    list = list.filter(p => p.id >= lo && p.id <= hi);
  }

  /* search (name or exact/padded number) */
  if (S.search) {
    const q = S.search.toLowerCase().trim();
    list = list.filter(p =>
      p.name.includes(q) ||
      String(p.id) === q ||
      String(p.id).padStart(4, '0').includes(q)
    );
  }

  /* type (defer to typeMap; re-apply when map is ready) */
  if (S.type !== 'all' && S.typeMapReady) {
    list = list.filter(p => (S.typeMap.get(p.name) || []).includes(S.type));
  }

  /* sort */
  if (S.sort === 'name')      list.sort((a, b) => a.name.localeCompare(b.name));
  else if (S.sort === 'name-desc') list.sort((a, b) => b.name.localeCompare(a.name));
  else list.sort((a, b) => a.id - b.id);

  S.filtered = list;
  S.page = 1;
  renderGrid();
}

/* ── Grid rendering ───────────────────────────────────────── */
async function renderGrid() {
  const grid  = $('pokemon-grid');
  const empty = $('empty-state');
  const pag   = $('pagination');
  const rc    = $('results-count');

  empty.hidden = true;
  pag.hidden   = true;
  setLoader(true);

  if (S.filtered.length === 0) {
    setLoader(false);
    empty.hidden = false;
    rc.textContent = '0 Pokémon encontrados';
    return;
  }

  const totalPages = Math.ceil(S.filtered.length / PER_PAGE);
  S.page = Math.max(1, Math.min(S.page, totalPages));

  const start = (S.page - 1) * PER_PAGE;
  const items = S.filtered.slice(start, start + PER_PAGE);

  rc.textContent = `${S.filtered.length.toLocaleString('es')} Pokémon encontrados`;

  /* show skeletons immediately */
  grid.innerHTML = items.map(() => `
    <div class="card card--skeleton" aria-hidden="true">
      <div class="skel skel--img"></div>
      <div class="skel skel--name" style="margin-top:.5rem"></div>
      <div class="skel skel--badge"></div>
    </div>`).join('');

  /* fetch types for this page (from typeMap or individual API call) */
  const cardData = await Promise.all(items.map(p => resolveCardData(p.id, p.name)));

  setLoader(false);
  grid.innerHTML = '';
  cardData.forEach(d => { if (d) grid.appendChild(buildCard(d)); });

  /* pagination */
  renderPagination(totalPages);
  pag.hidden = totalPages <= 1;
}

async function resolveCardData(id, name) {
  /* fast path: type already in map */
  let types = S.typeMap.get(name);
  if (types && types.length) return { id, name, types };

  /* slow path: fetch individual pokemon */
  try {
    const d = await api(`${API}/pokemon/${id}`);
    types = d.types.map(t => t.type.name);
    S.typeMap.set(name, types);
    return { id, name, types };
  } catch {
    return { id, name, types: ['normal'] };
  }
}

function buildCard({ id, name, types }) {
  const primary = types[0] || 'normal';
  const color   = TYPE_CSS_COLOR[primary] || '#666';

  const card = el('article', 'card');
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Ver ${cap(name)}, Pokémon #${id}`);
  card.style.setProperty('--card-color', color);

  const badges = types.map(t => `<span class="badge badge--${t}">${t}</span>`).join('');

  card.innerHTML = `
    <span class="card-num">#${pad(id)}</span>
    <div class="card-img-wrap">
      <img class="card-img" src="${ART(id)}" alt="${cap(name)}"
           loading="lazy" width="100" height="100"
           onerror="this.src='${SPR(id)}'" />
    </div>
    <p class="card-name">${cap(name)}</p>
    <div class="card-types">${badges}</div>`;

  const open = () => openModal(id);
  card.addEventListener('click', open);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return card;
}

/* ── Pagination ───────────────────────────────────────────── */
function renderPagination(total) {
  const prev = $('prev-btn');
  const next = $('next-btn');
  const pn   = $('page-numbers');

  prev.disabled = S.page === 1;
  next.disabled = S.page === total;

  /* build page number list with ellipsis */
  const pages = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - S.page) <= 2) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== '…') {
      pages.push('…');
    }
  }

  pn.innerHTML = pages.map(p =>
    p === '…'
      ? '<span class="page-ellipsis" aria-hidden="true">…</span>'
      : `<button class="page-num${p === S.page ? ' page-num--active' : ''}" data-p="${p}" aria-label="Página ${p}"${p === S.page ? ' aria-current="page"' : ''}>${p}</button>`
  ).join('');

  pn.querySelectorAll('.page-num').forEach(btn =>
    btn.addEventListener('click', () => {
      S.page = +btn.dataset.p;
      renderGrid();
      scrollToMain();
    })
  );
}

function scrollToMain() {
  $('main-content').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ── Type pills ───────────────────────────────────────────── */
function renderTypePills() {
  const wrap = $('type-pills');
  ALL_TYPES.forEach(t => {
    const btn = el('button', 'pill');
    btn.dataset.type = t;
    btn.innerHTML = `<span class="pill-dot" style="background:${TYPE_CSS_COLOR[t]}"></span>${cap(t)}`;
    btn.addEventListener('click', () => selectType(t));
    wrap.appendChild(btn);
  });
}

async function selectType(type) {
  /* update pill UI */
  document.querySelectorAll('.pill').forEach(p =>
    p.classList.toggle('pill--active', p.dataset.type === type)
  );

  S.type = type;

  /* wait for typeMap if filtering by type */
  if (type !== 'all' && !S.typeMapReady) {
    $('type-loading').hidden  = false;
    $('type-pills').style.opacity = '.5';
    await ensureTypeMap();
    $('type-loading').hidden  = true;
    $('type-pills').style.opacity = '';
  }

  S.page = 1;
  applyFilters();
}

/* ── Modal ────────────────────────────────────────────────── */
async function openModal(id) {
  S.modalId    = id;
  S.modalShiny = false;

  const overlay = $('modal-overlay');
  const body    = $('modal-body');

  overlay.hidden = false;
  document.body.style.overflow = 'hidden';

  /* loading state */
  body.innerHTML = `<div class="modal-loading"><div class="pb-spin"></div><p>Cargando…</p></div>`;

  try {
    const [poke, species] = await Promise.all([
      api(`${API}/pokemon/${id}`),
      api(`${API}/pokemon-species/${id}`).catch(() => null),
    ]);
    renderModalContent(poke, species);
  } catch {
    body.innerHTML = `
      <div class="modal-error">
        <p>No se pudo cargar este Pokémon.</p>
        <button onclick="openModal(${id})">Reintentar</button>
      </div>`;
  }
}

function renderModalContent(poke, species) {
  const id        = poke.id;
  const name      = cap(poke.name);
  const mainType  = poke.types[0].type.name;
  const color     = TYPE_CSS_COLOR[mainType] || '#555';

  /* navigation within current filtered list */
  const idx    = S.filtered.findIndex(p => p.id === id);
  const prevId = idx > 0 ? S.filtered[idx - 1].id : null;
  const nextId = idx < S.filtered.length - 1 ? S.filtered[idx + 1].id : null;
  updateNavButtons(prevId, nextId);

  /* text helpers */
  const typeBadges  = poke.types.map(t => `<span class="badge badge--${t.type.name}">${t.type.name}</span>`).join('');
  const flavorEntry = species?.flavor_text_entries?.find(e => e.language.name === 'es')
                   || species?.flavor_text_entries?.find(e => e.language.name === 'en');
  const flavor      = cleanText(flavorEntry?.flavor_text || '');
  const height      = (poke.height  / 10).toFixed(1) + ' m';
  const weight      = (poke.weight  / 10).toFixed(1) + ' kg';
  const catchRate   = species?.capture_rate ?? '—';
  const growthRate  = cap((species?.growth_rate?.name || '').replace(/-/g, ' ')) || '—';
  const eggGroups   = (species?.egg_groups || []).map(g => cap(g.name)).join(', ') || '—';
  const genName     = species?.generation?.name?.replace('generation-', 'Gen ').toUpperCase() || '—';
  const category    = (species?.genera?.find(g => g.language.name === 'es')
                    || species?.genera?.find(g => g.language.name === 'en'))?.genus || '—';
  const totalStats  = poke.stats.reduce((s, st) => s + st.base_stat, 0);

  /* color for gradient */
  const ca = hexWithAlpha(color, '.30');
  const cb = hexWithAlpha(color, '.06');

  /* abilities */
  const abilityHtml = poke.abilities.map(a => `
    <span class="ability-chip ${a.is_hidden ? 'ability-chip--hidden' : ''}">
      ${cap(a.ability.name.replace(/-/g, ' '))}
      ${a.is_hidden ? '<em>Oculta</em>' : ''}
    </span>`).join('');

  /* stat rows */
  const statHtml = poke.stats.map(s => {
    const pct   = Math.min(100, Math.round(s.base_stat / 255 * 100));
    const color2 = statColor(s.base_stat);
    return `<div class="stat-row">
      <span class="stat-label">${STAT_LABEL[s.stat.name] || s.stat.name}</span>
      <span class="stat-val">${s.base_stat}</span>
      <div class="stat-track"><div class="stat-bar" data-w="${pct}" style="background:${color2}"></div></div>
    </div>`;
  }).join('');

  $('modal-body').innerHTML = `
    <!-- Hero -->
    <div class="modal-hero" style="--modal-color-a:${ca};--modal-color-b:${cb}">
      <span class="modal-hero-num">#${pad(id)} · ${genName}</span>
      <button class="shiny-btn" id="shiny-btn" aria-label="Alternar sprite shiny" aria-pressed="false">✦ Shiny</button>
      <img class="modal-art" id="modal-art"
           src="${ART(id)}" alt="${name}"
           width="168" height="168"
           onerror="this.src='${SPR(id)}'" />
      <h2 class="modal-name" id="modal-pokemon-name">${name}</h2>
      <div class="modal-types">${typeBadges}</div>
    </div>

    <!-- Tabs -->
    <div class="modal-tabs">
      <button class="tab active" data-tab="about">Acerca de</button>
      <button class="tab" data-tab="stats">Estadísticas</button>
      <button class="tab" data-tab="evo">Evolución</button>
    </div>

    <div class="tab-content">
      <!-- About -->
      <section class="tab-pane active" id="tab-about">
        ${flavor ? `<p class="flavor-text">"${flavor}"</p>` : ''}
        <div class="info-grid">
          <div class="info-cell"><label>Altura</label><strong>${height}</strong></div>
          <div class="info-cell"><label>Peso</label><strong>${weight}</strong></div>
          <div class="info-cell"><label>Categoría</label><strong>${category}</strong></div>
          <div class="info-cell"><label>Generación</label><strong>${genName}</strong></div>
          <div class="info-cell"><label>Tasa captura</label><strong>${catchRate}</strong></div>
          <div class="info-cell"><label>Crecimiento</label><strong>${growthRate}</strong></div>
          <div class="info-cell"><label>Grupos huevo</label><strong>${eggGroups}</strong></div>
          <div class="info-cell"><label>Exp. base</label><strong>${poke.base_experience ?? '—'}</strong></div>
        </div>
        <p class="section-title">Habilidades</p>
        <div class="ability-list">${abilityHtml}</div>
      </section>

      <!-- Stats -->
      <section class="tab-pane" id="tab-stats">
        <div class="stats-list">
          ${statHtml}
          <div class="stat-row stat-row--total">
            <span class="stat-label">Total</span>
            <span class="stat-val">${totalStats}</span>
            <div class="stat-track"></div>
          </div>
        </div>
      </section>

      <!-- Evo -->
      <section class="tab-pane" id="tab-evo">
        <div id="evo-wrap">
          <div class="modal-loading" style="padding:2rem 0"><div class="pb-spin"></div></div>
        </div>
      </section>
    </div>`;

  /* wire tabs */
  $('modal-body').querySelectorAll('.tab').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  /* shiny toggle */
  $('shiny-btn').addEventListener('click', toggleShiny);

  /* load evo chain */
  if (species?.evolution_chain?.url) {
    api(species.evolution_chain.url)
      .then(d => renderEvoSection(d.chain, id))
      .catch(() => {
        const w = $('evo-wrap');
        if (w) w.innerHTML = '<p class="text-muted">No se pudo cargar la cadena evolutiva.</p>';
      });
  } else {
    const w = $('evo-wrap');
    if (w) w.innerHTML = '<p class="text-muted">Sin cadena evolutiva registrada.</p>';
  }
}

function switchTab(tabId) {
  document.querySelectorAll('.tab, .tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tabId}"]`).classList.add('active');
  const pane = $(`tab-${tabId}`);
  if (pane) {
    pane.classList.add('active');
    if (tabId === 'stats') animateStats();
  }
}

function toggleShiny() {
  S.modalShiny = !S.modalShiny;
  const img = $('modal-art');
  const btn = $('shiny-btn');
  if (!img || !btn) return;
  img.classList.add('loading');
  const newSrc = S.modalShiny ? SHINY(S.modalId) : ART(S.modalId);
  img.onload  = () => img.classList.remove('loading');
  img.onerror = () => { img.src = SPR(S.modalId); img.classList.remove('loading'); };
  img.src = newSrc;
  btn.classList.toggle('shiny-btn--on', S.modalShiny);
  btn.setAttribute('aria-pressed', String(S.modalShiny));
}

function updateNavButtons(prevId, nextId) {
  const prev = $('modal-prev');
  const next = $('modal-next');
  prev.disabled = !prevId;
  next.disabled = !nextId;
  prev.onclick = prevId ? () => openModal(prevId) : null;
  next.onclick = nextId ? () => openModal(nextId) : null;
}

/* animate stat bars (double rAF to trigger CSS transition after paint) */
function animateStats() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document.querySelectorAll('.stat-bar[data-w]').forEach(b => {
        b.style.width = b.dataset.w + '%';
      })
    )
  );
}

function closeModal() {
  $('modal-overlay').hidden = true;
  document.body.style.overflow = '';
  S.modalId = null;
}

/* ── Evolution chain ──────────────────────────────────────── */
function renderEvoSection(chain, currentId) {
  const wrap = $('evo-wrap');
  if (!wrap) return;

  /* Build depth groups: depths[0] = [base], depths[1] = [stage1a, stage1b], … */
  const depths = [];
  function walk(node, depth = 0) {
    if (!depths[depth]) depths[depth] = [];
    depths[depth].push({
      id:      extractId(node.species.url),
      name:    node.species.name,
      trigger: evoTrigger(node.evolution_details),
    });
    (node.evolves_to || []).forEach(c => walk(c, depth + 1));
  }
  walk(chain);

  /* single pokemon, no evolutions */
  if (depths.length === 1) {
    wrap.innerHTML = '<p class="text-muted">Este Pokémon no evoluciona.</p>';
    return;
  }

  /* build HTML */
  let html = '<div class="evo-chain">';
  depths.forEach((group, di) => {
    if (di > 0) {
      html += `<div class="evo-sep">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
      </div>`;
    }
    /* single-item group: put trigger on the separator arrow above */
    const singleTrigger = group.length === 1 && group[0].trigger;
    if (singleTrigger && di > 0) {
      /* patch the last separator to include the trigger */
      html = html.replace(/<\/div>\s*$/, `<span class="evo-trigger">${singleTrigger}</span></div>`);
    }
    html += '<div class="evo-group">';
    group.forEach(p => {
      const active = p.id === currentId ? ' evo-card--active' : '';
      const noEvo  = depths.length === 1 ? ' evo-card--no-evo' : '';
      /* For branching evolutions, show each card's trigger below its name */
      const triggerHtml = group.length > 1 && p.trigger
        ? `<small class="evo-card-trigger">${p.trigger}</small>` : '';
      html += `<div class="evo-card${active}${noEvo}" data-id="${p.id}" role="button" tabindex="0" aria-label="Ver ${cap(p.name)}">
        <img src="${SPR(p.id)}" alt="${cap(p.name)}" width="68" height="68" loading="lazy" onerror="this.style.opacity='.3'" />
        <span>${cap(p.name)}</span>
        ${triggerHtml}
      </div>`;
    });
    html += '</div>';
  });
  html += '</div>';

  wrap.innerHTML = html;

  /* click handlers */
  wrap.querySelectorAll('.evo-card[data-id]').forEach(card => {
    const navigate = () => {
      const evoId = Number(card.dataset.id);
      if (evoId !== currentId) openModal(evoId);
    };
    card.addEventListener('click', navigate);
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(); }
    });
  });
}

function evoTrigger(details) {
  if (!details || !details.length) return '';
  const d = details[0];
  if (d.trigger?.name === 'trade') return 'Intercambio';
  if (d.min_level)   return `Nv. ${d.min_level}`;
  if (d.item)        return cap(d.item.name.replace(/-/g, ' '));
  if (d.held_item)   return cap(d.held_item.name.replace(/-/g, ' '));
  if (d.known_move)  return cap(d.known_move.name.replace(/-/g, ' '));
  if (d.location)    return 'Lugar especial';
  if (d.min_happiness) return 'Amistad';
  if (d.min_beauty)    return 'Belleza';
  if (d.time_of_day === 'day')   return 'De día';
  if (d.time_of_day === 'night') return 'De noche';
  return 'Evolución';
}

/* ── Utilities ────────────────────────────────────────────── */
const cap  = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const pad  = id => String(id).padStart(4, '0');

function cleanText(s) {
  return s
    .replace(/[\f\n\r­]/g, ' ')
    .replace(/’/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function statColor(v) {
  if (v >= 130) return '#22c55e';
  if (v >= 100) return '#84cc16';
  if (v >= 70)  return '#eab308';
  if (v >= 50)  return '#f97316';
  return '#ef4444';
}

function hexWithAlpha(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function extractId(url) {
  return Number(url.replace(/\/$/, '').split('/').pop());
}

function setLoader(show) {
  $('loader').hidden = !show;
  if (show) $('pokemon-grid').innerHTML = '';
}

/* ── Event listeners ──────────────────────────────────────── */

/* Search */
let searchTimer;
$('search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  S.search = e.target.value;
  $('search-clear').hidden = !S.search;
  searchTimer = setTimeout(applyFilters, 280);
});

$('search-clear').addEventListener('click', () => {
  $('search-input').value = '';
  S.search = '';
  $('search-clear').hidden = true;
  applyFilters();
});

/* Filters */
$('gen-select').addEventListener('change', e => { S.gen = e.target.value; S.page = 1; applyFilters(); });
$('sort-select').addEventListener('change', e => { S.sort = e.target.value; S.page = 1; applyFilters(); });

/* Type pill "All" */
$('type-pills').querySelector('[data-type="all"]').addEventListener('click', () => {
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('pill--active'));
  $('type-pills').querySelector('[data-type="all"]').classList.add('pill--active');
  S.type = 'all';
  S.page = 1;
  applyFilters();
});

/* Pagination */
$('prev-btn').addEventListener('click', () => { S.page--; renderGrid(); scrollToMain(); });
$('next-btn').addEventListener('click', () => { S.page++; renderGrid(); scrollToMain(); });

/* Filter toggle */
$('filter-toggle').addEventListener('click', () => {
  const open = $('filter-bar').classList.toggle('open');
  $('filter-toggle').classList.toggle('active', open);
  $('filter-toggle').setAttribute('aria-expanded', String(open));
});

/* Modal close */
$('modal-close').addEventListener('click', closeModal);
$('modal-overlay').addEventListener('click', e => {
  if (e.target === $('modal-overlay')) closeModal();
});

/* Keyboard */
document.addEventListener('keydown', e => {
  const overlay = $('modal-overlay');
  if (overlay.hidden) return;
  if (e.key === 'Escape')      { closeModal(); return; }
  if (e.key === 'ArrowLeft')   { $('modal-prev').click(); }
  if (e.key === 'ArrowRight')  { $('modal-next').click(); }
});

/* Clear-all-filters button in empty state */
$('clear-filters').addEventListener('click', () => {
  S.search = ''; S.type = 'all'; S.gen = 'all'; S.sort = 'id'; S.page = 1;
  $('search-input').value = '';
  $('search-clear').hidden = true;
  $('gen-select').value  = 'all';
  $('sort-select').value = 'id';
  document.querySelectorAll('.pill').forEach(p => p.classList.remove('pill--active'));
  $('type-pills').querySelector('[data-type="all"]').classList.add('pill--active');
  applyFilters();
});

/* ── Boot ─────────────────────────────────────────────────── */
init();
