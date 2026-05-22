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
const _cameraUrlCache = {};     // printer_id → url string or null
let _renderedDetailId = null;
let _renderedDetailSubtab = null;
let _renderedDetailOk = false;
const _pendingControls = {};    // printer_id → { action, fromState }
const _tempOptimistic = {};     // `${id}:${heater}` → { sentTarget, expiresAt }
const _objectsCache = {};       // printer_id → { supported, objects }
const _historyYear = {};        // printer_id → selected year (int)
const _dayPrintsCache = {};     // `${printerId}:${dateStr}` → prints[]
let _camerasFull = false;       // true once cameras grid has been fully rendered
let _camZoom = 0;               // 0=normal, 1=wide, 2=fullscreen
let _onSettings = false;        // true while settings view is active

// ── Toast notifications ────────────────────────────────────────────────────

const _toastContainer = document.createElement('div');
_toastContainer.id = 'toast-container';
document.body.appendChild(_toastContainer);

function showToast(message, sub, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span class="toast-msg">${message}</span>${sub ? `<span class="toast-sub">${sub}</span>` : ''}`;
  _toastContainer.appendChild(t);
  requestAnimationFrame(() => t.classList.add('toast-in'));
  const remove = () => {
    t.classList.remove('toast-in');
    t.addEventListener('transitionend', () => t.remove(), { once: true });
  };
  const timer = setTimeout(remove, 5000);
  t.addEventListener('click', () => { clearTimeout(timer); remove(); });
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
      (_heater === 'bed' ? val > 120 : val > 280)
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
    const val = parseInt(_composed, 10);
    if (isNaN(val)) return;
    const clamped = Math.max(0, Math.min(_max, val));
    if (clamped !== val) {
      _composed = String(clamped);
      const el = overlay.querySelector('#tm-composed');
      el.classList.add('composed-clamp');
      el.textContent = _composed;
      setTimeout(() => el.classList.remove('composed-clamp'), 500);
      return;
    }
    sendTempSet(_printerId, _heater, clamped);
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
    _max = max;
    _composed = target > 0 ? String(Math.round(target)) : '';
    overlay.querySelector('#tm-title').textContent = label.toUpperCase();
    overlay.querySelector('#tm-current').textContent = `${Math.round(current)}°`;
    overlay.querySelector('#tm-range').textContent = `Range: 0–${max}°C`;
    const allPresets = [{ label: 'Off', value: 0 }, ...presets];
    overlay.querySelector('#tm-presets').innerHTML = allPresets
      .map(p => `<button class="temp-preset-btn" data-value="${p.value}">${p.label}</button>`)
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
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

function renderTemp(label, reading) {
  const actual = reading.actual.toFixed(0);
  const target = reading.target > 0
    ? `<span class="temp-target">/${reading.target.toFixed(0)}°</span>`
    : '';
  return `
    <div class="temp-item">
      <span class="temp-label">${label}</span>
      <span class="temp-value">${actual}°${target}</span>
    </div>`;
}

const TEMP_LABELS = { hotend: 'Hotend', bed: 'Bed', chamber: 'Chamber' };

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
          <span>ETA ${formatEta(p.job.eta_seconds)}</span>
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

  return `
    <div class="card"${tabAttr}${dataAttr}>
      <div class="card-header">
        <div class="printer-identity">
          <div class="printer-icon">${getIcon(p.icon)}</div>
          ${connDot(p.last_seen)}
          <div class="printer-names">
            <span class="printer-model">${p.model_name}</span>
            <span class="printer-custom">${p.custom_name}</span>
          </div>
        </div>
        <span class="badge badge-${p.state}">${badgeLabel}</span>
      </div>
      ${temps ? `<div class="temps">${temps}</div>` : ''}
      ${body}
      ${idleRows}
      ${error}
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
  document.getElementById('refresh-time').textContent = new Date().toLocaleTimeString();
}, 1000);
document.getElementById('refresh-time').textContent = new Date().toLocaleTimeString();

// ── Print controls ────────────────────────────────────────────────────────

function _canDo(state, action) {
  switch (action) {
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

  return `
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
    }
  } catch {
    delete _pendingControls[id];
    _updateControlsWidget(id);
  }
}

// Delegated handler — wired once at startup
document.getElementById('view-printer').addEventListener('click', e => {
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

// ── Routing ────────────────────────────────────────────────────────────────

function parseRoute() {
  const hash = location.hash || '#/';
  const printerMatch = hash.match(/^#\/printer\/([^/]+)(?:\/(history))?/);
  if (printerMatch) return { view: 'printer', id: printerMatch[1], subtab: printerMatch[2] || 'live' };
  if (hash === '#/cameras') return { view: 'cameras' };
  if (hash === '#/settings') return { view: 'settings' };
  return { view: 'dashboard' };
}

function router() {
  const route = parseRoute();

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
  _onSettings = route.view === 'settings';

  document.getElementById('view-dashboard').hidden = route.view !== 'dashboard';
  document.getElementById('view-printer').hidden   = route.view !== 'printer';
  document.getElementById('view-cameras').hidden   = route.view !== 'cameras';
  document.getElementById('view-settings').hidden  = route.view !== 'settings';

  document.querySelectorAll('#tab-strip .tab').forEach(tab => {
    const href = tab.getAttribute('href');
    tab.classList.toggle('active',
      (route.view === 'printer'  && href === `#/printer/${route.id}`) ||
      (route.view === 'cameras'  && href === '#/cameras') ||
      (route.view === 'settings' && href === '#/settings')
    );
  });

  if (route.view === 'printer') renderPrinterDetail(route.id, route.subtab);
  if (route.view === 'cameras') renderCamerasView();
  if (route.view === 'settings' && !wasOnSettings) renderSettingsView();
}

function buildTabs(printers) {
  const nav = document.getElementById('tab-strip');
  nav.innerHTML = [
    ...printers.map(p => `<a class="tab" href="#/printer/${p.id}">${p.model_name}</a>`),
    `<a class="tab" href="#/cameras">All Cameras</a>`,
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

  return title + thumb +
    `<div class="detail-row"><span class="detail-label">File</span><span class="detail-value">${name}</span></div>` +
    `<div class="detail-progress-bar"><div class="detail-progress-fill" style="width:${pct}%"></div></div>` +
    `<div class="detail-row"><span class="detail-label">Progress</span><span class="detail-value">${pct}%</span></div>` +
    `<div class="detail-row"><span class="detail-label">Layer</span><span class="detail-value">${layers}</span></div>` +
    `<div class="detail-row"><span class="detail-label">ETA</span><span class="detail-value">${formatEta(job.eta_seconds)}</span></div>`;
}

const _TEMP_CTRL_HEATERS = new Set(['hotend', 'bed']);
const _TEMP_LABELS = { hotend: 'Hotend', bed: 'Bed', chamber: 'Chamber' };

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

  const rows = entries.map(([k, r]) => {
    const label = _TEMP_LABELS[k] ?? k;
    const actual = r.actual.toFixed(0);
    const target = _getDisplayTarget(p.id, k, r.target);
    const hasCtrl = _TEMP_CTRL_HEATERS.has(k);

    if (!hasCtrl) {
      return `<div class="temp-ctrl-row">
        <span class="temp-row-label">${label}</span>
        <div class="temp-readings"><span class="temp-actual">${actual}°</span></div>
      </div>`;
    }

    const targetHtml = target > 0
      ? `<span class="temp-sep">/</span>
         <span class="temp-target-val" data-temp-edit="${k}" data-printer-id="${p.id}">${Math.round(target)}°</span>`
      : `<span class="temp-sep" style="font-size:0.75rem">off</span>`;

    return `<div class="temp-ctrl-row">
      <span class="temp-row-label">${label}</span>
      <div class="temp-readings" data-temp-edit="${k}" data-printer-id="${p.id}" style="cursor:pointer">
        <span class="temp-actual">${actual}°</span>
        ${targetHtml}
      </div>
      <div class="temp-nudge">
        <button class="temp-btn" data-temp-action="dec" data-heater="${k}" data-printer-id="${p.id}" data-target="${Math.round(target)}">−</button>
        <button class="temp-btn" data-temp-action="inc" data-heater="${k}" data-printer-id="${p.id}" data-target="${Math.round(target)}">+</button>
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
  const hasLoaded = p.ams.some(u => u.slots.some(s => !s.empty));
  if (!hasLoaded) return '';

  const title = `<div class="detail-panel-title">AMS</div>`;
  const units = p.ams.map(unit => {
    const slots = unit.slots.map(slot => {
      const style = (!slot.empty && slot.color) ? `style="background:${slot.color}"` : '';
      const activeCls = slot.active ? ' ams-active' : '';
      const emptyCls  = slot.empty  ? ' ams-empty'  : '';
      const tip = slot.empty
        ? `Slot ${slot.idx + 1}: empty`
        : [slot.type, slot.brand].filter(Boolean).join(' · ');
      return `<div class="ams-slot-wrap">
        <div class="ams-slot${activeCls}${emptyCls}" ${style} title="${tip}"></div>
        <span class="ams-slot-type">${slot.empty ? '' : slot.type}</span>
      </div>`;
    }).join('');
    return `<div class="ams-unit">
      <span class="ams-unit-lbl">${unit.label ?? 'AMS ' + (unit.unit + 1)}</span>
      <div class="ams-slots">${slots}</div>
    </div>`;
  }).join('');

  return `<div class="detail-panel">${title}<div class="ams-units">${units}</div></div>`;
}

// ── MMU panel ─────────────────────────────────────────────────────────────

function _detailMmuPanel(p) {
  if (!p.mmu?.length) return '';
  const unit = p.mmu[0];
  if (!unit.gates?.length) return '';

  const title = `<div class="detail-panel-title">${unit.vendor || 'MMU'} · ${unit.num_gates} gates</div>`;

  const slots = unit.gates.map(gate => {
    const style = (!gate.empty && gate.color) ? `style="background:${gate.color}"` : '';
    const activeCls = gate.active ? ' ams-active' : '';
    const emptyCls  = gate.empty  ? ' ams-empty'  : '';
    const bufferedCls = (!gate.empty && gate.status === 2) ? ' mmu-buffered' : '';
    const tip = gate.empty
      ? `T${gate.idx}: empty`
      : [gate.filament_name || gate.material, gate.status === 2 ? 'buffered' : 'available']
          .filter(Boolean).join(' · ');
    return `<div class="ams-slot-wrap">
      <div class="ams-slot${activeCls}${emptyCls}${bufferedCls}" ${style} title="${tip}"></div>
      <span class="ams-slot-type">${gate.empty ? '' : (gate.material || '')}</span>
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
  const time = new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  </div>`;
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

    const camUrl = _cameraUrlCache[id];
    const camHtml = (camUrl && p.state !== 'offline')
      ? `<img id="detail-cam-img" src="${camUrl}" alt="Live camera">`
      : `<div class="camera-hero-offline">${p.state === 'offline' ? 'Printer offline' : 'No camera configured'}</div>`;

    el.innerHTML =
      _detailSubTabs(id, 'live') +
      `<div class="detail-body">
        <div class="detail-left">
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
    const camUrl = _cameraUrlCache[id];
    if (camImg?.dataset.stopped && camUrl && p.state !== 'offline') {
      delete camImg.dataset.stopped;
      camImg.src = camUrl;
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

// ── Cameras grid ──────────────────────────────────────────────────────────

function _camHeaderInner(p) {
  const badgeLabel = p.state === 'finished' ? 'complete' : p.state;
  return `<div class="printer-identity">
    <div class="printer-icon">${getIcon(p.icon)}</div>
    ${connDot(p.last_seen)}
    <div class="printer-names">
      <span class="printer-model">${p.model_name}</span>
      <span class="printer-custom">${p.custom_name}</span>
    </div>
  </div>
  <span class="badge badge-${p.state}">${badgeLabel}</span>`;
}

function _camTileHtml(p) {
  const camUrl = _cameraUrlCache[p.id];
  const feed = (camUrl && p.state !== 'offline')
    ? `<img src="${camUrl}" alt="${p.custom_name}">`
    : `<div class="cam-tile-offline">${p.state === 'offline' ? 'Offline' : 'No camera'}</div>`;
  return `<div class="cam-tile" data-printer-id="${p.id}" tabindex="0">
    <div class="cam-tile-header">${_camHeaderInner(p)}</div>
    <div class="cam-tile-feed">${feed}</div>
  </div>`;
}

async function renderCamerasView() {
  const el = document.getElementById('cameras-grid');

  if (_camerasFull) {
    _latestPrinters.forEach(p => {
      const header = el.querySelector(`.cam-tile[data-printer-id="${p.id}"] .cam-tile-header`);
      if (header) header.innerHTML = _camHeaderInner(p);
    });
    return;
  }

  if (!_latestPrinters.length) {
    el.innerHTML = `<div class="detail-placeholder">Connecting…</div>`;
    return;
  }

  await Promise.all(_latestPrinters.map(async p => {
    if (_cameraUrlCache[p.id] === undefined) {
      try {
        const r = await fetch(`/api/printers/${p.id}/camera`);
        _cameraUrlCache[p.id] = r.ok ? (await r.json()).url : null;
      } catch { _cameraUrlCache[p.id] = null; }
    }
  }));

  el.innerHTML = _latestPrinters.map(_camTileHtml).join('');

  el.querySelectorAll('.cam-tile[data-printer-id]').forEach(tile => {
    tile.addEventListener('click', () => location.hash = `#/printer/${tile.dataset.printerId}`);
    tile.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        location.hash = `#/printer/${tile.dataset.printerId}`;
      }
    });
  });

  _camerasFull = true;
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
  if (Notification.permission !== 'granted') return;
  printers.forEach(p => {
    const prev = _prevStates[p.id];
    _prevStates[p.id] = p.state;
    if (prev === p.state) return;
    if (p.state === 'finished' && prev === 'printing') {
      showToast('Print complete', p.custom_name, 'success');
      if (Notification.permission === 'granted')
        new Notification('Print complete ✓', { body: p.custom_name });
    } else if (p.state === 'error') {
      showToast('Print error — check printer', p.custom_name, 'error');
      if (Notification.permission === 'granted')
        new Notification('Print error ⚠', { body: p.custom_name });
    }
  });
}

function initNotifBtn() {
  const btn = document.getElementById('notif-btn');
  if (!btn) return;
  if (!('Notification' in window) || !window.isSecureContext) {
    btn.classList.add('notif-off');
    btn.title = 'Notifications require HTTPS — access the app via https:// to enable';
    return;
  }
  const update = () => {
    const perm = Notification.permission;
    btn.classList.toggle('notif-on', perm === 'granted');
    btn.classList.toggle('notif-off', perm === 'denied');
    btn.title = perm === 'granted' ? 'Notifications on'
              : perm === 'denied'  ? 'Notifications blocked — check browser settings'
              : 'Enable print notifications';
  };
  update();
  btn.addEventListener('click', async () => {
    if (Notification.permission === 'granted') return;
    await Notification.requestPermission();
    update();
  });
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
  _latestPrinters = printers;
  if (!_tabsBuilt) buildTabs(printers);
  else router();

  // Refresh object exclusion panel on every tick when on live tab and printing
  const _route = parseRoute();
  if (_route.view === 'printer' && _route.subtab !== 'history') {
    const _rp = printers.find(x => x.id === _route.id);
    if (_rp?.state === 'printing' || _rp?.state === 'paused') refreshObjectsPanel(_route.id);
  }

  const grid = document.getElementById('printer-grid');
  grid.innerHTML = printers.map(renderCard).join('');

  grid.querySelectorAll('[data-printer-id]').forEach(card => {
    const p = printers.find(x => x.id === card.dataset.printerId);
    if (p) card._printerData = p;
    attachCardEvents(card);
  });

  updateStatusPill(printers);

  const active = printers.filter(p => p.state === 'printing' || p.state === 'paused').length;
  const idle = printers.filter(p => p.state === 'idle' || p.state === 'finished').length;
  document.getElementById('dash-footer').innerHTML =
    `<span>flightdeck · 192.168.4.127</span>` +
    `<span>${printers.length} printers · ${active} active · ${idle} idle</span>`;
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
      updateDashboard(JSON.parse(evt.data));
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

// Apply saved appearance on load
(function () {
  const accent = localStorage.getItem('fd_accent');
  if (accent) document.documentElement.style.setProperty('--printing', accent);
})();

let _settingsCategory = 'printers';

const _SETTINGS_CATEGORIES = [
  { id: 'printers',   label: 'Printers'   },
  { id: 'appearance', label: 'Appearance' },
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
              <span class="printer-model">${p.model_name}</span>
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

const _ACCENT_COLORS = [
  { label: 'Blue',   value: '#3b82f6' },
  { label: 'Purple', value: '#8b5cf6' },
  { label: 'Teal',   value: '#14b8a6' },
  { label: 'Green',  value: '#22c55e' },
  { label: 'Orange', value: '#f59e0b' },
  { label: 'Pink',   value: '#ec4899' },
];

function _appearanceCategoryHtml() {
  const current = (localStorage.getItem('fd_accent') ?? '#3b82f6').trim();
  const swatches = _ACCENT_COLORS.map(c =>
    `<button class="accent-swatch${c.value === current ? ' accent-swatch-active' : ''}"
      style="background:${c.value}" data-accent="${c.value}" title="${c.label}"></button>`
  ).join('');

  return `
    <div class="settings-section">
      <div class="settings-section-title">Accent Color</div>
      <div class="settings-form-row">
        <label class="settings-label">Theme colour</label>
        <div class="accent-swatches">${swatches}</div>
      </div>
    </div>`;
}

function _attachAppearanceEvents(el) {
  el.querySelectorAll('.accent-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      const color = swatch.dataset.accent;
      document.documentElement.style.setProperty('--printing', color);
      localStorage.setItem('fd_accent', color);
      el.querySelectorAll('.accent-swatch').forEach(s =>
        s.classList.toggle('accent-swatch-active', s === swatch)
      );
    });
  });
}

// ── Settings layout ────────────────────────────────────────────────────────

async function _renderSettingsContent(category) {
  const el = document.getElementById('settings-content');
  if (!el) return;

  if (category === 'printers') {
    el.innerHTML = `<div class="detail-placeholder" style="min-height:10rem">Loading…</div>`;
    let printers = [];
    try {
      const r = await fetch('/api/config/printers');
      if (r.ok) printers = await r.json();
    } catch {}
    el.innerHTML = _printersCategoryHtml(printers);
    _attachPrintersEvents(el);
  } else if (category === 'appearance') {
    el.innerHTML = _appearanceCategoryHtml();
    _attachAppearanceEvents(el);
  }
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
      body.querySelectorAll('.settings-nav-item').forEach(i =>
        i.classList.toggle('active', i === item)
      );
      _renderSettingsContent(_settingsCategory);
    });
  });

  await _renderSettingsContent(_settingsCategory);
}

connectWS();
initNotifBtn();
window.addEventListener('hashchange', router);
router();
