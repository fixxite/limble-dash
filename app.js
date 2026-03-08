/* Limble CMMS Dashboard — app.js */
'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const PRIORITY_MAP = {
  '': { label: 'None', cls: 'none' },
  '1': { label: 'Low', cls: 'low' },
  '2': { label: 'Medium', cls: 'medium' },
  '3': { label: 'High', cls: 'high' },
  '4': { label: 'Critical', cls: 'critical' },
};

const STATUS_MAP = {
  '1': { label: 'Open', cls: 'open' },
  '2': { label: 'In Progress', cls: 'inprogress' },
  '3': { label: 'Completed', cls: 'completed' },
};

const REFRESH_INTERVAL_MS = 60_000;
const TAGS_STORAGE_KEY = 'limble_dash_tags';
const WO_TAGS_STORAGE_KEY = 'limble_dash_wo_tags';

// ── State ────────────────────────────────────────────────────────────────────

const state = {
  workOrders: [],
  filter: { status: 'all', priority: 'all', tag: 'all' },
  loading: false,
  error: null,
  editTarget: null,
  tags: loadTagsFromStorage(),       // [{ id, label, color }]
  nextTagId: 0,                      // set after load
  woTagMap: loadWoTagsFromStorage(), // { [woId]: [tagId, ...] }
  modalTagIds: new Set(),            // tags selected in current open modal
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

async function apiFetch(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(path, opts);
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
    const data = await apiFetch('GET', '/api/workorders');
    state.workOrders = Array.isArray(data) ? data : (data.data ?? []);
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    renderMain();
  }
}

async function createWorkOrder(payload) {
  return apiFetch('POST', '/api/workorders', payload);
}

async function updateWorkOrder(id, payload) {
  return apiFetch('PATCH', `/api/workorders/${id}`, payload);
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
  const id = wo.id ?? wo.workOrderID;
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

// ── Filters ──────────────────────────────────────────────────────────────────

function applyFilters(orders) {
  return orders.filter(wo => {
    const { status, priority, tag } = state.filter;

    if (status !== 'all') {
      const sid = String(wo.statusID ?? wo.status ?? '');
      const cls = (STATUS_MAP[sid]?.cls ?? sid).toLowerCase();
      if (cls !== status.toLowerCase().replace(/\s+/g, '')) return false;
    }

    if (priority !== 'all') {
      const pid = String(wo.priorityID ?? wo.priority ?? '');
      const cls = (PRIORITY_MAP[pid]?.cls ?? pid).toLowerCase();
      if (cls !== priority.toLowerCase()) return false;
    }

    if (tag !== 'all') {
      const tid = Number(tag);
      if (!woTagIds(wo).includes(tid)) return false;
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
  try { return new Date(val).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return val; }
}

function fmtStatus(wo) {
  const sid = String(wo.statusID ?? wo.status ?? '');
  return STATUS_MAP[sid] ?? { label: sid || 'Unknown', cls: 'unknown' };
}

function fmtPriority(wo) {
  const pid = String(wo.priorityID ?? wo.priority ?? '');
  return PRIORITY_MAP[pid] ?? PRIORITY_MAP[''];
}

function renderCard(wo) {
  const status = fmtStatus(wo);
  const priority = fmtPriority(wo);
  const tags = woTagIds(wo);
  const card = el('div', 'card');
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Edit work order: ${wo.name || wo.title || 'Untitled'}`);

  card.innerHTML = `
    <div class="card-header">
      <span class="card-title">${escHtml(wo.name || wo.title || 'Untitled')}</span>
      <span class="badge badge-${status.cls}">${status.label}</span>
    </div>
    <div class="card-meta">
      <div class="card-meta-row">
        <span class="priority-dot priority-${priority.cls}" title="Priority: ${priority.label}"></span>
        <span><span class="label">Priority:</span> ${priority.label}</span>
      </div>
      ${wo.assetName ? `<div class="card-meta-row"><span class="label">Asset:</span> ${escHtml(wo.assetName)}</div>` : ''}
      ${wo.assignedTo ? `<div class="card-meta-row"><span class="label">Assignee:</span> ${escHtml(wo.assignedTo)}</div>` : ''}
      ${wo.dueDate ? `<div class="card-meta-row"><span class="label">Due:</span> ${fmtDate(wo.dueDate)}</div>` : ''}
    </div>
    ${tagChipsHtml(tags)}
    <div class="card-footer">Updated ${fmtDate(wo.updatedAt ?? wo.updated_at ?? wo.lastUpdated)}</div>
  `;

  const open = () => openModal(wo);
  card.addEventListener('click', open);
  card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
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

  const filtered = applyFilters(state.workOrders);
  countEl.textContent = `${filtered.length} of ${state.workOrders.length} work orders`;

  if (filtered.length === 0) {
    main.innerHTML = '<div class="state-box"><h3>No work orders found</h3><p>Try adjusting your filters or create a new work order.</p></div>';
    return;
  }

  const grid = el('div', 'card-grid');
  filtered.forEach(wo => grid.appendChild(renderCard(wo)));
  main.innerHTML = '';
  main.appendChild(grid);
}

// ── Modal tag UI ─────────────────────────────────────────────────────────────

function renderModalTagSelector() {
  const container = document.getElementById('tag-selector');
  const manageList = document.getElementById('tag-manage-list');
  if (!container) return;

  if (state.tags.length === 0) {
    container.innerHTML = '<span class="tag-selector-empty">No tags yet — create one below</span>';
  } else {
    container.innerHTML = state.tags.map(tag => {
      const sel = state.modalTagIds.has(tag.id) ? 'selected' : '';
      return `<span class="tag-selector-chip ${sel}" data-tag-id="${tag.id}"
        style="${tagChipStyle(tag.color)}">${escHtml(tag.label)}</span>`;
    }).join('');
    container.querySelectorAll('.tag-selector-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const tid = Number(chip.dataset.tagId);
        if (state.modalTagIds.has(tid)) {
          state.modalTagIds.delete(tid);
          chip.classList.remove('selected');
        } else {
          state.modalTagIds.add(tid);
          chip.classList.add('selected');
        }
      });
    });
  }

  if (manageList) {
    if (state.tags.length === 0) {
      manageList.innerHTML = '';
    } else {
      manageList.innerHTML = state.tags.map(tag =>
        `<div class="tag-manage-row">
          <span class="tag-chip" style="${tagChipStyle(tag.color)}">${escHtml(tag.label)}</span>
          <button type="button" class="tag-delete-btn" data-tag-id="${tag.id}" title="Delete tag">✕</button>
        </div>`
      ).join('');
      manageList.querySelectorAll('.tag-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const tid = Number(btn.dataset.tagId);
          state.tags = state.tags.filter(t => t.id !== tid);
          state.modalTagIds.delete(tid);
          // Remove from all WOs
          for (const key of Object.keys(state.woTagMap)) {
            state.woTagMap[key] = state.woTagMap[key].filter(id => id !== tid);
          }
          saveTagsToStorage();
          saveWoTagsToStorage();
          refreshTagFilter();
          renderModalTagSelector();
        });
      });
    }
  }
}

// ── Modal ────────────────────────────────────────────────────────────────────

function openModal(wo = null) {
  state.editTarget = wo;
  const overlay = document.getElementById('modal-overlay');
  const title = document.getElementById('modal-title');
  const form = document.getElementById('wo-form');
  const errBox = document.getElementById('form-error');

  title.textContent = wo ? 'Edit Work Order' : 'New Work Order';
  errBox.classList.add('hidden');
  errBox.textContent = '';

  form.elements['name'].value = wo?.name ?? wo?.title ?? '';
  form.elements['description'].value = wo?.description ?? '';
  form.elements['priorityID'].value = String(wo?.priorityID ?? wo?.priority ?? '');
  form.elements['statusID'].value = String(wo?.statusID ?? wo?.status ?? '1');
  form.elements['dueDate'].value = wo?.dueDate ? wo.dueDate.split('T')[0] : '';

  // Seed modal tag selection from WO's saved tags
  state.modalTagIds = new Set(wo ? woTagIds(wo) : []);
  renderModalTagSelector();

  // Reset new-tag inputs
  const newTagInput = document.getElementById('new-tag-input');
  if (newTagInput) newTagInput.value = '';

  overlay.classList.remove('hidden');
  form.elements['name'].focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  state.editTarget = null;
  state.modalTagIds = new Set();
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('form-submit');

  const name = form.elements['name'].value.trim();
  if (!name) { showFormError('Title is required.'); return; }

  const payload = {
    name,
    description: form.elements['description'].value.trim(),
    priorityID: form.elements['priorityID'].value ? Number(form.elements['priorityID'].value) : null,
    statusID: Number(form.elements['statusID'].value),
    dueDate: form.elements['dueDate'].value || null,
  };

  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving…';
  document.getElementById('form-error').classList.add('hidden');

  try {
    let woId;
    if (state.editTarget) {
      woId = state.editTarget.id ?? state.editTarget.workOrderID;
      await updateWorkOrder(woId, payload);
    } else {
      const created = await createWorkOrder(payload);
      woId = created?.id ?? created?.workOrderID;
    }
    // Save tags locally
    if (woId != null) {
      state.woTagMap[woId] = [...state.modalTagIds];
      saveWoTagsToStorage();
    }
    closeModal();
    await fetchWorkOrders();
  } catch (err) {
    showFormError(err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Save';
  }
}

function showFormError(msg) {
  const errBox = document.getElementById('form-error');
  errBox.textContent = msg;
  errBox.classList.remove('hidden');
}

// ── Utilities ────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function init() {
  // Filters
  document.getElementById('filter-status').addEventListener('change', e => {
    state.filter.status = e.target.value; renderMain();
  });
  document.getElementById('filter-priority').addEventListener('change', e => {
    state.filter.priority = e.target.value; renderMain();
  });
  document.getElementById('filter-tag').addEventListener('change', e => {
    state.filter.tag = e.target.value; renderMain();
  });

  // Buttons
  document.getElementById('btn-new').addEventListener('click', () => openModal(null));
  document.getElementById('btn-refresh').addEventListener('click', fetchWorkOrders);

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('form-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // Form submit
  document.getElementById('wo-form').addEventListener('submit', handleFormSubmit);

  // Create tag
  document.getElementById('btn-create-tag').addEventListener('click', () => {
    const input = document.getElementById('new-tag-input');
    const colorInput = document.getElementById('new-tag-color');
    const label = input.value.trim();
    if (!label) { input.focus(); return; }
    if (state.tags.find(t => t.label.toLowerCase() === label.toLowerCase())) {
      input.select(); return;
    }
    const tag = { id: state.nextTagId++, label, color: colorInput.value };
    state.tags.push(tag);
    state.modalTagIds.add(tag.id);
    saveTagsToStorage();
    refreshTagFilter();
    renderModalTagSelector();
    input.value = '';
    input.focus();
  });

  // Allow Enter in tag input
  document.getElementById('new-tag-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-create-tag').click(); }
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
