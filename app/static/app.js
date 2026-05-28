// ── Settings cache & display helpers ──────────────────────────────────────

let _serverSettings = {};

function _toDisplayTemp(celsius) {
  return _serverSettings.temp_unit === 'F'
    ? Math.round(celsius * 9/5 + 32)
    : Math.round(celsius);
}
function _fromDisplayTemp(display) {
  return _serverSettings.temp_unit === 'F'
    ? Math.round((display - 32) * 5/9)
    : display;
}
function _tempUnitLabel() { return _serverSettings.temp_unit === 'F' ? '°F' : '°'; }
function _clockOpts(extra = {}) {
  return { hour: '2-digit', minute: '2-digit', hour12: _serverSettings.time_format !== '24h', ...extra };
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function _effectiveLightState(p) {
  const opt = _lightOptimistic[p.id];
  if (opt && Date.now() < opt.expiresAt) return opt.state;
  if (opt) delete _lightOptimistic[p.id];
  return p.light_state || 'unknown';
}

function _printerModelHtml(p) {
  const kind = p.kind || p.connection?.type;
  const lightState = _effectiveLightState(p);
  const lit = kind === 'bambu' && lightState === 'on';
  const clickable = kind === 'bambu';
  const cls = `printer-model${kind === 'bambu' ? ' printer-model-bambu' : ''}${lit ? ' printer-model-lit' : ''}${clickable ? ' printer-model-light-toggle' : ''}`;
  const title = kind === 'bambu' ? `Bambu chamber light: ${lightState}` : '';
  const attrs = clickable
    ? `data-light-printer="${p.id}" data-light-toggle="${p.id}" role="button" tabindex="0"`
    : `data-light-printer="${p.id}"`;
  return `<span class="${cls}" ${attrs} title="${esc(title)}">${esc(p.model_name)}</span>`;
}

function _bambuLightWordHtml(p) {
  const lightState = _effectiveLightState(p);
  const lit = lightState === 'on';
  return `<button class="bambu-light-word printer-model-bambu${lit ? ' printer-model-lit' : ''}"
    type="button"
    data-light-toggle="${p.id}"
    title="Bambu chamber light: ${esc(lightState)}">Bambu</button>`;
}

function _refreshLightBadges(id) {
  const p = _latestPrinters.find(x => x.id === id);
  if (!p) return;
  document.querySelectorAll(`[data-light-printer="${CSS.escape(id)}"]`).forEach(el => {
    el.outerHTML = _printerModelHtml(p);
  });
}

async function loadSettings() {
  // One-time migration: push any existing localStorage value to the server
  const legacy = localStorage.getItem('fd_accent');
  if (legacy) {
    try {
      await fetch('/api/settings/accent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: legacy }),
      });
    } catch {}
    localStorage.removeItem('fd_accent');
  }

  try {
    const r = await fetch('/api/settings');
    if (r.ok) _serverSettings = await r.json();
  } catch {}

  const accent = _serverSettings.accent ?? '#3b82f6';
  document.documentElement.style.setProperty('--printing', accent);
}

// ── Per-printer accent colours ────────────────────────────────────────────
const _PRINTER_ACCENT_PALETTE = ['#a855f7', '#22c55e', '#f59e0b', '#60a5fa', '#ef4444'];

function _printerColor(id) {
  const idx = _latestPrinters.findIndex(x => x.id === id);
  return _PRINTER_ACCENT_PALETTE[Math.max(0, idx) % _PRINTER_ACCENT_PALETTE.length];
}

// ── Printer icons ──────────────────────────────────────────────────────────

const ICONS = {
  voron: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="12,2 21,7 21,17 12,22 3,17 3,7"
             fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linejoin="round"/>
    <path d="M8 8 L7 16 L10 16 L11 8 Z" fill="currentColor"/>
    <path d="M14 8 L13 16 L16 16 L17 8 Z" fill="currentColor"/>
  </svg>`,

  bambu: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.6" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <path d="M5 3 L19 3 L19 19 L5 19 Z"/>
    <path d="M5 3 L12 8 L19 3"/>
    <path d="M12 8 L12 19"/>
  </svg>`,

  generic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.5" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="8" width="18" height="13" rx="1"/>
    <path d="M7 8 V5 H17 V8"/>
    <circle cx="17" cy="14" r="1.5" fill="currentColor" stroke="none"/>
    <rect x="7" y="13" width="6" height="4" rx="0.5"/>
  </svg>`,
};

function getIcon(key) {
  return ICONS[key] ?? ICONS.generic;
}


let _latestPrinters = [];
let _tabsBuilt = false;
let _missionRenderInFlight = false;
let _missionLastHtml = '';
const _cameraUrlCache = {};     // printer_id → url string or null
let _renderedDetailId = null;
let _renderedDetailSubtab = null;
let _renderedDetailOk = false;
const _pendingControls = {};    // printer_id → { action, fromState }
const _lightOptimistic = {};    // printer_id → { state, expiresAt }
const _tempOptimistic = {};     // `${id}:${heater}` → { sentTarget, expiresAt }
const _objectsCache = {};       // printer_id → { supported, objects }
const _historyYear = {};        // printer_id → selected year (int)
const _dayPrintsCache = {};     // `${printerId}:${dateStr}` → prints[]
let _camerasFull = false;       // true once cameras grid has been fully rendered
let _camerasMode = 'live';       // live | sim30
let _camZoom = 0;               // 0=normal, 1=wide, 2=fullscreen
let _onSettings = false;        // true while settings view is active
let _onFailures = false;        // true while failure review is active
let _onSpools = false;          // true while spool inventory is active

// ── Toast notifications ────────────────────────────────────────────────────

const _toastContainer = document.createElement('div');
_toastContainer.id = 'toast-container';
document.body.appendChild(_toastContainer);

function showToast(message, sub, type = 'info', opts = {}) {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const noteBtn = opts.addNote
    ? `<button class="toast-note-btn" title="Add a note to this print">Add note</button>`
    : '';
  t.innerHTML = `<span class="toast-msg">${message}</span>${sub ? `<span class="toast-sub">${sub}</span>` : ''}${noteBtn}`;
  _toastContainer.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-in'));
  const remove = () => {
    t.classList.remove('toast-in');
    t.addEventListener('transitionend', () => t.remove(), { once: true });
  };
  const timer = setTimeout(remove, 5000);
  t.addEventListener('click', e => {
    if (e.target.classList.contains('toast-note-btn')) {
      e.stopPropagation();
      clearTimeout(timer);
      remove();
      _openNoteModal(opts.printerId);
      return;
    }
    clearTimeout(timer);
    remove();
  });
}

function _openNoteModal(printerId) {
  fetch(`/api/printers/${printerId}/prints/latest-finished`)
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      if (!data) return;
      _showNoteEditor(printerId, data.print_id, '', null);
    })
    .catch(() => {});
}

function _showNoteEditor(printerId, printId, existing, onSaved) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box note-editor-modal">
      <div class="modal-message" style="margin-bottom:0.75rem">Print note</div>
      <textarea class="note-textarea" rows="4" placeholder="Add a note about this print…">${existing ?? ''}</textarea>
      <div class="modal-actions" style="margin-top:0.75rem">
        <button class="modal-btn" id="note-cancel">Cancel</button>
        <button class="modal-btn" id="note-save" style="background:rgba(30,80,30,0.4);border-color:#16a34a;color:#86efac">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const ta = overlay.querySelector('.note-textarea');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  const close = () => overlay.remove();
  overlay.querySelector('#note-cancel').addEventListener('click', close);
  overlay.querySelector('#note-save').addEventListener('click', async () => {
    const notes = ta.value.trim();
    try {
      await fetch(`/api/printers/${printerId}/prints/${printId}/notes`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      });
      close();
      if (onSaved) onSaved(notes);
    } catch {}
  });
  // Enter = save (shift+enter = newline)
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); overlay.querySelector('#note-save').click(); }
    if (e.key === 'Escape') close();
  });
}

// ── Temperature modal ─────────────────────────────────────────────────────

const _tempModal = (() => {
  let _composed = '';
  let _printerId = null;
  let _heater = null;
  let _max = 300;

  const overlay = document.createElement('div');
  overlay.className = 'temp-modal-overlay';
  overlay.setAttribute('hidden', '');
  overlay.innerHTML = `
    <div class="temp-modal" role="dialog" aria-modal="true">
      <div class="temp-modal-header">
        <span class="temp-modal-title" id="tm-title">HOTEND</span>
        <button class="temp-modal-close" id="tm-close">✕</button>
      </div>
      <div class="temp-modal-display">
        <span class="temp-modal-current">Current <strong id="tm-current">—°</strong></span>
        <span class="temp-modal-arrow">→</span>
        <span class="temp-modal-composed" id="tm-composed">___</span>
      </div>
      <div class="temp-modal-body">
        <div class="temp-keypad">
          ${[1,2,3,4,5,6,7,8,9,'⌫',0,'✓'].map(k =>
            `<button class="temp-key${k==='⌫'?' temp-key-back':k==='✓'?' temp-key-confirm':''}" data-key="${k}">${k}</button>`
          ).join('')}
        </div>
        <div class="temp-modal-presets" id="tm-presets"></div>
      </div>
      <div class="temp-modal-warning" id="tm-warning" hidden>That's hot — double-check before confirming</div>
      <div class="temp-modal-range" id="tm-range">Range: 0–300°C</div>
    </div>`;
  document.body.appendChild(overlay);

  function close() {
    overlay.setAttribute('hidden', '');
    _composed = '';
    _printerId = null;
    _heater = null;
  }

  function updateDisplay() {
    overlay.querySelector('#tm-composed').textContent = _composed || '___';
    const val = parseInt(_composed, 10);
    const hot = _composed && !isNaN(val) && (
      (_heater === 'bed' ? val > _toDisplayTemp(120) : val > _toDisplayTemp(280))
    );
    const w = overlay.querySelector('#tm-warning');
    if (hot) w.removeAttribute('hidden'); else w.setAttribute('hidden', '');
  }

  function handleKey(key) {
    if (key === '✓') { doConfirm(); return; }
    if (key === '⌫') {
      _composed = _composed.slice(0, -1);
    } else {
      if (_composed.length >= 3) return;
      _composed += String(key);
    }
    overlay.querySelectorAll('.temp-preset-btn').forEach(b => b.classList.remove('preset-active'));
    updateDisplay();
  }

  function doConfirm() {
    if (!_composed) return;
    const displayVal = parseInt(_composed, 10);
    if (isNaN(displayVal)) return;
    const celsiusVal = _fromDisplayTemp(displayVal);
    const clampedC = Math.max(0, Math.min(_max, celsiusVal));
    if (clampedC !== celsiusVal) {
      _composed = String(_toDisplayTemp(clampedC));
      const el = overlay.querySelector('#tm-composed');
      el.classList.add('composed-clamp');
      el.textContent = _composed;
      setTimeout(() => el.classList.remove('composed-clamp'), 500);
      return;
    }
    sendTempSet(_printerId, _heater, clampedC);
    close();
  }

  overlay.addEventListener('click', e => {
    if (e.target === overlay) { close(); return; }
    const keyBtn = e.target.closest('[data-key]');
    if (keyBtn) { handleKey(keyBtn.dataset.key); return; }
    const presetBtn = e.target.closest('[data-value]');
    if (presetBtn) {
      _composed = presetBtn.dataset.value;
      overlay.querySelectorAll('.temp-preset-btn').forEach(b => b.classList.remove('preset-active'));
      presetBtn.classList.add('preset-active');
      updateDisplay();
    }
  });

  overlay.querySelector('#tm-close').addEventListener('click', close);

  // Physical keyboard — digits, backspace, enter while modal is open
  document.addEventListener('keydown', e => {
    if (!isOpen()) return;
    if (e.key >= '0' && e.key <= '9') { e.preventDefault(); handleKey(e.key); }
    else if (e.key === 'Backspace')    { e.preventDefault(); handleKey('⌫'); }
    else if (e.key === 'Enter')        { e.preventDefault(); doConfirm(); }
  });

  function open({ printerId, heater, label, current, target, presets = [], max = 300 }) {
    _printerId = printerId;
    _heater = heater;
    _max = max;  // always Celsius
    const unit = _tempUnitLabel();
    _composed = target > 0 ? String(_toDisplayTemp(target)) : '';
    overlay.querySelector('#tm-title').textContent = label.toUpperCase();
    overlay.querySelector('#tm-current').textContent = `${_toDisplayTemp(current)}${unit}`;
    overlay.querySelector('#tm-range').textContent = `Range: 0–${_toDisplayTemp(max)}${unit}`;
    const allPresets = [{ label: 'Off', value: 0 }, ...presets];
    overlay.querySelector('#tm-presets').innerHTML = allPresets
      .map(p => `<button class="temp-preset-btn" data-value="${p.value > 0 ? _toDisplayTemp(p.value) : 0}">${p.label}</button>`)
      .join('');
    overlay.querySelector('#tm-warning').setAttribute('hidden', '');
    updateDisplay();
    overlay.removeAttribute('hidden');
  }

  function isOpen() { return !overlay.hasAttribute('hidden'); }

  return { open, close, isOpen };
})();

// ── Confirmation modal ─────────────────────────────────────────────────────

const _modal = (() => {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay hidden';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-message" id="modal-msg"></div>
      <div class="modal-actions">
        <button class="modal-btn" id="modal-no">Cancel</button>
        <button class="modal-btn modal-btn-danger" id="modal-yes">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
  overlay.querySelector('#modal-no').addEventListener('click', () => overlay.classList.add('hidden'));
  return {
    show(message, onConfirm) {
      overlay.querySelector('#modal-msg').textContent = message;
      overlay.querySelector('#modal-yes').onclick = () => {
        overlay.classList.add('hidden');
        onConfirm();
      };
      overlay.classList.remove('hidden');
    },
  };
})();

function formatTime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}


// ── Event wiring ───────────────────────────────────────────────────────────

function attachCardEvents(card) {
  card.addEventListener('click', () => {
    location.hash = `#/printer/${card.dataset.printerId}`;
  });
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      location.hash = `#/printer/${card.dataset.printerId}`;
    }
  });
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && _camZoom === 2) {
    _camZoom = 0;
    document.querySelector('.detail-body')?.classList.remove('cam-wide');
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (_tempModal.isOpen()) { _tempModal.close(); return; }
  if (_camZoom !== 1) return;
  // ESC in wide mode (state 1) — browser handles ESC for fullscreen (state 2)
  _camZoom = 0;
  document.querySelector('.detail-body')?.classList.remove('cam-wide');
});

// ── Connection dot helpers ─────────────────────────────────────────────────

function parseUtcDate(str) {
  if (!str) return null;
  if (!str.endsWith('Z') && !str.match(/[+-]\d{2}:\d{2}$/)) str += 'Z';
  return new Date(str);
}

function fmtLastSeen(lastSeen) {
  const d = parseUtcDate(lastSeen);
  if (!d) return 'Never connected';
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], _clockOpts());
  if (isToday) return `Last connected ${time}`;
  const date = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `Last connected ${date}, ${time}`;
}

function connDot(lastSeen) {
  const d = parseUtcDate(lastSeen);
  let cls = 'red';
  let label = 'No signal';
  let age = 'never';
  if (d) {
    const ageSec = (Date.now() - d.getTime()) / 1000;
    age = `${Math.round(ageSec)}s ago`;
    if (ageSec < 10) { cls = 'green'; label = 'Connected'; }
    else if (ageSec < 30) { cls = 'amber'; label = 'Degraded'; }
    else { cls = 'red'; label = 'No signal'; }
  }
  return `<div class="conn-dot conn-${cls}" title="${label} · last update ${age}"></div>`;
}

// ── Card rendering ─────────────────────────────────────────────────────────

function formatEta(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const _TEMP_SORT = { hotend_l: 0, hotend_r: 1, hotend: 2, bed: 3, chamber: 4 };

function _tempClass(actual) {
  if (actual >= 180) return ' temp-hot';
  if (actual >= 60)  return ' temp-warm';
  return '';
}

function renderTemp(label, reading) {
  const actual = _toDisplayTemp(reading.actual);
  const cls = _tempClass(reading.actual);
  const unit = _tempUnitLabel();
  const target = reading.target > 0
    ? `<span class="temp-target">/${_toDisplayTemp(reading.target)}${unit}</span>`
    : '';
  return `
    <div class="temp-item">
      <span class="temp-label">${label}</span>
      <span class="temp-value${cls}">${actual}${unit}${target}</span>
    </div>`;
}

const TEMP_LABELS = { hotend: 'Hotend', hotend_l: 'Left', hotend_r: 'Right', bed: 'Bed', chamber: 'Chamber' };

function _healthBadge(health) {
  if (!health) return '';
  return `<span class="health-badge health-${health.status}" title="${esc((health.reasons || []).map(r => r.message).join(' · ') || health.label)}">${health.label}</span>`;
}

function _healthLine(health) {
  if (!health?.reasons?.length) return '';
  return `<div class="health-line">${esc(health.reasons[0].message)}</div>`;
}

function _dashboardStateRank(p) {
  const stateRank = {
    estop: 0,
    error: 1,
    paused: 2,
    printing: 3,
    offline: 4,
    finished: 5,
    idle: 6
  };
  let rank = stateRank[p.state] ?? 7;
  if (p.health?.status === 'attention') rank = Math.min(rank, 1);
  if (p.health?.status === 'watch') rank = Math.min(rank, 2);
  return rank;
}

function _dashboardPrinterName(p) {
  return _printerNavLabel(p);
}

function _printerNavLabel(p) {
  return p.model_name || p.custom_name || p.id;
}

function _dashboardIssueText(p) {
  if (p.state === 'estop') return 'Emergency stop active';
  if (p.state === 'error') return p.error || 'Printer error';
  if (p.state === 'paused') return 'Paused mid-print';
  if (p.health?.reasons?.length) return p.health.reasons[0].message;
  if (p.state === 'offline') return `Offline ${fmtLastSeen(p.last_seen)}`;
  if (p.state === 'printing') {
    const pct = p.job?.progress != null ? `${Math.round(p.job.progress * 100)}%` : 'active';
    return `Printing ${pct}`;
  }
  return p.state || 'idle';
}

function _renderDashboardOverview(printers) {
  const counts = printers.reduce((acc, p) => {
    acc[p.state] = (acc[p.state] || 0) + 1;
    if (p.health?.status === 'attention' || p.health?.status === 'watch') acc.health += 1;
    return acc;
  }, { health: 0 });
  const printing = counts.printing || 0;
  const paused = counts.paused || 0;
  const hardStops = (counts.error || 0) + (counts.estop || 0);
  const offline = counts.offline || 0;
  const attention = printers
    .filter(p => ['estop', 'error', 'paused', 'offline'].includes(p.state) || ['attention', 'watch'].includes(p.health?.status))
    .sort((a, b) => _dashboardStateRank(a) - _dashboardStateRank(b) || _dashboardPrinterName(a).localeCompare(_dashboardPrinterName(b)))
    .slice(0, 5);

  const attentionHtml = attention.length ? attention.map(p => {
    const severity = p.state === 'error' || p.state === 'estop' || p.health?.status === 'attention'
      ? 'critical'
      : p.state === 'paused' || p.health?.status === 'watch'
        ? 'warn'
        : 'muted';
    return `<a class="dash-attention-item dash-attention-${severity}" href="#/printer/${encodeURIComponent(p.id)}">
      <span class="dash-attention-name">${esc(_dashboardPrinterName(p))}</span>
      <span class="dash-attention-text">${esc(_dashboardIssueText(p))}</span>
    </a>`;
  }).join('') : `
    <div class="dash-attention-empty">
      <span>All printers clear</span>
      <span>No active faults or health warnings</span>
    </div>`;

  return `
    <section class="dashboard-overview" aria-label="Dashboard overview">
      <div class="dashboard-kpis">
        <div class="dash-kpi">
          <span class="dash-kpi-value">${printers.length}</span>
          <span class="dash-kpi-label">Printers</span>
        </div>
        <div class="dash-kpi">
          <span class="dash-kpi-value">${printing}</span>
          <span class="dash-kpi-label">Printing</span>
        </div>
        <div class="dash-kpi ${paused ? 'dash-kpi-warn' : ''}">
          <span class="dash-kpi-value">${paused}</span>
          <span class="dash-kpi-label">Paused</span>
        </div>
        <div class="dash-kpi ${hardStops ? 'dash-kpi-critical' : ''}">
          <span class="dash-kpi-value">${hardStops}</span>
          <span class="dash-kpi-label">Faults</span>
        </div>
        <div class="dash-kpi ${counts.health ? 'dash-kpi-warn' : ''}">
          <span class="dash-kpi-value">${counts.health}</span>
          <span class="dash-kpi-label">Health</span>
        </div>
        <div class="dash-kpi ${offline ? 'dash-kpi-muted' : ''}">
          <span class="dash-kpi-value">${offline}</span>
          <span class="dash-kpi-label">Offline</span>
        </div>
      </div>
      <div class="dashboard-attention">
        <div class="dashboard-attention-head">
          <span>Needs attention</span>
          <span>${attention.length ? `${attention.length} active` : 'clear'}</span>
        </div>
        <div class="dash-attention-list">${attentionHtml}</div>
      </div>
    </section>`;
}

function jobDisplayName(job) {
  const raw = job.filename || '';
  const subtask = (job.subtask_name || '').trim();
  // Prefer subtask_name when it's meaningful and different from the filename
  if (subtask && subtask !== raw) return subtask;
  return raw.replace(/.*\//, '');
}

function renderCard(p) {
  const tabAttr = ' tabindex="0"';
  const dataAttr = ` data-printer-id="${p.id}"`;

  const temps = Object.entries(p.temps || {})
    .sort(([a], [b]) => (_TEMP_SORT[a] ?? 99) - (_TEMP_SORT[b] ?? 99))
    .map(([k, r]) => renderTemp(TEMP_LABELS[k] ?? k, r))
    .join('');

  let body = '';

  if (p.state === 'finished' && p.job) {
    const displayName = jobDisplayName(p.job);
    const hotend = p.temps?.hotend?.actual ?? 0;
    const cooling = hotend > 50
      ? `<div class="job-meta"><span>Hotend cooling · ${hotend.toFixed(0)}°</span></div>`
      : '';
    body = `
      <div class="job">
        <div class="job-filename" title="${p.job.filename}">${displayName}</div>
        <div class="job-meta"><span>Print complete</span><span>Layer ${p.job.layer_current ?? '—'}/${p.job.layer_total ?? '—'}</span></div>
        ${cooling}
      </div>`;

  } else if (p.job) {
    const pct = (p.job.progress * 100).toFixed(0);
    const displayName = jobDisplayName(p.job);
    const layers = p.job.layer_current != null && p.job.layer_total != null
      ? `Layer ${p.job.layer_current}/${p.job.layer_total}`
      : '';
    body = `
      <div class="job">
        <div class="job-filename" title="${p.job.filename}">${displayName}</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="job-meta">
          <span>${pct}%</span>
          <span>${layers}</span>
          <span>ETA ${p.eta_calibration?.ratio != null && p.job.eta_seconds != null ? formatEta(Math.round(p.job.eta_seconds * p.eta_calibration.ratio)) : formatEta(p.job.eta_seconds)}</span>
        </div>
      </div>`;
  }

  if (p.state === 'offline') {
    body = `<div class="offline-last-seen">${fmtLastSeen(p.last_seen)}</div>`;
  }

  if (p.state === 'estop') {
    body = `<div class="estop-body">Emergency stop active — firmware restart required</div>`;
  }

  const idleEntries = Object.entries(p.idle_info || {});
  const idleRows = idleEntries.length > 0 && p.state === 'idle' ? `
    <div class="idle-info">
      ${idleEntries.map(([k, v]) => `
        <div class="idle-row">
          <span class="idle-label">${k}</span>
          <span class="idle-value">${v}</span>
        </div>`).join('')}
    </div>` : '';

  const error = p.state !== 'offline' && p.error ? `<div class="error-msg">${p.error}</div>` : '';
  const badgeLabel = p.state === 'finished' ? 'complete' : p.state;

  // Loaded spools panel
  const loadedSpools = (_latestSpoolsByPrinter[p.id] || []).filter(s => !s.archived_at);
  const lowStockPct = _latestLowStockPct;
  const hasLowStock = loadedSpools.some(s => s.label_weight_g > 0 && (s.remaining_g / s.label_weight_g * 100) < lowStockPct);
  const lowStockBadge = hasLowStock
    ? `<span class="badge badge-loaded-low" title="Low filament on this printer">Low filament</span>`
    : '';
  const healthBadge = _healthBadge(p.health);
  const healthLine = _healthLine(p.health);

  const loadedPanel = loadedSpools.length > 0 ? `
    <div class="spool-loaded-panel">
      <div class="spool-loaded-title">Loaded</div>
      ${loadedSpools.map(s => {
        const pct = s.label_weight_g > 0 ? Math.round(s.remaining_g / s.label_weight_g * 100) : 100;
        const amber = pct < lowStockPct * 1.5 && pct >= lowStockPct;
        const low   = pct < lowStockPct;
        const cls   = low ? ' spool-low' : amber ? ' spool-amber' : '';
        const tc    = _spoolTextColor(s.color_hex || '#808080');
        return `<div class="spool-loaded-row">
          <span class="spool-loaded-swatch" style="background:${s.color_hex||'#808080'};color:${tc}" title="${s.color_name||s.color_hex||''}"></span>
          <span class="spool-loaded-name">${s.material}${s.brand ? ' · ' + s.brand : ''}</span>
          <span class="spool-loaded-pct${cls}">${pct}%</span>
        </div>`;
      }).join('')}
    </div>` : '';

  return `
    <div class="card"${tabAttr}${dataAttr}>
      <div class="card-header">
        <div class="printer-identity">
          <div class="printer-icon">${getIcon(p.icon)}</div>
          ${connDot(p.last_seen)}
          <div class="printer-names">
            ${_printerModelHtml(p)}
            <span class="printer-custom">${p.custom_name}</span>
          </div>
        </div>
        <div class="card-badges">
          ${healthBadge}
          ${lowStockBadge}
          <span class="badge badge-${p.state}">${badgeLabel}</span>
        </div>
      </div>
      ${temps ? `<div class="temps">${temps}</div>` : ''}
      ${body}
      ${idleRows}
      ${error}
      ${healthLine}
      ${loadedPanel}
    </div>`;
}

// ── Header status pill ─────────────────────────────────────────────────────

function updateStatusPill(printers) {
  const pill = document.getElementById('status-pill');
  if (!pill || !printers.length) return;
  const faults   = printers.filter(p => p.state === 'error').length;
  const warnings = printers.filter(p => p.state === 'paused' || p.state === 'offline').length;
  if (faults > 0) {
    pill.className = 'status-pill pill-error';
    pill.textContent = `${faults} fault${faults > 1 ? 's' : ''}`;
  } else if (warnings > 0) {
    pill.className = 'status-pill pill-warn';
    pill.textContent = `${warnings} warning${warnings > 1 ? 's' : ''}`;
  } else {
    pill.className = 'status-pill pill-ok';
    pill.textContent = 'All systems nominal';
  }
}

// ── Live indicator ─────────────────────────────────────────────────────────

function setLiveIndicator(connected) {
  const dot = document.getElementById('live-dot');
  const text = document.getElementById('live-text');
  if (!dot || !text) return;
  if (connected) {
    dot.className = 'live-dot live-ok';
    text.textContent = 'Live';
  } else {
    dot.className = 'live-dot live-err';
    text.textContent = 'Reconnecting…';
  }
}

// Clock — updates every second independent of data
setInterval(() => {
  document.getElementById('refresh-time').textContent = new Date().toLocaleTimeString([], _clockOpts());
}, 1000);
document.getElementById('refresh-time').textContent = new Date().toLocaleTimeString([], _clockOpts());

// ── Print controls ────────────────────────────────────────────────────────

function _canDo(state, action) {
  switch (action) {
    case 'light_on':
    case 'light_off':
      return state !== 'offline';
    case 'pause':            return state === 'printing';
    case 'resume':           return state === 'paused';
    case 'cancel':           return state === 'printing' || state === 'paused';
    case 'estop':            return state !== 'offline';
    case 'firmware_restart': return state === 'estop' || state === 'error';
    default: return false;
  }
}

function _detailControls(id, p) {
  const pending = _pendingControls[id];

  function btn(action, label, cls = '') {
    const canDo = _canDo(p.state, action);
    const isPending = pending?.action === action;
    const disabled = !canDo || (pending && !isPending) ? ' disabled' : '';
    const loadingCls = isPending ? ' ctrl-loading' : '';
    return `<button class="ctrl-btn ${cls}${loadingCls}" data-action="${action}" data-printer-id="${id}"${disabled}>${isPending ? '…' : label}</button>`;
  }

  const firmwareRestartBtn = p.kind === 'moonraker'
    ? btn('firmware_restart', 'Firmware Restart', 'ctrl-btn-firmware-restart')
    : '';
  const lightControls = p.kind === 'moonraker'
    ? `${btn('light_on', 'Bars On', 'ctrl-btn-light')}
       ${btn('light_off', 'Bars Off', 'ctrl-btn-light')}`
    : p.kind === 'bambu'
      ? _bambuLightWordHtml(p)
      : '';

  return `
    ${lightControls ? `<div class="controls-lights">${lightControls}</div>` : ''}
    <div class="controls-primary">
      ${btn('pause', 'Pause')}
      ${btn('resume', 'Resume')}
      ${btn('cancel', 'Cancel')}
    </div>
    <div class="controls-destructive">
      ${btn('estop', '⚠ E-Stop', 'ctrl-btn-estop')}
      ${firmwareRestartBtn}
    </div>`;
}

function _updateControlsWidget(id) {
  const p = _latestPrinters.find(x => x.id === id);
  const el = document.querySelector('.detail-controls-wrap');
  if (el && p) el.innerHTML = _detailControls(id, p);
}

async function sendControl(id, action) {
  const p = _latestPrinters.find(x => x.id === id);
  if (!p) return;

  if (action === 'light_on' || action === 'light_off') {
    _lightOptimistic[id] = {
      state: action === 'light_on' ? 'on' : 'off',
      expiresAt: Date.now() + 8000,
    };
    _refreshLightBadges(id);
  }

  _pendingControls[id] = { action, fromState: p.state };
  _updateControlsWidget(id);

  // Auto-clear after 10s if no WS confirmation arrives
  setTimeout(() => {
    if (_pendingControls[id]?.action === action) {
      delete _pendingControls[id];
      _updateControlsWidget(id);
    }
  }, 10000);

  try {
    const resp = await fetch(`/api/printers/${id}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!resp.ok) {
      delete _pendingControls[id];
      _updateControlsWidget(id);
    } else if (action === 'light_on' || action === 'light_off') {
      setTimeout(() => {
        if (_pendingControls[id]?.action === action) {
          delete _pendingControls[id];
          _updateControlsWidget(id);
        }
      }, 600);
    }
  } catch {
    delete _pendingControls[id];
    _updateControlsWidget(id);
  }
}

function toggleBambuLight(id) {
  const p = _latestPrinters.find(x => x.id === id);
  if (!p || p.kind !== 'bambu' || p.state === 'offline') return;
  const action = _effectiveLightState(p) === 'on' ? 'light_off' : 'light_on';
  sendControl(id, action);
}

// Delegated handler — wired once at startup
document.getElementById('view-printer').addEventListener('click', e => {
  const lightToggle = e.target.closest('[data-light-toggle]');
  if (lightToggle) {
    e.preventDefault();
    e.stopPropagation();
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;
  const { action, printerId: id } = btn.dataset;
  if (!id) return;

  const CONFIRM = {
    cancel:           'Cancel the print? This will stop the print immediately and discard progress.',
    estop:            'Emergency stop? The printer will halt all motion and require a manual reset to continue.',
    firmware_restart: 'Restart printer firmware? Klipper will reinitialise and the printer will need to home before printing.',
  };

  if (CONFIRM[action]) {
    _modal.show(CONFIRM[action], () => sendControl(id, action));
  } else {
    sendControl(id, action);
  }
});

document.addEventListener('click', e => {
  const lightToggle = e.target.closest('[data-light-toggle]');
  if (!lightToggle) return;
  e.preventDefault();
  e.stopPropagation();
  toggleBambuLight(lightToggle.dataset.lightToggle);
}, true);

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const lightToggle = e.target.closest?.('[data-light-toggle]');
  if (!lightToggle) return;
  e.preventDefault();
  e.stopPropagation();
  toggleBambuLight(lightToggle.dataset.lightToggle);
}, true);

// Delegated handler for temp nudge + inline edit
document.getElementById('view-printer').addEventListener('click', e => {
  // Nudge buttons
  const tempBtn = e.target.closest('[data-temp-action]');
  if (tempBtn) {
    const { tempAction, heater, printerId: id, target } = tempBtn.dataset;
    const current = parseInt(target, 10) || 0;
    sendTempSet(id, heater, tempAction === 'dec' ? Math.max(0, current - 5) : current + 5);
    return;
  }

  // Click target value → temp modal
  const targetSpan = e.target.closest('[data-temp-edit]');
  if (targetSpan) {
    const heater = targetSpan.dataset.tempEdit;
    const id = targetSpan.dataset.printerId;
    const p = _latestPrinters.find(x => x.id === id);
    if (!p) return;
    const r = p.temps?.[heater];
    if (!r) return;
    _tempModal.open({
      printerId: id,
      heater,
      label: _TEMP_LABELS[heater] ?? heater,
      current: r.actual,
      target: _getDisplayTarget(id, heater, r.target),
      presets: p.temperature_presets?.[heater] ?? [],
      max: 300,
    });
  }
});

document.getElementById('view-printer').addEventListener('click', e => {
  const dryBtn = e.target.closest('[data-ams-dry]');
  if (dryBtn) {
    e.preventDefault();
    e.stopPropagation();
    const enabled = dryBtn.dataset.enabled === 'true';
    if (enabled) {
      _openAmsDryDialog(dryBtn.dataset.printerId, Number(dryBtn.dataset.amsId));
      return;
    }
    _setDryButtonPending(dryBtn, 'Stopping');
    sendAmsDry({ printerId: dryBtn.dataset.printerId, amsId: dryBtn.dataset.amsId, enabled: false })
      .then(() => setTimeout(() => refreshPrinters(), 900))
      .catch(err => alert(err.message || 'AMS drying command failed'))
      .finally(() => setTimeout(() => _clearDryButtonPending(dryBtn), 1200));
    return;
  }

  const slot = e.target.closest('[data-slot-edit]');
  if (!slot) return;
  e.preventDefault();
  e.stopPropagation();
  _openSlotEditor(
    slot.dataset.printerId,
    Number(slot.dataset.slotIndex),
    slot.dataset.slotLabel || `S${Number(slot.dataset.slotIndex) + 1}`
  );
});

// ── Routing ────────────────────────────────────────────────────────────────

function parseRoute() {
  const hash = location.hash || '#/';
  const printerMatch = hash.match(/^#\/printer\/([^/]+)(?:\/(history|maintenance))?/);
  if (printerMatch) return { view: 'printer', id: printerMatch[1], subtab: printerMatch[2] || 'live' };
  const spoolMatch = hash.match(/^#\/spool\/(\d+)/);
  if (spoolMatch) return { view: 'spool', id: parseInt(spoolMatch[1], 10) };
  if (hash === '#/mission' || hash.startsWith('#/mission?')) return { view: 'mission' };
  if (hash === '#/cameras') return { view: 'cameras' };
  if (hash === '#/stats') return { view: 'stats' };
  if (hash === '#/queue') return { view: 'queue' };
  if (hash === '#/failures') return { view: 'failures' };
  if (hash === '#/spools') return { view: 'spools' };
  const settingsMatch = hash.match(/^#\/settings\/([^/]+)/);
  if (settingsMatch?.[1] === 'spools') return { view: 'spools' };
  if (settingsMatch) return { view: 'settings', category: settingsMatch[1] };
  if (hash === '#/settings') return { view: 'settings' };
  return { view: 'dashboard' };
}

function router() {
  const route = parseRoute();
  const categoryBeforeRoute = _settingsCategory;
  if (route.view === 'settings' && route.category) {
    _settingsCategory = _SETTINGS_CATEGORIES.some(c => c.id === route.category)
      ? route.category
      : 'printers';
  }

  // Abort MJPEG streams when leaving their view — mobile browsers don't close
  // orphaned <img> connections automatically, which exhausts connection pool slots.
  if (route.view !== 'printer') {
    const img = document.querySelector('#detail-cam-img');
    if (img) { img.src = ''; img.dataset.stopped = '1'; }
  }
  if (route.view !== 'cameras') {
    document.querySelectorAll('#cameras-grid img').forEach(img => { img.src = ''; });
    _camerasFull = false;
  }

  const wasOnSettings = _onSettings;
  const wasOnFailures = _onFailures;
  const wasOnSpools = _onSpools;
  _onSettings = route.view === 'settings';
  _onFailures = route.view === 'failures';
  _onSpools = route.view === 'spools';

  document.getElementById('view-dashboard').hidden = route.view !== 'dashboard';
  document.getElementById('view-mission').hidden   = route.view !== 'mission';
  document.getElementById('view-stats').hidden     = route.view !== 'stats';
  document.getElementById('view-printer').hidden   = route.view !== 'printer';
  document.getElementById('view-spool').hidden     = route.view !== 'spool';
  document.getElementById('view-cameras').hidden   = route.view !== 'cameras';
  document.getElementById('view-queue').hidden     = route.view !== 'queue';
  document.getElementById('view-failures').hidden  = route.view !== 'failures';
  document.getElementById('view-spools').hidden    = route.view !== 'spools';
  document.getElementById('view-settings').hidden  = route.view !== 'settings';

  document.querySelectorAll('#tab-strip .tab').forEach(tab => {
    const href = tab.getAttribute('href');
    tab.classList.toggle('active',
      (route.view === 'dashboard' && href === '#/') ||
      (route.view === 'mission'   && href === '#/mission') ||
      (route.view === 'stats'     && href === '#/stats') ||
      (route.view === 'printer'  && href === `#/printer/${route.id}`) ||
      (route.view === 'cameras'  && href === '#/cameras') ||
      (route.view === 'queue'    && href === '#/queue') ||
      (route.view === 'failures' && href === '#/failures') ||
      (route.view === 'spools'   && href === '#/spools') ||
      (route.view === 'settings' && (
        href === '#/settings' ||
        href === `#/settings/${_settingsCategory}`
      ))
    );
  });

  if (route.view === 'printer') renderPrinterDetail(route.id, route.subtab);
  if (route.view === 'mission') renderMissionControl();
  if (route.view === 'stats') renderStatsView();
  if (route.view === 'spool') renderSpoolDetail(route.id);
  if (route.view === 'cameras') renderCamerasView();
  if (route.view === 'queue') renderQueueView();
  if (route.view === 'failures' && !wasOnFailures) renderFailuresView();
  if (route.view === 'spools' && !wasOnSpools) renderSpoolsView();
  if (route.view === 'settings' && (!wasOnSettings || categoryBeforeRoute !== _settingsCategory)) renderSettingsView();
}

function buildTabs(printers) {
  const nav = document.getElementById('tab-strip');
  nav.innerHTML = [
    `<a class="tab" href="#/">Dashboard</a>`,
    `<a class="tab" href="#/mission">Mission Control</a>`,
    `<a class="tab" href="#/stats">Stats</a>`,
    `<div class="tab-section">Printers</div>`,
    ...printers.map((p, i) => {
      const color = _PRINTER_ACCENT_PALETTE[i % _PRINTER_ACCENT_PALETTE.length];
      return `<a class="tab tab-printer" href="#/printer/${p.id}" style="--tab-accent:${color}">${_printerNavLabel(p)}</a>`;
    }),
    `<div class="tab-section">Operations</div>`,
    `<a class="tab" href="#/cameras">Cameras</a>`,
    `<a class="tab" href="#/queue">Queue</a>`,
    `<a class="tab" href="#/failures">Failures</a>`,
    `<a class="tab" href="#/spools">Spools</a>`,
    `<div class="tab-section">System</div>`,
    `<a class="tab" href="#/settings">Settings</a>`,
  ].join('');
  _tabsBuilt = true;
  router();
}

// ── Printer detail helpers ─────────────────────────────────────────────────

function _detailSubTabs(id, active) {
  return `<div class="detail-sub-tabs">
    <a class="sub-tab ${active === 'live' ? 'active' : ''}" href="#/printer/${id}">Live</a>
    <a class="sub-tab ${active === 'history' ? 'active' : ''}" href="#/printer/${id}/history">History</a>
    <a class="sub-tab ${active === 'maintenance' ? 'active' : ''}" href="#/printer/${id}/maintenance">Maintenance</a>
  </div>`;
}

function _detailPrintPanel(p) {
  const title = `<div class="detail-panel-title">Print Details</div>`;

  if (!p.job || (p.state === 'idle' || p.state === 'offline')) {
    const entries = Object.entries(p.idle_info || {});
    if (!entries.length) return title + `<div class="detail-row"><span class="detail-label">—</span></div>`;
    return `<div class="detail-panel-title">Last Print</div>` +
      entries.map(([k, v]) => `
        <div class="detail-row">
          <span class="detail-label">${k}</span>
          <span class="detail-value">${v}</span>
        </div>`).join('');
  }

  const job = p.job;
  const name = jobDisplayName(job);
  const pct = (job.progress * 100).toFixed(0);
  const layers = job.layer_current != null && job.layer_total != null
    ? `${job.layer_current} / ${job.layer_total}` : '—';

  const thumb = `<div class="detail-thumb">
    <img class="detail-thumb-img" src="/api/printers/${p.id}/thumbnail" alt="Print thumbnail"
         onerror="this.parentElement.hidden=true">
  </div>`;

  const cal = p.eta_calibration;  // {ratio: float|null, count: int} or undefined
  let etaValue;
  if (cal && cal.ratio != null && job.eta_seconds != null) {
    const fdEta = formatEta(Math.round(job.eta_seconds * cal.ratio));
    etaValue = `Slicer: ${formatEta(job.eta_seconds)} · Flightdeck: ${fdEta} <span class="eta-count">(${cal.count} prints)</span>`;
  } else if (cal && job.eta_seconds != null) {
    etaValue = `${formatEta(job.eta_seconds)} <span class="eta-count">(calibrating ${cal.count}/5)</span>`;
  } else {
    etaValue = formatEta(job.eta_seconds);
  }

  return title + thumb +
    `<div class="detail-row"><span class="detail-label">File</span><span class="detail-value">${name}</span></div>` +
    `<div class="detail-progress-bar"><div class="detail-progress-fill" style="width:${pct}%"></div></div>` +
    `<div class="detail-row"><span class="detail-label">Progress</span><span class="detail-value">${pct}%</span></div>` +
    `<div class="detail-row"><span class="detail-label">Layer</span><span class="detail-value">${layers}</span></div>` +
    `<div class="detail-row"><span class="detail-label">ETA</span><span class="detail-value eta-row">${etaValue}</span></div>`;
}

const _TEMP_CTRL_HEATERS = new Set(['hotend', 'bed']);
const _TEMP_LABELS = { hotend: 'Hotend', hotend_l: 'Left', hotend_r: 'Right', bed: 'Bed', chamber: 'Chamber' };

function _getDisplayTarget(id, heater, wsTarget) {
  const key = `${id}:${heater}`;
  const opt = _tempOptimistic[key];
  if (!opt || Date.now() >= opt.expiresAt) { delete _tempOptimistic[key]; return wsTarget; }
  if (Math.abs(wsTarget - opt.sentTarget) <= 1) { delete _tempOptimistic[key]; return wsTarget; }
  return opt.sentTarget;
}

function _detailTempsPanel(p) {
  const entries = Object.entries(p.temps || {});
  const title = `<div class="detail-panel-title">Temperatures</div>`;
  if (!entries.length) return title + `<div class="detail-row"><span class="detail-label">—</span></div>`;

  const rows = entries
    .sort(([a], [b]) => (_TEMP_SORT[a] ?? 99) - (_TEMP_SORT[b] ?? 99))
    .map(([k, r]) => {
    const label = _TEMP_LABELS[k] ?? k;
    const targetC = _getDisplayTarget(p.id, k, r.target);  // always Celsius
    const actual = _toDisplayTemp(r.actual);
    const unit = _tempUnitLabel();
    const hasCtrl = _TEMP_CTRL_HEATERS.has(k);
    const cls = _tempClass(r.actual);

    if (!hasCtrl) {
      return `<div class="temp-ctrl-row">
        <span class="temp-row-label">${label}</span>
        <div class="temp-readings"><span class="temp-actual${cls}">${actual}${unit}</span></div>
      </div>`;
    }

    const targetHtml = targetC > 0
      ? `<span class="temp-sep">/</span>
         <span class="temp-target-val" data-temp-edit="${k}" data-printer-id="${p.id}">${_toDisplayTemp(targetC)}${unit}</span>`
      : `<span class="temp-sep" style="font-size:0.75rem">off</span>`;

    return `<div class="temp-ctrl-row">
      <span class="temp-row-label">${label}</span>
      <div class="temp-readings" data-temp-edit="${k}" data-printer-id="${p.id}" style="cursor:pointer">
        <span class="temp-actual${cls}">${actual}${unit}</span>
        ${targetHtml}
      </div>
      <div class="temp-nudge">
        <button class="temp-btn" data-temp-action="dec" data-heater="${k}" data-printer-id="${p.id}" data-target="${Math.round(targetC)}">−</button>
        <button class="temp-btn" data-temp-action="inc" data-heater="${k}" data-printer-id="${p.id}" data-target="${Math.round(targetC)}">+</button>
      </div>
    </div>`;
  }).join('');

  return title + `<div class="temp-rows">${rows}</div>`;
}

async function sendTempSet(id, heater, target) {
  const clampedTarget = Math.max(0, Math.min(350, Math.round(target)));
  _tempOptimistic[`${id}:${heater}`] = { sentTarget: clampedTarget, expiresAt: Date.now() + 12000 };

  // Optimistic re-render of just the temps panel
  const p = _latestPrinters.find(x => x.id === id);
  const tempsEl = document.querySelector('#detail-temps');
  if (tempsEl && p) tempsEl.innerHTML = _detailTempsPanel(p);

  try {
    await fetch(`/api/printers/${id}/set-temp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heater, target: clampedTarget }),
    });
  } catch {
    delete _tempOptimistic[`${id}:${heater}`];
  }
}

// ── AMS panel ─────────────────────────────────────────────────────────────

function _detailAmsPanel(p) {
  if (!p.ams?.length) return '';

  const title = `<div class="detail-panel-title">AMS</div>`;
  const units = p.ams.map(unit => {
    const drying = !!unit.drying;
    const dryTime = unit.dry_time ? formatEta(unit.dry_time * 60) : '';
    const preset = unit.dry_setting || {};
    const meta = [
      unit.humidity != null ? `${unit.humidity}% RH` : '',
      unit.temperature != null ? `${Math.round(unit.temperature)}°` : '',
      preset.filament && preset.temperature > 0 ? `${preset.filament} ${preset.temperature}°` : '',
      drying && dryTime ? `${dryTime} left` : '',
    ].filter(Boolean).join(' · ');
    const dryControl = unit.dry_capable
      ? `<button class="ams-dry-btn${drying ? ' ams-dry-active' : ''}"
          data-ams-dry data-printer-id="${p.id}" data-ams-id="${unit.unit}" data-enabled="${drying ? 'false' : 'true'}"
          title="${drying ? 'Stop AMS drying' : 'Start AMS drying'}">${drying ? 'Stop' : 'Dry'}</button>`
      : '';
    const slots = unit.slots.map(slot => {
      const flatSlot = unit.unit * 4 + slot.idx;
      const loaded = (_latestSpoolsByPrinter[p.id] || []).find(s => Number(s.location_slot) === flatSlot);
      const mismatch = _slotMismatch(loaded, slot);
      const style = (!slot.empty && slot.color) ? `style="background:${slot.color}"` : '';
      const activeCls = slot.active ? ' ams-active' : '';
      const emptyCls  = slot.empty  ? ' ams-empty'  : '';
      const mappedCls = loaded ? ' ams-mapped' : '';
      const warnCls = mismatch ? ' ams-warning' : '';
      const tip = slot.empty
        ? `Slot ${slot.idx + 1}: empty`
        : [slot.type, slot.brand].filter(Boolean).join(' · ');
      return `<div class="ams-slot-wrap">
        <button class="ams-slot${activeCls}${emptyCls}${mappedCls}${warnCls}" ${style}
          data-slot-edit data-printer-id="${p.id}" data-slot-index="${flatSlot}"
          data-slot-label="${esc(_amsSlotLabel(p, flatSlot))}" title="${esc([tip, mismatch].filter(Boolean).join(' · '))}"></button>
        <span class="ams-slot-type">${loaded ? `#${loaded.id}` : (slot.empty ? '' : slot.type)}</span>
      </div>`;
    }).join('');
    return `<div class="ams-unit">
      <div class="ams-unit-head">
        <span class="ams-unit-lbl">${unit.label ?? 'AMS ' + (unit.unit + 1)}</span>
        ${meta ? `<span class="ams-unit-meta">${esc(meta)}</span>` : ''}
        ${dryControl}
      </div>
      <div class="ams-slots">${slots}</div>
    </div>`;
  }).join('');

  return `<div class="detail-panel">${title}<div class="ams-units">${units}</div></div>`;
}

const _AMS_DRY_PRESETS = {
  PLA:  { temp: 45, duration: 12 },
  PETG: { temp: 55, duration: 12 },
  ABS:  { temp: 65, duration: 12 },
  ASA:  { temp: 65, duration: 12 },
  TPU:  { temp: 55, duration: 8 },
  PA:   { temp: 75, duration: 12 },
  PC:   { temp: 75, duration: 12 },
};

function _setDryButtonPending(btn, text) {
  btn.dataset.oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = text;
}

function _clearDryButtonPending(btn) {
  btn.disabled = false;
  btn.textContent = btn.dataset.oldText || btn.textContent;
  delete btn.dataset.oldText;
}

function _openAmsDryDialog(printerId, amsId) {
  const p = _latestPrinters.find(x => x.id === printerId);
  const unit = (p?.ams || []).find(u => Number(u.unit) === Number(amsId));
  const reasonText = _amsDryReasonText(unit?.dry_sf_reason);
  const current = unit?.dry_setting || {};
  const startFilament = current.filament || 'PLA';
  const preset = _AMS_DRY_PRESETS[startFilament] || _AMS_DRY_PRESETS.PLA;
  const maxTemp = Number(amsId) >= 128 ? 85 : 65;
  const startTemp = Math.min(maxTemp, current.temperature > 0 ? current.temperature : preset.temp);
  const startDuration = current.duration > 0 ? current.duration : preset.duration;
  const rh = unit?.humidity != null ? `${unit.humidity}% RH` : 'RH --';
  const tempNow = unit?.temperature != null ? `${Math.round(unit.temperature * 10) / 10}°C` : '--°C';
  const drying = !!unit?.drying;
  const dryTime = unit?.dry_time ? formatEta(unit.dry_time * 60) : '';
  const options = Object.keys(_AMS_DRY_PRESETS).map(f =>
    `<option value="${f}"${f === startFilament ? ' selected' : ''}>${f}</option>`
  ).join('');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box ams-dry-modal">
      <div class="modal-header ams-dry-header">
        <div>
          <span class="modal-title">AMS drying</span>
          <div class="ams-dry-subtitle">${esc(unit?.label || `AMS ${amsId}`)} · ${esc(p?.custom_name || p?.model_name || printerId)}</div>
        </div>
        <button class="modal-close-btn">×</button>
      </div>
      <div class="ams-dry-status">
        <span class="ams-dry-status-chip">${esc(rh)}</span>
        <span class="ams-dry-status-chip">${esc(tempNow)}</span>
        <span class="ams-dry-status-chip ${drying ? 'ams-dry-running' : ''}">${drying ? `Drying${dryTime ? ` · ${dryTime} left` : ''}` : 'Idle'}</span>
      </div>
      ${reasonText ? `<div class="ams-dry-blocked">${esc(reasonText)}</div>` : ''}
      <div class="ams-dry-form">
        <label class="ams-dry-field" for="ams-dry-filament">
          <span>Filament</span>
          <select id="ams-dry-filament" class="spool-form-input">${options}</select>
        </label>
        <label class="ams-dry-field" for="ams-dry-temp">
          <span>Temperature</span>
          <strong><output id="ams-dry-temp-out">${startTemp}</output>°C</strong>
          <input id="ams-dry-temp" class="ams-dry-range" type="range" min="45" max="${maxTemp}" value="${startTemp}">
          <small><span>45°C</span><span>${maxTemp}°C</span></small>
        </label>
        <label class="ams-dry-field" for="ams-dry-duration">
          <span>Duration</span>
          <strong><output id="ams-dry-duration-out">${startDuration}</output>h</strong>
          <input id="ams-dry-duration" class="ams-dry-range" type="range" min="1" max="24" value="${startDuration}">
          <small><span>1h</span><span>24h</span></small>
        </label>
        <label class="ams-dry-toggle">
          <input id="ams-dry-rotate" type="checkbox">
          <span>Rotate spool during drying</span>
        </label>
        <div class="ams-dry-note">
          Flightdeck will send the selected dry profile to the printer's AMS controller.
        </div>
      </div>
      <div class="modal-actions ams-dry-actions">
        ${drying ? '<button class="modal-btn ams-dry-stop" id="ams-dry-stop">Stop drying</button>' : ''}
        <button class="modal-btn" id="ams-dry-cancel">Cancel</button>
        <button class="modal-btn modal-btn-primary ams-dry-start" id="ams-dry-start" ${reasonText ? 'disabled' : ''}>Start drying</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  const filament = overlay.querySelector('#ams-dry-filament');
  const temp = overlay.querySelector('#ams-dry-temp');
  const duration = overlay.querySelector('#ams-dry-duration');
  const tempOut = overlay.querySelector('#ams-dry-temp-out');
  const durationOut = overlay.querySelector('#ams-dry-duration-out');
  const updateOutputs = () => {
    tempOut.textContent = temp.value;
    durationOut.textContent = duration.value;
  };
  temp.addEventListener('input', updateOutputs);
  duration.addEventListener('input', updateOutputs);
  filament.addEventListener('change', () => {
    const p = _AMS_DRY_PRESETS[filament.value] || _AMS_DRY_PRESETS.PLA;
    temp.value = Math.min(maxTemp, p.temp);
    duration.value = p.duration;
    updateOutputs();
  });
  overlay.querySelector('.modal-close-btn').addEventListener('click', close);
  overlay.querySelector('#ams-dry-cancel').addEventListener('click', close);
  overlay.querySelector('#ams-dry-stop')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Stopping...';
    try {
      await sendAmsDry({ printerId, amsId, enabled: false });
      close();
      setTimeout(() => refreshPrinters(), 900);
    } catch (err) {
      alert(err.message || 'AMS drying command failed');
      btn.disabled = false;
      btn.textContent = 'Stop drying';
    }
  });
  overlay.querySelector('#ams-dry-start').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Starting...';
    try {
      await sendAmsDry({
        printerId,
        amsId,
        enabled: true,
        filament: filament.value,
        temp: Number(temp.value),
        duration: Number(duration.value),
        rotateTray: overlay.querySelector('#ams-dry-rotate').checked,
      });
      close();
      setTimeout(() => refreshPrinters(), 900);
    } catch (err) {
      alert(err.message || 'AMS drying command failed');
      btn.disabled = false;
      btn.textContent = 'Start drying';
    }
  });
}

function _amsDryReasonText(reasons = []) {
  const messages = {
    0: 'Printer is busy.',
    1: 'Insufficient power; connect an external AMS power adapter or stop other AMS drying.',
    2: 'AMS is busy.',
    3: 'Filament is at the AMS outlet; retract/unload it first.',
    4: 'AMS is already starting a drying cycle.',
    5: 'Drying is not supported in the current mode.',
    6: 'AMS is already drying.',
    7: 'AMS firmware is upgrading.',
    8: 'Plug in the external AMS power adapter to start drying.',
  };
  for (const reason of reasons || []) {
    const msg = messages[Number(reason)];
    if (msg) return msg;
  }
  return '';
}

async function sendAmsDry({ printerId, amsId, enabled, filament = 'PLA', temp = 45, duration = 12, rotateTray = false }) {
  const body = enabled
    ? { enabled: true, filament, temp, duration, rotate_tray: rotateTray }
    : { enabled: false };
  const resp = await fetch(`/api/printers/${encodeURIComponent(printerId)}/ams/${encodeURIComponent(amsId)}/dry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'AMS drying command failed');
  }
}

// ── MMU panel ─────────────────────────────────────────────────────────────

function _detailMmuPanel(p) {
  if (!p.mmu?.length) return '';
  const unit = p.mmu[0];
  if (!unit.gates?.length) return '';

  const title = `<div class="detail-panel-title">${unit.vendor || 'MMU'} · ${unit.num_gates} gates</div>`;

  const slots = unit.gates.map(gate => {
    const loaded = (_latestSpoolsByPrinter[p.id] || []).find(s => Number(s.location_slot) === Number(gate.idx));
    const mismatch = _slotMismatch(loaded, gate);
    const style = !gate.empty ? `style="background:${gate.color || 'var(--muted)'}"` : '';
    const activeCls = gate.active ? ' ams-active' : '';
    const emptyCls  = gate.empty  ? ' ams-empty'  : '';
    const bufferedCls = (!gate.empty && gate.status === 2) ? ' mmu-buffered' : '';
    const mappedCls = loaded ? ' ams-mapped' : '';
    const warnCls = mismatch ? ' ams-warning' : '';
    const tip = gate.empty
      ? `T${gate.idx}: empty`
      : [gate.filament_name || gate.material, gate.status === 2 ? 'buffered' : 'available']
          .filter(Boolean).join(' · ');
    return `<div class="ams-slot-wrap">
      <button class="ams-slot${activeCls}${emptyCls}${bufferedCls}${mappedCls}${warnCls}" ${style}
        data-slot-edit data-printer-id="${p.id}" data-slot-index="${gate.idx}"
        data-slot-label="${esc(_amsSlotLabel(p, gate.idx))}" title="${esc([tip, mismatch].filter(Boolean).join(' · '))}"></button>
      <span class="ams-slot-type">${loaded ? `#${loaded.id}` : (gate.empty ? '' : (gate.material || ''))}</span>
    </div>`;
  }).join('');

  return `<div class="detail-panel">${title}<div class="ams-slots">${slots}</div></div>`;
}

// ── Object exclusion panel ────────────────────────────────────────────────

function _detailObjectsPanel(id, objects) {
  if (!objects || objects.length < 2) return '';
  const title = `<div class="detail-panel-title">Print Objects</div>`;
  const rows = objects.map(obj => {
    const isExcluded = obj.state === 'excluded';
    const isCurrent = obj.state === 'current';
    const shortName = obj.name.replace(/.*[/\\]/, '');
    const safeName = obj.name.replace(/"/g, '&quot;');
    const stateHtml = isCurrent
      ? `<span class="obj-state obj-state-current">▶</span>`
      : isExcluded
        ? `<span class="obj-state obj-state-excluded">✗</span>`
        : '';
    return `<div class="obj-row${isExcluded ? ' obj-row-excluded' : ''}">
      <label class="obj-label">
        <input type="checkbox" class="obj-check"
          data-obj-name="${safeName}" data-printer-id="${id}"
          ${isExcluded ? 'checked disabled' : ''}>
        <span class="obj-name" title="${safeName}">${shortName}</span>
      </label>
      ${stateHtml}
    </div>`;
  }).join('');
  return `<div class="detail-panel">${title}<div class="obj-list">${rows}</div></div>`;
}

async function refreshObjectsPanel(id) {
  try {
    const r = await fetch(`/api/printers/${id}/objects`);
    if (!r.ok) return;
    _objectsCache[id] = await r.json();
  } catch { return; }

  const el = document.querySelector('#detail-objects');
  if (!el) return;
  const data = _objectsCache[id];
  el.innerHTML = (data?.supported && data.objects?.length > 1)
    ? _detailObjectsPanel(id, data.objects)
    : '';
}

async function sendExcludeObject(id, name) {
  try {
    await fetch(`/api/printers/${id}/exclude-object`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    await refreshObjectsPanel(id);
  } catch {}
}

// Delegated click for object exclusion checkboxes
document.getElementById('view-printer').addEventListener('click', e => {
  const cb = e.target.closest('.obj-check');
  if (!cb || cb.disabled) return;
  e.preventDefault();
  const name = cb.dataset.objName;
  const id = cb.dataset.printerId;
  if (!name || !id) return;
  const shortName = name.replace(/.*[/\\]/, '');
  _modal.show(
    `Exclude "${shortName}" from this print? The printer will skip this object.`,
    () => sendExcludeObject(id, name)
  );
});

document.getElementById('view-printer').addEventListener('click', e => {
  const thumb = e.target.closest('.detail-thumb');
  if (thumb) thumb.classList.toggle('collapsed');
});

// ── History tab ───────────────────────────────────────────────────────────

function _heatColor(total) {
  if (!total) return null;              // transparent + border via .heat-empty
  if (total >= 5) return 'rgba(34,197,94,1)';
  if (total >= 3) return 'rgba(34,197,94,0.55)';
  return 'rgba(34,197,94,0.25)';
}

function _historyYearNav(year, currentYear) {
  const nextDisabled = year >= currentYear;
  return `<div class="heat-year-nav">
    <button class="heat-year-btn" data-year-prev>&lsaquo; ${year - 1}</button>
    <span class="heat-year-current">${year}</span>
    <button class="heat-year-btn" data-year-next${nextDisabled ? ' disabled' : ''}>${year + 1} &rsaquo;</button>
  </div>`;
}

function _historySummaryLine(summary) {
  const prints = summary.prints || 0;
  if (!prints) return `<div class="heat-summary">No finished prints recorded</div>`;
  const hours = summary.seconds ? (summary.seconds / 3600).toFixed(1) : '0';
  const kg = summary.grams ? (summary.grams / 1000).toFixed(2) : null;
  const parts = [`${prints} print${prints !== 1 ? 's' : ''}`, `${hours}h`];
  if (kg) parts.push(`${kg}kg filament`);
  return `<div class="heat-summary">${parts.join(' · ')}</div>`;
}

function _historyHeatmap(printerId, dayData, year) {
  const byDate = {};
  for (const d of dayData) byDate[d.day] = d;

  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1dow = jan1.getUTCDay();
  const daysToMon = jan1dow === 0 ? 6 : jan1dow - 1;
  const gridStart = new Date(jan1);
  gridStart.setUTCDate(jan1.getUTCDate() - daysToMon);

  const dec31 = new Date(Date.UTC(year, 11, 31));
  const dec31dow = dec31.getUTCDay();
  const daysToSun = dec31dow === 0 ? 0 : 7 - dec31dow;
  const gridEnd = new Date(dec31);
  gridEnd.setUTCDate(dec31.getUTCDate() + daysToSun);

  const numWeeks = Math.ceil(((gridEnd - gridStart) / 86400000 + 1) / 7);
  const todayUTC = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let lastMonth = -1;
  const monthLabels = [];
  const cellsHtml = [];

  for (let w = 0; w < numWeeks; w++) {
    const weekMon = new Date(gridStart);
    weekMon.setUTCDate(gridStart.getUTCDate() + w * 7);
    const m = weekMon.getUTCMonth();
    const wYear = weekMon.getUTCFullYear();
    monthLabels.push(m !== lastMonth && wYear === year ? MONTHS[m] : '');
    lastMonth = m;

    for (let d = 0; d < 7; d++) {
      const cell = new Date(gridStart);
      cell.setUTCDate(gridStart.getUTCDate() + w * 7 + d);
      const dateStr = cell.toISOString().slice(0, 10);
      const data = byDate[dateStr] || {};
      const total = data.total || 0;
      const isFuture = cell > todayUTC;
      const isOut = cell.getUTCFullYear() !== year;
      const color = _heatColor(total);
      const cls = ['heat-cell',
        color === null ? 'heat-empty' : '',
        isFuture ? 'heat-future' : '',
        isOut ? 'heat-out' : '',
      ].filter(Boolean).join(' ');
      const tip = total
        ? `${dateStr}: ${total} print${total !== 1 ? 's' : ''} (${data.finished || 0} finished)`
        : dateStr;
      cellsHtml.push(
        `<div class="${cls}" data-date="${dateStr}"${color ? ` style="background:${color}"` : ''} title="${tip}"></div>`
      );
    }
  }

  const DAY_LABELS = ['Mon','','Wed','','Fri','','Sun'];
  return `<div class="history-section">
    <div class="heat-wrap">
      <div class="heat-months">${monthLabels.map(m => `<span class="heat-month">${m}</span>`).join('')}</div>
      <div class="heat-body">
        <div class="heat-days">${DAY_LABELS.map(l => `<span class="heat-day-label">${l}</span>`).join('')}</div>
        <div class="heat-grid" id="heat-grid-${printerId}">${cellsHtml.join('')}</div>
      </div>
    </div>
  </div>`;
}

function _printBadge(state) {
  const cls = state === 'FINISHED' ? 'idle' : state === 'CANCELLED' ? 'paused' : state === 'ERROR' ? 'error' : 'printing';
  const label = state === 'FINISHED' ? 'done' : state === 'CANCELLED' ? 'cancelled' : state === 'ERROR' ? 'failed' : 'running';
  return { cls, label };
}

function _printRowHtml(print, idx, dateStr) {
  const raw = print.subtask_name || print.filename.replace(/.*[/\\]/, '');
  const name = raw.replace(/\.gcode$/i, '');
  const state = print.final_state || 'running';
  const { cls, label } = _printBadge(state);

  const dur = print.duration_seconds ? formatTime(print.duration_seconds) : '—';
  const ts = print.started_at + (print.started_at.endsWith('Z') ? '' : 'Z');
  const time = new Date(ts).toLocaleTimeString([], _clockOpts());
  const layers = (print.layers_completed != null && print.layers_total)
    ? ` · ${print.layers_completed}/${print.layers_total}L` : '';

  return `<div class="print-row" data-print-idx="${idx}" data-date="${dateStr}">
    <div class="print-name" title="${print.filename}">${name}</div>
    <span class="badge badge-${cls}" style="font-size:0.6rem;padding:0.15rem 0.5rem">${label}</span>
    <span class="print-meta">${time}</span>
    <span class="print-meta">${dur}${layers}</span>
  </div>`;
}

function _showPrintDetail(printerId, dateStr, print) {
  const el = document.getElementById('history-day-detail');
  if (!el) return;

  const raw = print.subtask_name || print.filename.replace(/.*[/\\]/, '');
  const name = raw.replace(/\.gcode$/i, '');
  const state = print.final_state || 'running';
  const { cls, label } = _printBadge(state);

  const fmtTs = ts => {
    if (!ts) return '—';
    return new Date(ts.endsWith('Z') ? ts : ts + 'Z')
      .toLocaleTimeString([], _clockOpts({ second: '2-digit' }));
  };

  const d = new Date(dateStr + 'T00:00:00Z');
  const dateLabel = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

  const rows = [];
  rows.push(`<div class="detail-row"><span class="detail-label">Started</span><span class="detail-value">${fmtTs(print.started_at)}</span></div>`);
  if (print.ended_at) rows.push(`<div class="detail-row"><span class="detail-label">Ended</span><span class="detail-value">${fmtTs(print.ended_at)}</span></div>`);
  if (print.duration_seconds) rows.push(`<div class="detail-row"><span class="detail-label">Duration</span><span class="detail-value">${formatTime(print.duration_seconds)}</span></div>`);
  if (print.layers_completed != null || print.layers_total != null) {
    rows.push(`<div class="detail-row"><span class="detail-label">Layers</span><span class="detail-value">${print.layers_completed ?? '—'} / ${print.layers_total ?? '—'}</span></div>`);
  }
  if (print.filament_grams != null) {
    const mat = print.material ? ` · ${print.material}` : '';
    rows.push(`<div class="detail-row"><span class="detail-label">Filament</span><span class="detail-value">${print.filament_grams.toFixed(1)}g${mat}</span></div>`);
  }

  const errorHtml = print.error_message
    ? `<div class="print-detail-error">${print.error_message}</div>`
    : '';

  const snapshotHtml = print.has_snapshot
    ? `<div class="print-failure-snapshot">
         <img src="/api/printers/${printerId}/prints/${print.id}/snapshot" alt="Last frame before failure" loading="lazy">
         <div class="snapshot-caption">Last frame before failure</div>
       </div>`
    : '';

  const decisionHtml = print.id
    ? `<details class="decision-trail" data-print-id="${print.id}" data-printer-id="${printerId}">
         <summary>Decision trail</summary>
         <div class="decision-list"><span class="decision-empty">Loading…</span></div>
       </details>`
    : '';

  const notesHtml = `<div class="print-notes-block" data-print-id="${print.id}" data-printer-id="${printerId}">
    <div class="print-notes-view">
      ${print.notes
        ? `<div class="print-notes-text">${print.notes}</div>`
        : `<span class="print-notes-empty">No notes</span>`}
      <button class="print-notes-edit-btn">${print.notes ? 'Edit' : 'Add note'}</button>
    </div>
  </div>`;

  const spoolUsageHtml = print.spool_usage?.length
    ? `<div class="print-spool-usage">
        <div class="print-spool-title">Spool usage</div>
        ${print.spool_usage.map(u => `
          <div class="print-spool-row${u.reconcile_suggested ? ' print-spool-row-suggested' : ''}">
            <a href="#/spool/${u.spool_id}">Spool #${u.spool_id}${u.slot != null ? ` · ${(_latestPrinters.find(x => x.id === printerId) ? _amsSlotLabel(_latestPrinters.find(x => x.id === printerId), u.slot) : `S${u.slot + 1}`)}` : ''}</a>
            <span class="print-spool-grams">
              <strong>${Number(u.actual_grams ?? u.grams ?? 0).toFixed(1)}g</strong>
              ${u.waste_grams ? `<em>${Number(u.grams || 0).toFixed(1)}g model · ${Number(u.waste_grams || 0).toFixed(1)}g purge</em>` : ''}
              ${u.reconcile_suggested ? `<em class="weigh-suggested">Weigh-in suggested · ${(u.reconcile_reasons || []).join(', ')}</em>` : ''}
            </span>
            <button class="print-spool-reconcile${u.reconcile_suggested ? ' suggested' : ''}" data-print-id="${print.id}" data-spool-id="${u.spool_id}">${u.reconcile_suggested ? 'Weigh' : 'Reconcile'}</button>
          </div>`).join('')}
      </div>`
    : '';

  el.innerHTML = `<div class="history-day-panel">
    <div class="print-detail-nav">
      <button class="print-detail-back" data-back-date="${dateStr}">&larr; ${dateLabel}</button>
    </div>
    <div class="print-detail-header">
      <span class="print-detail-name" title="${print.filename}">${name}</span>
      <span class="badge badge-${cls}" style="font-size:0.6rem;padding:0.15rem 0.5rem">${label}</span>
    </div>
    ${snapshotHtml}
    ${errorHtml}
    <div>${rows.join('')}</div>
    ${spoolUsageHtml}
    ${notesHtml}
    ${decisionHtml}
  </div>`;

  const notesBlock = el.querySelector('.print-notes-block');
  if (notesBlock) {
    const _refreshNotesView = (notes) => {
      notesBlock.querySelector('.print-notes-view').innerHTML = notes
        ? `<div class="print-notes-text">${notes}</div><button class="print-notes-edit-btn">Edit</button>`
        : `<span class="print-notes-empty">No notes</span><button class="print-notes-edit-btn">Add note</button>`;
    };
    notesBlock.addEventListener('click', e => {
      if (!e.target.classList.contains('print-notes-edit-btn')) return;
      const prid = notesBlock.dataset.printerId;
      const pid  = parseInt(notesBlock.dataset.printId, 10);
      const existing = notesBlock.querySelector('.print-notes-text')?.textContent ?? '';
      _showNoteEditor(prid, pid, existing, saved => _refreshNotesView(saved));
    });
  }

  el.querySelectorAll('.print-spool-reconcile').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const printId = btn.dataset.printId;
      const spoolId = btn.dataset.spoolId;
      const value = prompt(`Actual remaining grams for spool #${spoolId}`);
      if (value === null) return;
      const remaining = parseFloat(value);
      if (isNaN(remaining) || remaining < 0) {
        alert('Enter a valid remaining gram value.');
        return;
      }
      const usage = print.spool_usage.find(u => String(u.spool_id) === String(spoolId));
      let startRemaining = null;
      if (usage && usage.remaining_start_g == null) {
        const startValue = prompt(`Starting grams for spool #${spoolId} before this print (optional)`, usage.remaining_before_g ?? '');
        if (startValue === null) return;
        if (startValue.trim() !== '') {
          startRemaining = parseFloat(startValue);
          if (isNaN(startRemaining) || startRemaining < 0) {
            alert('Enter a valid starting gram value.');
            return;
          }
        }
      }
      let exclusive = false;
      if (print.spool_usage.length > 1) {
        exclusive = confirm('Was this the only spool actually used for this print? OK will remove the other usage rows and restore their deducted grams.');
      }
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const payload = { remaining_g: remaining, exclusive };
        if (startRemaining !== null) payload.start_remaining_g = startRemaining;
        const r = await fetch(`/api/prints/${printId}/spool_usage/${spoolId}/reconcile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || 'Reconcile failed');
        if (usage) {
          usage.actual_grams = data.actual_grams;
          usage.waste_grams = data.waste_grams;
          usage.remaining_after_g = data.remaining_g;
          if (startRemaining !== null) usage.remaining_start_g = startRemaining;
        }
        if (exclusive) {
          print.spool_usage = print.spool_usage.filter(u => String(u.spool_id) === String(spoolId));
        }
        await _refreshSpoolsByPrinter();
        _showPrintDetail(printerId, dateStr, print);
      } catch (err) {
        alert(err.message || 'Reconcile failed');
        btn.disabled = false;
        btn.textContent = old;
      }
    });
  });

  const trail = el.querySelector('.decision-trail');
  if (trail) {
    trail.addEventListener('toggle', function () {
      if (!this.open) return;
      const list = this.querySelector('.decision-list');
      if (list.dataset.loaded) return;
      list.dataset.loaded = '1';
      const pid = this.dataset.printId;
      const prid = this.dataset.printerId;
      fetch(`/api/printers/${prid}/prints/${pid}/decisions`)
        .then(r => r.ok ? r.json() : [])
        .then(decisions => {
          if (!decisions.length) {
            list.innerHTML = '<span class="decision-empty">No decisions recorded.</span>';
            return;
          }
          list.innerHTML = decisions.map(d => {
            const ts = new Date(d.logged_at.endsWith('Z') ? d.logged_at : d.logged_at + 'Z')
              .toLocaleTimeString([], _clockOpts({ second: '2-digit' }));
            const detail = d.detail
              ? `<span class="decision-detail">${d.detail}</span>`
              : '';
            return `<div class="decision-item">
              <span class="decision-ts">${ts}</span>
              <span class="decision-event">${d.event}</span>
              ${detail}
            </div>`;
          }).join('');
        })
        .catch(() => { list.innerHTML = '<span class="decision-empty">Failed to load.</span>'; });
    });
  }
}

function _renderDayList(printerId, dateStr, prints, el) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const header = d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  if (!prints.length) {
    el.innerHTML = `<div class="history-day-panel"><div class="history-day-header">${header}</div><div class="print-empty">No prints recorded.</div></div>`;
    return;
  }
  el.innerHTML = `<div class="history-day-panel"><div class="history-day-header">${header}</div>${prints.map((p, i) => _printRowHtml(p, i, dateStr)).join('')}</div>`;
}

async function _loadDayDetail(printerId, dateStr) {
  const el = document.getElementById('history-day-detail');
  if (!el) return;

  const key = `${printerId}:${dateStr}`;
  if (_dayPrintsCache[key]) {
    _renderDayList(printerId, dateStr, _dayPrintsCache[key], el);
    return;
  }

  el.innerHTML = `<div class="history-day-loading">…</div>`;
  let prints = [];
  try {
    const r = await fetch(`/api/printers/${printerId}/history/day/${dateStr}`);
    if (r.ok) prints = await r.json();
  } catch {}

  _dayPrintsCache[key] = prints;
  _renderDayList(printerId, dateStr, prints, el);
}

async function _renderHistoryBody(printerId) {
  const el = document.getElementById('history-body');
  if (!el) return;

  if (!_historyYear[printerId]) _historyYear[printerId] = new Date().getUTCFullYear();
  const year = _historyYear[printerId];
  const currentYear = new Date().getUTCFullYear();

  let data = { days: [], summary: {} };
  try {
    const r = await fetch(`/api/printers/${printerId}/history/calendar?year=${year}`);
    if (r.ok) data = await r.json();
  } catch {}

  el.innerHTML =
    _historyYearNav(year, currentYear) +
    _historySummaryLine(data.summary) +
    _historyHeatmap(printerId, data.days, year) +
    `<div id="history-day-detail"></div>`;

  el.querySelector('[data-year-prev]')?.addEventListener('click', () => {
    _historyYear[printerId] = year - 1;
    _renderHistoryBody(printerId);
  });
  el.querySelector('[data-year-next]')?.addEventListener('click', () => {
    _historyYear[printerId] = year + 1;
    _renderHistoryBody(printerId);
  });

  el.querySelector(`#heat-grid-${printerId}`)?.addEventListener('click', e => {
    const cell = e.target.closest('.heat-cell');
    if (!cell || cell.classList.contains('heat-future') || cell.classList.contains('heat-out')) return;
    el.querySelectorAll('.heat-cell.selected').forEach(c => c.classList.remove('selected'));
    cell.classList.add('selected');
    _loadDayDetail(printerId, cell.dataset.date);
  });

  // Print row → detail; back button → day list
  el.addEventListener('click', e => {
    const back = e.target.closest('[data-back-date]');
    if (back) { _loadDayDetail(printerId, back.dataset.backDate); return; }
    const row = e.target.closest('.print-row[data-print-idx]');
    if (row) {
      const key = `${printerId}:${row.dataset.date}`;
      const prints = _dayPrintsCache[key];
      if (prints) _showPrintDetail(printerId, row.dataset.date, prints[parseInt(row.dataset.printIdx, 10)]);
    }
  });
}

// ── Maintenance tab ───────────────────────────────────────────────────────

function _maintenanceBadge(item) {
  if (item.archived_at) return `<span class="maint-badge maint-badge-archived">Archived</span>`;
  if (item.is_due) return `<span class="maint-badge maint-badge-due">Due</span>`;
  return `<span class="maint-badge maint-badge-ok">OK</span>`;
}

function _maintenanceMeta(item) {
  const parts = [];
  if (item.due_at) {
    const days = item.days_until_due;
    const label = days == null ? item.due_at
      : days < 0 ? `${Math.abs(days)}d overdue`
      : days === 0 ? 'due today'
      : `${days}d left`;
    parts.push(`Date: ${label}`);
  }
  if (item.interval_days) {
    parts.push(`${item.days_since ?? 0}/${item.interval_days}d`);
  }
  if (item.interval_prints) {
    parts.push(`${item.prints_since}/${item.interval_prints} prints`);
  }
  if (item.interval_hours) {
    parts.push(`${item.hours_since}/${item.interval_hours}h`);
  }
  if (item.last_completed_at) {
    const ts = item.last_completed_at.endsWith('Z') ? item.last_completed_at : item.last_completed_at + 'Z';
    parts.push(`last done ${new Date(ts).toLocaleDateString()}`);
  }
  return parts.length ? parts.join(' · ') : 'No trigger set';
}

function _maintenanceCard(item) {
  const notes = item.notes ? `<div class="maint-notes">${esc(item.notes)}</div>` : '';
  const data = [
    `data-id="${item.id}"`,
    `data-title="${esc(item.title)}"`,
    `data-notes="${esc(item.notes || '')}"`,
    `data-due-at="${esc(item.due_at || '')}"`,
    `data-interval-days="${item.interval_days || ''}"`,
    `data-interval-prints="${item.interval_prints || ''}"`,
    `data-interval-hours="${item.interval_hours || ''}"`,
  ].join(' ');
  return `<article class="maint-card ${item.is_due ? 'maint-card-due' : ''}" ${data}>
    <div class="maint-card-main">
      <div class="maint-card-head">
        <h3>${esc(item.title)}</h3>
        ${_maintenanceBadge(item)}
      </div>
      <div class="maint-meta">${esc(_maintenanceMeta(item))}</div>
      ${notes}
    </div>
    <div class="maint-actions">
      <button class="maint-btn maint-complete" data-maint-action="complete" title="Mark complete">Done</button>
      <button class="maint-btn" data-maint-action="edit" title="Edit">Edit</button>
      <button class="maint-btn maint-delete" data-maint-action="delete" title="Archive">Del</button>
    </div>
  </article>`;
}

function _maintenanceForm(printerId, item = null) {
  const isEdit = !!item;
  return `<form class="maint-form" data-maint-form data-printer-id="${printerId}" ${isEdit ? `data-id="${item.id}"` : ''}>
    <div class="maint-form-grid">
      <label class="maint-field maint-title-field">
        <span>Task</span>
        <input name="title" required maxlength="80" value="${esc(item?.title || '')}" placeholder="Clean rods, grease Z, inspect nozzle">
      </label>
      <label class="maint-field">
        <span>Due date</span>
        <input name="due_at" type="date" value="${esc(item?.due_at || '')}">
      </label>
      <label class="maint-field">
        <span>Every days</span>
        <input name="interval_days" type="number" min="1" step="1" value="${item?.interval_days || ''}">
      </label>
      <label class="maint-field">
        <span>Every prints</span>
        <input name="interval_prints" type="number" min="1" step="1" value="${item?.interval_prints || ''}">
      </label>
      <label class="maint-field">
        <span>Every hours</span>
        <input name="interval_hours" type="number" min="1" step="0.5" value="${item?.interval_hours || ''}">
      </label>
    </div>
    <label class="maint-field">
      <span>Notes</span>
      <textarea name="notes" rows="2" placeholder="Parts, lubricant, torque notes">${esc(item?.notes || '')}</textarea>
    </label>
    <div class="maint-form-actions">
      ${isEdit ? '<button type="button" class="maint-btn" data-maint-cancel>Cancel</button>' : ''}
      <button type="submit" class="maint-primary">${isEdit ? 'Save' : 'Add task'}</button>
    </div>
  </form>`;
}

async function _renderMaintenanceBody(printerId) {
  const el = document.getElementById('maintenance-body');
  if (!el) return;

  let items = [];
  try {
    const r = await fetch(`/api/printers/${printerId}/maintenance`);
    if (r.ok) items = await r.json();
  } catch {}

  const due = items.filter(i => i.is_due).length;
  const summary = items.length
    ? `${items.length} task${items.length !== 1 ? 's' : ''}${due ? ` · ${due} due` : ''}`
    : 'No maintenance tasks yet';

  el.innerHTML = `<div class="maint-header">
      <div class="maint-summary">${summary}</div>
    </div>
    ${_maintenanceForm(printerId)}
    <div class="maint-list">
      ${items.length ? items.map(_maintenanceCard).join('') : '<div class="maint-empty">No scheduled maintenance.</div>'}
    </div>`;
}

async function _submitMaintenanceForm(form) {
  const printerId = form.dataset.printerId;
  const itemId = form.dataset.id;
  const data = Object.fromEntries(new FormData(form).entries());
  const body = {
    title: data.title || '',
    notes: data.notes || null,
    due_at: data.due_at || null,
    interval_days: data.interval_days ? parseInt(data.interval_days, 10) : null,
    interval_prints: data.interval_prints ? parseInt(data.interval_prints, 10) : null,
    interval_hours: data.interval_hours ? parseFloat(data.interval_hours) : null,
  };
  const url = itemId
    ? `/api/printers/${printerId}/maintenance/${itemId}`
    : `/api/printers/${printerId}/maintenance`;
  const method = itemId ? 'PUT' : 'POST';
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('save failed');
  await _renderMaintenanceBody(printerId);
}

document.getElementById('view-printer').addEventListener('submit', e => {
  const form = e.target.closest('[data-maint-form]');
  if (!form) return;
  e.preventDefault();
  _submitMaintenanceForm(form).catch(() => showToast('Maintenance save failed', '', 'error'));
});

document.getElementById('view-printer').addEventListener('click', e => {
  const cancel = e.target.closest('[data-maint-cancel]');
  if (cancel) {
    const printerId = cancel.closest('[data-maint-form]')?.dataset.printerId;
    if (printerId) _renderMaintenanceBody(printerId);
    return;
  }

  const btn = e.target.closest('[data-maint-action]');
  if (!btn) return;
  const card = btn.closest('.maint-card');
  const body = document.getElementById('maintenance-body');
  const printerId = body?.dataset.printerId;
  if (!card || !printerId) return;
  const id = card.dataset.id;
  const action = btn.dataset.maintAction;

  if (action === 'edit') {
    const item = {
      id,
      title: card.dataset.title || '',
      notes: card.dataset.notes || '',
      due_at: card.dataset.dueAt || '',
      interval_days: card.dataset.intervalDays || '',
      interval_prints: card.dataset.intervalPrints || '',
      interval_hours: card.dataset.intervalHours || '',
    };
    const form = body.querySelector('[data-maint-form]');
    if (form) form.outerHTML = _maintenanceForm(printerId, item);
    return;
  }

  const run = async () => {
    const url = `/api/printers/${printerId}/maintenance/${id}${action === 'complete' ? '/complete' : ''}`;
    const method = action === 'delete' ? 'DELETE' : 'POST';
    const r = await fetch(url, { method });
    if (!r.ok) throw new Error('maintenance action failed');
    await _renderMaintenanceBody(printerId);
  };

  if (action === 'delete') {
    _modal.show('Archive this maintenance task?', () => run().catch(() => showToast('Maintenance action failed', '', 'error')));
  } else {
    run().catch(() => showToast('Maintenance action failed', '', 'error'));
  }
});

// ── Spool detail / traceability ───────────────────────────────────────────

function _spoolLocationText(s) {
  if (!s.location_printer_id) return _spoolStorageLocationName(s.storage_location_id);
  const p = _latestPrinters.find(x => x.id === s.location_printer_id);
  const slot = p ? _amsSlotLabel(p, s.location_slot ?? 0) : `S${(s.location_slot ?? 0) + 1}`;
  return `${p?.custom_name ?? s.location_printer_id} · ${slot}`;
}

function _spoolStorageLocationName(id) {
  const loc = _spoolLocations.find(l => String(l.id) === String(id));
  return loc?.name || 'Unassigned';
}

function _spoolTraceRow(row) {
  const p = _latestPrinters.find(x => x.id === row.printer_id);
  const raw = row.subtask_name || row.filename.replace(/.*[/\\]/, '');
  const name = raw.replace(/\.gcode(\.3mf)?$/i, '').replace(/\.3mf$/i, '');
  const ts = row.started_at ? new Date(row.started_at.endsWith('Z') ? row.started_at : row.started_at + 'Z') : null;
  const when = ts ? ts.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  const { cls, label } = _printBadge(row.final_state || 'FINISHED');
  const slot = row.usage_slot != null ? ` · ${p ? _amsSlotLabel(p, row.usage_slot) : `S${row.usage_slot + 1}`}` : '';
  return `<div class="spool-trace-row">
    <div class="spool-trace-main">
      <div class="spool-trace-name" title="${esc(row.filename)}">${esc(name)}</div>
      <div class="spool-trace-meta">${esc(p?.custom_name ?? row.printer_id)} · ${when}${slot}</div>
    </div>
    <div class="spool-trace-side">
      <span class="spool-trace-grams">${Number(row.usage_grams || 0).toFixed(1)}g</span>
      <span class="badge badge-${cls}" style="font-size:0.6rem;padding:0.15rem 0.5rem">${label}</span>
    </div>
  </div>`;
}

async function renderSpoolDetail(spoolId) {
  const el = document.getElementById('spool-detail');
  if (!el) return;
  el.innerHTML = `<div class="detail-placeholder" style="min-height:40vh">Loading...</div>`;

  let data = null;
  try {
    const [r, locs] = await Promise.all([
      fetch(`/api/spools/${spoolId}/trace`),
      _spoolLocations.length ? Promise.resolve(null) : fetch('/api/spool-locations').catch(() => null),
    ]);
    if (r.ok) data = await r.json();
    if (locs?.ok) _spoolLocations = await locs.json();
  } catch {}

  if (!data) {
    el.innerHTML = `<div class="detail-placeholder">Spool not found</div>`;
    return;
  }

  const pct = data.label_weight_g > 0 ? Math.round(data.remaining_g * 100 / data.label_weight_g) : 0;
  const used = Math.max(0, data.label_weight_g - data.remaining_g);
  const bandColor = data.color_hex || '#404040';
  const textColor = _spoolTextColor(bandColor);
  const progressColor = _spoolProgressColor(pct);
  const trace = data.usage || [];

  el.innerHTML = `<div class="spool-detail-page">
    <div class="spool-detail-top">
      <button class="print-detail-back" onclick="history.back()">← Back</button>
      <a class="print-detail-back" href="#/settings">Spools</a>
    </div>
    <section class="spool-detail-hero">
      <div class="spool-detail-band" style="background:${bandColor};color:${textColor}">
        <span class="spool-detail-colour">${esc(data.color_name || data.color_hex || 'Colour')}</span>
        <span class="spool-detail-id">#${data.id}</span>
      </div>
      <div class="spool-detail-body">
        <div>
          <h1>${esc(data.material)}${data.subtype ? ` ${esc(data.subtype)}` : ''}</h1>
          <div class="spool-detail-brand">${esc(data.brand || 'Unknown brand')}</div>
          <div class="spool-detail-location">${esc(_spoolLocationText(data))}</div>
        </div>
        <div class="spool-detail-weight">
          <span>${Math.round(data.remaining_g)}g</span>
          <small>remaining of ${Math.round(data.label_weight_g)}g</small>
        </div>
      </div>
      <div class="spool-progress-bar spool-detail-progress">
        <div class="spool-progress-fill" style="width:${pct}%;background:${progressColor}"></div>
      </div>
      <div class="spool-detail-stats">
        <span>${pct}% remaining</span>
        <span>${Math.round(used)}g consumed</span>
        <span>${Number(data.usage_total_g || 0).toFixed(1)}g traced</span>
        <span>${data.usage_count || 0} print${data.usage_count === 1 ? '' : 's'}</span>
      </div>
      ${data.notes ? `<div class="spool-detail-notes">${esc(data.notes)}</div>` : ''}
    </section>
    <section class="spool-trace-panel">
      <div class="history-day-header">Print Usage</div>
      ${trace.length ? trace.map(_spoolTraceRow).join('') : '<div class="print-empty">No print usage recorded for this spool yet.</div>'}
    </section>
  </div>`;
}

// ── Failure review ────────────────────────────────────────────────────────

let _failureDays = 90;
let _failureFilter = { printer: '', state: '', material: '' };

const _FAIL_TIMING_LABELS = {
  first_10m: 'First 10m',
  first_25pct: 'First 25%',
  mid_print: 'Mid-print',
  late_print: 'Late print',
  unknown: 'Unknown',
};

function _failureStatBlock(title, rows, formatter = x => x.key) {
  const body = rows?.length
    ? rows.slice(0, 5).map(r => `<div class="failure-stat-row"><span>${esc(formatter(r))}</span><strong>${r.count}</strong></div>`).join('')
    : '<div class="failure-empty">No data</div>';
  return `<section class="failure-stat">
    <h3>${title}</h3>
    ${body}
  </section>`;
}

function _failureRow(item) {
  const p = _latestPrinters.find(x => x.id === item.printer_id);
  const raw = item.subtask_name || item.filename.replace(/.*[/\\]/, '');
  const name = raw.replace(/\.gcode(\.3mf)?$/i, '').replace(/\.3mf$/i, '');
  const { cls, label } = _printBadge(item.final_state);
  const ts = item.started_at ? new Date(item.started_at.endsWith('Z') ? item.started_at : item.started_at + 'Z') : null;
  const when = ts ? ts.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const progress = item.progress_pct != null ? `${item.progress_pct}%` : '—';
  const mat = item.material || 'Unknown material';
  const spoolLinks = item.spool_usage?.length
    ? item.spool_usage.map(u => `<a href="#/spool/${u.spool_id}">#${u.spool_id}</a>`).join(', ')
    : '—';
  const snapshot = item.has_snapshot
    ? `<img src="/api/printers/${item.printer_id}/prints/${item.id}/snapshot" alt="" loading="lazy">`
    : '<span>No snapshot</span>';
  const error = item.error_message ? `<div class="failure-error">${esc(item.error_message)}</div>` : '';
  const dateHash = item.started_at ? item.started_at.slice(0, 10) : '';
  const historyLink = `#/printer/${item.printer_id}/history`;

  return `<article class="failure-row">
    <div class="failure-snapshot">${snapshot}</div>
    <div class="failure-main">
      <div class="failure-title-row">
        <div class="failure-name" title="${esc(item.filename)}">${esc(name)}</div>
        <span class="badge badge-${cls}" style="font-size:0.6rem;padding:0.15rem 0.5rem">${label}</span>
      </div>
      <div class="failure-meta">
        ${esc(p?.custom_name ?? item.printer_id)} · ${when} · ${esc(mat)} · ${esc(_FAIL_TIMING_LABELS[item.timing_bucket] || item.timing_bucket)}
      </div>
      ${error}
      <div class="failure-submeta">
        <span>Progress ${progress}</span>
        <span>Spools ${spoolLinks}</span>
        <a href="${historyLink}" title="${dateHash ? `Open ${dateHash} in history` : 'Open printer history'}">History</a>
      </div>
    </div>
  </article>`;
}

function _failureOptions(items, key, label, selected = '') {
  const vals = [...new Set(items.map(i => i[key]).filter(Boolean))].sort();
  return `<option value="">${label}</option>` + vals.map(v =>
    `<option value="${esc(v)}"${selected === v ? ' selected' : ''}>${esc(v)}</option>`
  ).join('');
}

async function renderFailuresView() {
  const el = document.getElementById('failures-page');
  if (!el) return;
  el.innerHTML = `<div class="detail-placeholder" style="min-height:40vh">Loading...</div>`;

  let data = { total: 0, items: [], summary: {} };
  try {
    const r = await fetch(`/api/failures?days=${_failureDays}`);
    if (r.ok) data = await r.json();
  } catch {}

  const all = data.items || [];
  const filtered = all.filter(i =>
    (!_failureFilter.printer || i.printer_id === _failureFilter.printer) &&
    (!_failureFilter.state || i.final_state === _failureFilter.state) &&
    (!_failureFilter.material || i.material === _failureFilter.material)
  );

  const spoolStats = data.summary.by_spool || [];
  const spoolStatHtml = spoolStats.length
    ? _failureStatBlock('By Spool', spoolStats, r => r.spool_id ? `Spool #${r.spool_id}` : 'Unknown')
    : '';

  el.innerHTML = `<div class="failures-header">
    <div>
      <h1>Failure Review</h1>
      <p>${data.total || 0} observed failure/cancel events in the last ${data.days || _failureDays} days</p>
    </div>
    <div class="failures-controls">
      <select id="failure-days">
        ${[30, 90, 180, 365].map(d => `<option value="${d}"${_failureDays === d ? ' selected' : ''}>${d} days</option>`).join('')}
      </select>
      <select data-failure-filter="printer">${_failureOptions(all, 'printer_id', 'All printers', _failureFilter.printer)}</select>
      <select data-failure-filter="final_state">${_failureOptions(all, 'final_state', 'All states', _failureFilter.state)}</select>
      <select data-failure-filter="material">${_failureOptions(all, 'material', 'All materials', _failureFilter.material)}</select>
    </div>
  </div>
  <div class="failure-stats">
    ${_failureStatBlock('By Printer', data.summary.by_printer || [], r => (_latestPrinters.find(p => p.id === r.key)?.custom_name ?? r.key))}
    ${_failureStatBlock('By Material', data.summary.by_material || [])}
    ${_failureStatBlock('Failure Timing', data.summary.by_timing || [], r => _FAIL_TIMING_LABELS[r.key] || r.key)}
    ${spoolStatHtml}
  </div>
  <div class="failure-list">
    ${filtered.length ? filtered.map(_failureRow).join('') : '<div class="failure-empty-panel">No matching failures.</div>'}
  </div>`;

  el.querySelector('#failure-days')?.addEventListener('change', e => {
    _failureDays = parseInt(e.target.value, 10);
    renderFailuresView();
  });
  el.querySelectorAll('[data-failure-filter]').forEach(sel => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.failureFilter;
      if (key === 'printer') _failureFilter.printer = sel.value;
      if (key === 'final_state') _failureFilter.state = sel.value;
      if (key === 'material') _failureFilter.material = sel.value;
      renderFailuresView();
    });
  });
}

async function renderPrinterDetail(id, subtab = 'live') {
  const el = document.getElementById('printer-detail');
  const p = _latestPrinters.find(x => x.id === id);

  const needsFullRender =
    _renderedDetailId !== id ||
    _renderedDetailSubtab !== subtab ||
    !_renderedDetailOk;

  _renderedDetailId = id;
  _renderedDetailSubtab = subtab;

  if (!p) {
    _renderedDetailOk = false;
    el.innerHTML = `<div class="detail-placeholder">Connecting…</div>`;
    return;
  }

  _renderedDetailOk = true;

  if (subtab === 'history') {
    if (needsFullRender) {
      el.innerHTML = _detailSubTabs(id, 'history') +
        `<div class="history-body" id="history-body">
          <div class="detail-placeholder" style="min-height:40vh">Loading…</div>
        </div>`;
      _renderHistoryBody(id);
    }
    return;
  }

  if (subtab === 'maintenance') {
    if (needsFullRender) {
      el.innerHTML = _detailSubTabs(id, 'maintenance') +
        `<div class="maintenance-body" id="maintenance-body" data-printer-id="${id}">
          <div class="detail-placeholder" style="min-height:40vh">Loading...</div>
        </div>`;
      _renderMaintenanceBody(id);
    }
    return;
  }

  // Live tab — fetch camera URL once
  if (_cameraUrlCache[id] === undefined) {
    try {
      const r = await fetch(`/api/printers/${id}/camera`);
      _cameraUrlCache[id] = r.ok ? (await r.json()).url : null;
    } catch { _cameraUrlCache[id] = null; }
  }

  if (needsFullRender) {
    const existingImg = el.querySelector('#detail-cam-img');
    if (existingImg) existingImg.src = '';

    const camSrc = _cameraStreamSrc(id);
    const camHtml = (camSrc && p.state !== 'offline')
      ? `<img id="detail-cam-img" src="${camSrc}" alt="Live camera" data-camera-id="${id}">`
      : `<div class="camera-hero-offline">${p.state === 'offline' ? 'Printer offline' : 'No camera configured'}</div>`;

    const printerColor = _printerColor(id);
    const bannerTextColor = p.icon === 'bambu' ? '#22c55e' : p.icon === 'voron' ? '#ef4444' : 'var(--text)';
    el.innerHTML =
      _detailSubTabs(id, 'live') +
      `<div class="detail-body">
        <div class="detail-left">
          <div class="camera-name-banner" style="--tab-accent:${printerColor};color:${bannerTextColor}">${p.custom_name}</div>
          <div class="camera-hero">${camHtml}</div>
        </div>
        <div class="detail-right">
          <div class="detail-controls detail-controls-wrap">${_detailControls(id, p)}</div>
          <div class="detail-panels">
            <div class="detail-panel" id="detail-print">${_detailPrintPanel(p)}</div>
            <div class="detail-panel" id="detail-temps">${_detailTempsPanel(p)}</div>
          </div>
          <div id="detail-ams">${_detailAmsPanel(p)}</div>
          <div id="detail-mmu">${_detailMmuPanel(p)}</div>
          <div id="detail-objects"></div>
        </div>
      </div>`;
    _attachCameraRetries(el);

    // Click cycles — desktop: normal→wide→fullscreen→normal; mobile: normal↔fullscreen
    _camZoom = 0;
    const hero = el.querySelector('.camera-hero');
    if (hero) {
      hero.addEventListener('click', () => {
        if (_tempModal.isOpen()) { _tempModal.close(); return; }
        const body = hero.closest('.detail-body');
        if (!body) return;
        const isMobile = window.innerWidth <= 900;
        if (isMobile) {
          if (_camZoom === 0) {
            _camZoom = 2;
            hero.requestFullscreen?.().catch(() => { _camZoom = 0; });
          } else {
            _camZoom = 0;
            if (document.fullscreenElement) document.exitFullscreen?.();
          }
        } else {
          _camZoom = (_camZoom + 1) % 3;
          if (_camZoom === 0) {
            body.classList.remove('cam-wide');
            if (document.fullscreenElement) {
              document.exitFullscreen?.();
              location.hash = '#/cameras';
            }
          } else if (_camZoom === 1) {
            body.classList.add('cam-wide');
          } else {
            body.classList.remove('cam-wide');
            hero.requestFullscreen?.().catch(() => { _camZoom = 1; body.classList.add('cam-wide'); });
          }
        }
      });
    }

    if (p.state === 'printing' || p.state === 'paused') refreshObjectsPanel(id);
  } else {
    // Restore camera stream if it was stopped when navigating away and back.
    const camImg = el.querySelector('#detail-cam-img');
    const camSrc = _cameraStreamSrc(id);
    if (camImg?.dataset.stopped && camSrc && p.state !== 'offline') {
      delete camImg.dataset.stopped;
      camImg.src = camSrc;
    }

    const ctrlEl = el.querySelector('.detail-controls-wrap');
    if (ctrlEl) ctrlEl.innerHTML = _detailControls(id, p);
    const printEl = el.querySelector('#detail-print');
    if (printEl) {
      const thumbCollapsed = !!printEl.querySelector('.detail-thumb.collapsed');
      printEl.innerHTML = _detailPrintPanel(p);
      if (thumbCollapsed) printEl.querySelector('.detail-thumb')?.classList.add('collapsed');
    }
    const tempsEl = el.querySelector('#detail-temps');
    if (tempsEl) tempsEl.innerHTML = _detailTempsPanel(p);
    const amsEl = el.querySelector('#detail-ams');
    if (amsEl) amsEl.innerHTML = _detailAmsPanel(p);
    const mmuEl = el.querySelector('#detail-mmu');
    if (mmuEl) mmuEl.innerHTML = _detailMmuPanel(p);
  }
}

// ── Print queue ───────────────────────────────────────────────────────────

const _QUEUE_STATUS_LABEL = {
  pending:   'Pending',
  uploading: 'Uploading…',
  printing:  'Printing',
  done:      'Done',
  failed:    'Failed',
  cancelled: 'Cancelled',
};

function _queueStatusBadge(status) {
  return `<span class="queue-badge queue-badge-${status}">${_QUEUE_STATUS_LABEL[status] || status}</span>`;
}

function _queuePreflightBadge(preflight) {
  if (!preflight) return '';
  return `<span class="queue-preflight queue-preflight-${preflight.status}">${preflight.label}</span>`;
}

function _queuePreflightIssues(preflight) {
  if (!preflight?.issues?.length) return '';
  return `<div class="queue-preflight-issues">
    ${preflight.issues.map(i => `<span class="queue-preflight-issue queue-preflight-${i.level}">${esc(i.message)}</span>`).join('')}
  </div>`;
}

function _fmtSeconds(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// ── Mission Control ───────────────────────────────────────────────────────

function _missionJobEta(job) {
  if (job.estimated_seconds) return Number(job.estimated_seconds);
  if (job.filament_weight_g) return Math.max(1800, Number(job.filament_weight_g) * 180);
  return 3600;
}

function _missionJobReadiness(job) {
  if (job.status === 'failed') return { cls: 'blocked', label: 'Failed', ok: false };
  if (job.status === 'cancelled') return { cls: 'blocked', label: 'Cancelled', ok: false };
  if (job.preflight?.can_start === false) return { cls: 'blocked', label: 'Blocked', ok: false };
  if (job.preflight?.status === 'warning') return { cls: 'warn', label: 'Caution', ok: true };
  if (!job.filament_type || !job.filament_weight_g) return { cls: 'warn', label: 'Metadata', ok: true };
  return { cls: 'ready', label: 'Ready', ok: true };
}

function _missionPrinterSignals(p, jobs, spools, maint) {
  const signals = [];
  if (p.state === 'offline') signals.push({ level: 'bad', text: 'Offline' });
  if (p.state === 'error' || p.state === 'estop') signals.push({ level: 'bad', text: p.error || 'Fault active' });
  if (p.state === 'paused') signals.push({ level: 'warn', text: 'Paused print' });
  if (p.health?.reasons?.length) signals.push({ level: p.health.status === 'attention' ? 'bad' : 'warn', text: p.health.reasons[0].message });
  const loaded = spools.filter(s => s.location_printer_id === p.id && !s.archived_at);
  const low = loaded.filter(s => s.label_weight_g > 0 && (s.remaining_g / s.label_weight_g * 100) < _latestLowStockPct);
  if (low.length) signals.push({ level: 'warn', text: `${low.length} loaded spool${low.length === 1 ? '' : 's'} low` });
  const dueMaint = (maint[p.id] || []).filter(i => !i.archived_at && (i.status === 'due' || i.due));
  if (dueMaint.length) signals.push({ level: 'warn', text: `${dueMaint.length} maintenance item${dueMaint.length === 1 ? '' : 's'} due` });
  if (!jobs.length && p.state === 'idle') signals.push({ level: 'ok', text: 'Idle and available' });
  return signals.slice(0, 4);
}

function _missionQueueForPrinter(jobs, printerId) {
  return jobs
    .filter(j => j.printer_id === printerId && !['done'].includes(j.status))
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.id - b.id);
}

function _missionLoadedLine(p, spools) {
  const loaded = spools.filter(s => s.location_printer_id === p.id && !s.archived_at);
  if (!loaded.length) return '<span class="mission-muted">No Flightdeck spools loaded</span>';
  return loaded.slice(0, 4).map(s => {
    const pct = s.label_weight_g > 0 ? Math.round(s.remaining_g / s.label_weight_g * 100) : 0;
    return `<span class="mission-spool-pill">
      <i style="background:${s.color_hex || '#808080'}"></i>
      ${esc(s.material)} ${esc(s.brand || '')} <b>${pct}%</b>
    </span>`;
  }).join('');
}

function _missionRecommendation(p, laneJobs, signals) {
  if (signals.some(s => s.level === 'bad')) return 'Hold for operator check';
  if (p.state === 'printing') return 'Monitor active print';
  if (p.state === 'paused') return 'Resolve paused print';
  if (laneJobs.some(j => _missionJobReadiness(j).cls === 'blocked')) return 'Clear blocked queue item';
  if (laneJobs.length) return 'Ready for next dispatch';
  return 'Available for new work';
}

function _missionPrinterBucket(p, laneJobs, signals) {
  if (signals.some(s => s.level === 'bad') || ['offline', 'error', 'estop'].includes(p.state)) return 'blocked';
  if (p.state === 'printing') return 'printing';
  if (p.state === 'paused' || signals.some(s => s.level === 'warn') || laneJobs.some(j => _missionJobReadiness(j).cls === 'blocked')) return 'attention';
  return 'ready';
}

function _missionControlPrefs() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const filter = params.get('filter') || 'all';
  return {
    filter: ['all', 'ready', 'printing', 'attention', 'blocked'].includes(filter) ? filter : 'all',
    sim: params.get('sim') === '30',
  };
}

function _missionHref(filter, sim) {
  const params = new URLSearchParams();
  if (filter && filter !== 'all') params.set('filter', filter);
  if (sim) params.set('sim', '30');
  const q = params.toString();
  return q ? `#/mission?${q}` : '#/mission';
}

function _missionSimPrinters(printers) {
  if (!printers.length) return [];
  return Array.from({ length: 30 }, (_, i) => {
    const base = printers[i % printers.length];
    const n = i + 1;
    const state = i % 9 === 0 ? 'offline' : i % 5 === 0 ? 'printing' : i % 7 === 0 ? 'paused' : base.state;
    return {
      ...base,
      id: `${base.id}-sim-${n}`,
      custom_name: `Sim Bay ${String(n).padStart(2, '0')}`,
      model_name: base.model_name,
      state,
      job: state === 'printing' ? { filename: `fleet_test_${n}.3mf` } : null,
      health: i % 6 === 0 ? { status: 'attention', reasons: [{ message: 'Simulated attention' }] } : base.health,
    };
  });
}

function _missionMaterial(job) {
  return String(job.filament_type || '').trim().toUpperCase();
}

function _missionLoadedSpools(printerId, spools) {
  return spools.filter(s => s.location_printer_id === printerId && !s.archived_at);
}

function _missionSpoolMatches(job, spool) {
  const material = _missionMaterial(job);
  if (!material) return false;
  return String(spool.material || '').toUpperCase() === material;
}

function _missionSpoolEnough(job, spool) {
  const required = Number(job.filament_weight_g || 0);
  return !required || Number(spool.remaining_g || 0) >= required;
}

function _missionJobColours(job) {
  if (!job.filament_colors) return [];
  if (Array.isArray(job.filament_colors)) return job.filament_colors;
  try {
    const parsed = JSON.parse(job.filament_colors);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function _missionSpoolMatchesColour(spool, colour) {
  if (!colour) return true;
  return _hexDistance(spool.color_hex, colour) <= 95;
}

const MISSION_COLOUR_NAMES = [
  ['Black', '#000000'],
  ['White', '#FFFFFF'],
  ['Grey', '#808080'],
  ['Silver', '#C0C0C0'],
  ['Red', '#EF4444'],
  ['Orange', '#F97316'],
  ['Yellow', '#EAB308'],
  ['Green', '#22C55E'],
  ['Teal', '#14B8A6'],
  ['Blue', '#3B82F6'],
  ['Dark Blue', '#1D4ED8'],
  ['Purple', '#8B5CF6'],
  ['Pink', '#EC4899'],
  ['Brown', '#7C4B00'],
  ['Gold', '#B8860B'],
];

function _missionColourLabel(colour) {
  const hex = _normHex(colour);
  if (!hex) return 'Unknown colour';
  const best = MISSION_COLOUR_NAMES
    .map(([name, ref]) => ({ name, dist: _hexDistance(hex, ref) }))
    .sort((a, b) => a.dist - b.dist)[0];
  return best && best.dist <= 115 ? best.name : hex;
}

function _missionColourSummary(job) {
  const colours = _missionJobColours(job)
    .map(c => _normHex(c.color))
    .filter(Boolean);
  return [...new Set(colours)];
}

function _missionColourRequirements(job) {
  const material = _missionMaterial(job);
  const byColour = new Map();
  _missionJobColours(job).forEach(item => {
    const colour = _normHex(item.color);
    if (!colour) return;
    const type = String(item.type || material || '').toUpperCase();
    const key = `${type}:${colour}`;
    const existing = byColour.get(key) || { type, colour, used_g: 0 };
    existing.used_g += Number(item.used_g || 0);
    byColour.set(key, existing);
  });
  return [...byColour.values()];
}

function _missionSpoolLabel(spool, printer) {
  const grams = Math.round(Number(spool.remaining_g || 0));
  const colour = spool.color_name ? `${spool.color_name} ` : '';
  const material = [colour + (spool.material || ''), spool.brand || ''].filter(Boolean).join(' · ');
  const where = spool.location_printer_id
    ? `${printer ? _amsSlotLabel(printer, spool.location_slot ?? 0) : `slot ${Number(spool.location_slot ?? 0) + 1}`}`
    : (spool.storage_location_name || 'storage');
  return `#${spool.id} ${material} · ${grams}g · ${where}`;
}

function _missionCoverageForRequirements(requirements, spools, printer) {
  const usedIds = new Set();
  const picks = [];
  const missing = [];
  requirements.forEach(req => {
    const candidates = spools
      .filter(s => !s.archived_at)
      .filter(s => String(s.material || '').toUpperCase() === req.type)
      .filter(s => _missionSpoolMatchesColour(s, req.colour));
    const pick = spools
      .filter(s => !s.archived_at && !usedIds.has(s.id))
      .filter(s => String(s.material || '').toUpperCase() === req.type)
      .filter(s => _missionSpoolMatchesColour(s, req.colour))
      .filter(s => !req.used_g || Number(s.remaining_g || 0) >= req.used_g)
      .sort((a, b) => Number(a.remaining_g || 0) - Number(b.remaining_g || 0))[0];
    if (pick) {
      usedIds.add(pick.id);
      picks.push(pick);
    } else {
      missing.push({ ...req, candidates });
    }
  });
  return {
    ok: missing.length === 0,
    picks,
    missing,
    text: picks.map(s => _missionSpoolLabel(s, printer)).join(' + '),
  };
}

function _missionRequirementLabel(req) {
  const brands = [...new Set((req.candidates || []).map(s => String(s.brand || '').trim()).filter(Boolean))];
  const brandText = brands.length ? brands.slice(0, 2).join(', ') + (brands.length > 2 ? ` +${brands.length - 2}` : '') : 'no loaded spool';
  const available = (req.candidates || []).reduce((sum, s) => sum + Number(s.remaining_g || 0), 0);
  const grams = req.used_g ? ` ${Math.round(available)}g/${Math.round(req.used_g)}g` : '';
  return `${_missionColourLabel(req.colour)} (${brandText})${grams}`;
}

function _missionRequirementName(req) {
  return `${_missionColourLabel(req.colour)} ${req.type || ''}`.trim();
}

function _missionMaterialRescue(job, target, printers, spools) {
  if (!target || !_missionMaterial(job)) return null;
  const requirements = _missionColourRequirements(job);
  const matchesJob = s => _missionSpoolMatches(job, s);
  const loaded = _missionLoadedSpools(target.id, spools).filter(s => _missionSpoolMatches(job, s));
  if (requirements.length) {
    const loadedCoverage = _missionCoverageForRequirements(requirements, loaded, target);
    if (job.preflight?.can_start !== false && loadedCoverage.ok) {
      return { kind: 'ready', text: `Ready now: ${loadedCoverage.text}` };
    }
    const samePrinterCoverage = _missionCoverageForRequirements(
      requirements,
      spools.filter(s => s.location_printer_id === target.id),
      target,
    );
    if (samePrinterCoverage.ok) {
      return { kind: 'slot', text: `Select ${samePrinterCoverage.text}` };
    }
    const shelfCoverage = _missionCoverageForRequirements(
      requirements,
      spools.filter(s => !s.location_printer_id),
      null,
    );
    if (shelfCoverage.ok) {
      return { kind: 'shelf', text: `Load ${shelfCoverage.text}` };
    }
    const mixedCoverage = _missionCoverageForRequirements(requirements, spools, target);
    if (mixedCoverage.ok) {
      return { kind: 'shelf', text: `Use ${mixedCoverage.text}` };
    }
    const missing = mixedCoverage.missing.map(r => _missionRequirementLabel(r)).join(' / ');
    return { kind: 'none', text: `Missing ${_missionMaterial(job)} colour coverage: ${missing}` };
  }
  const ready = loaded.find(s => _missionSpoolEnough(job, s));
  if (job.preflight?.can_start !== false && ready) {
    return { kind: 'ready', text: `Ready now: ${_missionSpoolLabel(ready, target)}` };
  }
  const samePrinter = spools
    .filter(s => s.location_printer_id === target.id && !s.archived_at && matchesJob(s) && _missionSpoolEnough(job, s))
    .sort((a, b) => Number(b.remaining_g || 0) - Number(a.remaining_g || 0))[0];
  if (samePrinter) {
    return { kind: 'slot', text: `Select ${_missionSpoolLabel(samePrinter, target)}` };
  }
  const shelf = spools
    .filter(s => !s.location_printer_id && !s.archived_at && matchesJob(s) && _missionSpoolEnough(job, s))
    .sort((a, b) => Number(b.remaining_g || 0) - Number(a.remaining_g || 0))[0];
  if (shelf) {
    return { kind: 'shelf', text: `Load ${_missionSpoolLabel(shelf, null)}` };
  }
  const total = spools
    .filter(s => !s.archived_at && _missionSpoolMatches(job, s))
    .reduce((sum, s) => sum + Number(s.remaining_g || 0), 0);
  return { kind: 'none', text: `No single ${_missionMaterial(job)} spool has enough. Total known stock ${Math.round(total)}g.` };
}

function _missionPrinterFit(job, p, spools, maint) {
  const reasons = [];
  let score = 0;
  if (['offline', 'error', 'estop'].includes(p.state)) {
    return { printer: p, score: -999, blocked: true, reasons: [p.state === 'offline' ? 'offline' : 'fault active'] };
  }
  if (p.state === 'printing') {
    score -= 30;
    reasons.push('busy');
  } else if (p.state === 'paused') {
    score -= 45;
    reasons.push('paused');
  } else {
    score += 30;
    reasons.push('available');
  }

  const material = _missionMaterial(job);
  const required = Number(job.filament_weight_g || 0);
  const loaded = _missionLoadedSpools(p.id, spools);
  const matching = material ? loaded.filter(s => String(s.material || '').toUpperCase() === material) : [];
  const matchingStock = matching.reduce((sum, s) => sum + Number(s.remaining_g || 0), 0);
  const requirements = _missionColourRequirements(job);
  const colourCoverage = requirements.length ? _missionCoverageForRequirements(requirements, matching, p) : null;
  if (material && matching.length) {
    score += 45;
    reasons.push(colourCoverage?.ok === false ? `${material} partial` : `${material} loaded`);
    if (colourCoverage?.ok) {
      score += 35;
      reasons.push('colours ok');
    } else if (requirements.length) {
      score -= 35;
      reasons.push('colour missing');
    } else if (required && matchingStock >= required) {
      score += 25;
      reasons.push('stock ok');
    } else if (required) {
      score -= 35;
      reasons.push('low stock');
    }
  } else if (material) {
    score -= 40;
    reasons.push(`no ${material} loaded`);
  } else {
    score -= 8;
    reasons.push('metadata missing');
  }

  if (p.health?.status === 'attention') {
    score -= 20;
    reasons.push('health attention');
  }
  const dueMaint = (maint[p.id] || []).some(i => !i.archived_at && (i.status === 'due' || i.due));
  if (dueMaint) {
    score -= 15;
    reasons.push('maintenance due');
  }
  if (job.printer_id === p.id) {
    score += 12;
    reasons.push('current target');
  }
  return { printer: p, score, blocked: false, reasons };
}

function _missionBestPrinter(job, printers, spools, maint) {
  const fits = printers.map(p => _missionPrinterFit(job, p, spools, maint))
    .sort((a, b) => b.score - a.score || _dashboardPrinterName(a.printer).localeCompare(_dashboardPrinterName(b.printer)));
  return fits[0] || null;
}

function _missionJobKey(job) {
  const name = String(job.filename || '').replace(/.*[\\/]/, '').toLowerCase();
  const material = _missionMaterial(job) || '';
  const colours = _missionColourSummary(job).join(',');
  const grams = Math.round(Number(job.filament_weight_g || 0));
  return `${name}|${material}|${grams}|${colours}`;
}

function _missionDedupPendingJobs(jobs) {
  const grouped = new Map();
  jobs.filter(j => j.status === 'pending').forEach(job => {
    const key = _missionJobKey(job);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...job, _missionCopies: [job] });
    } else {
      existing._missionCopies.push(job);
      const existingReady = existing.preflight?.can_start === true;
      const jobReady = job.preflight?.can_start === true;
      if (jobReady && !existingReady) {
        grouped.set(key, { ...job, _missionCopies: existing._missionCopies });
      }
    }
  });
  return [...grouped.values()];
}

function _missionBestShelfSpool(req, spools) {
  return spools
    .filter(s => !s.archived_at && !s.location_printer_id)
    .filter(s => String(s.material || '').toUpperCase() === req.type)
    .filter(s => _missionSpoolMatchesColour(s, req.colour))
    .filter(s => !req.used_g || Number(s.remaining_g || 0) >= req.used_g)
    .sort((a, b) => Number(a.remaining_g || 0) - Number(b.remaining_g || 0))[0];
}

function _missionFixSteps(job, printers, spools) {
  const best = _missionBestPrinter(job, printers, spools, {});
  const copies = job._missionCopies || [job];
  const targetJob = best?.printer ? (copies.find(copy => copy.printer_id === best.printer.id) || job) : job;
  const target = best?.printer || printers.find(p => p.id === targetJob.printer_id);
  const targetName = target ? _dashboardPrinterName(target) : 'target printer';
  const steps = [];
  const requirements = _missionColourRequirements(job);
  const loaded = target ? _missionLoadedSpools(target.id, spools) : [];
  if (requirements.length) {
    const coverage = _missionCoverageForRequirements(requirements, loaded, target);
    coverage.missing.forEach(req => {
      const shelf = _missionBestShelfSpool(req, spools);
      if (shelf) {
        steps.push(`Load ${_missionSpoolLabel(shelf, null)} into ${targetName} for ${_missionRequirementName(req)}`);
      } else if ((req.candidates || []).length) {
        steps.push(`${_missionRequirementName(req)} loaded on ${targetName} is short: ${_missionRequirementLabel(req)}`);
      } else {
        steps.push(`Add or load ${_missionRequirementName(req)} with ${Math.round(req.used_g || 0)}g+ remaining`);
      }
    });
  }
  (job.preflight?.issues || []).forEach(issue => {
    const msg = String(issue.message || '');
    if (/colour coverage|loaded filament short|No loaded spool matches required colour/i.test(msg)) return;
    if (/Printer is offline/i.test(msg)) steps.push(`Wake or reconnect ${targetName}`);
    else if (/Printer is (printing|paused|idle|finished|error|estop)/i.test(msg)) steps.push(msg);
    else if (/Maintenance due/i.test(msg)) steps.push(msg);
  });
  if (!steps.length) steps.push('Refresh queue preflight after loading filament');
  return steps.slice(0, 4);
}

function _missionFixItPanel(jobs, printers, spools) {
  const blocked = _missionDedupPendingJobs(jobs)
    .filter(j => _missionJobReadiness(j).cls === 'blocked')
    .slice(0, 3);
  if (!blocked.length) return '<div class="mission-empty-list">No queue fixes needed.</div>';
  return blocked.map(job => {
    const name = String(job.filename || '').replace(/.*[\\/]/, '');
    const steps = _missionFixSteps(job, printers, spools);
    return `<a class="mission-fix-card" href="#/queue">
      <span>${esc(name)}</span>
      <ol>${steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>
    </a>`;
  }).join('');
}

function _missionDispatchIntel(jobs, printers, spools, maint) {
  const pending = _missionDedupPendingJobs(jobs).slice(0, 8);
  if (!pending.length) return '<div class="mission-empty-list">No queued work to advise on.</div>';
  return pending.map(j => {
    const ready = _missionJobReadiness(j);
    const best = _missionBestPrinter(j, printers, spools, maint);
    const targetIds = new Set((j._missionCopies || [j]).map(copy => copy.printer_id));
    const target = best?.printer && targetIds.has(best.printer.id)
      ? best.printer
      : printers.find(p => p.id === j.printer_id);
    const name = j.filename.replace(/.*[\\/]/, '');
    const material = _missionMaterial(j) || 'Unknown material';
    const colours = _missionColourSummary(j);
    const rescue = _missionMaterialRescue(j, target, printers, spools);
    const recommendation = best && best.score > -100
      ? `${_dashboardPrinterName(best.printer)} · ${best.reasons.slice(0, 3).join(' · ')}`
      : 'No suitable printer right now';
    const changed = best?.printer && target && !targetIds.has(best.printer.id);
    const copies = (j._missionCopies?.length || 1) > 1 ? ` · ${j._missionCopies.length} queue copies` : '';
    const colourText = colours.map(c => _missionColourLabel(c)).join(' / ');
    return `<a class="mission-intel-row mission-${ready.cls}" href="#/queue">
      <span>${esc(name)}</span>
      <small>${esc(material)}${j.filament_weight_g ? ` · ${Math.round(j.filament_weight_g)}g` : ''}${colourText ? ` · ${esc(colourText)}` : ''}${copies}</small>
      <strong>${changed ? 'Recommend ' : ''}${esc(recommendation)}</strong>
      ${rescue ? `<em class="mission-rescue mission-rescue-${rescue.kind}">${esc(rescue.text)}</em>` : ''}
    </a>`;
  }).join('');
}

async function renderMissionControl() {
  const el = document.getElementById('mission-page');
  if (!el) return;
  if (_missionRenderInFlight) return;
  _missionRenderInFlight = true;
  if (!_missionLastHtml) {
    el.innerHTML = `<div class="detail-placeholder">Loading Mission Control...</div>`;
  }
  try {
    const [printers, jobs, spools] = await Promise.all([
      fetch('/api/printers').then(r => { if (!r.ok) throw new Error('printers'); return r.json(); }),
      fetch('/api/queue').then(r => { if (!r.ok) throw new Error('queue'); return r.json(); }),
      fetch('/api/spools').then(r => { if (!r.ok) throw new Error('spools'); return r.json(); }),
    ]);
    _latestPrinters = printers;
    _allSpools = spools;
    const prefs = _missionControlPrefs();
    const missionPrinters = prefs.sim ? _missionSimPrinters(printers) : printers;
    const maintPairs = await Promise.all(printers.map(async p => {
      try {
        const r = await fetch(`/api/printers/${p.id}/maintenance`);
        return [p.id, r.ok ? await r.json() : []];
      } catch {
        return [p.id, []];
      }
    }));
    const maint = Object.fromEntries(maintPairs);
    const active = missionPrinters.filter(p => p.state === 'printing' || p.state === 'paused').length;
    const pendingJobs = jobs.filter(j => j.status === 'pending');
    const blocked = jobs.filter(j => _missionJobReadiness(j).cls === 'blocked').length;
    const caution = jobs.filter(j => _missionJobReadiness(j).cls === 'warn').length;
    const forecastSeconds = pendingJobs.reduce((sum, j) => sum + _missionJobEta(j), 0);
    const forecast = forecastSeconds ? new Date(Date.now() + forecastSeconds * 1000).toLocaleTimeString([], _clockOpts()) : 'Clear';
    const printerContexts = missionPrinters.map(p => {
      const laneJobs = _missionQueueForPrinter(jobs, p.id.replace(/-sim-\d+$/, ''));
      const signals = _missionPrinterSignals(p, laneJobs, spools, maint);
      return { p, laneJobs, signals, bucket: _missionPrinterBucket(p, laneJobs, signals) };
    });
    const filteredContexts = prefs.filter === 'all'
      ? printerContexts
      : printerContexts.filter(c => c.bucket === prefs.filter);
    const counts = printerContexts.reduce((acc, c) => {
      acc[c.bucket] = (acc[c.bucket] || 0) + 1;
      return acc;
    }, { all: printerContexts.length });
    const denseFleet = missionPrinters.length >= 8;
    const laneJobLimit = denseFleet ? 3 : 6;
    el.classList.toggle('mission-page-dense', denseFleet);

    const filterBar = [
      ['all', 'All', counts.all || 0],
      ['ready', 'Ready', counts.ready || 0],
      ['printing', 'Printing', counts.printing || 0],
      ['attention', 'Needs attention', counts.attention || 0],
      ['blocked', 'Blocked', counts.blocked || 0],
    ].map(([id, label, count]) =>
      `<a class="mission-filter ${prefs.filter === id ? 'active' : ''}" href="${_missionHref(id, prefs.sim)}">${label}<b>${count}</b></a>`
    ).join('');
    const simToggle = `<div class="mission-sim-actions">
      <a class="mission-sim-toggle ${prefs.sim ? 'active' : ''}" href="${_missionHref(prefs.filter, !prefs.sim)}">${prefs.sim ? '30-printer sim on' : 'Sim 30 printers'}</a>
      ${prefs.sim ? '<a class="mission-sim-toggle" href="#/cameras?sim=30">View 30 cameras</a>' : ''}
    </div>`;

    const lanes = filteredContexts.map(({ p, laneJobs, signals, bucket }) => {
      const activeJob = p.job ? jobDisplayName(p.job) : '';
      const visibleLaneJobs = laneJobs.slice(0, laneJobLimit);
      const queueBlocks = visibleLaneJobs.map(j => {
        const ready = _missionJobReadiness(j);
        const width = Math.max(16, Math.min(46, _missionJobEta(j) / 900));
        return `<a class="mission-timeline-block mission-${ready.cls}" href="#/queue" style="--w:${width}">
          <span>${esc(j.filename.replace(/.*[\\/]/, ''))}</span>
          <small>${ready.label}</small>
        </a>`;
      }).join('');
      const queueMore = laneJobs.length > laneJobLimit
        ? `<a class="mission-timeline-more" href="#/queue">+${laneJobs.length - laneJobLimit} more</a>`
        : '';
      const queueHtml = queueBlocks || '<div class="mission-empty-lane">No queued work</div>';
      return `<section class="mission-lane mission-lane-${bucket}">
        <div class="mission-lane-head">
          <div>
            <a class="mission-printer-name" href="#/printer/${p.id}">${esc(_dashboardPrinterName(p))}</a>
            <div class="mission-printer-sub">${esc(p.custom_name || '')}</div>
          </div>
          <span class="badge badge-${p.state}">${esc(p.state || 'unknown')}</span>
        </div>
        <div class="mission-now">
          <span>Now</span>
          <strong>${activeJob ? esc(activeJob) : esc(_missionRecommendation(p, laneJobs, signals))}</strong>
        </div>
        <div class="mission-timeline">${queueHtml}${queueMore}</div>
        <div class="mission-loaded">${_missionLoadedLine(p, spools)}</div>
        <div class="mission-signals">
          ${signals.map(s => `<span class="mission-signal mission-signal-${s.level}">${esc(s.text)}</span>`).join('')}
        </div>
      </section>`;
    }).join('') || `<div class="mission-empty-filter">No printers match this filter.</div>`;

    const dispatchReady = jobs
      .filter(j => j.status === 'pending' && _missionJobReadiness(j).cls === 'ready')
      .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || (a.position ?? 999) - (b.position ?? 999))
      .slice(0, 6)
      .map(j => {
        const ready = _missionJobReadiness(j);
        const p = printers.find(x => x.id === j.printer_id);
        return `<a class="mission-job-row mission-${ready.cls}" href="#/queue">
          <span>${esc(j.filename.replace(/.*[\\/]/, ''))}</span>
          <small>${esc(p ? _dashboardPrinterName(p) : j.printer_id)} · ${ready.label}</small>
        </a>`;
      }).join('') || '<div class="mission-empty-list">Nothing ready right now.</div>';

    const blockedJobs = jobs
      .filter(j => _missionJobReadiness(j).cls === 'blocked')
      .slice(0, 6)
      .map(j => {
        const ready = _missionJobReadiness(j);
        const p = printers.find(x => x.id === j.printer_id);
        return `<a class="mission-job-row mission-blocked" href="#/queue">
          <span>${esc(j.filename.replace(/.*[\\/]/, ''))}</span>
          <small>${esc(p ? _dashboardPrinterName(p) : j.printer_id)} · ${ready.label}</small>
        </a>`;
      }).join('') || '<div class="mission-empty-list">No blocked queue items.</div>';

    const html = `
      <section class="mission-hero">
        <div>
          <div class="mission-eyebrow">Mission Control</div>
          <h1>Farm forecast</h1>
          <p>${missionPrinters.length} printers${prefs.sim ? ' simulated' : ''} · ${active} active · ${pendingJobs.length} pending · finish forecast ${esc(forecast)}</p>
        </div>
        <div class="mission-kpis">
          <div><strong>${pendingJobs.length}</strong><span>Pending</span></div>
          <div class="${blocked ? 'mission-kpi-bad' : ''}"><strong>${blocked}</strong><span>Blocked</span></div>
          <div class="${caution ? 'mission-kpi-warn' : ''}"><strong>${caution}</strong><span>Caution</span></div>
          <div><strong>${_fmtSeconds(forecastSeconds) || '0m'}</strong><span>Queued time</span></div>
        </div>
      </section>
      <section class="mission-commandbar">
        <div class="mission-filters">${filterBar}</div>
        ${simToggle}
      </section>
      <section class="mission-grid">
        <div class="mission-lanes">${lanes}</div>
        <aside class="mission-sidebar-panel">
          <div class="mission-panel-title">Dispatch Ready</div>
          <div class="mission-job-list">${dispatchReady}</div>
          <div class="mission-panel-title">Blocked</div>
          <div class="mission-job-list">${blockedJobs}</div>
          <div class="mission-panel-title">Fix It</div>
          <div class="mission-fix-list">${_missionFixItPanel(jobs, printers, spools)}</div>
          <div class="mission-panel-title">Dispatch Intel</div>
          <div class="mission-intel-list">${_missionDispatchIntel(jobs, printers, spools, maint)}</div>
          <div class="mission-panel-title">Operator Notes</div>
          <div class="mission-note">Dispatch intel is advisory only. It scores printers by availability, loaded matching filament, stock, health, maintenance, and current queue target.</div>
        </aside>
      </section>`;
    if (html !== _missionLastHtml) {
      _missionLastHtml = html;
      el.innerHTML = html;
    }
  } catch (err) {
    if (!_missionLastHtml) {
      el.innerHTML = `<div class="detail-placeholder">Mission Control unavailable.</div>`;
    }
  } finally {
    _missionRenderInFlight = false;
  }
}

function _queueJobCard(job, isFirst, isLast) {
  const isPending   = job.status === 'pending';
  const isActive    = job.status === 'printing' || job.status === 'uploading';
  const isRecoverable = job.status === 'failed' || job.status === 'cancelled';
  const previewSrc  = job.has_preview ? `/api/queue/${job.id}/preview` : '';
  const preflight = job.preflight;
  const canSend = !preflight || preflight.can_start;
  const meta = [
    job.filament_type || '',
    job.filament_weight_g ? `${Math.round(job.filament_weight_g)}g` : '',
    job.estimated_seconds ? _fmtSeconds(job.estimated_seconds) : '',
  ].filter(Boolean).join(' · ');

  return `<div class="queue-job ${isActive ? 'queue-job-active' : ''}" data-job-id="${job.id}">
    <div class="queue-job-thumb">
      ${previewSrc
        ? `<img src="${previewSrc}" alt="" loading="lazy">`
        : `<div class="queue-job-thumb-placeholder">🖨</div>`}
    </div>
    <div class="queue-job-body">
      <div class="queue-job-name" title="${job.filename}">${job.filename}</div>
      ${meta ? `<div class="queue-job-meta">${meta}</div>` : ''}
      <div class="queue-job-status-row">
        ${_queueStatusBadge(job.status)}
        ${_queuePreflightBadge(preflight)}
        ${job.error_msg ? `<span class="queue-job-error" title="${job.error_msg}">⚠ ${job.error_msg}</span>` : ''}
      </div>
      ${_queuePreflightIssues(preflight)}
    </div>
    <div class="queue-job-actions">
      ${isPending ? `
        <button class="queue-act-btn" data-action="up"   data-id="${job.id}" title="Move up"   ${isFirst ? 'disabled' : ''}>▲</button>
        <button class="queue-act-btn" data-action="down" data-id="${job.id}" title="Move down" ${isLast  ? 'disabled' : ''}>▼</button>
        <button class="queue-act-btn queue-act-send" data-action="send"   data-id="${job.id}" title="${canSend ? 'Send now' : 'Preflight blocked'}" ${canSend ? '' : 'disabled'}>▶</button>
        <button class="queue-act-btn queue-act-del"  data-action="delete" data-id="${job.id}" title="Remove">✕</button>
      ` : isRecoverable ? `
        <button class="queue-act-btn queue-act-retry" data-action="retry"  data-id="${job.id}" title="Retry">↺</button>
        <button class="queue-act-btn queue-act-del"   data-action="delete" data-id="${job.id}" title="Remove">✕</button>
      ` : ''}
    </div>
  </div>`;
}

function _queuePrinterSection(printerId, printerLabel, jobs, kind) {
  const accept   = kind === 'bambu' ? '.3mf,.gcode.3mf' : '.gcode,.gcode.gz,.ufp';
  const pending  = jobs.filter(j => j.status === 'pending');
  const active   = jobs.filter(j => j.status === 'printing' || j.status === 'uploading');
  const completed = jobs.filter(j => ['done','failed','cancelled'].includes(j.status));

  const totalSecs = pending.reduce((s, j) => s + (j.estimated_seconds || 0), 0);
  const summary = pending.length
    ? `${pending.length} pending${totalSecs ? ` · ~${_fmtSeconds(totalSecs)}` : ''}`
    : active.length ? 'Printing…' : '';

  const jobsHtml = jobs.length
    ? jobs.map(j => {
        const pIdx = pending.indexOf(j);
        return _queueJobCard(j, pIdx === 0, pIdx === pending.length - 1);
      }).join('')
    : '<div class="queue-empty">No jobs queued</div>';

  return `<section class="queue-printer-section" data-printer-id="${printerId}">
    <div class="queue-printer-header">
      <h2 class="queue-printer-name">${printerLabel}</h2>
      ${summary ? `<span class="queue-section-summary">${summary}</span>` : ''}
      <div class="queue-header-right">
        ${completed.length ? `<button class="queue-clear-btn" data-action="clear-completed" data-printer-id="${printerId}">Clear done</button>` : ''}
        <span class="queue-printer-kind">${kind}</span>
      </div>
    </div>
    <div class="queue-upload-area" data-printer-id="${printerId}">
      <label class="queue-upload-label">
        <input type="file" class="queue-file-input" accept="${accept}"
               data-printer-id="${printerId}" data-kind="${kind}">
        <span class="queue-upload-icon">⊕</span>
        <span class="queue-upload-text">Drop ${kind === 'bambu' ? '.gcode.3mf' : '.gcode / .gcode.gz / .ufp'} or click to browse</span>
      </label>
      <div class="queue-upload-progress" hidden></div>
    </div>
    <div class="queue-jobs" data-printer-id="${printerId}">${jobsHtml}</div>
  </section>`;
}

async function renderQueueView() {
  const el = document.getElementById('queue-page');
  try {
    const [jobsRaw, printersRaw] = await Promise.all([
      fetch('/api/queue').then(r => { if (!r.ok) throw new Error(`Queue API ${r.status}`); return r.json(); }),
      fetch('/api/printers').then(r => { if (!r.ok) throw new Error(`Printers API ${r.status}`); return r.json(); }),
    ]);
    const jobs = Array.isArray(jobsRaw) ? jobsRaw : [];
    const printers = Array.isArray(printersRaw) ? printersRaw : [];

    const byPrinter = {};
    for (const p of printers) byPrinter[p.id] = { label: _printerNavLabel(p), kind: p.kind, jobs: [] };
    for (const j of jobs) {
      if (byPrinter[j.printer_id]) byPrinter[j.printer_id].jobs.push(j);
    }

    el.innerHTML = Object.entries(byPrinter)
      .map(([pid, { label, kind, jobs: pjobs }]) =>
        _queuePrinterSection(pid, label, pjobs, kind))
      .join('');

    el.querySelectorAll('.queue-file-input').forEach(inp => {
      inp.addEventListener('change', e => _queueHandleFile(e.target));
    });
    el.querySelectorAll('.queue-upload-area').forEach(area => {
      area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
      area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
      area.addEventListener('drop', e => {
        e.preventDefault();
        area.classList.remove('drag-over');
        const inp = area.querySelector('.queue-file-input');
        if (e.dataTransfer.files[0] && inp) {
          _queueHandleFileRaw(inp.dataset.printerId, inp.dataset.kind, e.dataTransfer.files[0], area);
        }
      });
    });
    el.addEventListener('click', _queueHandleAction);
  } catch (err) {
    el.innerHTML = `<div class="detail-placeholder">Failed to load queue: ${err.message}</div>`;
  }
}

async function _queueHandleFile(inp) {
  if (!inp.files[0]) return;
  const area = inp.closest('.queue-upload-area');
  await _queueHandleFileRaw(inp.dataset.printerId, inp.dataset.kind, inp.files[0], area);
  inp.value = '';
}

async function _queueHandleFileRaw(printerId, kind, file, area) {
  const progress = area.querySelector('.queue-upload-progress');
  const label = area.querySelector('.queue-upload-label');
  progress.hidden = false;
  progress.textContent = `Uploading ${file.name}…`;
  label.style.opacity = '0.4';
  try {
    const fd = new FormData();
    fd.append('printer_id', printerId);
    fd.append('file', file, file.name);
    const r = await fetch('/api/queue/upload', { method: 'POST', body: fd });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail || r.statusText);
    }
    progress.textContent = '✓ Added to queue';
    setTimeout(() => renderQueueView(), 800);
  } catch (e) {
    progress.textContent = `✗ ${e.message}`;
    setTimeout(() => { progress.hidden = true; label.style.opacity = ''; }, 4000);
  } finally {
    label.style.opacity = '';
  }
}

async function _queueHandleAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, printerId } = btn.dataset;
  btn.disabled = true;
  try {
    if (action === 'delete') {
      if (!confirm('Remove this job from the queue?')) { btn.disabled = false; return; }
      await fetch(`/api/queue/${id}`, { method: 'DELETE' });
    } else if (action === 'up' || action === 'down') {
      await fetch(`/api/queue/${id}/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: action }),
      });
    } else if (action === 'send') {
      await fetch(`/api/queue/${id}/send`, { method: 'POST' });
    } else if (action === 'retry') {
      await fetch(`/api/queue/${id}/retry`, { method: 'POST' });
    } else if (action === 'clear-completed') {
      await fetch(`/api/queue/completed?printer_id=${encodeURIComponent(printerId)}`, { method: 'DELETE' });
    } else {
      btn.disabled = false; return;
    }
    await renderQueueView();
  } catch (err) {
    btn.disabled = false;
    alert(`Failed: ${err.message}`);
  }
}

// ── Cameras grid ──────────────────────────────────────────────────────────

function _camHeaderInner(p) {
  const badgeLabel = p.state === 'finished' ? 'complete' : p.state;
  return `<div class="printer-identity">
    <div class="printer-icon">${getIcon(p.icon)}</div>
    ${connDot(p.last_seen)}
    <div class="printer-names">
      ${_printerModelHtml(p)}
      <span class="printer-custom">${p.custom_name}</span>
    </div>
  </div>
  <span class="badge badge-${p.state}">${badgeLabel}</span>`;
}

function _cameraStreamSrc(printerId) {
  const url = _cameraUrlCache[printerId];
  if (!url) return null;
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
}

function _attachCameraRetries(root) {
  root.querySelectorAll('img[data-camera-id]').forEach(img => {
    let tries = 0;
    img.addEventListener('error', () => {
      if (tries >= 3) return;
      tries += 1;
      const url = _cameraUrlCache[img.dataset.cameraId];
      if (!url) return;
      setTimeout(() => {
        img.src = `${url}${url.includes('?') ? '&' : '?'}retry=${Date.now()}`;
      }, 1200 * tries);
    });
  });
}

function _camTileHtml(p) {
  const cameraId = p._camera_id || p.id;
  const camSrc = _cameraStreamSrc(cameraId);
  const feed = (camSrc && p.state !== 'offline')
    ? `<img src="${camSrc}" alt="${p.custom_name}" data-camera-id="${cameraId}">`
    : `<div class="cam-tile-offline">${p.state === 'offline' ? 'Offline' : 'No camera'}</div>`;
  return `<div class="cam-tile ${p._simulated ? 'cam-tile-sim' : ''}" data-printer-id="${p.id}" data-target-id="${p._source_id || p.id}" tabindex="0">
    <div class="cam-tile-header">${_camHeaderInner(p)}</div>
    ${p._simulated ? '<div class="cam-sim-ribbon">Simulated camera</div>' : ''}
    <div class="cam-tile-feed">${feed}</div>
  </div>`;
}

async function renderCamerasView() {
  const el = document.getElementById('cameras-grid');
  const sim = (location.hash || '').includes('sim=30');
  const mode = sim ? 'sim30' : 'live';
  const sourcePrinters = _latestPrinters || [];
  const cameraPrinters = sim
    ? _missionSimPrinters(sourcePrinters).map(p => {
        const source = sourcePrinters.find(x => p.id.startsWith(`${x.id}-sim-`)) || sourcePrinters[0];
        return { ...p, _simulated: true, _source_id: source?.id || p.id, _camera_id: source?.id || p.id };
      })
    : sourcePrinters;

  if (_camerasFull && _camerasMode === mode) {
    cameraPrinters.forEach(p => {
      const header = el.querySelector(`.cam-tile[data-printer-id="${p.id}"] .cam-tile-header`);
      if (header) header.innerHTML = _camHeaderInner(p);
    });
    return;
  }

  if (!sourcePrinters.length) {
    el.innerHTML = `<div class="detail-placeholder">Connecting…</div>`;
    return;
  }

  await Promise.all(sourcePrinters.map(async p => {
    if (_cameraUrlCache[p.id] === undefined) {
      try {
        const r = await fetch(`/api/printers/${p.id}/camera`);
        _cameraUrlCache[p.id] = r.ok ? (await r.json()).url : null;
      } catch { _cameraUrlCache[p.id] = null; }
    }
  }));

  el.classList.toggle('cameras-grid-sim', sim);
  el.innerHTML = cameraPrinters.map(_camTileHtml).join('');
  _attachCameraRetries(el);

  el.querySelectorAll('.cam-tile[data-printer-id]').forEach(tile => {
    tile.addEventListener('click', () => location.hash = `#/printer/${tile.dataset.targetId || tile.dataset.printerId}`);
    tile.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        location.hash = `#/printer/${tile.dataset.targetId || tile.dataset.printerId}`;
      }
    });
  });

  _camerasFull = true;
  _camerasMode = mode;
}

// ── Tab title ─────────────────────────────────────────────────────────────

function updateTitle(printers) {
  const errors   = printers.filter(p => p.state === 'error');
  const printing = printers.filter(p => p.state === 'printing');
  const paused   = printers.filter(p => p.state === 'paused');
  if (errors.length) {
    document.title = `⚠ ERROR · Flightdeck`;
  } else if (printing.length === 1) {
    const pct = Math.round((printing[0].job?.progress ?? 0) * 100);
    document.title = `${pct}% · ${printing[0].custom_name ?? 'Flightdeck'}`;
  } else if (printing.length > 1) {
    document.title = `${printing.length} printing · Flightdeck`;
  } else if (paused.length) {
    document.title = `⏸ Paused · Flightdeck`;
  } else {
    document.title = 'Flightdeck';
  }
}

// ── Print notifications ────────────────────────────────────────────────────

const _prevStates = {};
let _notifSeeded = false;

function _detectTransitions(printers) {
  if (!_notifSeeded) {
    printers.forEach(p => { _prevStates[p.id] = p.state; });
    _notifSeeded = true;
    return;
  }
  let anyTransition = false;
  printers.forEach(p => {
    const prev = _prevStates[p.id];
    _prevStates[p.id] = p.state;
    if (prev === p.state) return;
    anyTransition = true;

    let title = null, toastMsg = null, toastType = 'info';
    if (p.state === 'finished' && prev === 'printing') {
      title = 'Print complete'; toastMsg = 'Print complete'; toastType = 'success';
    } else if (p.state === 'error' && (prev === 'printing' || p._error_print_id)) {
      title = 'Print error'; toastMsg = 'Print error — check printer'; toastType = 'error';
    } else if (p.state === 'paused' && prev === 'printing') {
      title = 'Print paused'; toastMsg = 'Print paused'; toastType = 'info';
    }
    if (!title) return;

    // Toast: only when tab is visible (user is looking at the dashboard)
    if (document.visibilityState === 'visible') {
      const toastOpts = (toastType === 'success') ? { addNote: true, printerId: p.id } : {};
      showToast(toastMsg, p.custom_name, toastType, toastOpts);
    }

    // Browser notification: only when tab is hidden (ntfy covers the closed-browser case)
    if (Notification.permission === 'granted' && document.visibilityState === 'hidden') {
      new Notification(title, { body: p.custom_name });
    }
  });
  // Live-refresh queue page when a printer state changes (auto-advance may have fired)
  if (anyTransition && parseRoute().view === 'queue') renderQueueView();
}

function initNotifBtn() {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  if (!('Notification' in window) || !window.isSecureContext) {
    btn.classList.add('notif-unavailable');
    btn.title = `Notifications require HTTPS — open ${window.location.hostname} via https://`;
    return;
  }
  const update = () => {
    const perm = Notification.permission;
    btn.classList.toggle('notif-on',          perm === 'granted');
    btn.classList.toggle('notif-off',         perm === 'denied');
    btn.classList.remove('notif-unavailable');
    btn.title = perm === 'granted' ? 'Browser notifications on — fires when tab is in background'
              : perm === 'denied'  ? 'Notifications blocked — check browser site settings'
              : 'Enable browser notifications';
  };
  update();
  btn.addEventListener('click', async () => {
    if (Notification.permission === 'denied') return;
    await Notification.requestPermission();
    update();
  });
}

async function _updateQueueBadge() {
  try {
    const counts = await fetch('/api/queue/summary').then(r => r.json());
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const tab = document.querySelector('#tab-strip .tab[href="#/queue"]');
    if (tab) tab.textContent = total > 0 ? `Queue (${total})` : 'Queue';
  } catch {}
}

// ── Dashboard update ───────────────────────────────────────────────────────

function updateDashboard(printers) {
  // Clear pending controls when the printer's state has changed
  for (const id of Object.keys(_pendingControls)) {
    const p = printers.find(x => x.id === id);
    if (p && p.state !== _pendingControls[id].fromState) {
      delete _pendingControls[id];
    }
  }

  _detectTransitions(printers);
  updateTitle(printers);
  for (const p of printers) {
    const opt = _lightOptimistic[p.id];
    if (opt && (p.light_state === opt.state || Date.now() >= opt.expiresAt)) {
      delete _lightOptimistic[p.id];
    }
  }
  _latestPrinters = printers;
  if (!_tabsBuilt) buildTabs(printers);
  else router();
  _updateQueueBadge();

  // Refresh object exclusion panel on every tick when on live tab and printing
  const _route = parseRoute();
  if (_route.view === 'printer' && _route.subtab === 'live') {
    const _rp = printers.find(x => x.id === _route.id);
    if (_rp?.state === 'printing' || _rp?.state === 'paused') refreshObjectsPanel(_route.id);
  }

  const sortedPrinters = [...printers].sort((a, b) =>
    _dashboardStateRank(a) - _dashboardStateRank(b) ||
    _dashboardPrinterName(a).localeCompare(_dashboardPrinterName(b))
  );

  if (parseRoute().view === 'stats') renderStatsView();

  const grid = document.getElementById('printer-grid');
  grid.innerHTML = sortedPrinters.map(renderCard).join('');

  grid.querySelectorAll('[data-printer-id]').forEach(card => {
    const p = printers.find(x => x.id === card.dataset.printerId);
    if (p) card._printerData = p;
    attachCardEvents(card);
  });

  _refreshSpoolsByPrinter();

  updateStatusPill(printers);

  const active = printers.filter(p => p.state === 'printing' || p.state === 'paused').length;
  const idle = printers.filter(p => p.state === 'idle' || p.state === 'finished').length;
  document.getElementById('dash-footer').innerHTML =
    `<span>flightdeck · 192.168.4.127</span>` +
    `<span>${printers.length} printers · ${active} active · ${idle} idle</span>`;
}

function renderStatsView() {
  const el = document.getElementById('stats-page');
  if (!el) return;
  el.innerHTML = `
    <div class="stats-page">
      <div class="settings-section-title">Fleet Stats</div>
      ${_renderDashboardOverview(_latestPrinters || [])}
    </div>`;
}

// ── WebSocket client ───────────────────────────────────────────────────────

let ws = null;
let reconnectDelay = 1000;

function connectWS() {
  if (ws) {
    ws.onclose = ws.onerror = null;
    ws.close();
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws`);

  ws.onopen = () => {
    reconnectDelay = 1000;
    setLiveIndicator(true);
  };

  ws.onmessage = evt => {
    try {
      const data = JSON.parse(evt.data);
      if (data && !Array.isArray(data) && data.type === 'toast') {
        showToast(data.message, data.sub || '', data.toastType || 'warning');
      } else {
        updateDashboard(data);
      }
    } catch (e) {
      console.error('ws parse error', e);
    }
  };

  ws.onclose = ws.onerror = () => {
    setLiveIndicator(false);
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
      connectWS();
    }, reconnectDelay);
  };
}

// ── Settings view ─────────────────────────────────────────────────────────

let _settingsCategory = 'printers';

const _SETTINGS_CATEGORIES = [
  { id: 'printers',   label: 'Printers'   },
  { id: 'hardware',   label: 'Hardware'   },
  { id: 'appearance', label: 'Appearance' },
  { id: 'slicer',     label: 'Slicer'     },
  { id: 'filament',   label: 'Filament'   },
  { id: 'locations',  label: 'Locations'  },
];

async function refreshPrinters() {
  try {
    const r = await fetch('/api/printers');
    if (!r.ok) return;
    const printers = await r.json();
    _latestPrinters = printers;
    _tabsBuilt = false;
    buildTabs(printers);
  } catch {}
}

// ── Printers category ──────────────────────────────────────────────────────

const _DEFAULT_PRESETS = [
  { label: 'PLA',  hotend: 220, bed: 65  },
  { label: 'PETG', hotend: 245, bed: 80  },
  { label: 'ABS',  hotend: 250, bed: 100 },
  { label: 'ASA',  hotend: 255, bed: 110 },
];

function _printersCategoryHtml(printers) {
  const list = printers.length
    ? printers.map(p => {
        const connInfo = p.connection?.type === 'moonraker'
          ? `moonraker · ${p.connection.host}:${p.connection.port ?? 7125}`
          : `bambu · ${p.connection?.host ?? ''}`;
        return `<div class="settings-printer-row">
          <div class="printer-identity">
            <div class="printer-icon">${getIcon(p.icon ?? 'generic')}</div>
            <div class="printer-names">
            ${_printerModelHtml(p)}
              <span class="printer-custom">${p.custom_name}</span>
            </div>
          </div>
          <div class="settings-printer-meta">
            <span class="settings-printer-type">${connInfo}</span>
            <button class="settings-delete-btn"
              data-delete-id="${p.id}"
              data-delete-name="${p.custom_name}">Remove</button>
          </div>
        </div>`;
      }).join('')
    : `<div class="settings-empty">No printers configured.</div>`;

  const presetRows = _DEFAULT_PRESETS.map(p => `
    <tr class="preset-row">
      <td class="preset-material">${p.label}</td>
      <td><input type="number" class="settings-input preset-hotend"
          data-material="${p.label}" min="0" max="350" value="${p.hotend}"></td>
      <td><input type="number" class="settings-input preset-bed"
          data-material="${p.label}" min="0" max="150" value="${p.bed}"></td>
    </tr>`).join('');

  return `
    <div class="settings-section">
      <div class="settings-section-title">Printers</div>
      <div class="settings-printer-list">${list}</div>
    </div>

    <div class="settings-section">
      <div class="settings-section-title">Add Printer</div>
      <form id="settings-add-form" class="settings-form" novalidate>

        <div class="settings-form-row">
          <label class="settings-label">Connection Type</label>
          <div class="settings-type-toggle">
            <button type="button" class="type-btn type-btn-active" data-conn-type="moonraker">Moonraker</button>
            <button type="button" class="type-btn" data-conn-type="bambu">Bambu</button>
          </div>
        </div>

        <div class="settings-form-row">
          <label class="settings-label" for="p-id">
            ID <span class="settings-hint">(e.g. sovol_sv08)</span>
          </label>
          <input class="settings-input" id="p-id" type="text"
            placeholder="my_printer" autocomplete="off" required>
        </div>

        <div class="settings-form-row">
          <label class="settings-label" for="p-model">Model Name</label>
          <input class="settings-input" id="p-model" type="text"
            placeholder="Sovol SV08" required>
        </div>

        <div class="settings-form-row">
          <label class="settings-label" for="p-custom">Custom Name</label>
          <input class="settings-input" id="p-custom" type="text"
            placeholder="Workshop Beast" required>
        </div>

        <div class="settings-form-row">
          <label class="settings-label">Icon</label>
          <div class="settings-icon-select">
            <label class="icon-option">
              <input type="radio" name="icon" value="generic" checked> Generic
            </label>
            <label class="icon-option">
              <input type="radio" name="icon" value="voron"> Voron
            </label>
            <label class="icon-option">
              <input type="radio" name="icon" value="bambu"> Bambu
            </label>
          </div>
        </div>

        <div class="settings-form-group" id="moonraker-fields">
          <div class="settings-form-row">
            <label class="settings-label" for="p-host">Host / IP</label>
            <input class="settings-input" id="p-host" type="text"
              placeholder="192.168.1.100" autocomplete="off">
          </div>
          <div class="settings-form-row">
            <label class="settings-label" for="p-port">Port</label>
            <input class="settings-input" id="p-port" type="number"
              value="7125" min="1" max="65535" style="max-width:7rem">
          </div>
          <div class="settings-form-row">
            <label class="settings-label" for="p-cam-type">Camera</label>
            <select class="settings-input" id="p-cam-type" style="max-width:14rem">
              <option value="none">None</option>
              <option value="mjpeg_direct">MJPEG stream</option>
            </select>
          </div>
          <div class="settings-form-group" id="mjpeg-fields" hidden>
            <div class="settings-form-row">
              <label class="settings-label" for="p-stream-url">Stream URL</label>
              <input class="settings-input" id="p-stream-url" type="text"
                placeholder="http://192.168.1.100/webcam/?action=stream">
            </div>
            <div class="settings-form-row">
              <label class="settings-label" for="p-snap-url">
                Snapshot URL <span class="settings-hint">(optional)</span>
              </label>
              <input class="settings-input" id="p-snap-url" type="text"
                placeholder="http://192.168.1.100/webcam/?action=snapshot">
            </div>
          </div>
        </div>

        <div class="settings-form-group" id="bambu-fields" hidden>
          <div class="settings-form-row">
            <label class="settings-label" for="p-bambu-host">Host / IP</label>
            <input class="settings-input" id="p-bambu-host" type="text"
              placeholder="192.168.1.101" autocomplete="off">
          </div>
          <div class="settings-form-row">
            <label class="settings-label" for="p-access-code">Access Code</label>
            <input class="settings-input" id="p-access-code" type="text"
              placeholder="12345678" autocomplete="off">
          </div>
          <div class="settings-form-row">
            <label class="settings-label" for="p-serial">Serial Number</label>
            <input class="settings-input" id="p-serial" type="text"
              placeholder="01P00A123456789" autocomplete="off">
          </div>
          <div class="settings-form-row">
            <label class="settings-label">Camera</label>
            <label class="icon-option">
              <input type="checkbox" id="p-bambu-cam" checked>
              RTSP stream (requires LAN mode)
            </label>
          </div>
        </div>

        <div class="settings-form-row">
          <label class="settings-label">Temp Presets</label>
          <table class="preset-table">
            <thead>
              <tr>
                <th>Material</th>
                <th>Hotend (°C)</th>
                <th>Bed (°C)</th>
              </tr>
            </thead>
            <tbody>${presetRows}</tbody>
          </table>
        </div>

        <div class="settings-form-row settings-form-actions">
          <span class="settings-error" id="settings-form-error" hidden></span>
          <button type="submit" class="ctrl-btn">Add Printer</button>
        </div>

      </form>
    </div>`;
}

function _attachPrintersEvents(el) {
  let connType = 'moonraker';

  el.querySelectorAll('[data-conn-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      connType = btn.dataset.connType;
      el.querySelectorAll('[data-conn-type]').forEach(b =>
        b.classList.toggle('type-btn-active', b === btn)
      );
      el.querySelector('#moonraker-fields').hidden = connType !== 'moonraker';
      el.querySelector('#bambu-fields').hidden     = connType !== 'bambu';
      if (connType === 'bambu') {
        el.querySelector('input[name="icon"][value="bambu"]').checked = true;
      }
    });
  });

  el.querySelector('#p-cam-type')?.addEventListener('change', e => {
    el.querySelector('#mjpeg-fields').hidden = e.target.value !== 'mjpeg_direct';
  });

  el.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.deleteId;
      const name = btn.dataset.deleteName;
      _modal.show(
        `Remove "${name}" from Flightdeck? This takes effect immediately.`,
        () => _deletePrinter(id)
      );
    });
  });

  el.querySelector('#settings-add-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    await _submitAddPrinter(el, connType);
  });
}

function _collectFormData(el, connType) {
  const v = id => el.querySelector(`#${id}`)?.value.trim() ?? '';
  const icon = el.querySelector('input[name="icon"]:checked')?.value ?? 'generic';

  const hotend = [];
  const bed = [];
  el.querySelectorAll('.preset-row').forEach(row => {
    const mat = row.querySelector('.preset-hotend').dataset.material;
    const h = parseInt(row.querySelector('.preset-hotend').value, 10);
    const b = parseInt(row.querySelector('.preset-bed').value, 10);
    if (!isNaN(h)) hotend.push({ label: mat, value: h });
    if (!isNaN(b)) bed.push({ label: mat, value: b });
  });

  const base = {
    id: v('p-id'),
    model_name: v('p-model'),
    custom_name: v('p-custom'),
    icon,
    temperature_presets: { hotend, bed },
  };

  if (connType === 'moonraker') {
    const host    = v('p-host');
    const port    = parseInt(el.querySelector('#p-port').value, 10) || 7125;
    const camType = el.querySelector('#p-cam-type').value;
    const conn    = { type: 'moonraker', host, port };
    let camera    = null;
    if (camType === 'mjpeg_direct') {
      const streamUrl = v('p-stream-url');
      const snapUrl   = v('p-snap-url');
      camera = { type: 'mjpeg_direct', stream_url: streamUrl };
      if (snapUrl) camera.snapshot_url = snapUrl;
    }
    return { ...base, connection: conn, ...(camera ? { camera } : {}) };
  } else {
    const host       = v('p-bambu-host');
    const accessCode = v('p-access-code');
    const serial     = v('p-serial');
    const hasCam     = el.querySelector('#p-bambu-cam')?.checked;
    const conn       = { type: 'bambu', host, access_code: accessCode, serial };
    const camera     = hasCam ? { type: 'bambu_rtsp' } : null;
    return { ...base, connection: conn, ...(camera ? { camera } : {}) };
  }
}

function _validateFormData(data, connType, errorEl) {
  const fail = msg => { errorEl.textContent = msg; errorEl.removeAttribute('hidden'); return false; };
  errorEl.setAttribute('hidden', '');

  if (!data.id)          return fail('ID is required');
  if (!/^[a-z][a-z0-9_-]*$/.test(data.id))
                         return fail('ID must be lowercase letters, digits, underscores or hyphens — starting with a letter');
  if (!data.model_name)  return fail('Model name is required');
  if (!data.custom_name) return fail('Custom name is required');

  if (connType === 'moonraker') {
    if (!data.connection.host) return fail('Host / IP is required');
    if (data.camera?.type === 'mjpeg_direct' && !data.camera.stream_url)
      return fail('Stream URL is required for MJPEG camera');
  } else {
    if (!data.connection.host)        return fail('Host / IP is required');
    if (!data.connection.access_code) return fail('Access code is required');
    if (!data.connection.serial)      return fail('Serial number is required');
  }
  return true;
}

async function _submitAddPrinter(el, connType) {
  const errorEl   = el.querySelector('#settings-form-error');
  const submitBtn = el.querySelector('#settings-add-form button[type="submit"]');
  const data      = _collectFormData(el, connType);

  if (!_validateFormData(data, connType, errorEl)) return;

  const dup = await _checkDuplicateConnection(data, connType);
  if (dup) {
    const choice = await _showDuplicateModal(dup.custom_name, dup.id);
    if (choice !== 'continue') return;
  }

  const origText = submitBtn.textContent;
  submitBtn.textContent = 'Adding…';
  submitBtn.disabled = true;

  try {
    const r    = await fetch('/api/config/printers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await r.json();
    if (r.ok) {
      showToast('Printer added', data.custom_name, 'success');
      await refreshPrinters();
      _renderSettingsContent('printers');
    } else {
      fail(body.detail ?? 'Failed to add printer');
    }
  } catch {
    fail('Network error — check console');
  } finally {
    submitBtn.textContent = origText;
    submitBtn.disabled    = false;
  }

  function fail(msg) { errorEl.textContent = msg; errorEl.removeAttribute('hidden'); }
}

async function _checkDuplicateConnection(data, connType) {
  try {
    const r = await fetch('/api/config/printers');
    if (!r.ok) return null;
    const existing = await r.json();
    for (const p of existing) {
      const conn = p.connection;
      if (connType === 'moonraker' && conn.type === 'moonraker') {
        if (conn.host === data.connection.host && conn.port === data.connection.port) return p;
      } else if (connType === 'bambu' && conn.type === 'bambu') {
        if (conn.host === data.connection.host || conn.serial === data.connection.serial) return p;
      }
    }
  } catch {}
  return null;
}

function _showDuplicateModal(name, id) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-message">A printer with the same connection details already exists: <strong>${name}</strong>.<br><br>Adding another instance will create a separate dashboard card pulling the same data.</div>
        <div class="modal-actions">
          <button class="modal-btn" id="dup-cancel">Cancel</button>
          <button class="modal-btn" id="dup-view">View existing</button>
          <button class="modal-btn modal-btn-danger" id="dup-continue">Continue anyway</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const cleanup = result => { overlay.remove(); resolve(result); };
    overlay.querySelector('#dup-cancel').addEventListener('click', () => cleanup('cancel'));
    overlay.querySelector('#dup-view').addEventListener('click', () => {
      cleanup('view');
      location.hash = `#/printer/${id}`;
    });
    overlay.querySelector('#dup-continue').addEventListener('click', () => cleanup('continue'));
  });
}

async function _deletePrinter(id) {
  try {
    const r = await fetch(`/api/config/printers/${id}`, { method: 'DELETE' });
    if (r.ok) {
      showToast('Printer removed', id, 'info');
      await refreshPrinters();
      location.hash = '#/';
    } else {
      const body = await r.json();
      showToast('Remove failed', body.detail ?? '', 'error');
    }
  } catch {
    showToast('Network error', '', 'error');
  }
}

// ── Appearance category ────────────────────────────────────────────────────

// ── Slicer category ────────────────────────────────────────────────────────

const _SLICER_DEFINITIONS = [
  {
    id: 'OrcaSlicer',
    badge: 'Community',
    badgeType: 'community',
    color: '#5c67f2',
    description: 'Feature-rich multi-brand slicer forked from Bambu Studio. The most popular choice for Bambu and Klipper users.',
    pros: ['Supports all major printer brands', 'Active development, frequent releases', 'Strong community & plugin ecosystem'],
  },
  {
    id: 'Bambu Studio',
    badge: 'Official · Bambu',
    badgeType: 'official',
    color: '#1ba94c',
    description: 'Bambu Lab\'s own slicer. Best-in-class AMS colour management and first to receive Bambu-specific features.',
    pros: ['Native AMS management', 'First to get Bambu-specific features', 'Official support & documentation'],
  },
  {
    id: 'PrusaSlicer',
    badge: 'Official · Prusa',
    badgeType: 'official',
    color: '#fa6831',
    description: 'Prusa Research\'s slicer. Industry standard for reliability, documentation, and broad compatibility.',
    pros: ['Excellent documentation', 'Broad printer compatibility', 'Stable, well-tested releases'],
  },
  {
    id: 'SuperSlicer',
    badge: 'Community',
    badgeType: 'community',
    color: '#2196f3',
    description: 'PrusaSlicer fork with extended calibration tools and finer-grained control over print parameters.',
    pros: ['Extended calibration features', 'More granular settings', 'PrusaSlicer-compatible profiles'],
  },
];

function _slicerCategoryHtml() {
  const selected = _serverSettings.preferred_slicer ?? '';
  const detected = _serverSettings.slicer_detected_version ?? '';

  const cards = _SLICER_DEFINITIONS.map(s => {
    const isSelected = s.id === selected;
    const pros = s.pros.map(p => `<li>${p}</li>`).join('');

    // Show detected version on whichever card matches the detected slicer name
    const detectedMatch = detected && detected.toLowerCase().startsWith(s.id.toLowerCase());
    const versionTag = detectedMatch
      ? `<div class="slicer-detected">detected ${detected.replace(s.id, '').trim() || detected}</div>`
      : '';

    return `
      <button class="slicer-card${isSelected ? ' slicer-card-selected' : ''}" data-slicer-id="${s.id}" style="border-top: 3px solid ${s.color}">
        <div class="slicer-card-header">
          <span class="slicer-card-name" style="color:${s.color}">${s.id}</span>
          <span class="slicer-badge slicer-badge-${s.badgeType}">${s.badge}</span>
        </div>
        <p class="slicer-card-desc">${s.description}</p>
        <ul class="slicer-card-pros">${pros}</ul>
        ${versionTag}
      </button>`;
  }).join('');

  return `
    <div class="settings-section">
      <div class="settings-section-title">Preferred Slicer</div>
      <p class="slicer-hint">Select your slicer to record your preference. Flightdeck auto-detects the version from jobs submitted via the relay.</p>
      <div class="slicer-grid">${cards}</div>
    </div>`;
}

function _attachSlicerEvents(el) {
  el.querySelectorAll('.slicer-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.slicerId;
      _serverSettings.preferred_slicer = id;
      fetch('/api/settings/preferred_slicer', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: id }),
      }).catch(() => {});
      el.querySelectorAll('.slicer-card').forEach(c =>
        c.classList.toggle('slicer-card-selected', c === card)
      );
    });
  });
}

// ── Filament category ─────────────────────────────────────────────────────

const _DEFAULT_MATERIALS = ['PLA', 'PETG', 'ABS', 'ASA', 'TPU'];

function _fmtGrams(g) {
  if (g == null || g === 0) return '—';
  if (g >= 1000) return `${(g / 1000).toFixed(2)}kg`;
  return `${Math.round(g)}g`;
}

function _filamentCategoryHtml(summary, costs) {
  const totalG    = summary.total_grams  || 0;
  const totalCost = summary.total_cost   ?? null;
  const byMat     = summary.by_material  || [];
  const byMonth   = (summary.by_month    || []).slice(0, 6);

  const statsHtml = totalG > 0
    ? `<div class="filament-totals">
        <div class="filament-total-item">
          <span class="filament-total-value">${_fmtGrams(totalG)}</span>
          <span class="filament-total-label">total used</span>
        </div>
        ${totalCost != null ? `<div class="filament-total-item">
          <span class="filament-total-value">$${totalCost.toFixed(2)}</span>
          <span class="filament-total-label">est. cost</span>
        </div>` : ''}
      </div>`
    : `<p class="filament-empty">No filament data yet — accumulates from completed prints.</p>`;

  const matHtml = byMat.length > 0
    ? `<table class="filament-table">
        <thead><tr><th>Material</th><th>Used</th><th>Est. cost</th></tr></thead>
        <tbody>${byMat.map(m => `
          <tr>
            <td>${m.material}</td>
            <td>${_fmtGrams(m.grams)}</td>
            <td>${m.cost != null ? '$' + m.cost.toFixed(2) : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '';

  const monthHtml = byMonth.length > 0
    ? `<div class="filament-months">${byMonth.map(m => {
        const pct = totalG > 0 ? Math.round((m.grams / totalG) * 100) : 0;
        const [y, mo] = m.month.split('-');
        const lbl = new Date(+y, +mo - 1).toLocaleString('default', { month: 'short', year: '2-digit' });
        return `<div class="filament-month-row">
          <span class="filament-month-label">${lbl}</span>
          <div class="filament-month-bar-bg"><div class="filament-month-bar" style="width:${Math.max(pct,2)}%"></div></div>
          <span class="filament-month-val">${_fmtGrams(m.grams)}</span>
        </div>`;
      }).join('')}</div>` : '';

  // costs is a list [{material, brand, cost_per_gram, comment, empty_spool_weight_g}]
  // normalise old dict format in case service hasn't restarted yet
  const costsList = Array.isArray(costs)
    ? costs
    : Object.entries(costs).map(([material, v]) => ({
        material, brand: v.brand || '', cost_per_gram: v.cost_per_gram, comment: v.comment,
        empty_spool_weight_g: v.empty_spool_weight_g,
      }));

  const grouped = {};
  for (const e of costsList) {
    if (!grouped[e.material]) grouped[e.material] = [];
    grouped[e.material].push(e);
  }
  // ensure default materials always appear
  for (const mat of _DEFAULT_MATERIALS) {
    if (!grouped[mat]) grouped[mat] = [];
  }
  const allMats = [...new Set([..._DEFAULT_MATERIALS, ...Object.keys(grouped)])];

  const _esc = s => (s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  const costCards = allMats.map(mat => {
    const brands = grouped[mat] || [];
    const isDefault = _DEFAULT_MATERIALS.includes(mat);
    const brandRows = brands.map(e => `
      <tr class="cost-brand-row" data-material="${_esc(mat)}" data-brand="${_esc(e.brand)}">
        <td class="cost-brand-cell">${e.brand || '<span class="cost-brand-empty">—</span>'}</td>
        <td class="cost-cpg-cell">$${e.cost_per_gram.toFixed(3)}/g</td>
        <td class="cost-tare-cell">${e.empty_spool_weight_g != null ? Math.round(e.empty_spool_weight_g) + 'g' : '—'}</td>
        <td class="cost-comment-cell">${e.comment || ''}</td>
        <td class="cost-brand-actions">
          <button class="cost-brand-edit-btn" title="Edit">✎</button>
          <button class="cost-brand-del-btn" title="Remove">×</button>
        </td>
      </tr>`).join('');

    return `<div class="cost-card" data-material="${_esc(mat)}">
      <div class="cost-card-header">
        <span class="cost-card-name">${mat}</span>
        ${!isDefault ? `<button class="cost-mat-del-btn" data-material="${_esc(mat)}" title="Remove material">×</button>` : ''}
      </div>
      <table class="cost-brand-table">
        <tbody class="cost-brand-tbody">${brandRows}</tbody>
        <tr class="cost-add-brand-row">
          <td><input class="cost-new-brand" type="text" placeholder="Brand *" data-material="${_esc(mat)}"></td>
          <td><input class="cost-new-cpg" type="number" min="0" step="0.001" placeholder="$/g *" data-material="${_esc(mat)}"></td>
          <td><input class="cost-new-tare" type="number" min="0" step="1" placeholder="Tare g" data-material="${_esc(mat)}"></td>
          <td><input class="cost-new-comment" type="text" placeholder="Notes" data-material="${_esc(mat)}"></td>
          <td><button class="cost-add-brand-btn" data-material="${_esc(mat)}">Add</button></td>
        </tr>
      </table>
    </div>`;
  }).join('');

  return `
    <div class="settings-section">
      <div class="settings-section-title">Usage</div>
      ${statsHtml}${matHtml}${monthHtml}
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Filament catalogue</div>
      <p class="filament-empty">Each material can have multiple brands with individual costs. Est. cost uses the average $/g across brands.</p>
      <div class="cost-card-grid">${costCards}</div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Add material type</div>
      <div class="cost-card cost-add-form">
        <div class="cost-card-fields">
          <div class="cost-field-group">
            <label class="cost-label">Material *</label>
            <input id="new-mat-name" type="text" class="cost-brand-input" placeholder="e.g. ASA+PC">
          </div>
          <div class="cost-field-group">
            <label class="cost-label">Brand *</label>
            <input id="new-mat-brand" type="text" class="cost-brand-input" placeholder="e.g. eSUN">
          </div>
          <div class="cost-field-group cost-field-narrow">
            <label class="cost-label">$/g *</label>
            <input id="new-mat-cost" type="number" class="cost-input" min="0" step="0.001" placeholder="0.000">
          </div>
          <div class="cost-field-group cost-field-narrow">
            <label class="cost-label">Tare g</label>
            <input id="new-mat-tare" type="number" class="cost-input" min="0" step="1" placeholder="0">
          </div>
        </div>
        <div class="cost-field-group">
          <label class="cost-label">Notes</label>
          <input id="new-mat-comment" type="text" class="cost-comment-input" placeholder="e.g. Requires enclosure, high temp">
        </div>
        <button class="cost-add-btn">Add</button>
      </div>
    </div>`;
}

function _attachFilamentEvents(el) {
  async function _putBrand(mat, brand, cpg, comment, emptySpoolWeightG = null) {
    const r = await fetch(
      `/api/filament/costs/${encodeURIComponent(mat)}/${encodeURIComponent(brand)}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cost_per_gram: cpg,
          comment: comment || null,
          empty_spool_weight_g: emptySpoolWeightG,
        }) }
    );
    if (!r.ok) throw new Error();
  }

  async function _deleteBrand(mat, brand) {
    const r = await fetch(
      `/api/filament/costs/${encodeURIComponent(mat)}/${encodeURIComponent(brand)}`,
      { method: 'DELETE' }
    );
    if (!r.ok) throw new Error();
  }

  // Add brand to an existing material card
  el.querySelectorAll('.cost-add-brand-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mat     = btn.dataset.material;
      const row     = btn.closest('.cost-add-brand-row');
      const brandEl = row.querySelector('.cost-new-brand');
      const cpgEl   = row.querySelector('.cost-new-cpg');
      const tareEl  = row.querySelector('.cost-new-tare');
      const noteEl  = row.querySelector('.cost-new-comment');
      const brand   = brandEl.value.trim();
      const cpg     = parseFloat(cpgEl.value);
      const tare    = tareEl.value.trim() === '' ? null : parseFloat(tareEl.value);
      if (!brand) { brandEl.focus(); return; }
      if (isNaN(cpg) || cpg < 0) { cpgEl.focus(); return; }
      if (tare !== null && (isNaN(tare) || tare < 0)) { tareEl.focus(); return; }
      btn.disabled = true; btn.textContent = '…';
      try {
        await _putBrand(mat, brand, cpg, noteEl.value.trim(), tare);
        brandEl.value = ''; cpgEl.value = ''; tareEl.value = ''; noteEl.value = '';
        btn.textContent = 'Add'; btn.disabled = false;
        _renderSettingsContent('filament');
      } catch {
        btn.textContent = 'Error';
        setTimeout(() => { btn.textContent = 'Add'; btn.disabled = false; }, 2000);
      }
    });
  });

  // Edit brand inline (replace row with edit form)
  el.querySelectorAll('.cost-brand-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tr    = btn.closest('.cost-brand-row');
      const mat   = tr.dataset.material;
      const brand = tr.dataset.brand;
      const cpgText = tr.querySelector('.cost-cpg-cell').textContent.replace(/[^0-9.]/g, '');
      const tareText = tr.querySelector('.cost-tare-cell').textContent.replace(/[^0-9.]/g, '');
      const note    = tr.querySelector('.cost-comment-cell').textContent;
      tr.innerHTML = `
        <td><input class="cost-new-brand" type="text" value="${brand}" readonly style="color:var(--muted)"></td>
        <td><input class="cost-new-cpg" type="number" min="0" step="0.001" value="${cpgText}"></td>
        <td><input class="cost-new-tare" type="number" min="0" step="1" value="${tareText}"></td>
        <td><input class="cost-new-comment" type="text" value="${note}"></td>
        <td style="display:flex;gap:0.25rem">
          <button class="cost-add-brand-btn cost-edit-save-btn">Save</button>
          <button class="cost-edit-cancel-btn modal-btn" style="min-height:unset;padding:0.2rem 0.5rem;font-size:0.75rem">✕</button>
        </td>`;
      tr.querySelector('.cost-edit-cancel-btn').addEventListener('click', () =>
        _renderSettingsContent('filament')
      );
      tr.querySelector('.cost-edit-save-btn').addEventListener('click', async () => {
        const cpg  = parseFloat(tr.querySelector('.cost-new-cpg').value);
        const tareEl = tr.querySelector('.cost-new-tare');
        const tare = tareEl.value.trim() === '' ? null : parseFloat(tareEl.value);
        const note = tr.querySelector('.cost-new-comment').value.trim();
        if (isNaN(cpg) || cpg < 0) return;
        if (tare !== null && (isNaN(tare) || tare < 0)) return;
        try {
          await _putBrand(mat, brand, cpg, note, tare);
          _renderSettingsContent('filament');
        } catch {}
      });
    });
  });

  // Delete a single brand row
  el.querySelectorAll('.cost-brand-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tr    = btn.closest('.cost-brand-row');
      const mat   = tr.dataset.material;
      const brand = tr.dataset.brand;
      if (!confirm(`Remove ${brand || '(unbranded)'} ${mat}?`)) return;
      btn.disabled = true;
      try {
        await _deleteBrand(mat, brand);
        tr.remove();
      } catch { btn.disabled = false; }
    });
  });

  // Delete entire non-default material (all brands)
  el.querySelectorAll('.cost-mat-del-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mat = btn.dataset.material;
      if (!confirm(`Remove all "${mat}" entries from your catalogue?`)) return;
      btn.disabled = true;
      const card = btn.closest('.cost-card');
      const rows = card.querySelectorAll('.cost-brand-row');
      try {
        await Promise.all([...rows].map(tr => _deleteBrand(tr.dataset.material, tr.dataset.brand)));
        card.remove();
      } catch { btn.disabled = false; }
    });
  });

  // Add entirely new material type
  const addBtn = el.querySelector('.cost-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', async () => {
      const nameEl    = el.querySelector('#new-mat-name');
      const brandEl   = el.querySelector('#new-mat-brand');
      const costEl    = el.querySelector('#new-mat-cost');
      const tareEl    = el.querySelector('#new-mat-tare');
      const commentEl = el.querySelector('#new-mat-comment');
      const mat   = nameEl.value.trim().toUpperCase();
      const brand = brandEl.value.trim();
      const cpg   = parseFloat(costEl.value);
      const tare  = tareEl.value.trim() === '' ? null : parseFloat(tareEl.value);
      if (!mat)   { nameEl.focus();  return; }
      if (!brand) { brandEl.focus(); return; }
      if (isNaN(cpg) || cpg < 0) { costEl.focus(); return; }
      if (tare !== null && (isNaN(tare) || tare < 0)) { tareEl.focus(); return; }
      addBtn.disabled = true; addBtn.textContent = '…';
      try {
        await _putBrand(mat, brand, cpg, commentEl.value.trim(), tare);
        nameEl.value = ''; brandEl.value = ''; costEl.value = ''; tareEl.value = ''; commentEl.value = '';
        addBtn.textContent = 'Add'; addBtn.disabled = false;
        _renderSettingsContent('filament');
      } catch {
        addBtn.textContent = 'Error';
        setTimeout(() => { addBtn.textContent = 'Add'; addBtn.disabled = false; }, 2000);
      }
    });
  }
}

const _ACCENT_COLORS = [
  { label: 'Blue',   value: '#3b82f6' },
  { label: 'Purple', value: '#8b5cf6' },
  { label: 'Teal',   value: '#14b8a6' },
  { label: 'Green',  value: '#22c55e' },
  { label: 'Orange', value: '#f59e0b' },
  { label: 'Pink',   value: '#ec4899' },
];

function _settingToggle(key, options, current) {
  return options.map(({ value, label }) =>
    `<button class="setting-toggle-btn${current === value ? ' setting-toggle-active' : ''}"
       data-setting-key="${key}" data-setting-value="${value}">${label}</button>`
  ).join('');
}

function _appearanceCategoryHtml() {
  const accent = (_serverSettings.accent ?? '#3b82f6').trim();
  const swatches = _ACCENT_COLORS.map(c =>
    `<button class="accent-swatch${c.value === accent ? ' accent-swatch-active' : ''}"
      style="background:${c.value}" data-accent="${c.value}" title="${c.label}"></button>`
  ).join('');

  const tempUnit = _serverSettings.temp_unit ?? 'C';
  const timeFormat = _serverSettings.time_format ?? '24h';

  return `
    <div class="settings-section">
      <div class="settings-section-title">Accent Color</div>
      <div class="settings-form-row">
        <label class="settings-label">Theme colour</label>
        <div class="accent-swatches">${swatches}</div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Units &amp; Format</div>
      <div class="settings-form-row">
        <label class="settings-label">Temperature</label>
        <div class="setting-toggle-group">
          ${_settingToggle('temp_unit', [{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }], tempUnit)}
        </div>
      </div>
      <div class="settings-form-row">
        <label class="settings-label">Time format</label>
        <div class="setting-toggle-group">
          ${_settingToggle('time_format', [{ value: '24h', label: '24h' }, { value: '12h', label: '12h' }], timeFormat)}
        </div>
      </div>
    </div>`;
}

function _attachAppearanceEvents(el) {
  el.querySelectorAll('.accent-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.accent;
      document.documentElement.style.setProperty('--printing', color);
      _serverSettings.accent = color;
      fetch('/api/settings/accent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: color }),
      }).catch(() => {});
      el.querySelectorAll('.accent-swatch').forEach(s =>
        s.classList.toggle('accent-swatch-active', s === swatch)
      );
    });
  });

  el.querySelectorAll('.setting-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { settingKey: key, settingValue: value } = btn.dataset;
      _serverSettings[key] = value;
      fetch(`/api/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      }).catch(() => {});
      el.querySelectorAll(`.setting-toggle-btn[data-setting-key="${key}"]`).forEach(b =>
        b.classList.toggle('setting-toggle-active', b === btn)
      );
    });
  });
}

function _hardwareStatusPill(ok, text) {
  return `<span class="hardware-pill ${ok ? 'hardware-ok' : 'hardware-warn'}">${text}</span>`;
}

function _scaleFriendlyMessage(message) {
  const text = message || 'Scale read failed';
  if (/not detected|not found|unavailable|stabilis/i.test(text)) {
    return `${text}. Wake the scale and retry.`;
  }
  return text;
}

function _hardwareCategoryHtml(scale, labelPrinter) {
  const scaleOk = !!scale?.available;
  const labelOk = !!labelPrinter?.available;
  const autoPrint = (_serverSettings.label_auto_print ?? 'false') === 'true';
  return `
    <div class="settings-section">
      <div class="settings-section-title">Scale</div>
      <div class="hardware-card">
        <div class="hardware-card-main">
          <div>
            <div class="hardware-title">Dymo M10 USB scale</div>
            <div class="hardware-sub">${scaleOk ? 'Ready for spool weighing' : (scale?.last_error || 'Not detected')}</div>
          </div>
          ${_hardwareStatusPill(scaleOk, scaleOk ? 'Ready' : 'Unavailable')}
        </div>
        <div class="hardware-actions">
          <button class="modal-btn" id="scale-read-btn">Read Scale</button>
          <span class="hardware-reading" id="scale-reading">--</span>
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Label Printer</div>
      <div class="hardware-card">
        <div class="hardware-card-main">
          <div>
            <div class="hardware-title">Brother QL-700</div>
            <div class="hardware-sub">${labelOk ? `Ready for ${labelPrinter.label_size || 'DK-22212'} labels` : (labelPrinter?.last_error || 'Not detected')}</div>
          </div>
          ${_hardwareStatusPill(labelOk, labelOk ? 'Ready' : 'Unavailable')}
        </div>
        <div class="settings-form-row hardware-toggle-row">
          <label class="settings-label">Auto print</label>
          <div class="setting-toggle-group">
            ${_settingToggle('label_auto_print', [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }], autoPrint ? 'true' : 'false')}
          </div>
        </div>
        <div class="hardware-actions">
          <button class="modal-btn" id="label-test-btn">Print Test</button>
          <span class="hardware-reading" id="label-test-result">--</span>
        </div>
      </div>
    </div>`;
}

function _attachHardwareEvents(el) {
  el.querySelector('#scale-read-btn')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const out = el.querySelector('#scale-reading');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Reading...';
    out.textContent = '--';
    try {
      const r = await fetch('/api/scale/read');
      if (!r.ok) throw new Error((await r.json()).detail || 'Scale read failed');
      const reading = await r.json();
      out.textContent = `${Math.round(reading.grams)}g`;
    } catch (err) {
      out.textContent = _scaleFriendlyMessage(err.message || 'Unavailable');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });

  el.querySelector('#label-test-btn')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    const out = el.querySelector('#label-test-result');
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Printing...';
    out.textContent = '--';
    try {
      const r = await fetch('/api/label_printer/test', { method: 'POST' });
      if (!r.ok) throw new Error((await r.json()).detail || 'Print failed');
      out.textContent = 'Sent';
    } catch (err) {
      out.textContent = err.message || 'Unavailable';
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  });

  el.querySelectorAll('.setting-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const { settingKey: key, settingValue: value } = btn.dataset;
      _serverSettings[key] = value;
      fetch(`/api/settings/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      }).catch(() => {});
      el.querySelectorAll(`.setting-toggle-btn[data-setting-key="${key}"]`).forEach(b =>
        b.classList.toggle('setting-toggle-active', b === btn)
      );
    });
  });
}

// ── Settings layout ────────────────────────────────────────────────────────

// ── Spool state ───────────────────────────────────────────────────────────
let _allSpools = [];
let _spoolsViewMode = 'cards';
let _spoolsSortKey = 'material';
let _spoolsSortDir = 1;
let _spoolsFilter = { search: '', status: 'active', slotFilter: 'all', material: '', brand: '' };
let _spoolLocations = [];
let _latestSpoolsByPrinter = {};   // printer_id → [spool, ...]
let _latestLowStockPct = 20;
const _SPOOL_ACTIONS = [
  { key: 'detail', label: 'Info', title: 'Details', kind: 'link', cls: 'spool-action-detail' },
  { key: 'label', label: 'Label', title: 'Print label', cls: 'spool-action-label' },
  { key: 'weigh', label: 'Weigh', title: 'Weigh from scale', cls: 'spool-action-weigh' },
  { key: 'edit', label: 'Edit', title: 'Edit', cls: 'spool-action-edit' },
  { key: 'duplicate', label: 'Copy', title: 'Duplicate', cls: 'spool-action-utility' },
  { key: 'reset', label: 'Reset', title: 'Reset weight', cls: 'spool-action-utility' },
  { key: 'archive', label: 'Arch', title: 'Archive', cls: 'spool-action-utility' },
  { key: 'delete', label: 'Del', title: 'Delete', cls: 'spool-action-utility spool-action-danger' },
];

async function _refreshSpoolsByPrinter() {
  try {
    const spools = await fetch('/api/spools').then(r => r.json()).catch(() => []);
    const summary = await fetch('/api/spools/summary').then(r => r.json()).catch(() => ({}));
    _latestLowStockPct = summary.low_stock_pct ?? 20;
    const byPrinter = {};
    for (const s of spools) {
      if (s.location_printer_id) {
        if (!byPrinter[s.location_printer_id]) byPrinter[s.location_printer_id] = [];
        byPrinter[s.location_printer_id].push(s);
      }
    }
    _latestSpoolsByPrinter = byPrinter;
  } catch {}
}

function _normMat(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9+]/g, '');
}

function _normHex(value) {
  const h = String(value || '').trim().replace(/^#/, '');
  return /^[0-9A-Fa-f]{6}$/.test(h) ? `#${h.toUpperCase()}` : '';
}

function _hexDistance(a, b) {
  const ha = _normHex(a), hb = _normHex(b);
  if (!ha || !hb) return 0;
  const pa = [1, 3, 5].map(i => parseInt(ha.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map(i => parseInt(hb.slice(i, i + 2), 16));
  return Math.sqrt(pa.reduce((sum, v, i) => sum + Math.pow(v - pb[i], 2), 0));
}

function _slotReportedMaterial(report) {
  return report?.type || report?.material || report?.filament_type || report?.filament_name || '';
}

function _slotMismatch(spool, report) {
  const printerLoaded = report && !report.empty;
  if (!spool && printerLoaded) return 'Printer reports filament but no Flightdeck spool is assigned';
  if (spool && report?.empty) return `Flightdeck has spool #${spool.id} assigned but printer reports empty`;
  if (!spool || !printerLoaded) return '';

  const reportedMat = _normMat(_slotReportedMaterial(report));
  const spoolMat = _normMat(`${spool.material || ''}${spool.subtype ? ' ' + spool.subtype : ''}`);
  if (reportedMat && spoolMat && !spoolMat.includes(reportedMat) && !reportedMat.includes(spoolMat)) {
    return `Material mismatch: printer ${_slotReportedMaterial(report)}, Flightdeck ${spool.material}${spool.subtype ? ' ' + spool.subtype : ''}`;
  }
  if (_hexDistance(report.color, spool.color_hex) > 95) {
    return `Colour mismatch: printer ${report.color}, Flightdeck ${spool.color_hex}`;
  }
  return '';
}

function _slotReport(printer, slotIndex) {
  if (!printer) return null;
  for (const unit of printer.ams || []) {
    for (const slot of unit.slots || []) {
      if (unit.unit * 4 + slot.idx === Number(slotIndex)) return slot;
    }
  }
  for (const unit of printer.mmu || []) {
    for (const gate of unit.gates || []) {
      if (Number(gate.idx) === Number(slotIndex)) return gate;
    }
  }
  return null;
}

async function _openSlotEditor(printerId, slotIndex, slotLabel) {
  const printer = _latestPrinters.find(p => p.id === printerId);
  const title = `${printer?.custom_name || printerId} · ${slotLabel}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box slot-modal">
      <div class="modal-header">
        <span class="modal-title">${esc(title)}</span>
        <button class="modal-close-btn">✕</button>
      </div>
      <div class="slot-modal-body">
        <div class="detail-placeholder" style="min-height:8rem">Loading...</div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn" data-slot-close>Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const body = overlay.querySelector('.slot-modal-body');
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close-btn').addEventListener('click', close);
  overlay.querySelector('[data-slot-close]').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  async function load() {
    const [spools, locations] = await Promise.all([
      fetch('/api/spools').then(r => r.json()).catch(() => []),
      fetch('/api/spool-locations').then(r => r.json()).catch(() => []),
    ]);
    _allSpools = spools;
    _spoolLocations = locations;
    const current = spools.find(s =>
      s.location_printer_id === printerId && Number(s.location_slot) === Number(slotIndex) && !s.archived_at
    );
    const report = _slotReport(printer, slotIndex);
    const mismatch = _slotMismatch(current, report);
    const reportLine = report
      ? (report.empty ? 'Printer reports empty' : `Printer reports ${[_slotReportedMaterial(report), report.color].filter(Boolean).join(' · ') || 'filament loaded'}`)
      : 'No printer slot report available';
    const candidates = spools
      .filter(s => !s.archived_at && !s.location_printer_id)
      .sort((a, b) =>
        _spoolStorageLocationName(a.storage_location_id).localeCompare(_spoolStorageLocationName(b.storage_location_id)) ||
        (a.material || '').localeCompare(b.material || '') ||
        (a.color_name || '').localeCompare(b.color_name || '')
      );
    const pickerRows = candidates.length ? candidates.map(s => {
      const pct = s.label_weight_g > 0 ? Math.round(s.remaining_g * 100 / s.label_weight_g) : 0;
      const loc = _spoolStorageLocationName(s.storage_location_id);
      const searchable = `${loc} ${s.material || ''} ${s.subtype || ''} ${s.brand || ''} ${s.color_name || ''} ${s.color_hex || ''} #${s.id}`.toLowerCase();
      return `<button type="button" class="slot-spool-option" data-slot-spool-id="${s.id}" data-search="${esc(searchable)}">
        <span class="location-spool-swatch" style="background:${s.color_hex || '#808080'}"></span>
        <span class="slot-spool-option-main">
          <strong>${esc(s.color_name || s.color_hex || 'Colour')} · ${esc(s.material)}${s.subtype ? ` ${esc(s.subtype)}` : ''}</strong>
          <small>${esc(s.brand || 'Unknown brand')} · #${s.id} · ${Math.round(s.remaining_g || 0)}g (${pct}%)</small>
        </span>
        <span class="slot-spool-location">${esc(loc)}</span>
      </button>`;
    }).join('') : '<div class="slot-empty-state">No stored spools available.</div>';
    const locationOptions = _spoolLocations.length
      ? _spoolLocations.map(loc => `<option value="${loc.id}">${esc(loc.name)}</option>`).join('')
      : '<option value="">Unassigned</option>';
    body.innerHTML = `
      <div class="slot-current">
        <div class="slot-current-label">Current assignment</div>
        <div class="slot-printer-report">${esc(reportLine)}</div>
        ${mismatch ? `<div class="slot-warning">${esc(mismatch)}</div>` : ''}
        ${current ? `
          <div class="slot-current-card">
            <span class="location-spool-swatch" style="background:${current.color_hex || '#808080'}"></span>
            <div class="location-spool-main">
              <div class="location-spool-title">${esc(current.color_name || current.color_hex || 'Colour')} · ${esc(current.material)}${current.subtype ? ` ${esc(current.subtype)}` : ''}</div>
              <div class="location-spool-sub">${esc(current.brand || 'Unknown brand')} · #${current.id} · ${Math.round(current.remaining_g || 0)}g</div>
            </div>
          </div>
          <div class="slot-actions">
            <a class="spool-action-btn spool-action-detail" href="#/spool/${current.id}">Details</a>
            <button class="spool-action-btn spool-action-label" data-slot-label-print="${current.id}">Label</button>
            <button class="spool-action-btn spool-action-weigh" data-slot-weigh="${current.id}">Weigh</button>
            <select class="slot-clear-location" data-slot-clear-location>${locationOptions}</select>
            <button class="spool-action-btn spool-action-danger" data-slot-clear="${current.id}">Clear to storage</button>
          </div>` : `<div class="slot-empty-state">No Flightdeck spool assigned to this slot.</div>`}
      </div>
      <div class="slot-assign">
        <label class="spool-form-label" for="slot-spool-filter">Assign stored spool</label>
        <input id="slot-spool-filter" class="spool-form-input" type="search" placeholder="Filter by location, material, brand, colour..."${candidates.length ? '' : ' disabled'}>
        <div class="slot-spool-picker">${pickerRows}</div>
      </div>`;

    body.querySelectorAll('[data-slot-spool-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.slotSpoolId;
      btn.disabled = true;
      btn.classList.add('assigning');
      const r = await fetch(`/api/spools/${id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printer_id: printerId, slot: Number(slotIndex) }),
      });
      if (!r.ok) {
        btn.classList.remove('assigning');
        btn.classList.add('slot-spool-error');
        setTimeout(load, 1200);
        return;
      }
      await _refreshSpoolsByPrinter();
      load();
      });
    });

    body.querySelector('#slot-spool-filter')?.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      body.querySelectorAll('[data-slot-spool-id]').forEach(row => {
        row.classList.toggle('hidden', q && !row.dataset.search.includes(q));
      });
    });

    body.querySelector('[data-slot-clear]')?.addEventListener('click', async e => {
      const id = e.currentTarget.dataset.slotClear;
      const rawStorageId = body.querySelector('[data-slot-clear-location]')?.value || '';
      const storageId = rawStorageId ? Number(rawStorageId) : null;
      await fetch(`/api/spools/${id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printer_id: null, slot: null, storage_location_id: storageId }),
      });
      await _refreshSpoolsByPrinter();
      load();
    });

    body.querySelector('[data-slot-label-print]')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = '...';
      try {
        const r = await fetch(`/api/label_printer/print/${btn.dataset.slotLabelPrint}`, { method: 'POST' });
        if (!r.ok) throw new Error((await r.json()).detail || 'Print failed');
        btn.textContent = 'Done';
      } catch (err) {
        alert(err.message || 'Label print failed');
        btn.textContent = old;
      } finally {
        setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 1400);
      }
    });

    body.querySelector('[data-slot-weigh]')?.addEventListener('click', async e => {
      const id = e.currentTarget.dataset.slotWeigh;
      const spool = _allSpools.find(s => String(s.id) === String(id));
      const emptyText = prompt('Empty spool weight in grams (leave blank for 0)', spool?.empty_spool_weight_g ?? '');
      if (emptyText === null) return;
      const empty = emptyText.trim() === '' ? null : parseFloat(emptyText);
      if (emptyText.trim() !== '' && (isNaN(empty) || empty < 0)) return;
      await fetch(`/api/spools/${id}/correct_weight`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empty_spool_weight_g: empty }),
      });
      await _refreshSpoolsByPrinter();
      load();
    });
  }

  load().catch(() => {
    body.innerHTML = '<div class="detail-placeholder">Unable to load slot editor.</div>';
  });
}

// ── AMS slot label helper ─────────────────────────────────────────────────
// Given a printer object and a flat slot index (unit_id*4 + tray_id), return
// a human-readable label like "AMS 1 · S2" or "AMS HT".
function _amsSlotLabel(printer, slotIndex) {
  if (!printer?.ams?.length) return `S${slotIndex + 1}`;
  for (const unit of printer.ams) {
    for (const slot of unit.slots) {
      if (unit.unit * 4 + slot.idx === slotIndex) {
        return unit.slots.length === 1
          ? unit.label
          : `${unit.label} · S${slot.idx + 1}`;
      }
    }
  }
  return `S${slotIndex}`;
}

// ── Spool luminance helper ────────────────────────────────────────────────
function _spoolTextColor(hex) {
  const h = hex.replace('#', '');
  if (h.length < 6) return '#ffffff';
  const r = parseInt(h.slice(0,2), 16) / 255;
  const g = parseInt(h.slice(2,4), 16) / 255;
  const b = parseInt(h.slice(4,6), 16) / 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 0.55 ? '#1a1a1a' : '#ffffff';
}

function _spoolProgressColor(pct) {
  if (pct >= 50) return 'var(--printing)';
  if (pct >= 20) return '#f59e0b';
  return 'var(--error)';
}

const _SWATCH_COLORS = [
  '#1a1a1a','#ffffff','#c0c0c0','#808080',
  '#ef4444','#f97316','#eab308','#22c55e',
  '#06b6d4','#3b82f6','#a855f7','#ec4899',
];

function _spoolActionControl(action, spoolId, compact = false) {
  const label = compact && action.key === 'archive' ? 'Archive' : compact && action.key === 'delete' ? 'Delete' : action.label;
  const cls = `spool-action-btn ${action.cls}`;
  if (action.kind === 'link') {
    return `<a class="${cls}" href="#/spool/${spoolId}" title="${action.title}">${label}</a>`;
  }
  return `<button class="${cls}" data-action="${action.key}" data-id="${spoolId}" title="${action.title}">${label}</button>`;
}

function _spoolCardActionsHtml(spoolId) {
  const quick = _SPOOL_ACTIONS
    .filter(a => a.key === 'label' || a.key === 'edit')
    .map(a => _spoolActionControl(a, spoolId)).join('');
  const menu = _SPOOL_ACTIONS.map(a => _spoolActionControl(a, spoolId, true)).join('');
  return `<div class="spool-card-actions">
    ${quick}
    <details class="spool-action-menu">
      <summary class="spool-action-btn spool-action-more" title="More actions">Actions</summary>
      <div class="spool-action-menu-panel">${menu}</div>
    </details>
  </div>`;
}

function _spoolCardHtml(s) {
  const pct = s.label_weight_g > 0 ? Math.round(s.remaining_g * 100 / s.label_weight_g) : 0;
  const barColor = _spoolProgressColor(pct);
  const bandColor = s.color_hex || '#404040';
  const textColor = _spoolTextColor(bandColor);
  const used = Math.max(0, s.label_weight_g - s.remaining_g);
  const p = _latestPrinters.find(x => x.id === s.location_printer_id);
  const locBadge = s.location_printer_id
    ? `<span class="spool-location-badge" title="${(p?.custom_name ?? s.location_printer_id)} ${_amsSlotLabel(p, s.location_slot)}">${p?.custom_name ?? s.location_printer_id}</span>`
    : `<span class="spool-location-badge spool-location-storage" title="${esc(_spoolStorageLocationName(s.storage_location_id))}">${esc(_spoolStorageLocationName(s.storage_location_id))}</span>`;
  return `<div class="spool-card" data-spool-id="${s.id}">
    <div class="spool-card-band" style="background:${bandColor};color:${textColor}">
      <span class="spool-color-name">${s.color_name || '—'}</span>
      <span class="spool-id-badge">#${s.id}</span>
    </div>
    <div class="spool-card-body">
      <div class="spool-card-row">
        <span class="spool-material">${s.material}${s.subtype ? ' ' + s.subtype : ''}</span>
        ${locBadge}
      </div>
      <div class="spool-card-row spool-brand">${s.brand}</div>
      <div class="spool-remaining-row">
        <span class="spool-remaining-label">Remaining</span>
        <span class="spool-remaining-pct${pct < 20 ? ' spool-low' : pct < 50 ? ' spool-amber' : ''}">${pct}%</span>
        <span class="spool-remaining-g">${Math.round(s.remaining_g)}g</span>
      </div>
      <div class="spool-progress-bar">
        <div class="spool-progress-fill" style="width:${pct}%;background:${barColor}"></div>
      </div>
      <div class="spool-meta-row"><span class="spool-meta">${Math.round(s.label_weight_g)}g label</span><span class="spool-meta">${Math.round(used)}g used</span></div>
      ${_spoolCardActionsHtml(s.id)}
    </div>
  </div>`;
}

function _spoolTableHtml(spools) {
  const th = (key, label) => {
    const active = _spoolsSortKey === key;
    const arrow = active ? (_spoolsSortDir === 1 ? ' ↑' : ' ↓') : '';
    return `<th class="spool-th${active ? ' spool-th-active' : ''}" data-sort="${key}">${label}${arrow}</th>`;
  };
  const rows = spools.map(s => {
    const pct = s.label_weight_g > 0 ? Math.round(s.remaining_g * 100 / s.label_weight_g) : 0;
    const pctCls = pct < 20 ? ' spool-low' : pct < 50 ? ' spool-amber' : '';
    const added = s.added_at ? s.added_at.slice(0, 10).split('-').reverse().join('/') : '—';
    const p = _latestPrinters.find(x => x.id === s.location_printer_id);
    const loc = s.location_printer_id
      ? `${p?.custom_name ?? s.location_printer_id} ${_amsSlotLabel(p, s.location_slot)}`
      : _spoolStorageLocationName(s.storage_location_id);
    return `<tr class="spool-tr" data-spool-id="${s.id}">
      <td class="spool-td">#${s.id}</td>
      <td class="spool-td">${added}</td>
      <td class="spool-td"><span class="spool-table-swatch" style="background:${s.color_hex || '#404040'}"></span></td>
      <td class="spool-td">${s.material}</td>
      <td class="spool-td spool-td-muted">${s.subtype || '—'}</td>
      <td class="spool-td">${s.brand}</td>
      <td class="spool-td spool-td-muted">${loc}</td>
      <td class="spool-td spool-td-num">${Math.round(s.label_weight_g)}g</td>
      <td class="spool-td spool-td-num"><span class="${pctCls}">${Math.round(s.remaining_g)}g (${pct}%)</span></td>
      <td class="spool-td spool-td-actions">
        <a class="spool-action-btn spool-action-detail" href="#/spool/${s.id}" title="Details">Details</a>
        <button class="spool-action-btn spool-action-label" data-action="label"    data-id="${s.id}" title="Print label">Label</button>
        <button class="spool-action-btn spool-action-weigh" data-action="weigh"    data-id="${s.id}" title="Weigh from scale">Weigh</button>
        <button class="spool-action-btn spool-action-edit" data-action="edit"      data-id="${s.id}" title="Edit">Edit</button>
        <button class="spool-action-btn spool-action-utility" data-action="duplicate" data-id="${s.id}" title="Duplicate">Copy</button>
        <button class="spool-action-btn spool-action-utility" data-action="reset"     data-id="${s.id}" title="Reset">Reset</button>
        <button class="spool-action-btn spool-action-utility" data-action="archive"   data-id="${s.id}" title="Archive">Archive</button>
        <button class="spool-action-btn spool-action-utility spool-action-danger" data-action="delete" data-id="${s.id}" title="Delete">Delete</button>
      </td>
    </tr>`;
  }).join('');
  return `<div class="spool-table-wrap">
    <table class="spool-table">
      <thead><tr>
        ${th('id','#')}${th('added_at','Added')}
        <th class="spool-th">Colour</th>
        ${th('material','Material')}${th('subtype','Subtype')}${th('brand','Brand')}
        ${th('location_printer_id','Location')}${th('label_weight_g','Label')}${th('remaining_g','Remaining')}
        <th class="spool-th">Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function _applySpoolFilters(spools) {
  const f = _spoolsFilter;
  const thresh = _latestLowStockPct;
  return spools.filter(s => {
    if (f.status === 'active'   && s.archived_at)  return false;
    if (f.status === 'archived' && !s.archived_at) return false;
    if (f.slotFilter === 'loaded'  && !s.location_printer_id) return false;
    if (f.slotFilter === 'storage' &&  s.location_printer_id) return false;
    if (f.slotFilter === 'low') {
      const pct = s.label_weight_g > 0 ? s.remaining_g * 100 / s.label_weight_g : 0;
      if (pct >= thresh) return false;
    }
    if (f.material && s.material !== f.material) return false;
    if (f.brand    && s.brand    !== f.brand)    return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!(s.material + s.brand + (s.color_name||'') + (s.notes||'')).toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    const va = a[_spoolsSortKey], vb = b[_spoolsSortKey];
    if (typeof va === 'string') return _spoolsSortDir * (va || '').localeCompare(vb || '');
    return _spoolsSortDir * ((va ?? 0) - (vb ?? 0));
  });
}

function _renderSpoolList(el) {
  const listEl = el.querySelector('#spool-list');
  if (!listEl) return;
  const filtered = _applySpoolFilters(_allSpools);
  if (filtered.length === 0) {
    listEl.className = '';
    listEl.innerHTML = `<p class="filament-empty">No spools match the current filters.</p>`;
    return;
  }
  if (_spoolsViewMode === 'table') {
    listEl.className = '';
    listEl.innerHTML = _spoolTableHtml(filtered);
    listEl.querySelectorAll('.spool-th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        if (_spoolsSortKey === th.dataset.sort) _spoolsSortDir *= -1;
        else { _spoolsSortKey = th.dataset.sort; _spoolsSortDir = 1; }
        _renderSpoolList(el);
      });
    });
  } else {
    listEl.className = 'spool-card-grid';
    listEl.innerHTML = [...filtered].sort((a, b) => Number(a.id || 0) - Number(b.id || 0)).map(_spoolCardHtml).join('');
  }
  _attachSpoolListEvents(el, listEl);
}

function _spoolIntelligenceHtml(intel = {}) {
  const s = intel.summary || {};
  const alerts = intel.alerts || [];
  const recent = intel.recent_usage || [];
  const top = intel.by_spool || [];
  const fmtKg = g => g != null ? `${(Number(g) / 1000).toFixed(2)}kg` : '—';
  const printerName = id => _latestPrinters.find(p => p.id === id)?.custom_name || id || 'Unknown printer';
  const dateLabel = ts => ts ? new Date(ts.endsWith('Z') ? ts : ts + 'Z').toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—';
  return `<section class="spool-intel-panel">
    <div class="spool-intel-head">
      <div>
        <div class="settings-section-title">Spool Intelligence</div>
        <div class="spool-intel-sub">${intel.days || 30} day tracking window</div>
      </div>
      <a class="spool-intel-link" href="#/settings/filament">Filament stats</a>
    </div>
    <div class="spool-intel-stats">
      <div class="spool-intel-stat"><strong>${fmtKg(s.deducted_g)}</strong><span>auto-deducted</span></div>
      <div class="spool-intel-stat"><strong>${s.deducted_prints ?? 0}</strong><span>tracked prints</span></div>
      <div class="spool-intel-stat${(s.unattributed_prints || 0) ? ' spool-intel-warn' : ''}"><strong>${s.unattributed_prints ?? 0}</strong><span>unattributed</span></div>
      <div class="spool-intel-stat${(s.loaded_low || 0) ? ' spool-intel-warn' : ''}"><strong>${s.loaded_low ?? 0}</strong><span>loaded low</span></div>
    </div>
    <div class="spool-intel-body">
      <div class="spool-intel-alerts">
        ${alerts.map(a => `<div class="spool-intel-alert spool-intel-${a.level || 'watch'}">${esc(a.message || '')}</div>`).join('')}
      </div>
      <div class="spool-intel-lists">
        <div>
          <div class="spool-intel-list-title">Recent deductions</div>
          ${recent.length ? recent.slice(0, 5).map(u => `<a class="spool-intel-row" href="#/spool/${u.spool_id}">
            <span><b>#${u.spool_id}</b> ${esc(u.color_name || u.material || 'Spool')}</span>
            <small>${esc(printerName(u.printer_id))} · ${dateLabel(u.ended_at)}</small>
            <strong>${Number(u.grams || 0).toFixed(1)}g</strong>
          </a>`).join('') : `<div class="spool-intel-empty">No spool deductions yet.</div>`}
        </div>
        <div>
          <div class="spool-intel-list-title">Most used spools</div>
          ${top.length ? top.slice(0, 5).map(u => `<a class="spool-intel-row" href="#/spool/${u.spool_id}">
            <span><b>#${u.spool_id}</b> ${esc(u.color_name || u.material || 'Spool')}</span>
            <small>${esc(u.brand || '')}</small>
            <strong>${Number(u.grams || 0).toFixed(1)}g</strong>
          </a>`).join('') : `<div class="spool-intel-empty">Usage will appear after tracked prints finish.</div>`}
        </div>
      </div>
    </div>
  </section>`;
}

function _spoolsCategoryHtml(spools, summary, costs, intelligence = {}) {
  _allSpools = spools;
  _latestLowStockPct = summary.low_stock_pct ?? 20;

  const matStr = (summary.by_material || []).map(m => `${m.material} ${Math.round(m.grams)}g`).join(' · ') || '—';

  // Material/brand dropdowns for filter bar
  const matSet = [...new Set(spools.map(s => s.material))].sort();
  const brandSet = [...new Set(spools.map(s => s.brand))].sort();
  const matOpts = `<option value="">All materials</option>` + matSet.map(m => `<option value="${m}"${_spoolsFilter.material===m?' selected':''}>${m}</option>`).join('');
  const brandOpts = `<option value="">All brands</option>` + brandSet.map(b => `<option value="${b}"${_spoolsFilter.brand===b?' selected':''}>${b}</option>`).join('');

  const fc = (key, val, label) => `<button class="spool-chip${_spoolsFilter[key]===val?' spool-chip-active':''}" data-fkey="${key}" data-fval="${val}">${label}</button>`;

  return `
    <div class="spool-page-header">
      <div class="settings-section-title">Spool Inventory</div>
      <div class="spool-header-actions">
        <div class="spool-view-toggle">
          <button class="spool-view-btn${_spoolsViewMode==='cards'?' active':''}" data-view="cards">Cards</button>
          <button class="spool-view-btn${_spoolsViewMode==='table'?' active':''}" data-view="table">Table</button>
        </div>
        <select class="spool-filter-sel" data-fkey="material">${matOpts}</select>
        <select class="spool-filter-sel" data-fkey="brand">${brandOpts}</select>
        <input class="spool-search" type="search" placeholder="Search…" value="${_spoolsFilter.search}">
        <button class="spool-add-btn">+ Add Spool</button>
      </div>
    </div>
    ${_spoolIntelligenceHtml(intelligence)}
    <div class="spool-summary-strip">
      <div class="spool-stat">
        <span class="spool-stat-value">${summary.total_remaining_g != null ? (summary.total_remaining_g/1000).toFixed(2)+'kg' : '—'}</span>
        <span class="spool-stat-label">inventory</span>
        <span class="spool-stat-sub">${summary.total_count||0} spools</span>
      </div>
      <div class="spool-stat">
        <span class="spool-stat-value">${summary.total_consumed_g != null ? (summary.total_consumed_g/1000).toFixed(2)+'kg' : '—'}</span>
        <span class="spool-stat-label">consumed</span>
      </div>
      <div class="spool-stat spool-stat-wide">
        <span class="spool-stat-value spool-stat-mat">${matStr}</span>
        <span class="spool-stat-label">by material</span>
      </div>
      <div class="spool-stat">
        <span class="spool-stat-value">${summary.in_printer_count||0}</span>
        <span class="spool-stat-label">in printer</span>
      </div>
      <div class="spool-stat${(summary.low_stock_count||0)>0?' spool-stat-warn':''}">
        <span class="spool-stat-value">${summary.low_stock_count||0}</span>
        <span class="spool-stat-label">low stock</span>
        <span class="spool-stat-sub">&lt;${summary.low_stock_pct||20}%</span>
      </div>
    </div>
    <div class="spool-filter-bar">
      <div class="spool-chips">
        ${fc('status','active','Active')}${fc('status','archived','Archived')}
        <span class="spool-chip-sep"></span>
        ${fc('slotFilter','all','All')}${fc('slotFilter','loaded','Loaded')}${fc('slotFilter','storage','Shelved')}${fc('slotFilter','low','Low stock')}
      </div>
    </div>
    <div id="spool-list"></div>`;
}

function _refreshSpoolsSurface() {
  return location.hash === '#/spools' ? renderSpoolsView() : _renderSettingsContent('spools');
}

function _attachSpoolListEvents(el, listEl, refresh = _refreshSpoolsSurface) {
  listEl.querySelectorAll('.spool-action-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      const costs = await fetch('/api/filament/costs').then(r => r.json()).catch(() => []);
      if (action === 'edit') {
        const spool = _allSpools.find(s => s.id == id);
        if (spool) _openSpoolModal(costs, refresh, spool);
      } else if (action === 'label') {
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = '...';
        try {
          const r = await fetch(`/api/label_printer/print/${id}`, { method: 'POST' });
          if (!r.ok) throw new Error((await r.json()).detail || 'Print failed');
          btn.textContent = 'Done';
        } catch (err) {
          alert(err.message || 'Label print failed');
          btn.textContent = old;
        } finally {
          setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 1400);
        }
      } else if (action === 'weigh') {
        const spool = _allSpools.find(s => s.id == id);
        const currentEmpty = spool?.empty_spool_weight_g ?? '';
        const emptyText = prompt('Empty spool weight in grams (leave blank for 0)', currentEmpty);
        if (emptyText === null) return;
        const empty = emptyText.trim() === '' ? null : parseFloat(emptyText);
        if (emptyText.trim() !== '' && (isNaN(empty) || empty < 0)) return;
        btn.disabled = true;
        const old = btn.textContent;
        btn.textContent = '...';
        try {
          const r = await fetch(`/api/spools/${id}/correct_weight`, {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ empty_spool_weight_g: empty }),
          });
          if (!r.ok) throw new Error(_scaleFriendlyMessage((await r.json()).detail || 'Scale read failed'));
          await refresh();
        } catch (err) {
          alert(_scaleFriendlyMessage(err.message || 'Scale read failed'));
          btn.textContent = old;
        } finally {
          btn.disabled = false;
        }
      } else if (action === 'duplicate') {
        const spool = _allSpools.find(s => s.id == id);
        if (spool) _openSpoolModal(costs, refresh, {...spool, id: null, location_printer_id: null, location_slot: null});
      } else if (action === 'archive') {
        if (!confirm('Archive this spool?')) return;
        await fetch(`/api/spools/${id}/archive`, { method: 'POST' });
        refresh();
      } else if (action === 'reset') {
        if (!confirm('Reset remaining weight to label weight?')) return;
        await fetch(`/api/spools/${id}/reset_weight`, { method: 'POST' });
        refresh();
      } else if (action === 'delete') {
        if (!confirm('Permanently delete this spool?')) return;
        await fetch(`/api/spools/${id}`, { method: 'DELETE' });
        refresh();
      }
    });
  });
}

function _attachSpoolsEvents(el, costs) {
  el.querySelector('.spool-add-btn')?.addEventListener('click', () =>
    _openSpoolModal(costs, _refreshSpoolsSurface)
  );

  // Filter chips
  el.querySelectorAll('.spool-chip[data-fkey]').forEach(chip => {
    chip.addEventListener('click', () => {
      _spoolsFilter[chip.dataset.fkey] = chip.dataset.fval;
      el.querySelectorAll(`.spool-chip[data-fkey="${chip.dataset.fkey}"]`).forEach(c =>
        c.classList.toggle('spool-chip-active', c === chip)
      );
      _renderSpoolList(el);
    });
  });

  // Filter selects
  el.querySelectorAll('.spool-filter-sel').forEach(sel => {
    sel.addEventListener('change', () => {
      _spoolsFilter[sel.dataset.fkey] = sel.value;
      _renderSpoolList(el);
    });
  });

  // Search (debounced)
  let _searchTimer;
  el.querySelector('.spool-search')?.addEventListener('input', e => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(() => {
      _spoolsFilter.search = e.target.value.trim();
      _renderSpoolList(el);
    }, 200);
  });

  // View toggle
  el.querySelectorAll('.spool-view-btn[data-view]').forEach(btn => {
    btn.addEventListener('click', async () => {
      _spoolsViewMode = btn.dataset.view;
      el.querySelectorAll('.spool-view-btn').forEach(b => b.classList.toggle('active', b === btn));
      await fetch('/api/settings/spool_view_mode', {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({value: _spoolsViewMode}),
      }).catch(() => {});
      _renderSpoolList(el);
    });
  });

  _renderSpoolList(el);
}

function _openSpoolModal(costs, onSaved, prefill = null) {
  const isEdit = prefill?.id != null;
  const title = isEdit ? 'Edit Spool' : 'Add Spool';
  const submitLabel = isEdit ? 'Save' : 'Add Spool';

  // Build material → brands map
  const matBrands = {};
  const costLookup = {};
  for (const e of (costs || [])) {
    if (!matBrands[e.material]) matBrands[e.material] = [];
    if (e.brand) matBrands[e.material].push(e.brand);
    costLookup[`${e.material}|||${e.brand || ''}`] = e;
  }
  const materials = Object.keys(matBrands).sort();

  const p0 = prefill || {};
  const initHex = p0.color_hex || '#808080';
  const printerOpts = _latestPrinters.map(p =>
    `<option value="${p.id}" data-kind="${p.kind}"${p0.location_printer_id===p.id?' selected':''}>${p.custom_name}</option>`
  ).join('');
  const storageOpts = (_spoolLocations.length ? _spoolLocations : [{ id: '', name: 'Storage' }]).map(loc =>
    `<option value="${loc.id}"${String(p0.storage_location_id ?? '')===String(loc.id)?' selected':''}>${esc(loc.name)}</option>`
  ).join('');

  const matOpts = `<option value="">— select —</option>` + materials.map(m =>
    `<option value="${m}"${p0.material===m?' selected':''}>${m}</option>`
  ).join('');

  const swatches = _SWATCH_COLORS.map(c =>
    `<button type="button" class="spool-swatch" style="background:${c}" data-hex="${c}" title="${c}" aria-label="${c}"></button>`
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box spool-modal">
      <div class="modal-header">
        <span class="modal-title">${title}</span>
        <button class="modal-close-btn">✕</button>
      </div>
      <div class="spool-modal-form">
        <div class="spool-form-row spool-catalogue-row">
          <div class="spool-catalogue-block">
            <div class="spool-catalogue-title">
              <span>Filament catalogue</span>
              <button type="button" class="spool-inline-btn" id="sm-catalogue-sync">Sync</button>
            </div>
            <div id="sm-catalogue-chips" class="spool-catalogue-chips">
              ${['PLA','PLA+','PETG','ASA','ABS','TPU','Bambu','Polymaker'].map(v => `<button type="button" data-chip="${v}">${v}</button>`).join('')}
            </div>
            <input id="sm-catalogue-search" class="spool-form-input" type="search" placeholder="Search brand, material, colour...">
            <div id="sm-catalogue-picked" class="spool-catalogue-picked hidden"></div>
            <div id="sm-catalogue-results" class="spool-catalogue-results hidden"></div>
          </div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Material *</label>
          <div class="spool-mat-block">
            <select id="sm-material" class="spool-form-input">${matOpts}</select>
            <input id="sm-material-new" class="spool-form-input spool-new-input hidden" type="text" placeholder="New material type">
            <button class="spool-new-toggle" id="sm-mat-toggle" title="Add new material type">+</button>
          </div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Brand *</label>
          <div class="spool-mat-block">
            <select id="sm-brand" class="spool-form-input"${!p0.material?' disabled':''}><option value="">— select material first —</option></select>
            <input id="sm-brand-new" class="spool-form-input spool-new-input hidden" type="text" placeholder="New brand name">
            <button class="spool-new-toggle" id="sm-brand-toggle" title="Add new brand">+</button>
          </div>
        </div>
        <div class="spool-form-row">
          <span class="spool-form-label"></span>
          <div id="sm-prev-picks" class="spool-prev-picks hidden"></div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Subtype</label>
          <input id="sm-subtype" class="spool-form-input" type="text" placeholder="Basic, Matte, Silk…" value="${p0.subtype||''}">
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Colour *</label>
          <div class="spool-color-col">
            <div class="spool-swatches">${swatches}</div>
            <div class="spool-color-row">
              <input id="sm-color-picker" type="color" value="${initHex}" class="spool-color-picker">
              <input id="sm-color-hex" class="spool-form-input spool-color-hex" type="text" value="${initHex}" maxlength="7">
              <div id="sm-color-preview" class="spool-color-preview" style="background:${initHex}"></div>
            </div>
          </div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Colour name</label>
          <input id="sm-color-name" class="spool-form-input" type="text" placeholder="e.g. Jade White" value="${p0.color_name||''}">
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Label weight *</label>
          <div class="spool-inline-row">
            <input id="sm-label-g" class="spool-form-input spool-weight-input" type="number" min="1" value="${p0.label_weight_g||1000}"> g
          </div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Remaining</label>
          <div class="spool-inline-row">
            <input id="sm-remaining-g" class="spool-form-input spool-weight-input" type="number" min="0" value="${p0.remaining_g??p0.label_weight_g??1000}"> g
            <button type="button" class="spool-inline-btn" id="sm-weigh-btn">Weigh</button>
            <span class="spool-form-hint">(defaults to label weight)</span>
          </div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Empty spool</label>
          <div class="spool-inline-row">
            <input id="sm-empty-g" class="spool-form-input spool-weight-input" type="number" min="0" value="${p0.empty_spool_weight_g??''}" placeholder="0"> g
            <span class="spool-form-hint">tare weight</span>
          </div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Location</label>
          <div class="spool-location-block">
            <label class="spool-radio-label">
              <input type="radio" name="sm-loc" value="storage"${!p0.location_printer_id?' checked':''}> Storage:
            </label>
            <div id="sm-storage-selects" class="spool-location-selects${p0.location_printer_id?' hidden':''}">
              <select id="sm-storage-location" class="spool-form-input">${storageOpts}</select>
            </div>
            <label class="spool-radio-label">
              <input type="radio" name="sm-loc" value="loaded"${p0.location_printer_id?' checked':''}> Loaded on:
            </label>
            <div id="sm-location-selects" class="spool-location-selects${!p0.location_printer_id?' hidden':''}">
              <select id="sm-printer" class="spool-form-input">${printerOpts}</select>
              <select id="sm-slot" class="spool-form-input"></select>
            </div>
          </div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Notes</label>
          <input id="sm-notes" class="spool-form-input" type="text" placeholder="Optional notes" value="${p0.notes||''}">
        </div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn" id="sm-cancel">Cancel</button>
        <button class="modal-btn modal-btn-confirm" id="sm-submit">${submitLabel}</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  const matSel    = overlay.querySelector('#sm-material');
  const matNewIn  = overlay.querySelector('#sm-material-new');
  const matToggle = overlay.querySelector('#sm-mat-toggle');
  const brandSel  = overlay.querySelector('#sm-brand');
  const brandNewIn= overlay.querySelector('#sm-brand-new');
  const brandToggle=overlay.querySelector('#sm-brand-toggle');
  const picker    = overlay.querySelector('#sm-color-picker');
  const hexIn     = overlay.querySelector('#sm-color-hex');
  const preview   = overlay.querySelector('#sm-color-preview');
  const labelG    = overlay.querySelector('#sm-label-g');
  const remainG   = overlay.querySelector('#sm-remaining-g');
  const emptyG    = overlay.querySelector('#sm-empty-g');
  const weighBtn  = overlay.querySelector('#sm-weigh-btn');
  const locSels   = overlay.querySelector('#sm-location-selects');
  const storageSels = overlay.querySelector('#sm-storage-selects');
  const storageSel = overlay.querySelector('#sm-storage-location');
  const printerSel= overlay.querySelector('#sm-printer');
  const slotSel   = overlay.querySelector('#sm-slot');
  const prevPicks = overlay.querySelector('#sm-prev-picks');
  const catalogueSearch = overlay.querySelector('#sm-catalogue-search');
  const catalogueResults = overlay.querySelector('#sm-catalogue-results');
  const cataloguePicked = overlay.querySelector('#sm-catalogue-picked');
  const catalogueSync = overlay.querySelector('#sm-catalogue-sync');
  const catalogueChips = overlay.querySelector('#sm-catalogue-chips');

  let matNewMode = false;
  let brandNewMode = false;
  let _colorLock = false;
  function syncColor(hex) {
    if (_colorLock) return;
    _colorLock = true;
    const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
    preview.style.background = valid ? hex : '#808080';
    if (valid) {
      picker.value = hex;
      hexIn.value = hex;
      overlay.querySelectorAll('.spool-swatch').forEach(s =>
        s.classList.toggle('selected', s.dataset.hex === hex)
      );
    }
    _colorLock = false;
  }

  function updatePrevPicks() {
    if (isEdit) return;
    const mat   = matNewMode  ? matNewIn.value.trim().toUpperCase() : matSel.value;
    const brand = brandNewMode ? brandNewIn.value.trim() : brandSel.value;
    if (!mat || !brand) { prevPicks.classList.add('hidden'); return; }
    const seen = new Set();
    const picks = [];
    for (const s of _allSpools) {
      if (s.material !== mat || s.brand !== brand || s.archived_at) continue;
      const key = (s.color_hex || '') + '|' + (s.color_name || '') + '|' + (s.subtype || '');
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push(s);
    }
    if (!picks.length) { prevPicks.classList.add('hidden'); return; }
    prevPicks.innerHTML =
      `<span class="spool-prev-label">Previously used:</span>` +
      `<div class="spool-prev-swatches">` +
      picks.slice(0, 6).map(s =>
        `<button type="button" class="spool-prev-swatch" data-hex="${s.color_hex||'#808080'}" data-name="${s.color_name||''}" data-subtype="${s.subtype||''}" data-weight="${s.label_weight_g}" title="${s.color_name||s.color_hex}${s.subtype?' · '+s.subtype:''}">` +
        `<span class="spool-prev-dot" style="background:${s.color_hex||'#808080'}"></span>` +
        `<span class="spool-prev-name">${s.color_name || s.color_hex}</span>` +
        `</button>`
      ).join('') +
      `</div>`;
    prevPicks.classList.remove('hidden');
    prevPicks.querySelectorAll('.spool-prev-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        syncColor(btn.dataset.hex);
        overlay.querySelector('#sm-color-name').value = btn.dataset.name;
        overlay.querySelector('#sm-subtype').value    = btn.dataset.subtype;
        labelG.value = btn.dataset.weight;
        if (!remainG.dataset.touched) remainG.value = btn.dataset.weight;
      });
    });
  }

  function populateBrands(mat) {
    let brands = matBrands[mat] || [];
    // Always include prefilled brand so edit/duplicate never silently fails validation
    if (p0.brand && !brands.includes(p0.brand)) brands = [p0.brand, ...brands];
    brandSel.innerHTML = brands.length
      ? brands.map(b => `<option value="${b}"${p0.brand===b?' selected':''}>${b||'(unbranded)'}</option>`).join('')
      : '<option value="">— no brands in catalogue —</option>';
    brandSel.disabled = brands.length === 0;
    applyDefaultTare();
    updatePrevPicks();
  }
  if (p0.material) populateBrands(p0.material);

  function ensureMaterialBrand(material, brand) {
    if (material && !matBrands[material]) {
      matBrands[material] = [];
      const opt = document.createElement('option');
      opt.value = material;
      opt.textContent = material;
      matSel.appendChild(opt);
    }
    if (material && brand && !matBrands[material].includes(brand)) {
      matBrands[material].push(brand);
      matBrands[material].sort();
    }
    if (matNewMode) matToggle.click();
    if (brandNewMode) brandToggle.click();
    matSel.value = material;
    populateBrands(material);
    brandSel.value = brand;
  }

  function applyCatalogueEntry(item) {
    const material = String(item.material || '').toUpperCase();
    const brand = item.brand || '';
    ensureMaterialBrand(material, brand);
    const tareFallback = costLookup[`${material}|||${brand || ''}`]?.empty_spool_weight_g;
    overlay.querySelector('#sm-subtype').value = item.subtype || item.product || '';
    syncColor(item.color_hex || '#808080');
    overlay.querySelector('#sm-color-name').value = item.color_name || '';
    if (item.filament_weight_g) {
      labelG.value = Math.round(Number(item.filament_weight_g));
      if (!remainG.dataset.touched) remainG.value = labelG.value;
    }
    if (item.empty_spool_weight_g != null && !emptyG.dataset.touched) {
      emptyG.value = Math.round(Number(item.empty_spool_weight_g));
    } else if (tareFallback != null && !emptyG.dataset.touched) {
      emptyG.value = Math.round(Number(tareFallback));
    }
    catalogueResults.classList.add('hidden');
    cataloguePicked.innerHTML = `
      <span class="spool-catalogue-swatch" style="background:${item.color_hex || '#808080'}"></span>
      <span><b>${esc(item.color_name || 'Colour')}</b><small>${esc(brand)} · ${esc(material)}${item.subtype ? ` · ${esc(item.subtype)}` : ''}${item.filament_weight_g ? ` · ${Math.round(item.filament_weight_g)}g` : ''}</small><em>Open Filament Database · editable defaults</em></span>
    `;
    cataloguePicked.classList.remove('hidden');
    catalogueSearch.value = `${brand} ${material} ${item.color_name || ''}`.trim();
  }

  let catalogueTimer = null;
  async function searchCatalogue() {
    const q = catalogueSearch.value.trim();
    if (q.length < 2) { catalogueResults.classList.add('hidden'); return; }
    const params = new URLSearchParams({ q, limit: '30' });
    const r = await fetch(`/api/filament/catalog/search?${params.toString()}`);
    if (!r.ok) return;
    const rows = await r.json();
    if (!rows.length) {
      catalogueResults.innerHTML = '<div class="spool-catalogue-empty">No catalogue matches. Press Sync if the catalogue is empty.</div>';
      catalogueResults.classList.remove('hidden');
      return;
    }
    catalogueResults.innerHTML = `<div class="spool-catalogue-hint">Showing ${rows.length} matches. Add material or colour to narrow.</div><div class="spool-catalogue-grid">` + rows.map((item, idx) => `
      <button type="button" class="spool-catalogue-result" data-idx="${idx}">
        <span class="spool-catalogue-swatch" style="background:${item.color_hex || '#808080'}"></span>
        <span><b>${esc(item.color_name || 'Colour')}</b><small>${esc(item.brand || '')} · ${esc(item.material || '')}${item.subtype ? ` · ${esc(item.subtype)}` : ''}${item.filament_weight_g ? ` · ${Math.round(item.filament_weight_g)}g` : ''}</small></span>
      </button>
    `).join('') + '</div>';
    catalogueResults.classList.remove('hidden');
    catalogueResults.querySelectorAll('.spool-catalogue-result').forEach(btn => {
      btn.addEventListener('click', () => applyCatalogueEntry(rows[Number(btn.dataset.idx)]));
    });
  }

  catalogueSearch.addEventListener('input', () => {
    clearTimeout(catalogueTimer);
    catalogueTimer = setTimeout(searchCatalogue, 180);
  });
  catalogueChips.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const chip = btn.dataset.chip || '';
      const parts = catalogueSearch.value.trim().split(/\s+/).filter(Boolean);
      if (!parts.map(p => p.toLowerCase()).includes(chip.toLowerCase())) {
        catalogueSearch.value = [...parts, chip].join(' ').trim();
      }
      catalogueChips.querySelectorAll('button').forEach(b => b.classList.toggle(
        'active',
        catalogueSearch.value.toLowerCase().split(/\s+/).includes((b.dataset.chip || '').toLowerCase())
      ));
      searchCatalogue();
    });
  });
  catalogueSync.addEventListener('click', async () => {
    const old = catalogueSync.textContent;
    catalogueSync.disabled = true;
    catalogueSync.textContent = 'Syncing';
    try {
      const r = await fetch('/api/filament/catalog/sync', { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Catalogue sync failed');
      catalogueSync.textContent = `${data.imported || 0}`;
      await searchCatalogue();
    } catch (err) {
      alert(err.message || 'Catalogue sync failed');
    } finally {
      setTimeout(() => { catalogueSync.disabled = false; catalogueSync.textContent = old; }, 1300);
    }
  });

  function selectedMaterialBrand() {
    const mat = matNewMode ? matNewIn.value.trim().toUpperCase() : matSel.value;
    const brand = brandNewMode ? brandNewIn.value.trim() : brandSel.value;
    return { mat, brand };
  }

  function applyDefaultTare(force = false) {
    if (isEdit && !force) return;
    if (emptyG.dataset.touched && !force) return;
    const { mat, brand } = selectedMaterialBrand();
    const match = costLookup[`${mat}|||${brand || ''}`];
    if (match?.empty_spool_weight_g != null) {
      emptyG.value = Math.round(match.empty_spool_weight_g);
    } else if (!emptyG.dataset.touched && !p0.empty_spool_weight_g) {
      emptyG.value = '';
    }
  }

  matSel.addEventListener('change', () => populateBrands(matSel.value));
  brandSel.addEventListener('change', () => { applyDefaultTare(); updatePrevPicks(); });
  matNewIn.addEventListener('input', updatePrevPicks);
  brandNewIn.addEventListener('input', updatePrevPicks);

  // New material toggle
  matToggle.addEventListener('click', () => {
    matNewMode = !matNewMode;
    matSel.classList.toggle('hidden', matNewMode);
    matNewIn.classList.toggle('hidden', !matNewMode);
    matToggle.textContent = matNewMode ? '✕' : '+';
    applyDefaultTare();
  });

  // New brand toggle
  brandToggle.addEventListener('click', () => {
    brandNewMode = !brandNewMode;
    brandSel.classList.toggle('hidden', brandNewMode);
    brandNewIn.classList.toggle('hidden', !brandNewMode);
    brandToggle.textContent = brandNewMode ? '✕' : '+';
    applyDefaultTare();
  });

  picker.addEventListener('input', () => syncColor(picker.value));
  picker.addEventListener('change', () => syncColor(picker.value));
  hexIn.addEventListener('input', () => syncColor(hexIn.value));

  const _swatchNames = {
    '#1a1a1a':'Black','#ffffff':'White','#c0c0c0':'Silver','#808080':'Grey',
    '#ef4444':'Red','#f97316':'Orange','#eab308':'Yellow','#22c55e':'Green',
    '#06b6d4':'Cyan','#3b82f6':'Blue','#a855f7':'Purple','#ec4899':'Pink',
  };
  const _knownSwatchNames = new Set(Object.values(_swatchNames));

  overlay.querySelectorAll('.spool-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      syncColor(sw.dataset.hex);
      const nameEl = overlay.querySelector('#sm-color-name');
      if (!nameEl.value || _knownSwatchNames.has(nameEl.value)) {
        nameEl.value = _swatchNames[sw.dataset.hex] || '';
      }
    });
  });

  syncColor(initHex);

  labelG.addEventListener('input', () => {
    if (!remainG.dataset.touched) remainG.value = labelG.value;
  });
  remainG.addEventListener('input', () => { remainG.dataset.touched = '1'; });
  emptyG.addEventListener('input', () => { emptyG.dataset.touched = '1'; });
  weighBtn.addEventListener('click', async () => {
    const old = weighBtn.textContent;
    weighBtn.disabled = true;
    weighBtn.textContent = '...';
    try {
      const r = await fetch('/api/scale/read');
      if (!r.ok) throw new Error(_scaleFriendlyMessage((await r.json()).detail || 'Scale read failed'));
      const reading = await r.json();
      const empty = parseFloat(emptyG.value) || 0;
      remainG.value = Math.max(0, Math.round((reading.grams - empty) * 10) / 10);
      remainG.dataset.touched = '1';
      weighBtn.textContent = 'Done';
    } catch (err) {
      alert(_scaleFriendlyMessage(err.message || 'Scale read failed'));
      weighBtn.textContent = old;
    } finally {
      setTimeout(() => { weighBtn.disabled = false; weighBtn.textContent = old; }, 1200);
    }
  });

  overlay.querySelectorAll('input[name="sm-loc"]').forEach(r => {
    r.addEventListener('change', () => {
      const isStorage = overlay.querySelector('input[name="sm-loc"]:checked').value === 'storage';
      locSels.classList.toggle('hidden', isStorage);
      storageSels.classList.toggle('hidden', !isStorage);
    });
  });

  function updateSlots() {
    const opt = printerSel.options[printerSel.selectedIndex];
    const kind = opt?.dataset.kind || 'bambu';
    if (kind === 'moonraker') {
      const printer = _latestPrinters.find(x => x.id === printerSel.value);
      const mmuUnit = printer?.mmu?.[0];
      if (mmuUnit?.num_gates > 1) {
        slotSel.innerHTML = Array.from({length: mmuUnit.num_gates}, (_, i) => {
          const gate = mmuUnit.gates?.[i];
          const label = gate?.material ? `Gate ${i} · ${gate.material}` : `Gate ${i}`;
          return `<option value="${i}"${p0.location_slot === i ? ' selected' : ''}>${label}</option>`;
        }).join('');
      } else {
        slotSel.innerHTML = '<option value="0">Single extruder</option>';
      }
      return;
    }
    const printer = _latestPrinters.find(x => x.id === printerSel.value);
    const units = printer?.ams;
    if (units?.length) {
      const opts = [];
      for (const unit of units) {
        for (const slot of unit.slots) {
          const flatIdx = unit.unit * 4 + slot.idx;
          const label = unit.slots.length === 1
            ? unit.label
            : `${unit.label} · Slot ${slot.idx + 1}`;
          opts.push(`<option value="${flatIdx}"${p0.location_slot===flatIdx?' selected':''}>${label}</option>`);
        }
      }
      slotSel.innerHTML = opts.join('');
    } else {
      slotSel.innerHTML = [0,1,2,3].map(i =>
        `<option value="${i}"${p0.location_slot===i?' selected':''}>Slot ${i+1}</option>`
      ).join('');
    }
  }
  printerSel.addEventListener('change', updateSlots);
  updateSlots();

  overlay.querySelector('.modal-close-btn').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#sm-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#sm-submit').addEventListener('click', async () => {
    const material = matNewMode ? matNewIn.value.trim().toUpperCase() : matSel.value.trim();
    const brand    = brandNewMode ? brandNewIn.value.trim() : brandSel.value.trim();
    const hex      = hexIn.value.trim();
    const labelW   = parseFloat(labelG.value);
    if (!material) { (matNewMode ? matNewIn : matSel).focus(); return; }
    if (!brand)    { (brandNewMode ? brandNewIn : brandSel).focus(); return; }
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { hexIn.focus(); return; }
    if (isNaN(labelW) || labelW <= 0)    { labelG.focus(); return; }
    const emptyW = emptyG.value.trim() === '' ? null : parseFloat(emptyG.value);
    if (emptyW !== null && (isNaN(emptyW) || emptyW < 0)) { emptyG.focus(); return; }

    const locMode = overlay.querySelector('input[name="sm-loc"]:checked').value;
    const body = {
      material, brand, color_hex: hex, label_weight_g: labelW,
      remaining_g:    parseFloat(remainG.value) || labelW,
      empty_spool_weight_g: emptyW,
      subtype:        overlay.querySelector('#sm-subtype').value.trim()    || null,
      color_name:     overlay.querySelector('#sm-color-name').value.trim() || null,
      notes:          overlay.querySelector('#sm-notes').value.trim()      || null,
      location_printer_id: locMode === 'loaded' ? printerSel.value : null,
      location_slot:       locMode === 'loaded' ? parseInt(slotSel.value) : null,
      storage_location_id: locMode === 'storage' && storageSel.value ? parseInt(storageSel.value, 10) : null,
    };

    // Auto-create new brand in catalogue if needed
    if ((matNewMode || brandNewMode) && !isNaN(labelW)) {
      await fetch(`/api/filament/costs/${encodeURIComponent(material)}/${encodeURIComponent(brand)}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({cost_per_gram: 0, comment: 'Added via spool form'}),
      }).catch(() => {});
    }

    const btn = overlay.querySelector('#sm-submit');
    btn.disabled = true; btn.textContent = '…';
    try {
      if (isEdit) {
        const r = await fetch(`/api/spools/${prefill.id}`, {
          method: 'PUT', headers: {'Content-Type':'application/json'},
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error();
        // Always update location on edit — handles loaded→storage clearing too
        const mr = await fetch(`/api/spools/${prefill.id}/move`, {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify({
            printer_id: locMode === 'loaded' ? printerSel.value : null,
            slot:       locMode === 'loaded' ? parseInt(slotSel.value) : null,
            storage_location_id: locMode === 'storage' && storageSel.value ? parseInt(storageSel.value, 10) : null,
          }),
        });
        if (mr.status === 409) {
          const err = await mr.json();
          btn.textContent = `Slot occupied (#${err.detail?.conflict_spool_id ?? '?'})`;
          setTimeout(() => { btn.textContent = submitLabel; btn.disabled = false; }, 3000);
          return;
        }
      } else {
        const r = await fetch('/api/spools', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify(body),
        });
        if (r.status === 409) {
          const err = await r.json();
          btn.textContent = `Slot occupied (#${err.detail?.conflict_spool_id ?? '?'})`;
          setTimeout(() => { btn.textContent = submitLabel; btn.disabled = false; }, 3000);
          return;
        }
        if (!r.ok) throw new Error();
      }
      overlay.remove();
      onSaved();
    } catch {
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = submitLabel; btn.disabled = false; }, 2000);
    }
  });
}

function _locationsCategoryHtml(locations) {
  const storedSpools = _allSpools.filter(s => !s.archived_at && !s.location_printer_id);
  const locationCards = locations.length ? locations.map(loc => {
    const spools = storedSpools.filter(s => String(s.storage_location_id || '') === String(loc.id));
    const grams = spools.reduce((sum, s) => sum + Number(s.remaining_g || 0), 0);
    const spoolRows = spools.length ? spools.map(s => {
      const pct = s.label_weight_g > 0 ? Math.round(s.remaining_g * 100 / s.label_weight_g) : 0;
      const pctCls = pct < 20 ? ' spool-low' : pct < 50 ? ' spool-amber' : '';
      const color = s.color_hex || '#808080';
      return `<div class="location-spool-row" data-spool-id="${s.id}">
        <span class="location-spool-swatch" style="background:${color}"></span>
        <div class="location-spool-main">
          <div class="location-spool-title">${esc(s.color_name || color)} · ${esc(s.material)}${s.subtype ? ` ${esc(s.subtype)}` : ''}</div>
          <div class="location-spool-sub">${esc(s.brand || 'Unknown brand')} · #${s.id}</div>
        </div>
        <div class="location-spool-weight${pctCls}">${Math.round(s.remaining_g || 0)}g</div>
        <div class="location-spool-actions">
          <a class="spool-action-btn spool-action-detail" href="#/spool/${s.id}">Details</a>
          <button class="spool-action-btn spool-action-label" data-action="label" data-id="${s.id}">Label</button>
          <button class="spool-action-btn spool-action-edit" data-action="edit" data-id="${s.id}">Edit</button>
        </div>
      </div>`;
    }).join('') : `<div class="location-spool-empty">No spools stored here.</div>`;
    return `<section class="location-card" data-location-id="${loc.id}">
      <div class="location-card-head">
        <div>
          <div class="location-card-name">${esc(loc.name)}</div>
          <div class="location-card-notes">${esc(loc.notes || 'No notes')}</div>
        </div>
        <div class="location-card-stats">
          <strong>${spools.length}</strong>
          <span>${spools.length === 1 ? 'spool' : 'spools'}</span>
          <small>${(grams / 1000).toFixed(2)}kg</small>
        </div>
      </div>
      <div class="location-spool-list">${spoolRows}</div>
    </section>`;
  }).join('') : `<div class="settings-empty">Add a location to start organising stored spools.</div>`;

  const unassigned = storedSpools.filter(s => !s.storage_location_id);
  const unassignedCard = unassigned.length ? `<section class="location-card location-card-unassigned">
    <div class="location-card-head">
      <div>
        <div class="location-card-name">Unassigned</div>
        <div class="location-card-notes">Stored spools without a named location yet.</div>
      </div>
      <div class="location-card-stats">
        <strong>${unassigned.length}</strong>
        <span>${unassigned.length === 1 ? 'spool' : 'spools'}</span>
      </div>
    </div>
    <div class="location-spool-list">
      ${unassigned.map(s => `<div class="location-spool-row" data-spool-id="${s.id}">
        <span class="location-spool-swatch" style="background:${s.color_hex || '#808080'}"></span>
        <div class="location-spool-main">
          <div class="location-spool-title">${esc(s.color_name || s.color_hex || 'Colour')} · ${esc(s.material)}</div>
          <div class="location-spool-sub">${esc(s.brand || 'Unknown brand')} · #${s.id}</div>
        </div>
        <div class="location-spool-weight">${Math.round(s.remaining_g || 0)}g</div>
        <div class="location-spool-actions">
          <a class="spool-action-btn spool-action-detail" href="#/spool/${s.id}">Details</a>
          <button class="spool-action-btn spool-action-label" data-action="label" data-id="${s.id}">Label</button>
          <button class="spool-action-btn spool-action-edit" data-action="edit" data-id="${s.id}">Edit</button>
        </div>
      </div>`).join('')}
    </div>
  </section>` : '';

  const rows = locations.length ? locations.map(loc => `
    <div class="spool-location-row" data-location-id="${loc.id}">
      <div>
        <div class="spool-location-name">${esc(loc.name)}</div>
        <div class="spool-location-notes">${esc(loc.notes || 'No notes')}</div>
      </div>
      <div class="spool-location-actions">
        <button class="spool-action-btn spool-action-edit" data-location-action="edit" data-id="${loc.id}">Edit</button>
        <button class="spool-action-btn spool-action-danger" data-location-action="delete" data-id="${loc.id}">Archive</button>
      </div>
    </div>`).join('') : `<div class="settings-empty">No storage locations yet.</div>`;

  return `
    <div class="settings-section">
      <div class="settings-section-title">Location Overview</div>
      <div class="settings-subtitle">Stored spools grouped by where they physically live.</div>
      <div class="location-overview-grid">${locationCards}${unassignedCard}</div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Shelf Locations</div>
      <div class="settings-subtitle">Create the shelves, dry boxes, tubs, or bays where spools live when they are not loaded in a printer.</div>
      <form id="spool-location-form" class="settings-form spool-location-form" novalidate>
        <input id="loc-id" type="hidden" value="">
        <div class="settings-form-row">
          <label class="settings-label" for="loc-name">Name</label>
          <input class="settings-input" id="loc-name" type="text" placeholder="e.g. Dry box A, Shelf 2, AMS spare tub" required>
        </div>
        <div class="settings-form-row">
          <label class="settings-label" for="loc-notes">Notes</label>
          <input class="settings-input" id="loc-notes" type="text" placeholder="Optional">
        </div>
        <div class="settings-form-actions">
          <button type="submit" class="settings-save-btn" id="loc-submit">Add Location</button>
          <button type="button" class="settings-delete-btn hidden" id="loc-cancel">Cancel edit</button>
        </div>
      </form>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Current Locations</div>
      <div class="spool-location-list">${rows}</div>
    </div>`;
}

function _attachLocationsEvents(el, locations) {
  _attachSpoolListEvents(el, el, 'locations');
  const form = el.querySelector('#spool-location-form');
  const idIn = el.querySelector('#loc-id');
  const nameIn = el.querySelector('#loc-name');
  const notesIn = el.querySelector('#loc-notes');
  const submit = el.querySelector('#loc-submit');
  const cancel = el.querySelector('#loc-cancel');

  function resetForm() {
    idIn.value = '';
    nameIn.value = '';
    notesIn.value = '';
    submit.textContent = 'Add Location';
    cancel.classList.add('hidden');
  }

  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const name = nameIn.value.trim();
    if (!name) { nameIn.focus(); return; }
    const body = { name, notes: notesIn.value.trim() || null };
    const id = idIn.value;
    const url = id ? `/api/spool-locations/${id}` : '/api/spool-locations';
    const method = id ? 'PUT' : 'POST';
    submit.disabled = true;
    try {
      const r = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error();
      await _renderSettingsContent('locations');
    } catch {
      submit.textContent = 'Error';
      setTimeout(() => { submit.textContent = id ? 'Save Location' : 'Add Location'; submit.disabled = false; }, 1500);
      return;
    }
    submit.disabled = false;
  });

  cancel?.addEventListener('click', resetForm);

  el.querySelectorAll('[data-location-action]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const loc = locations.find(l => String(l.id) === String(id));
      if (!loc) return;
      if (btn.dataset.locationAction === 'edit') {
        idIn.value = loc.id;
        nameIn.value = loc.name || '';
        notesIn.value = loc.notes || '';
        submit.textContent = 'Save Location';
        cancel.classList.remove('hidden');
        nameIn.focus();
        return;
      }
      _modal.show(`Archive ${loc.name}?`, async () => {
        await fetch(`/api/spool-locations/${id}`, { method: 'DELETE' });
        await _renderSettingsContent('locations');
      });
    });
  });
}

async function _renderSettingsContent(category) {
  const el = document.getElementById('settings-content');
  if (!el) return;
  el.classList.remove('settings-content-spools', 'settings-content-locations');

  if (category === 'printers') {
    el.innerHTML = `<div class="detail-placeholder" style="min-height:10rem">Loading…</div>`;
    let printers = [];
    try {
      const r = await fetch('/api/config/printers');
      if (r.ok) printers = await r.json();
    } catch {}
    el.innerHTML = _printersCategoryHtml(printers);
    _attachPrintersEvents(el);
  } else if (category === 'hardware') {
    el.innerHTML = `<div class="detail-placeholder" style="min-height:10rem">Loading…</div>`;
    const [scale, labelPrinter] = await Promise.all([
      fetch('/api/scale/status').then(r => r.json()).catch(() => ({})),
      fetch('/api/label_printer/status').then(r => r.json()).catch(() => ({})),
    ]);
    el.innerHTML = _hardwareCategoryHtml(scale, labelPrinter);
    _attachHardwareEvents(el);
  } else if (category === 'appearance') {
    el.innerHTML = _appearanceCategoryHtml();
    _attachAppearanceEvents(el);
  } else if (category === 'slicer') {
    el.innerHTML = _slicerCategoryHtml();
    _attachSlicerEvents(el);
  } else if (category === 'filament') {
    el.innerHTML = `<div class="detail-placeholder" style="min-height:10rem">Loading…</div>`;
    const [summary, costs] = await Promise.all([
      fetch('/api/filament/summary').then(r => r.json()).catch(() => ({})),
      fetch('/api/filament/costs').then(r => r.json()).catch(() => []),
    ]);
    el.innerHTML = _filamentCategoryHtml(summary, costs);
    _attachFilamentEvents(el);
  } else if (category === 'locations') {
    el.classList.add('settings-content-locations');
    el.innerHTML = `<div class="detail-placeholder" style="min-height:10rem">Loading…</div>`;
    const [locations, spools] = await Promise.all([
      fetch('/api/spool-locations').then(r => r.json()).catch(() => []),
      fetch('/api/spools').then(r => r.json()).catch(() => []),
    ]);
    _spoolLocations = locations;
    _allSpools = spools;
    el.innerHTML = _locationsCategoryHtml(locations);
    _attachLocationsEvents(el, locations);
  }
}

async function _renderSpoolsContent(el) {
  if (!el) return;
  el.classList.add('settings-content-spools');
  el.innerHTML = `<div class="detail-placeholder" style="min-height:10rem">Loading…</div>`;
  const [spools, summary, costs, locations, intelligence] = await Promise.all([
    fetch('/api/spools').then(r => r.json()).catch(() => []),
    fetch('/api/spools/summary').then(r => r.json()).catch(() => ({})),
    fetch('/api/filament/costs').then(r => r.json()).catch(() => []),
    fetch('/api/spool-locations').then(r => r.json()).catch(() => []),
    fetch('/api/spools/intelligence').then(r => r.json()).catch(() => ({})),
  ]);
  _spoolLocations = locations;
  el.innerHTML = _spoolsCategoryHtml(spools, summary, costs, intelligence);
  _attachSpoolsEvents(el, costs);
}

async function renderSpoolsView() {
  const body = document.getElementById('spools-body');
  if (!body) return;
  document.querySelectorAll('#view-spools .settings-nav').forEach(nav => nav.remove());
  body.innerHTML = `<div class="settings-content settings-content-spools" id="spools-content"></div>`;
  await _renderSpoolsContent(body.querySelector('#spools-content'));
}

async function renderSettingsView() {
  const body = document.getElementById('settings-body');

  const navHtml = _SETTINGS_CATEGORIES.map(c =>
    `<button class="settings-nav-item${c.id === _settingsCategory ? ' active' : ''}"
      data-category="${c.id}">${c.label}</button>`
  ).join('');

  body.innerHTML = `
    <nav class="settings-nav">${navHtml}</nav>
    <div class="settings-content" id="settings-content"></div>`;

  body.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      _settingsCategory = item.dataset.category;
      const targetHash = `#/settings/${_settingsCategory}`;
      if (location.hash !== targetHash) history.replaceState(null, '', targetHash);
      body.querySelectorAll('.settings-nav-item').forEach(i =>
        i.classList.toggle('active', i === item)
      );
      document.querySelectorAll('#tab-strip .tab').forEach(tab => {
        const href = tab.getAttribute('href');
        tab.classList.toggle('active',
          (href === `#/settings/${_settingsCategory}`) ||
          (href === '#/settings' && _settingsCategory === 'printers')
        );
      });
      _renderSettingsContent(_settingsCategory);
    });
  });

  await _renderSettingsContent(_settingsCategory);
}

loadSettings();
connectWS();
_refreshSpoolsByPrinter();
initNotifBtn();
window.addEventListener('hashchange', router);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/static/sw.js').catch(() => {});
}
router();
