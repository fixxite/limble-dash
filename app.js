/* Limble CMMS Dashboard — app.js */
'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 60_000;
const TAGS_STORAGE_KEY = 'limble_dash_tags';
const WO_TAGS_STORAGE_KEY = 'limble_dash_wo_tags';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  workOrders: [],
  filter: { status: 'all', priority: 'all', tag: 'all' },
  loading: false,
  error: null,
  tags: loadTagsFromStorage(),
  nextTagId: 0,
  woTagMap: loadWoTagsFromStorage(),
  // Populated after API fetch
  statusMap: {},    // { [wo.status int]: { label, cls } }
  priorityMap: {},  // { [wo.priority int]: { label, cls, color } }
  locationMap: {},  // { [locationID]: name }
};
state.nextTagId = state.tags.length
  ? Math.max(...state.tags.map(t => t.id)) + 1
  : 1;

// ── Tag Persistence ──────────────────────────────────────────────────────────

function loadTagsFromStorage() {
  try { return JSON.parse(localStorage.getItem(TAGS_STORAGE_KEY)) ?? []; }
  catch { return []; }
}
function saveTagsToStorage() {
  localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(state.tags));
}
function loadWoTagsFromStorage() {
  try { return JSON.parse(localStorage.getItem(WO_TAGS_STORAGE_KEY)) ?? {}; }
  catch { return {}; }
}
function saveWoTagsToStorage() {
  localStorage.setItem(WO_TAGS_STORAGE_KEY, JSON.stringify(state.woTagMap));
}

// ── API ──────────────────────────────────────────────────────────────────────

async function apiFetch(path) {
  const resp = await fetch(path, { headers: { 'Accept': 'application/json' } });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!resp.ok) throw new Error(data?.message || data?.error || `HTTP ${resp.status}`);
  return data;
}

async function fetchWorkOrders() {
  state.loading = true;
  state.error = null;
  renderMain();
  try {
    const [tasks, statuses, priorities, locations] = await Promise.all([
      apiFetch('/api/workorders'),
      apiFetch('/api/statuses'),
      apiFetch('/api/priorities'),
      apiFetch('/api/locations'),
    ]);

    // Build status map keyed by wo.status integer
    state.statusMap = {};
    for (const s of (Array.isArray(statuses) ? statuses : [])) {
      const cls = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      state.statusMap[String(s.statusID)] = { label: s.name, cls };
    }

    // Build priority map keyed by wo.priority (priorityLevel)
    state.priorityMap = {};
    for (const p of (Array.isArray(priorities) ? priorities : [])) {
      const cls = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      state.priorityMap[String(p.priorityLevel)] = { label: p.name, cls, color: p.color };
    }

    // Build location map
    state.locationMap = {};
    for (const l of (Array.isArray(locations) ? locations : [])) {
      state.locationMap[l.locationID] = l.name;
    }

    // Filter out templates, use real WOs only
    const raw = Array.isArray(tasks) ? tasks : (tasks.data ?? []);
    state.workOrders = raw.filter(t => !t.template);

    refreshStatusFilter();
    refreshPriorityFilter();
    refreshTagFilter();
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    renderMain();
  }
}

// ── Tag helpers ──────────────────────────────────────────────────────────────

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function tagChipStyle(color) {
  return `background:${hexToRgba(color, 0.15)};color:${color};border:1px solid ${hexToRgba(color, 0.3)}`;
}

function woTagIds(wo) {
  const id = wo.taskID ?? wo.id;
  return state.woTagMap[id] ?? [];
}

function tagChipsHtml(tagIds) {
  if (!tagIds?.length) return '';
  return `<div class="tag-chips">${tagIds.map(tid => {
    const tag = state.tags.find(t => t.id === tid);
    if (!tag) return '';
    return `<span class="tag-chip" style="${tagChipStyle(tag.color)}">${escHtml(tag.label)}</span>`;
  }).join('')}</div>`;
}

function refreshTagFilter() {
  const sel = document.getElementById('filter-tag');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="all">All</option>' +
    state.tags.map(t => `<option value="${t.id}">${escHtml(t.label)}</option>`).join('');
  sel.value = state.tags.find(t => String(t.id) === current) ? current : 'all';
  state.filter.tag = sel.value;
}

function refreshStatusFilter() {
  const sel = document.getElementById('filter-status');
  if (!sel) return;
  const entries = Object.values(state.statusMap);
  sel.innerHTML = '<option value="all">All</option>' +
    entries.map(s => `<option value="${s.cls}">${escHtml(s.label)}</option>`).join('');
  if (!entries.find(s => s.cls === state.filter.status)) {
    sel.value = 'all';
    state.filter.status = 'all';
  }
}

function refreshPriorityFilter() {
  const sel = document.getElementById('filter-priority');
  if (!sel) return;
  const entries = Object.entries(state.priorityMap)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, p]) => p);
  sel.innerHTML = '<option value="all">All</option>' +
    entries.map(p => `<option value="${p.cls}">${escHtml(p.label)}</option>`).join('');
  if (!entries.find(p => p.cls === state.filter.priority)) {
    sel.value = 'all';
    state.filter.priority = 'all';
  }
}

// ── Filters ──────────────────────────────────────────────────────────────────

function applyFilters(orders) {
  return orders.filter(wo => {
    const { status, priority, tag } = state.filter;

    if (status !== 'all') {
      const cls = state.statusMap[String(wo.status ?? '')]?.cls ?? '';
      if (cls !== status) return false;
    }

    if (priority !== 'all') {
      const cls = state.priorityMap[String(wo.priority ?? '')]?.cls ?? '';
      if (cls !== priority) return false;
    }

    if (tag !== 'all') {
      if (!woTagIds(wo).includes(Number(tag))) return false;
    }

    return true;
  });
}

// ── Rendering ────────────────────────────────────────────────────────────────

function el(tag, cls, inner) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (inner !== undefined) e.innerHTML = inner;
  return e;
}

function fmtDate(val) {
  if (!val) return '—';
  // Accept unix seconds or ms / ISO strings
  const ms = typeof val === 'number' ? val * 1000 : val;
  try { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return String(val); }
}

function fmtStatus(wo) {
  return state.statusMap[String(wo.status ?? '')] ?? { label: 'Unknown', cls: 'unknown' };
}

function fmtPriority(wo) {
  return state.priorityMap[String(wo.priority ?? '')] ?? { label: '—', cls: 'unknown', color: '#9ca3af' };
}

function renderCard(wo) {
  const status = fmtStatus(wo);
  const priority = fmtPriority(wo);
  const tags = woTagIds(wo);
  const card = el('div', 'card');

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">${escHtml(wo.name || 'Untitled')}</span>
      <span class="badge badge-${status.cls}">${escHtml(status.label)}</span>
    </div>
    <div class="card-meta">
      <div class="card-meta-row">
        <span class="priority-dot" style="background:${priority.color}" title="Priority: ${escHtml(priority.label)}"></span>
        <span><span class="label">Priority:</span> ${escHtml(priority.label)}</span>
      </div>
      ${wo.dueDate || wo.due ? `<div class="card-meta-row"><span class="label">Due:</span> ${fmtDate(wo.due || wo.dueDate)}</div>` : ''}
    </div>
    ${tagChipsHtml(tags)}
    <div class="card-footer">Updated ${fmtDate(wo.lastEdited || wo.updatedAt)}</div>
  `;

  return card;
}

function groupByLocation(orders) {
  const groups = {};
  for (const wo of orders) {
    const loc = (wo.locationID && state.locationMap[wo.locationID]) || wo.location || 'Unassigned';
    (groups[loc] ??= []).push(wo);
  }
  return groups;
}

function renderColumns() {
  const main = document.getElementById('main');
  const countEl = document.getElementById('wo-count');

  if (state.loading) {
    main.innerHTML = '<div class="state-box"><div class="spinner"></div><p>Loading work orders…</p></div>';
    countEl.textContent = '';
    return;
  }

  if (state.error) {
    main.innerHTML = `<div class="state-box"><h3>Error loading work orders</h3><p>${escHtml(state.error)}</p></div>`;
    countEl.textContent = '';
    return;
  }

  const filtered = applyFilters(state.workOrders);
  countEl.textContent = `${filtered.length} of ${state.workOrders.length} work orders`;

  if (filtered.length === 0) {
    main.innerHTML = '<div class="state-box"><h3>No work orders found</h3><p>Try adjusting your filters.</p></div>';
    return;
  }

  const groups = groupByLocation(filtered);
  const layout = el('div', 'column-layout');

  const locNames = Object.keys(groups).filter(k => k !== 'Unassigned').sort();
  if (groups['Unassigned']) locNames.push('Unassigned');

  for (const loc of locNames) {
    const wos = groups[loc];
    const col = el('div', 'column');
    const header = el('div', 'column-header');
    header.innerHTML = `<span>${escHtml(loc)}</span><span class="col-count">${wos.length}</span>`;
    col.appendChild(header);
    wos.forEach(wo => col.appendChild(renderCard(wo)));
    layout.appendChild(col);
  }

  main.innerHTML = '';
  main.appendChild(layout);
}

function renderMain() {
  renderColumns();
}

// ── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function init() {
  document.getElementById('filter-status').addEventListener('change', e => {
    state.filter.status = e.target.value; renderMain();
  });
  document.getElementById('filter-priority').addEventListener('change', e => {
    state.filter.priority = e.target.value; renderMain();
  });
  document.getElementById('filter-tag').addEventListener('change', e => {
    state.filter.tag = e.target.value; renderMain();
  });

  document.getElementById('btn-refresh').addEventListener('click', fetchWorkOrders);

  refreshTagFilter();
  fetchWorkOrders();
  setInterval(fetchWorkOrders, REFRESH_INTERVAL_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
