/* Limble CMMS Dashboard — app.js */
'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 60_000;
const TASK_TYPES = { 1: 'Planned Maintenance', 2: 'Work Order', 4: 'Preventive Maintenance', 6: 'Work Request' };
const TAGS_STORAGE_KEY = 'limble_dash_tags';
const WO_TAGS_STORAGE_KEY = 'limble_dash_wo_tags';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  workOrders: [],
  filter: { status: 'all', priority: 'all', tag: 'all', location: 'all', search: '' },
  loading: false,
  error: null,
  tags: loadTagsFromStorage(),
  nextTagId: 0,
  woTagMap: loadWoTagsFromStorage(),
  // Populated after API fetch
  statusMap: {},    // { [wo.statusID]: { label, cls } }
  priorityMap: {},  // { [wo.priority int]: { label, cls, color } }
  locationMap: {},  // { [locationID]: name }
  userMap: {},      // { [userID]: 'First Last' }
  trello: { configured: false, list_name: '', board_name: '' },
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

async function fetchWorkOrders(bust = false) {
  const qs = bust ? '?fresh=1' : '';
  state.loading = true;
  state.error = null;
  renderMain();
  try {
    const [tasks, statuses, priorities, locations, users] = await Promise.all([
      apiFetch('/api/workorders' + qs),
      apiFetch('/api/statuses'   + qs),
      apiFetch('/api/priorities' + qs),
      apiFetch('/api/locations'  + qs),
      apiFetch('/api/users'      + qs),
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

    // Build user map
    state.userMap = {};
    for (const u of (Array.isArray(users) ? users : [])) {
      state.userMap[u.userID] = `${u.firstName} ${u.lastName}`.trim();
    }

    state.workOrders = Array.isArray(tasks) ? tasks : (tasks.data ?? []);

    refreshStatusFilter();
    refreshPriorityFilter();
    refreshLocationSwitch();
    refreshTagFilter();

    // Sync open tasks to Trello in background (silent, no await)
    fetch('/api/trello/sync', { method: 'POST' })
      .then(r => r.json())
      .then(r => {
        if (r.created > 0 || r.archived > 0) {
          const parts = [];
          if (r.created > 0) parts.push(`${r.created} new card(s)`);
          if (r.archived > 0) parts.push(`${r.archived} archived`);
          showToast(`Trello: ${parts.join(', ')}`);
        }
      })
      .catch(() => {});  // silent failure — Trello down or not configured
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

function refreshLocationSwitch() {
  const container = document.getElementById('location-switch');
  if (!container) return;

  const names = [...new Set(Object.values(state.locationMap))].sort();
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'loc-btn' + (state.filter.location === 'all' ? ' active' : '');
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => setLocation('all'));
  container.appendChild(allBtn);

  for (const name of names) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'loc-btn' + (state.filter.location === name ? ' active' : '');
    btn.textContent = name;
    btn.addEventListener('click', () => setLocation(name));
    container.appendChild(btn);
  }
}

function setLocation(name) {
  state.filter.location = name;
  refreshLocationSwitch();
  renderMain();
}

// ── Filters ──────────────────────────────────────────────────────────────────

function applyFilters(orders) {
  return orders.filter(wo => {
    const { status, priority, tag, location, search } = state.filter;

    if (search) {
      const q = search.toLowerCase();
      const assignedTo = (wo.userID && state.userMap[wo.userID]) || '';
      if (!(wo.name || '').toLowerCase().includes(q) &&
          !(wo.requestorName || '').toLowerCase().includes(q) &&
          !assignedTo.toLowerCase().includes(q)) return false;
    }

    if (status !== 'all') {
      const cls = state.statusMap[String(wo.statusID ?? '')]?.cls ?? '';
      if (cls !== status) return false;
    }

    if (priority !== 'all') {
      const cls = state.priorityMap[String(wo.priority ?? '')]?.cls ?? '';
      if (cls !== priority) return false;
    }

    if (tag !== 'all') {
      if (!woTagIds(wo).includes(Number(tag))) return false;
    }

    if (location !== 'all') {
      const locName = (wo.locationID && state.locationMap[wo.locationID]) || wo.location || 'Unassigned';
      if (locName !== location) return false;
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
  const ms = typeof val === 'number' ? val * 1000 : val;
  try { return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return String(val); }
}

function fmtStatus(wo) {
  return state.statusMap[String(wo.statusID ?? '')] ?? { label: 'Unknown', cls: 'unknown' };
}

function fmtPriority(wo) {
  const p = state.priorityMap[String(wo.priority ?? '')] ?? { label: '—', cls: 'unknown', color: '#9ca3af' };
  if (p.label.toLowerCase() === 'urgent') return { ...p, color: '#f97316' };
  return p;
}

function renderCard(wo) {
  const status = fmtStatus(wo);
  const priority = fmtPriority(wo);
  const assignedTo = (wo.userID && state.userMap[wo.userID]) || '';
  const taskType = TASK_TYPES[wo.type] || '';
  const tags = woTagIds(wo);
  const card = el('div', 'card');

  const limbleUrl = `https://app.limblecmms.com/taskList?taskID=${wo.taskID}`;

  card.className = 'card card-clickable';
  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">${escHtml(wo.name || 'Untitled')}</span>
      <a class="card-id card-limble-link" href="${limbleUrl}" target="_blank" rel="noopener" title="Open in Limble">#${wo.taskID} &#x2197;</a>
      <span class="badge badge-${status.cls}">${escHtml(status.label)}</span>
    </div>
    <div class="card-meta">
      <div class="card-meta-row">
        <span class="priority-dot" style="background:${priority.color}" title="Priority: ${escHtml(priority.label)}"></span>
        <span><span class="label">Priority:</span> ${escHtml(priority.label)}</span>
      </div>
      ${taskType ? `<div class="card-meta-row"><span class="label">Type:</span> ${escHtml(taskType)}</div>` : ''}
      ${assignedTo ? `<div class="card-meta-row"><span class="label">Assigned:</span> ${escHtml(assignedTo)}</div>` : '<div class="card-meta-row"><span class="label">Assigned:</span> <span style="color:var(--color-text-muted)">Unassigned</span></div>'}
    </div>
    ${tagChipsHtml(tags)}
    <div class="card-footer">
      <span>Updated ${fmtDate(wo.lastEdited || wo.updatedAt)}</span>
    </div>
  `;

  card.addEventListener('click', e => {
    if (!e.target.closest('a')) openDetail(wo);
  });

  return card;
}

function renderMain() {
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

  const PRIORITY_ORDER = ['urgent', 'standard', 'can wait'];
  function priorityRank(wo) {
    const label = (state.priorityMap[String(wo.priority ?? '')]?.label ?? '').toLowerCase();
    const idx = PRIORITY_ORDER.indexOf(label);
    return idx === -1 ? PRIORITY_ORDER.length : idx;
  }
  const filtered = applyFilters(state.workOrders)
    .sort((a, b) => priorityRank(a) - priorityRank(b));
  countEl.textContent = `${filtered.length} of ${state.workOrders.length} work orders`;

  if (filtered.length === 0) {
    main.innerHTML = '<div class="state-box"><h3>No work orders found</h3><p>Try adjusting your filters.</p></div>';
    return;
  }

  const grid = el('div', 'card-grid');
  filtered.forEach(wo => grid.appendChild(renderCard(wo)));
  main.innerHTML = '';
  main.appendChild(grid);
}

// ── Detail modal ─────────────────────────────────────────────────────────────

function openDetail(wo) {
  document.getElementById('detail-title').textContent = wo.name || 'Untitled';

  const limbleUrl        = `https://app.limblecmms.com/taskList?taskID=${wo.taskID}`;
  const requestorName    = (wo.requestorName  || '').trim();
  const requestorEmail   = (wo.requestorEmail || '').trim();
  const requestorComments = (wo.requestorDescription || '').trim();

  const rows = [];
  if (requestorName) rows.push(`<div class="field"><span>Requestor</span><p class="detail-value">${escHtml(requestorName)}${requestorEmail ? ` &lt;${escHtml(requestorEmail)}&gt;` : ''}</p></div>`);
  rows.push(`<div class="field"><span>Requestor Comments</span>${requestorComments
    ? `<p class="detail-comments">${escHtml(requestorComments)}</p>`
    : `<p class="detail-value detail-empty">None</p>`}</div>`);
  rows.push(`<div class="field"><span>Comments</span><div id="detail-comments-list"><div class="spinner detail-spinner"></div></div></div>`);
  rows.push(`<div class="detail-link"><a href="${limbleUrl}" target="_blank" rel="noopener">Open in Limble &#x2197;</a></div>`);

  document.getElementById('detail-body').innerHTML = rows.join('');
  document.getElementById('detail-modal').classList.remove('hidden');

  apiFetch(`/api/workorders/${wo.taskID}/comments`).then(comments => {
    const el = document.getElementById('detail-comments-list');
    if (!el) return;
    comments = comments.filter(c => !c.comment.includes('Changed Due Date'));
    if (!Array.isArray(comments) || comments.length === 0) {
      el.innerHTML = `<p class="detail-value detail-empty">No comments.</p>`;
      return;
    }
    el.innerHTML = comments.map(c => {
      const author = (c.userID && state.userMap[c.userID]) || (c.commentEmailAddress) || 'Unknown';
      return `<div class="comment-item">
        <div class="comment-meta">${escHtml(author)} &middot; ${fmtDate(c.timestamp)}</div>
        <div class="comment-text">${escHtml(c.comment)}</div>
      </div>`;
    }).join('');
  }).catch(() => {
    const el = document.getElementById('detail-comments-list');
    if (el) el.innerHTML = `<p class="detail-value detail-empty">Failed to load comments.</p>`;
  });
}

function closeDetail() {
  document.getElementById('detail-modal').classList.add('hidden');
}

// ── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(msg, duration = 3000) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), duration);
}

// ── Trello config UI ──────────────────────────────────────────────────────────

function updateTrelloDot(configured) {
  const dot = document.getElementById('trello-dot');
  if (!dot) return;
  dot.className = 'trello-dot ' + (configured ? 'trello-dot-green' : 'trello-dot-gray');
}

async function openTrelloConfig() {
  document.getElementById('trello-modal').classList.remove('hidden');
  const cfg = await apiFetch('/api/trello/config').catch(() => ({ configured: false }));
  state.trello = cfg;
  updateTrelloDot(cfg.configured);
  cfg.configured ? showConnectedStep(cfg) : showCredentialsStep();
}

function showCredentialsStep() {
  document.getElementById('trello-modal-title').textContent = 'Connect Trello';
  document.getElementById('trello-modal-body').innerHTML = `
    <p>Enter your Trello credentials to enable dispatch sync.</p>
    <p class="field-hint">Get API key: <a href="https://trello.com/power-ups/admin" target="_blank">trello.com/power-ups/admin</a></p>
    <div class="field">
      <label>API Key</label>
      <input id="trello-key-input" type="text" placeholder="API key" />
    </div>
    <div class="field">
      <label>Token</label>
      <input id="trello-token-input" type="text" placeholder="Token" />
      <p class="field-hint">Token URL: https://trello.com/1/authorize?expiration=never&amp;scope=read,write&amp;response_type=token&amp;key=YOUR_KEY</p>
    </div>
    <button id="trello-connect-btn" class="btn btn-primary">Next: Choose List &rarr;</button>
  `;
  document.getElementById('trello-connect-btn').addEventListener('click', connectTrello);
}

async function connectTrello() {
  const key = document.getElementById('trello-key-input').value.trim();
  const token = document.getElementById('trello-token-input').value.trim();
  if (!key || !token) { showToast('Enter both API key and token'); return; }
  const btn = document.getElementById('trello-connect-btn');
  btn.disabled = true; btn.textContent = 'Fetching boards\u2026';
  try {
    const boards = await apiFetch(`/api/trello/boards?key=${encodeURIComponent(key)}&token=${encodeURIComponent(token)}`);
    showBoardStep(boards, key, token);
  } catch (e) {
    showToast('Invalid credentials or Trello unreachable');
    btn.disabled = false; btn.textContent = 'Next: Choose List \u2192';
  }
}

function showBoardStep(boards, key, token) {
  document.getElementById('trello-modal-title').textContent = 'Choose Inbox List';
  const boardOpts = boards.map(b => `<option value="${b.boardID}">${escHtml(b.board)}</option>`).join('');
  const firstLists = boards[0]?.lists ?? [];
  const listOpts = firstLists.map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('');
  document.getElementById('trello-modal-body').innerHTML = `
    <p>Choose the Trello list where new Open work orders will appear.</p>
    <div class="field">
      <label>Board</label>
      <select id="trello-board-sel">${boardOpts}</select>
    </div>
    <div class="field">
      <label>Inbox List</label>
      <select id="trello-list-sel">${listOpts}</select>
    </div>
    <button id="trello-save-btn" class="btn btn-primary">Save</button>
  `;
  const saveBtn = document.getElementById('trello-save-btn');
  saveBtn._key = key;
  saveBtn._token = token;
  saveBtn._boards = boards;
  document.getElementById('trello-board-sel').addEventListener('change', () => onBoardChange(boards));
  saveBtn.addEventListener('click', saveTrelloConfig);
}

function onBoardChange(boards) {
  const bid = document.getElementById('trello-board-sel').value;
  const board = boards.find(b => b.boardID === bid);
  const lists = board?.lists ?? [];
  document.getElementById('trello-list-sel').innerHTML =
    lists.map(l => `<option value="${l.id}">${escHtml(l.name)}</option>`).join('');
}

async function saveTrelloConfig() {
  const btn = document.getElementById('trello-save-btn');
  const key = btn._key; const token = btn._token; const boards = btn._boards;
  const bid = document.getElementById('trello-board-sel').value;
  const lid = document.getElementById('trello-list-sel').value;
  const board = boards.find(b => b.boardID === bid);
  const list = board?.lists.find(l => l.id === lid);
  btn.disabled = true; btn.textContent = 'Saving\u2026';
  try {
    const resp = await fetch('/api/trello/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, token, list_id: lid, list_name: list?.name, board_name: board?.board }),
    });
    if (!resp.ok) throw new Error('Save failed');
    state.trello = { configured: true, list_name: list?.name, board_name: board?.board };
    updateTrelloDot(true);
    showConnectedStep(state.trello);
    showToast('Trello connected');
  } catch (e) {
    showToast('Save failed \u2014 check credentials');
    btn.disabled = false; btn.textContent = 'Save';
  }
}

function showConnectedStep(cfg) {
  document.getElementById('trello-modal-title').textContent = 'Trello Connected';
  document.getElementById('trello-modal-body').innerHTML = `
    <p class="trello-connected-msg">&#10003; Connected to <strong>${escHtml(cfg.board_name || 'Trello')}</strong> &mdash; inbox list: <strong>${escHtml(cfg.list_name || cfg.list_id || '')}</strong></p>
    <p>Open work orders sync automatically after each refresh. Cards are archived when WOs close.</p>
    <button id="trello-disconnect-btn" class="btn btn-secondary">Disconnect</button>
  `;
  document.getElementById('trello-disconnect-btn').addEventListener('click', disconnectTrello);
}

async function disconnectTrello() {
  await fetch('/api/trello/config', { method: 'DELETE' });
  state.trello = { configured: false };
  updateTrelloDot(false);
  showToast('Trello disconnected');
  showCredentialsStep();
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

  document.getElementById('btn-refresh').addEventListener('click', () => fetchWorkOrders(true));
  document.getElementById('search').addEventListener('input', e => {
    state.filter.search = e.target.value.trim();
    renderMain();
  });

  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeDetail();
  });

  // Load Trello config state (updates dot)
  apiFetch('/api/trello/config')
    .then(cfg => { state.trello = cfg; updateTrelloDot(cfg.configured); })
    .catch(() => {});

  document.getElementById('btn-trello').addEventListener('click', openTrelloConfig);
  document.getElementById('trello-close').addEventListener('click', () => {
    document.getElementById('trello-modal').classList.add('hidden');
  });
  document.getElementById('trello-modal').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('trello-modal').classList.add('hidden');
  });

  refreshTagFilter();
  fetchWorkOrders();
  setInterval(fetchWorkOrders, REFRESH_INTERVAL_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
