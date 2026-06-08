// ── Settings cache & display helpers ──────────────────────────────────────

let _serverSettings = {};
let _moistureWatchMemory = {};
let _instanceInfo = null;
let _slicerProfileData = null;
const FLIGHTDECK_DEMO = window.FLIGHTDECK_DEMO === true;

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

function _demoMediaUrl(label = 'Flightdeck demo', colour = '#3b82f6') {
  const source = String(label || '');
  if (
    source.includes('/api/printers/h2d/thumbnail') ||
    source.includes('/api/queue/101/preview') ||
    source.includes('/api/queue/102/preview')
  ) {
    return '/static/demo-assets/can-opener-preview.png';
  }
  if (source.includes('/api/printers/greyhound/camera')) {
    return '/static/demo-assets/voron-camera.png';
  }
  if (source.includes('/api/printers/x1c/camera')) {
    return '/static/demo-assets/x1c-camera.png';
  }
  if (source.includes('/api/printers/h2d/camera')) {
    return '/static/demo-assets/h2d-camera.png';
  }
  const safeLabel = esc(label).replace(/&apos;/g, "'").replace(/&quot;/g, '"');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
    <rect width="640" height="360" fill="#070910"/>
    <rect x="30" y="38" width="580" height="284" rx="18" fill="#111827" stroke="#334155"/>
    <path d="M132 240h376" stroke="#475569" stroke-width="10" stroke-linecap="round"/>
    <path d="M178 126h250l58 72H118z" fill="${colour}" opacity="0.92"/>
    <circle cx="208" cy="248" r="18" fill="#64748b"/>
    <circle cx="478" cy="248" r="18" fill="#64748b"/>
    <text x="58" y="76" fill="#93c5fd" font-family="Arial, sans-serif" font-size="20" font-weight="700">FLIGHTDECK DEMO</text>
    <text x="58" y="306" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="25" font-weight="700">${safeLabel}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function _mediaUrl(url, label = 'Flightdeck demo', colour = '#3b82f6') {
  return FLIGHTDECK_DEMO ? _demoMediaUrl(url || label, colour) : url;
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
  const label = _printerSecondaryLabel(p);
  return label ? `<span class="${cls}" ${attrs} title="${esc(title)}">${esc(label)}</span>` : '';
}

function _printerPrimaryLabel(p) {
  return p?.custom_name || p?.shop_name || p?.model_name || p?.id || 'Printer';
}

function _printerSecondaryLabel(p) {
  const primary = _printerPrimaryLabel(p);
  const model = p?.model_name || '';
  if (model && model !== primary) return model;
  const kind = p?.kind || p?.connection?.type || '';
  if (kind && kind !== primary) return kind;
  return p?.id && p.id !== primary ? p.id : '';
}

function _bambuLightWordHtml(p) {
  const lightState = _effectiveLightState(p);
  const lit = lightState === 'on';
  return `<button class="bambu-light-control${lit ? ' bambu-light-on' : ''}"
    type="button"
    data-light-toggle="${p.id}"
    title="Bambu chamber light: ${esc(lightState)}">
      <span class="bambu-light-bulb" aria-hidden="true"></span>
      <span>Light</span>
    </button>`;
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

  _applyAppearanceSettings();
}

function _applyAppearanceSettings() {
  const accent = _serverSettings.accent ?? '#3b82f6';
  document.documentElement.style.setProperty('--printing', accent);
  document.documentElement.style.setProperty('--sidebar-text', _safeCssHex(_serverSettings.sidebar_text_color, '#8fa8c8'));
  document.documentElement.style.setProperty('--sidebar-width', `${_safeSidebarWidth(_serverSettings.sidebar_width_px)}px`);
  const bg = (_serverSettings.theme_background || 'classic').replace(/[^a-z0-9_-]/gi, '');
  document.documentElement.dataset.themeBg = bg || 'classic';
  if (bg === 'custom') {
    document.documentElement.style.setProperty('--bg', _safeCssHex(_serverSettings.theme_background_color, '#0a0a0f'));
  } else {
    document.documentElement.style.removeProperty('--bg');
  }
}

function _safeCssHex(value, fallback = '#8fa8c8') {
  const raw = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

function _safeSidebarWidth(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 220;
  return Math.max(180, Math.min(360, n));
}

function initSidebarResizer() {
  const handle = document.querySelector('.sidebar-resizer');
  if (!handle || handle.dataset.ready) return;
  handle.dataset.ready = 'true';

  let active = false;
  let width = _safeSidebarWidth(_serverSettings.sidebar_width_px);

  const setWidth = next => {
    width = _safeSidebarWidth(next);
    _serverSettings.sidebar_width_px = String(width);
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  };

  const finish = async () => {
    if (!active) return;
    active = false;
    document.body.classList.remove('sidebar-resizing');
    try {
      await _saveSetting('sidebar_width_px', width);
    } catch (err) {
      showToast('Sidebar width save failed', err.message || '', 'error');
    }
  };

  handle.addEventListener('pointerdown', e => {
    if (window.matchMedia('(max-width: 760px)').matches) return;
    active = true;
    handle.setPointerCapture?.(e.pointerId);
    document.body.classList.add('sidebar-resizing');
    setWidth(e.clientX);
    e.preventDefault();
  });

  handle.addEventListener('pointermove', e => {
    if (!active) return;
    setWidth(e.clientX);
  });

  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}

async function loadInstanceInfo() {
  try {
    const r = await fetch('/api/instance');
    if (r.ok) _instanceInfo = await r.json();
  } catch {}
}

function _footerInstanceText() {
  const parts = ['flightdeck'];
  if (_instanceInfo?.address) parts.push(_instanceInfo.address);
  if (_instanceInfo?.hardware) parts.push(`running on ${_instanceInfo.hardware}`);
  return parts.join(' · ');
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

function _setCameraReturnTarget(printerId, hash) {
  _cameraReturnTarget = { printerId: String(printerId || ''), hash };
  try { window.sessionStorage?.setItem('flightdeck.cameraReturnTarget', JSON.stringify(_cameraReturnTarget)); } catch {}
}

function _consumeCameraReturnTarget(printerId) {
  const wanted = String(printerId || '');
  let target = _cameraReturnTarget;
  if (!target) {
    try { target = JSON.parse(window.sessionStorage?.getItem('flightdeck.cameraReturnTarget') || 'null'); } catch {}
  }
  if (!target || target.printerId !== wanted || !target.hash) return '';
  _cameraReturnTarget = null;
  try { window.sessionStorage?.removeItem('flightdeck.cameraReturnTarget'); } catch {}
  return target.hash;
}


let _latestPrinters = [];
let _tabsBuilt = false;
let _missionRenderInFlight = false;
let _missionLastHtml = '';
const _cameraUrlCache = {};     // printer_id → url string or null
const _CAMERA_STREAM_REFRESH_MS = 120000;
let _renderedDetailId = null;
let _renderedDetailSubtab = null;
let _renderedDetailOk = false;
const _pendingControls = {};    // printer_id → { action, fromState }
const _lightOptimistic = {};    // printer_id → { state, expiresAt }
const _tempOptimistic = {};     // `${id}:${heater}` → { sentTarget, expiresAt }
const _objectsCache = {};       // printer_id → { supported, objects }
const _cameraUrlFetches = {};   // printer_id → in-flight camera URL fetch
const _historyYear = {};        // printer_id → selected year (int)
const _historyHeatmapMode = {}; // printer_id -> yearly | monthly | weekly
const _dayPrintsCache = {};     // `${printerId}:${dateStr}` → prints[]
let _camerasFull = false;       // true once cameras grid has been fully rendered
let _camerasMode = 'live';       // live | sim30
let _printWatchFocusIndex = 0;
let _printWatchTimer = null;
let _printWatchPinnedId = '';
let _printWatchManualPinnedId = '';
let _printWatchAutoPinPaused = false;
let _camZoom = 0;               // 0=normal, 1=wide, 2=fullscreen
let _cameraReturnTarget = null; // { printerId, hash } when Fleet Wall opened Live camera
let _onSettings = false;        // true while settings view is active
let _onFailures = false;        // true while failure review is active
let _onSpools = false;          // true while spool inventory is active
let _onMemory = false;          // true while Print Memory is active
let _onManual = false;          // true while flight manual is active
let _onDemo = false;            // true while demo mode is active
let _renderedSpoolDetailId = null;
let _lastSpoolsRouteKey = '';
let _lastMemoryRouteKey = '';

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

const _PRINT_MEMORY_TAGS = [
  'Flightdeck testing',
  'Calibration',
  'Prototype',
  'Customer job',
  'Maintenance',
  'First layer',
];
const _PRINT_MEMORY_TAG_MAX = 96;

function _normalisePrintTags(tags) {
  const seen = new Set();
  return (tags || [])
    .flatMap(tag => String(tag || '').split(','))
    .map(tag => tag.trim())
    .filter(tag => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
}

function _showPrintMemoryMetadataEditor(print, onSaved) {
  const currentTags = _normalisePrintTags(print.tags || []);
  const selected = new Set(currentTags.map(t => t.toLowerCase()));
  const customTags = currentTags
    .filter(tag => !_PRINT_MEMORY_TAGS.some(preset => preset.toLowerCase() === tag.toLowerCase()))
    .join(', ');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box note-editor-modal print-memory-editor">
      <div class="modal-message" style="margin-bottom:0.75rem">Print memory</div>
      <div class="memory-tag-grid">
        ${_PRINT_MEMORY_TAGS.map(tag => `
          <label class="memory-tag-choice">
            <input type="checkbox" value="${esc(tag)}"${selected.has(tag.toLowerCase()) ? ' checked' : ''}>
            <span>${esc(tag)}</span>
          </label>`).join('')}
      </div>
      <label class="memory-custom-label">Custom tags</label>
      <input class="memory-custom-tags" type="text" maxlength="${_PRINT_MEMORY_TAG_MAX}" placeholder="Comma separated" value="${esc(customTags)}">
      <label class="memory-exclude-choice">
        <input type="checkbox" class="memory-exclude-input"${print.exclude_from_stats ? ' checked' : ''}>
        <span>Exclude from reliability stats</span>
      </label>
      <div class="modal-actions" style="margin-top:0.75rem">
        <button class="modal-btn" id="memory-meta-cancel">Cancel</button>
        <button class="modal-btn" id="memory-meta-save" style="background:rgba(30,80,30,0.4);border-color:#16a34a;color:#86efac">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#memory-meta-cancel').addEventListener('click', close);
  overlay.querySelector('#memory-meta-save').addEventListener('click', async () => {
    const presetTags = [...overlay.querySelectorAll('.memory-tag-choice input:checked')].map(el => el.value);
    const custom = overlay.querySelector('.memory-custom-tags')?.value || '';
    const tags = _normalisePrintTags([...presetTags, custom]);
    const exclude_from_stats = !!overlay.querySelector('.memory-exclude-input')?.checked;
    try {
      const r = await fetch(`/api/print-memory/${print.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, exclude_from_stats }),
      });
      if (!r.ok) throw new Error('Unable to save print memory');
      const saved = await r.json();
      close();
      if (onSaved) onSaved(saved);
    } catch (err) {
      showToast('Print memory not saved', err.message || '', 'error');
    }
  });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
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

function _confirmModal(message) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="modal-message">${esc(message)}</div>
        <div class="modal-actions">
          <button class="modal-btn" data-confirm-no>Cancel</button>
          <button class="modal-btn modal-btn-danger" data-confirm-yes>Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = result => { overlay.remove(); resolve(result); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false); });
    overlay.querySelector('[data-confirm-no]').addEventListener('click', () => close(false));
    overlay.querySelector('[data-confirm-yes]').addEventListener('click', () => close(true));
  });
}

function _inputModal({ title, message = '', value = '', placeholder = '', inputType = 'text', okLabel = 'Save' }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box input-modal">
        <div class="modal-message">${esc(title)}</div>
        ${message ? `<div class="modal-submessage">${esc(message)}</div>` : ''}
        <input class="modal-input" type="${esc(inputType)}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}">
        <div class="modal-actions">
          <button class="modal-btn" data-input-cancel>Cancel</button>
          <button class="modal-btn modal-btn-danger" data-input-ok>${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.modal-input');
    const close = result => { overlay.remove(); resolve(result); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.querySelector('[data-input-cancel]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-input-ok]').addEventListener('click', () => close(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') close(input.value);
      if (e.key === 'Escape') close(null);
    });
    input.focus();
    input.select();
  });
}

function _textareaModal({ title, message = '', value = '', placeholder = '', okLabel = 'Save' }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box input-modal">
        <div class="modal-message">${esc(title)}</div>
        ${message ? `<div class="modal-submessage">${esc(message)}</div>` : ''}
        <textarea class="note-textarea" rows="5" placeholder="${esc(placeholder)}">${esc(value ?? '')}</textarea>
        <div class="modal-actions">
          <button class="modal-btn" data-input-cancel>Cancel</button>
          <button class="modal-btn modal-btn-danger" data-input-ok>${esc(okLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('.note-textarea');
    const close = result => { overlay.remove(); resolve(result); };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });
    overlay.querySelector('[data-input-cancel]').addEventListener('click', () => close(null));
    overlay.querySelector('[data-input-ok]').addEventListener('click', () => close(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) close(input.value);
    });
    input.focus();
    input.select();
  });
}

// ── Command palette ───────────────────────────────────────────────────────

let _commandPalette = null;

function _commandNavigate(hash, after = null) {
  if (location.hash === hash) router();
  else location.hash = hash;
  if (after) setTimeout(after, 120);
}

function _commandSpoolTitle(s) {
  const name = [s.color_name, s.material, s.subtype].filter(Boolean).join(' ');
  const brand = s.brand ? ` · ${s.brand}` : '';
  return `Spool #${s.id} · ${name || 'Filament'}${brand}`;
}

function _commandSpoolMeta(s) {
  const grams = Number(s.remaining_g ?? 0);
  const where = s.location_printer_id
    ? `${_printerNavLabel(_latestPrinters.find(p => p.id === s.location_printer_id) || { id: s.location_printer_id })}${s.location_slot ? ` · ${s.location_slot}` : ''}`
    : (s.storage_location_name || 'Shelved');
  return `${Math.round(grams)}g · ${where}`;
}

async function _commandEnsureSpools() {
  if (_allSpools?.length) return;
  _allSpools = await fetch('/api/spools').then(r => r.ok ? r.json() : []).catch(() => []);
}

async function _commandOpenSpoolEditor(spoolId) {
  await _commandEnsureSpools();
  const spool = _allSpools.find(s => String(s.id) === String(spoolId));
  if (!spool) throw new Error(`Spool #${spoolId} not found`);
  const costs = await fetch('/api/filament/costs').then(r => r.json()).catch(() => []);
  _openSpoolModal(costs, _refreshSpoolsSurface, spool);
}

async function _commandOpenSpoolActions(spoolId) {
  await _commandEnsureSpools();
  const spool = _allSpools.find(s => String(s.id) === String(spoolId));
  if (!spool) throw new Error(`Spool #${spoolId} not found`);
  if (!location.hash.startsWith('#/spools')) _commandNavigate('#/spools');
  setTimeout(() => {
    const host = document.getElementById('spools-content') || document.body;
    _openSpoolActionModal(spoolId, host, _refreshSpoolsSurface);
  }, 180);
}

function _commandItem({
  label,
  meta = '',
  group = 'General',
  keywords = '',
  run,
  cluster = '',
  clusterLabel = '',
  clusterMeta = '',
  actionLabel = '',
}) {
  return {
    label,
    meta,
    group,
    cluster,
    clusterLabel,
    clusterMeta,
    actionLabel: actionLabel || label,
    keywords: `${label} ${meta} ${group} ${clusterLabel} ${clusterMeta} ${keywords}`.toLowerCase(),
    run,
  };
}

function _commandStaticItems() {
  const nav = [
    ['Dashboard', '#/', 'Overview and printer cards'],
    ['Fleet Wall', '#/fleet', 'Shop-floor camera and printer wall'],
    ['Flight Tower', '#/mission', 'Dispatch and queue intelligence'],
    ['Telemetry', '#/stats', 'Stats, RH, utilisation'],
    ['Queue', '#/queue', 'Pending print jobs'],
    ['Global Print Bay', '#/files', 'Files, printer storage, and reprint staging'],
    ['Spools', '#/spools', 'Spool inventory'],
    ['Demo Mode', '#/demo', 'Guided first-look tour for testers'],
    ['Flight Manual', '#/manual', 'Setup, recovery, Bambu and demo notes'],
    ['Settings', '#/settings', 'Configuration'],
  ].map(([label, hash, meta]) => _commandItem({
    label: `Go to ${label}`,
    meta,
    group: 'Navigate',
    keywords: hash,
    run: () => _commandNavigate(hash),
  }));

  const spoolViews = [
    _commandItem({
      label: 'Open spool cabinet',
      meta: 'Shelf view',
      group: 'Spools',
      keywords: 'cabinet shelves locations',
      run: () => {
        _spoolsViewMode = 'cabinet';
        _commandNavigate('#/spools', () => { if (location.hash === '#/spools') renderSpoolsView(); });
      },
    }),
    _commandItem({
      label: 'Open filament catalogue',
      meta: 'Materials, brands, costs and tare weights',
      group: 'Spools',
      keywords: 'filament catalogue cost material brand tare',
      run: () => _commandNavigate('#/spools?view=catalogue'),
    }),
    _commandItem({
      label: 'Show low stock spools',
      meta: 'Inventory below threshold',
      group: 'Spools',
      keywords: 'filament low remaining',
      run: () => _commandNavigate('#/spools?filter=low'),
    }),
    _commandItem({
      label: 'Show loaded spools',
      meta: 'Currently in printers',
      group: 'Spools',
      keywords: 'ams slots loaded filament',
      run: () => _commandNavigate('#/spools?filter=loaded'),
    }),
    _commandItem({
      label: 'Add spool',
      meta: 'Create and label a new roll',
      group: 'Spools',
      keywords: 'new filament roll inventory',
      run: async () => {
        _commandNavigate('#/spools');
        const costs = await fetch('/api/filament/costs').then(r => r.json()).catch(() => []);
        setTimeout(() => _openSpoolModal(costs, _refreshSpoolsSurface), 160);
      },
    }),
  ];

  const settings = ['Printers', 'Hardware', 'Appearance', 'Slicer', 'Locations'].map(label => {
    const id = label.toLowerCase();
    return _commandItem({
      label: `Settings: ${label}`,
      meta: 'Configuration',
      group: 'Settings',
      keywords: id,
      run: () => _commandNavigate(`#/settings/${id}`),
    });
  });

  return [...nav, ...spoolViews, ...settings];
}

function _commandPrinterItems() {
  return (_latestPrinters || []).flatMap(p => {
    const name = _printerNavLabel(p);
    return [
      _commandItem({
        label: `Open ${name}`,
        meta: `${p.model_name || p.kind || 'Printer'} · Live`,
        group: 'Printers',
        keywords: `${p.id} ${p.custom_name || ''} ${p.shop_name || ''}`,
        run: () => _commandNavigate(`#/printer/${p.id}`),
      }),
      _commandItem({
        label: `${name} history`,
        meta: 'Finished prints',
        group: 'Printers',
        keywords: `${p.id} prints calendar`,
        run: () => _commandNavigate(`#/printer/${p.id}/history`),
      }),
      _commandItem({
        label: `${name} maintenance`,
        meta: 'Service schedule',
        group: 'Printers',
        keywords: `${p.id} service tasks`,
        run: () => _commandNavigate(`#/printer/${p.id}/maintenance`),
      }),
      _commandItem({
        label: `${name} lights`,
        meta: p.kind === 'bambu' ? 'Open live light control' : 'Open live LED controls',
        group: 'Printers',
        keywords: `${p.id} light lights led bambu chamber`,
        run: () => _commandNavigate(`#/printer/${p.id}`),
      }),
    ];
  });
}

function _commandSpoolItems() {
  return (_allSpools || [])
    .filter(s => !s.archived_at)
    .flatMap(s => {
      const spoolWords = `${s.id} ${s.material || ''} ${s.subtype || ''} ${s.brand || ''} ${s.color_name || ''} ${s.color_hex || ''}`;
      const cluster = `spool:${s.id}`;
      const clusterLabel = _commandSpoolTitle(s);
      const clusterMeta = _commandSpoolMeta(s);
      return [
        _commandItem({
          label: _commandSpoolTitle(s),
          meta: clusterMeta,
          group: 'Spools',
          keywords: spoolWords,
          cluster,
          clusterLabel,
          clusterMeta,
          actionLabel: 'Open',
          run: () => _commandNavigate(`#/spool/${s.id}`),
        }),
        _commandItem({
          label: `Edit spool #${s.id}`,
          meta: [s.color_name, s.material, s.brand].filter(Boolean).join(' · '),
          group: 'Spool actions',
          keywords: `${spoolWords} edit change update tare weight colour color`,
          cluster,
          clusterLabel,
          clusterMeta,
          actionLabel: 'Edit',
          run: () => _commandOpenSpoolEditor(s.id),
        }),
        _commandItem({
          label: `Actions for spool #${s.id}`,
          meta: 'Label, weigh, copy, reset, archive',
          group: 'Spool actions',
          keywords: `${spoolWords} action actions label print weigh weight copy reset archive delete`,
          cluster,
          clusterLabel,
          clusterMeta,
          actionLabel: 'Actions',
          run: () => _commandOpenSpoolActions(s.id),
        }),
      ];
    });
}

function _commandAllItems() {
  return [
    ..._commandStaticItems(),
    ..._commandPrinterItems(),
    ..._commandSpoolItems(),
  ];
}

function _commandScore(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const hay = item.keywords;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.every(t => hay.includes(t))) return 0;
  let score = 10;
  if (item.label.toLowerCase().startsWith(q)) score += 8;
  if (item.label.toLowerCase().includes(q)) score += 4;
  score += Math.max(0, 3 - item.group.length / 10);
  return score;
}

function _commandGroupedRows(items) {
  const used = new Set();
  const rows = [];
  items.forEach((item, index) => {
    if (used.has(index)) return;
    if (!item.cluster) {
      rows.push({ type: 'item', item, index });
      return;
    }
    const matches = items
      .map((candidate, candidateIndex) => ({ item: candidate, index: candidateIndex }))
      .filter(candidate => candidate.item.cluster === item.cluster);
    if (matches.length < 2) {
      rows.push({ type: 'item', item, index });
      return;
    }
    matches.forEach(match => used.add(match.index));
    rows.push({
      type: 'cluster',
      label: item.clusterLabel || item.label,
      meta: item.clusterMeta || item.meta,
      group: item.group === 'Spool actions' ? 'Spool' : item.group,
      items: matches,
    });
  });
  return rows;
}

function _commandRender() {
  if (!_commandPalette) return;
  const q = _commandPalette.input.value || '';
  const all = _commandAllItems();
  const ranked = q.trim()
    ? all
      .map(item => ({ item, score: _commandScore(item, q) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score || a.item.group.localeCompare(b.item.group) || a.item.label.localeCompare(b.item.label))
      .slice(0, 12)
      .map(x => x.item)
    : all.slice(0, 12);
  _commandPalette.items = ranked;
  _commandPalette.selected = Math.min(_commandPalette.selected, Math.max(0, ranked.length - 1));
  const rows = _commandGroupedRows(ranked);
  _commandPalette.list.innerHTML = rows.length
    ? rows.map(row => row.type === 'cluster'
      ? `<div class="command-group-card">
          <div class="command-group-head">
            <span class="command-item-main">
              <strong>${esc(row.label)}</strong>
              <small>${esc(row.meta)}</small>
            </span>
            <span class="command-item-group">${esc(row.group)}</span>
          </div>
          <div class="command-group-actions">
            ${row.items.map(({ item, index }) => `
              <button class="command-mini-action${index === _commandPalette.selected ? ' active' : ''}" data-command-index="${index}" type="button">
                ${esc(item.actionLabel)}
              </button>`).join('')}
          </div>
        </div>`
      : `
        <button class="command-item${row.index === _commandPalette.selected ? ' active' : ''}" data-command-index="${row.index}" type="button">
          <span class="command-item-main">
            <strong>${esc(row.item.label)}</strong>
            <small>${esc(row.item.meta)}</small>
          </span>
          <span class="command-item-group">${esc(row.item.group)}</span>
        </button>`).join('')
    : `<div class="command-empty">No matching commands.</div>`;
}

async function _commandWarmData() {
  const needsSpools = !_allSpools?.length;
  const needsPrinters = !_latestPrinters?.length;
  await Promise.all([
    needsPrinters ? fetch('/api/printers').then(r => r.ok ? r.json() : []).then(p => { _latestPrinters = p; }).catch(() => {}) : Promise.resolve(),
    needsSpools ? fetch('/api/spools').then(r => r.ok ? r.json() : []).then(s => { _allSpools = s; }).catch(() => {}) : Promise.resolve(),
  ]);
}

function _closeCommandPalette() {
  if (!_commandPalette) return;
  _commandPalette.overlay.remove();
  _commandPalette = null;
}

async function _runCommandPaletteItem(item) {
  if (!item) return;
  _closeCommandPalette();
  try {
    await item.run();
  } catch (err) {
    showToast('Command failed', err.message || '', 'error');
  }
}

async function openCommandPalette() {
  if (_commandPalette) {
    _commandPalette.input.focus();
    _commandPalette.input.select();
    return;
  }

  const overlay = document.createElement('div');
  overlay.className = 'command-overlay';
  overlay.innerHTML = `
    <div class="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
      <div class="command-head">
        <div>
          <strong>Command</strong>
          <span>Jump anywhere in Flightdeck</span>
        </div>
        <kbd>Esc</kbd>
      </div>
      <input class="command-input" type="search" autocomplete="off" spellcheck="false" placeholder="Search printers, spools, pages...">
      <div class="command-list"></div>
      <div class="command-foot">
        <span><kbd>Enter</kbd> run</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
        <span><kbd>Ctrl</kbd><kbd>K</kbd> open</span>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  _commandPalette = {
    overlay,
    input: overlay.querySelector('.command-input'),
    list: overlay.querySelector('.command-list'),
    items: [],
    selected: 0,
  };

  overlay.addEventListener('click', e => { if (e.target === overlay) _closeCommandPalette(); });
  _commandPalette.input.addEventListener('input', () => {
    _commandPalette.selected = 0;
    _commandRender();
  });
  _commandPalette.input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      _closeCommandPalette();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      _commandPalette.selected = Math.min(_commandPalette.selected + 1, _commandPalette.items.length - 1);
      _commandRender();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _commandPalette.selected = Math.max(_commandPalette.selected - 1, 0);
      _commandRender();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      _runCommandPaletteItem(_commandPalette.items[_commandPalette.selected]);
    }
  });
  _commandPalette.list.addEventListener('mousemove', e => {
    const btn = e.target.closest('[data-command-index]');
    if (!btn) return;
    _commandPalette.selected = Number(btn.dataset.commandIndex);
    _commandRender();
  });
  _commandPalette.list.addEventListener('click', e => {
    const btn = e.target.closest('[data-command-index]');
    if (!btn) return;
    _runCommandPaletteItem(_commandPalette.items[Number(btn.dataset.commandIndex)]);
  });

  _commandRender();
  _commandPalette.input.focus();
  await _commandWarmData();
  _commandRender();
}

document.getElementById('command-btn')?.addEventListener('click', openCommandPalette);

function formatTime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}


// ── Event wiring ───────────────────────────────────────────────────────────

function attachCardEvents(card) {
  card.addEventListener('click', e => {
    if (e.target.closest('a, button, select, input, textarea')) return;
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
  const body = document.querySelector('.detail-body');
  if (document.fullscreenElement?.classList?.contains('camera-hero')) {
    _camZoom = 2;
    body?.classList.remove('cam-wide');
  } else if (_camZoom === 2) {
    _camZoom = 0;
    body?.classList.remove('cam-wide');
  }
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    openCommandPalette();
    return;
  }
  if (e.key !== 'Escape') return;
  if (_commandPalette) { _closeCommandPalette(); return; }
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

function _healthIsActionable(health) {
  return (health?.reasons || []).some(r => {
    const msg = String(r.message || '').toLowerCase();
    return msg.includes('maintenance due') || msg.includes('failed queue');
  });
}

function _healthBadgeClass(health) {
  if (!health) return '';
  if (health.status === 'healthy') return 'health-healthy';
  return _healthIsActionable(health) ? `health-${health.status}` : 'health-review';
}

function _healthBadgeLabel(health) {
  if (!health) return '';
  if (health.status === 'healthy') return 'Healthy';
  return _healthIsActionable(health) ? health.label : 'Reliability';
}

function _healthBadge(health, printerId = '') {
  if (!health) return '';
  if (!_healthIsActionable(health)) return '';
  const href = `#/printer/${encodeURIComponent(printerId)}/failures`;
  return `<a class="health-badge ${_healthBadgeClass(health)}" href="${href}" title="${esc((health.reasons || []).map(r => r.message).join(' · ') || health.label)}">${_healthBadgeLabel(health)}</a>`;
}

function _healthLine(health, printerId = '') {
  if (!health?.reasons?.length) return '';
  const label = _healthIsActionable(health) ? 'Action' : 'Reliability';
  const href = `#/printer/${encodeURIComponent(printerId)}/failures`;
  return `<a class="health-line${_healthIsActionable(health) ? ' health-line-action' : ''}" href="${href}">
    <span>${label}</span>
    <strong>${esc(health.reasons[0].message)}</strong>
  </a>`;
}

function _printerPrintLocked(p) {
  return !!p && (p.print_enabled ?? true) === false;
}

function _printerLockoutReason(p) {
  return String(p?.print_enabled_note || '').trim() || 'No reason entered';
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
  if (_printerPrintLocked(p)) rank = Math.min(rank, 2);
  if (_healthIsActionable(p.health) && p.health?.status === 'attention') rank = Math.min(rank, 1);
  if (_healthIsActionable(p.health) && p.health?.status === 'watch') rank = Math.min(rank, 2);
  return rank;
}

function _dashboardPrinterName(p) {
  return _printerNavLabel(p);
}

function _printerNavLabel(p) {
  return _printerPrimaryLabel(p);
}

function _printerProgressBadge(p) {
  const state = String(p?.state || '').toLowerCase();
  if (!['printing', 'paused'].includes(state)) return '';
  return p?.job?.progress != null ? `${Math.round(p.job.progress * 100)}%` : '';
}

function _activePrinterJob(p) {
  const state = String(p?.state || '').toLowerCase();
  return ['printing', 'paused'].includes(state) ? p?.job || null : null;
}

function _dashboardIssueText(p) {
  if (_printerPrintLocked(p)) return `Dispatch locked: ${_printerLockoutReason(p)}`;
  if (p.state === 'estop') return 'Emergency stop active';
  if (p.state === 'error') return p.error || 'Printer error';
  if (p.state === 'paused') return p.error || 'Paused mid-print';
  if (p.health?.reasons?.length) return p.health.reasons[0].message;
  if (p.state === 'offline') return `Offline ${fmtLastSeen(p.last_seen)}`;
  if (p.state === 'printing') {
    const pct = p.job?.progress != null ? `${Math.round(p.job.progress * 100)}%` : 'active';
    return `Printing ${pct}`;
  }
  return p.state || 'idle';
}

function _printerWarningTarget(p) {
  if (!p) return null;
  const loaded = _latestSpoolsByPrinter[p.id] || [];
  const amsWarning = _amsMismatchSignals(p, loaded)[0];
  if (amsWarning?.slotIndex != null) {
    return {
      type: 'slot',
      printerId: p.id,
      slotIndex: Number(amsWarning.slotIndex),
      slotLabel: amsWarning.slotLabel || `S${Number(amsWarning.slotIndex) + 1}`,
      title: amsWarning.title || amsWarning.label,
    };
  }
  if (_healthIsActionable(p.health)) {
    return {
      type: 'hash',
      hash: `#/printer/${encodeURIComponent(p.id)}/failures`,
      title: p.health?.reasons?.[0]?.message || 'Open printer attention',
    };
  }
  if (_printerPrintLocked(p)) {
    return {
      type: 'hash',
      hash: `#/printer/${encodeURIComponent(p.id)}`,
      title: _dashboardIssueText(p),
    };
  }
  if (p.state === 'offline' || p.state === 'error' || p.state === 'estop' || p.state === 'paused') {
    return {
      type: 'hash',
      hash: `#/printer/${encodeURIComponent(p.id)}`,
      title: _dashboardIssueText(p),
    };
  }
  return null;
}

function _firstWarningTarget(printers) {
  return [...(printers || [])]
    .sort((a, b) => _dashboardStateRank(a) - _dashboardStateRank(b) || _dashboardPrinterName(a).localeCompare(_dashboardPrinterName(b)))
    .map(_printerWarningTarget)
    .find(Boolean) || null;
}

function _warningTargetAttrs(target) {
  if (!target) return '';
  if (target.type === 'slot') {
    return ` data-warning-target="slot" data-printer-id="${esc(target.printerId)}" data-slot-index="${Number(target.slotIndex)}" data-slot-label="${esc(target.slotLabel)}" title="${esc(target.title || 'Open AMS slot warning')}"`;
  }
  if (target.type === 'hash') {
    return ` data-warning-target="hash" data-hash="${esc(target.hash)}" title="${esc(target.title || 'Open warning')}"`;
  }
  return '';
}

function _dashboardBriefingTone(p) {
  if (!p) return 'info';
  if (p.state === 'error' || p.state === 'estop' || (_healthIsActionable(p.health) && p.health?.status === 'attention')) return 'critical';
  if (_printerPrintLocked(p) || p.state === 'paused' || p.state === 'offline' || (_healthIsActionable(p.health) && p.health?.status === 'watch')) return 'warn';
  if (p.state === 'printing') return 'ok';
  return 'info';
}

function _dashboardBriefingRow(row) {
  const attrs = row.target ? _warningTargetAttrs(row.target) : '';
  const content = `
    <span class="briefing-row-kicker">${esc(row.kicker)}</span>
    <span class="briefing-row-main">
      <strong>${esc(row.title)}</strong>
      <small>${esc(row.detail || '')}</small>
    </span>`;
  if (row.target?.type === 'slot') {
    return `<button class="briefing-row briefing-${row.tone || 'info'}"${attrs}>${content}</button>`;
  }
  if (row.href || row.target?.hash) {
    return `<a class="briefing-row briefing-${row.tone || 'info'}" href="${esc(row.target?.hash || row.href)}"${attrs}>${content}</a>`;
  }
  return `<div class="briefing-row briefing-${row.tone || 'info'}">${content}</div>`;
}

function _dashboardLoadedLowRows(printers) {
  const printerById = Object.fromEntries((printers || []).map(p => [p.id, p]));
  return Object.entries(_latestSpoolsByPrinter || {})
    .flatMap(([printerId, spools]) => (spools || []).map(s => ({ printerId, spool: s })))
    .filter(({ spool }) => !spool.archived_at && Number(spool.label_weight_g || 0) > 0)
    .map(({ printerId, spool }) => {
      const pct = Math.round(Number(spool.remaining_g || 0) * 100 / Number(spool.label_weight_g || 1));
      return { printerId, spool, pct };
    })
    .filter(x => x.pct < _latestLowStockPct)
    .sort((a, b) => a.pct - b.pct || Number(a.spool.remaining_g || 0) - Number(b.spool.remaining_g || 0))
    .slice(0, 3)
    .map(({ printerId, spool, pct }) => {
      const p = printerById[printerId];
      const where = p
        ? `${_dashboardPrinterName(p)} · ${spool.location_slot != null ? _amsSlotLabel(p, Number(spool.location_slot)) : 'loaded'}`
        : 'Loaded';
      const title = `#${spool.id} ${spool.color_name || spool.material || 'spool'}`;
      const detail = `${where} · ${Math.round(Number(spool.remaining_g || 0))}g · ${pct}%`;
      return {
        tone: 'warn',
        kicker: 'Spool watch',
        title,
        detail,
        href: `#/spool/${spool.id}`,
      };
    });
}

function _renderDashboardBriefing(printers) {
  const rows = [];
  const sorted = [...(printers || [])].sort((a, b) =>
    _dashboardStateRank(a) - _dashboardStateRank(b) ||
    _dashboardPrinterName(a).localeCompare(_dashboardPrinterName(b))
  );

  sorted.forEach(p => {
    const target = _printerWarningTarget(p);
    if (!target) return;
    rows.push({
      tone: _dashboardBriefingTone(p),
      kicker: _printerPrintLocked(p) ? 'Locked' : p.state === 'offline' ? 'Signal' : p.state === 'paused' ? 'Paused' : 'Watch',
      title: _dashboardPrinterName(p),
      detail: _dashboardIssueText(p),
      target,
      href: target.hash || `#/printer/${encodeURIComponent(p.id)}`,
    });
  });

  sorted
    .filter(p => p.state === 'printing' || p.state === 'paused')
    .forEach(p => {
      const activeJob = _activePrinterJob(p);
      const job = activeJob ? jobDisplayName(activeJob) : _dashboardIssueText(p);
      const pct = activeJob?.progress != null ? `${Math.round(activeJob.progress * 100)}%` : p.state;
      rows.push({
        tone: p.state === 'paused' ? 'warn' : 'ok',
        kicker: p.state === 'paused' ? 'Hold' : 'In flight',
        title: _dashboardPrinterName(p),
        detail: `${job} · ${pct}`,
        href: `#/printer/${encodeURIComponent(p.id)}`,
      });
    });

  rows.push(..._dashboardLoadedLowRows(sorted));

  const unique = [];
  const seen = new Set();
  rows.forEach(row => {
    const key = `${row.kicker}:${row.title}:${row.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(row);
  });

  const calm = !unique.length;
  const body = calm
    ? `<div class="briefing-clear">
        <strong>Clear skies</strong>
        <span>No active printer faults, AMS profile warnings, or loaded spool risks.</span>
      </div>`
    : unique.slice(0, 6).map(_dashboardBriefingRow).join('');

  return `<section class="dashboard-briefing" aria-label="Flight briefing">
    <div class="briefing-head">
      <div>
        <span>Flight Briefing</span>
        <strong>${calm ? 'Nothing urgent on deck' : 'Operator handover'}</strong>
      </div>
      <a href="#/mission">Flight Tower</a>
    </div>
    <div class="briefing-list">${body}</div>
  </section>`;
}

function _renderDashboardOverview(printers) {
  const counts = printers.reduce((acc, p) => {
    acc[p.state] = (acc[p.state] || 0) + 1;
    if (_printerPrintLocked(p)) acc.locked += 1;
    if (_healthIsActionable(p.health)) acc.health += 1;
    else if (p.health?.status === 'attention' || p.health?.status === 'watch') acc.review += 1;
    return acc;
  }, { health: 0, review: 0, locked: 0 });
  const printing = counts.printing || 0;
  const paused = counts.paused || 0;
  const hardStops = (counts.error || 0) + (counts.estop || 0);
  const offline = counts.offline || 0;
  const attention = printers
    .filter(p => _printerPrintLocked(p) || ['estop', 'error', 'paused', 'offline'].includes(p.state) || _healthIsActionable(p.health))
    .sort((a, b) => _dashboardStateRank(a) - _dashboardStateRank(b) || _dashboardPrinterName(a).localeCompare(_dashboardPrinterName(b)))
    .slice(0, 5);

  const attentionHtml = attention.length ? attention.map(p => {
    const severity = p.state === 'error' || p.state === 'estop' || (_healthIsActionable(p.health) && p.health?.status === 'attention')
      ? 'critical'
      : _printerPrintLocked(p) || p.state === 'paused' || (_healthIsActionable(p.health) && p.health?.status === 'watch')
        ? 'warn'
        : 'muted';
    const href = _healthIsActionable(p.health) ? `#/printer/${encodeURIComponent(p.id)}/failures` : `#/printer/${encodeURIComponent(p.id)}`;
    const target = _printerWarningTarget(p);
    if (target?.type === 'slot') {
      return `<button class="dash-attention-item dash-attention-${severity} dash-attention-button"${_warningTargetAttrs(target)}>
        <span class="dash-attention-name">${esc(_dashboardPrinterName(p))}</span>
        <span class="dash-attention-text">${esc(_dashboardIssueText(p))}</span>
      </button>`;
    }
    return `<a class="dash-attention-item dash-attention-${severity}" href="${target?.hash || href}"${target ? _warningTargetAttrs(target) : ''}>
      <span class="dash-attention-name">${esc(_dashboardPrinterName(p))}</span>
      <span class="dash-attention-text">${esc(_dashboardIssueText(p))}</span>
    </a>`;
  }).join('') : `
    <div class="dash-attention-empty">
      <span>All printers clear</span>
      <span>No active faults, blocked queues, or overdue maintenance</span>
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
        <div class="dash-kpi ${counts.review ? 'dash-kpi-warn' : ''}">
          <span class="dash-kpi-value">${counts.review}</span>
          <span class="dash-kpi-label">Review</span>
        </div>
        <div class="dash-kpi ${counts.locked ? 'dash-kpi-warn' : ''}">
          <span class="dash-kpi-value">${counts.locked}</span>
          <span class="dash-kpi-label">Locked</span>
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
  const badgeLabel = _printerDisplayStateLabel(p);
  const badgeClass = _printerDisplayStateClass(p);

  // Loaded spools panel
  const loadedSpools = (_latestSpoolsByPrinter[p.id] || []).filter(s => !s.archived_at);
  const lowStockPct = _latestLowStockPct;
  const healthBadge = _healthBadge(p.health, p.id);
  const healthLine = _healthLine(p.health, p.id);
  const lockoutLine = _printerPrintLocked(p) ? `
    <a class="printer-lockout-line" href="#/printer/${encodeURIComponent(p.id)}">
      <span>Dispatch locked</span>
      <strong>${esc(_printerLockoutReason(p))}</strong>
    </a>` : '';

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
          <span class="spool-loaded-swatch" style="${_spoolColorStyle(s)};color:${tc}" title="${s.color_name||s.color_hex||''}"></span>
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
            <span class="printer-custom">${esc(_printerPrimaryLabel(p))}</span>
            ${_printerModelHtml(p)}
          </div>
        </div>
        <div class="card-badges">
          ${healthBadge}
          <span class="badge badge-${badgeClass}">${badgeLabel}</span>
        </div>
      </div>
      ${temps ? `<div class="temps">${temps}</div>` : ''}
      ${body}
      ${idleRows}
      ${error}
      ${lockoutLine}
      ${healthLine}
      ${loadedPanel}
    </div>`;
}

function _renderAddPrinterCard(empty = false) {
  if (empty) {
    return `<section class="dashboard-first-run">
      <div>
        <span>First run</span>
        <strong>Add your first printer</strong>
        <p>Connect a Bambu, Moonraker/Klipper, or simulated printer to start building live status, history, queue, and spool tracking.</p>
      </div>
      <a class="dashboard-add-printer-primary" href="#/settings/printers">Add Printer</a>
    </section>`;
  }
  return `<a class="card dashboard-add-printer-card" href="#/settings/printers" aria-label="Add another printer">
    <span class="dashboard-add-plus">+</span>
    <strong>Add Printer</strong>
    <small>Keep existing metrics by editing printers when only an IP changes.</small>
  </a>`;
}

// ── Header status pill ─────────────────────────────────────────────────────

function updateStatusPill(printers) {
  const pill = document.getElementById('status-pill');
  if (!pill || !printers.length) return;
  const faults   = printers.filter(p => p.state === 'error').length;
  const warnings = printers.filter(p =>
    p.state === 'paused' ||
    p.state === 'offline' ||
    (_printerWarningTarget(p) && p.state !== 'error' && p.state !== 'estop')
  ).length;
  const target = faults || warnings ? _firstWarningTarget(printers) : null;
  ['warningTarget', 'printerId', 'slotIndex', 'slotLabel', 'hash'].forEach(k => delete pill.dataset[k]);
  pill.removeAttribute('title');
  pill.removeAttribute('role');
  pill.removeAttribute('tabindex');
  if (target) {
    pill.dataset.warningTarget = target.type;
    pill.title = target.title || 'Open warning';
    pill.setAttribute('role', 'button');
    pill.setAttribute('tabindex', '0');
    if (target.type === 'slot') {
      pill.dataset.printerId = target.printerId;
      pill.dataset.slotIndex = String(target.slotIndex);
      pill.dataset.slotLabel = target.slotLabel;
    } else if (target.type === 'hash') {
      pill.dataset.hash = target.hash;
    }
  }
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
    dot.className = 'live-radar live-ok';
    text.textContent = 'Live';
  } else {
    dot.className = 'live-radar live-err';
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
  const pauseResumeAction = p.state === 'paused' ? 'resume' : 'pause';
  const pauseResumeLabel = p.state === 'paused' ? 'Resume' : 'Pause';

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
      ${btn(pauseResumeAction, pauseResumeLabel)}
      ${btn('cancel', 'Cancel')}
    </div>
    <div class="controls-destructive">
      ${btn('estop', '⚠ E-Stop', 'ctrl-btn-estop')}
      ${firmwareRestartBtn}
    </div>`;
}

function _detailTransportControls(id, p) {
  const pending = _pendingControls[id];
  const pauseResumeAction = p.state === 'paused' ? 'resume' : 'pause';
  const pauseResumeIcon = p.state === 'paused' ? '▶' : 'Ⅱ';
  const pauseResumeLabel = p.state === 'paused' ? 'Resume' : 'Pause';
  const pauseResumeClass = p.state === 'paused' ? 'transport-play' : '';
  const transportButton = (action, icon, label, cls = '') => {
    const canDo = _canDo(p.state, action);
    const isPending = pending?.action === action;
    const disabled = !canDo || (pending && !isPending) ? ' disabled' : '';
    const loadingCls = isPending ? ' ctrl-loading' : '';
    return `<button class="transport-btn ${cls}${loadingCls}" data-action="${action}" data-printer-id="${id}" title="${esc(label)}"${disabled}>
      <span aria-hidden="true">${isPending ? '...' : icon}</span>
      <em>${esc(label)}</em>
    </button>`;
  };
  const lightControl = p.kind === 'bambu'
    ? _bambuLightWordHtml(p)
    : p.kind === 'moonraker'
      ? `<div class="transport-bars">
          ${transportButton('light_on', '☀', 'Bars on', 'transport-light')}
          ${transportButton('light_off', '☾', 'Bars off', 'transport-light')}
        </div>`
      : '';
  const firmwareRestartBtn = p.kind === 'moonraker' && _canDo(p.state, 'firmware_restart')
    ? transportButton('firmware_restart', '↻', 'Firmware restart', 'transport-warn')
    : '';
  return `<div class="live-transport detail-controls-wrap" aria-label="Printer transport controls">
    ${lightControl}
    <div class="transport-deck">
      ${transportButton(pauseResumeAction, pauseResumeIcon, pauseResumeLabel, pauseResumeClass)}
      ${transportButton('cancel', '■', 'Cancel')}
      ${transportButton('estop', '!', 'E-stop', 'transport-estop')}
      ${firmwareRestartBtn}
    </div>
  </div>`;
}

function _preheatPresets(p) {
  const presets = p.temperature_presets || {};
  const hotend = Object.fromEntries((presets.hotend || []).map(row => [row.label, row.value]));
  const bed = Object.fromEntries((presets.bed || []).map(row => [row.label, row.value]));
  return Object.keys(hotend)
    .filter(label => bed[label] != null)
    .slice(0, 5)
    .map(label => ({ label, hotend: Number(hotend[label]), bed: Number(bed[label]) }))
    .filter(row => Number.isFinite(row.hotend) && Number.isFinite(row.bed));
}

function _detailLiveOps(p) {
  const canPreheat = !['offline', 'printing', 'error', 'estop'].includes(p.state || '');
  const isMoonraker = p.kind === 'moonraker';
  const isBambu = p.kind === 'bambu';
  const canFan = (isMoonraker || isBambu) && !['offline', 'error', 'estop'].includes(p.state || '');
  const canJog = (isMoonraker || isBambu) && !['offline', 'printing', 'finished', 'error', 'estop'].includes(p.state || '');
  const canHome = (isMoonraker || isBambu) && !['offline', 'printing', 'paused', 'finished', 'error', 'estop'].includes(p.state || '');
  const presets = _preheatPresets(p);
  const preheatButtons = presets.map(row => `<button class="live-op-btn" type="button"
      data-preheat data-printer-id="${esc(p.id)}" data-material="${esc(row.label)}"
      data-hotend="${row.hotend}" data-bed="${row.bed}" ${canPreheat ? '' : 'disabled'}>
      <span>${esc(row.label)}</span><small>${row.hotend}/${row.bed}°</small>
    </button>`).join('');
  const cooldown = `<button class="live-op-btn live-op-muted" type="button"
      data-preheat data-printer-id="${esc(p.id)}" data-material="Cooldown"
      data-hotend="0" data-bed="0" ${canPreheat ? '' : 'disabled'}>
      <span>Cool</span><small>0/0°</small>
    </button>`;
  const klipper = p.kind === 'moonraker' && p.klipper_ui_url
    ? `<a class="live-op-btn live-op-link" href="${esc(p.klipper_ui_url)}" target="_blank" rel="noreferrer">
        <span>Klipper</span><small>Mainsail / Fluidd</small>
      </a>`
    : '';
  const fanChannels = isBambu
    ? [['part', 'Part'], ['aux', 'Aux'], ['chamber', 'Chamber']]
    : isMoonraker
      ? [['part', 'Fan']]
      : [];
  const fan = fanChannels.length
    ? `<div class="live-op-group" aria-label="Part cooling fan">
        ${fanChannels.map(([channel, label]) => {
          const raw = p.fan_speeds?.[channel] ?? (channel === 'part' ? p.fan_speed : null);
          const pct = Number.isFinite(Number(raw)) ? Math.round(Number(raw) * 100) : null;
          const value = pct == null ? 0 : Math.max(0, Math.min(100, pct));
          const roundedValue = Math.round(value / 10) * 10;
          const datalistId = `fan-ticks-${esc(p.id)}-${esc(channel)}`;
          return `<div class="live-op-fan-row">
            <span class="live-op-group-label">${esc(label)}</span>
            <label class="live-op-slider ${roundedValue > 0 ? 'live-op-slider-on' : 'live-op-slider-off'}" title="${esc(label)} fan fine control">
              <input type="range" min="0" max="100" step="10" value="${roundedValue}" list="${datalistId}" data-fan-slider data-fan-channel="${esc(channel)}" data-printer-id="${esc(p.id)}" ${canFan ? '' : 'disabled'}>
              <datalist id="${datalistId}">
                ${[0,10,20,30,40,50,60,70,80,90,100].map(speed => `<option value="${speed}"></option>`).join('')}
              </datalist>
            </label>
            <span class="live-op-fan-value">${pct == null ? '--' : `${roundedValue}%`}</span>
          </div>`;
        }).join('')}
      </div>`
    : '';
  const pos = Array.isArray(p.toolhead_position) ? p.toolhead_position.map(v => Number(v)) : [];
  const posParts = ['X', 'Y', 'Z'].map((axis, idx) => Number.isFinite(pos[idx]) ? `${axis}${pos[idx].toFixed(idx === 2 ? 1 : 0)}` : `${axis}--`);
  const posLabel = posParts.join(' ');
  const jog = (isMoonraker || isBambu)
    ? `<div class="live-op-group live-op-jog" aria-label="XYZ movement">
        <span class="live-op-group-label">Jog ${esc(posLabel)}</span>
        <div class="jog-pad" aria-label="XY jog controls">
          <span></span>
          <button class="live-op-btn live-op-mini jog-btn" type="button" data-jog-axis="y" data-jog-distance="10" data-printer-id="${esc(p.id)}" ${canJog ? '' : 'disabled'}>
            <span>Y+</span><small>10</small>
          </button>
          <span></span>
          <button class="live-op-btn live-op-mini jog-btn" type="button" data-jog-axis="x" data-jog-distance="-10" data-printer-id="${esc(p.id)}" ${canJog ? '' : 'disabled'}>
            <span>X-</span><small>10</small>
          </button>
          <button class="live-op-btn live-op-mini jog-btn jog-home-center" type="button" data-home-axes="xy" data-printer-id="${esc(p.id)}" ${isMoonraker && canHome ? '' : 'disabled'}>
            <span>XY</span><small>${isMoonraker ? 'home' : '--'}</small>
          </button>
          <button class="live-op-btn live-op-mini jog-btn" type="button" data-jog-axis="x" data-jog-distance="10" data-printer-id="${esc(p.id)}" ${canJog ? '' : 'disabled'}>
            <span>X+</span><small>10</small>
          </button>
          <span></span>
          <button class="live-op-btn live-op-mini jog-btn" type="button" data-jog-axis="y" data-jog-distance="-10" data-printer-id="${esc(p.id)}" ${canJog ? '' : 'disabled'}>
            <span>Y-</span><small>10</small>
          </button>
          <span></span>
        </div>
        <div class="jog-z-stack" aria-label="Z jog controls">
          <button class="live-op-btn live-op-mini jog-btn" type="button" data-jog-axis="z" data-jog-distance="1" data-printer-id="${esc(p.id)}" ${canJog ? '' : 'disabled'}>
            <span>Z+</span><small>1</small>
          </button>
          <button class="live-op-btn live-op-mini jog-btn" type="button" data-jog-axis="z" data-jog-distance="-1" data-printer-id="${esc(p.id)}" ${canJog ? '' : 'disabled'}>
            <span>Z-</span><small>1</small>
          </button>
        </div>
      </div>`
    : '';
  const homeAxes = isBambu ? [['all', 'All']] : isMoonraker ? [['xy', 'XY'], ['z', 'Z'], ['all', 'All']] : [];
  const home = homeAxes.length
    ? `<div class="live-op-group" aria-label="Homing controls">
        <span class="live-op-group-label">Home</span>
        ${homeAxes.map(([axes, label]) => `<button class="live-op-btn live-op-mini" type="button"
          data-home-axes="${axes}" data-printer-id="${esc(p.id)}" ${canHome ? '' : 'disabled'}>
          <span>${label}</span><small>G28</small>
        </button>`).join('')}
      </div>`
    : '';
  const controls = [preheatButtons, presets.length ? cooldown : '', fan, jog, home, klipper].filter(Boolean).join('');
  if (!controls) return '';
  return `<div class="live-op-row" aria-label="Live printer shortcuts">${controls}</div>`;
}

function _updateControlsWidget(id) {
  const p = _latestPrinters.find(x => x.id === id);
  const el = document.querySelector('.detail-controls-wrap');
  if (el && p) el.outerHTML = _detailTransportControls(id, p);
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
    pause:            'Pause this print?',
    resume:           'Resume this print?',
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

document.getElementById('view-printer').addEventListener('change', async e => {
  const liveToggle = e.target.closest('[data-live-print-enabled]');
  if (!liveToggle) return;
  await _handlePrinterPrintEnabledToggle(liveToggle);
});

document.addEventListener('click', e => {
  const lightToggle = e.target.closest('[data-light-toggle]');
  if (!lightToggle) return;
  e.preventDefault();
  e.stopPropagation();
  toggleBambuLight(lightToggle.dataset.lightToggle);
}, true);

document.addEventListener('click', e => {
  const printWatchPin = e.target.closest('[data-print-watch-pin]');
  if (printWatchPin) {
    e.preventDefault();
    e.stopPropagation();
    _togglePrintWatchPin(printWatchPin.dataset.printerId);
    return;
  }

  const fleetLive = e.target.closest('[data-fleet-live]');
  if (fleetLive) {
    e.preventDefault();
    e.stopPropagation();
    _setCameraReturnTarget(fleetLive.dataset.fleetLive, '#/fleet');
    location.hash = `#/printer/${encodeURIComponent(fleetLive.dataset.fleetLive)}?from=fleet`;
    return;
  }

  const target = e.target.closest('[data-warning-target], [data-slot-edit]');
  if (!target) return;
  if (target.dataset.warningTarget === 'hash') {
    e.preventDefault();
    e.stopPropagation();
    if (target.dataset.hash) location.hash = target.dataset.hash;
    return;
  }
  if (target.dataset.warningTarget === 'slot' || target.dataset.slotEdit !== undefined) {
    e.preventDefault();
    e.stopPropagation();
    _openSlotEditor(
      target.dataset.printerId,
      Number(target.dataset.slotIndex),
      target.dataset.slotLabel || `S${Number(target.dataset.slotIndex) + 1}`
    );
  }
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
    sendTempSet(id, heater, tempAction === 'dec' ? Math.max(0, current - 5) : current + 5)
      .catch(err => showToast('Temperature command failed', err.message || '', 'error'));
    return;
  }

  const preheatBtn = e.target.closest('[data-preheat]');
  if (preheatBtn && !preheatBtn.disabled) {
    const id = preheatBtn.dataset.printerId;
    const material = preheatBtn.dataset.material || 'Preheat';
    const hotend = Number(preheatBtn.dataset.hotend || 0);
    const bed = Number(preheatBtn.dataset.bed || 0);
    const old = preheatBtn.innerHTML;
    preheatBtn.disabled = true;
    preheatBtn.innerHTML = `<span>Sending</span><small>${hotend}/${bed}°</small>`;
    Promise.all([
      sendTempSet(id, 'hotend', hotend),
      sendTempSet(id, 'bed', bed),
    ]).then(() => {
      showToast(material === 'Cooldown' ? 'Cooldown sent' : `${material} preheat sent`, `Hotend ${hotend}° · Bed ${bed}°`, 'success');
    }).catch(err => {
      showToast('Preheat failed', err.message || '', 'error');
    }).finally(() => {
      preheatBtn.disabled = false;
      preheatBtn.innerHTML = old;
    });
    return;
  }

  const fanBtn = e.target.closest('[data-fan-speed]');
  if (fanBtn && !fanBtn.disabled) {
    const id = fanBtn.dataset.printerId;
    const speed = Number(fanBtn.dataset.fanSpeed || 0);
    const channel = fanBtn.dataset.fanChannel || 'part';
    const old = fanBtn.innerHTML;
    fanBtn.disabled = true;
    fanBtn.innerHTML = `<span>Sending</span><small>${speed}%</small>`;
    sendFanSet(id, speed, channel)
      .then(() => showToast('Fan command sent', `${speed}% ${channel} fan`, 'success'))
      .catch(err => showToast('Fan command failed', err.message || '', 'error'))
      .finally(() => {
        fanBtn.disabled = false;
        fanBtn.innerHTML = old;
      });
    return;
  }

  const jogBtn = e.target.closest('[data-jog-axis], [data-jog-z]');
  if (jogBtn && !jogBtn.disabled) {
    const id = jogBtn.dataset.printerId;
    const axis = (jogBtn.dataset.jogAxis || 'z').toUpperCase();
    const distance = Number(jogBtn.dataset.jogDistance ?? jogBtn.dataset.jogZ ?? 0);
    const old = jogBtn.innerHTML;
    jogBtn.disabled = true;
    jogBtn.innerHTML = `<span>Moving</span><small>${axis} ${distance > 0 ? '+' : ''}${distance}</small>`;
    sendJog(id, axis, distance)
      .then(() => showToast(`${axis} jog sent`, `${distance > 0 ? '+' : ''}${distance}mm`, 'success'))
      .catch(err => showToast(`${axis} jog failed`, err.message || '', 'error'))
      .finally(() => {
        jogBtn.disabled = false;
        jogBtn.innerHTML = old;
      });
    return;
  }

  const homeBtn = e.target.closest('[data-home-axes]');
  if (homeBtn && !homeBtn.disabled) {
    const id = homeBtn.dataset.printerId;
    const axes = homeBtn.dataset.homeAxes || 'all';
    const label = axes === 'all' ? 'all axes' : axes.toUpperCase();
    _modal.show(`Home ${label}? The printer will move to its endstops.`, () => {
      const old = homeBtn.innerHTML;
      homeBtn.disabled = true;
      homeBtn.innerHTML = `<span>Homing</span><small>${esc(label)}</small>`;
      sendHomeAxes(id, axes)
        .then(() => showToast('Home command sent', label, 'success'))
        .catch(err => showToast('Home failed', err.message || '', 'error'))
        .finally(() => {
          homeBtn.disabled = false;
          homeBtn.innerHTML = old;
        });
    });
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

document.getElementById('view-printer').addEventListener('change', e => {
  const slider = e.target.closest('[data-fan-slider]');
  if (!slider || slider.disabled) return;
  const id = slider.dataset.printerId;
  const speed = Number(slider.value || 0);
  const channel = slider.dataset.fanChannel || 'part';
  sendFanSet(id, speed, channel)
    .then(() => showToast('Fan command sent', `${speed}% ${channel} fan`, 'success'))
    .catch(err => showToast('Fan command failed', err.message || '', 'error'));
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
      .catch(err => showToast('AMS drying command failed', err.message || '', 'error'))
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

// ── Flight Manual ─────────────────────────────────────────────────────────

function _manualCheck(label, ok, detail = '') {
  const cls = ok ? 'manual-check-ok' : 'manual-check-watch';
  return `<div class="manual-check ${cls}">
    <span>${ok ? 'Ready' : 'Check'}</span>
    <strong>${esc(label)}</strong>
    ${detail ? `<small>${esc(detail)}</small>` : ''}
  </div>`;
}

function _manualSection(title, body, items = []) {
  return `<section class="manual-card">
    <div class="manual-card-head">
      <span>${esc(title)}</span>
    </div>
    ${body ? `<p>${body}</p>` : ''}
    ${items.length ? `<div class="manual-list">${items.map(item => `<div>${item}</div>`).join('')}</div>` : ''}
  </section>`;
}

async function renderManualView() {
  const el = document.getElementById('manual-page');
  if (!el) return;
  el.innerHTML = `<div class="detail-placeholder" style="min-height:40vh">Loading flight manual...</div>`;
  const [instance, health, printers] = await Promise.all([
    fetch('/api/instance').then(r => r.ok ? r.json() : (_instanceInfo || {})).catch(() => (_instanceInfo || {})),
    fetch('/api/setup/health').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('/api/printers').then(r => r.ok ? r.json() : (_latestPrinters || [])).catch(() => (_latestPrinters || [])),
  ]);
  if (instance?.app) _instanceInfo = instance;
  const checks = health?.checks || [];
  const checkMap = Object.fromEntries(checks.map(c => [c.id, c]));
  const cameraWorkers = instance.camera_workers || {};
  const host = instance.host || {};
  const memoryPct = host.memory?.pct;
  const diskPct = host.disk?.pct;
  const printerCount = printers.length || _latestPrinters.length || 0;
  const onlineCount = (printers || []).filter(p => p.state !== 'offline').length;
  const readyChecks = [
    _manualCheck('Printer fleet', printerCount > 0, `${printerCount} configured - ${onlineCount} online`),
    _manualCheck('Runtime host', !!instance.hardware, [instance.hardware, instance.runtime].filter(Boolean).join(' - ')),
    _manualCheck('Memory headroom', !(Number(memoryPct) >= 85), memoryPct != null ? `${Math.round(memoryPct)}% used` : 'unavailable'),
    _manualCheck('Data disk', !(Number(diskPct) >= 90), diskPct != null ? `${Math.round(diskPct)}% used` : 'unavailable'),
    _manualCheck('Camera workers', cameraWorkers.ok !== false, cameraWorkers.detail || 'not checked'),
    _manualCheck('Print Vault', checkMap.print_library?.ok !== false, checkMap.print_library?.detail || 'configured in Settings'),
  ].join('');

  el.innerHTML = `<div class="manual-page">
    <section class="manual-hero">
      <div>
        <div class="mission-eyebrow">Flight Manual</div>
        <h1>Operator handbook</h1>
        <p>Quick rules, recovery steps, and demo notes for running Flightdeck without needing the whole backstory.</p>
      </div>
      <div class="manual-hero-actions">
        <a href="#/demo">Demo Mode</a>
        <a href="#/settings/setup">Setup Health</a>
        <a href="#/stats">Telemetry</a>
      </div>
    </section>

    <section class="manual-ready">
      <div class="manual-card-head"><span>Demo Readiness</span></div>
      <div class="manual-check-grid">${readyChecks}</div>
    </section>

    <section class="manual-grid">
      ${_manualSection('First Tester Path', 'When Flightdeck is new to someone, start with the safe tour before touching real printer controls.', [
        '<strong>Demo Mode</strong><span>Use the guided tour to show Dashboard, Flight Tower, Live printer pages, Spools, Print Bay, and Maintenance in the right order.</span>',
        '<strong>Setup Health</strong><span>Confirm required checks first, then treat optional scale, label, backup, and vault items as upgrades rather than blockers.</span>',
        '<strong>One printer first</strong><span>Add or test one printer, browse read-only pages, then move on to queue, file, AMS, and hardware actions.</span>',
      ])}
      ${_manualSection('Daily Flow', 'The normal shop rhythm is simple: check Dashboard, watch Flight Tower, then use each printer page for live control and history.', [
        '<strong>Dashboard</strong><span>Use it for fleet state, reliability hints, loaded filament, and quick camera access.</span>',
        '<strong>Flight Tower</strong><span>Queue intelligence tells you what can dispatch now, what is blocked, and what spool or printer needs attention.</span>',
        '<strong>Printer pages</strong><span>Live, Print Bay, History, Failures, and Maintenance stay together per printer.</span>',
      ])}
      ${_manualSection('Warnings And Attention', 'Warnings should take the operator to the source, not just announce that something is wrong.', [
        '<strong>Top warning pill</strong><span>Click the orange or red status pill to open the highest-priority active warning.</span>',
        '<strong>Flight Briefing</strong><span>Rows on the dashboard point to the printer, spool, failure list, or exact AMS slot that needs eyes.</span>',
        '<strong>AMS Profile Doctor</strong><span>AMS profile mismatch warnings open the slot editor so Trust Flightdeck, Trust Printer, Load, or Return home are right there.</span>',
        '<strong>Clear skies</strong><span>No active faults, AMS profile warnings, or loaded-spool risks are currently asking for action.</span>',
        '<strong>Cancelled is not failed</strong><span>Operator-cancelled prints stay in history without counting as reliability failures.</span>',
      ])}
      ${_manualSection('Bambu Multi-Colour Rules', 'Most multi-colour failures come from slicer grouping or AMS profile mismatch rather than the model itself.', [
        '<strong>Group nozzles deliberately</strong><span>On H2D, confirm left and right nozzle grouping before sending a multi-material print.</span>',
        '<strong>Match material, colour, and brand intent</strong><span>Flightdeck can trust its spool assignment or trust the printer report from the AMS slot editor.</span>',
        '<strong>Use AMS Profile Doctor</strong><span>If the printer says Generic but Flightdeck knows the real roll, use Trust Flightdeck to push the profile back to AMS.</span>',
      ])}
      ${_manualSection('Spools And Labels', 'The scale and Brother QL-700 are optional, but they turn the inventory into something much harder to lie to.', [
        '<strong>Weigh after weird prints</strong><span>Use reconcile when purge, multi-spool usage, or printer reports do not line up cleanly.</span>',
        '<strong>Trust confidence</strong><span>Verified means weighed; estimated means model deductions have been applied since the last weigh-in.</span>',
        '<strong>Labels carry identity</strong><span>Spool number, material, colour name, colour code, and location print where useful.</span>',
      ])}
      ${_manualSection('Spool Return Memory', 'Flightdeck remembers where rolls live so loading and unloading stays natural, even when Bambu RFID reports a roll before you manually assign it.', [
        '<strong>Home shelf</strong><span>When a spool moves from a shelf into AMS/MMU, Flightdeck keeps that shelf as its home unless you deliberately return it somewhere else.</span>',
        '<strong>Auto-return</strong><span>If a printer later reports the slot empty, Flightdeck returns the stale assignment to the remembered home shelf.</span>',
        '<strong>RFID auto-claim</strong><span>When Bambu reports a loaded roll and Flightdeck has a strong shelved match, it can claim the right spool back into that AMS slot and logs the move.</span>',
      ])}
      ${_manualSection('Recovery', 'When something feels off, recover the smallest piece first. Full restarts are there, but not always the first move.', [
        '<strong>Camera pressure</strong><span>Run scripts/clear-camera-workers.sh if camera workers climb above expected count.</span>',
        '<strong>App restart</strong><span>Use scripts/safe-restart-flightdeck.sh when the service is wedged or after system updates.</span>',
        '<strong>Backup path</strong><span>Use scripts/backup-flightdeck-data.sh before risky upgrades or Pi/NAS migration work.</span>',
      ])}
      ${_manualSection('Maintenance', 'Maintenance is per-printer, not generic. Bambu care hours and manual tasks live together so reminders stay grounded in real usage.', [
        '<strong>Bambu care feed</strong><span>Flightdeck reads printer maintenance counters where available and keeps model-specific wording.</span>',
        '<strong>Voron tasks</strong><span>Voron maintenance tracks the Vivid/MMU path and manual service schedule separately from Bambu rules.</span>',
        '<strong>Telemetry</strong><span>Printer hours, print count, RH, and host health belong on Telemetry for the long view.</span>',
      ])}
      ${_manualSection('Tester Notes', 'For a demo or friend testing pass, give them these rails so they can explore without breaking the story.', [
        '<strong>Try read-only first</strong><span>Dashboard, Fleet Wall, Telemetry, History, Failures, and Flight Manual are safe places to browse.</span>',
        '<strong>Ask before destructive controls</strong><span>Cancel, E-stop, SD cleanup, delete, and archive actions should be deliberate.</span>',
        '<strong>Report exact screen</strong><span>When something looks wrong, note the page name, printer, and whether the printer screen agrees.</span>',
      ])}
    </section>
  </div>`;
}

// ── Demo Mode ─────────────────────────────────────────────────────────────

function _demoMetric(label, value, detail = '', tone = '') {
  return `<div class="demo-metric ${tone}">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
    ${detail ? `<small>${esc(detail)}</small>` : ''}
  </div>`;
}

function _demoStep(n, title, route, body, bullets = []) {
  return `<a class="demo-step" href="${esc(route)}">
    <div class="demo-step-num">${n}</div>
    <div>
      <strong>${esc(title)}</strong>
      <p>${esc(body)}</p>
      ${bullets.length ? `<div class="demo-step-points">${bullets.map(b => `<span>${esc(b)}</span>`).join('')}</div>` : ''}
    </div>
  </a>`;
}

function _demoPrinterCard(p) {
  const route = `#/printer/${p.id}`;
  const bayRoute = `${route}/bay`;
  const failuresRoute = `${route}/failures`;
  const state = _printerDisplayStateLabel(p);
  const stateClass = _printerDisplayStateClass(p);
  const loaded = (_latestSpoolsByPrinter[p.id] || []).filter(s => !s.archived_at);
  const loadedCount = loaded.length;
  const signals = [];
  if (p.state === 'offline') signals.push(`offline ${fmtLastSeen(p.last_seen)}`);
  if (p.state === 'error' || p.state === 'estop') signals.push(p.error || 'fault active');
  if (p.state === 'paused') signals.push(p.error || 'paused print');
  if (p.health?.failures_14d) signals.push(`${p.health.failures_14d} failures in 14d`);
  if (loadedCount) signals.push(`${loadedCount} loaded spool${loadedCount === 1 ? '' : 's'}`);
  const signalText = signals.length ? signals.slice(0, 2).join(' - ') : 'ready for walkthrough';
  return `<article class="demo-printer-card">
    <div>
      <span class="badge badge-${esc(stateClass)}">${esc(state)}</span>
      <h3>${esc(_dashboardPrinterName(p))}</h3>
      <p>${esc(p.custom_name || p.shop_name || p.kind || '')}</p>
    </div>
    <small>${esc(signalText)}</small>
    <div class="demo-printer-actions">
      <a href="${esc(route)}">Live</a>
      <a href="${esc(bayRoute)}">Bay</a>
      <a href="${esc(failuresRoute)}">Failures</a>
    </div>
  </article>`;
}

async function renderDemoView() {
  const el = document.getElementById('demo-page');
  if (!el) return;
  const [instance, health, printers] = await Promise.all([
    fetch('/api/instance').then(r => r.ok ? r.json() : (_instanceInfo || {})).catch(() => (_instanceInfo || {})),
    fetch('/api/setup/health').then(r => r.ok ? r.json() : null).catch(() => null),
    fetch('/api/printers').then(r => r.ok ? r.json() : (_latestPrinters || [])).catch(() => (_latestPrinters || [])),
  ]);
  if (instance?.app) _instanceInfo = instance;
  const fleet = printers.length ? printers : _latestPrinters;
  const online = fleet.filter(p => p.state !== 'offline').length;
  const active = fleet.filter(p => ['printing', 'paused'].includes(p.state)).length;
  const faulted = fleet.filter(p => ['error', 'offline'].includes(p.state)).length;
  const checks = health?.checks || [];
  const requiredBad = checks.filter(c => c.required && !c.ok).length;
  const cameraWorkers = instance.camera_workers || {};
  const demoReady = requiredBad === 0 && cameraWorkers.ok !== false;
  const firstPrinter = fleet[0]?.id ? `#/printer/${fleet[0].id}` : '#/';
  const bambu = fleet.find(p => (p.kind || p.connection?.type) === 'bambu') || fleet[0];
  const bambuRoute = bambu?.id ? `#/printer/${bambu.id}` : firstPrinter;

  el.innerHTML = `<div class="demo-page">
    <section class="demo-hero">
      <div>
        <div class="mission-eyebrow">Demo Mode</div>
        <h1>Flightdeck first-look tour</h1>
        <p>A guided, low-risk path through the screens that make Flightdeck feel different: fleet awareness, dispatch intelligence, live printer control, spool truth, and recovery.</p>
      </div>
      <div class="demo-hero-status ${demoReady ? 'ready' : 'watch'}">
        <span>${demoReady ? 'Ready to show' : 'Check before demo'}</span>
        <strong>${online}/${fleet.length || 0}</strong>
        <small>printers online</small>
      </div>
    </section>

    <section class="demo-metrics">
      ${_demoMetric('Fleet', `${fleet.length || 0} printers`, `${online} online - ${active} active`, demoReady ? 'ok' : '')}
      ${_demoMetric('Host', instance.hardware || 'Unknown host', instance.runtime || 'runtime unknown', 'ok')}
      ${_demoMetric('Setup', requiredBad ? `${requiredBad} blockers` : 'Ready', health?.summary ? `${health.summary.required_ok}/${health.summary.required_total} required checks` : 'health unavailable', requiredBad ? 'warn' : 'ok')}
      ${_demoMetric('Cameras', cameraWorkers.ok === false ? 'Watch' : 'Ready', cameraWorkers.detail || 'workers normal', cameraWorkers.ok === false ? 'warn' : 'ok')}
      ${_demoMetric('Attention', faulted ? `${faulted} to explain` : 'Clear', faulted ? 'use it as a live recovery example' : 'no active fault story', faulted ? 'warn' : 'ok')}
    </section>

    <section class="demo-grid">
      <div class="demo-card demo-tour">
        <div class="manual-card-head"><span>Tour Path</span></div>
        ${_demoStep(1, 'Dashboard', '#/', 'Open with the fleet view. Show online state, loaded spools, reliability flags, and camera shortcuts.', ['fleet health', 'loaded filament', 'low-risk overview'])}
        ${_demoStep(2, 'Flight Tower', '#/mission', 'Show the advisory dispatcher: ready jobs, blocked jobs, and why Flightdeck recommends a printer.', ['dispatch intel', 'stock checks', 'operator notes'])}
        ${_demoStep(3, 'Live Printer', bambuRoute, 'Use one printer page to show the camera hero, status strip, print details, objects, and AMS/Vivid filament route.', ['live feed', 'filament route', 'pause/cancel/E-stop are guarded'])}
        ${_demoStep(4, 'Spools', '#/spools', 'Show the paint-chart inventory, weight confidence, labels, cabinet view, and multi-spool grouping.', ['scale-ready', 'label-ready', 'cabinet map'])}
        ${_demoStep(5, 'Print Bay', '#/files', 'Show printer storage, vault staging, compatible-printer badges, and safe queue actions.', ['SD cleanup', 'vault', 'bulk actions'])}
        ${_demoStep(6, 'Maintenance', `${bambuRoute}/maintenance`, 'Close with automatic care counters, manual schedules, and history tied to the printer.', ['Bambu care', 'manual tasks', 'service history'])}
      </div>

      <div class="demo-card">
        <div class="manual-card-head"><span>Talk Track</span></div>
        <div class="demo-script">
          <p><strong>Opening:</strong> Flightdeck is built for a mixed printer workshop, not just one brand. It keeps printers, filament, queue decisions, history, maintenance, and recovery in one cockpit.</p>
          <p><strong>Key difference:</strong> it does not just show status. It explains what is safe to run, which spool will be used, why a print is blocked, and what to check next.</p>
          <p><strong>Trust point:</strong> risky actions are deliberate, state is visible, and the system health panel tells you when the host is under pressure.</p>
        </div>
      </div>

      <div class="demo-card">
        <div class="manual-card-head"><span>Live Fleet Picks</span></div>
        <div class="demo-printer-list">
          ${fleet.length ? fleet.map(_demoPrinterCard).join('') : '<p class="muted">No printers configured yet.</p>'}
        </div>
      </div>

      <div class="demo-card">
        <div class="manual-card-head"><span>Do Not Demo First</span></div>
        <div class="demo-avoid">
          <span>Do not start with Settings unless someone asks install questions.</span>
          <span>Do not press E-stop, delete, archive, SD cleanup, or format actions during a casual walkthrough.</span>
          <span>Do not open all camera feeds on a small Pi while screen sharing unless host health looks comfortable.</span>
          <span>Do not explain every edge case. Show the daily workflow first, then go deeper.</span>
        </div>
      </div>
    </section>
  </div>`;
}

// ── Routing ────────────────────────────────────────────────────────────────

function parseRoute() {
  const hash = location.hash || '#/';
  const printerMatch = hash.match(/^#\/printer\/([^/?]+)(?:\/(bay|history|failures|maintenance))?(?:\?.*)?$/);
  if (printerMatch) return { view: 'printer', id: printerMatch[1], subtab: printerMatch[2] || 'live' };
  const spoolMatch = hash.match(/^#\/spool\/(\d+)/);
  if (spoolMatch) return { view: 'spool', id: parseInt(spoolMatch[1], 10) };
  if (hash === '#/mission' || hash.startsWith('#/mission?')) return { view: 'mission' };
  if (hash === '#/cameras' || hash.startsWith('#/cameras?')) return { view: 'fleet' };
  if (hash === '#/stats' || hash.startsWith('#/stats?')) return { view: 'stats' };
  if (hash === '#/queue') return { view: 'queue' };
  if (hash === '#/fleet') return { view: 'fleet' };
  if (hash === '#/files') return { view: 'files' };
  if (hash === '#/memory' || hash.startsWith('#/memory?')) return { view: 'memory' };
  if (hash === '#/failures' || hash.startsWith('#/failures?')) return { view: 'failures' };
  if (hash === '#/spools' || hash.startsWith('#/spools?')) return { view: 'spools' };
  if (hash === '#/demo') return { view: 'demo' };
  if (hash === '#/manual') return { view: 'manual' };
  const settingsMatch = hash.match(/^#\/settings\/([^/]+)/);
  if (settingsMatch?.[1] === 'spools') return { view: 'spools' };
  if (settingsMatch?.[1] === 'filament') return { view: 'spools', legacyFilament: true };
  if (settingsMatch) return { view: 'settings', category: settingsMatch[1] };
  if (hash === '#/settings') return { view: 'settings' };
  return { view: 'dashboard' };
}

function _routeParams(prefix) {
  const hash = location.hash || '';
  if (!hash.startsWith(prefix)) return new URLSearchParams();
  const qs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return new URLSearchParams(qs);
}

function _stopCameraImages(selector) {
  document.querySelectorAll(selector).forEach(img => {
    img.removeAttribute('src');
    img.dataset.stopped = '1';
  });
}

function router() {
  const route = parseRoute();
  if (route.legacyFilament) {
    _spoolsViewMode = 'catalogue';
    history.replaceState(null, '', '#/spools?view=catalogue');
  }
  const categoryBeforeRoute = _settingsCategory;
  if (route.view === 'settings' && route.category) {
    _settingsCategory = _SETTINGS_CATEGORIES.some(c => c.id === route.category)
      ? route.category
      : 'setup';
  }

  // Abort MJPEG streams when leaving their view — mobile browsers don't close
  // orphaned <img> connections automatically, which exhausts connection pool slots.
  if (route.view !== 'printer' || route.subtab !== 'live') _stopCameraImages('#detail-cam-img');
  if (route.view !== 'cameras') {
    _stopCameraImages('#cameras-grid img');
    _camerasFull = false;
    if (_printWatchTimer) {
      clearInterval(_printWatchTimer);
      _printWatchTimer = null;
    }
  }
  if (route.view !== 'fleet') {
    _stopCameraImages('#fleet-wall-page img');
    _fleetWallSignature = '';
  }
  const wasOnSettings = _onSettings;
  const wasOnFailures = _onFailures;
  const wasOnSpools = _onSpools;
  const wasOnMemory = _onMemory;
  const wasOnManual = _onManual;
  const wasOnDemo = _onDemo;
  const wasSpoolDetailId = _renderedSpoolDetailId;
  const spoolsRouteKey = route.view === 'spools' ? (location.hash || '#/spools') : '';
  const memoryRouteKey = route.view === 'memory' ? (location.hash || '#/memory') : '';
  _onSettings = route.view === 'settings';
  _onFailures = route.view === 'failures';
  _onSpools = route.view === 'spools';
  _onMemory = route.view === 'memory';
  _onManual = route.view === 'manual';
  _onDemo = route.view === 'demo';
  if (route.view !== 'spool') _renderedSpoolDetailId = null;

  document.getElementById('view-dashboard').hidden = route.view !== 'dashboard';
  document.getElementById('view-mission').hidden   = route.view !== 'mission';
  document.getElementById('view-fleet').hidden     = route.view !== 'fleet';
  document.getElementById('view-stats').hidden     = route.view !== 'stats';
  document.getElementById('view-printer').hidden   = route.view !== 'printer';
  document.getElementById('view-spool').hidden     = route.view !== 'spool';
  document.getElementById('view-cameras').hidden   = route.view !== 'cameras';
  document.getElementById('view-queue').hidden     = route.view !== 'queue';
  document.getElementById('view-files').hidden     = route.view !== 'files';
  document.getElementById('view-memory').hidden    = route.view !== 'memory';
  document.getElementById('view-failures').hidden  = route.view !== 'failures';
  document.getElementById('view-spools').hidden    = route.view !== 'spools';
  document.getElementById('view-settings').hidden  = route.view !== 'settings';
  document.getElementById('view-demo').hidden      = route.view !== 'demo';
  document.getElementById('view-manual').hidden    = route.view !== 'manual';

  document.querySelectorAll('#tab-strip .tab').forEach(tab => {
    const href = tab.getAttribute('href');
    const printerTabActive = route.view === 'printer' && href === `#/printer/${route.id}`;
    tab.classList.toggle('active',
      (route.view === 'dashboard' && href === '#/') ||
      (route.view === 'fleet'     && href === '#/fleet') ||
      (route.view === 'mission'   && href === '#/mission') ||
      (route.view === 'stats'     && href === '#/stats') ||
      printerTabActive ||
      (route.view === 'queue'    && href === '#/queue') ||
      (route.view === 'files'    && href === '#/files') ||
      (route.view === 'memory'   && href === '#/memory') ||
      (route.view === 'failures' && href === '#/failures') ||
      (route.view === 'spools'   && href === '#/spools') ||
      (route.view === 'demo'     && href === '#/demo') ||
      (route.view === 'manual'   && href === '#/manual') ||
      (route.view === 'settings' && (
        href === '#/settings' ||
        href === `#/settings/${_settingsCategory}` ||
        (href === '#/settings' && _settingsCategory === 'setup')
      ))
    );
  });

  if (route.view === 'printer') renderPrinterDetail(route.id, route.subtab);
  if (route.view === 'fleet') renderFleetWall();
  if (route.view === 'mission') renderMissionControl();
  if (route.view === 'stats') renderStatsView();
  if (route.view === 'spool' && wasSpoolDetailId !== route.id) {
    _renderedSpoolDetailId = route.id;
    renderSpoolDetail(route.id);
  }
  if (route.view === 'cameras') renderCamerasView();
  if (route.view === 'queue') renderQueueView();
  if (route.view === 'files' && !_fileDeskRenderInFlight) renderFileDeskView();
  if (route.view === 'memory' && (!wasOnMemory || _lastMemoryRouteKey !== memoryRouteKey)) {
    _lastMemoryRouteKey = memoryRouteKey;
    renderPrintMemoryView();
  }
  if (route.view === 'failures' && !wasOnFailures) renderFailuresView();
  if (route.view === 'spools' && (!wasOnSpools || _lastSpoolsRouteKey !== spoolsRouteKey)) {
    _lastSpoolsRouteKey = spoolsRouteKey;
    renderSpoolsView();
  }
  if (route.view !== 'spools') _lastSpoolsRouteKey = '';
  if (route.view !== 'memory') _lastMemoryRouteKey = '';
  if (route.view === 'settings' && (!wasOnSettings || categoryBeforeRoute !== _settingsCategory)) renderSettingsView();
  if (route.view === 'demo' && !wasOnDemo) renderDemoView();
  if (route.view === 'manual' && !wasOnManual) renderManualView();
}

function buildTabs(printers) {
  const nav = document.getElementById('tab-strip');
  const printerGroups = printers.map((p, i) => {
    const color = _PRINTER_ACCENT_PALETTE[i % _PRINTER_ACCENT_PALETTE.length];
    const label = _printerNavLabel(p);
    const subLabel = _printerSecondaryLabel(p);
    const state = p.state || 'unknown';
    const stateClass = _printerDisplayStateClass(p);
    const progress = _printerProgressBadge(p);
    return `<a class="tab tab-printer" href="#/printer/${p.id}" style="--tab-accent:${color}" title="${esc(label)} · ${esc(_printerDisplayStateLabel(p))}">
      <span class="tab-printer-state tab-printer-state-${esc(stateClass)}"></span>
      <span class="tab-printer-title">
        <span class="tab-printer-name">${esc(label)}</span>
        ${subLabel ? `<span class="tab-printer-sub">${esc(subLabel)}</span>` : ''}
      </span>
      ${progress ? `<span class="tab-printer-progress">${progress}</span>` : ''}
    </a>`;
  }).join('');
  nav.innerHTML = [
    `<a class="tab" href="#/">Dashboard</a>`,
    `<a class="tab" href="#/fleet">Fleet Wall</a>`,
    `<a class="tab" href="#/mission">Flight Tower</a>`,
    `<a class="tab" href="#/stats">Telemetry</a>`,
    `<div class="tab-section">Printers</div>`,
    printerGroups,
    `<div class="tab-section">Operations</div>`,
    `<a class="tab" href="#/queue">Queue</a>`,
    `<a class="tab" href="#/files">Global Print Bay</a>`,
    `<a class="tab" href="#/memory">Print Memory</a>`,
    `<a class="tab" href="#/spools">Spools</a>`,
    `<div class="tab-section">System</div>`,
    `<a class="tab" href="#/demo">Demo Mode</a>`,
    `<a class="tab" href="#/manual">Flight Manual</a>`,
    `<a class="tab" href="#/settings">Settings</a>`,
  ].join('');
  _tabsBuilt = true;
  router();
}

// ── Printer detail helpers ─────────────────────────────────────────────────

function _detailSubTabs(id, active) {
  return `<div class="detail-sub-tabs">
    <a class="sub-tab ${active === 'live' ? 'active' : ''}" href="#/printer/${id}">Live</a>
    <a class="sub-tab ${active === 'bay' ? 'active' : ''}" href="#/printer/${id}/bay">Print Bay</a>
    <a class="sub-tab ${active === 'history' ? 'active' : ''}" href="#/printer/${id}/history">History</a>
    <a class="sub-tab ${active === 'failures' ? 'active' : ''}" href="#/printer/${id}/failures">Failures</a>
    <a class="sub-tab ${active === 'maintenance' ? 'active' : ''}" href="#/printer/${id}/maintenance">Maintenance</a>
  </div>`;
}

function _liveStateLabel(state) {
  const labels = {
    estop: 'E-stop',
    error: 'Fault',
    paused: 'Paused',
    printing: 'Printing',
    finished: 'Complete',
    offline: 'Offline',
    idle: 'Idle',
  };
  return labels[state] || state || 'Unknown';
}

function _printerDisplayStateLabel(p) {
  return _printerPrintLocked(p) ? 'On hold' : _liveStateLabel(p?.state);
}

function _printerDisplayStateClass(p) {
  return _printerPrintLocked(p) ? 'hold' : (p?.state || 'idle');
}

function _liveEtaText(p) {
  const job = _activePrinterJob(p);
  if (!job?.eta_seconds) return 'ETA unknown';
  if (p.eta_calibration?.ratio != null) {
    return `Flightdeck ${formatEta(Math.round(job.eta_seconds * p.eta_calibration.ratio))}`;
  }
  return `Slicer ${formatEta(job.eta_seconds)}`;
}

function _detailLiveHeader(p, printerColor, bannerTextColor) {
  const stateLabel = _printerDisplayStateLabel(p);
  const stateClass = _printerDisplayStateClass(p);
  const primary = _printerPrimaryLabel(p);
  const secondary = _printerSecondaryLabel(p);
  const job = _activePrinterJob(p);
  const progress = job?.progress != null ? Math.round(job.progress * 100) : null;
  const jobName = job ? jobDisplayName(job) : (p.idle_info?.['Last print'] || 'Ready for the next job');
  const statusMeta = job
    ? [progress != null ? `${progress}%` : '', _liveEtaText(p)].filter(Boolean).join(' · ')
    : _dashboardIssueText(p);
  const signals = _detailLiveSignals(p);
  const disabledNote = (p.print_enabled ?? true) ? '' : (p.print_enabled_note || 'No reason entered');
  return `<div class="live-command-header" style="--tab-accent:${printerColor}">
    <div class="live-printer-mark" style="color:${bannerTextColor}">
      <span class="live-printer-name">${esc(primary)}</span>
      ${secondary ? `<span class="live-printer-shop">${esc(secondary)}</span>` : ''}
    </div>
    <div class="live-job-brief">
      <span class="live-job-kicker">${job ? 'Now printing' : 'Status'}</span>
      <strong title="${esc(job?.filename || jobName)}">${esc(jobName)}</strong>
      <small>${esc(statusMeta)}</small>
    </div>
    <div class="live-state-wrap">
      <span class="badge badge-${esc(stateClass)} live-state-badge">${esc(stateLabel)}</span>
      <label class="live-print-enabled">
        <input type="checkbox"
          data-live-print-enabled
          data-printer-id="${p.id}"
          data-printer-name="${esc(primary)}"
          data-print-note="${esc(p.print_enabled_note || '')}"
          ${p.print_enabled ?? true ? 'checked' : ''}>
        Print enabled
      </label>
    </div>
    ${_detailTransportControls(p.id, p)}
    ${_detailLiveOps(p)}
    ${disabledNote ? `<div class="live-lockout-note">
      <strong>Dispatch locked</strong>
      <span>${esc(disabledNote)}</span>
    </div>` : ''}
    ${signals ? `<div class="live-signal-row">${signals}</div>` : ''}
  </div>`;
}

function _detailLiveSignals(p) {
  const signals = [];
  if (p.state === 'estop') signals.push({ cls: 'danger', label: 'E-stop active' });
  else if (p.state === 'error') signals.push({ cls: 'danger', label: p.error || 'Printer fault' });
  else if (p.state === 'paused') signals.push({ cls: 'warn', label: p.error || 'Print paused' });
  else if (p.state === 'offline') signals.push({ cls: 'danger', label: `Offline ${fmtLastSeen(p.last_seen)}` });

  if (p.health?.reasons?.length) {
    const reason = p.health.reasons[0].message;
    signals.push({ cls: _healthIsActionable(p.health) ? 'warn' : 'info', label: reason });
  }

  const loaded = _latestSpoolsByPrinter[p.id] || [];
  const low = loaded
    .filter(s => s.label_weight_g > 0 && (Number(s.remaining_g || 0) / Number(s.label_weight_g || 1)) < 0.2)
    .slice(0, 3);
  low.forEach(s => signals.push({
    cls: 'warn',
    label: `Low spool #${s.id}: ${Math.round(Number(s.remaining_g || 0))}g`,
  }));

  signals.push(..._amsMismatchSignals(p, loaded));

  const unique = [];
  const seen = new Set();
  signals.forEach(signal => {
    const key = `${signal.cls}:${signal.label}:${signal.slotIndex ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(signal);
  });

  if (!unique.length) return `<span class="live-signal live-signal-ok">Clear skies</span>`;
  return unique.slice(0, 5).map(signal => {
    const title = signal.title || signal.label;
    if (signal.slotIndex != null) {
      return `<button class="live-signal live-signal-button live-signal-${signal.cls}"
        data-slot-edit data-printer-id="${esc(p.id)}" data-slot-index="${Number(signal.slotIndex)}"
        data-slot-label="${esc(signal.slotLabel || `S${Number(signal.slotIndex) + 1}`)}"
        title="${esc(title)}">${esc(signal.label)}</button>`;
    }
    return `<span class="live-signal live-signal-${signal.cls}" title="${esc(title)}">${esc(signal.label)}</span>`;
  }).join('');
}

function _amsMismatchSignals(p, loaded = []) {
  const mismatches = [];
  (p.ams || []).forEach(unit => (unit.slots || []).forEach(slot => {
    const flatSlot = _amsFlatSlot(unit, slot);
    const loadedSpool = loaded.find(s => Number(s.location_slot) === flatSlot);
    const mismatch = _slotMismatch(loadedSpool, slot);
    if (!mismatch) return;
    const slotLabel = _amsSlotLabel(p, flatSlot);
    mismatches.push({
      cls: 'warn',
      label: `${slotLabel} mismatch`,
      title: mismatch,
      slotIndex: flatSlot,
      slotLabel,
    });
  }));
  if (mismatches.length <= 1) return mismatches;
  return [{
    cls: 'warn',
    label: `${mismatches.length} AMS mismatches`,
    title: mismatches.map(m => `${m.slotLabel}: ${m.title}`).join(' · '),
    slotIndex: mismatches[0].slotIndex,
    slotLabel: mismatches[0].slotLabel,
  }];
}

function _detailLiveTempChips(p, limit = 4) {
  return Object.entries(p.temps || {})
    .sort(([a], [b]) => (_TEMP_SORT[a] ?? 99) - (_TEMP_SORT[b] ?? 99))
    .slice(0, limit)
    .map(([k, r]) => {
      const label = _TEMP_LABELS[k] ?? TEMP_LABELS[k] ?? k;
      const target = Number(r.target || 0) > 0 ? `/${_toDisplayTemp(r.target)}${_tempUnitLabel()}` : '';
      return `<span class="live-chip">
        <em>${esc(label)}</em>
        <strong class="${_tempClass(r.actual).trim()}">${_toDisplayTemp(r.actual)}${_tempUnitLabel()}${target}</strong>
      </span>`;
    }).join('');
}

function _detailLiveSpoolChips(p) {
  const spools = (_latestSpoolsByPrinter[p.id] || []).slice(0, 6);
  if (!spools.length) return '';
  return spools.map(s => {
    const pct = s.label_weight_g > 0 ? Math.round(Number(s.remaining_g || 0) * 100 / Number(s.label_weight_g || 1)) : 0;
    const cls = pct < 20 ? ' live-spool-row-low' : pct < 50 ? ' live-spool-row-warn' : '';
    const title = [s.color_name, s.material, s.brand].filter(Boolean).join(' · ') || `Spool #${s.id}`;
    const grams = Math.round(Number(s.remaining_g || 0));
    const total = Math.round(Number(s.label_weight_g || 0));
    const slot = s.location_slot != null ? _amsSlotLabel(p, Number(s.location_slot)) : (s.storage_location_name || 'Loaded');
    return `<a class="live-spool-row${cls}" href="#/spool/${s.id}">
      <span class="live-spool-swatch" style="${_spoolColorStyle(s)}"></span>
      <span class="live-spool-main">
        <strong>${esc(title)}</strong>
        <em>#${s.id} · ${esc(slot)} · ${grams}g${total ? ` of ${total}g` : ''}</em>
      </span>
      <span class="live-spool-meter"><b style="width:${Math.max(2, Math.min(100, pct))}%"></b></span>
      <span class="live-spool-pct">${pct}%</span>
    </a>`;
  }).join('');
}

function _detailLiveAmsRows(p) {
  if (!p.ams?.length) return '';
  return _detailLiveAmsLoadoutRows(p);
}

function _detailLiveAmsLoadoutRows(p) {
  const loaded = _latestSpoolsByPrinter[p.id] || [];
  const units = p.ams.map(unit => {
    const drying = !!unit.drying;
    const preset = unit.dry_setting || {};
    const dryTime = unit.dry_time ? formatEta(unit.dry_time * 60) : '';
    const meta = [
      unit.humidity != null ? `${unit.humidity}% RH` : '',
      unit.temperature != null ? `${Math.round(unit.temperature)}°` : '',
      preset.filament && preset.temperature > 0 ? `${preset.filament} ${preset.temperature}°` : '',
    ].filter(Boolean).join(' · ');
    const dryControl = unit.dry_capable
      ? `<button class="live-ams-dry${drying ? ' live-ams-dry-active' : ''}"
          data-ams-dry data-printer-id="${p.id}" data-ams-id="${unit.unit}" data-enabled="${drying ? 'false' : 'true'}"
          title="${drying ? 'Stop AMS drying' : 'Start AMS drying'}">${drying ? 'Stop' : 'Dry'}</button>`
      : '';
    const slots = (unit.slots || []).map(slot => {
      const flatSlot = _amsFlatSlot(unit, slot);
      const loadedSpool = loaded.find(s => Number(s.location_slot) === flatSlot);
      const mismatch = _slotMismatch(loadedSpool, slot);
      const routeActive = _slotRouteActive(p, unit, slot);
      const colour = loadedSpool?.color_hex || slot.color || '#111827';
      const pct = loadedSpool?.label_weight_g > 0
        ? Math.round(Number(loadedSpool.remaining_g || 0) * 100 / Number(loadedSpool.label_weight_g || 1))
        : null;
      const grams = loadedSpool ? Math.round(Number(loadedSpool.remaining_g || 0)) : null;
      const label = _amsSlotLabel(p, flatSlot);
      const stateLabel = loadedSpool
        ? (routeActive ? 'Feeding' : mismatch ? 'Review' : 'Ready')
        : (slot.empty ? 'Empty' : 'Unassigned');
      const title = [
        label,
        loadedSpool ? `#${loadedSpool.id} ${loadedSpool.color_name || ''} ${loadedSpool.material || ''}` : '',
        !slot.empty ? _slotProfileLabel(slot) : '',
        mismatch,
      ].filter(Boolean).join(' · ');
      return `<button class="ams-loadout-slot${slot.empty ? ' is-empty' : ''}${loadedSpool ? ' has-spool' : ''}${routeActive ? ' is-feeding' : ''}${mismatch ? ' has-warning' : ''}"
          style="--slot-colour:${colour};--slot-text:${_spoolTextColor(colour)}"
          data-slot-edit data-printer-id="${p.id}" data-slot-index="${flatSlot}" data-slot-label="${esc(label)}"
          title="${esc(title)}">
        <span class="ams-loadout-lip">
          <b>${esc(label.split(' · ').pop() || label)}</b>
          <small>${esc(stateLabel)}</small>
        </span>
        <span class="ams-loadout-spool" aria-hidden="true">
          <span class="ams-loadout-rim"></span>
          <span class="ams-loadout-core">${loadedSpool ? `#${loadedSpool.id}` : ''}</span>
          <span class="ams-loadout-hub"></span>
        </span>
        <span class="ams-loadout-info">
          <strong>${esc(loadedSpool ? (loadedSpool.color_name || 'Colour') : (slot.empty ? 'Empty' : 'Loaded'))}</strong>
          <em>${esc(loadedSpool ? (loadedSpool.material || '') : (slot.type || stateLabel))}</em>
        </span>
        <span class="ams-loadout-foot">
          ${grams != null ? `<small>${grams}g${pct != null ? ` · ${pct}%` : ''}</small>` : '<small>—</small>'}
        </span>
      </button>`;
    }).join('');
    const isHt = _isAmsHtUnit(unit);
    return `<div class="ams-loadout-unit${isHt ? ' ams-loadout-unit-ht' : ''}">
      <div class="ams-loadout-main">
        <div class="ams-loadout-head">
          <strong>${esc(unit.label ?? `AMS ${unit.unit + 1}`)}</strong>
          ${meta ? `<span>${esc(meta)}</span>` : ''}
        </div>
        <div class="ams-loadout-slots">${slots}</div>
      </div>
      <div class="ams-loadout-side">
        <small>${isHt ? 'High-temp bay' : `${(unit.slots || []).length} slot loadout`}</small>
        ${unit.dry_capable ? `<span class="ams-loadout-dry-state">${drying ? 'Drying' : 'Idle'}</span>` : ''}
        ${drying && dryTime ? `<span class="ams-loadout-dry-time">${esc(dryTime)}</span>` : ''}
        <div class="ams-loadout-actions">
          ${dryControl}
        </div>
      </div>
    </div>`;
  });
  return `<div class="ams-loadout-deck">
    <div class="ams-loadout-units">${units.join('')}</div>
  </div>`;
}

function _detailLiveMmuRows(p) {
  if (!p.mmu?.length) return '';
  const loaded = _latestSpoolsByPrinter[p.id] || [];
  return p.mmu.map(unit => {
    const routeState = _mmuRouteState(unit);
    const gates = (unit.gates || []).map(gate => {
      const loadedSpool = loaded.find(s => Number(s.location_slot) === Number(gate.idx));
      const mismatch = _slotMismatch(loadedSpool, gate);
      const gateLabel = `T${Number(gate.idx)}`;
      const style = (!gate.empty && gate.color) ? `style="background:${gate.color}"` : '';
      const slotText = loadedSpool
        ? `#${loadedSpool.id}`
        : (gate.empty ? 'Empty' : (gate.material || gateLabel));
      const status = gate.active ? routeState.gateStatus : gate.status === 2 ? 'Buffered' : gate.empty ? 'Empty' : 'Ready';
      const title = [
        gateLabel,
        loadedSpool ? [loadedSpool.color_name, loadedSpool.material, loadedSpool.brand, `${Math.round(Number(loadedSpool.remaining_g || 0))}g`].filter(Boolean).join(' · ') : '',
        !gate.empty ? _slotProfileLabel(gate) : '',
        status,
        mismatch,
      ].filter(Boolean).join(' · ');
      return `<button class="live-mmu-gate${gate.empty ? ' live-mmu-gate-empty' : ''}${gate.active ? ' live-mmu-gate-active' : ''}${gate.status === 2 ? ' live-mmu-gate-buffered' : ''}${mismatch ? ' live-mmu-gate-warning' : ''}"
        ${style} data-slot-edit data-printer-id="${p.id}" data-slot-index="${Number(gate.idx)}" data-slot-label="${esc(gateLabel)}"
        title="${esc(title)}">
        <span>${esc(slotText)}</span>
        <em>${esc(status)}</em>
      </button>`;
    }).join('');
    const meta = [
      unit.vendor || 'MMU',
      unit.num_gates ? `${unit.num_gates} tools` : '',
      unit.current_gate != null && unit.current_gate >= 0 ? `selector T${Number(unit.current_gate)}` : '',
      routeState.meta,
    ].filter(Boolean).join(' · ');
    return `<div class="live-mmu-row">
      <div class="live-mmu-head">
        <strong>${esc(unit.vendor || 'MMU')}</strong>
        ${meta ? `<span>${esc(meta)}</span>` : ''}
      </div>
      <div class="live-mmu-gates">${gates}</div>
    </div>`;
  }).join('');
}

function _mmuRouteState(unit = {}) {
  const sensors = unit.sensors || {};
  const filament = String(unit.filament || '').trim();
  const loadedToExtruder = sensors.extruder === true || (/loaded/i.test(filament) && !/unloaded/i.test(filament));
  const atGear = sensors.mmu_gear === true;
  const atPregate = sensors.mmu_pre_gate === true;
  const operation = String(unit.operation || unit.action || '').trim();
  if (loadedToExtruder) {
    return {
      destination: 'Toolhead',
      detail: 'At nozzle',
      badge: 'Loaded',
      gateStatus: 'Nozzle',
      meta: operation && !/^idle$/i.test(operation) ? operation : 'nozzle loaded',
    };
  }
  if (atGear) {
    return {
      destination: 'Gear / buffer',
      detail: 'Staged before Bowden',
      badge: 'Staged',
      gateStatus: 'Gear',
      meta: 'at gear/buffer',
    };
  }
  if (atPregate) {
    return {
      destination: 'Pre-gate',
      detail: 'Waiting at sensor',
      badge: 'Pre-gate',
      gateStatus: 'Pre-gate',
      meta: 'at pre-gate',
    };
  }
  return {
    destination: 'MMU selected',
    detail: filament || 'Not fed',
    badge: 'Selected',
    gateStatus: 'Selected',
    meta: filament && !/unloaded/i.test(filament) ? filament : '',
  };
}

function _isH2dPrinter(p) {
  return String(p?.model_name || p?.id || '').toLowerCase().includes('h2d');
}

function _isAmsHtUnit(unit) {
  return Number(unit?.unit) >= 128 || String(unit?.label || '').toLowerCase().includes('ht');
}

function _amsFlatSlot(unit, slot) {
  const unitId = Number(unit?.unit ?? unit ?? 0);
  const slotIdx = Number(slot?.idx ?? slot ?? 0);
  return unitId >= 128 ? unitId + slotIdx : unitId * 4 + slotIdx;
}

function _printerHasActiveThermalContext(p) {
  const state = String(p?.state || '').toLowerCase();
  return !!p?.job || ['printing', 'paused', 'loading', 'preparing', 'busy'].includes(state);
}

function _hotendIsWorking(p, reading) {
  const actual = Number(reading?.actual || 0);
  const target = Number(reading?.target || 0);
  if (target >= 80) return true;
  return _printerHasActiveThermalContext(p) && actual >= 80;
}

function _h2dNozzleActivity(p) {
  return {
    left: _hotendIsWorking(p, p?.temps?.hotend_l),
    right: _hotendIsWorking(p, p?.temps?.hotend_r),
  };
}

function _slotRouteActive(p, unit, slot) {
  if (!slot || slot.empty) return false;
  if (_isH2dPrinter(p)) {
    const nozzles = _h2dNozzleActivity(p);
    const hasNozzleSignal = nozzles.left || nozzles.right;
    const isHt = _isAmsHtUnit(unit);
    if (isHt) return true;
    if (hasNozzleSignal) {
      if (nozzles.right && !nozzles.left) return false;
      return nozzles.left && !!slot.active;
    }
  }
  return !!slot.active;
}

function _slotRouteFed(p, unit, slot) {
  if (!slot || slot.empty) return false;
  if (_isH2dPrinter(p)) {
    const nozzles = _h2dNozzleActivity(p);
    const hasNozzleSignal = nozzles.left || nozzles.right;
    const isHt = _isAmsHtUnit(unit);
    if (hasNozzleSignal) return isHt ? nozzles.right : (nozzles.left && !!slot.active);
  }
  return !!slot.active;
}

function _routeDestinationLabel(p, unit) {
  if (_isH2dPrinter(p)) return _isAmsHtUnit(unit) ? 'Right nozzle' : 'Left nozzle';
  return p?.temps?.hotend_l != null || p?.temps?.hotend_r != null ? 'Toolhead' : 'Nozzle';
}

function _detailFilamentRoute(p) {
  if (!p.ams?.length && !p.mmu?.length) return '';
  const loaded = _latestSpoolsByPrinter[p.id] || [];
  const routes = [];

  for (const unit of p.ams) {
    for (const slot of (unit.slots || [])) {
      if (!_slotRouteActive(p, unit, slot)) continue;
      const flatSlot = _amsFlatSlot(unit, slot);
      const spool = loaded.find(s => Number(s.location_slot) === flatSlot);
      const colour = spool?.color_hex || slot.color || '#22c55e';
      const textColour = _spoolTextColor(colour);
      const slotLabel = _amsSlotLabel(p, flatSlot);
      const spoolLabel = spool
        ? `#${spool.id} ${[spool.color_name, spool.material].filter(Boolean).join(' · ')}`
        : _slotProfileLabel(slot) || slot.type || 'Loaded filament';
      const dest = _routeDestinationLabel(p, unit);
      const fedNow = _slotRouteFed(p, unit, slot);
      const routeClass = fedNow ? '' : ' live-filament-route-idle';
      const routeBadge = fedNow ? 'Fed now' : 'Ready';
      const title = `${slotLabel} ${fedNow ? 'feeding' : 'ready for'} ${dest}${spoolLabel ? ' · ' + spoolLabel : ''}`;
      if (FLIGHTDECK_DEMO) {
        routes.push(`<div class="demo-filament-route${routeClass}${_isAmsHtUnit(unit) ? ' demo-filament-route-ht' : ''}" style="--route-colour:${colour};--route-text:${textColour};--route-slot:${Number(slot.idx || 0)}" title="${esc(title)}">
          <span class="demo-route-port" aria-hidden="true"></span>
          <span class="demo-route-line" aria-hidden="true"></span>
          <span class="live-route-node live-route-destination">
            <span class="live-route-nozzle" aria-hidden="true"></span>
            <span><strong>${esc(dest)}</strong><em>${esc(slotLabel)} · ${esc(spoolLabel)}</em></span>
          </span>
          <span class="demo-route-fed">${esc(routeBadge)}</span>
        </div>`);
      } else {
        routes.push(`<div class="live-filament-route${routeClass}" style="--route-colour:${colour};--route-text:${textColour}" title="${esc(title)}">
          <button class="live-route-node live-route-source" data-slot-edit data-printer-id="${p.id}" data-slot-index="${flatSlot}" data-slot-label="${esc(slotLabel)}">
            <span class="live-route-swatch"></span>
            <span><strong>${esc(slotLabel)}</strong><em>${esc(spoolLabel)}</em></span>
            <b class="live-route-fed">${esc(routeBadge)}</b>
          </button>
          <span class="live-route-line" aria-hidden="true"></span>
          <span class="live-route-node live-route-destination">
            <span class="live-route-nozzle" aria-hidden="true"></span>
            <span><strong>${esc(dest)}</strong><em>${fedNow ? 'Filament fed' : 'Filament ready'}</em></span>
          </span>
        </div>`);
      }
    }
  }

  for (const unit of (p.mmu || [])) {
    const routeState = _mmuRouteState(unit);
    for (const gate of (unit.gates || [])) {
      if (!gate.active || gate.empty) continue;
      const spool = loaded.find(s => Number(s.location_slot) === Number(gate.idx));
      const colour = spool?.color_hex || gate.color || '#ef4444';
      const textColour = _spoolTextColor(colour);
      const gateLabel = `T${Number(gate.idx)}`;
      const spoolLabel = spool
        ? `#${spool.id} ${[spool.color_name, spool.material].filter(Boolean).join(' · ')}`
        : _slotProfileLabel(gate) || gate.material || 'Loaded filament';
      const title = `${gateLabel} to ${routeState.destination}${spoolLabel ? ' · ' + spoolLabel : ''}`;
      routes.push(`<div class="live-filament-route live-filament-route-mmu" style="--route-colour:${colour};--route-text:${textColour}" title="${esc(title)}">
        <button class="live-route-node live-route-source" data-slot-edit data-printer-id="${p.id}" data-slot-index="${Number(gate.idx)}" data-slot-label="${esc(gateLabel)}">
          <span class="live-route-swatch"></span>
          <span><strong>${esc(gateLabel)}</strong><em>${esc(spoolLabel)}</em></span>
          <b class="live-route-fed">${esc(routeState.badge)}</b>
        </button>
        <span class="live-route-line" aria-hidden="true"></span>
        <span class="live-route-node live-route-destination">
          <span class="live-route-nozzle" aria-hidden="true"></span>
          <span><strong>${esc(routeState.destination)}</strong><em>${esc(routeState.detail)}</em></span>
        </span>
      </div>`);
    }
  }

  if (!routes.length) return '';
  return `<div class="live-environment-section live-route-section">
    ${FLIGHTDECK_DEMO ? '' : '<span class="live-strip-label">Filament route</span>'}
    <div class="live-route-list">${routes.join('')}</div>
  </div>`;
}

function _detailCameraContent(id, p, camSrc) {
  if (camSrc && p.state !== 'offline') {
    return `<img id="detail-cam-img" src="${camSrc}" alt="Live camera" data-camera-id="${id}">`;
  }
  return _cameraOfflineContent(p, '');
}

function _cameraOfflineContent(p, extraClass = '') {
  const isOffline = p.state === 'offline';
  const label = isOffline ? 'Signal lost' : 'Camera not configured';
  const title = isOffline ? `${_dashboardPrinterName(p)} is offline` : 'No camera feed configured';
  const detail = isOffline
    ? `Last contact ${fmtLastSeen(p.last_seen)}`
    : 'Add a camera URL in printer settings to bring this bay online.';
  const status = isOffline ? 'Offline' : 'No feed';
  return `<div class="camera-hero-offline ${extraClass} ${isOffline ? 'camera-hero-offline-state' : 'camera-hero-no-feed'}">
    <div class="camera-offline-card">
      <div class="camera-offline-radar" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
      <div class="camera-offline-copy">
        <span class="mission-eyebrow">${esc(label)}</span>
        <strong>${esc(title)}</strong>
        <small>${esc(detail)}</small>
      </div>
      <span class="camera-offline-badge">${esc(status)}</span>
    </div>
  </div>`;
}

function _detailCameraHud(p) {
  const job = _activePrinterJob(p);
  if (!job) return '';
  const progress = job?.progress != null ? Math.round(job.progress * 100) : 0;
  const status = `<strong>${esc(jobDisplayName(job))}</strong><span>${progress}% · ${esc(_liveEtaText(p))}</span>`;
  return `<div class="camera-hud-main">${status}</div>
    <div class="camera-hud-progress"><span style="width:${progress}%"></span></div>
    <div class="camera-hud-chips">${_detailLiveTempChips(p, 3)}</div>`;
}

function _detailLiveStrip(p) {
  const loadedHtml = _detailLiveAmsRows(p) || _detailLiveMmuRows(p) || _detailLiveSpoolChips(p);
  const routeHtml = _detailFilamentRoute(p);
  return `<div class="live-environment-panel">
    <div class="live-environment-head">
      <span class="live-strip-label live-environment-title">Environment</span>
      <div class="live-chip-row">${_detailLiveTempChips(p)}</div>
    </div>
    ${routeHtml}
    <div class="live-environment-section live-environment-loaded">
      <span class="live-strip-label">Loaded</span>
      <div class="live-loaded-stack">${loadedHtml || '<span class="live-strip-empty">No Flightdeck spools assigned</span>'}</div>
    </div>
  </div>`;
}

function _detailPrintPanel(p) {
  const title = `<div class="detail-panel-title">Print Details</div>`;
  const activeJob = _activePrinterJob(p);

  if (!activeJob) {
    const entries = Object.entries(p.idle_info || {});
    if (!entries.length) return title + `<div class="detail-row"><span class="detail-label">—</span></div>`;
    return `<div class="detail-panel-title">Last Print</div>` +
      entries.map(([k, v]) => `
        <div class="detail-row">
          <span class="detail-label">${k}</span>
          <span class="detail-value">${v}</span>
        </div>`).join('');
  }

  const job = activeJob;
  const name = jobDisplayName(job);
  const pct = (job.progress * 100).toFixed(0);
  const layers = job.layer_current != null && job.layer_total != null
    ? `${job.layer_current} / ${job.layer_total}` : '—';

  const thumb = `<div class="detail-thumb">
    <img class="detail-thumb-img" src="${_mediaUrl(`/api/printers/${p.id}/thumbnail`, name)}" alt="Print thumbnail"
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
    const resp = await fetch(`/api/printers/${id}/set-temp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heater, target: clampedTarget }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.detail || 'Temperature command failed');
    }
  } catch (err) {
    delete _tempOptimistic[`${id}:${heater}`];
    throw err instanceof Error ? err : new Error('Temperature command failed');
  }
}

async function sendFanSet(id, speed, channel = 'part') {
  const clampedSpeed = Math.max(0, Math.min(100, Math.round(speed)));
  const resp = await fetch(`/api/printers/${id}/fan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ speed: clampedSpeed, channel }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || 'Fan command failed');
  }
}

async function sendJogZ(id, distance) {
  const dz = Math.max(-10, Math.min(10, Number(distance)));
  const resp = await fetch(`/api/printers/${id}/jog-z`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ distance: dz }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || 'Z jog failed');
  }
}

async function sendJog(id, axis, distance) {
  const axisKey = String(axis || '').toLowerCase();
  const limit = axisKey === 'z' ? 10 : 50;
  const delta = Math.max(-limit, Math.min(limit, Number(distance)));
  const speed = axisKey === 'z' ? 600 : 3000;
  const resp = await fetch(`/api/printers/${id}/jog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ axis: axisKey, distance: delta, speed }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || 'Jog command failed');
  }
}

async function sendHomeAxes(id, axes) {
  const resp = await fetch(`/api/printers/${id}/home`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ axes }),
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.detail || 'Home command failed');
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
      const flatSlot = _amsFlatSlot(unit, slot);
      const loaded = (_latestSpoolsByPrinter[p.id] || []).find(s => Number(s.location_slot) === flatSlot);
      const mismatch = _slotMismatch(loaded, slot);
      const style = (!slot.empty && slot.color) ? `style="background:${slot.color}"` : '';
      const activeCls = slot.active ? ' ams-active' : '';
      const emptyCls  = slot.empty  ? ' ams-empty'  : '';
      const mappedCls = loaded ? ' ams-mapped' : '';
      const warnCls = mismatch ? ' ams-warning' : '';
      const tip = slot.empty
        ? `Slot ${slot.idx + 1}: empty`
        : _slotProfileLabel(slot);
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
  const powerLimited = p && !['idle', 'finished', 'offline'].includes(String(p.state || '').toLowerCase());
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
      ${powerLimited ? `<div class="ams-dry-power-note">
        AMS drying while the printer is loading or printing may need a separate AMS power supply for reliable drying.
      </div>` : ''}
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
      showToast('AMS drying command failed', err.message || '', 'error');
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
      showToast('AMS drying command failed', err.message || '', 'error');
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

async function sendAmsUnload({ printerId, slotIndex }) {
  const resp = await fetch(`/api/printers/${encodeURIComponent(printerId)}/ams/unload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot: Number(slotIndex) }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'AMS unload command failed');
  }
}

async function sendAmsLoad({ printerId, slotIndex }) {
  const resp = await fetch(`/api/printers/${encodeURIComponent(printerId)}/ams/load`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slot: Number(slotIndex) }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || 'AMS load command failed');
  }
}

// ── MMU panel ─────────────────────────────────────────────────────────────

function _detailMmuPanel(p) {
  if (!p.mmu?.length) return '';
  const unit = p.mmu[0];
  if (!unit.gates?.length) return '';

  const title = `<div class="detail-panel-title">${unit.vendor || 'MMU'} · ${unit.num_gates} tools</div>`;

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

function _detailObjectsPanel(id, data) {
  const objects = data?.objects || [];
  if (!objects || objects.length < 2) return _detailObjectsUnavailablePanel(data);
  const modeLabel = data?.label || 'Object exclusion';
  const detail = data?.detail || 'Select one object to exclude it from the active print.';
  const title = `<div class="detail-panel-title">Objects</div>
    <div class="obj-panel-subtitle"><strong>${esc(modeLabel)}</strong><span>${esc(detail)}</span></div>`;
  const mapHtml = _objectMapHtml(id, data);
  return `<div class="detail-panel">${title}${mapHtml}</div>`;
}

function _detailObjectsUnavailablePanel(data) {
  const modeLabel = data?.label || 'Object exclusion';
  const detail = data?.detail || 'No object map is available for this print.';
  const objects = data?.objects || [];
  const hint = objects.length === 1
    ? 'This file only reports one object, so there is nothing useful to exclude.'
    : 'The active 3MF did not expose skip-object metadata. Reslicing/exporting with object metadata may make this available.';
  return `<div class="detail-panel obj-unavailable">
    <div class="detail-panel-title">Objects</div>
    <div class="obj-panel-subtitle"><strong>${esc(modeLabel)}</strong><span>${esc(detail)}</span></div>
    <div class="obj-empty-note">${esc(hint)}</div>
  </div>`;
}

function _objectMapHtml(id, data) {
  const objects = data?.objects || [];
  const bounds = data?.plate_bounds;
  const topDown = _objectMapIsTopDown(data);
  const hasGeometry = bounds && bounds.w > 0 && bounds.h > 0 && objects.some(o => o.bbox || (topDown && _objectMapHasPoint(o)));
  const availableObjects = objects.filter(o => o.state !== 'excluded');
  const mappedAvailableObjects = hasGeometry ? availableObjects.filter(o => o.bbox || (topDown && _objectMapHasPoint(o))) : availableObjects;
  const mapButtons = objects.map(obj => {
    const isExcluded = obj.state === 'excluded';
    const isCurrent = obj.state === 'current';
    const rawName = obj.name || `Object ${obj.id ?? ''}`;
    const safeName = esc(rawName);
    const safeId = obj.id ?? '';
    const shortName = (obj.label || rawName).replace(/.*[/\\]/, '');
    const displayId = safeId !== '' ? `#${esc(safeId)}` : esc(shortName);
    const pointGeometry = topDown && _objectMapHasPoint(obj);
    if (hasGeometry && (obj.bbox || pointGeometry)) {
      const geom = pointGeometry ? _objectMapPointHitStyle(bounds, obj) : _objectMapBoxStyle(bounds, obj.bbox, data);
      return `<button type="button" class="obj-map-region obj-exclude-btn${isExcluded ? ' is-excluded' : ''}${isCurrent ? ' is-current' : ''}"
        style="${geom}"
        data-obj-name="${safeName}" data-obj-label="${esc(shortName)}" data-printer-id="${id}" data-obj-id="${safeId}" ${isExcluded ? 'disabled' : ''}
        title="${esc(shortName)}"><span class="obj-chip-id">${displayId}</span></button>`;
    }
    if (hasGeometry && topDown) return '';
    return `<button type="button" class="obj-id-select obj-exclude-btn${isExcluded ? ' is-excluded' : ''}${isCurrent ? ' is-current' : ''}"
      data-obj-name="${safeName}" data-obj-label="${esc(shortName)}" data-printer-id="${id}" data-obj-id="${safeId}" ${isExcluded ? 'disabled' : ''}
      title="${esc(shortName)}"><span class="obj-chip-id">${displayId}</span></button>`;
  }).join('');
  const imageVersion = objects.map(o => `${o.id ?? ''}:${o.state ?? ''}`).join('-') || 'current';
  const plateImageUrl = _objectMapPlateImageUrl(data, topDown);
  const imageSrc = _objectMapImageSrc(plateImageUrl, imageVersion);
  const image = imageSrc
    ? `<img class="${topDown ? 'obj-map-preview-image' : ''}" src="${esc(imageSrc)}" alt="Plate object map" loading="lazy">`
    : '';
  const objectImages = topDown ? _objectMapTopDownObjects(data) : _objectMapImagePieces(data, imageVersion);
  const rotation = Number(data?.map_rotation || 0);
  const imageRotation = Number(data?.map_image_rotation || 0);
  const imageOffsetX = Number(data?.map_image_offset_x || 0);
  const imageOffsetY = Number(data?.map_image_offset_y || 0);
  const rotated = rotation > 0 || imageRotation > 0;
  const classes = `obj-map${hasGeometry ? ' obj-map-has-geometry' : ' obj-map-no-geometry'}${topDown ? ' obj-map-topdown' : ''}${rotated ? ' obj-map-transformed' : ''}${rotation > 0 ? ' obj-map-overlay-rotated' : ''}${imageRotation > 0 ? ' obj-map-image-rotated' : ''}`;
  const rotationStyle = _objectMapStyleVars(bounds, rotated, rotation, imageRotation, imageOffsetX, imageOffsetY);
  const helper = hasGeometry
    ? 'Match the ID to the printer screen, then tap the map or list.'
    : `No bed positions in this 3MF; use the object ID shown on the printer screen. Bambu/Orca IDs can be high. ${availableObjects.length} objects still available.`;
  const objectList = _objectMapObjectList(id, objects, hasGeometry);
  const activeBadge = mappedAvailableObjects.length === availableObjects.length
    ? `${availableObjects.length} active`
    : `${mappedAvailableObjects.length} mapped`;
  return `<div class="${classes}"${rotationStyle}>
    <div class="obj-map-stage obj-map-open" data-printer-id="${esc(id)}" title="Open large object selector">
      <div class="obj-map-image-plane">
        ${topDown ? image : ''}
        ${objectImages || (topDown ? '' : image)}
      </div>
      <div class="obj-map-plane">
        ${hasGeometry ? `<div class="obj-map-overlay">${mapButtons}</div>` : ''}
      </div>
      ${topDown ? '<div class="obj-map-front-marker" aria-hidden="true">Front</div>' : ''}
      ${topDown ? `<div class="obj-map-active-count">${esc(activeBadge)}</div>` : ''}
    </div>
    ${objectList || (hasGeometry ? '' : `<div class="obj-id-selector"><span>Printer object IDs</span><div>${mapButtons}</div></div>`)}
    <div class="obj-map-helper">${esc(helper)}</div>
  </div>`;
}

function _objectMapObjectList(id, objects, hasGeometry) {
  if (!hasGeometry || !objects?.length) return '';
  const rows = objects.map(obj => {
    const isExcluded = obj.state === 'excluded';
    const isCurrent = obj.state === 'current';
    const rawName = obj.name || `Object ${obj.id ?? ''}`;
    const safeId = obj.id ?? '';
    const shortName = (obj.label || rawName).replace(/.*[/\\]/, '');
    return `<button type="button" class="obj-map-list-row obj-exclude-btn${isExcluded ? ' is-excluded' : ''}${isCurrent ? ' is-current' : ''}"
      data-obj-name="${esc(rawName)}" data-obj-label="${esc(shortName)}" data-printer-id="${esc(id)}" data-obj-id="${esc(safeId)}" ${isExcluded ? 'disabled' : ''}
      title="${esc(shortName)}">
      <span class="obj-map-list-id">${safeId !== '' ? esc(safeId) : '?'}</span>
      <span class="obj-map-list-name">${esc(shortName)}</span>
      <span class="obj-map-list-action">${isExcluded ? 'Skipped' : 'Skip'}</span>
    </button>`;
  }).join('');
  return `<div class="obj-map-list"><div class="obj-map-list-title">Object IDs</div>${rows}</div>`;
}

function _objectMapImagePieces(data, imageVersion) {
  const objects = data?.objects || [];
  const bounds = data?.plate_bounds;
  const src = data?.plate_image_url;
  if (data?.map_image_mode !== 'per_object' || !src || !bounds || bounds.w <= 0 || bounds.h <= 0) return '';
  return objects.filter(obj => obj.bbox).map(obj => {
    const left = ((obj.bbox.x - bounds.x) / bounds.w) * 100;
    const top = ((obj.bbox.y - bounds.y) / bounds.h) * 100;
    const width = (obj.bbox.w / bounds.w) * 100;
    const height = (obj.bbox.h / bounds.h) * 100;
    const bgX = width > 0 ? (left / (100 - width)) * 100 : 50;
    const bgY = height > 0 ? (top / (100 - height)) * 100 : 50;
    const bgW = width > 0 ? (100 / width) * 100 : 100;
    const bgH = height > 0 ? (100 / height) * 100 : 100;
    return `<div class="obj-map-image-piece"
      style="left:${left.toFixed(2)}%;top:${top.toFixed(2)}%;width:${Math.max(width, 5).toFixed(2)}%;height:${Math.max(height, 5).toFixed(2)}%;background-image:url('${esc(src)}?map=${encodeURIComponent(imageVersion)}');background-size:${bgW.toFixed(2)}% ${bgH.toFixed(2)}%;background-position:${Number.isFinite(bgX) ? bgX.toFixed(2) : '50'}% ${Number.isFinite(bgY) ? bgY.toFixed(2) : '50'}%"
      aria-hidden="true"></div>`;
  }).join('');
}

function _objectMapPlateImageUrl(data, topDown = false) {
  if (!data) return '';
  return topDown ? (data.plate_top_image_url || data.plate_image_url || '') : (data.plate_image_url || '');
}

function _objectMapImageSrc(src, imageVersion) {
  if (!src) return '';
  return `${src}${src.includes('?') ? '&' : '?'}map=${encodeURIComponent(imageVersion)}`;
}

function _objectMapIsTopDown(data) {
  return data?.map_image_mode === 'top_down' || data?.map_view === 'top_down';
}

function _objectMapHasPoint(obj) {
  return Number.isFinite(Number(obj?.x)) && Number.isFinite(Number(obj?.y));
}

function _objectMapPointPosition(bounds, obj) {
  const padding = 8;
  const contentArea = 100 - (padding * 2);
  const yMax = Number(bounds.y) + Number(bounds.h);
  let x = padding + ((Number(obj.x) - Number(bounds.x)) / Number(bounds.w)) * contentArea;
  let y = padding + ((yMax - Number(obj.y)) / Number(bounds.h)) * contentArea;
  x = Math.max(5, Math.min(95, x));
  y = Math.max(5, Math.min(95, y));
  return { x, y };
}

function _objectMapTransformPoint(bounds, x, y, data = {}) {
  let px = ((Number(x) - bounds.x) / bounds.w) * 100;
  let py = ((Number(y) - bounds.y) / bounds.h) * 100;
  if (data?.map_mirror_x) px = 100 - px;
  if (data?.map_mirror_y) py = 100 - py;
  const rotation = Number(data?.map_coordinate_rotation || 0);
  if (rotation === -90 || rotation === 270) {
    const nextX = py;
    const nextY = 100 - px;
    px = nextX;
    py = nextY;
  } else if (rotation === 90 || rotation === -270) {
    const nextX = 100 - py;
    const nextY = px;
    px = nextX;
    py = nextY;
  } else if (Math.abs(rotation) === 180) {
    px = 100 - px;
    py = 100 - py;
  }
  return { x: px, y: py };
}

function _objectMapBoxParts(bounds, box, data = {}) {
  const points = [
    _objectMapTransformPoint(bounds, box.x, box.y, data),
    _objectMapTransformPoint(bounds, box.x + box.w, box.y, data),
    _objectMapTransformPoint(bounds, box.x + box.w, box.y + box.h, data),
    _objectMapTransformPoint(bounds, box.x, box.y + box.h, data),
  ];
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const width = Math.max(...xs) - left;
  const height = Math.max(...ys) - top;
  return {
    left,
    top,
    width: Math.max(width, 5),
    height: Math.max(height, 5),
  };
}

function _objectMapBoxStyle(bounds, box, data = {}) {
  const p = _objectMapBoxParts(bounds, box, data);
  return `left:${p.left.toFixed(2)}%;top:${p.top.toFixed(2)}%;width:${p.width.toFixed(2)}%;height:${p.height.toFixed(2)}%`;
}

function _objectMapMarkerStyle(bounds, box, data = {}) {
  const p = _objectMapBoxParts(bounds, box, data);
  const centerX = Math.max(0, Math.min(100, p.left + (p.width / 2)));
  const centerY = Math.max(0, Math.min(100, p.top + (p.height / 2)));
  return `left:${centerX.toFixed(2)}%;top:${centerY.toFixed(2)}%`;
}

function _objectMapPointMarkerStyle(bounds, obj) {
  const p = _objectMapPointPosition(bounds, obj);
  return `left:${p.x.toFixed(2)}%;top:${p.y.toFixed(2)}%`;
}

function _objectMapPointHitStyle(bounds, obj) {
  const p = _objectMapPointPosition(bounds, obj);
  const size = 12;
  return `left:${Math.max(0, p.x - (size / 2)).toFixed(2)}%;top:${Math.max(0, p.y - (size / 2)).toFixed(2)}%;width:${size.toFixed(2)}%;height:${size.toFixed(2)}%`;
}

function _objectMapTopDownObjects(data) {
  const objects = data?.objects || [];
  const bounds = data?.plate_bounds;
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return '';
  return objects.filter(obj => obj.bbox || _objectMapHasPoint(obj)).map(obj => {
    const isExcluded = obj.state === 'excluded';
    const isCurrent = obj.state === 'current';
    const rawName = obj.name || `Object ${obj.id ?? ''}`;
    const shortName = (obj.label || rawName).replace(/.*[/\\]/, '');
    const displayId = obj.id !== undefined && obj.id !== null ? `#${obj.id}` : '?';
    const style = _objectMapHasPoint(obj)
      ? _objectMapPointMarkerStyle(bounds, obj)
      : _objectMapMarkerStyle(bounds, obj.bbox, data);
    return `<div class="obj-map-top-object${isExcluded ? ' is-excluded' : ''}${isCurrent ? ' is-current' : ''}"
      style="${style}"
      title="${esc(shortName)}" aria-hidden="true"><span class="obj-map-top-block"></span><span class="obj-map-id-dot">${esc(displayId)}</span></div>`;
  }).join('');
}

function _objectMapShapeSvg(obj, bounds, data = {}) {
  const box = obj?.bbox;
  const segments = Array.isArray(obj?.shape?.segments) ? obj.shape.segments : [];
  const polygon = Array.isArray(obj?.shape?.polygon) ? obj.shape.polygon : [];
  if (!bounds || !box || (!segments.length && !polygon.length) || box.w <= 0 || box.h <= 0) return '';
  const view = _objectMapBoxParts(bounds, box, data);
  const point = pt => {
    if (!Array.isArray(pt) || pt.length < 2) return null;
    const transformed = _objectMapTransformPoint(bounds, pt[0], pt[1], data);
    if (!Number.isFinite(transformed.x) || !Number.isFinite(transformed.y)) return null;
    return transformed;
  };
  const polygonHtml = polygon.length >= 3
    ? `<polygon points="${polygon.map(point).filter(Boolean).map(pt => `${pt.x.toFixed(3)},${pt.y.toFixed(3)}`).join(' ')}"></polygon>`
    : '';
  const lines = segments.slice(0, 260).map(seg => {
    if (!Array.isArray(seg) || seg.length < 4) return '';
    const a = point([seg[0], seg[1]]);
    const b = point([seg[2], seg[3]]);
    if (!a || !b) return '';
    return `<line x1="${a.x.toFixed(3)}" y1="${a.y.toFixed(3)}" x2="${b.x.toFixed(3)}" y2="${b.y.toFixed(3)}"></line>`;
  }).join('');
  if (!lines && !polygonHtml) return '';
  return `<svg class="obj-map-shape" viewBox="${view.left.toFixed(3)} ${view.top.toFixed(3)} ${view.width.toFixed(3)} ${view.height.toFixed(3)}" preserveAspectRatio="none" focusable="false">${polygonHtml}${lines}</svg>`;
}

function _objectMapStyleVars(bounds, rotated, rotation, imageRotation, imageOffsetX, imageOffsetY) {
  const vars = [];
  if (bounds && bounds.w > 0 && bounds.h > 0) {
    const aspect = Math.max(0.65, Math.min(1.85, Number(bounds.w) / Number(bounds.h)));
    vars.push(`--obj-map-aspect:${aspect.toFixed(4)}`);
  }
  if (rotated) {
    vars.push(
      `--obj-map-rotation:${rotation.toFixed(2)}deg`,
      `--obj-map-image-rotation:${imageRotation.toFixed(2)}deg`,
      `--obj-map-image-offset-x:${imageOffsetX.toFixed(2)}%`,
      `--obj-map-image-offset-y:${imageOffsetY.toFixed(2)}%`,
      `--obj-map-counter-rotation:${(-rotation).toFixed(2)}deg`,
      `--obj-map-plane-scale:${rotation === 90 ? '177.78%' : '135%'}`,
      `--obj-map-image-scale:${imageRotation === 90 ? '177.78%' : '135%'}`,
    );
  }
  return vars.length ? ` style="${vars.join(';')}"` : '';
}

function _largeObjectMapHtml(id, data) {
  const objects = data?.objects || [];
  const bounds = data?.plate_bounds;
  const topDown = _objectMapIsTopDown(data);
  const hasGeometry = bounds && bounds.w > 0 && bounds.h > 0 && objects.some(o => o.bbox || (topDown && _objectMapHasPoint(o)));
  const availableObjects = objects.filter(o => o.state !== 'excluded');
  const mappedAvailableObjects = hasGeometry ? availableObjects.filter(o => o.bbox || (topDown && _objectMapHasPoint(o))) : availableObjects;
  const imageVersion = objects.map(o => `${o.id ?? ''}:${o.state ?? ''}`).join('-') || 'current';
  const plateImageUrl = _objectMapPlateImageUrl(data, topDown);
  const imageSrc = _objectMapImageSrc(plateImageUrl, imageVersion);
  const image = imageSrc
    ? `<img class="${topDown ? 'obj-map-preview-image' : ''}" src="${esc(imageSrc)}" alt="Large plate preview" loading="eager">`
    : '<div class="object-map-missing">No thumbnail available</div>';
  const objectImages = topDown ? _objectMapTopDownObjects(data) : _objectMapImagePieces(data, imageVersion);
  const rotation = Number(data?.map_rotation || 0);
  const imageRotation = Number(data?.map_image_rotation || 0);
  const imageOffsetX = Number(data?.map_image_offset_x || 0);
  const imageOffsetY = Number(data?.map_image_offset_y || 0);
  const rotated = rotation > 0 || imageRotation > 0;
  const rotationStyle = _objectMapStyleVars(bounds, rotated, rotation, imageRotation, imageOffsetX, imageOffsetY);
  const buttons = objects.map(obj => {
    const isExcluded = obj.state === 'excluded';
    const isCurrent = obj.state === 'current';
    const rawName = obj.name || `Object ${obj.id ?? ''}`;
    const safeName = esc(rawName);
    const safeId = obj.id ?? '';
    const shortName = (obj.label || rawName).replace(/.*[/\\]/, '');
    const displayId = safeId !== '' ? `#${esc(safeId)}` : esc(shortName);
    const pointGeometry = topDown && _objectMapHasPoint(obj);
    if (hasGeometry && (obj.bbox || pointGeometry)) {
      return `<button type="button" class="obj-map-region obj-exclude-btn${isExcluded ? ' is-excluded' : ''}${isCurrent ? ' is-current' : ''}"
        style="${pointGeometry ? _objectMapPointHitStyle(bounds, obj) : _objectMapBoxStyle(bounds, obj.bbox, data)}"
        data-obj-name="${safeName}" data-obj-label="${esc(shortName)}" data-printer-id="${id}" data-obj-id="${safeId}" ${isExcluded ? 'disabled' : ''}
        title="${esc(shortName)}"><span class="obj-chip-id">${displayId}</span></button>`;
    }
    if (hasGeometry && topDown) return '';
    return `<button type="button" class="obj-id-select obj-exclude-btn${isExcluded ? ' is-excluded' : ''}${isCurrent ? ' is-current' : ''}"
      data-obj-name="${safeName}" data-obj-label="${esc(shortName)}" data-printer-id="${id}" data-obj-id="${safeId}" ${isExcluded ? 'disabled' : ''}
      title="${esc(shortName)}"><span class="obj-chip-id">${displayId}</span><span>${esc(shortName)}</span></button>`;
  }).join('');
  const helper = hasGeometry
    ? 'Match the ID to the printer screen, then tap the map or list.'
    : 'This file has no bed-position metadata. Match the object ID shown on the printer screen, then select it below.';
  const objectList = _objectMapObjectList(id, objects, hasGeometry);
  const activeBadge = mappedAvailableObjects.length === availableObjects.length
    ? `${availableObjects.length} active`
    : `${mappedAvailableObjects.length} mapped`;
  return `<div class="object-map-modal-body">
    <div class="object-map-modal-stage${hasGeometry ? ' has-geometry' : ''}${topDown ? ' obj-map-topdown' : ''}${rotated ? ' obj-map-transformed' : ''}${rotation > 0 ? ' obj-map-overlay-rotated' : ''}${imageRotation > 0 ? ' obj-map-image-rotated' : ''}"${rotationStyle}>
      <div class="obj-map-image-plane">
        ${topDown ? image : ''}
        ${objectImages || (topDown ? '' : image)}
      </div>
      <div class="obj-map-plane">
        ${hasGeometry ? `<div class="obj-map-overlay">${buttons}</div>` : ''}
      </div>
      ${topDown ? '<div class="obj-map-front-marker" aria-hidden="true">Front</div>' : ''}
      ${topDown ? `<div class="obj-map-active-count">${esc(activeBadge)}</div>` : ''}
    </div>
    <div class="obj-map-helper">${esc(helper)}</div>
    ${objectList || (hasGeometry ? '' : `<div class="obj-id-selector object-map-modal-ids"><span>Printer object IDs</span><div>${buttons}</div></div>`)}
  </div>`;
}

function _openObjectMapModal(id) {
  const data = _objectsCache[id];
  if (!data?.objects?.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay object-map-overlay-modal';
  overlay.innerHTML = `<div class="modal-box object-map-modal">
    <div class="modal-header">
      <span class="modal-title">Skip object selector</span>
      <button class="modal-close-btn">×</button>
    </div>
    ${_largeObjectMapHtml(id, data)}
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.modal-close-btn')?.addEventListener('click', close);
  overlay.addEventListener('click', e => {
    const btn = e.target.closest('.obj-exclude-btn');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    close();
    _confirmExcludeButton(btn);
  });
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
  if (!data?.mode) return;
  const nextHtml = _detailObjectsPanel(id, data);
  if (el.innerHTML !== nextHtml) el.innerHTML = nextHtml;
}

async function sendExcludeObject(id, name, objectId = null) {
  try {
    const r = await fetch(`/api/printers/${id}/exclude-object`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, id: objectId === null || objectId === '' ? null : Number(objectId) }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      showToast('Object exclude failed', body.detail || 'Printer did not accept the command', 'error');
      return;
    }
    showToast('Object excluded', name.replace(/.*[/\\]/, ''), 'success');
    await refreshObjectsPanel(id);
  } catch {
    showToast('Object exclude failed', 'Network error', 'error');
  }
}

function _confirmExcludeButton(btn) {
  const name = btn.dataset.objName;
  const id = btn.dataset.printerId;
  const objectId = btn.dataset.objId;
  if (!name || !id) return;
  const shortName = btn.dataset.objLabel || name.replace(/.*[/\\]/, '');
  const idText = objectId !== undefined && objectId !== '' ? ` #${objectId}` : '';
  _modal.show(
    `Exclude "${shortName}"${idText} from this print? The printer will skip this object and Flightdeck cannot un-skip it mid-print.`,
    () => sendExcludeObject(id, name, objectId)
  );
}

// Delegated click for Klipper/Bambu object exclusion.
document.getElementById('view-printer').addEventListener('click', e => {
  const btn = e.target.closest('.obj-exclude-btn');
  if (!btn || btn.disabled) return;
  e.preventDefault();
  _confirmExcludeButton(btn);
});

document.getElementById('view-printer').addEventListener('click', e => {
  if (e.target.closest('.obj-exclude-btn')) return;
  const stage = e.target.closest('.obj-map-open');
  if (!stage) return;
  e.preventDefault();
  _openObjectMapModal(stage.dataset.printerId);
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

function _historyModeControl(mode) {
  const modes = [
    ['weekly', 'Week'],
    ['monthly', 'Month'],
    ['yearly', 'Year'],
  ];
  return `<div class="heat-mode-control" role="tablist" aria-label="History heatmap range">
    ${modes.map(([value, label]) => `
      <button class="heat-mode-btn${mode === value ? ' active' : ''}" data-history-mode="${value}" type="button" role="tab" aria-selected="${mode === value ? 'true' : 'false'}">${label}</button>
    `).join('')}
  </div>`;
}

function _historyAggregateDay(a, d) {
  const total = Number(d.total || 0);
  a.total += total;
  a.finished += Number(d.finished || 0);
  a.cancelled += Number(d.cancelled || 0);
  a.errors += Number(d.errors || 0);
  if (total > a.peakTotal) {
    a.peakTotal = total;
    a.peakDay = d.day;
  }
}

function _historyAggregateColor(total, maxTotal) {
  if (!total) return null;
  if (maxTotal <= 1) return 'rgba(34,197,94,0.35)';
  const level = total / maxTotal;
  if (level >= 0.75) return 'rgba(34,197,94,1)';
  if (level >= 0.4) return 'rgba(34,197,94,0.62)';
  return 'rgba(34,197,94,0.3)';
}

function _historyAggregateTile(a, maxTotal, extraClass = '') {
  const color = _historyAggregateColor(a.total, maxTotal);
  const cls = ['heat-agg-tile', color ? '' : 'heat-empty', extraClass].filter(Boolean).join(' ');
  const tip = a.total
    ? `${a.label}: ${a.total} print${a.total !== 1 ? 's' : ''} (${a.finished} finished)`
    : `${a.label}: no prints`;
  return `<button class="${cls}" type="button" data-date="${a.peakDay || a.start}"${color ? ` style="background:${color}"` : ''} title="${tip}">
    <span class="heat-agg-label">${a.label}</span>
    <strong>${a.total || ''}</strong>
  </button>`;
}

function _historyWeeklyHeatmap(dayData, year) {
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

  const weeks = [];
  for (let start = new Date(gridStart); start <= gridEnd; start.setUTCDate(start.getUTCDate() + 7)) {
    const end = new Date(start);
    end.setUTCDate(start.getUTCDate() + 6);
    if (end.getUTCFullYear() !== year && start.getUTCFullYear() !== year) continue;
    const agg = {
      label: start.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      start: start.toISOString().slice(0, 10),
      total: 0,
      finished: 0,
      cancelled: 0,
      errors: 0,
      peakTotal: 0,
      peakDay: null,
    };
    for (let i = 0; i < 7; i++) {
      const cell = new Date(start);
      cell.setUTCDate(start.getUTCDate() + i);
      if (cell.getUTCFullYear() !== year) continue;
      const dateStr = cell.toISOString().slice(0, 10);
      if (byDate[dateStr]) _historyAggregateDay(agg, byDate[dateStr]);
    }
    weeks.push(agg);
  }

  const maxTotal = Math.max(1, ...weeks.map(w => w.total));
  return `<div class="history-section">
    <div class="heat-agg-grid heat-week-grid">
      ${weeks.map(w => _historyAggregateTile(w, maxTotal)).join('')}
    </div>
  </div>`;
}

function _historyMonthlyHeatmap(dayData, year) {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const months = MONTHS.map((label, idx) => ({
    label,
    start: `${year}-${String(idx + 1).padStart(2, '0')}-01`,
    total: 0,
    finished: 0,
    cancelled: 0,
    errors: 0,
    peakTotal: 0,
    peakDay: null,
  }));
  for (const d of dayData) {
    const month = Number(d.day.slice(5, 7)) - 1;
    if (months[month]) _historyAggregateDay(months[month], d);
  }
  const maxTotal = Math.max(1, ...months.map(m => m.total));
  return `<div class="history-section">
    <div class="heat-agg-grid heat-month-grid">
      ${months.map(m => _historyAggregateTile(m, maxTotal, 'heat-month-tile')).join('')}
    </div>
  </div>`;
}

function _historyYearlyHeatmap(printerId, dayData, year) {
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

function _historyHeatmap(printerId, dayData, year, mode) {
  if (mode === 'weekly') return _historyWeeklyHeatmap(dayData, year);
  if (mode === 'monthly') return _historyMonthlyHeatmap(dayData, year);
  return _historyYearlyHeatmap(printerId, dayData, year);
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

function _showPrintDetail(printerId, dateStr, print, targetEl = null) {
  const el = targetEl || document.getElementById('history-day-detail');
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
         <img src="${_mediaUrl(`/api/printers/${printerId}/prints/${print.id}/snapshot`, print.filename || 'Failure snapshot', '#ef4444')}" alt="Last frame before failure" loading="lazy">
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
        ? `<div class="print-notes-text">${esc(print.notes)}</div>`
        : `<span class="print-notes-empty">No notes</span>`}
      <button class="print-notes-edit-btn">${print.notes ? 'Edit' : 'Add note'}</button>
    </div>
  </div>`;

  const memoryMetaHtml = print.id ? `<div class="print-memory-meta" data-print-id="${print.id}">
    <div class="print-memory-meta-head">
      <span>Memory tags</span>
      <button class="print-memory-edit-btn">Edit</button>
    </div>
    <div class="print-memory-tag-list">
      ${(print.tags || []).map(tag => `<span class="print-memory-tag">${esc(tag)}</span>`).join('') || '<span class="print-notes-empty">No tags</span>'}
      ${print.exclude_from_stats ? '<span class="print-memory-tag print-memory-tag-muted">Excluded from stats</span>' : ''}
    </div>
  </div>` : '';

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
            ${u.actual_grams != null
              ? '<span class="print-spool-reconciled">Reconciled</span>'
              : `<button class="print-spool-reconcile${u.reconcile_suggested ? ' suggested' : ''}" data-print-id="${print.id}" data-spool-id="${u.spool_id}">${u.reconcile_suggested ? 'Weigh' : 'Reconcile'}</button>`}
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
    ${memoryMetaHtml}
    ${decisionHtml}
  </div>`;

  const notesBlock = el.querySelector('.print-notes-block');
  if (notesBlock) {
    const _refreshNotesView = (notes) => {
      notesBlock.querySelector('.print-notes-view').innerHTML = notes
        ? `<div class="print-notes-text">${esc(notes)}</div><button class="print-notes-edit-btn">Edit</button>`
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

  const memoryMeta = el.querySelector('.print-memory-meta');
  if (memoryMeta) {
    const refreshMemoryMeta = (saved) => {
      print = { ...print, ...saved };
      memoryMeta.querySelector('.print-memory-tag-list').innerHTML = `
        ${(print.tags || []).map(tag => `<span class="print-memory-tag">${esc(tag)}</span>`).join('') || '<span class="print-notes-empty">No tags</span>'}
        ${print.exclude_from_stats ? '<span class="print-memory-tag print-memory-tag-muted">Excluded from stats</span>' : ''}`;
      const row = document.querySelector(`.memory-row[data-print-id="${CSS.escape(String(print.id))}"]`);
      if (row) {
        const flags = row.querySelector('.memory-flags');
        if (flags) flags.innerHTML = _memoryFlags(print);
      }
    };
    memoryMeta.querySelector('.print-memory-edit-btn')?.addEventListener('click', () => {
      _showPrintMemoryMetadataEditor(print, refreshMemoryMeta);
    });
  }

  el.querySelectorAll('.print-spool-reconcile').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.preventDefault();
      const printId = btn.dataset.printId;
      const spoolId = btn.dataset.spoolId;
      const value = await _inputModal({
        title: `Reconcile spool #${spoolId}`,
        message: 'Actual remaining grams after this print',
        inputType: 'number',
        placeholder: 'grams',
        okLabel: 'Continue',
      });
      if (value === null) return;
      const remaining = parseFloat(value);
      if (isNaN(remaining) || remaining < 0) {
        showToast('Invalid gram value', 'Enter a valid remaining gram value.', 'error');
        return;
      }
      const usage = print.spool_usage.find(u => String(u.spool_id) === String(spoolId));
      let startRemaining = null;
      if (usage && usage.remaining_start_g == null) {
        const startValue = await _inputModal({
          title: `Starting weight for spool #${spoolId}`,
          message: 'Optional. Leave blank to keep the existing model value.',
          value: usage.remaining_before_g ?? '',
          inputType: 'number',
          okLabel: 'Continue',
        });
        if (startValue === null) return;
        if (startValue.trim() !== '') {
          startRemaining = parseFloat(startValue);
          if (isNaN(startRemaining) || startRemaining < 0) {
            showToast('Invalid gram value', 'Enter a valid starting gram value.', 'error');
            return;
          }
        }
      }
      let exclusive = false;
      if (print.spool_usage.length > 1) {
        exclusive = await _confirmModal('Was this the only spool actually used? Confirm will remove other usage rows and restore their deducted grams.');
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
        showToast('Reconcile failed', err.message || '', 'error');
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
            const repeatCount = Number(d.repeat_count || 1);
            const repeat = repeatCount > 1 ? `<span class="decision-repeat">x${repeatCount}</span>` : '';
            const lastTs = d.last_logged_at && repeatCount > 1
              ? new Date(d.last_logged_at.endsWith('Z') ? d.last_logged_at : d.last_logged_at + 'Z')
                .toLocaleTimeString([], _clockOpts({ second: '2-digit' }))
              : '';
            const detail = d.detail
              ? `<span class="decision-detail">${esc(d.detail)}${lastTs ? ` <em>Last repeated ${esc(lastTs)}</em>` : ''}</span>`
              : '';
            return `<div class="decision-item">
              <span class="decision-ts">${ts}</span>
              <span class="decision-event">${esc(d.event)}${repeat}</span>
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
  if (!_historyHeatmapMode[printerId]) _historyHeatmapMode[printerId] = 'yearly';
  const year = _historyYear[printerId];
  const mode = _historyHeatmapMode[printerId];
  const currentYear = new Date().getUTCFullYear();

  let data = { days: [], summary: {} };
  try {
    const r = await fetch(`/api/printers/${printerId}/history/calendar?year=${year}`);
    if (r.ok) data = await r.json();
  } catch {}

  el.innerHTML =
    _historyYearNav(year, currentYear) +
    _historyModeControl(mode) +
    _historySummaryLine(data.summary) +
    _historyHeatmap(printerId, data.days, year, mode) +
    `<div id="history-day-detail"></div>`;

  el.querySelector('[data-year-prev]')?.addEventListener('click', () => {
    _historyYear[printerId] = year - 1;
    _renderHistoryBody(printerId);
  });
  el.querySelector('[data-year-next]')?.addEventListener('click', () => {
    _historyYear[printerId] = year + 1;
    _renderHistoryBody(printerId);
  });
  el.querySelectorAll('[data-history-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      _historyHeatmapMode[printerId] = btn.dataset.historyMode;
      _renderHistoryBody(printerId);
    });
  });

  el.querySelector('.history-section')?.addEventListener('click', e => {
    const cell = e.target.closest('.heat-cell, .heat-agg-tile');
    if (!cell || cell.classList.contains('heat-future') || cell.classList.contains('heat-out')) return;
    if (!cell.dataset.date) return;
    el.querySelectorAll('.heat-cell.selected, .heat-agg-tile.selected').forEach(c => c.classList.remove('selected'));
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

// ── Print Memory ─────────────────────────────────────────────────────────

function _memoryPrintName(item) {
  const raw = item.subtask_name || String(item.filename || '').replace(/.*[/\\]/, '');
  return raw.replace(/\.gcode(\.3mf|\.gz)?$/i, '').replace(/\.bgcode$/i, '');
}

function _memoryStateBadge(state) {
  const { cls, label } = _printBadge(state || 'running');
  return `<span class="badge badge-${cls} memory-state-badge">${label}</span>`;
}

function _memoryPrinterLabel(id) {
  const p = _latestPrinters.find(x => x.id === id);
  return p ? _printerNavLabel(p) : id;
}

function _memoryFlags(item) {
  const tags = (item.tags || []).slice(0, 2).map(tag => `<span class="memory-pill">${esc(tag)}</span>`).join('');
  const moreTags = (item.tags || []).length > 2 ? `<span class="memory-pill">+${item.tags.length - 2}</span>` : '';
  const excluded = item.exclude_from_stats ? '<span class="memory-pill memory-pill-muted">no stats</span>' : '';
  const notes = item.notes ? '<span class="memory-pill">note</span>' : '';
  const snap = item.has_snapshot ? '<span class="memory-pill memory-pill-warn">snapshot</span>' : '';
  return `${tags}${moreTags}${excluded}${notes}${snap}`;
}

function _memoryRow(item) {
  const started = item.started_at ? new Date(item.started_at.endsWith('Z') ? item.started_at : item.started_at + 'Z') : null;
  const dateLabel = started ? started.toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'No date';
  const timeLabel = started ? started.toLocaleTimeString([], _clockOpts()) : '';
  const dur = item.duration_seconds ? formatTime(item.duration_seconds) : '—';
  const estimate = item.estimated_duration_seconds
    ? `<span title="Slicer estimate">est ${formatTime(item.estimated_duration_seconds)}</span>`
    : '';
  const material = item.material || (item.spool_usage || [])[0]?.material || '';
  const spoolCount = (item.spool_usage || []).length;
  return `<button class="memory-row" type="button" data-print-id="${item.id}" data-printer-id="${esc(item.printer_id)}">
    <span class="memory-date"><strong>${esc(dateLabel)}</strong><em>${esc(timeLabel)}</em></span>
    <span class="memory-main">
      <strong title="${esc(item.filename || '')}">${esc(_memoryPrintName(item))}</strong>
      <em>${esc(_memoryPrinterLabel(item.printer_id))}${material ? ` · ${esc(material)}` : ''}${spoolCount ? ` · ${spoolCount} spool${spoolCount !== 1 ? 's' : ''}` : ''}</em>
    </span>
    <span class="memory-meta">${_memoryStateBadge(item.final_state)}<em>${esc(dur)}</em>${estimate}</span>
    <span class="memory-flags">${_memoryFlags(item)}</span>
  </button>`;
}

function _memoryFiltersHtml(data, params) {
  const facets = data.facets || {};
  const printerOpts = (facets.printers || []).map(id =>
    `<option value="${esc(id)}"${params.printer_id === id ? ' selected' : ''}>${esc(_memoryPrinterLabel(id))}</option>`
  ).join('');
  const stateOpts = (facets.states || []).map(s =>
    `<option value="${esc(s)}"${params.state === s ? ' selected' : ''}>${esc(s)}</option>`
  ).join('');
  const materialOpts = (facets.materials || []).map(m =>
    `<option value="${esc(m)}"${params.material === m ? ' selected' : ''}>${esc(m)}</option>`
  ).join('');
  const tagOpts = (facets.tags || []).map(t =>
    `<option value="${esc(t)}"${params.tag === t ? ' selected' : ''}>${esc(t)}</option>`
  ).join('');
  return `<div class="memory-toolbar">
    <input class="memory-search" type="search" placeholder="Search files, notes, errors..." value="${esc(params.q || '')}">
    <select class="memory-filter" data-memory-filter="printer_id">
      <option value="">All printers</option>${printerOpts}
    </select>
    <select class="memory-filter" data-memory-filter="state">
      <option value="">All states</option>${stateOpts}
    </select>
    <select class="memory-filter" data-memory-filter="material">
      <option value="">All materials</option>${materialOpts}
    </select>
    <select class="memory-filter" data-memory-filter="tag">
      <option value="">All tags</option>${tagOpts}
    </select>
    <select class="memory-filter" data-memory-filter="days">
      <option value="">All time</option>
      <option value="7"${params.days === '7' ? ' selected' : ''}>7 days</option>
      <option value="30"${params.days === '30' ? ' selected' : ''}>30 days</option>
      <option value="90"${params.days === '90' ? ' selected' : ''}>90 days</option>
      <option value="365"${params.days === '365' ? ' selected' : ''}>1 year</option>
    </select>
  </div>`;
}

function _memorySummary(items) {
  const finished = items.filter(i => i.final_state === 'FINISHED').length;
  const failed = items.filter(i => i.final_state === 'ERROR' || i.final_state === 'ESTOP').length;
  const cancelled = items.filter(i => i.final_state === 'CANCELLED').length;
  const excluded = items.filter(i => i.exclude_from_stats).length;
  const hours = items.reduce((sum, i) => sum + Number(i.duration_seconds || 0), 0) / 3600;
  return `<div class="memory-summary">
    <span><strong>${items.length}</strong> prints</span>
    <span><strong>${finished}</strong> finished</span>
    <span><strong>${cancelled}</strong> cancelled</span>
    <span><strong>${failed}</strong> failed</span>
    ${excluded ? `<span><strong>${excluded}</strong> no stats</span>` : ''}
    <span><strong>${hours.toFixed(1)}</strong> h</span>
  </div>`;
}

function _memoryScoreLabel(score) {
  return score == null ? '--' : `${Number(score).toFixed(1)}%`;
}

function _memoryScoreClass(score) {
  if (score == null) return 'memory-score-unknown';
  if (score >= 95) return 'memory-score-good';
  if (score >= 85) return 'memory-score-watch';
  return 'memory-score-review';
}

function _memoryScorePanel(score) {
  const fleet = score?.fleet || {};
  const printers = score?.printers || [];
  const materials = score?.materials || [];
  const trustedAttempts = Number(fleet.finished || 0) + Number(fleet.failed || 0);
  const printerRows = printers.length ? printers.map(p => {
    const attempts = Number(p.finished || 0) + Number(p.failed || 0);
    const eta = p.eta_error_pct == null ? '' : `<span>ETA +/- ${Number(p.eta_error_pct).toFixed(1)}%</span>`;
    return `<div class="memory-score-printer">
      <div>
        <strong>${esc(_memoryPrinterLabel(p.printer_id))}</strong>
        <span>${attempts} scored · ${Number(p.cancelled || 0)} cancelled</span>
      </div>
      <div class="memory-score-printer-metrics">
        <b class="${_memoryScoreClass(p.score)}">${_memoryScoreLabel(p.score)}</b>
        ${eta}
      </div>
    </div>`;
  }).join('') : '<div class="memory-score-empty">No scored print attempts yet.</div>';
  const materialRows = materials.length ? materials.slice(0, 5).map(m => {
    const attempts = Number(m.finished || 0) + Number(m.failed || 0);
    const scoreVal = attempts ? (Number(m.finished || 0) / attempts) * 100 : null;
    return `<span><b>${esc(m.material || 'Unknown')}</b> ${_memoryScoreLabel(scoreVal)}</span>`;
  }).join('') : '<span>No material signal yet</span>';
  return `<section class="memory-score-panel">
    <div class="memory-score-main ${_memoryScoreClass(fleet.score)}">
      <span>Reliability Score</span>
      <strong>${_memoryScoreLabel(fleet.score)}</strong>
      <em>${trustedAttempts} trusted attempts · ${Number(fleet.excluded || 0)} excluded</em>
    </div>
    <div class="memory-score-printers">${printerRows}</div>
    <div class="memory-score-materials">${materialRows}</div>
  </section>`;
}

function _memoryParamsFromControls(page) {
  const params = new URLSearchParams();
  const q = page.querySelector('.memory-search')?.value.trim();
  if (q) params.set('q', q);
  page.querySelectorAll('[data-memory-filter]').forEach(el => {
    if (el.value) params.set(el.dataset.memoryFilter, el.value);
  });
  return params;
}

function _memorySetHash(page) {
  const params = _memoryParamsFromControls(page);
  const qs = params.toString();
  history.replaceState(null, '', qs ? `#/memory?${qs}` : '#/memory');
  renderPrintMemoryView();
}

async function _memoryOpenPassport(printId) {
  const detail = document.getElementById('memory-passport');
  if (!detail) return;
  detail.innerHTML = '<div class="history-day-loading">...</div>';
  try {
    const r = await fetch(`/api/print-memory/${printId}`);
    if (!r.ok) throw new Error('Print not found');
    const item = await r.json();
    const dateStr = String(item.started_at || '').slice(0, 10);
    detail.innerHTML = `<div class="memory-passport-head">
      <span>Print Passport</span>
      <a href="#/printer/${item.printer_id}/history" title="Open printer history">Printer history</a>
    </div>
    <div class="history-day-detail"></div>`;
    _showPrintDetail(item.printer_id, dateStr, item, detail.querySelector('.history-day-detail'));
    document.querySelectorAll('.memory-row.selected').forEach(row => row.classList.remove('selected'));
    document.querySelector(`.memory-row[data-print-id="${CSS.escape(String(printId))}"]`)?.classList.add('selected');
  } catch (err) {
    detail.innerHTML = `<div class="detail-placeholder">${esc(err.message || 'Unable to load print passport.')}</div>`;
  }
}

async function renderPrintMemoryView() {
  const page = document.getElementById('memory-page');
  if (!page) return;
  const params = Object.fromEntries(_routeParams('#/memory').entries());
  const apiParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) apiParams.set(key, value);
  }
  apiParams.set('limit', '160');
  page.innerHTML = '<div class="detail-placeholder">Loading print memory...</div>';
  let data = { items: [], facets: {} };
  let score = null;
  try {
    const scoreParams = new URLSearchParams();
    if (params.days) scoreParams.set('days', params.days);
    const [memoryResp, scoreResp] = await Promise.all([
      fetch(`/api/print-memory?${apiParams.toString()}`),
      fetch(`/api/print-memory-score?${scoreParams.toString()}`),
    ]);
    if (memoryResp.ok) data = await memoryResp.json();
    if (scoreResp.ok) score = await scoreResp.json();
  } catch {}
  const rows = (data.items || []).map(_memoryRow).join('');
  page.innerHTML = `<div class="memory-shell">
    <section class="memory-list-panel">
      <div class="memory-head">
        <div>
          <span class="memory-eyebrow">Fleet</span>
          <h2>Print Memory</h2>
        </div>
        ${_memorySummary(data.items || [])}
      </div>
      ${_memoryFiltersHtml(data, params)}
      ${_memoryScorePanel(score)}
      <div class="memory-list">${rows || '<div class="filedesk-empty">No matching prints yet.</div>'}</div>
    </section>
    <aside class="memory-passport" id="memory-passport">
      <div class="detail-placeholder">Select a print to open its passport.</div>
    </aside>
  </div>`;

  page.querySelector('.memory-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') _memorySetHash(page);
  });
  page.querySelector('.memory-search')?.addEventListener('change', () => _memorySetHash(page));
  page.querySelectorAll('[data-memory-filter]').forEach(el => {
    el.addEventListener('change', () => _memorySetHash(page));
  });
  page.querySelectorAll('.memory-row').forEach(row => {
    row.addEventListener('click', () => _memoryOpenPassport(row.dataset.printId));
  });
  if (data.items?.[0]) _memoryOpenPassport(data.items[0].id);
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

function _maintenanceLiveCard(item) {
  const title = item.title || 'Printer care';
  const code = item.code ? ` · ${String(item.code).toUpperCase()}` : '';
  const detail = item.detail || 'Reported by printer telemetry';
  const info = item.info ? `<span class="maint-live-code">${esc(item.info)}</span>` : '';
  return `<article class="maint-card maint-card-due maint-live-card">
    <div class="maint-card-main">
      <div class="maint-card-head">
        <h3>${esc(title)}</h3>
        <span class="maint-badge maint-badge-due">MQTT due</span>
      </div>
      <div class="maint-meta">${esc(detail)}${esc(code)}</div>
      ${info}
    </div>
  </article>`;
}

function _maintenanceLivePanel(printerId) {
  const printer = _latestPrinters.find(p => p.id === printerId);
  if (!printer || printer.kind !== 'bambu') return '';
  const liveItems = (printer?.maintenance || []).filter(i => i && (i.is_due || i.state === 'due'));
  const status = liveItems.length
    ? `${liveItems.length} printer-reported care item${liveItems.length === 1 ? '' : 's'}`
    : 'Printer telemetry clear';
  return `<section class="maint-live-panel ${liveItems.length ? 'maint-live-panel-due' : ''}">
    <div class="maint-live-head">
      <div>
        <div class="maint-live-kicker">Auto maintenance</div>
        <h3>Bambu MQTT watch</h3>
      </div>
      <span class="maint-badge ${liveItems.length ? 'maint-badge-due' : 'maint-badge-ok'}">${liveItems.length ? 'Action' : 'Clear'}</span>
    </div>
    <p>${esc(status)}. Flightdeck reads the printer care feed and keeps your manual schedule below for work you want to track yourself.</p>
    ${liveItems.length ? `<div class="maint-live-grid">${liveItems.map(_maintenanceLiveCard).join('')}</div>` : ''}
  </section>`;
}

function _maintenanceTaskDueText(item) {
  if (!item) return 'No task scheduled';
  if (item.is_due) return 'Due now';
  if (item.days_until_due != null) {
    if (item.days_until_due < 0) return `${Math.abs(item.days_until_due)}d overdue`;
    if (item.days_until_due === 0) return 'due today';
    return `${item.days_until_due}d left`;
  }
  if (item.interval_hours) return `${item.hours_since}/${item.interval_hours}h`;
  if (item.interval_prints) return `${item.prints_since}/${item.interval_prints} prints`;
  if (item.interval_days) return `${item.days_since ?? 0}/${item.interval_days}d`;
  return 'Manual trigger';
}

function _maintenanceCockpit(printerId, items) {
  const printer = _latestPrinters.find(p => p.id === printerId);
  const liveItems = (printer?.maintenance || []).filter(i => i && (i.is_due || i.state === 'due'));
  const dueItems = items.filter(i => i.is_due);
  const activeItems = items.filter(i => !i.archived_at);
  const nextItem = activeItems
    .filter(i => !i.is_due)
    .sort((a, b) => {
      const ad = a.days_until_due == null ? 999999 : a.days_until_due;
      const bd = b.days_until_due == null ? 999999 : b.days_until_due;
      return ad - bd || String(a.title || '').localeCompare(String(b.title || ''));
    })[0];
  const lastDone = activeItems
    .filter(i => i.last_completed_at)
    .sort((a, b) => String(b.last_completed_at).localeCompare(String(a.last_completed_at)))[0];
  const lastDoneText = lastDone
    ? `${lastDone.title} · ${new Date((lastDone.last_completed_at.endsWith('Z') ? lastDone.last_completed_at : lastDone.last_completed_at + 'Z')).toLocaleDateString()}`
    : 'No completed service yet';
  const statusClass = liveItems.length || dueItems.length ? 'warn' : 'ok';
  const statusText = liveItems.length
    ? `${liveItems.length} printer care`
    : dueItems.length
      ? `${dueItems.length} scheduled due`
      : 'Service clear';
  return `<section class="maint-cockpit maint-cockpit-${statusClass}">
    <div class="maint-cockpit-title">
      <div>
        <div class="maint-live-kicker">Service cockpit</div>
        <h2>${esc(printer?.custom_name || printer?.model_name || 'Printer')}</h2>
      </div>
      <span class="maint-badge ${statusClass === 'warn' ? 'maint-badge-due' : 'maint-badge-ok'}">${esc(statusText)}</span>
    </div>
    <div class="maint-cockpit-grid">
      <div class="maint-cockpit-stat">
        <strong>${liveItems.length}</strong>
        <span>printer reported</span>
      </div>
      <div class="maint-cockpit-stat">
        <strong>${dueItems.length}</strong>
        <span>scheduled due</span>
      </div>
      <div class="maint-cockpit-stat">
        <strong>${activeItems.length}</strong>
        <span>manual tasks</span>
      </div>
      <div class="maint-cockpit-next">
        <span>Next service</span>
        <strong>${esc(nextItem?.title || (dueItems[0]?.title ?? 'Nothing queued'))}</strong>
        <small>${esc(_maintenanceTaskDueText(nextItem || dueItems[0]))}</small>
      </div>
      <div class="maint-cockpit-next">
        <span>Last completed</span>
        <strong>${esc(lastDoneText)}</strong>
        <small>Operator service log</small>
      </div>
    </div>
  </section>`;
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
      <div>
        <div class="maint-live-kicker">Maintenance</div>
        <div class="maint-summary">${summary}</div>
      </div>
    </div>
    ${_maintenanceCockpit(printerId, items)}
    ${_maintenanceLivePanel(printerId)}
    <details class="maint-form-shell">
      <summary>${items.length ? 'Add service task' : 'Create first service task'}</summary>
      ${_maintenanceForm(printerId)}
    </details>
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

function _spoolActivityMeta(row) {
  const ts = row.logged_at ? new Date(row.logged_at.endsWith('Z') ? row.logged_at : row.logged_at + 'Z') : null;
  const when = ts ? ts.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const p = _latestPrinters.find(x => x.id === row.printer_id);
  const source = row.printer_id === 'system'
    ? 'Flightdeck'
    : (p?.custom_name || row.printer_id || 'Flightdeck');
  return `${source} · ${when}`;
}

function _spoolActivityLabel(event) {
  const labels = {
    spool_added: 'Added',
    spool_moved: 'Moved',
    spool_auto_returned: 'Auto-returned',
    spool_auto_claimed: 'Auto-claimed',
    spool_trusted_printer: 'Trusted printer',
    spool_deducted: 'Deducted',
    spool_overdrawn: 'Overdraw',
    spool_missing: 'Missing',
  };
  return labels[event] || String(event || 'Activity').replace(/^spool_/, '').replace(/_/g, ' ');
}

function _spoolActivityClass(event) {
  if (event === 'spool_auto_claimed' || event === 'spool_auto_returned') return 'good';
  if (event === 'spool_trusted_printer' || event === 'spool_moved' || event === 'spool_added') return 'info';
  if (event === 'spool_overdrawn' || event === 'spool_missing') return 'warn';
  return 'info';
}

function _spoolActivityBadges(row) {
  const detail = row.detail || '';
  if (row.event === 'spool_auto_claimed') {
    const score = detail.match(/score\s+(\d+)/i)?.[1];
    return [
      'Matched automatically',
      'Unique stored spool',
      score ? `Confidence ${score}` : '',
    ].filter(Boolean);
  }
  if (row.event === 'spool_auto_returned') {
    return ['Home shelf return', 'Printer reported empty', 'No colour guess'];
  }
  return [];
}

function _spoolActivityRow(row) {
  const cls = _spoolActivityClass(row.event);
  const badges = _spoolActivityBadges(row);
  return `<div class="spool-activity-row spool-activity-${cls}">
    <div class="spool-activity-dot"></div>
    <div class="spool-activity-main">
      <div class="spool-activity-title">${esc(_spoolActivityLabel(row.event))}</div>
      ${badges.length ? `<div class="spool-activity-badges">${badges.map(badge => `<span>${esc(badge)}</span>`).join('')}</div>` : ''}
      <div class="spool-activity-detail">${esc(row.detail || '')}</div>
      <div class="spool-activity-meta">${esc(_spoolActivityMeta(row))}</div>
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
  const activity = data.activity || [];
  const confidence = data.confidence || {};
  const confidenceReasons = (confidence.reasons || []).map(r => `<span>${esc(r)}</span>`).join('');
  const homeLocation = data.home_storage_location_name || _spoolStorageLocationName(data.home_storage_location_id);
  const hasHomeLocation = !!(data.home_storage_location_id || data.home_storage_location_name);
  const homeTitle = hasHomeLocation ? homeLocation : 'Learning';
  const homeDetail = hasHomeLocation
    ? `Flightdeck returns this spool to ${homeLocation} when an AMS/MMU slot reports empty.`
    : 'Return this spool to a shelf once and Flightdeck will remember its home position.';

  el.innerHTML = `<div class="spool-detail-page">
    <div class="spool-detail-top">
      <button class="print-detail-back" onclick="history.back()">← Back</button>
      <a class="print-detail-back" href="#/spools">Spools</a>
    </div>
    <section class="spool-detail-hero">
      <div class="spool-detail-band" style="${_spoolColorStyle(data)};color:${textColor}">
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
      <div class="spool-detail-confidence spool-detail-confidence-${confidence.level || 'estimated'}">
        <div>
          <span>Weight Confidence</span>
          <strong>${esc(confidence.label || 'Estimated')} · ${confidence.score != null ? Math.round(confidence.score) : '--'}%</strong>
        </div>
        <div class="spool-confidence-reasons">${confidenceReasons || '<span>No confidence notes yet</span>'}</div>
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
      <div class="spool-home-memory spool-home-${hasHomeLocation ? 'set' : 'learning'}">
        <span>Home shelf memory</span>
        <strong>${esc(homeTitle)}</strong>
        <small>${esc(homeDetail)}</small>
      </div>
      ${data.notes ? `<div class="spool-detail-notes">${esc(data.notes)}</div>` : ''}
    </section>
    <section class="spool-trace-panel">
      <div class="history-day-header">AMS / Shelf Activity</div>
      ${activity.length ? activity.map(_spoolActivityRow).join('') : '<div class="print-empty">No spool activity recorded yet.</div>'}
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
    ? `<img src="${_mediaUrl(`/api/printers/${item.printer_id}/prints/${item.id}/snapshot`, item.filename || 'Failure snapshot', '#ef4444')}" alt="" loading="lazy">`
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

async function renderFailuresView(options = {}) {
  const {
    printerId = '',
    targetId = 'failures-page',
    routePrefix = '#/failures',
    embedded = false,
  } = options;
  const el = document.getElementById(targetId);
  if (!el) return;
  el.innerHTML = `<div class="detail-placeholder" style="min-height:40vh">Loading...</div>`;

  const params = _routeParams(routePrefix);
  if (printerId) _failureFilter.printer = printerId;
  else if (params.has('printer')) _failureFilter.printer = params.get('printer') || '';
  if (params.has('state')) _failureFilter.state = params.get('state') || '';
  if (params.has('material')) _failureFilter.material = params.get('material') || '';
  if (params.has('days')) {
    const days = parseInt(params.get('days'), 10);
    if ([30, 90, 180, 365].includes(days)) _failureDays = days;
  }

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
  const scopedPrinter = _failureFilter.printer ? _latestPrinters.find(p => p.id === _failureFilter.printer) : null;
  const summaryItems = _failureFilter.printer ? filtered : all;
  const summaryBy = (key) => Object.entries(summaryItems.reduce((acc, item) => {
    const val = item[key] || 'Unknown';
    acc[val] = (acc[val] || 0) + 1;
    return acc;
  }, {})).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
  const scopedSpoolStats = Object.entries(summaryItems.reduce((acc, item) => {
    (item.spool_usage || []).forEach(u => {
      const key = u.spool_id || 'Unknown';
      acc[key] = (acc[key] || 0) + 1;
    });
    return acc;
  }, {})).map(([spool_id, count]) => ({ spool_id, count })).sort((a, b) => b.count - a.count);
  const spoolRows = _failureFilter.printer ? scopedSpoolStats : spoolStats;
  const spoolStatHtml = spoolRows.length
    ? _failureStatBlock('By Spool', spoolRows, r => r.spool_id && r.spool_id !== 'Unknown' ? `Spool #${r.spool_id}` : 'Unknown')
    : '';

  el.innerHTML = `<div class="failures-header">
    <div>
      <h1>${scopedPrinter ? `${esc(_dashboardPrinterName(scopedPrinter))} Failures` : 'Failure Review'}</h1>
      <p>${filtered.length} observed failure/cancel events in the last ${data.days || _failureDays} days${scopedPrinter ? '' : ` · ${data.total || 0} fleet total`}</p>
    </div>
    <div class="failures-controls">
      <select id="failure-days">
        ${[30, 90, 180, 365].map(d => `<option value="${d}"${_failureDays === d ? ' selected' : ''}>${d} days</option>`).join('')}
      </select>
      ${printerId ? '' : `<select data-failure-filter="printer">${_failureOptions(all, 'printer_id', 'All printers', _failureFilter.printer)}</select>`}
      <select data-failure-filter="final_state">${_failureOptions(all, 'final_state', 'All states', _failureFilter.state)}</select>
      <select data-failure-filter="material">${_failureOptions(all, 'material', 'All materials', _failureFilter.material)}</select>
    </div>
  </div>
  <div class="failure-stats ${embedded ? 'failure-stats-embedded' : ''}">
    ${printerId ? _failureStatBlock('By Job State', summaryBy('final_state')) : _failureStatBlock('By Printer', data.summary.by_printer || [], r => (_latestPrinters.find(p => p.id === r.key)?.custom_name ?? r.key))}
    ${_failureStatBlock('By Material', printerId ? summaryBy('material') : data.summary.by_material || [])}
    ${_failureStatBlock('By Timing', printerId ? summaryBy('timing_bucket') : data.summary.by_timing || [], r => _FAIL_TIMING_LABELS[r.key] || r.key)}
    ${spoolStatHtml}
  </div>
  <div class="failure-list">
    ${filtered.length ? filtered.map(_failureRow).join('') : '<div class="failure-empty-panel">No matching failures.</div>'}
  </div>`;

  el.querySelector('#failure-days')?.addEventListener('change', e => {
    _failureDays = parseInt(e.target.value, 10);
    renderFailuresView(options);
  });
  el.querySelectorAll('[data-failure-filter]').forEach(sel => {
    sel.addEventListener('change', () => {
      const key = sel.dataset.failureFilter;
      if (key === 'printer') _failureFilter.printer = sel.value;
      if (key === 'final_state') _failureFilter.state = sel.value;
      if (key === 'material') _failureFilter.material = sel.value;
      renderFailuresView(options);
    });
  });
}

async function renderPrinterDetail(id, subtab = 'live') {
  const el = document.getElementById('printer-detail');
  let p = _latestPrinters.find(x => x.id === id);

  const needsFullRender =
    _renderedDetailId !== id ||
    _renderedDetailSubtab !== subtab ||
    !_renderedDetailOk;

  _renderedDetailId = id;
  _renderedDetailSubtab = subtab;

  if (!p) {
    _renderedDetailOk = false;
    el.innerHTML = `<div class="detail-placeholder">Connecting…</div>`;
    try {
      const r = await fetch(`/api/printers/${encodeURIComponent(id)}`);
      if (!r.ok) return;
      p = await r.json();
      const idx = _latestPrinters.findIndex(x => x.id === id);
      if (idx >= 0) _latestPrinters[idx] = p;
      else _latestPrinters.push(p);
      if (parseRoute().view === 'printer' && parseRoute().id === id) {
        renderPrinterDetail(id, subtab);
      }
    } catch {}
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

  if (subtab === 'failures') {
    if (needsFullRender) {
      _failureFilter.printer = id;
      el.innerHTML = _detailSubTabs(id, 'failures') +
        `<div class="failures-page printer-failures-page" id="printer-failures-page" data-printer-id="${id}">
          <div class="detail-placeholder" style="min-height:40vh">Loading...</div>
        </div>`;
      renderFailuresView({
        printerId: id,
        targetId: 'printer-failures-page',
        routePrefix: `#/printer/${id}/failures`,
        embedded: true,
      });
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

  if (subtab === 'bay') {
    if (needsFullRender) {
      el.innerHTML = _detailSubTabs(id, 'bay') +
        `<div class="printer-bay-body" id="printer-bay-body" data-printer-id="${id}">
          <div class="detail-placeholder" style="min-height:40vh">Loading Print Bay...</div>
        </div>`;
      _renderPrinterBayBody(id);
    }
    return;
  }

  // Live tab: resolve camera URL in the background so it never blocks status render.
  if (_cameraUrlCache[id] === undefined) {
    _cameraUrlCache[id] = null;
    fetch(`/api/printers/${id}/camera`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        _cameraUrlCache[id] = data?.url || null;
        const route = parseRoute();
        if (route.view === 'printer' && route.id === id && route.subtab === 'live') {
          _renderedDetailOk = false;
          renderPrinterDetail(id, subtab);
        }
      })
      .catch(() => { _cameraUrlCache[id] = null; });
  }

  if (needsFullRender) {
    const existingImg = el.querySelector('#detail-cam-img');
    if (existingImg) existingImg.src = '';

    try {
      const camSrc = _cameraStreamSrc(id);
      const camHtml = _detailCameraContent(id, p, camSrc);

      const printerColor = _printerColor(id);
      const bannerTextColor = p.icon === 'bambu' ? '#22c55e' : p.icon === 'voron' ? '#ef4444' : 'var(--text)';
      el.innerHTML =
        _detailSubTabs(id, 'live') +
        `<div class="detail-body">
          <div class="detail-left">
            <div id="detail-live-head">${_detailLiveHeader(p, printerColor, bannerTextColor)}</div>
            <div class="camera-hero">${camHtml}<div class="camera-hud" id="detail-camera-hud">${_detailCameraHud(p)}</div></div>
            <div class="live-strip" id="detail-live-strip">${_detailLiveStrip(p)}</div>
          </div>
          <div class="detail-right">
            <div class="detail-panels">
              <div class="detail-panel" id="detail-print">${_detailPrintPanel(p)}</div>
            </div>
            <div id="detail-objects"></div>
          </div>
        </div>`;
    } catch (err) {
      _renderedDetailOk = false;
      el.innerHTML = _detailSubTabs(id, 'live') +
        `<div class="detail-placeholder">Live view failed: ${esc(err?.message || 'render error')}</div>`;
      return;
    }
    _attachCameraRetries(el);

    // Click cycles — desktop: normal→wide→fullscreen→normal; mobile: normal↔fullscreen
    _camZoom = 0;
    const hero = el.querySelector('.camera-hero');
    if (hero) {
      hero.addEventListener('click', () => {
        if (_tempModal.isOpen()) { _tempModal.close(); return; }
        const body = hero.closest('.detail-body');
        if (!body) return;
        if (document.fullscreenElement === hero || _camZoom === 2) {
          _camZoom = 0;
          body.classList.remove('cam-wide');
          if (document.fullscreenElement) document.exitFullscreen?.();
          const fromFleet = _routeParams(`#/printer/${encodeURIComponent(id)}`).get('from') === 'fleet';
          const returnHash = _consumeCameraReturnTarget(id) || (fromFleet ? '#/fleet' : '');
          if (returnHash) location.hash = returnHash;
          return;
        }
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
            if (document.fullscreenElement) document.exitFullscreen?.();
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
    const heroEl = el.querySelector('.camera-hero');
    const camImg = el.querySelector('#detail-cam-img');
    const camSrc = _cameraStreamSrc(id);
    const shouldShowImg = !!camSrc && p.state !== 'offline';
    const hasImg = !!camImg;
    if (heroEl && shouldShowImg !== hasImg) {
      heroEl.innerHTML = `${_detailCameraContent(id, p, camSrc)}<div class="camera-hud" id="detail-camera-hud">${_detailCameraHud(p)}</div>`;
      _attachCameraRetries(el);
    } else if (camImg?.dataset.stopped && camSrc && p.state !== 'offline') {
      delete camImg.dataset.stopped;
      camImg.src = camSrc;
    }

    const printerColor = _printerColor(id);
    const bannerTextColor = p.icon === 'bambu' ? '#22c55e' : p.icon === 'voron' ? '#ef4444' : 'var(--text)';
    const headEl = el.querySelector('#detail-live-head');
    if (headEl) headEl.innerHTML = _detailLiveHeader(p, printerColor, bannerTextColor);
    const hudEl = el.querySelector('#detail-camera-hud');
    if (hudEl) hudEl.innerHTML = _detailCameraHud(p);
    const stripEl = el.querySelector('#detail-live-strip');
    if (stripEl) stripEl.innerHTML = _detailLiveStrip(p);
    const printEl = el.querySelector('#detail-print');
    if (printEl) {
      const thumbCollapsed = !!printEl.querySelector('.detail-thumb.collapsed');
      printEl.innerHTML = _detailPrintPanel(p);
      if (thumbCollapsed) printEl.querySelector('.detail-thumb')?.classList.add('collapsed');
    }
    const tempsEl = el.querySelector('#detail-temps');
    if (tempsEl) tempsEl.innerHTML = _detailTempsPanel(p);
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

// ── File Desk ──────────────────────────────────────────────────────────────

function _fmtBytes(bytes) {
  if (bytes == null) return '—';
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function _fileModifiedLabel(value) {
  if (!value) return '—';
  if (/^\d{14}$/.test(String(value))) {
    const s = String(value);
    return `${s.slice(6,8)}/${s.slice(4,6)}/${s.slice(0,4)} ${s.slice(8,10)}:${s.slice(10,12)}`;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function _fileKindClass(kind) {
  return String(kind || 'file').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
}

function _fileIsSourceModel(file) {
  const name = String(file?.name || file?.path || '').toLowerCase();
  return name.endsWith('.stl') || name.endsWith('.obj') || name.endsWith('.step') || name.endsWith('.stp') ||
    (name.endsWith('.3mf') && !name.endsWith('.gcode.3mf'));
}

function _fileIsSlicedJob(file) {
  const name = String(file?.name || file?.path || '').toLowerCase();
  return name.endsWith('.gcode.3mf') || name.endsWith('.gcode') || name.endsWith('.gcode.gz') || name.endsWith('.ufp');
}

function _queueJobIsSourceModel(job) {
  const name = String(job?.filename || '').toLowerCase();
  return name.endsWith('.step') || name.endsWith('.stp');
}

function _fileCompatiblePrinters(file, sourceTarget = null) {
  if (_fileIsSourceModel(file)) return _latestPrinters.slice();
  const name = String(file?.name || file?.path || '').toLowerCase();
  const isBambu = name.endsWith('.gcode.3mf') || name.endsWith('.3mf');
  const isMoonraker = name.endsWith('.gcode') || name.endsWith('.gcode.gz') || name.endsWith('.ufp');
  let printers = _latestPrinters.filter(p =>
    (p.kind === 'bambu' && isBambu) || (p.kind === 'moonraker' && isMoonraker)
  );
  if (sourceTarget && sourceTarget.id !== 'library') {
    printers = printers.filter(p => p.id === sourceTarget.id);
  }
  return printers;
}

function _filePrintablePrinters(file, sourceTarget = null) {
  if (_fileIsSourceModel(file)) return [];
  return _fileCompatiblePrinters(file, sourceTarget);
}

function _fileSliceTargets(file) {
  return _fileIsSourceModel(file) ? _latestPrinters.slice() : [];
}

function _printBaySourceSummary(target, files) {
  const totalBytes = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0);
  const compatible = new Set();
  files.forEach(f => _fileCompatiblePrinters(f, target).forEach(p => compatible.add(p.id)));
  return {
    count: files.length,
    size: totalBytes,
    compatible: compatible.size,
    vaulted: files.filter(f => f.in_vault).length,
    ready: files.filter(f => _fileCompatiblePrinters(f, target).some(p => p.state === 'idle' || p.state === 'finished')).length,
  };
}

function _printBayOverview(targets) {
  const sourceSummaries = (targets || []).map(t => {
    const files = (t.files || []).filter(f => f.kind !== 'dir' && _fileCompatiblePrinters(f, t).length);
    return { target: t, files, summary: _printBaySourceSummary(t, files) };
  });
  const allFiles = sourceSummaries.reduce((sum, s) => sum + s.summary.count, 0);
  const readyFiles = sourceSummaries.reduce((sum, s) => sum + s.summary.ready, 0);
  const libraryFiles = sourceSummaries.find(s => s.target.id === 'library')?.summary.count || 0;
  const printerFiles = allFiles - libraryFiles;
  return `<section class="filedesk-overview" aria-label="Print Bay overview">
    <div>
      <strong>${readyFiles}</strong>
      <span>ready to launch</span>
    </div>
    <div>
      <strong>${libraryFiles}</strong>
      <span>vault files</span>
    </div>
    <div>
      <strong>${printerFiles}</strong>
      <span>printer storage</span>
    </div>
    <div>
      <strong>${allFiles}</strong>
      <span>printable files</span>
    </div>
  </section>`;
}

function _printBayFileKey(name) {
  return String(name || '')
    .replace(/.*[/\\]/, '')
    .replace(/\.gcode\.3mf$/i, '')
    .replace(/\.gcode\.gz$/i, '')
    .replace(/\.(3mf|gcode|ufp)$/i, '')
    .toLowerCase();
}

function _printBayPrintName(print) {
  return print.subtask_name || String(print.filename || '').replace(/.*[/\\]/, '') || `Print #${print.id}`;
}

function _printBayFindMatch(print, targets) {
  const keys = new Set([
    _printBayFileKey(print.subtask_name),
    _printBayFileKey(print.filename),
  ].filter(Boolean));
  for (const target of targets || []) {
    for (const file of target.files || []) {
      if (file.kind === 'dir') continue;
      if (!keys.has(_printBayFileKey(file.path || file.name))) continue;
      if (!_filePrintablePrinters(file, target).length) continue;
      return { target, file, path: file.path || file.name };
    }
  }
  return null;
}

function _printBayRunMemory(print, match) {
  const memory = [];
  const state = print.final_state;
  if (state === 'FINISHED') memory.push({ cls: 'good', label: 'Last run completed' });
  else if (state === 'CANCELLED') memory.push({ cls: 'warn', label: 'Last run cancelled' });
  else memory.push({ cls: 'bad', label: 'Last run failed' });

  if (match) {
    const sameSource = match.target.id === print.printer_id;
    memory.push({
      cls: sameSource ? 'good' : 'info',
      label: sameSource ? 'Source on same printer' : `Source in ${match.target.label || match.target.id}`,
    });
  } else {
    memory.push({ cls: 'muted', label: 'Source file missing' });
  }

  if (print.filament_grams != null) memory.push({ cls: 'info', label: `${Number(print.filament_grams).toFixed(1)}g model` });
  return memory.slice(0, 3).map(item => `<span class="printbay-memory printbay-memory-${item.cls}">${esc(item.label)}</span>`).join('');
}

function _printBayStateLabel(state) {
  if (state === 'FINISHED') return { cls: 'done', label: 'Printed' };
  if (state === 'CANCELLED') return { cls: 'warn', label: 'Cancelled' };
  return { cls: 'bad', label: 'Failed' };
}

function _printBayReprintHtml(items, targets) {
  const cards = (items || []).slice(0, 8).map(print => {
    const name = _printBayPrintName(print);
    const state = _printBayStateLabel(print.final_state);
    const printer = print.printer || {};
    const match = _printBayFindMatch(print, targets);
    const material = [print.material, print.filament_grams != null ? `${Number(print.filament_grams).toFixed(1)}g` : ''].filter(Boolean).join(' · ');
    const duration = print.duration_seconds ? formatEta(print.duration_seconds) : '';
    const snapshot = print.has_snapshot
      ? `<img src="${_mediaUrl(`/api/printers/${esc(print.printer_id)}/prints/${print.id}/snapshot`, print.filename || 'Print snapshot')}" alt="" loading="lazy">`
      : `<span>${esc(state.label)}</span>`;
    const action = match
      ? `<button class="filedesk-action-btn filedesk-queue-primary" data-file-action="queue" data-source-id="${esc(match.target.id)}" data-path="${esc(match.path)}">Queue</button>`
      : `<span class="printbay-history-only">No source file found</span>`;
    const memory = _printBayRunMemory(print, match);
    return `<article class="printbay-reprint-card">
      <div class="printbay-reprint-thumb printbay-reprint-${state.cls}">${snapshot}</div>
      <div class="printbay-reprint-main">
        <div class="printbay-reprint-head">
          <strong title="${esc(print.filename || name)}">${esc(name)}</strong>
          <span class="printbay-state printbay-state-${state.cls}">${esc(state.label)}</span>
        </div>
        <div class="printbay-reprint-meta">
          <span>${esc(printer.model_name || printer.custom_name || print.printer_id)}</span>
          ${duration ? `<span>${esc(duration)}</span>` : ''}
          ${material ? `<span>${esc(material)}</span>` : ''}
        </div>
        <div class="printbay-memory-row">${memory}</div>
        <div class="printbay-reprint-foot">
          ${match ? `<span>${esc(match.target.label || match.target.id)}</span>` : '<span>History only</span>'}
          ${action}
        </div>
      </div>
    </article>`;
  }).join('');
  return `<section class="printbay-reprints">
    <div class="printbay-section-head">
      <div>
        <div class="mission-eyebrow">Reprint Bay</div>
        <h2>Recent work</h2>
      </div>
      <span>${items?.length || 0} recent</span>
    </div>
    <div class="printbay-reprint-grid">${cards || '<div class="filedesk-empty">No print history yet.</div>'}</div>
  </section>`;
}

function _fileDeskTargetHtml(target, options = {}) {
  const targetPrinterId = options.printerId || '';
  const directQueue = !!options.directQueue && !!targetPrinterId;
  const files = (target.files || []).filter(f => {
    if (f.kind === 'dir') return false;
    const printers = _fileCompatiblePrinters(f, target);
    return targetPrinterId ? printers.some(p => p.id === targetPrinterId) : printers.length;
  });
  const summary = _printBaySourceSummary(target, files);
  const rows = files.length ? files.map(f => {
    const path = esc(f.path || f.name);
    const printers = _fileCompatiblePrinters(f, target);
    const printable = _filePrintablePrinters(f, target);
    const isSource = _fileIsSourceModel(f);
    const ready = printers.filter(p => p.state === 'idle' || p.state === 'finished');
    const printerChips = printers.slice(0, 4).map(p => `<span class="filedesk-printer-chip${ready.some(r => r.id === p.id) ? ' filedesk-printer-ready' : ''}">${esc(p.model_name || p.custom_name || p.id)}</span>`).join('');
    const more = printers.length > 4 ? `<span class="filedesk-printer-chip">+${printers.length - 4}</span>` : '';
    const vaultChip = f.in_vault && target.id !== 'library'
      ? `<span class="filedesk-vault-chip" title="Archived in Print Vault${f.vault_path ? ': ' + esc(f.vault_path) : ''}">Vaulted</span>`
      : '';
    return `<article class="filedesk-file-row">
      <input type="checkbox" class="filedesk-select" data-source-id="${esc(target.id)}" data-path="${path}" data-name="${esc(f.name || f.path || 'File')}" aria-label="Select ${esc(f.name || f.path || 'file')}">
      <div class="filedesk-file-main" title="${esc(f.path || f.name)}">
        <div class="filedesk-file-title">
          <span class="filedesk-kind filedesk-kind-${_fileKindClass(f.kind)}">${esc(f.kind || 'file')}</span>
          ${vaultChip}
          <strong class="filedesk-name">${esc(f.name || f.path || 'File')}</strong>
        </div>
        <div class="filedesk-file-meta">
          <span>${esc(_fmtBytes(f.size))}</span>
          <span>${esc(_fileModifiedLabel(f.modified))}</span>
          <span>${esc(f.path || '')}</span>
        </div>
      </div>
      <div class="filedesk-compat">
        ${printerChips}${more}
      </div>
      ${isSource
        ? `<button class="filedesk-action-btn filedesk-slice-primary" data-file-action="slice" data-source-id="${esc(target.id)}" data-path="${path}" ${targetPrinterId ? `data-target-printer="${esc(targetPrinterId)}"` : ''}>Slice</button>`
        : `<button class="filedesk-action-btn filedesk-queue-primary" data-file-action="queue" data-source-id="${esc(target.id)}" data-path="${path}" ${directQueue ? `data-target-printer="${esc(targetPrinterId)}"` : ''} ${printable.length ? '' : 'disabled'}>Queue</button>`}
    </article>`;
  }).join('') : `<div class="filedesk-empty">${target.error ? esc(target.error) : 'No printable files found.'}</div>`;
  const formatNote = target.actions?.format_sd
    ? `<div class="filedesk-format-row">
        <span class="filedesk-format-note">Bambu SD cleanout deletes printable jobs only and keeps utility folders.</span>
        <button class="filedesk-danger-btn" data-file-action="clear-sd" data-source-id="${esc(target.id)}">Clear SD prints</button>
      </div>`
    : '';
  const bulkBar = files.length ? `<div class="filedesk-bulk-row" data-bulk-source="${esc(target.id)}">
    <span class="filedesk-bulk-count">No files selected</span>
    <div class="filedesk-bulk-actions">
      ${target.id === 'library' ? '' : `<button class="filedesk-action-btn filedesk-copy-btn" data-file-action="copy-selected" data-source-id="${esc(target.id)}" disabled>Copy to Vault</button>`}
      <button class="filedesk-action-btn filedesk-delete-btn" data-file-action="delete-selected" data-source-id="${esc(target.id)}" disabled>Delete selected</button>
    </div>
  </div>` : '';
  return `<section class="filedesk-target filedesk-${target.kind}">
    <div class="filedesk-target-head">
      <div>
        <h2>${esc(target.label)}</h2>
        <span>${esc(target.model || target.path || target.kind)}</span>
      </div>
      <div class="filedesk-target-meta">
        <strong>${files.length}</strong>
        <span>${files.length === 1 ? 'file' : 'files'}</span>
      </div>
    </div>
    <div class="filedesk-source-strip">
      <span><strong>${summary.ready}</strong> ready</span>
      <span><strong>${summary.compatible}</strong> compatible printers</span>
      ${target.id === 'library' ? '' : `<span><strong>${summary.vaulted}</strong> vaulted</span>`}
      <span><strong>${_fmtBytes(summary.size)}</strong></span>
    </div>
    ${formatNote}
    ${bulkBar}
    <div class="filedesk-list-head">
      <label><input type="checkbox" class="filedesk-select-all" data-source-id="${esc(target.id)}" ${files.length ? '' : 'disabled'}> Select all</label>
      <span>Launch candidates</span>
    </div>
    <div class="filedesk-list-wrap">
      ${rows}
    </div>
  </section>`;
}

let _fileDeskRenderInFlight = false;
let _fileDeskLastHtml = '';
let _fileDeskTargets = [];
let _printBayVaultOpen = false;
let _printerBayLastHtml = '';
let _printerBayLastPrinterId = '';

function _pollPrintBayIfVisible() {
  if (document.hidden) return;
  const route = parseRoute();
  if (route.view === 'files') {
    renderFileDeskView();
  } else if (route.view === 'printer' && route.subtab === 'bay' && route.id) {
    _renderPrinterBayBody(route.id);
  }
}

setInterval(_pollPrintBayIfVisible, 5000);
setInterval(_refreshVisibleCameraStreams, 30000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) _refreshVisibleCameraStreams(true);
});

async function renderFileDeskView() {
  const el = document.getElementById('filedesk-page');
  if (!el) return;
  if (_fileDeskRenderInFlight) return;
  _fileDeskRenderInFlight = true;
  if (!_fileDeskLastHtml) el.innerHTML = `<div class="detail-placeholder">Loading File Desk...</div>`;
  try {
    const r = await fetch('/api/files');
    if (!r.ok) throw new Error('Unable to load files');
    const data = await r.json();
    const reprints = await fetch('/api/files/reprints?limit=12')
      .then(r => r.ok ? r.json() : { items: [] })
      .catch(() => ({ items: [] }));
    _fileDeskTargets = data.targets || [];
    const vaultTargets = _fileDeskTargets.filter(t => t.id === 'library');
    const printerTargets = _fileDeskTargets.filter(t => t.id !== 'library');
    const vaultCount = vaultTargets.reduce((sum, t) => sum + (t.files || []).filter(f => f.kind !== 'dir' && _fileCompatiblePrinters(f, t).length).length, 0);
    const html = `<div class="filedesk-shell">
      <section class="filedesk-hero">
        <div>
          <div class="mission-eyebrow">Print Bay</div>
          <h1>Run-ready library</h1>
          <p>Launch from printer bays, keep the deep archive in the vault, and queue compatible jobs without starting them.</p>
        </div>
        <div class="filedesk-hero-actions">
          <label class="filedesk-upload-source">
            <input type="file" id="filedesk-source-upload" accept=".stl,.obj,.step,.stp,.3mf,.gcode,.gcode.gz,.ufp">
            Upload Source
          </label>
          <div class="filedesk-library-path">${esc(data.library_path || '')}</div>
        </div>
      </section>
      ${_printBayOverview(data.targets || [])}
      ${_printBayReprintHtml(reprints.items || [], data.targets || [])}
      <section class="printbay-active-bays">
        <div class="printbay-section-head printbay-section-head-compact">
          <div>
            <div class="mission-eyebrow">Printer Bays</div>
            <h2>Active storage</h2>
          </div>
          <span>${printerTargets.length} bay${printerTargets.length === 1 ? '' : 's'}</span>
        </div>
        <div class="filedesk-grid">${printerTargets.map(_fileDeskTargetHtml).join('')}</div>
      </section>
      <details class="printbay-vault"${_printBayVaultOpen ? ' open' : ''}>
        <summary>
          <span><b>Print Vault</b><small>Pi / USB / HDD backup area</small></span>
          <em>${vaultCount} file${vaultCount === 1 ? '' : 's'}</em>
        </summary>
        <div class="filedesk-grid printbay-vault-grid">${vaultTargets.map(_fileDeskTargetHtml).join('')}</div>
      </details>
    </div>`;
    if (html !== _fileDeskLastHtml) {
      el.innerHTML = html;
      _fileDeskLastHtml = html;
      _attachFileDeskEvents(el);
    }
  } catch (err) {
    if (!_fileDeskLastHtml) el.innerHTML = `<div class="detail-placeholder">File Desk unavailable.</div>`;
  } finally {
    _fileDeskRenderInFlight = false;
  }
}

async function _renderPrinterBayBody(printerId) {
  const el = document.getElementById('printer-bay-body');
  if (!el) return;
  if (!_printerBayLastHtml || _printerBayLastPrinterId !== printerId) {
    el.innerHTML = `<div class="detail-placeholder">Loading Print Bay...</div>`;
  }
  try {
    const [filesResp, reprints] = await Promise.all([
      fetch(`/api/files?printer_id=${encodeURIComponent(printerId)}`),
      fetch('/api/files/reprints?limit=24')
        .then(r => r.ok ? r.json() : { items: [] })
        .catch(() => ({ items: [] })),
    ]);
    if (!filesResp.ok) throw new Error('Unable to load files');
    const data = await filesResp.json();
    _fileDeskTargets = data.targets || [];
    const printer = _latestPrinters.find(p => p.id === printerId);
    const printerTarget = _fileDeskTargets.find(t => t.id === printerId);
    const vaultTargets = _fileDeskTargets.filter(t => t.id === 'library');
    const recent = (reprints.items || []).filter(p => p.printer_id === printerId);
    const vaultFiles = vaultTargets.reduce((sum, t) => sum + (t.files || []).filter(f =>
      f.kind !== 'dir' && _fileCompatiblePrinters(f, t).some(p => p.id === printerId)
    ).length, 0);
    const printerFileCount = printerTarget
      ? (printerTarget.files || []).filter(f => f.kind !== 'dir' && _fileCompatiblePrinters(f, printerTarget).some(p => p.id === printerId)).length
      : 0;
    const html = `<div class="printer-bay-shell">
      <section class="printer-bay-hero">
        <div>
          <div class="mission-eyebrow">Print Bay</div>
          <h2>${esc(_dashboardPrinterName(printer || { id: printerId }))}</h2>
          <p>Machine-local files, recent work, and vault candidates for this printer.</p>
        </div>
        <div class="printer-bay-hero-actions">
          <label class="filedesk-upload-source">
            <input type="file" id="printer-bay-source-upload" accept=".stl,.obj,.step,.stp,.3mf,.gcode,.gcode.gz,.ufp">
            Upload Source
          </label>
          <div class="printer-bay-stats">
            <span><strong>${printerFileCount}</strong> printer files</span>
            <span><strong>${vaultFiles}</strong> vault matches</span>
            <span><strong>${recent.length}</strong> recent prints</span>
          </div>
        </div>
      </section>
      ${_printBayReprintHtml(recent, _fileDeskTargets)}
      <section class="printbay-active-bays">
        <div class="printbay-section-head printbay-section-head-compact">
          <div>
            <div class="mission-eyebrow">Printer Bay</div>
            <h2>On-machine storage</h2>
          </div>
          <a class="filedesk-action-btn" href="#/files">Fleet bay</a>
        </div>
        <div class="filedesk-grid printer-bay-grid">${printerTarget ? _fileDeskTargetHtml(printerTarget, { printerId, directQueue: true }) : '<div class="filedesk-empty">No storage target for this printer.</div>'}</div>
      </section>
      <details class="printbay-vault printer-bay-vault"${_printBayVaultOpen ? ' open' : ''}>
        <summary>
          <span><b>Print Vault</b><small>Compatible files ready for this printer</small></span>
          <em>${vaultFiles} file${vaultFiles === 1 ? '' : 's'}</em>
        </summary>
        <div class="filedesk-grid printbay-vault-grid">${vaultTargets.map(t => _fileDeskTargetHtml(t, { printerId, directQueue: true })).join('')}</div>
      </details>
    </div>`;
    if (html !== _printerBayLastHtml || _printerBayLastPrinterId !== printerId) {
      el.innerHTML = html;
      _printerBayLastHtml = html;
      _printerBayLastPrinterId = printerId;
      _attachFileDeskEvents(el);
    }
  } catch (err) {
    if (!_printerBayLastHtml || _printerBayLastPrinterId !== printerId) {
      el.innerHTML = `<div class="detail-placeholder">Print Bay unavailable.</div>`;
    }
  }
}

function _attachFileDeskEvents(el) {
  el.querySelectorAll('[data-file-action="queue"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sourceId = btn.dataset.sourceId;
      const path = btn.dataset.path;
      const targetPrinter = btn.dataset.targetPrinter;
      if (targetPrinter) {
        _queueFileToPrinter({ sourceId, path, printerId: targetPrinter, button: btn });
        return;
      }
      const file = (_fileDeskTargets.find(t => t.id === sourceId)?.files || [])
        .find(f => (f.path || f.name) === path);
      const printers = _fileCompatiblePrinters(file);
      if (!printers.length) return;
      _openFileQueueDialog({ sourceId, path, file, printers });
    });
  });
  el.querySelector('#filedesk-source-upload')?.addEventListener('change', e => {
    const file = e.currentTarget.files?.[0];
    if (file) _uploadSourceModel(file);
    e.currentTarget.value = '';
  });
  el.querySelector('#printer-bay-source-upload')?.addEventListener('change', e => {
    const file = e.currentTarget.files?.[0];
    if (file) _uploadSourceModel(file);
    e.currentTarget.value = '';
  });
  el.querySelectorAll('[data-file-action="slice"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sourceId = btn.dataset.sourceId;
      const path = btn.dataset.path;
      const targetPrinter = btn.dataset.targetPrinter;
      const target = _fileDeskTargets.find(t => t.id === sourceId);
      const file = (target?.files || []).find(f => (f.path || f.name) === path);
      const printers = targetPrinter
        ? _latestPrinters.filter(p => p.id === targetPrinter)
        : _fileSliceTargets(file);
      if (!printers.length) return;
      _openSliceModelDialog({ sourceId, path, file, printers });
    });
  });
  el.querySelectorAll('[data-file-action="clear-sd"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = _fileDeskTargets.find(t => t.id === btn.dataset.sourceId);
      if (target?.kind === 'bambu') _openBambuSdClearDialog(target);
    });
  });
  el.querySelectorAll('.filedesk-select').forEach(inp => {
    inp.addEventListener('change', () => _updateFileDeskBulk(el, inp.dataset.sourceId));
  });
  el.querySelectorAll('.filedesk-select-all').forEach(inp => {
    inp.addEventListener('change', () => {
      el.querySelectorAll(`.filedesk-select[data-source-id="${CSS.escape(inp.dataset.sourceId)}"]`).forEach(rowInp => {
        rowInp.checked = inp.checked;
      });
      _updateFileDeskBulk(el, inp.dataset.sourceId);
    });
  });
  el.querySelectorAll('[data-file-action="copy-selected"]').forEach(btn => {
    btn.addEventListener('click', () => _copySelectedFiles(el, btn));
  });
  el.querySelectorAll('[data-file-action="delete-selected"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = _fileDeskTargets.find(t => t.id === btn.dataset.sourceId);
      const files = _selectedFileDeskRows(el, btn.dataset.sourceId);
      if (target && files.length) _openFileDeleteDialog({ target, files });
    });
  });
  el.querySelector('.printbay-vault')?.addEventListener('toggle', e => {
    _printBayVaultOpen = e.currentTarget.open;
  });
}

async function _queueFileToPrinter({ sourceId, path, printerId, button }) {
  const old = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Queued...';
  }
  try {
    const r = await fetch('/api/files/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId, path, printer_id: printerId }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || 'Unable to queue file');
    showToast('Added to queue', _latestPrinters.find(p => p.id === printerId)?.custom_name || printerId, 'success');
    _updateQueueBadge();
  } catch (err) {
    showToast('Queue failed', err.message || '', 'error');
    if (button) {
      button.disabled = false;
      button.textContent = old || 'Queue';
    }
  }
}

function _openFileQueueDialog({ sourceId, path, file, printers }) {
  document.querySelector('.filedesk-queue-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay filedesk-queue-dialog';
  overlay.innerHTML = `
    <div class="modal-box filedesk-queue-box" role="dialog" aria-modal="true" aria-label="Queue file">
      <div class="filedesk-queue-head">
        <div>
          <div class="mission-eyebrow">Queue File</div>
          <h3>${esc(file?.name || path || 'File')}</h3>
          <span>${esc(path || '')}</span>
        </div>
        <button class="filedesk-dialog-close" data-dialog-close aria-label="Close">x</button>
      </div>
      <div class="filedesk-queue-options">
        ${printers.map(p => `<button class="filedesk-printer-choice" data-printer-id="${esc(p.id)}">
          <strong>${esc(p.custom_name || p.model_name || p.id)}</strong>
          <span>${esc(p.shop_name || p.model_name || p.kind || '')}</span>
        </button>`).join('')}
      </div>
      <div class="filedesk-dialog-error" hidden></div>
      <div class="modal-actions">
        <button class="modal-btn" data-dialog-close>Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-dialog-close]')) {
      close();
      return;
    }
    const choice = e.target.closest('[data-printer-id]');
    if (!choice) return;
    const errEl = overlay.querySelector('.filedesk-dialog-error');
    overlay.querySelectorAll('.filedesk-printer-choice').forEach(b => { b.disabled = true; });
    choice.classList.add('is-working');
    choice.querySelector('span').textContent = 'Adding to queue...';
    fetch('/api/files/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_id: sourceId, path, printer_id: choice.dataset.printerId }),
    })
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.detail || 'Unable to queue file');
        close();
        location.hash = '#/queue';
      })
      .catch(err => {
        errEl.textContent = err.message || 'Unable to queue file';
        errEl.hidden = false;
        choice.classList.remove('is-working');
        overlay.querySelectorAll('.filedesk-printer-choice').forEach(b => { b.disabled = false; });
      });
  });
}

function _selectedFileDeskRows(root, sourceId) {
  return [...root.querySelectorAll(`.filedesk-select[data-source-id="${CSS.escape(sourceId)}"]:checked`)]
    .map(inp => ({ sourceId, path: inp.dataset.path, name: inp.dataset.name || inp.dataset.path }));
}

function _updateFileDeskBulk(root, sourceId) {
  const selected = _selectedFileDeskRows(root, sourceId);
  const total = root.querySelectorAll(`.filedesk-select[data-source-id="${CSS.escape(sourceId)}"]`).length;
  const bulk = root.querySelector(`[data-bulk-source="${CSS.escape(sourceId)}"]`);
  const all = root.querySelector(`.filedesk-select-all[data-source-id="${CSS.escape(sourceId)}"]`);
  if (bulk) {
    bulk.querySelector('.filedesk-bulk-count').textContent = selected.length
      ? `${selected.length} selected`
      : 'No files selected';
    bulk.querySelectorAll('button').forEach(btn => { btn.disabled = selected.length === 0; });
  }
  if (all) {
    all.checked = !!selected.length && selected.length === total;
    all.indeterminate = selected.length > 0 && selected.length < total;
  }
}

async function _copySelectedFiles(root, btn) {
  const files = _selectedFileDeskRows(root, btn.dataset.sourceId);
  if (!files.length) return;
  const old = btn.textContent;
  _printBayVaultOpen = true;
  btn.disabled = true;
  btn.textContent = 'Archiving';
  let copied = 0;
  let skipped = 0;
  try {
    for (const file of files) {
      let data = await _copyOneFileToLibrary(file, false);
      if (data?.conflict) {
        const replace = await _confirmLibraryReplace(data.name || file.name);
        if (!replace) {
          skipped += 1;
          continue;
        }
        data = await _copyOneFileToLibrary(file, true);
      }
      copied += 1;
    }
    showToast(
      'Copied to Print Vault',
      `${copied} archived${skipped ? ` · ${skipped} skipped` : ''}`,
      'success'
    );
    _fileDeskLastHtml = '';
    if (parseRoute().view === 'printer' && parseRoute().subtab === 'bay') _renderPrinterBayBody(parseRoute().id);
    else renderFileDeskView();
  } catch (err) {
    showToast('Copy failed', err.message || '', 'error');
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function _copyOneFileToLibrary(file, replace) {
  const r = await fetch('/api/files/library/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_id: file.sourceId, path: file.path, replace }),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 409) {
    const detail = data.detail || {};
    if (detail.code === 'exists') {
      return { conflict: true, name: detail.name || file.name };
    }
  }
  if (!r.ok) {
    const detail = data.detail;
    const msg = typeof detail === 'string' ? detail : detail?.message;
    throw new Error(msg || `Unable to copy ${file.name}`);
  }
  return data;
}

function _confirmLibraryReplace(name) {
  return new Promise(resolve => {
    document.querySelector('.filedesk-replace-dialog')?.remove();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay filedesk-replace-dialog';
    overlay.innerHTML = `
      <div class="modal-box filedesk-queue-box" role="dialog" aria-modal="true" aria-label="Replace existing file">
        <div class="filedesk-queue-head">
          <div>
            <div class="mission-eyebrow">Print Vault</div>
            <h3>File already exists</h3>
            <span>${esc(name)} is already in the Print Vault.</span>
          </div>
          <button class="filedesk-dialog-close" data-replace-choice="skip" aria-label="Close">x</button>
        </div>
        <div class="filedesk-replace-copy">Replace the existing file?</div>
        <div class="modal-actions">
          <button class="modal-btn" data-replace-choice="skip">Skip</button>
          <button class="modal-btn modal-btn-danger" data-replace-choice="replace">Replace</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const finish = value => {
      overlay.remove();
      resolve(value);
    };
    overlay.addEventListener('click', e => {
      if (e.target === overlay) finish(false);
      const choice = e.target.closest('[data-replace-choice]')?.dataset.replaceChoice;
      if (choice) finish(choice === 'replace');
    });
  });
}

function _openFileDeleteDialog({ target, files }) {
  document.querySelector('.filedesk-delete-dialog')?.remove();
  const count = files.length;
  const list = files.slice(0, 5).map(f => `<li>${esc(f.name || f.path)}</li>`).join('');
  const more = count > 5 ? `<li>${count - 5} more...</li>` : '';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay filedesk-delete-dialog';
  overlay.innerHTML = `
    <div class="modal-box filedesk-queue-box" role="dialog" aria-modal="true" aria-label="Delete file">
      <div class="filedesk-queue-head">
        <div>
          <div class="mission-eyebrow">Delete Files</div>
          <h3>Delete ${count} selected file${count === 1 ? '' : 's'}?</h3>
          <span>${esc(target.label || target.id)}</span>
        </div>
        <button class="filedesk-dialog-close" data-dialog-close aria-label="Close">x</button>
      </div>
      <ul class="filedesk-delete-list">${list}${more}</ul>
      <label class="filedesk-confirm-label">
        Type DELETE to confirm
        <input class="filedesk-confirm-input" autocomplete="off" spellcheck="false">
      </label>
      <div class="filedesk-dialog-error" hidden></div>
      <div class="modal-actions">
        <button class="modal-btn" data-dialog-close>Cancel</button>
        <button class="modal-btn modal-btn-danger" data-delete-confirm>Delete file</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('.filedesk-confirm-input');
  const errEl = overlay.querySelector('.filedesk-dialog-error');
  const confirmBtn = overlay.querySelector('[data-delete-confirm]');
  const close = () => overlay.remove();
  const run = async () => {
    const confirm = input.value.trim();
    if (confirm.toUpperCase() !== 'DELETE') {
      errEl.textContent = 'Type DELETE to unlock this action.';
      errEl.hidden = false;
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Deleting...';
    try {
      let deleted = 0;
      for (const file of files) {
        const r = await fetch('/api/files', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_id: target.id, path: file.path, confirm }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.detail || `Unable to delete ${file.name}`);
        deleted += 1;
      }
      showToast('Files deleted', `${deleted} file${deleted === 1 ? '' : 's'} removed`, 'success');
      close();
      if (parseRoute().view === 'printer' && parseRoute().subtab === 'bay') _renderPrinterBayBody(parseRoute().id);
      else renderFileDeskView();
    } catch (err) {
      errEl.textContent = err.message || 'Unable to delete file';
      errEl.hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Delete file';
    }
  };
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-dialog-close]')) close();
    if (e.target.closest('[data-delete-confirm]')) run();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') run();
  });
  setTimeout(() => input.focus(), 0);
}

function _openBambuSdClearDialog(target) {
  document.querySelector('.filedesk-clear-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay filedesk-clear-dialog';
  overlay.innerHTML = `
    <div class="modal-box filedesk-queue-box" role="dialog" aria-modal="true" aria-label="Clear Bambu SD prints">
      <div class="filedesk-queue-head">
        <div>
          <div class="mission-eyebrow">Bambu SD</div>
          <h3>Clear printable files from ${esc(target.label || target.id)}</h3>
          <span>This deletes .3mf print jobs from the SD root. Utility folders are left alone.</span>
        </div>
        <button class="filedesk-dialog-close" data-dialog-close aria-label="Close">x</button>
      </div>
      <label class="filedesk-confirm-label">
        Type CLEAR to confirm
        <input class="filedesk-confirm-input" autocomplete="off" spellcheck="false">
      </label>
      <div class="filedesk-dialog-error" hidden></div>
      <div class="modal-actions">
        <button class="modal-btn" data-dialog-close>Cancel</button>
        <button class="modal-btn modal-btn-danger" data-clear-confirm>Clear SD prints</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('.filedesk-confirm-input');
  const errEl = overlay.querySelector('.filedesk-dialog-error');
  const confirmBtn = overlay.querySelector('[data-clear-confirm]');
  const close = () => overlay.remove();
  const run = async () => {
    const confirm = input.value.trim();
    if (confirm.toUpperCase() !== 'CLEAR') {
      errEl.textContent = 'Type CLEAR to unlock this action.';
      errEl.hidden = false;
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Clearing...';
    try {
      const r = await fetch(`/api/files/bambu/${encodeURIComponent(target.id)}/clear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Unable to clear SD files');
      showToast('Bambu SD cleaned', `${data.deleted?.length || 0} print files removed`, 'success');
      close();
      if (parseRoute().view === 'printer' && parseRoute().subtab === 'bay') _renderPrinterBayBody(parseRoute().id);
      else renderFileDeskView();
    } catch (err) {
      errEl.textContent = err.message || 'Unable to clear SD files';
      errEl.hidden = false;
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Clear SD prints';
    }
  };
  overlay.addEventListener('click', e => {
    if (e.target === overlay || e.target.closest('[data-dialog-close]')) close();
    if (e.target.closest('[data-clear-confirm]')) run();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') run();
  });
  setTimeout(() => input.focus(), 0);
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

function _queuePreflightModal(jobId, filename, preflight) {
  const issues = Array.isArray(preflight?.issues) ? preflight.issues : [];
  const rows = issues.length
    ? issues.map(i => `<li class="queue-preflight-issue queue-preflight-${i.level}">${esc(i.message)}</li>`).join('')
    : '<li class="queue-preflight-issue">No issues found.</li>';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-message">Filament check · #${jobId}</div>
      ${filename ? `<div class="modal-submessage">${esc(filename)}</div>` : ''}
      <div class="queue-preflight-issues">
        <span class="queue-preflight queue-preflight-${preflight?.status || 'warning'}">
          ${esc(preflight?.status || 'UNKNOWN')}
        </span>
      </div>
      <ul class="queue-preflight-report">${rows}</ul>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-danger" id="queue-preflight-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#queue-preflight-close').addEventListener('click', close);
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
  if (_printerPrintLocked(p)) signals.push({ level: 'bad', text: `Dispatch locked: ${_printerLockoutReason(p)}` });
  if (p.state === 'offline') signals.push({ level: 'bad', text: 'Offline' });
  if (p.state === 'error' || p.state === 'estop') signals.push({ level: 'bad', text: p.error || 'Fault active' });
  if (p.state === 'paused') signals.push({ level: 'warn', text: 'Paused print' });
  const loaded = spools.filter(s => s.location_printer_id === p.id && !s.archived_at);
  const mismatches = _amsMismatchSignals(p, loaded);
  mismatches.forEach(m => signals.push({
    level: 'warn',
    text: m.label,
    title: m.title,
    slotIndex: m.slotIndex,
    slotLabel: m.slotLabel,
    printerId: p.id,
  }));
  const dueMaint = (maint[p.id] || []).filter(i => !i.archived_at && (i.status === 'due' || i.due));
  if (dueMaint.length) signals.push({ level: 'warn', text: `${dueMaint.length} maintenance item${dueMaint.length === 1 ? '' : 's'} due` });
  const failedQueue = jobs.filter(j => j.status === 'failed').length;
  if (failedQueue) signals.push({ level: 'warn', text: `${failedQueue} failed queue job${failedQueue === 1 ? '' : 's'}` });
  if (!signals.length && !jobs.length && p.state === 'idle') signals.push({ level: 'ok', text: 'Idle and available' });
  return signals.slice(0, 4);
}

function _missionSignalHtml(signal) {
  const title = signal.title || signal.text;
  if (signal.slotIndex != null) {
    const target = {
      type: 'slot',
      printerId: signal.printerId,
      slotIndex: Number(signal.slotIndex),
      slotLabel: signal.slotLabel || `S${Number(signal.slotIndex) + 1}`,
      title,
    };
    return `<button class="mission-signal mission-signal-${signal.level} mission-signal-button"${_warningTargetAttrs(target)}>${esc(signal.text)}</button>`;
  }
  return `<span class="mission-signal mission-signal-${signal.level}" title="${esc(title)}">${esc(signal.text)}</span>`;
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
  if (_printerPrintLocked(p)) return `Dispatch locked: ${_printerLockoutReason(p)}`;
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
  if (_printerPrintLocked(p)) {
    return { printer: p, score: -999, blocked: true, reasons: [`locked: ${_printerLockoutReason(p)}`] };
  }
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

  if (_healthIsActionable(p.health) && p.health?.status === 'attention') {
    score -= 20;
    reasons.push('action needed');
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

function _missionActionInbox(jobs, printers, spools, maint) {
  const items = [];
  const add = (level, title, detail, href) => items.push({ level, title, detail, href });

  _moistureWatch(_statsRhReadings(printers))
    .filter(item => item.level !== 'ok' && item.persistent)
    .forEach(item => {
      add(item.level === 'bad' ? 'bad' : 'warn', item.title, item.detail, '#/stats?focus=rh');
    });

  printers.forEach(p => {
    const name = _dashboardPrinterName(p);
    if (_printerPrintLocked(p)) {
      add('bad', `${name} dispatch locked`, _printerLockoutReason(p), `#/printer/${p.id}`);
    }
    if (p.state === 'estop' || p.state === 'error') {
      add('bad', `${name} fault`, p.error || 'Printer is in a fault state', `#/printer/${p.id}`);
    } else if (p.state === 'offline') {
      add('bad', `${name} offline`, fmtLastSeen(p.last_seen), `#/printer/${p.id}`);
    } else if (p.state === 'paused') {
      add('warn', `${name} paused`, 'Resolve or cancel the active print', `#/printer/${p.id}`);
    }

    const dueMaint = (maint[p.id] || []).filter(i => !i.archived_at && (i.status === 'due' || i.due));
    if (dueMaint.length) {
      const label = dueMaint.slice(0, 2).map(i => i.name || i.title || 'maintenance').join(', ');
      add('warn', `${name} maintenance`, `${label}${dueMaint.length > 2 ? ` +${dueMaint.length - 2}` : ''}`, `#/printer/${p.id}/maintenance`);
    }
  });

  _missionDedupPendingJobs(jobs).forEach(job => {
    const name = String(job.filename || '').replace(/.*[\\/]/, '');
    const p = printers.find(x => x.id === job.printer_id);
    const printerName = p ? _dashboardPrinterName(p) : job.printer_id;
    if (job.status === 'failed') {
      add('bad', `Queue failed`, `${printerName} · ${name}`, '#/queue');
      return;
    }
    if (job.status !== 'pending' || !job.preflight) return;

    const blockers = (job.preflight.issues || []).filter(i => i.level === 'block' || i.level === 'wait');
    const warnings = (job.preflight.issues || []).filter(i => i.level === 'warn');
    if (blockers.length) {
      add('bad', `Blocked queue`, `${printerName} · ${blockers[0].message}`, '#/queue');
    } else if (warnings.length) {
      add('warn', `Queue caution`, `${printerName} · ${warnings[0].message}`, '#/queue');
    }
  });

  const rank = { bad: 0, warn: 1, ok: 2 };
  const unique = [];
  const seen = new Set();
  items
    .sort((a, b) => rank[a.level] - rank[b.level] || a.title.localeCompare(b.title))
    .forEach(item => {
      const key = `${item.level}:${item.title}:${item.detail}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    });

  if (!unique.length) {
    return `<div class="mission-action-empty">
      <strong>Clear deck</strong>
      <span>No current operator actions</span>
    </div>`;
  }

  return unique.slice(0, 7).map(item => `
    <a class="mission-action-item mission-action-${item.level}" href="${item.href}">
      <span>${esc(item.title)}</span>
      <strong>${esc(item.detail)}</strong>
    </a>`).join('');
}

async function renderMissionControl() {
  const el = document.getElementById('mission-page');
  if (!el) return;
  if (_missionRenderInFlight) return;
  _missionRenderInFlight = true;
  if (!_missionLastHtml) {
    el.innerHTML = `<div class="detail-placeholder">Loading Flight Tower...</div>`;
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
      ${prefs.sim ? '<a class="mission-sim-toggle" href="#/fleet">View Fleet Wall</a>' : ''}
    </div>`;

    const lanes = filteredContexts.map(({ p, laneJobs, signals, bucket }) => {
      const activeJob = _activePrinterJob(p) ? jobDisplayName(_activePrinterJob(p)) : '';
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
          <span class="badge badge-${_printerDisplayStateClass(p)}">${esc(_printerDisplayStateLabel(p))}</span>
        </div>
        <div class="mission-now">
          <span>Now</span>
          <strong>${activeJob ? esc(activeJob) : esc(_missionRecommendation(p, laneJobs, signals))}</strong>
        </div>
        <div class="mission-timeline">${queueHtml}${queueMore}</div>
        <div class="mission-loaded">${_missionLoadedLine(p, spools)}</div>
        <div class="mission-signals">
          ${signals.map(_missionSignalHtml).join('')}
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
          <div class="mission-eyebrow">Flight Tower</div>
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
          <div class="mission-panel-title">Action Inbox</div>
          <div class="mission-action-list">${_missionActionInbox(jobs, printers, spools, maint)}</div>
          <div class="mission-panel-title">Legend</div>
          <div class="mission-note">Action Inbox is for current operator work. Reliability history stays on dashboard cards and Failure Review.</div>
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
      el.innerHTML = `<div class="detail-placeholder">Flight Tower unavailable.</div>`;
    }
  } finally {
    _missionRenderInFlight = false;
  }
}

function _queueJobCard(job, isFirst, isLast) {
  const isPending   = job.status === 'pending';
  const isActive    = job.status === 'printing' || job.status === 'uploading';
  const isRecoverable = job.status === 'failed' || job.status === 'cancelled';
  const previewSrc  = job.has_preview ? _mediaUrl(`/api/queue/${job.id}/preview`, job.filename || 'Queued print') : '';
  const preflight = job.preflight;
  const isSourceModel = _queueJobIsSourceModel(job);
  const canSend = !preflight || preflight.can_start;
  const meta = [
    isSourceModel ? 'STEP source model' : '',
    job.filament_type || '',
    job.filament_weight_g ? `${Math.round(job.filament_weight_g)}g` : '',
    job.estimated_seconds ? _fmtSeconds(job.estimated_seconds) : '',
  ].filter(Boolean).join(' · ');

  return `<div class="queue-job ${isActive ? 'queue-job-active' : ''}" data-job-id="${job.id}">
    <div class="queue-job-thumb">
      ${previewSrc
        ? `<img src="${previewSrc}" alt="" loading="lazy">`
        : `<div class="queue-job-thumb-placeholder">${isSourceModel ? 'STEP' : '🖨'}</div>`}
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
        ${isSourceModel ? `<button class="queue-act-btn queue-act-slice" data-action="slice" data-id="${job.id}" data-printer-id="${esc(job.printer_id)}" data-filename="${esc(job.filename || '')}" title="Slice source model">Slice</button>` : ''}
        <button class="queue-act-btn queue-act-send" data-action="send"   data-id="${job.id}" title="${canSend ? 'Send now' : 'Preflight blocked'}" ${canSend ? '' : 'disabled'}>▶</button>
        <button class="queue-act-btn queue-act-check" data-action="check"  data-id="${job.id}" title="Run filament check">FIL</button>
        <button class="queue-act-btn queue-act-del"  data-action="delete" data-id="${job.id}" title="Remove">✕</button>
      ` : isRecoverable ? `
        <button class="queue-act-btn queue-act-retry" data-action="retry"  data-id="${job.id}" title="Retry">↺</button>
        <button class="queue-act-btn queue-act-del"   data-action="delete" data-id="${job.id}" title="Remove">✕</button>
      ` : ''}
    </div>
  </div>`;
}

function _queuePrinterSection(printerId, printerLabel, jobs, kind) {
  const accept   = kind === 'bambu' ? '.3mf,.gcode.3mf,.step,.stp' : '.gcode,.gcode.gz,.ufp,.step,.stp';
  const acceptedText = kind === 'bambu' ? '.gcode.3mf / .step' : '.gcode / .step';
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
        <span class="queue-upload-text">Drop ${acceptedText} or click to browse</span>
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
      btn.disabled = false;
      _modal.show('Remove this job from the queue?', async () => {
        btn.disabled = true;
        try {
          await fetch(`/api/queue/${id}`, { method: 'DELETE' });
          await renderQueueView();
        } catch (err) {
          showToast('Queue action failed', err.message || '', 'error');
          btn.disabled = false;
        }
      });
      return;
    } else if (action === 'up' || action === 'down') {
      await fetch(`/api/queue/${id}/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: action }),
      });
    } else if (action === 'send') {
      await fetch(`/api/queue/${id}/send`, { method: 'POST' });
    } else if (action === 'slice') {
      const printer = _latestPrinters.find(p => p.id === (printerId || btn.dataset.printerId));
      if (!printer) throw new Error('Target printer not found');
      btn.disabled = false;
      _openSliceModelDialog({
        sourceId: 'queue',
        path: id,
        file: { name: btn.dataset.filename || `Queue job #${id}`, path: `Queue job #${id}` },
        printers: [printer],
      });
      return;
    } else if (action === 'check') {
      const r = await fetch(`/api/queue/${id}/preflight`);
      if (!r.ok) throw new Error((await r.json())?.detail || `Queue preflight ${r.status}`);
      const payload = await r.json();
      _queuePreflightModal(id, payload?.filename || null, payload?.preflight || {});
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
    showToast('Queue action failed', err.message || '', 'error');
  }
}


// ── Print Watch ───────────────────────────────────────────────────────────

let _fleetWallSignature = '';
let _fleetWallMode = localStorage.getItem('fleetWallMode') || 'medium';

function _safeFleetWallMode(mode) {
  return ['xsmall', 'small', 'medium', 'large'].includes(mode) ? mode : 'medium';
}

function _fleetWallModeControls() {
  _fleetWallMode = _safeFleetWallMode(_fleetWallMode);
  return `<div class="fleet-wall-mode" role="group" aria-label="Fleet Wall size">
    ${[
      ['xsmall', 'XS'],
      ['small', 'Small'],
      ['medium', 'Medium'],
      ['large', 'Large'],
    ].map(([mode, label]) => `<button type="button"
      class="${_fleetWallMode === mode ? 'active' : ''}"
      data-fleet-wall-mode="${mode}">${label}</button>`).join('')}
  </div>`;
}

function _camHeaderInner(p) {
  const badgeLabel = _printerDisplayStateLabel(p);
  const badgeClass = _printerDisplayStateClass(p);
  return `<div class="printer-identity">
    <div class="printer-icon">${getIcon(p.icon)}</div>
    ${connDot(p.last_seen)}
    <div class="printer-names">
      <span class="printer-custom">${esc(_printerPrimaryLabel(p))}</span>
      ${_printerModelHtml(p)}
    </div>
  </div>
  <span class="badge badge-${badgeClass}">${esc(badgeLabel)}</span>`;
}

function _cameraStreamSrc(printerId) {
  const url = _cameraUrlCache[printerId];
  if (!url) return null;
  if (FLIGHTDECK_DEMO && url.startsWith('data:')) return url;
  return `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;
}

function _setCameraImageSrc(img, baseUrl, key = 't') {
  if (!img || !baseUrl) return;
  img.src = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${key}=${Date.now()}`;
  img.dataset.streamLoadedAt = String(Date.now());
}

function _loadCameraUrl(printerId, onResolved) {
  if (!printerId || _cameraUrlCache[printerId] !== undefined) return Promise.resolve(_cameraUrlCache[printerId] || null);
  if (_cameraUrlFetches[printerId]) return _cameraUrlFetches[printerId];
  _cameraUrlFetches[printerId] = fetch(`/api/printers/${encodeURIComponent(printerId)}/camera`)
    .then(async r => {
      const body = r.ok ? await r.json() : null;
      _cameraUrlCache[printerId] = body?.url || null;
      return _cameraUrlCache[printerId];
    })
    .catch(() => {
      _cameraUrlCache[printerId] = null;
      return null;
    })
    .finally(() => {
      delete _cameraUrlFetches[printerId];
      onResolved?.(printerId, _cameraUrlCache[printerId] || null);
    });
  return _cameraUrlFetches[printerId];
}

function _attachCameraRetries(root) {
  root.querySelectorAll('img[data-camera-id]').forEach(img => {
    if (img.dataset.retryAttached === '1') return;
    img.dataset.retryAttached = '1';
    img.dataset.streamLoadedAt = img.dataset.streamLoadedAt || String(Date.now());
    let tries = 0;
    img.addEventListener('error', () => {
      if (tries >= 3) return;
      tries += 1;
      const url = _cameraUrlCache[img.dataset.cameraId];
      if (!url) return;
      setTimeout(() => {
        _setCameraImageSrc(img, url, 'retry');
      }, 1200 * tries);
    });
    img.addEventListener('load', () => {
      tries = 0;
      img.dataset.streamLoadedAt = String(Date.now());
    });
  });
}

function _refreshVisibleCameraStreams(force = false) {
  if (FLIGHTDECK_DEMO || document.hidden) return;
  const now = Date.now();
  document.querySelectorAll('img[data-camera-id]').forEach(img => {
    const cameraId = img.dataset.cameraId;
    const url = _cameraUrlCache[cameraId];
    if (!url || url.startsWith('data:')) return;
    const rect = img.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) return;
    const loadedAt = Number(img.dataset.streamLoadedAt || 0);
    if (!force && loadedAt && (now - loadedAt) < _CAMERA_STREAM_REFRESH_MS) return;
    _setCameraImageSrc(img, url, 'refresh');
  });
}

function _camTileHtml(p) {
  return `<div class="cam-tile ${p._simulated ? 'cam-tile-sim' : ''}" data-printer-id="${p.id}" data-target-id="${p._source_id || p.id}" tabindex="0">
    <div class="cam-tile-header">${_camHeaderInner(p)}</div>
    ${p._simulated ? '<div class="cam-sim-ribbon">Simulated camera</div>' : ''}
    <div class="cam-tile-feed">${_camTileFeedHtml(p)}</div>
  </div>`;
}

function _camTileFeedHtml(p) {
  const cameraId = p._camera_id || p.id;
  const camSrc = _cameraStreamSrc(cameraId);
  return (camSrc && p.state !== 'offline')
    ? `<img src="${camSrc}" alt="${p.custom_name}" data-camera-id="${cameraId}">`
    : _cameraOfflineContent(p, 'cam-tile-offline');
}

function _printWatchAttention(p) {
  if (!p) return null;
  const loaded = _latestSpoolsByPrinter[p.id] || [];
  const amsWarning = _amsMismatchSignals(p, loaded)[0];
  if (amsWarning) return amsWarning.title || amsWarning.label || 'AMS review';
  if (_healthIsActionable(p.health)) return p.health?.reasons?.[0]?.message || 'Open printer attention';
  if (p.state === 'offline' || p.state === 'error' || p.state === 'estop' || p.state === 'paused') {
    return _dashboardIssueText(p);
  }
  return null;
}

function _printWatchFocusPrinter(printers) {
  const fleet = printers || [];
  if (!fleet.length) return null;
  const attentionPrinters = fleet.filter(p => _printWatchAttention(p));
  if (_printWatchAutoPinPaused && !attentionPrinters.length) _printWatchAutoPinPaused = false;
  if (_printWatchManualPinnedId) {
    const manual = fleet.find(p => String(p.id) === String(_printWatchManualPinnedId));
    if (manual) {
      _printWatchPinnedId = manual.id;
      return manual;
    }
    _printWatchManualPinnedId = '';
  }
  const attention = _printWatchAutoPinPaused ? null : attentionPrinters[0];
  if (attention) {
    _printWatchPinnedId = attention.id;
    return attention;
  }
  if (_printWatchPinnedId) _printWatchPinnedId = '';
  _printWatchFocusIndex = Math.max(0, Math.min(_printWatchFocusIndex, fleet.length - 1));
  return fleet[_printWatchFocusIndex % fleet.length];
}

function _printWatchPinnedCount(printers) {
  if (_printWatchManualPinnedId) return 1;
  const autoCount = _printWatchAutoPinPaused ? 0 : (printers || []).filter(p => _printWatchAttention(p)).length;
  return autoCount;
}

function _printWatchSummaryHtml(printers) {
  const pinned = _printWatchPinnedCount(printers);
  return `${_fleetWallMetric('Feeds', String((printers || []).length))}
    ${_fleetWallMetric('Pinned', String(pinned), pinned ? 'hot' : '')}
    ${_fleetWallMetric('Mode', pinned ? 'Hold' : 'Cycle')}`;
}

function _printWatchFocusHtml(printers, sim = false, focusPrinter = null) {
  const p = focusPrinter || _printWatchFocusPrinter(printers);
  if (!p) return `<section class="print-watch-focus"><div class="detail-placeholder">Connecting...</div></section>`;
  const cameraId = p._camera_id || p.id;
  const camSrc = _cameraStreamSrc(cameraId);
  const activeJob = _activePrinterJob(p);
  const pct = activeJob?.progress != null ? `${Math.round(activeJob.progress * 100)}%` : _printerDisplayStateLabel(p);
  const attention = _printWatchAttention(p);
  const manualPinned = String(_printWatchManualPinnedId) === String(p.id);
  const autoPinned = !!attention && String(_printWatchPinnedId) === String(p.id);
  const pinned = manualPinned || autoPinned;
  const mode = pinned ? 'Pinned' : 'Cycling';
  const pinTitle = pinned ? 'Unpin and continue cycling' : 'Pin this camera';
  const feed = (camSrc && p.state !== 'offline')
    ? `<img src="${camSrc}" alt="${esc(_printerPrimaryLabel(p))} print watch camera" data-camera-id="${esc(cameraId)}" loading="eager" fetchpriority="high">`
    : _cameraOfflineContent(p, 'print-watch-offline');
  return `<section class="print-watch-focus ${pinned ? 'print-watch-focus-pinned' : ''}" data-print-watch-focus="${esc(p.id)}" data-print-watch-camera="${esc(cameraId)}">
    <div class="print-watch-focus-head">
      <div class="printer-identity">
        <div class="printer-icon">${getIcon(p.icon)}</div>
        ${connDot(p.last_seen)}
        <div class="printer-names">
          <span class="printer-custom">${esc(_printerPrimaryLabel(p))}</span>
          ${_printerModelHtml(p)}
        </div>
      </div>
      <div class="print-watch-focus-status">
        <button type="button" class="print-watch-mode print-watch-pin-btn ${pinned ? 'is-pinned' : ''}" data-print-watch-pin data-printer-id="${esc(p.id)}" title="${esc(pinTitle)}">${esc(pinned ? 'Pinned' : 'Pin')}</button>
        <span class="fleet-wall-state fleet-wall-state-${_fleetWallTone(p)}">${esc(_printerDisplayStateLabel(p))}</span>
      </div>
    </div>
    <a class="print-watch-feed" href="#/printer/${esc(p._source_id || p.id)}" data-printer-id="${esc(p._source_id || p.id)}">
      ${feed}
      <div class="camera-hud print-watch-hud">
        <div class="camera-hud-main">
          <strong>${esc(activeJob ? jobDisplayName(activeJob) : (attention || 'Watching print bay'))}</strong>
          <span>${esc(attention || `${pct} · ${fmtLastSeen(p.last_seen)}`)}</span>
        </div>
        <div class="camera-hud-progress"><span style="width:${activeJob?.progress != null ? Math.max(0, Math.min(100, Math.round(activeJob.progress * 100))) : 0}%"></span></div>
        <div class="camera-hud-chips">${_detailLiveTempChips(p, sim ? 2 : 3)}</div>
      </div>
    </a>
  </section>`;
}

function _togglePrintWatchPin(printerId) {
  const current = String(printerId || '');
  if (!current) return;
  const attention = _printWatchAttention((_latestPrinters || []).find(p => p.id === current));
  if (_printWatchManualPinnedId === current || _printWatchPinnedId === current) {
    _printWatchManualPinnedId = '';
    _printWatchPinnedId = '';
    if (attention) _printWatchAutoPinPaused = true;
  } else {
    _printWatchManualPinnedId = current;
    _printWatchPinnedId = current;
    _printWatchAutoPinPaused = false;
  }
  renderCamerasView();
}

function _renderPrintWatchFocus(printers, sim = false) {
  const host = document.getElementById('print-watch-focus-host');
  if (!host) return;
  const p = _printWatchFocusPrinter(printers);
  const cameraId = p ? (p._camera_id || p.id) : '';
  const existing = host.querySelector('[data-print-watch-focus]');
  if (!existing || !p || existing.dataset.printWatchFocus !== String(p.id) || existing.dataset.printWatchCamera !== String(cameraId)) {
    host.innerHTML = _printWatchFocusHtml(printers, sim, p);
    _attachCameraRetries(host);
    return;
  }

  const next = document.createElement('div');
  next.innerHTML = _printWatchFocusHtml(printers, sim, p);
  const nextFocus = next.firstElementChild;
  if (!nextFocus) return;

  existing.className = nextFocus.className;
  existing.dataset.printWatchFocus = nextFocus.dataset.printWatchFocus || '';
  existing.dataset.printWatchCamera = nextFocus.dataset.printWatchCamera || '';

  const currentHead = existing.querySelector('.print-watch-focus-head');
  const nextHead = nextFocus.querySelector('.print-watch-focus-head');
  if (currentHead && nextHead) currentHead.innerHTML = nextHead.innerHTML;

  const currentHud = existing.querySelector('.print-watch-hud');
  const nextHud = nextFocus.querySelector('.print-watch-hud');
  if (currentHud && nextHud) currentHud.innerHTML = nextHud.innerHTML;

  const currentFeed = existing.querySelector('.print-watch-feed');
  const nextFeed = nextFocus.querySelector('.print-watch-feed');
  if (currentFeed && nextFeed) {
    currentFeed.href = nextFeed.getAttribute('href') || currentFeed.href;
    currentFeed.dataset.printerId = nextFeed.dataset.printerId || '';
    const currentIsImg = !!currentFeed.querySelector('img[data-camera-id]');
    const nextIsImg = !!nextFeed.querySelector('img[data-camera-id]');
    if (currentIsImg !== nextIsImg) currentFeed.innerHTML = nextFeed.innerHTML;
  }
  _attachCameraRetries(host);
}

function _startPrintWatchCycle(printers, sim = false) {
  if (_printWatchTimer) return;
  _printWatchTimer = setInterval(() => {
    const fleet = sim
      ? _missionSimPrinters(_latestPrinters || []).map(p => {
          const source = (_latestPrinters || []).find(x => p.id.startsWith(`${x.id}-sim-`)) || (_latestPrinters || [])[0];
          return { ...p, _simulated: true, _source_id: source?.id || p.id, _camera_id: source?.id || p.id };
        })
      : (_latestPrinters || []);
    if (!fleet.length || _printWatchPinnedId) return;
    _printWatchFocusIndex = (_printWatchFocusIndex + 1) % fleet.length;
    _renderPrintWatchFocus(fleet, sim);
  }, 8000);
}

function _ensurePrintWatchCameraUrls(printers) {
  (printers || []).forEach(p => {
    const cameraId = p._camera_id || p.id;
    if (_cameraUrlCache[cameraId] !== undefined || _cameraUrlFetches[cameraId]) return;
    _loadCameraUrl(cameraId, () => {
      if (parseRoute().view === 'cameras') renderCamerasView();
    });
  });
}

function _fleetWallTone(p) {
  if (_printerPrintLocked(p)) return 'locked';
  if (p.state === 'error' || p.state === 'estop') return 'critical';
  if (p.state === 'paused' || p.state === 'offline' || _healthIsActionable(p.health)) return 'watch';
  if (p.state === 'printing') return 'active';
  return 'ready';
}

function _fleetWallMetric(label, value, tone = '') {
  return `<div class="fleet-wall-metric ${tone ? `fleet-wall-metric-${tone}` : ''}">
    <span>${esc(label)}</span>
    <strong>${esc(value || '—')}</strong>
  </div>`;
}

function _fleetWallJob(p) {
  const job = p.job || {};
  const active = _activePrinterJob(p);
  const faultStates = ['offline', 'error', 'estop', 'paused'];
  const name = active
    ? jobDisplayName(job)
    : p.state === 'finished' && job.filename
      ? jobDisplayName(job)
      : _printerPrintLocked(p)
        ? 'Dispatch locked'
        : faultStates.includes(p.state)
          ? _dashboardIssueText(p)
          : 'Ready for dispatch';
  const pct = job.progress != null ? Math.max(0, Math.min(100, Math.round(job.progress * 100))) : (p.state === 'finished' ? 100 : 0);
  const eta = job.eta_seconds != null
    ? formatEta(p.eta_calibration?.ratio != null ? Math.round(job.eta_seconds * p.eta_calibration.ratio) : job.eta_seconds)
    : '';
  const layers = job.layer_current != null && job.layer_total != null ? `${job.layer_current}/${job.layer_total}` : '';
  const meta = [
    p.state === 'printing' || p.state === 'paused' ? `${pct}%` : _printerDisplayStateLabel(p),
    eta ? `ETA ${eta}` : '',
    layers ? `Layer ${layers}` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="fleet-wall-job">
    <div class="fleet-wall-job-title" title="${esc(name || '')}">${esc(name || 'Standing by')}</div>
    <div class="fleet-wall-progress"><span style="width:${pct}%"></span></div>
    <div class="fleet-wall-job-meta">${esc(meta || fmtLastSeen(p.last_seen))}</div>
  </div>`;
}

function _fleetWallBoard(p) {
  const job = _activePrinterJob(p);
  let title = 'Ready for dispatch';
  let detail = 'Printer is available when the queue needs it.';
  let tone = 'ready';
  if (_printerPrintLocked(p)) {
    title = 'On hold';
    detail = _printerLockoutReason(p);
    tone = 'locked';
  } else if (p.state === 'printing') {
    title = job ? jobDisplayName(job) : 'Printing';
    detail = job?.eta_seconds ? _liveEtaText(p) : 'Print in progress';
    tone = 'active';
  } else if (p.state === 'paused') {
    title = 'Paused';
    detail = p.error || (job ? jobDisplayName(job) : 'Operator attention required');
    tone = 'watch';
  } else if (p.state === 'error' || p.state === 'estop') {
    title = _liveStateLabel(p.state);
    detail = p.error || 'Printer fault active';
    tone = 'critical';
  } else if (p.state === 'offline') {
    title = 'Offline';
    detail = fmtLastSeen(p.last_seen);
    tone = 'watch';
  } else if (_healthIsActionable(p.health) && p.health?.reasons?.[0]?.message) {
    title = 'Needs review';
    detail = p.health.reasons[0].message;
    tone = 'watch';
  }
  return `<div class="fleet-wall-board fleet-wall-board-${tone}">
    <span>Wall board</span>
    <strong>${esc(title)}</strong>
    <small>${esc(detail)}</small>
  </div>`;
}

function _fleetWallWarnings(p) {
  const loaded = _latestSpoolsByPrinter[p.id] || [];
  const warnings = [];
  if (_printerPrintLocked(p)) warnings.push(`Locked: ${_printerLockoutReason(p)}`);
  if (p.state === 'error' || p.state === 'estop') warnings.push(p.error || _liveStateLabel(p.state));
  if (p.state === 'offline') warnings.push(fmtLastSeen(p.last_seen));
  if (p.state === 'paused') warnings.push(p.error || 'Paused');
  _amsMismatchSignals(p, loaded).slice(0, 2).forEach(w => warnings.push(w.label || w.title || 'AMS review'));
  loaded
    .filter(s => !s.archived_at && Number(s.label_weight_g || 0) > 0)
    .map(s => ({ s, pct: Math.round(Number(s.remaining_g || 0) * 100 / Number(s.label_weight_g || 1)) }))
    .filter(x => x.pct < _latestLowStockPct)
    .slice(0, 2)
    .forEach(({ s }) => {
      const grams = Math.max(0, Math.round(Number(s.remaining_g || 0)));
      const threshold = Math.max(10, Math.ceil(grams / 10) * 10);
      warnings.push(`#${s.id} <${threshold}g`);
    });
  if (!warnings.length) return `<div class="fleet-wall-clear">No active warnings</div>`;
  return `<div class="fleet-wall-warnings">${warnings.slice(0, 4).map(w => `<span>${esc(w)}</span>`).join('')}</div>`;
}

function _fleetWallHeaderFlags(p) {
  const flags = [];
  if (_healthIsActionable(p.health) && p.health?.reasons?.[0]?.message) {
    flags.push({ tone: 'watch', label: p.health.reasons[0].message });
  }
  if (_printerPrintLocked(p)) {
    flags.push({ tone: 'locked', label: `On hold: ${_printerLockoutReason(p)}` });
  }
  return flags.slice(0, 2).map(f =>
    `<span class="fleet-wall-head-flag fleet-wall-head-flag-${f.tone}" title="${esc(f.label)}">${esc(f.label)}</span>`
  ).join('');
}

function _fleetWallSpools(p) {
  const loaded = (_latestSpoolsByPrinter[p.id] || []).filter(s => !s.archived_at).slice(0, 8);
  if (!loaded.length) return `<div class="fleet-wall-spools-empty">No loaded spools tracked</div>`;
  return `<div class="fleet-wall-spools">${loaded.map(s => {
    const pct = Number(s.label_weight_g || 0) > 0
      ? Math.round(Number(s.remaining_g || 0) * 100 / Number(s.label_weight_g || 1))
      : null;
    const low = pct != null && pct < _latestLowStockPct;
    const tc = _spoolTextColor(s.color_hex || '#808080');
    const loc = s.location_slot != null ? _amsSlotLabel(p, Number(s.location_slot)) : 'Loaded';
    return `<a class="fleet-wall-spool ${low ? 'fleet-wall-spool-low' : ''}" href="#/spool/${s.id}" style="${_spoolColorStyle(s)};color:${tc}" title="${esc(`${loc} · ${s.material || ''} ${s.color_name || ''}`)}">
      <strong>#${s.id}</strong>
      <span>${esc(s.color_name || s.material || loc)}</span>
    </a>`;
  }).join('')}</div>`;
}

function _fleetWallAmsStrip(p) {
  const units = p.ams || [];
  if (!units.length) return '';
  const rows = units.slice(0, 3).map(unit => {
    const slots = (unit.slots || []).slice(0, 6);
    const label = unit.label || unit.name || 'AMS';
    return `<div class="fleet-wall-ams-unit">
      <span>${esc(label)}</span>
      <div>${slots.map(slot => {
        const rawColour = String(slot.color || slot.colour || slot.color_hex || '').trim().replace(/^#?([0-9a-fA-F]{6}).*$/, '#$1');
        const colour = _safeCssHex(rawColour, '#2f3440');
        const empty = slot.empty || slot.status === 'empty';
        const active = !!(slot.active || slot.current || slot.in_use);
        return `<button class="fleet-wall-ams-dot${empty ? ' is-empty' : ''}${active ? ' is-active' : ''}"
          data-slot-edit data-printer-id="${esc(p.id)}" data-slot-index="${Number(slot.flat_index ?? slot.idx ?? 0)}" data-slot-label="${esc(slot.label || `S${Number(slot.idx || 0) + 1}`)}"
          style="--dot:${esc(colour)}" title="${esc(slot.material || slot.label || 'AMS slot')}"></button>`;
      }).join('')}</div>
    </div>`;
  }).join('');
  return `<div class="fleet-wall-ams">${rows}</div>`;
}

function _fleetWallAmsVisual(p) {
  if (!p.ams?.length) return _fleetWallSpools(p);
  return `<div class="fleet-wall-ams-visual">${_detailLiveAmsLoadoutRows(p)}</div>`;
}

function _fleetWallFeedHtml(p) {
  const cameraId = p._camera_id || p.id;
  const camSrc = _cameraStreamSrc(cameraId);
  return camSrc && p.state !== 'offline'
    ? `<img src="${camSrc}" alt="${esc(_printerPrimaryLabel(p))} live camera" data-camera-id="${cameraId}" loading="eager" fetchpriority="high">`
    : `<div class="fleet-wall-camera-fallback">
        <div class="fleet-wall-printer-glyph">${getIcon(p.icon)}</div>
        <strong>${esc(_printerPrimaryLabel(p))}</strong>
        <span>${esc(p.state === 'offline' ? fmtLastSeen(p.last_seen) : 'No camera feed')}</span>
      </div>`;
}

function _fleetWallCardBody(p) {
  const tone = _fleetWallTone(p);
  const temps = p.temps || {};
  const hotend = temps.hotend_l || temps.hotend || temps.hotend_r || {};
  const bed = temps.bed || {};
  const chamber = temps.chamber || {};
  const activeJob = _activePrinterJob(p);
  return `
    <div class="fleet-wall-card-main">
      <div class="fleet-wall-status-row">
        <span class="fleet-wall-state fleet-wall-state-${tone}">${esc(_printerDisplayStateLabel(p))}</span>
      </div>
      ${_fleetWallMode === 'large' ? _fleetWallBoard(p) : ''}
      ${_fleetWallJob(p)}
      <div class="fleet-wall-metrics">
        ${_fleetWallMetric('Hotend', hotend.actual != null ? `${_toDisplayTemp(hotend.actual)}${_tempUnitLabel()}` : '—', hotend.actual >= 180 ? 'hot' : '')}
        ${_fleetWallMetric('Bed', bed.actual != null ? `${_toDisplayTemp(bed.actual)}${_tempUnitLabel()}` : '—', bed.actual >= 50 ? 'warm' : '')}
        ${_fleetWallMetric('Chamber', chamber.actual != null ? `${_toDisplayTemp(chamber.actual)}${_tempUnitLabel()}` : '—')}
        ${_fleetWallMetric('Mode', activeJob ? 'In flight' : (_printerPrintLocked(p) ? 'On hold' : 'Available'))}
      </div>
      ${_fleetWallWarnings(p)}
      ${_fleetWallAmsVisual(p)}
      ${_fleetWallMode === 'large' ? `<div class="fleet-wall-extra">
        <span><b>Signal</b>${esc(fmtLastSeen(p.last_seen))}</span>
        <span><b>ID</b>${esc(p.id)}</span>
        <span><b>Type</b>${esc(p.kind || p.connection?.type || 'printer')}</span>
      </div>` : ''}
    </div>
    `;
}

function _fleetWallHeadHtml(p) {
  return `<div class="printer-identity">
    <div class="printer-icon">${getIcon(p.icon)}</div>
    ${connDot(p.last_seen)}
    <div class="printer-names">
      <span class="printer-custom">${esc(_printerPrimaryLabel(p))}</span>
      ${_printerModelHtml(p)}
    </div>
  </div>
  <div class="fleet-wall-head-right">
    ${_fleetWallHeaderFlags(p)}
    <span class="fleet-wall-kind">${esc(p.kind || p.connection?.type || 'printer')}</span>
  </div>`;
}

function _fleetWallCardHtml(p) {
  return `<article class="fleet-wall-card fleet-wall-card-${_fleetWallTone(p)}" data-printer-id="${esc(p.id)}">
    <div class="fleet-wall-card-head">
      ${_fleetWallHeadHtml(p)}
    </div>
    <a class="fleet-wall-feed" href="#/printer/${esc(p.id)}" data-fleet-feed="${esc(p.id)}" data-fleet-live="${esc(p.id)}">
      ${_fleetWallFeedHtml(p)}
    </a>
    <div class="fleet-wall-card-body">${_fleetWallCardBody(p)}</div>
  </article>`;
}

async function _ensureFleetWallCameraUrls(printers) {
  (printers || []).forEach(p => {
    if (_cameraUrlCache[p.id] !== undefined || _cameraUrlFetches[p.id]) return;
    _loadCameraUrl(p.id, printerId => {
      const page = document.getElementById('fleet-wall-page');
      if (!page || page.hidden || !page.classList.contains('fleet-wall-page')) return;
      const card = page.querySelector(`.fleet-wall-card[data-printer-id="${CSS.escape(printerId)}"]`);
      const printer = (_latestPrinters || []).find(x => x.id === printerId);
      const feed = card?.querySelector('[data-fleet-feed]');
      if (!printer || !feed || printer.state === 'offline') return;
      feed.innerHTML = _fleetWallFeedHtml(printer);
      _attachCameraRetries(feed);
      _fleetWallSignature = '';
    });
  });
}

async function renderFleetWall() {
  const el = document.getElementById('fleet-wall-page');
  _fleetWallMode = _safeFleetWallMode(_fleetWallMode);
  const printers = [...(_latestPrinters || [])].sort((a, b) =>
    _dashboardStateRank(a) - _dashboardStateRank(b) ||
    _dashboardPrinterName(a).localeCompare(_dashboardPrinterName(b))
  );
  if (!printers.length) {
    el.innerHTML = `<div class="fleet-wall-empty">
      <strong>No printers on the wall yet</strong>
      <a href="#/settings/printers">Add printer</a>
    </div>`;
    _fleetWallSignature = '';
    return;
  }

  _ensureFleetWallCameraUrls(printers);

  const signature = `${_fleetWallMode}|${printers.map(p => `${p.id}:${_cameraUrlCache[p.id] ? 'cam' : 'nocam'}`).join('|')}`;
  if (_fleetWallSignature !== signature || !el.querySelector('.fleet-wall-grid')) {
    const active = printers.filter(p => ['printing', 'paused'].includes(p.state)).length;
    const attention = printers.filter(p => _printerWarningTarget(p) || _printerPrintLocked(p)).length;
    el.className = `fleet-wall-page fleet-wall-${_fleetWallMode}`;
    el.innerHTML = `<div class="fleet-wall-hero">
      <div>
        <span>Fleet Wall</span>
        <h1>Shop floor live</h1>
      </div>
      ${_fleetWallModeControls()}
      <div class="fleet-wall-summary">
        ${_fleetWallMetric('Printers', String(printers.length))}
        ${_fleetWallMetric('Active', String(active), active ? 'warm' : '')}
        ${_fleetWallMetric('Attention', String(attention), attention ? 'hot' : '')}
      </div>
    </div>
    <div class="fleet-wall-grid">
      ${printers.map(_fleetWallCardHtml).join('')}
    </div>`;
    _fleetWallSignature = signature;
    _attachCameraRetries(el);
    el.querySelectorAll('[data-fleet-wall-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        _fleetWallMode = _safeFleetWallMode(btn.dataset.fleetWallMode);
        localStorage.setItem('fleetWallMode', _fleetWallMode);
        _fleetWallSignature = '';
        renderFleetWall();
      });
    });
  } else {
    el.className = `fleet-wall-page fleet-wall-${_fleetWallMode}`;
    printers.forEach(p => {
      const card = el.querySelector(`.fleet-wall-card[data-printer-id="${CSS.escape(p.id)}"]`);
      if (!card) return;
      card.className = `fleet-wall-card fleet-wall-card-${_fleetWallTone(p)}`;
      const head = card.querySelector('.fleet-wall-card-head');
      if (head) head.innerHTML = _fleetWallHeadHtml(p);
      const body = card.querySelector('.fleet-wall-card-body');
      if (body) body.innerHTML = _fleetWallCardBody(p);
      const feed = card.querySelector('[data-fleet-feed]');
      const hasImg = !!feed?.querySelector('img[data-camera-id]');
      const shouldImg = !!_cameraStreamSrc(p.id) && p.state !== 'offline';
      if (feed && hasImg !== shouldImg) feed.innerHTML = _fleetWallFeedHtml(p);
    });
  }

  const active = printers.filter(p => ['printing', 'paused'].includes(p.state)).length;
  const attention = printers.filter(p => _printerWarningTarget(p) || _printerPrintLocked(p)).length;
  const summary = el.querySelector('.fleet-wall-summary');
  if (summary) {
    summary.innerHTML = `
      ${_fleetWallMetric('Printers', String(printers.length))}
      ${_fleetWallMetric('Active', String(active), active ? 'warm' : '')}
      ${_fleetWallMetric('Attention', String(attention), attention ? 'hot' : '')}`;
  }
  _attachCameraRetries(el);
}

async function renderCamerasView() {
  const el = document.getElementById('cameras-grid');
  const sim = (location.hash || '').includes('sim=30');
  const mode = sim ? 'sim30' : 'live';
  if (_printWatchTimer && _camerasMode !== mode) {
    clearInterval(_printWatchTimer);
    _printWatchTimer = null;
  }
  const sourcePrinters = _latestPrinters || [];
  const cameraPrinters = sim
    ? _missionSimPrinters(sourcePrinters).map(p => {
        const source = sourcePrinters.find(x => p.id.startsWith(`${x.id}-sim-`)) || sourcePrinters[0];
        return { ...p, _simulated: true, _source_id: source?.id || p.id, _camera_id: source?.id || p.id };
      })
    : sourcePrinters;

  if (_camerasFull && _camerasMode === mode) {
    const summary = el.querySelector('.print-watch-summary');
    if (summary) summary.innerHTML = _printWatchSummaryHtml(cameraPrinters);
    cameraPrinters.forEach(p => {
      const tile = el.querySelector(`.cam-tile[data-printer-id="${p.id}"]`);
      const header = tile?.querySelector('.cam-tile-header');
      if (header) header.innerHTML = _camHeaderInner(p);
      const feed = tile?.querySelector('.cam-tile-feed');
      if (feed) {
        const next = _camTileFeedHtml(p);
        const currentIsImg = !!feed.querySelector('img[data-camera-id]');
        const nextIsImg = next.includes('<img ');
        if (currentIsImg !== nextIsImg || !nextIsImg) {
          feed.innerHTML = next;
        }
      }
    });
    _attachCameraRetries(el);
    return;
  }

  if (!sourcePrinters.length) {
    el.innerHTML = `<div class="detail-placeholder">Connecting…</div>`;
    return;
  }

  _ensurePrintWatchCameraUrls(cameraPrinters);

  el.classList.toggle('cameras-grid-sim', sim);
  el.innerHTML = `<div class="print-watch-page print-watch-page-parked">
    <div class="print-watch-hero">
      <div>
        <span>Camera Wall</span>
        <h1>${sim ? 'Simulated camera grid' : 'Camera grid'}</h1>
      </div>
      <div class="print-watch-summary">
        ${_printWatchSummaryHtml(cameraPrinters)}
      </div>
    </div>
    <div class="print-watch-grid">${cameraPrinters.map(_camTileHtml).join('')}</div>
  </div>`;
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
let _notificationsOpen = false;

function _notifAge(ts) {
  const d = parseUtcDate(ts);
  if (!d) return '';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function _notifLevelClass(level) {
  return ['success', 'error', 'warn', 'info'].includes(level) ? level : 'info';
}

async function loadNotifications(markRead = false) {
  const panel = document.getElementById('notif-panel');
  const countEl = document.getElementById('notif-count');
  try {
    const data = await fetch('/api/notifications').then(r => r.json());
    if (countEl) {
      countEl.hidden = !data.unread;
      countEl.textContent = data.unread > 9 ? '9+' : String(data.unread || '');
    }
    if (panel && _notificationsOpen) {
      const items = data.items || [];
      panel.innerHTML = `
        <div class="notif-panel-head">
          <div><strong>Notifications</strong><span>${items.length ? `${items.length} recent` : 'Clear skies'}</span></div>
          <button class="notif-clear-all"${items.length ? '' : ' disabled'}>Clear all</button>
        </div>
        <div class="notif-list">
          ${items.length ? items.map(n => `
            <div class="notif-item notif-item-${_notifLevelClass(n.level)}${n.read_at ? '' : ' notif-item-unread'}" data-id="${n.id}">
              <a class="notif-item-main" href="${esc(n.link || '#/')}">
                <strong>${esc(n.title)}</strong>
                <span>${esc(n.message || '')}</span>
                <small>${esc(_notifAge(n.created_at))} ago</small>
              </a>
              <button class="notif-clear-one" title="Clear notification">x</button>
            </div>
          `).join('') : '<div class="notif-empty">No notifications.</div>'}
        </div>
        ${('Notification' in window && window.isSecureContext && Notification.permission !== 'granted')
          ? '<button class="notif-browser-enable">Enable browser notifications</button>' : ''}`;
      if (markRead && data.unread) {
        fetch('/api/notifications/read', { method: 'POST' }).then(() => loadNotifications(false)).catch(() => {});
      }
    }
  } catch {}
}

function _closeNotifications() {
  const panel = document.getElementById('notif-panel');
  _notificationsOpen = false;
  if (panel) panel.hidden = true;
}

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
    loadNotifications(false);

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
  const panel = document.getElementById('notif-panel');
  if (!btn) return;
  const update = () => {
    const supported = ('Notification' in window) && window.isSecureContext;
    const perm = supported ? Notification.permission : 'unavailable';
    btn.classList.toggle('notif-on',          perm === 'granted');
    btn.classList.toggle('notif-off',         perm === 'denied');
    btn.classList.toggle('notif-unavailable', perm === 'unavailable');
    btn.title = perm === 'granted' ? 'Alerts'
              : perm === 'denied'  ? 'Alerts · browser notifications blocked in site settings'
              : 'Alerts';
  };
  update();
  loadNotifications(false);
  btn.addEventListener('click', e => {
    e.stopPropagation();
    _notificationsOpen = !_notificationsOpen;
    if (panel) panel.hidden = !_notificationsOpen;
    if (_notificationsOpen) loadNotifications(true);
  });
  panel?.addEventListener('click', async e => {
    e.stopPropagation();
    const enable = e.target.closest('.notif-browser-enable');
    if (enable && 'Notification' in window && Notification.permission !== 'denied') {
      await Notification.requestPermission();
      update();
      loadNotifications(false);
      return;
    }
    const clearAll = e.target.closest('.notif-clear-all');
    if (clearAll && !clearAll.disabled) {
      await fetch('/api/notifications', { method: 'DELETE' }).catch(() => {});
      loadNotifications(false);
      return;
    }
    const clearOne = e.target.closest('.notif-clear-one');
    if (clearOne) {
      const item = clearOne.closest('.notif-item');
      if (item?.dataset.id) await fetch(`/api/notifications/${item.dataset.id}`, { method: 'DELETE' }).catch(() => {});
      loadNotifications(false);
      return;
    }
    const link = e.target.closest('.notif-item-main');
    if (link) _closeNotifications();
  });
  document.addEventListener('click', _closeNotifications);
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
  const printerCards = sortedPrinters.length
    ? `${sortedPrinters.map(renderCard).join('')}${_renderAddPrinterCard()}`
    : _renderAddPrinterCard(true);
  grid.innerHTML = `${_renderDashboardBriefing(sortedPrinters)}${printerCards}`;

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
    `<span>${esc(_footerInstanceText())}</span>` +
    `<span>${printers.length} printers · ${active} active · ${idle} idle</span>`;
}

let _statsRenderInFlight = false;
let _statsLastHtml = '';

function _statsPct(value, total) {
  if (!total || total <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round(value * 100 / total)));
}

function _statsStateCounts(printers) {
  return printers.reduce((acc, p) => {
    const state = p.state || 'unknown';
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {});
}

function _statsBarRows(rows, opts = {}) {
  const items = (rows || []).filter(r => Number(r.grams || r.count || 0) > 0).slice(0, opts.limit || 8);
  const total = opts.total ?? items.reduce((sum, r) => sum + Number(r.grams || r.count || 0), 0);
  if (!items.length) return `<div class="stats-empty">No data yet</div>`;
  return `<div class="stats-bars">${items.map(r => {
    const value = Number(r.grams || r.count || 0);
    const label = opts.label ? opts.label(r) : (r.material || r.key || r.printer_id || 'Unknown');
    const display = opts.value ? opts.value(r) : (r.grams != null ? _fmtGrams(r.grams) : String(r.count || 0));
    return `<div class="stats-bar-row">
      <div class="stats-bar-label"><span>${esc(label)}</span><strong>${esc(display)}</strong></div>
      <div class="stats-bar-track"><div class="stats-bar-fill" style="width:${_statsPct(value, total)}%"></div></div>
    </div>`;
  }).join('')}</div>`;
}

function _statsMonthRows(rows) {
  const items = [...(rows || [])].reverse();
  if (!items.length) return `<div class="stats-empty">Usage timeline will appear after completed prints with spool deductions.</div>`;
  const max = Math.max(...items.map(r => Number(r.grams || 0)), 1);
  const total = items.reduce((sum, r) => sum + Number(r.grams || 0), 0);
  const youngTrend = items.length < 2 || total < 250;
  return `<div class="stats-month-wrap">
    ${youngTrend ? `<div class="stats-note">Filament trend is warming up from completed prints. More deducted prints will build the shape over time.</div>` : ''}
    <div class="stats-months">${items.map(r => {
    const [y, mo] = String(r.month || '').split('-');
    const label = y && mo ? new Date(+y, +mo - 1).toLocaleString('default', { month: 'short' }) : r.month;
    const grams = Number(r.grams || 0);
    return `<div class="stats-month">
      <strong class="stats-month-value">${esc(_fmtGrams(grams))}</strong>
      <div class="stats-month-bar" style="height:${_statsPct(grams, max)}%"></div>
      <span>${esc(label || '')}</span>
    </div>`;
  }).join('')}</div>
  </div>`;
}

function _statsPrinterRows(printers, filamentSummary, failureSummary, allSpools = [], usageSummary = []) {
  const byPrinter = Object.fromEntries((filamentSummary.by_printer || []).map(r => [r.printer_id, r.grams]));
  const failures = Object.fromEntries((failureSummary.by_printer || []).map(r => [r.key, r.count]));
  const usage = Object.fromEntries((usageSummary || []).map(r => [r.printer_id, r]));
  if (!printers.length) return `<div class="stats-empty">No printers configured.</div>`;
  return `<div class="stats-printer-list">${printers.map(p => {
    const loaded = allSpools.filter(s => s.location_printer_id === p.id && !s.archived_at);
    const loadedG = loaded.reduce((sum, s) => sum + Number(s.remaining_g || 0), 0);
    const u = usage[p.id] || {};
    const hours = Number(u.total_seconds || 0) / 3600;
    return `<a class="stats-printer-row" href="#/printer/${p.id}">
      <div>
        <strong>${esc(_dashboardPrinterName(p))}</strong>
        <span>${esc(p.custom_name || '')}</span>
      </div>
      <div><b>${esc(p.state || 'unknown')}</b><span>state</span></div>
      <div><b>${Number(u.total_prints || 0)}</b><span>prints</span></div>
      <div><b>${hours ? hours.toFixed(1) : '0'}h</b><span>print time</span></div>
      <div><b>${_fmtGrams(byPrinter[p.id] || 0)}</b><span>used</span></div>
      <div><b>${_fmtGrams(loadedG)}</b><span>loaded</span></div>
      <div><b>${failures[p.id] || 0}</b><span>failures</span></div>
    </a>`;
  }).join('')}</div>`;
}

function _statsRhReadings(printers) {
  const rows = [];
  printers.forEach(p => {
    (p.ams || []).forEach(unit => {
      if (unit.humidity == null) return;
      const rh = Number(unit.humidity);
      rows.push({
        id: `${p.id}:${unit.unit ?? unit.label ?? rows.length}`,
        printerId: p.id,
        printer: _dashboardPrinterName(p),
        custom: p.custom_name || '',
        href: `#/printer/${p.id}`,
        label: unit.label || `AMS ${Number(unit.unit || 0) + 1}`,
        rh,
        temp: unit.temperature,
        drying: !!unit.drying,
      });
    });
  });
  return rows.sort((a, b) => b.rh - a.rh || a.printer.localeCompare(b.printer));
}

function _statsRhClass(rh) {
  if (rh >= 45) return 'bad';
  if (rh >= 35) return 'warn';
  return 'ok';
}

function _moistureWatchState(readings) {
  const now = Date.now();
  const key = 'fd_moisture_watch_state_v1';
  let state = _moistureWatchMemory;
  try {
    if (typeof localStorage !== 'undefined') {
      state = JSON.parse(localStorage.getItem(key) || '{}') || state;
    }
  } catch {}
  const live = new Set((readings || []).map(r => r.id));
  Object.keys(state).forEach(id => { if (!live.has(id)) delete state[id]; });
  (readings || []).forEach(r => {
    const level = _statsRhClass(r.rh);
    if (level === 'ok') {
      delete state[r.id];
      return;
    }
    const prev = state[r.id];
    state[r.id] = prev && prev.level === level
      ? { ...prev, lastSeen: now, rh: r.rh }
      : { level, since: now, lastSeen: now, rh: r.rh };
  });
  _moistureWatchMemory = state;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(state));
  } catch {}
  return { state, now };
}

function _durationLabel(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
}

function _moistureWatch(readings) {
  const { state, now } = _moistureWatchState(readings);
  return (readings || []).map(r => {
    const cls = _statsRhClass(r.rh);
    const tracked = state[r.id];
    const ageMs = tracked ? now - Number(tracked.since || now) : 0;
    const persistent = cls === 'bad' ? ageMs >= 5 * 60000 : cls === 'warn' ? ageMs >= 15 * 60000 : false;
    const age = tracked ? _durationLabel(ageMs) : '';
    const title = cls === 'bad'
      ? persistent ? 'Drying suggested' : 'Drying threshold'
      : cls === 'warn'
        ? persistent ? 'Moisture watch' : 'Moisture rising'
        : 'Stable';
    const detail = `${r.label} · ${r.printer} · ${Math.round(r.rh)}% RH${age ? ` · ${age}` : ''}${r.drying ? ' · drying' : ''}`;
    return { ...r, level: cls, title, detail, persistent, age };
  });
}

function _statsRhPanel(readings) {
  if (!readings.length) return `<div class="stats-empty">No AMS humidity telemetry yet.</div>`;
  return `<div class="stats-rh-list">${readings.map(r => {
    const cls = _statsRhClass(r.rh);
    const temp = r.temp != null ? `${Math.round(Number(r.temp) * 10) / 10}°C` : '--°C';
    return `<a class="stats-rh-row stats-rh-${cls}" href="${r.href}">
      <div>
        <strong>${esc(r.label)} · ${esc(r.printer)}</strong>
        <span>${esc(r.custom)}${r.drying ? ' · drying' : ''}</span>
      </div>
      <div>
        <b>${Math.round(r.rh)}% RH</b>
        <span>${esc(temp)}</span>
      </div>
    </a>`;
  }).join('')}</div>`;
}

function _statsMoistureWatchPanel(readings) {
  const watch = _moistureWatch(readings);
  if (!watch.length) return `<div class="stats-empty">No AMS humidity telemetry yet.</div>`;
  const active = watch.filter(w => w.level !== 'ok');
  const rows = (active.length ? active : watch.slice(0, 3)).map(w => `
    <a class="stats-moisture-row stats-moisture-${w.level}" href="${w.href}">
      <div>
        <strong>${esc(w.title)}</strong>
        <span>${esc(w.detail)}</span>
        ${w.level !== 'ok' && !w.persistent ? '<em>Tracking before Flight Tower alert</em>' : ''}
      </div>
      <b>${w.level === 'bad' ? 'Dry' : w.level === 'warn' ? 'Watch' : 'Stable'}</b>
    </a>`).join('');
  return `<div class="stats-moisture-list">${rows}</div>`;
}

function _statsRhDetail(readings) {
  if (!readings.length) return '';
  const highest = readings[0];
  const risk = _statsRhClass(highest.rh);
  const riskText = risk === 'bad'
    ? 'Drying strongly suggested'
    : risk === 'warn'
      ? 'Keep an eye on this bay'
      : 'Humidity is in a comfortable range';
  return `<section class="stats-drill-panel stats-rh-drill stats-rh-drill-${risk}" id="rh">
    <div class="stats-panel-head">
      <span>Humidity Detail</span>
      <a href="#/stats">Telemetry</a>
    </div>
    <div class="stats-rh-focus">
      <div>
        <strong>${Math.round(highest.rh)}% RH</strong>
        <span>${esc(highest.label)} · ${esc(highest.printer)}</span>
      </div>
      <p>${riskText}</p>
    </div>
    <div class="stats-panel-head stats-panel-subhead"><span>Moisture Watch</span></div>
    ${_statsMoistureWatchPanel(readings)}
    <div class="stats-panel-head stats-panel-subhead"><span>All Sensors</span></div>
    ${_statsRhPanel(readings)}
  </section>`;
}

function _statsActionSummary(jobs, printers) {
  const pending = jobs.filter(j => j.status === 'pending').length;
  const blocked = jobs.filter(j => _missionJobReadiness(j).cls === 'blocked').length;
  const active = printers.filter(p => p.state === 'printing' || p.state === 'paused').length;
  const offline = printers.filter(p => p.state === 'offline').length;
  const cls = blocked || offline ? 'stats-pulse-bad' : pending || active ? 'stats-pulse-watch' : 'stats-pulse-ok';
  const label = blocked ? `${blocked} blocked` : offline ? `${offline} offline` : pending ? `${pending} queued` : active ? `${active} active` : 'clear';
  return `<div class="stats-pulse ${cls}">
    <span>Operator pulse</span>
    <strong>${esc(label)}</strong>
  </div>`;
}

function _statsHealthTone(pct, warn = 70, bad = 85) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 'ok';
  if (n >= bad) return 'bad';
  if (n >= warn) return 'warn';
  return 'ok';
}

function _statsHealthCard(label, value, detail, tone = 'ok') {
  return `<div class="stats-system-card stats-system-${tone}">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
    <small>${esc(detail || '')}</small>
  </div>`;
}

function _statsSystemHealthPanel(instance) {
  const info = instance || _instanceInfo || {};
  const host = info.host || {};
  const load = host.load || {};
  const memory = host.memory || {};
  const disk = host.disk || {};
  const cameraWorkers = info.camera_workers || {};
  const loadPct = Number(load.pct);
  const memoryPct = Number(memory.pct);
  const diskPct = Number(disk.pct);
  const cameraTone = cameraWorkers.ok === false ? 'bad' : 'ok';
  const loadText = Number.isFinite(Number(load.one))
    ? `${Number(load.one).toFixed(2)}`
    : '--';
  const memoryText = Number.isFinite(memoryPct)
    ? `${Math.round(memoryPct)}%`
    : '--';
  const diskText = Number.isFinite(diskPct)
    ? `${Math.round(diskPct)}%`
    : '--';
  const hardware = info.hardware || info.address || 'Flightdeck host';
  const runtime = [info.runtime, info.address].filter(Boolean).join(' · ') || 'local runtime';
  return `<div class="stats-panel stats-panel-wide stats-system-panel">
    <div class="stats-panel-head"><span>System Health</span><a href="#/settings?category=setup">Setup</a></div>
    <div class="stats-system-grid">
      ${_statsHealthCard('Host', hardware, runtime, 'ok')}
      ${_statsHealthCard('CPU Load', loadText, Number.isFinite(loadPct) ? `${Math.round(loadPct)}% of ${load.cores || 1} cores` : 'unavailable', _statsHealthTone(loadPct, 65, 90))}
      ${_statsHealthCard('Memory', memoryText, `${_fmtBytes(memory.used)} used · ${_fmtBytes(memory.available)} free`, _statsHealthTone(memoryPct, 72, 88))}
      ${_statsHealthCard('Data Disk', diskText, `${_fmtBytes(disk.free)} free`, _statsHealthTone(diskPct, 75, 90))}
      ${_statsHealthCard('Camera Workers', cameraWorkers.count == null ? '--' : String(cameraWorkers.count), cameraWorkers.detail || 'not checked', cameraTone)}
    </div>
  </div>`;
}

async function renderStatsView() {
  const el = document.getElementById('stats-page');
  if (!el) return;
  if (_statsRenderInFlight) return;
  _statsRenderInFlight = true;
  if (!_statsLastHtml) el.innerHTML = `<div class="detail-placeholder" style="min-height:40vh">Loading telemetry...</div>`;
  const params = _routeParams('#/stats');
  const focus = params.get('focus') || '';

  try {
    const [filament, spools, allSpools, intel, failures, jobs, printerUsage, instance] = await Promise.all([
      fetch('/api/filament/summary').then(r => r.ok ? r.json() : {}),
      fetch('/api/spools/summary').then(r => r.ok ? r.json() : {}),
      fetch('/api/spools').then(r => r.ok ? r.json() : []),
      fetch('/api/spools/intelligence?days=30').then(r => r.ok ? r.json() : {}),
      fetch('/api/failures?days=30').then(r => r.ok ? r.json() : {}),
      fetch('/api/queue').then(r => r.ok ? r.json() : []),
      fetch('/api/printers/usage').then(r => r.ok ? r.json() : []),
      fetch('/api/instance').then(r => r.ok ? r.json() : (_instanceInfo || {})),
    ]);
    if (instance?.app) _instanceInfo = instance;

    const printers = _latestPrinters || [];
    const states = _statsStateCounts(printers);
    const totalPrints30 = (failures.summary?.by_printer || []).reduce((sum, r) => sum + Number(r.count || 0), 0);
    const spoolAlerts = intel.alerts || [];
    const topSpools = intel.by_spool || [];
    const active = printers.filter(p => p.state === 'printing' || p.state === 'paused').length;
    const rhReadings = _statsRhReadings(printers);
    const avgRh = rhReadings.length
      ? Math.round(rhReadings.reduce((sum, r) => sum + r.rh, 0) / rhReadings.length)
      : null;
    const maxRh = rhReadings.length ? Math.max(...rhReadings.map(r => r.rh)) : null;
    const html = `
      <div class="stats-page">
        <section class="stats-hero">
          <div>
            <div class="mission-eyebrow">Fleet Telemetry</div>
            <h1>Shop telemetry</h1>
            <p>${printers.length} printers · ${active} active · ${_fmtGrams(filament.total_grams || 0)} recorded filament · ${spools.total_count || 0} live spools</p>
          </div>
          ${_statsActionSummary(jobs, printers)}
        </section>

        <section class="stats-kpi-grid">
          <a class="stats-kpi-card" href="#/stats?focus=printers"><strong>${printers.length}</strong><span>Printers</span><small>${states.idle || 0} idle · ${active} active</small></a>
          <a class="stats-kpi-card" href="#/spools?view=catalogue"><strong>${_fmtGrams(filament.total_grams || 0)}</strong><span>Filament used</span><small>${filament.total_cost != null ? `$${filament.total_cost.toFixed(2)} estimated` : 'cost pending'}</small></a>
          <a class="stats-kpi-card" href="#/spools"><strong>${_fmtGrams(spools.total_remaining_g || 0)}</strong><span>Inventory</span><small>${spools.total_count || 0} spools · ${spools.in_printer_count || 0} loaded</small></a>
          <a class="stats-kpi-card ${maxRh != null && maxRh >= 35 ? 'stats-kpi-warn' : ''}" href="#/stats?focus=rh"><strong>${avgRh != null ? `${avgRh}%` : '--'}</strong><span>AMS RH</span><small>${maxRh != null ? `Max ${Math.round(maxRh)}% · ${rhReadings.length} sensors` : 'no telemetry'}</small></a>
          <a class="stats-kpi-card ${spools.low_stock_count ? 'stats-kpi-warn' : ''}" href="#/spools?filter=low"><strong>${spools.low_stock_count || 0}</strong><span>Low stock</span><small>Below ${Math.round(spools.low_stock_pct || 20)}%</small></a>
          <a class="stats-kpi-card ${failures.total ? 'stats-kpi-warn' : ''}" href="#/failures?days=30"><strong>${failures.total || 0}</strong><span>Failure review</span><small>Last 30 days</small></a>
        </section>

        ${focus === 'rh' ? _statsRhDetail(rhReadings) : ''}

        <section class="stats-layout">
          ${_statsSystemHealthPanel(instance)}
          <div class="stats-panel stats-panel-wide">
            <div class="stats-panel-head"><span>Filament Trend</span><a href="#/spools?view=catalogue">Catalogue</a></div>
            ${_statsMonthRows(filament.by_month || [])}
          </div>
          <div class="stats-panel">
            <div class="stats-panel-head"><span>By Material</span><a href="#/spools">Spools</a></div>
            ${_statsBarRows(filament.by_material || [], { total: filament.total_grams || 0 })}
          </div>
          <div class="stats-panel">
            <div class="stats-panel-head"><span>Inventory Mix</span><a href="#/spools">Open</a></div>
            ${_statsBarRows(spools.by_material || [], { total: spools.total_remaining_g || 0 })}
          </div>
          ${focus !== 'rh' ? `<div class="stats-panel">
            <div class="stats-panel-head"><span>AMS Humidity</span><a href="#/stats?focus=rh">Detail</a></div>
            ${_statsMoistureWatchPanel(rhReadings)}
          </div>` : ''}
          <div class="stats-panel">
            <div class="stats-panel-head"><span>AMS Sensors</span><a href="#/stats?focus=rh">Detail</a></div>
            ${_statsRhPanel(rhReadings)}
          </div>
          <div class="stats-panel">
            <div class="stats-panel-head"><span>Spool Tracking</span><a href="#/spools">Inventory</a></div>
            <div class="stats-alert-list">
              ${spoolAlerts.map(a => `<div class="stats-alert stats-alert-${a.level}">${esc(a.message)}</div>`).join('')}
            </div>
            <div class="stats-mini-grid">
              <div><strong>${_fmtGrams(intel.summary?.deducted_g || 0)}</strong><span>deducted 30d</span></div>
              <div><strong>${intel.summary?.tracked_prints || intel.summary?.deducted_prints || 0}</strong><span>tracked prints</span></div>
              <div><strong>${intel.summary?.unattributed_prints || 0}</strong><span>unattributed</span></div>
            </div>
          </div>
          <div class="stats-panel">
            <div class="stats-panel-head"><span>Most Used Spools</span><a href="#/spools">Manage</a></div>
            ${_statsBarRows(topSpools, {
              total: topSpools.reduce((sum, r) => sum + Number(r.grams || 0), 0),
              label: r => `#${r.spool_id} ${[r.color_name, r.material].filter(Boolean).join(' · ')}`,
            })}
          </div>
          <div class="stats-panel stats-panel-wide${focus === 'printers' ? ' stats-panel-focus' : ''}">
            <div class="stats-panel-head"><span>Printer Balance</span><a href="#/">Dashboard</a></div>
            ${_statsPrinterRows(printers, filament, failures.summary || {}, allSpools, printerUsage)}
          </div>
        </section>
      </div>`;

    if (html !== _statsLastHtml) {
      _statsLastHtml = html;
      el.innerHTML = html;
    }
  } catch (err) {
    if (!_statsLastHtml) el.innerHTML = `<div class="detail-placeholder">Telemetry unavailable.</div>`;
  } finally {
    _statsRenderInFlight = false;
  }
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
let _settingsPrinterEntries = [];

const _SETTINGS_CATEGORIES = [
  { id: 'setup',      label: 'Setup'      },
  { id: 'printers',   label: 'Printers'   },
  { id: 'hardware',   label: 'Hardware'   },
  { id: 'preferences', label: 'Preferences' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'slicer',     label: 'Slicer'     },
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
          : p.connection?.type === 'simulated'
            ? `simulated · ${p.connection.profile}${p.connection.scenario ? ` · ${p.connection.scenario}` : ''}`
            : `bambu · ${p.connection?.host ?? ''}`;
        return `<div class="settings-printer-row">
          <div class="printer-identity">
            <div class="printer-icon">${getIcon(p.icon ?? 'generic')}</div>
            <div class="printer-names">
              <span class="printer-custom">${esc(_printerPrimaryLabel(p))}</span>
              ${_printerModelHtml(p)}
            </div>
          </div>
          <div class="settings-printer-meta">
            <span class="settings-printer-type">${connInfo}</span>
            <label class="settings-printer-enable">
              <input type="checkbox" class="settings-printer-enable-input" data-printer-id="${p.id}"
                data-printer-name="${esc(p.custom_name || p.model_name || p.id)}"
                data-print-note="${esc(p.print_enabled_note || '')}"
                ${p.print_enabled ?? true ? 'checked' : ''}>
              Print enabled
            </label>
            ${!(p.print_enabled ?? true) && p.print_enabled_note ? `<span class="settings-printer-lock-note">${esc(p.print_enabled_note)}</span>` : ''}
            <button class="settings-edit-btn"
              data-edit-id="${esc(p.id)}">Edit</button>
            <button class="settings-delete-btn"
              data-delete-id="${esc(p.id)}"
              data-delete-name="${esc(p.custom_name)}">Remove</button>
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
      <div class="settings-section-title" id="settings-printer-form-title">Add Printer</div>
      <form id="settings-add-form" class="settings-form" novalidate>
        <input type="hidden" id="p-editing-id" value="">

        <div class="settings-form-row">
          <label class="settings-label">Connection Type</label>
          <div class="settings-type-toggle">
            <button type="button" class="type-btn type-btn-active" data-conn-type="moonraker">Moonraker</button>
            <button type="button" class="type-btn" data-conn-type="bambu">Bambu</button>
            <button type="button" class="type-btn" data-conn-type="simulated">Simulated</button>
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

        <div class="settings-form-group" id="simulated-fields" hidden>
          <div class="settings-form-row">
            <label class="settings-label" for="p-sim-profile">Simulator Profile</label>
            <select class="settings-input" id="p-sim-profile" style="max-width:14rem">
              <option value="prusalink">PrusaLink</option>
              <option value="reprap">RepRapFirmware</option>
              <option value="octoprint">OctoPrint</option>
              <option value="ideaformer">IdeaFormer IR3 V2</option>
            </select>
          </div>
          <div class="settings-form-row">
            <label class="settings-label" for="p-sim-scenario">Scenario</label>
            <select class="settings-input" id="p-sim-scenario" style="max-width:14rem">
              <option value="mixed">Mixed states</option>
              <option value="idle">Idle</option>
              <option value="printing">Printing</option>
              <option value="paused">Paused</option>
              <option value="error">Error</option>
            </select>
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
          <button type="button" class="ctrl-btn settings-cancel-edit-btn" id="settings-cancel-edit" hidden>Cancel Edit</button>
          <button type="submit" class="ctrl-btn">Add Printer</button>
        </div>

      </form>
    </div>`;
}

function _attachPrintersEvents(el) {
  let connType = 'moonraker';

  const setConnType = type => {
    connType = type;
    el.querySelectorAll('[data-conn-type]').forEach(b =>
      b.classList.toggle('type-btn-active', b.dataset.connType === connType)
    );
    el.querySelector('#moonraker-fields').hidden = connType !== 'moonraker';
    el.querySelector('#bambu-fields').hidden     = connType !== 'bambu';
    el.querySelector('#simulated-fields').hidden = connType !== 'simulated';
    if (connType === 'bambu') {
      el.querySelector('input[name="icon"][value="bambu"]').checked = true;
    } else if (connType === 'simulated') {
      el.querySelector('input[name="icon"][value="generic"]').checked = true;
    }
  };

  el.querySelectorAll('[data-conn-type]').forEach(btn => {
    btn.addEventListener('click', () => setConnType(btn.dataset.connType));
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

  el.querySelectorAll('[data-edit-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const printer = _settingsPrinterEntries.find(p => p.id === btn.dataset.editId);
      if (printer) _populatePrinterForm(el, printer, setConnType);
    });
  });

  el.querySelector('#settings-cancel-edit')?.addEventListener('click', () => {
    _resetPrinterForm(el, setConnType);
  });

  el.querySelectorAll('.settings-printer-enable-input').forEach(input => {
    input.addEventListener('change', e => _handlePrinterPrintEnabledToggle(e.currentTarget));
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
  } else if (connType === 'bambu') {
    const host       = v('p-bambu-host');
    const accessCode = v('p-access-code');
    const serial     = v('p-serial');
    const hasCam     = el.querySelector('#p-bambu-cam')?.checked;
    const conn       = { type: 'bambu', host, access_code: accessCode, serial };
    const camera     = hasCam ? { type: 'bambu_rtsp' } : null;
    return { ...base, connection: conn, ...(camera ? { camera } : {}) };
  }

  const profile = el.querySelector('#p-sim-profile')?.value || 'prusalink';
  const scenario = el.querySelector('#p-sim-scenario')?.value || 'mixed';
  return { ...base, connection: { type: 'simulated', profile, scenario } };
}

function _populatePrinterForm(el, printer, setConnType) {
  const form = el.querySelector('#settings-add-form');
  if (!form) return;
  const set = (id, value = '') => {
    const field = el.querySelector(`#${id}`);
    if (field) field.value = value ?? '';
  };
  const conn = printer.connection || { type: 'moonraker' };
  setConnType(conn.type || 'moonraker');
  set('p-editing-id', printer.id);
  set('p-id', printer.id);
  set('p-model', printer.model_name || '');
  set('p-custom', printer.custom_name || '');
  const icon = el.querySelector(`input[name="icon"][value="${printer.icon || 'generic'}"]`);
  if (icon) icon.checked = true;
  el.querySelector('#p-id').disabled = true;
  el.querySelector('#settings-printer-form-title').textContent = `Edit Printer · ${printer.id}`;
  el.querySelector('#settings-cancel-edit')?.removeAttribute('hidden');
  form.querySelector('button[type="submit"]').textContent = 'Save Changes';

  set('p-host', conn.type === 'moonraker' ? conn.host : '');
  set('p-port', conn.type === 'moonraker' ? (conn.port ?? 7125) : 7125);
  set('p-bambu-host', conn.type === 'bambu' ? conn.host : '');
  set('p-access-code', conn.type === 'bambu' ? conn.access_code : '');
  set('p-serial', conn.type === 'bambu' ? conn.serial : '');
  set('p-sim-profile', conn.type === 'simulated' ? conn.profile : 'prusalink');
  set('p-sim-scenario', conn.type === 'simulated' ? conn.scenario : 'mixed');

  const camera = printer.camera || null;
  const camType = camera?.type === 'mjpeg_direct' ? 'mjpeg_direct' : 'none';
  set('p-cam-type', camType);
  el.querySelector('#mjpeg-fields').hidden = camType !== 'mjpeg_direct';
  set('p-stream-url', camera?.stream_url || '');
  set('p-snap-url', camera?.snapshot_url || '');
  const bambuCam = el.querySelector('#p-bambu-cam');
  if (bambuCam) bambuCam.checked = camera?.type === 'bambu_rtsp' || conn.type === 'bambu';

  const presets = printer.temperature_presets || {};
  const byHotend = Object.fromEntries((presets.hotend || []).map(p => [p.label, p.value]));
  const byBed = Object.fromEntries((presets.bed || []).map(p => [p.label, p.value]));
  el.querySelectorAll('.preset-row').forEach(row => {
    const mat = row.querySelector('.preset-hotend').dataset.material;
    if (byHotend[mat] != null) row.querySelector('.preset-hotend').value = byHotend[mat];
    if (byBed[mat] != null) row.querySelector('.preset-bed').value = byBed[mat];
  });
  el.querySelector('#settings-form-error')?.setAttribute('hidden', '');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _resetPrinterForm(el, setConnType) {
  const form = el.querySelector('#settings-add-form');
  if (!form) return;
  form.reset();
  el.querySelector('#p-editing-id').value = '';
  el.querySelector('#p-id').disabled = false;
  el.querySelector('#settings-printer-form-title').textContent = 'Add Printer';
  el.querySelector('#settings-cancel-edit')?.setAttribute('hidden', '');
  form.querySelector('button[type="submit"]').textContent = 'Add Printer';
  el.querySelector('#settings-form-error')?.setAttribute('hidden', '');
  setConnType('moonraker');
  el.querySelector('#mjpeg-fields').hidden = true;
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
  } else if (connType === 'bambu') {
    if (!data.connection.host)        return fail('Host / IP is required');
    if (!data.connection.access_code) return fail('Access code is required');
    if (!data.connection.serial)      return fail('Serial number is required');
  }
  return true;
}

async function _submitAddPrinter(el, connType) {
  const errorEl   = el.querySelector('#settings-form-error');
  const submitBtn = el.querySelector('#settings-add-form button[type="submit"]');
  const editingId = el.querySelector('#p-editing-id')?.value || '';
  const data      = _collectFormData(el, connType);
  if (editingId) data.id = editingId;

  if (!_validateFormData(data, connType, errorEl)) return;

  const dup = await _checkDuplicateConnection(data, connType, editingId);
  if (dup) {
    const choice = await _showDuplicateModal(dup.custom_name, dup.id);
    if (choice !== 'continue') return;
  }

  const origText = submitBtn.textContent;
  submitBtn.textContent = editingId ? 'Saving…' : 'Adding…';
  submitBtn.disabled = true;

  try {
    const r    = await fetch(editingId ? `/api/config/printers/${encodeURIComponent(editingId)}` : '/api/config/printers', {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await r.json();
    if (r.ok) {
      showToast(editingId ? 'Printer updated' : 'Printer added', data.custom_name, 'success');
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

async function _checkDuplicateConnection(data, connType, ignoreId = '') {
  try {
    const r = await fetch('/api/config/printers');
    if (!r.ok) return null;
    const existing = await r.json();
    for (const p of existing) {
      if (ignoreId && p.id === ignoreId) continue;
      const conn = p.connection;
      if (connType === 'moonraker' && conn.type === 'moonraker') {
        if (conn.host === data.connection.host && conn.port === data.connection.port) return p;
      } else if (connType === 'bambu' && conn.type === 'bambu') {
        if (conn.host === data.connection.host || conn.serial === data.connection.serial) return p;
      } else if (connType === 'simulated' && conn.type === 'simulated') {
        if (p.id === data.id) return p;
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

async function _handlePrinterPrintEnabledToggle(target) {
  const id = target.dataset.printerId;
  const enabled = target.checked;
  let note = null;
  if (!enabled) {
    note = await _textareaModal({
      title: 'Why is this printer down?',
      message: `${target.dataset.printerName || id} will stay visible, but Flightdeck will not dispatch jobs to it.`,
      value: target.dataset.printNote || '',
      placeholder: 'e.g. blocked nozzle, needs bed clean, AMS jam, waiting on part',
      okLabel: 'Disable printing',
    });
    if (note === null) {
      target.checked = true;
      return;
    }
  }
  const ok = await setPrinterPrintEnabled(id, enabled, note);
  if (!ok) target.checked = !enabled;
}

async function setPrinterPrintEnabled(printerId, enabled, note = null) {
  try {
    const r = await fetch(`/api/printers/${printerId}/print-enabled`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, note }),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      showToast('Unable to update printer status', body.detail ?? 'Please try again.', 'error');
      return false;
    }
    await refreshPrinters();
    _renderSettingsContent('printers');
    return true;
  } catch {
    showToast('Unable to update printer status', 'Network error', 'error');
    return false;
  }
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

function _slicerProfileOptions(profileData, slot) {
  const key = slot === 'printer' ? 'machines' : slot === 'process' ? 'processes' : 'filaments';
  const seen = new Set();
  const rows = [];
  (profileData?.vendors || []).forEach(vendor => {
    (vendor[key] || []).forEach(item => {
      const name = item.name || '';
      if (!name || seen.has(name)) return;
      seen.add(name);
      rows.push({ name, vendor: vendor.vendor || vendor.name || '' });
    });
  });
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

function _slicerDatalist(id, rows) {
  return `<datalist id="${id}">
    ${rows.map(row => `<option value="${esc(row.name)}">${esc(row.vendor)}</option>`).join('')}
  </datalist>`;
}

function _slicerProfileKeywords(...parts) {
  const raw = parts.filter(Boolean).join(' ').toUpperCase();
  const compact = raw.replace(/[^A-Z0-9]+/g, '');
  const words = raw
    .replace(/[_-]+/g, ' ')
    .split(/[^A-Z0-9]+/)
    .map(w => w.trim())
    .filter(w => w.length >= 2)
    .filter(w => !['THE', 'AND', 'PRO', 'MAX', 'MINI', 'LAB', 'LABS', 'BAMBU', 'PRINTER', 'SIMULATED'].includes(w));
  const aliases = [];
  if (raw.includes('X1 CARBON') || compact.includes('X1CARBON')) aliases.push('X1C');
  if (raw.includes('H2D PRO') || compact.includes('H2DPRO')) aliases.push('H2DP');
  if (raw.includes('A1 MINI') || compact.includes('A1MINI')) aliases.push('A1 MINI', 'A1M');
  const modelLike = words.filter(w => /[A-Z]/.test(w) && /\d/.test(w));
  return [...new Set([...aliases, ...modelLike, ...words])];
}

function _slicerProfileScore(row, keywords) {
  if (!keywords.length) return 0;
  const name = String(row.name || '').toUpperCase();
  const compact = name.replace(/[^A-Z0-9]+/g, '');
  let score = 0;
  keywords.forEach((kw, index) => {
    const key = String(kw || '').toUpperCase();
    if (!key) return;
    const keyCompact = key.replace(/[^A-Z0-9]+/g, '');
    if (name.includes(key)) score += index < 3 ? 8 : 4;
    else if (keyCompact && compact.includes(keyCompact)) score += index < 3 ? 7 : 3;
  });
  return score;
}

function _slicerFilterRowsForPrinter(rows, printerProfile, fallback = '') {
  const keywords = _slicerProfileKeywords(printerProfile, fallback);
  const scored = rows
    .map(row => ({ row, score: _slicerProfileScore(row, keywords) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  return scored.length ? scored.map(item => item.row) : rows;
}

function _slicerProfilesHtml(profileData, printers) {
  _slicerProfileData = profileData;
  const vendors = profileData?.vendors || [];
  const defaults = profileData?.defaults || {};
  const printerProfiles = _slicerProfileOptions(profileData, 'printer');
  const processProfiles = _slicerProfileOptions(profileData, 'process');
  const filamentProfiles = _slicerProfileOptions(profileData, 'filament');
  const vendorStats = vendors.length
    ? vendors.map(v => `<span class="slicer-profile-pill">${esc(v.vendor || v.name)} · ${(v.machines || []).length} printers · ${(v.processes || []).length} processes · ${(v.filaments || []).length} filaments</span>`).join('')
    : '<span class="settings-empty">No standard profiles synced yet.</span>';
  const rows = (printers || []).map(p => {
    const d = defaults[p.id] || {};
    const rowKey = String(p.id || '').replace(/[^A-Za-z0-9_-]/g, '_');
    const rowFallback = [p.model_name, p.custom_name, p.id].filter(Boolean).join(' ');
    const rowPrinters = _slicerFilterRowsForPrinter(printerProfiles, rowFallback, rowFallback);
    const selectedPrinter = d.printer_profile || rowPrinters[0]?.name || '';
    const rowProcesses = _slicerFilterRowsForPrinter(processProfiles, selectedPrinter, rowFallback);
    const rowFilaments = _slicerFilterRowsForPrinter(filamentProfiles, selectedPrinter, rowFallback);
    const printerPlaceholder = rowPrinters[0]?.name || 'Printer/nozzle profile';
    const processPlaceholder = rowProcesses[0]?.name || 'Process/layer profile';
    const filamentPlaceholder = rowFilaments[0]?.name || 'Filament profile';
    return `<div class="slicer-profile-row" data-printer-id="${esc(p.id)}">
      <div class="slicer-profile-printer">
        <strong>${esc(p.custom_name || p.model_name || p.id)}</strong>
        <span>${esc([p.model_name, p.kind].filter(Boolean).join(' · '))}</span>
      </div>
      <input class="settings-input slicer-profile-input" data-profile-slot="printer" list="slicer-printer-profiles-${esc(rowKey)}" value="${esc(d.printer_profile || '')}" placeholder="${esc(printerPlaceholder)}">
      <input class="settings-input slicer-profile-input" data-profile-slot="process" list="slicer-process-profiles-${esc(rowKey)}" value="${esc(d.process_profile || '')}" placeholder="${esc(processPlaceholder)}">
      <input class="settings-input slicer-profile-input" data-profile-slot="filament" list="slicer-filament-profiles-${esc(rowKey)}" value="${esc(d.filament_profile || '')}" placeholder="${esc(filamentPlaceholder)}">
      ${_slicerDatalist(`slicer-printer-profiles-${rowKey}`, rowPrinters)}
      ${_slicerDatalist(`slicer-process-profiles-${rowKey}`, rowProcesses)}
      ${_slicerDatalist(`slicer-filament-profiles-${rowKey}`, rowFilaments)}
      <button type="button" class="settings-save-btn slicer-profile-save">Save</button>
    </div>`;
  }).join('') || '<div class="settings-empty">Add a printer before assigning slicer profiles.</div>';
  return `
    <div class="settings-section slicer-profiles-panel">
      <div class="setup-version-main">
        <div>
          <div class="settings-section-title">Standard Profiles</div>
          <div class="settings-hint">Synced from OrcaSlicer standard profiles, plus any custom profiles you upload.</div>
        </div>
        <div class="setup-version-actions">
          <button type="button" class="settings-save-btn" id="slicer-upload-profiles">Upload profiles</button>
          <button type="button" class="settings-save-btn" id="slicer-sync-profiles">Sync profiles</button>
        </div>
      </div>
      <input id="slicer-profile-upload-input" type="file" accept=".json,.bbscfg,.zip" multiple hidden>
      <div class="slicer-profile-pills">${vendorStats}</div>
      <div class="settings-hint">Credit: <a href="${esc(profileData?.attribution?.url || 'https://github.com/OrcaSlicer/OrcaSlicer')}" target="_blank" rel="noreferrer">OrcaSlicer standard profiles</a> (${esc(profileData?.attribution?.license || 'AGPL-3.0')}).</div>
    </div>
    <div class="settings-section slicer-profiles-panel">
      <div class="settings-section-title">Printer Defaults</div>
      <div class="settings-hint">Choose the default profile triplet Flightdeck should use when slicing for each printer. Nozzle size lives in the printer profile; Bambu 0.4 process profiles are usually named by layer height, like 0.20mm Standard @BBL H2D.</div>
      ${_slicerDatalist('slicer-process-profiles', processProfiles)}
      ${_slicerDatalist('slicer-filament-profiles', filamentProfiles)}
      <div class="slicer-profile-table">${rows}</div>
    </div>`;
}

function _slicerReplaceDatalist(id, rows) {
  const list = document.getElementById(id);
  if (!list) return;
  list.innerHTML = rows.map(row => `<option value="${esc(row.name)}">${esc(row.vendor)}</option>`).join('');
}

function _slicerRefreshRowProfileLists(row) {
  if (!_slicerProfileData || !row) return;
  const printerInput = row.querySelector('[data-profile-slot="printer"]');
  const processInput = row.querySelector('[data-profile-slot="process"]');
  const filamentInput = row.querySelector('[data-profile-slot="filament"]');
  const printerText = printerInput?.value || '';
  const fallback = row.querySelector('.slicer-profile-printer')?.textContent || '';
  const processRows = _slicerFilterRowsForPrinter(_slicerProfileOptions(_slicerProfileData, 'process'), printerText, fallback);
  const filamentRows = _slicerFilterRowsForPrinter(_slicerProfileOptions(_slicerProfileData, 'filament'), printerText, fallback);
  if (processInput?.list?.id) _slicerReplaceDatalist(processInput.list.id, processRows);
  if (filamentInput?.list?.id) _slicerReplaceDatalist(filamentInput.list.id, filamentRows);
  if (processInput && !processInput.value) processInput.placeholder = processRows[0]?.name || 'Process/layer profile';
  if (filamentInput && !filamentInput.value) filamentInput.placeholder = filamentRows[0]?.name || 'Filament profile';
}

function _slicerCategoryHtml(profileData = null, printers = []) {
  const selected = _serverSettings.preferred_slicer ?? '';
  const detected = _serverSettings.slicer_detected_version ?? '';
  const dockerUrl = (_serverSettings.orcaslicer_docker_url || '').trim();
  const workerUrl = (_serverSettings.orcaslicer_worker_url || '').trim();
  const apiUrl = (_serverSettings.orcaslicer_api_url || '').trim();
  const dockerLaunchUrl = _slicerDockerLaunchUrl(dockerUrl);
  const dockerReady = !!dockerUrl;

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
    </div>
    <div class="settings-section">
      <div class="settings-section-title">OrcaSlicer Integration</div>
      <div class="slicer-docker-panel">
        <div>
          <strong>Browser-based OrcaSlicer</strong>
          <span>NAS/PC Docker sidecar. Uses the shared Print Vault at <code>/prints</code>.</span>
        </div>
        ${dockerReady
          ? `<a class="slicer-launch-btn" href="${esc(dockerLaunchUrl)}" target="_blank" rel="noreferrer">Open Orca</a>`
          : `<span class="slicer-launch-btn slicer-launch-disabled">Set URL first</span>`}
      </div>
      <div class="settings-form-row">
        <label class="settings-label">Browser Orca URL</label>
        <input class="settings-input slicer-docker-input" data-pref-key="orcaslicer_docker_url" type="url" value="${esc(dockerUrl)}" placeholder="${esc(_slicerDockerDefaultUrl())}">
        <label class="settings-label">Slicer API URL</label>
        <input class="settings-input pref-input" data-pref-key="orcaslicer_api_url" type="url" value="${esc(apiUrl)}" placeholder="${esc(_slicerApiDefaultUrl())}">
        <label class="settings-label">Worker URL</label>
        <input class="settings-input pref-input" data-pref-key="orcaslicer_worker_url" type="url" value="${esc(workerUrl)}" placeholder="http://100.x.x.x:8000">
      </div>
      <div class="settings-hint">Browser Orca URL opens the web slicer. Slicer API URL points to the background /slice service, usually port 3003. Worker URL points to a Windows Flightdeck instance with native Orca profiles installed.</div>
      <div class="slicer-connection-actions">
        <button type="button" class="settings-save-btn" data-slicer-test="browser">Test Browser Orca</button>
        <button type="button" class="settings-save-btn" data-slicer-test="api">Test API</button>
        <button type="button" class="settings-save-btn" data-slicer-test="worker">Test Worker</button>
        <span class="slicer-connection-status" id="slicer-connection-status"></span>
      </div>
    </div>
    ${_slicerProfilesHtml(profileData, printers)}`;
}

function _slicerDockerDefaultUrl() {
  const proto = location.protocol === 'https:' ? 'https:' : location.protocol;
  return `${proto}//${location.hostname}:3011`;
}

function _slicerApiDefaultUrl() {
  return `http://${location.hostname}:3003`;
}

function _slicerDockerLaunchUrl(value = '') {
  return (value || '').trim().replace(/\/+$/, '');
}

function _updateSlicerDockerLaunch(el) {
  const input = el.querySelector('.slicer-docker-input');
  const btn = el.querySelector('.slicer-launch-btn');
  if (!input || !btn) return;
  const url = _slicerDockerLaunchUrl(input.value);
  if (!url) {
    const replacement = document.createElement('span');
    replacement.className = 'slicer-launch-btn slicer-launch-disabled';
    replacement.textContent = 'Set URL first';
    btn.replaceWith(replacement);
    return;
  }
  if (btn.tagName !== 'A') {
    const replacement = document.createElement('a');
    replacement.className = 'slicer-launch-btn';
    replacement.target = '_blank';
    replacement.rel = 'noreferrer';
    replacement.textContent = 'Open Orca';
    replacement.href = url;
    btn.replaceWith(replacement);
    return;
  }
  btn.href = url;
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

  el.querySelectorAll('.slicer-docker-input').forEach(input => {
    input.addEventListener('change', async () => {
      const key = input.dataset.prefKey;
      let value = input.value.trim().replace(/\/+$/, '');
      try {
        const saved = await _saveSetting(key, value);
        input.value = saved;
        _updateSlicerDockerLaunch(el);
        showToast('Browser Orca URL saved', saved || 'Using current host on port 3011', 'success');
      } catch (err) {
        showToast('Setting save failed', err.message || '', 'error');
        input.value = input.defaultValue;
      }
    });
  });
  el.querySelectorAll('.pref-input[data-pref-key="orcaslicer_worker_url"], .pref-input[data-pref-key="orcaslicer_api_url"]').forEach(input => {
    input.addEventListener('change', async () => {
      const value = input.value.trim().replace(/\/+$/, '');
      try {
        const saved = await _saveSetting(input.dataset.prefKey, value);
        input.value = saved || '';
        _serverSettings[input.dataset.prefKey] = input.value;
        const label = input.dataset.prefKey === 'orcaslicer_api_url' ? 'Slicer API URL' : 'Slicer worker URL';
        showToast(`${label} saved`, input.value || 'Cleared', 'success');
      } catch (err) {
        showToast('Setting save failed', err.message || '', 'error');
        input.value = input.defaultValue;
      }
    });
  });

  el.querySelectorAll('[data-slicer-test]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.slicerTest;
      const status = el.querySelector('#slicer-connection-status');
      const selector = kind === 'api'
        ? '[data-pref-key="orcaslicer_api_url"]'
        : kind === 'worker'
          ? '[data-pref-key="orcaslicer_worker_url"]'
          : '[data-pref-key="orcaslicer_docker_url"]';
      const input = el.querySelector(selector);
      const fallback = kind === 'api' ? _slicerApiDefaultUrl() : (kind === 'browser' ? _slicerDockerDefaultUrl() : '');
      const url = (input?.value || fallback || '').trim().replace(/\/+$/, '');
      if (!url) {
        showToast('Slicer test needs a URL', 'Set the URL first.', 'warning');
        return;
      }
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Testing';
      if (status) {
        status.textContent = `Testing ${kind}...`;
        status.dataset.tone = 'info';
      }
      try {
        const r = await fetch('/api/slicer/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, url }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Slicer check failed');
        const label = kind === 'api' ? 'Slicer API' : (kind === 'worker' ? 'Slicer worker' : 'Browser Orca');
        const detail = data.auth_required
          ? `${label} reachable · sign-in required`
          : data.version ? `${label} reachable · ${data.version}` : `${label} reachable`;
        if (status) {
          status.textContent = detail;
          status.dataset.tone = 'ok';
        }
        showToast(`${label} reachable`, url, 'success');
      } catch (err) {
        if (status) {
          status.textContent = err.message || 'Slicer check failed';
          status.dataset.tone = 'warn';
        }
        showToast('Slicer check failed', err.message || '', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    });
  });

  el.querySelector('#slicer-sync-profiles')?.addEventListener('click', async btnEvent => {
    const btn = btnEvent.currentTarget;
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    try {
      const r = await fetch('/api/slicer/profiles/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendors: ['BBL', 'Sovol', 'Voron', 'Prusa', 'Anycubic'] }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = data.detail;
        throw new Error(typeof detail === 'string' ? detail : detail?.message || 'Profile sync failed');
      }
      showToast('Profiles synced', `${data.synced?.length || 0} vendors`, 'success');
      await _renderSettingsContent('slicer');
    } catch (err) {
      showToast('Profile sync failed', err.message || '', 'error');
      btn.disabled = false;
      btn.textContent = old;
    }
  });

  const uploadInput = el.querySelector('#slicer-profile-upload-input');
  el.querySelector('#slicer-upload-profiles')?.addEventListener('click', () => {
    uploadInput?.click();
  });
  uploadInput?.addEventListener('change', async () => {
    const files = [...(uploadInput.files || [])];
    if (!files.length) return;
    const form = new FormData();
    files.forEach(file => form.append('files', file));
    try {
      const r = await fetch('/api/slicer/profiles/upload', {
        method: 'POST',
        body: form,
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = data.detail;
        throw new Error(typeof detail === 'string' ? detail : detail?.message || 'Profile upload failed');
      }
      const added = data.added || {};
      showToast('Profiles uploaded', `${added.machines || 0} printer · ${added.processes || 0} process · ${added.filaments || 0} filament`, 'success');
      await _renderSettingsContent('slicer');
    } catch (err) {
      showToast('Profile upload failed', err.message || '', 'error');
    } finally {
      uploadInput.value = '';
    }
  });

  el.querySelectorAll('.slicer-profile-save').forEach(btn => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('[data-printer-id]');
      const printerId = row?.dataset.printerId || '';
      if (!printerId) return;
      const body = {};
      row.querySelectorAll('.slicer-profile-input').forEach(input => {
        const slot = input.dataset.profileSlot;
        if (slot === 'printer') body.printer_profile = input.value.trim();
        if (slot === 'process') body.process_profile = input.value.trim();
        if (slot === 'filament') body.filament_profile = input.value.trim();
      });
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Saving';
      try {
        const r = await fetch(`/api/slicer/profiles/defaults/${encodeURIComponent(printerId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.detail || 'Unable to save profiles');
        showToast('Slicer defaults saved', printerId, 'success');
      } catch (err) {
        showToast('Profile save failed', err.message || '', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    });
  });

  el.querySelectorAll('.slicer-profile-input[data-profile-slot="printer"]').forEach(input => {
    input.addEventListener('change', () => _slicerRefreshRowProfileLists(input.closest('[data-printer-id]')));
    input.addEventListener('input', () => _slicerRefreshRowProfileLists(input.closest('[data-printer-id]')));
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
    <div class="settings-section filament-add-section">
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
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Usage</div>
      ${statsHtml}${matHtml}${monthHtml}
    </div>
    <div class="settings-section filament-catalogue-list-section">
      <div class="settings-section-title">Filament catalogue</div>
      <p class="filament-empty">Each material can have multiple brands with individual costs. Est. cost uses the average $/g across brands.</p>
      <div class="cost-card-grid">${costCards}</div>
    </div>`;
}

function _attachFilamentEvents(el, refresh = () => _renderSettingsContent('filament')) {
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
        refresh();
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
        refresh()
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
          refresh();
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
      if (!await _confirmModal(`Remove ${brand || '(unbranded)'} ${mat}?`)) return;
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
      if (!await _confirmModal(`Remove all "${mat}" entries from your catalogue?`)) return;
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
          refresh();
      } catch {
        addBtn.textContent = 'Error';
        setTimeout(() => { addBtn.textContent = 'Add'; addBtn.disabled = false; }, 2000);
      }
    });
  }
}

const _ACCENT_COLORS = [
  { label: 'Blue',   value: '#3b82f6' },
  { label: 'Red',    value: '#ef4444' },
  { label: 'Purple', value: '#8b5cf6' },
  { label: 'Teal',   value: '#14b8a6' },
  { label: 'Green',  value: '#22c55e' },
  { label: 'Orange', value: '#f59e0b' },
  { label: 'Pink',   value: '#ec4899' },
];

const _THEME_PRESETS = [
  { label: 'Flightdeck Blue', value: '#3b82f6' },
  { label: 'Flightdeck Red', value: '#ef4444' },
  { label: 'Workshop Green', value: '#22c55e' },
  { label: 'Amber Bench', value: '#f59e0b' },
  { label: 'Purple Lab', value: '#8b5cf6' },
];

const _BACKGROUND_THEMES = [
  { label: 'Classic', value: 'classic', swatch: '#0a0a0f' },
  { label: 'Red Deck', value: 'red', swatch: '#240b10' },
  { label: 'Blue Deck', value: 'blue', swatch: '#071329' },
  { label: 'Green Bench', value: 'green', swatch: '#071c14' },
  { label: 'Grey Bay', value: 'grey', swatch: '#111318' },
];

const _SIDEBAR_TEXT_COLORS = [
  { label: 'Flight Blue', value: '#8fa8c8' },
  { label: 'Clean White', value: '#e2e8f0' },
  { label: 'Signal Red', value: '#fca5a5' },
  { label: 'Console Green', value: '#86efac' },
  { label: 'Amber', value: '#fcd34d' },
];

function _themeFavourites() {
  try {
    const parsed = JSON.parse(_serverSettings.theme_favourites || '[]');
    return Array.isArray(parsed) ? parsed.filter(f => f && f.name) : [];
  } catch {
    return [];
  }
}

function _themeFavouritePayload(name = '') {
  return {
    id: `theme-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || 'Theme favourite',
    accent: _safeCssHex(_serverSettings.accent, '#3b82f6'),
    theme_background: (_serverSettings.theme_background || 'classic').replace(/[^a-z0-9_-]/gi, '') || 'classic',
    theme_background_color: _safeCssHex(_serverSettings.theme_background_color, '#0a0a0f'),
    sidebar_text_color: _safeCssHex(_serverSettings.sidebar_text_color, '#8fa8c8'),
  };
}

function _themeFavouriteDefaultName() {
  const bg = (_serverSettings.theme_background || 'classic').replace(/[^a-z0-9_-]/gi, '') || 'classic';
  const background = _BACKGROUND_THEMES.find(t => t.value === bg)?.label || (bg === 'custom' ? 'Custom' : 'Theme');
  return `${background} Flightdeck`;
}

function _settingToggle(key, options, current) {
  return options.map(({ value, label }) =>
    `<button class="setting-toggle-btn${current === value ? ' setting-toggle-active' : ''}"
       data-setting-key="${key}" data-setting-value="${value}">${label}</button>`
  ).join('');
}

function _setupCheckByLabel(checks, pattern) {
  return checks.find(c => pattern.test(String(c.label || '')));
}

function _setupReadinessTile(label, value, detail, cls = 'ok') {
  return `<div class="setup-ready-tile setup-ready-${cls}">
    <span>${esc(label)}</span>
    <strong>${esc(value)}</strong>
    <small>${esc(detail)}</small>
  </div>`;
}

async function _uploadSourceModel(file) {
  const form = new FormData();
  form.append('file', file);
  try {
    const r = await fetch('/api/files/library/upload', {
      method: 'POST',
      body: form,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.detail || 'Upload failed');
    showToast('Uploaded to Print Vault', data.name || file.name, 'success');
    _fileDeskLastHtml = '';
    renderFileDeskView();
  } catch (err) {
    showToast('Upload failed', err.message || '', 'error');
  }
}

function _openSliceModelDialog({ sourceId, path, file, printers }) {
  document.querySelector('.filedesk-slice-dialog')?.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay filedesk-slice-dialog';
  const bedTypes = ['Textured PEI Plate', 'Smooth PEI Plate', 'High Temp Plate', 'Cool Plate', 'Engineering Plate'];
  overlay.innerHTML = `
    <div class="modal-box filedesk-queue-box filedesk-slice-box" role="dialog" aria-modal="true" aria-label="Slice model">
      <div class="filedesk-queue-head">
        <div>
          <div class="mission-eyebrow">Slice Model</div>
          <h3>${esc(file?.name || path || 'Model')}</h3>
          <span>${esc(path || '')}</span>
        </div>
        <button class="filedesk-dialog-close" data-dialog-close aria-label="Close">x</button>
      </div>
      <div class="filedesk-queue-options">
        ${printers.map(p => `<button class="filedesk-printer-choice" data-printer-id="${esc(p.id)}">
          <strong>${esc(p.custom_name || p.model_name || p.id)}</strong>
          <span>${esc([p.model_name, p.kind].filter(Boolean).join(' · '))}</span>
        </button>`).join('')}
      </div>
      <label class="filedesk-slice-toggle">
        <input type="checkbox" id="slice-all-plates">
        Slice all plates
      </label>
      <label class="filedesk-slice-field">
        <span>Plate type</span>
        <select id="slice-bed-type">
          ${bedTypes.map(name => `<option value="${esc(name)}">${esc(name)}</option>`).join('')}
        </select>
      </label>
      <div class="filedesk-dialog-error" id="slice-plan-result" hidden></div>
      <div class="filedesk-slice-actions" id="slice-handoff-actions" hidden></div>
      <div class="settings-hint">Source models are portable. Flightdeck will create a printer-specific sliced job before queueing or sending it.</div>
      <div class="modal-actions">
        <button class="modal-btn" data-dialog-close>Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', async e => {
    if (e.target === overlay || e.target.closest('[data-dialog-close]')) {
      close();
      return;
    }
    const choice = e.target.closest('[data-printer-id]');
    if (!choice) return;
    const errEl = overlay.querySelector('#slice-plan-result');
    const actionsEl = overlay.querySelector('#slice-handoff-actions');
    overlay.querySelectorAll('.filedesk-printer-choice').forEach(b => { b.disabled = true; });
    choice.classList.add('is-working');
    choice.querySelector('span').textContent = 'Preparing slice plan...';
    if (actionsEl) {
      actionsEl.hidden = true;
      actionsEl.innerHTML = '';
    }
    try {
      const r = await fetch('/api/slicer/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: sourceId,
          path,
          printer_id: choice.dataset.printerId,
          plate: 'auto',
          bed_type: overlay.querySelector('#slice-bed-type')?.value || 'Textured PEI Plate',
          all_plates: !!overlay.querySelector('#slice-all-plates')?.checked,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Unable to prepare slice');
      errEl.hidden = false;
      errEl.textContent = data.ready
        ? (data.manual_handoff && data.message
          ? data.message
          : `Prepare ${data.output?.filename || 'a printer-specific sliced job'} for ${data.target?.custom_name || data.target?.model_name || choice.dataset.printerId}.`)
        : data.message || 'Set the slicer settings in Settings -> Slicer first.';
      errEl.classList.toggle('filedesk-dialog-ok', !!data.ready);
      if (data.ready && actionsEl) {
        const sourceUrl = data.source?.download_url || `/api/files/source/download?${new URLSearchParams({ source_id: sourceId, path }).toString()}`;
        const browserUrl = data.browser_url || data.sidecar_url || '';
        const outputName = data.output?.filename || 'sliced-output';
        const profiles = data.profiles || {};
        const canBackgroundSlice = data.can_background_slice !== false;
        const profileRows = [
          ['Printer', profiles.printer],
          ['Process', profiles.process],
          ['Filament', profiles.filament],
        ].map(([label, value]) => `<div><span>${esc(label)}</span><strong>${esc(value || 'Not set')}</strong></div>`).join('');
        actionsEl.hidden = false;
        actionsEl.innerHTML = `
          <div class="filedesk-slice-steps">
            <strong>Slice handoff</strong>
            <span>Download the model, open Orca, import it, use the profiles below, then export as ${esc(outputName)} back into the Print Vault.</span>
          </div>
          <div class="filedesk-slice-profiles">${profileRows}</div>
          <div class="filedesk-slice-buttons">
            ${canBackgroundSlice ? `<button class="filedesk-slice-link filedesk-slice-run" type="button" data-run-slice="${esc(outputName)}" data-printer-id="${esc(data.target?.id || choice.dataset.printerId)}">Slice in Flightdeck</button>` : ''}
            ${sourceUrl ? `<a class="filedesk-slice-link" href="${esc(sourceUrl)}" download>Download model</a>` : ''}
            ${browserUrl ? `<a class="filedesk-slice-link" href="${esc(browserUrl)}" target="_blank" rel="noreferrer">Open Orca</a>` : ''}
            <button class="filedesk-slice-link" type="button" data-copy-slice-name="${esc(outputName)}">Copy output name</button>
            <button class="filedesk-slice-link" type="button" data-check-slice-output="${esc(outputName)}">Check vault</button>
          </div>`;
      }
      showToast(data.ready ? 'Slice plan ready' : 'Slicer not configured', data.message || '', data.ready ? 'success' : 'warning');
    } catch (err) {
      errEl.textContent = err.message || 'Unable to prepare slice';
      errEl.hidden = false;
    } finally {
      choice.classList.remove('is-working');
      overlay.querySelectorAll('.filedesk-printer-choice').forEach(b => { b.disabled = false; });
    }
  });
  overlay.addEventListener('click', e => {
    const copyBtn = e.target.closest('[data-copy-slice-name]');
    if (!copyBtn) return;
    const name = copyBtn.dataset.copySliceName || '';
    navigator.clipboard?.writeText(name).then(() => {
      showToast('Output name copied', name, 'success');
    }).catch(() => {
      showToast('Copy failed', name, 'warning');
    });
  });
  overlay.addEventListener('click', async e => {
    const checkBtn = e.target.closest('[data-check-slice-output]');
    if (!checkBtn) return;
    const name = checkBtn.dataset.checkSliceOutput || '';
    const old = checkBtn.textContent;
    checkBtn.disabled = true;
    checkBtn.textContent = 'Checking...';
    try {
      const r = await fetch('/api/slicer/output-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: name }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Unable to check vault');
      if (data.exists) {
        showToast('Sliced job ready', `${data.filename} · ${_fmtBytes(data.size)}`, 'success');
        close();
        _fileDeskLastHtml = '';
        renderFileDeskView();
      } else {
        showToast('Still waiting for export', name, 'warning');
      }
    } catch (err) {
      showToast('Vault check failed', err.message || '', 'error');
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = old;
    }
  });
  overlay.addEventListener('click', async e => {
    const runBtn = e.target.closest('[data-run-slice]');
    if (!runBtn) return;
    const old = runBtn.textContent;
    runBtn.disabled = true;
    runBtn.textContent = 'Slicing...';
    try {
      const r = await fetch('/api/slicer/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_id: sourceId,
          path,
          printer_id: runBtn.dataset.printerId,
          output_filename: runBtn.dataset.runSlice || '',
          plate: '1',
          bed_type: overlay.querySelector('#slice-bed-type')?.value || 'Textured PEI Plate',
          all_plates: !!overlay.querySelector('#slice-all-plates')?.checked,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof data.detail === 'string' ? data.detail : data.detail?.message || 'Slice failed');
      showToast('Sliced job ready', `${data.filename} · ${_fmtBytes(data.size)}`, 'success');
      close();
      _fileDeskLastHtml = '';
      _printerBayLastHtml = '';
      const route = parseRoute();
      if (route.view === 'printer' && route.subtab === 'bay') _renderPrinterBayBody(route.id);
      else renderFileDeskView();
    } catch (err) {
      showToast('Slice failed', err.message || '', 'error');
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = old;
    }
  });

}

function _setupVersionHtml(version) {
  const notes = (version?.release_notes || []).map(note => `<li>${esc(note)}</li>`).join('');
  const current = [version?.version ? `v${version.version}` : 'version unknown', version?.commit || ''].filter(Boolean).join(' · ');
  let updateText = 'Check GitHub';
  let updateClass = 'info';
  if (version?.behind) {
    updateText = `Update available ${version.remote_commit ? `· ${version.remote_commit}` : ''}`;
    updateClass = 'warn';
  } else if (version?.fetch_ok === true) {
    updateText = 'Up to date';
    updateClass = 'ok';
  } else if (version?.fetch_ok === false) {
    updateText = 'GitHub check failed';
    updateClass = 'warn';
  }
  const dirty = version?.dirty ? '<span class="setup-version-flag">Local changes</span>' : '';
  return `<div class="settings-section setup-version-panel">
    <div class="setup-version-main">
      <div>
        <div class="settings-section-title">Version &amp; Updates</div>
        <div class="settings-hint">${esc(version?.name || 'Flightdeck build details')}</div>
      </div>
      <div class="setup-version-actions">
        <span class="setup-health-badge setup-ready-${updateClass}" id="setup-update-state">${esc(updateText)}</span>
        <button type="button" class="settings-save-btn" id="setup-check-update">Check</button>
        <button type="button" class="settings-save-btn" id="setup-run-update" ${version?.dirty ? 'disabled' : ''}>Update</button>
      </div>
    </div>
    <div class="setup-version-meta">
      <strong>${esc(current)}</strong>
      <span>${esc(version?.branch || 'unknown branch')} ${version?.remote ? `· ${esc(version.remote)}` : ''}</span>
      ${dirty}
    </div>
    ${notes ? `<ul class="setup-version-notes">${notes}</ul>` : ''}
    <div class="settings-hint" id="setup-update-message">Updates use <code>git pull --ff-only</code>. Restart Flightdeck after a successful update.</div>
  </div>`;
}

function _setupHealthHtml(health, context = {}) {
  const checks = health?.checks || [];
  const version = context.version || {};
  const summary = health?.summary || {};
  const requiredText = `${summary.required_ok ?? 0}/${summary.required_total ?? 0}`;
  const optionalText = `${summary.optional_ok ?? 0}/${summary.optional_total ?? 0}`;
  const statusText = health?.status === 'ready' ? 'Ready' : 'Needs attention';
  const printers = context.printers || _latestPrinters || [];
  const scaleOk = !!context.scale?.available;
  const labelOk = !!context.labelPrinter?.available;
  const dataCheck = _setupCheckByLabel(checks, /data|database|folder|path/i);
  const cameraCheck = _setupCheckByLabel(checks, /camera|worker/i);
  const backupCheck = _setupCheckByLabel(checks, /backup|vault|archive/i);
  const baseUrl = _serverSettings.system_base_url || location.origin;
  const dataOk = dataCheck ? !!dataCheck.ok : health?.status === 'ready';
  const cameraOk = cameraCheck ? !!cameraCheck.ok : true;
  const readyLabel = health?.status === 'ready'
    ? (scaleOk && labelOk ? 'Ready for flight' : 'Ready for real use')
    : 'Preflight checks needed';
  const readyDetail = health?.status === 'ready'
    ? 'Required services are healthy. Optional hardware can be added whenever the bench needs it.'
    : 'Finish the required checks before putting Flightdeck in charge of the room.';
  const readyTiles = [
    _setupReadinessTile('Fleet', `${printers.length} printer${printers.length === 1 ? '' : 's'}`, printers.length ? 'Configured and visible to Flightdeck' : 'Add printers before first use', printers.length ? 'ok' : 'warn'),
    _setupReadinessTile('Data', dataOk ? 'Healthy' : 'Check', dataCheck?.detail || 'Database and data folder status', dataOk ? 'ok' : 'warn'),
    _setupReadinessTile('Cameras', cameraOk ? 'Ready' : 'Check', cameraCheck?.detail || 'Camera workers available when printers are online', cameraOk ? 'ok' : 'warn'),
    _setupReadinessTile('Scale', scaleOk ? 'Detected' : 'Optional', scaleOk ? 'Dymo scale ready for weigh-ins' : (context.scale?.last_error || 'Only needed for live spool weighing'), scaleOk ? 'ok' : 'optional'),
    _setupReadinessTile('Labels', labelOk ? 'Detected' : 'Optional', labelOk ? `QL-700 ready for ${context.labelPrinter?.label_size || 'DK-22212'}` : (context.labelPrinter?.last_error || 'Only needed for QR spool labels'), labelOk ? 'ok' : 'optional'),
    _setupReadinessTile('Access', baseUrl, 'Use this URL for labels, phones, and remote access', 'info'),
    _setupReadinessTile('Backup', backupCheck?.ok ? 'Ready' : 'Configure', backupCheck?.detail || 'GitHub/private backup path can be configured after install', backupCheck?.ok ? 'ok' : 'optional'),
  ].join('');
  const rows = checks.map(c => `
    <div class="setup-check setup-check-${esc(c.level || 'warn')}">
      <div class="setup-check-main">
        <span class="setup-check-dot"></span>
        <div>
          <strong>${esc(c.label)}</strong>
          <small>${esc(c.detail)}</small>
        </div>
      </div>
      <span class="setup-check-status">${c.ok ? 'OK' : (c.optional ? 'Optional' : 'Check')}</span>
    </div>
  `).join('');
  const pathRows = Object.entries(health?.paths || {}).map(([key, value]) => `
    <div class="setup-path-row"><span>${esc(key.replaceAll('_', ' '))}</span><code>${esc(value)}</code></div>
  `).join('');
  return `
    ${_setupVersionHtml(version)}
    <div class="settings-section setup-health-panel">
      <div class="setup-ready-banner setup-ready-banner-${health?.status === 'ready' ? 'ok' : 'warn'}">
        <div>
          <span>First-run readiness</span>
          <strong>${esc(readyLabel)}</strong>
          <small>${esc(readyDetail)}</small>
        </div>
        <a class="modal-btn" href="#/manual">Flight Manual</a>
      </div>
      <div class="setup-ready-grid">${readyTiles}</div>
      <div class="setup-health-head">
        <div>
          <div class="settings-section-title">Setup Health</div>
          <div class="settings-hint">Flightdeck install readiness from the running service.</div>
        </div>
        <span class="setup-health-badge setup-health-${health?.status || 'needs_attention'}">${statusText}</span>
      </div>
      <div class="setup-health-summary">
        <div><strong>${requiredText}</strong><span>required</span></div>
        <div><strong>${optionalText}</strong><span>optional</span></div>
      </div>
      <div class="setup-check-grid">${rows}</div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Runtime Paths</div>
      <div class="setup-path-list">${pathRows}</div>
    </div>`;
}

function _attachSetupEvents(el) {
  const message = el.querySelector('#setup-update-message');
  const state = el.querySelector('#setup-update-state');
  const setMessage = (text, tone = 'info') => {
    if (message) {
      message.textContent = text;
      message.dataset.tone = tone;
    }
  };
  el.querySelector('#setup-check-update')?.addEventListener('click', async () => {
    setMessage('Checking GitHub...');
    try {
      const r = await fetch('/api/update/status?check_remote=true');
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Update check failed');
      if (state) {
        state.textContent = data.behind
          ? `Update available ${data.remote_commit ? `· ${data.remote_commit}` : ''}`
          : data.fetch_ok === false ? 'GitHub check failed' : 'Up to date';
      }
      setMessage(data.behind ? 'A newer GitHub build is available.' : (data.fetch_detail || 'Flightdeck is up to date.'), data.behind ? 'warn' : 'ok');
    } catch (err) {
      setMessage(err.message || 'Update check failed', 'warn');
    }
  });
  el.querySelector('#setup-run-update')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    setMessage('Updating from GitHub...');
    try {
      const r = await fetch('/api/update', { method: 'POST' });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.detail || 'Update failed');
      if (state) state.textContent = 'Updated';
      setMessage(`${data.message || 'Update complete.'} Restart Flightdeck to load the new code.`, 'ok');
      showToast('Flightdeck updated', 'Restart Flightdeck to load the new build.', 'success');
    } catch (err) {
      btn.disabled = false;
      setMessage(err.message || 'Update failed', 'warn');
    }
  });
}

async function _saveSetting(key, value) {
  const r = await fetch(`/api/settings/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: String(value) }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail || 'Setting save failed');
  }
  const body = await r.json().catch(() => ({}));
  _serverSettings[key] = String(body.value ?? value);
  return _serverSettings[key];
}

function _prefBool(key, fallback = 'false') {
  return (_serverSettings[key] ?? fallback) === 'true';
}

function _preferencesCategoryHtml() {
  const systemUrl = _serverSettings.system_base_url ?? 'https://flightdeck.tail7de73e.ts.net';
  const lowPct = _serverSettings.spool_low_stock_pct ?? '20';
  const nearEmpty = _serverSettings.spool_near_empty_g ?? '50';
  const confidence = _serverSettings.spool_confidence_warn_pct ?? '75';
  const labelWeight = _serverSettings.default_label_weight_g ?? '1000';
  const vaultPath = _serverSettings.print_vault_path ?? '';
  return `
    <div class="settings-section">
      <div class="settings-section-title">System</div>
      <div class="settings-form-row">
        <label class="settings-label">Base URL</label>
        <input class="settings-input pref-input" data-pref-key="system_base_url" type="url" value="${esc(systemUrl)}" placeholder="https://flightdeck.tail7de73e.ts.net">
      </div>
      <div class="settings-hint">Used for QR labels and links back into Flightdeck.</div>
      <div class="settings-form-row">
        <label class="settings-label">Print Vault</label>
        <input class="settings-input pref-input" data-pref-key="print_vault_path" type="text" value="${esc(vaultPath)}" placeholder="/home/flightdeck/print_library">
      </div>
      <div class="settings-hint">Optional Pi, USB, or HDD-backed archive path for Print Bay. Leave blank to use the service default.</div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Spool Thresholds</div>
      <div class="settings-form-row">
        <label class="settings-label">Low stock</label>
        <input class="settings-input pref-input" data-pref-key="spool_low_stock_pct" type="number" min="1" max="99" value="${esc(lowPct)}"> %
      </div>
      <div class="settings-form-row">
        <label class="settings-label">Near empty</label>
        <input class="settings-input pref-input" data-pref-key="spool_near_empty_g" type="number" min="0" value="${esc(nearEmpty)}"> g
      </div>
      <div class="settings-form-row">
        <label class="settings-label">Confidence warning</label>
        <input class="settings-input pref-input" data-pref-key="spool_confidence_warn_pct" type="number" min="1" max="100" value="${esc(confidence)}"> %
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Labels</div>
      <div class="settings-form-row">
        <label class="settings-label">Default spool weight</label>
        <input class="settings-input pref-input" data-pref-key="default_label_weight_g" type="number" min="1" value="${esc(labelWeight)}"> g
      </div>
      <div class="settings-form-row">
        <label class="settings-label">Print fields</label>
        <div class="setting-toggle-group">
          ${_settingToggle('label_include_colour', [{ value: 'true', label: 'Colour' }, { value: 'false', label: 'Hide colour' }], _prefBool('label_include_colour', 'true') ? 'true' : 'false')}
          ${_settingToggle('label_include_brand', [{ value: 'true', label: 'Brand' }, { value: 'false', label: 'Hide brand' }], _prefBool('label_include_brand', 'true') ? 'true' : 'false')}
          ${_settingToggle('label_include_location', [{ value: 'true', label: 'Location' }, { value: 'false', label: 'Hide location' }], _prefBool('label_include_location', 'true') ? 'true' : 'false')}
        </div>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-section-title">Queue Matching</div>
      <div class="settings-form-row">
        <label class="settings-label">Colour match</label>
        <div class="setting-toggle-group">
          ${_settingToggle('queue_strict_colour', [{ value: 'true', label: 'Strict' }, { value: 'false', label: 'Advisory' }], _prefBool('queue_strict_colour', 'true') ? 'true' : 'false')}
        </div>
      </div>
    </div>`;
}

function _attachPreferencesEvents(el) {
  el.querySelectorAll('.pref-input').forEach(input => {
    input.addEventListener('change', async () => {
      const key = input.dataset.prefKey;
      let value = input.value.trim();
      if (input.type === 'url' && value) value = value.replace(/\/+$/, '');
      if (input.type === 'number') {
        const min = input.min === '' ? null : Number(input.min);
        const max = input.max === '' ? null : Number(input.max);
        let n = Number(value);
        if (!Number.isFinite(n)) n = Number(input.defaultValue || 0);
        if (min !== null) n = Math.max(min, n);
        if (max !== null) n = Math.min(max, n);
        value = String(n);
        input.value = value;
      }
      try {
        const saved = await _saveSetting(key, value);
        input.value = saved;
        if (key === 'print_vault_path') showToast('Print Vault path saved', saved || 'Using service default', 'success');
      } catch (err) {
        showToast('Setting save failed', err.message || '', 'error');
        input.value = input.defaultValue;
      }
    });
  });

  el.querySelectorAll('.setting-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const { settingKey: key, settingValue: value } = btn.dataset;
      try { await _saveSetting(key, value); } catch {}
      el.querySelectorAll(`.setting-toggle-btn[data-setting-key="${key}"]`).forEach(b =>
        b.classList.toggle('setting-toggle-active', b === btn)
      );
    });
  });
}

function _appearanceCategoryHtml() {
  const accent = (_serverSettings.accent ?? '#3b82f6').trim();
  const background = (_serverSettings.theme_background || 'classic').trim();
  const customBackground = _safeCssHex(_serverSettings.theme_background_color, '#0a0a0f');
  const sidebarText = _safeCssHex(_serverSettings.sidebar_text_color, '#8fa8c8');
  const backgrounds = _BACKGROUND_THEMES.map(t =>
    `<button class="theme-preset theme-background${t.value === background ? ' theme-preset-active' : ''}"
      data-theme-bg="${t.value}" type="button">
      <span style="background:${t.swatch}"></span>${esc(t.label)}
    </button>`
  ).join('');
  const presets = _THEME_PRESETS.map(t =>
    `<button class="theme-preset${t.value === accent ? ' theme-preset-active' : ''}"
      data-accent="${t.value}" type="button">
      <span style="background:${t.value}"></span>${esc(t.label)}
    </button>`
  ).join('');
  const swatches = _ACCENT_COLORS.map(c =>
    `<button class="accent-swatch${c.value === accent ? ' accent-swatch-active' : ''}"
      style="background:${c.value}" data-accent="${c.value}" title="${c.label}"></button>`
  ).join('');
  const sidebarSwatches = _SIDEBAR_TEXT_COLORS.map(c =>
    `<button class="accent-swatch sidebar-text-swatch${c.value === sidebarText ? ' accent-swatch-active' : ''}"
      style="background:${c.value}" data-sidebar-text="${c.value}" title="${c.label}"></button>`
  ).join('');
  const favouriteRows = _themeFavourites().map(f => {
    const bg = f.theme_background === 'custom' ? _safeCssHex(f.theme_background_color, '#0a0a0f') : (_BACKGROUND_THEMES.find(t => t.value === f.theme_background)?.swatch || '#0a0a0f');
    return `<div class="theme-favourite-row" data-theme-favourite="${esc(f.id)}">
      <span class="theme-favourite-preview" style="--fav-bg:${esc(bg)};--fav-side:${esc(_safeCssHex(f.sidebar_text_color, '#8fa8c8'))};--fav-accent:${esc(_safeCssHex(f.accent, '#3b82f6'))}"></span>
      <strong>${esc(f.name)}</strong>
      <button class="theme-favourite-apply" type="button">Apply</button>
      <button class="theme-favourite-delete" type="button" title="Delete favourite">Delete</button>
    </div>`;
  }).join('');

  const tempUnit = _serverSettings.temp_unit ?? 'C';
  const timeFormat = _serverSettings.time_format ?? '24h';

  return `
    <div class="settings-section">
      <div class="settings-section-title">Theme</div>
      <div class="settings-form-row">
        <label class="settings-label">Background</label>
        <div class="theme-presets">
          ${backgrounds}
          <label class="theme-custom-colour${background === 'custom' ? ' theme-preset-active' : ''}" title="Custom background">
            <span>Custom</span>
            <input class="settings-color-input" type="color" value="${esc(customBackground)}" data-background-custom>
          </label>
        </div>
      </div>
      <div class="settings-form-row">
        <label class="settings-label">Preset</label>
        <div class="theme-presets">${presets}</div>
      </div>
      <div class="settings-form-row">
        <label class="settings-label">Custom accent</label>
        <div class="accent-swatches">${swatches}</div>
      </div>
      <div class="settings-form-row">
        <label class="settings-label">Side panel text</label>
        <div class="accent-swatches">
          ${sidebarSwatches}
          <input class="settings-color-input" type="color" value="${esc(sidebarText)}" data-sidebar-text-custom>
        </div>
      </div>
      <div class="settings-form-row">
        <label class="settings-label">Favourites</label>
        <div class="theme-favourites">
          <div class="theme-favourite-save">
            <input class="settings-input theme-favourite-name" data-theme-favourite-name value="${esc(_themeFavouriteDefaultName())}" placeholder="Theme name">
            <button class="settings-save-btn" type="button" data-theme-favourite-save>Save current</button>
          </div>
          <div class="theme-favourite-list">${favouriteRows || '<div class="settings-empty">No saved theme favourites yet.</div>'}</div>
        </div>
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
  const refreshAppearancePanel = () => {
    el.innerHTML = _appearanceCategoryHtml();
    _attachAppearanceEvents(el);
  };

  const selectAccent = color => {
      document.documentElement.style.setProperty('--printing', color);
      _serverSettings.accent = color;
      fetch('/api/settings/accent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: color }),
      }).catch(() => {});
      el.querySelectorAll('.accent-swatch').forEach(s =>
        s.classList.toggle('accent-swatch-active', s.dataset.accent === color)
      );
      el.querySelectorAll('.theme-preset[data-accent]').forEach(p =>
        p.classList.toggle('theme-preset-active', p.dataset.accent === color)
      );
  };

  const selectBackground = async bg => {
    _serverSettings.theme_background = bg || 'classic';
    _applyAppearanceSettings();
    el.querySelectorAll('.theme-background').forEach(p =>
      p.classList.toggle('theme-preset-active', p.dataset.themeBg === _serverSettings.theme_background)
    );
    el.querySelector('.theme-custom-colour')?.classList.remove('theme-preset-active');
    try {
      await _saveSetting('theme_background', _serverSettings.theme_background);
    } catch (err) {
      showToast('Theme save failed', err.message || '', 'error');
    }
  };

  const selectCustomBackground = async (color, save = true) => {
    const safe = _safeCssHex(color, '#0a0a0f');
    _serverSettings.theme_background = 'custom';
    _serverSettings.theme_background_color = safe;
    _applyAppearanceSettings();
    el.querySelectorAll('.theme-background').forEach(p =>
      p.classList.toggle('theme-preset-active', false)
    );
    el.querySelector('.theme-custom-colour')?.classList.add('theme-preset-active');
    if (!save) return;
    try {
      await _saveSetting('theme_background_color', safe);
      await _saveSetting('theme_background', 'custom');
    } catch (err) {
      showToast('Background save failed', err.message || '', 'error');
    }
  };

  const selectSidebarText = async (color, save = true) => {
    const safe = _safeCssHex(color, '#8fa8c8');
    _serverSettings.sidebar_text_color = safe;
    _applyAppearanceSettings();
    el.querySelectorAll('.sidebar-text-swatch').forEach(s =>
      s.classList.toggle('accent-swatch-active', s.dataset.sidebarText === safe)
    );
    const picker = el.querySelector('[data-sidebar-text-custom]');
    if (picker) picker.value = safe;
    if (!save) return;
    try {
      await _saveSetting('sidebar_text_color', safe);
    } catch (err) {
      showToast('Sidebar colour save failed', err.message || '', 'error');
    }
  };

  const applyFavourite = async fav => {
    if (!fav) return;
    _serverSettings.accent = _safeCssHex(fav.accent, '#3b82f6');
    _serverSettings.theme_background = (fav.theme_background || 'classic').replace(/[^a-z0-9_-]/gi, '') || 'classic';
    _serverSettings.theme_background_color = _safeCssHex(fav.theme_background_color, '#0a0a0f');
    _serverSettings.sidebar_text_color = _safeCssHex(fav.sidebar_text_color, '#8fa8c8');
    _applyAppearanceSettings();
    try {
      await Promise.all([
        _saveSetting('accent', _serverSettings.accent),
        _saveSetting('theme_background', _serverSettings.theme_background),
        _saveSetting('theme_background_color', _serverSettings.theme_background_color),
        _saveSetting('sidebar_text_color', _serverSettings.sidebar_text_color),
      ]);
      refreshAppearancePanel();
      showToast('Theme applied', fav.name, 'success');
    } catch (err) {
      showToast('Theme apply failed', err.message || '', 'error');
    }
  };

  const saveFavourites = async favourites => {
    const json = JSON.stringify(favourites);
    _serverSettings.theme_favourites = json;
    await _saveSetting('theme_favourites', json);
  };

  el.querySelectorAll('.accent-swatch, .theme-preset[data-accent]').forEach(swatch => {
    swatch.addEventListener('click', () => {
      selectAccent(swatch.dataset.accent);
    });
  });

  el.querySelectorAll('.theme-background').forEach(btn => {
    btn.addEventListener('click', () => selectBackground(btn.dataset.themeBg));
  });

  el.querySelector('[data-background-custom]')?.addEventListener('input', e => {
    selectCustomBackground(e.target.value, false);
  });

  el.querySelector('[data-background-custom]')?.addEventListener('change', e => {
    selectCustomBackground(e.target.value, true);
  });

  el.querySelectorAll('.sidebar-text-swatch').forEach(btn => {
    btn.addEventListener('click', () => selectSidebarText(btn.dataset.sidebarText));
  });

  el.querySelector('[data-sidebar-text-custom]')?.addEventListener('input', e => {
    selectSidebarText(e.target.value, false);
  });

  el.querySelector('[data-sidebar-text-custom]')?.addEventListener('change', e => {
    selectSidebarText(e.target.value, true);
  });

  el.querySelector('[data-theme-favourite-save]')?.addEventListener('click', async () => {
    const input = el.querySelector('[data-theme-favourite-name]');
    const favourite = _themeFavouritePayload(input?.value || _themeFavouriteDefaultName());
    const favourites = _themeFavourites();
    favourites.unshift(favourite);
    try {
      await saveFavourites(favourites.slice(0, 12));
      refreshAppearancePanel();
      showToast('Theme favourite saved', favourite.name, 'success');
    } catch (err) {
      showToast('Theme favourite save failed', err.message || '', 'error');
    }
  });

  el.querySelectorAll('[data-theme-favourite]').forEach(row => {
    const id = row.dataset.themeFavourite;
    row.querySelector('.theme-favourite-apply')?.addEventListener('click', () => {
      applyFavourite(_themeFavourites().find(f => f.id === id));
    });
    row.querySelector('.theme-favourite-delete')?.addEventListener('click', async () => {
      const favourites = _themeFavourites().filter(f => f.id !== id);
      try {
        await saveFavourites(favourites);
        refreshAppearancePanel();
      } catch (err) {
        showToast('Theme favourite delete failed', err.message || '', 'error');
      }
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
let _spoolsFilter = { search: '', status: 'active', slotFilter: 'all', material: '', brand: '', printer: '' };
let _spoolsFilamentSummary = {};
let _spoolsFilamentCosts = [];
let _spoolLocations = [];
let _latestSpoolsByPrinter = {};   // printer_id → [spool, ...]
let _latestLowStockPct = 20;
const _COLOR_SCHEMES = [
  { value: 'solid', label: 'Solid' },
  { value: 'dual', label: 'Dual' },
  { value: 'tri', label: 'Tri-colour' },
  { value: 'rainbow', label: 'Rainbow' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'mixed', label: 'Mixed' },
];
const _BRAND_TARE_ESTIMATES = [
  { brand: 'Bambu Lab', grams: 256, aliases: ['bambu'] },
  { brand: '3D Fuel', grams: 264 },
  { brand: '3D Solutech', grams: 173 },
  { brand: 'Amolen', grams: 190 },
  { brand: 'Atomic Filament', grams: 306 },
  { brand: 'Cookie Cad', grams: 175 },
  { brand: 'Colorfabb', grams: 236 },
  { brand: 'Creality', grams: 140 },
  { brand: 'eSun', grams: 224, aliases: ['esun', 'esun 3d'] },
  { brand: 'Jessie Cardboard', grams: 276, aliases: ['jessie cardboard', 'printed solid cardboard'] },
  { brand: 'Jessie Plastic', grams: 297, aliases: ['jessie plastic', 'printed solid plastic'] },
  { brand: 'Inland Black Plastic', grams: 225, aliases: ['inland black plastic'] },
  { brand: 'Inland Clear Plastic', grams: 215, aliases: ['inland clear plastic', 'inland rainbow'] },
  { brand: 'Inland Cardboard', grams: 142, aliases: ['inland cardboard'] },
  { brand: 'Eryone', grams: 267 },
  { brand: 'Fillamentum', grams: 230 },
  { brand: 'Hatchbox', grams: 225 },
  { brand: 'MatterHackers Build Series', grams: 215, aliases: ['matter hackers build', 'matterhackers build'] },
  { brand: 'MatterHackers Quantum', grams: 217, aliases: ['matter hackers quantum', 'matterhackers quantum'] },
  { brand: 'Overture', grams: 237 },
  { brand: 'Polymaker Cardboard', grams: 145, aliases: ['polymaker', 'polymaker cardboard', 'polymaker polyterra'] },
  { brand: 'Printerior Cardboard', grams: 113, aliases: ['printerior'] },
  { brand: 'Prusament', grams: 201 },
  { brand: 'ProtoPasta Cardboard', grams: 80, aliases: ['protopasta', 'proto pasta'] },
  { brand: 'Raise3D', grams: 246, aliases: ['raised 3d', 'raise3d'] },
  { brand: 'StrongHero 3D', grams: 151 },
  { brand: 'SunLu', grams: 133, aliases: ['sunlu'] },
  { brand: 'Ziro', grams: 165 },
  { brand: 'ZYltech', grams: 179, aliases: ['zyltech'] },
  { brand: 'Elegoo', grams: 155 },
  { brand: 'Fiberlogy', grams: 245 },
  { brand: 'FormFutura', grams: 180, aliases: ['form futura'] },
  { brand: 'HP 3D Printing', grams: 187, aliases: ['hp'] },
  { brand: '3DE Cardboard', grams: 136, aliases: ['3de cardboard'] },
  { brand: '3DE Plastic', grams: 181, aliases: ['3de plastic'] },
  { brand: '3DHOJOR Cardboard', grams: 160, aliases: ['3dhojor'] },
  { brand: '3D FilaPrint Cardboard', grams: 210, aliases: ['3d filaprint cardboard'] },
  { brand: '3D FilaPrint Plastic', grams: 238, aliases: ['3d filaprint plastic'] },
  { brand: '3D Genius', grams: 160 },
  { brand: '3D Jake Cardboard', grams: 209, aliases: ['3d jake cardboard'] },
  { brand: '3D Jake Plastic', grams: 229, aliases: ['3d jake plastic'] },
  { brand: '3D Power', grams: 220 },
  { brand: '3DXTech', grams: 265 },
  { brand: 'Acccreate', grams: 181 },
  { brand: 'AIO Robotics', grams: 120 },
  { brand: 'Alfawise', grams: 174 },
];

function _tareKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function _brandTareEstimate(brand, subtype = '') {
  const brandKey = _tareKey(brand);
  if (!brandKey) return null;
  const textKey = _tareKey(`${brand || ''} ${subtype || ''}`);
  const matches = _BRAND_TARE_ESTIMATES.map(entry => {
    const keys = [entry.brand, ...(entry.aliases || [])].map(_tareKey).filter(Boolean);
    const hit = keys.find(key => textKey.includes(key) || key.includes(brandKey));
    return hit ? { ...entry, rank: hit.length } : null;
  }).filter(Boolean).sort((a, b) => b.rank - a.rank);
  return matches[0] || null;
}

function _tareHintText(source) {
  if (!source) return 'tare weight';
  if (source.kind === 'saved') return `saved ${source.brand || 'brand'} tare`;
  if (source.kind === 'catalogue') return 'catalogue tare';
  if (source.kind === 'estimate') return `estimated ${source.brand} tare`;
  return 'tare weight';
}
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

function _slotProfileLabel(report) {
  if (!report || report.empty) return '';
  const profile = report.profile_name || report.type || report.material || '';
  const bits = [profile, report.brand || ''].filter(Boolean);
  if (report.profile_id && !report.profile_name) bits.push(report.profile_id);
  return bits.join(' · ');
}

function _looksLikeBambuProfileCode(value) {
  return /^[A-Z]\d{2}[-_ ]?[A-Z0-9]+$/i.test(String(value || '').trim());
}

function _isGenericProfile(value) {
  const normalised = _normMat(value || '');
  return normalised === 'GENERIC' || normalised.startsWith('GENERIC');
}

const _COMPOSITE_PROFILE_TOKENS = ['CF', 'CARBON', 'GF', 'GLASS', 'WOOD', 'METAL', 'SUPPORT'];

function _reportedProfileText(report) {
  return [report?.brand, report?.type, report?.material, report?.profile_name, report?.profile_id]
    .filter(Boolean).join(' ');
}

function _spoolProfileText(spool) {
  return [spool?.brand, spool?.material, spool?.subtype].filter(Boolean).join(' ');
}

function _genericProfileRejectsSpool(report, spool) {
  if (!(_isGenericProfile(report?.brand) || _isGenericProfile(report?.profile_name))) return false;
  const reported = _normMat(_reportedProfileText(report));
  const spoolText = _normMat(_spoolProfileText(spool));
  return _COMPOSITE_PROFILE_TOKENS.some(token => spoolText.includes(token) && !reported.includes(token));
}

function _reportedBrandMatchesSpool(reportedBrand, spool) {
  const reported = _normMat(reportedBrand);
  const spoolBrand = _normMat(spool?.brand || '');
  if (!reported || reported === 'GENERIC' || reported === spoolBrand) return true;
  const spoolProfile = _normMat([spool?.brand, spool?.material, spool?.subtype].filter(Boolean).join(' '));
  if (spoolProfile && (spoolProfile.includes(reported) || reported.includes(spoolProfile))) return true;
  const reportedFamily = _normMat(String(reportedBrand || '').replace(/\bbambu\s+lab\b/ig, ''));
  const spoolFamily = _normMat([spool?.material, spool?.subtype].filter(Boolean).join(' '));
  return !!(reportedFamily && spoolFamily && (spoolFamily.includes(reportedFamily) || reportedFamily.includes(spoolFamily)));
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
  if (_genericProfileRejectsSpool(report, spool)) {
    return `Profile mismatch: printer ${_reportedProfileText(report) || 'Generic'}, Flightdeck ${_spoolProfileText(spool)}`;
  }
  if (_hexDistance(report.color, spool.color_hex) > 95) {
    return `Colour mismatch: printer ${report.color}, Flightdeck ${spool.color_hex}`;
  }
  const reportedBrand = _normMat(report.brand || '');
  const spoolBrand = _normMat(spool.brand || '');
  if (reportedBrand && spoolBrand && !_reportedBrandMatchesSpool(report.brand || '', spool)) {
    return `Brand mismatch: printer ${report.brand}, Flightdeck ${spool.brand}`;
  }
  const reportedProfile = _normMat(report.profile_name || '');
  const spoolProfile = _normMat([spool.brand, spool.material, spool.subtype].filter(Boolean).join(' '));
  if (_looksLikeBambuProfileCode(report.profile_name)) {
    return '';
  }
  if (_isGenericProfile(report.brand) || _isGenericProfile(report.profile_name)) {
    return '';
  }
  if (reportedProfile && spoolProfile && reportedProfile !== 'generic' && !spoolProfile.includes(reportedProfile) && !reportedProfile.includes(spoolProfile)) {
    return `Profile mismatch: printer ${report.profile_name}, Flightdeck ${[spool.brand, spool.material, spool.subtype].filter(Boolean).join(' ')}`;
  }
  return '';
}

function _slotDoctorState(spool, report) {
  const mismatch = _slotMismatch(spool, report);
  if (mismatch) return { cls: 'warn', label: 'Review', detail: mismatch };
  if (spool && report && !report.empty) return { cls: 'ok', label: 'Matched', detail: 'Flightdeck and printer agree.' };
  if (spool && !report) return { cls: 'info', label: 'Flightdeck only', detail: 'No live printer report available for this slot.' };
  if (!spool && report?.empty) return { cls: 'ok', label: 'Empty', detail: 'Flightdeck and printer both show this slot empty.' };
  return { cls: 'info', label: 'Unassigned', detail: 'No Flightdeck spool assigned.' };
}

function _slotCandidateScore(spool, report) {
  if (!report || report.empty) return 9999;
  const mat = _normMat(`${spool.material || ''}${spool.subtype ? ' ' + spool.subtype : ''}`);
  const reported = _normMat(_slotReportedMaterial(report));
  const matPenalty = reported && mat && (mat.includes(reported) || reported.includes(mat)) ? 0 : 250;
  const profilePenalty = _genericProfileRejectsSpool(report, spool) ? 500 : 0;
  return matPenalty + profilePenalty + _hexDistance(report.color, spool.color_hex);
}

function _slotReport(printer, slotIndex) {
  if (!printer) return null;
  for (const unit of printer.ams || []) {
    for (const slot of unit.slots || []) {
      if (_amsFlatSlot(unit, slot) === Number(slotIndex)) return slot;
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
    const doctor = _slotDoctorState(current, report);
    const candidates = spools
      .filter(s => !s.archived_at && !s.location_printer_id)
      .sort((a, b) =>
        _slotCandidateScore(a, report) - _slotCandidateScore(b, report) ||
        _spoolStorageLocationName(a.storage_location_id).localeCompare(_spoolStorageLocationName(b.storage_location_id)) ||
        (a.material || '').localeCompare(b.material || '') ||
        (a.color_name || '').localeCompare(b.color_name || '')
      );
    const bestCandidate = report && !report.empty ? candidates.find(s => _slotCandidateScore(s, report) < 320) : null;
    const reportProfile = report ? (_slotProfileLabel(report) || 'Loaded filament') : 'No report';
    const reportColour = report?.empty ? 'Empty' : (report?.color || 'Unknown');
    const reportMaterial = report?.empty ? 'Empty' : (_slotReportedMaterial(report) || 'Unknown');
    const reportBrand = report?.empty ? 'Empty' : (report?.brand || report?.profile_name || 'Unknown');
    const printerReportHtml = report
      ? `<div class="slot-facts">
          <div><span>State</span><strong>${esc(report.empty ? 'Empty' : 'Loaded')}</strong></div>
          <div><span>Material</span><strong>${esc(reportMaterial)}</strong></div>
          <div><span>Brand/profile</span><strong>${esc(reportBrand)}</strong></div>
          <div><span>Colour</span><strong>${esc(reportColour)}</strong></div>
        </div>
        <div class="slot-printer-report">${esc(report.empty ? 'Printer reports this slot empty.' : reportProfile)}</div>`
      : '<div class="slot-empty-state">No printer slot report available.</div>';
    const currentHtml = current ? `
      <div class="slot-current-card">
        <span class="location-spool-swatch" style="${_spoolColorStyle(current)}"></span>
        <div class="location-spool-main">
          <div class="location-spool-title">${esc(current.color_name || current.color_hex || 'Colour')} · ${esc(current.material)}${current.subtype ? ` ${esc(current.subtype)}` : ''}</div>
          <div class="location-spool-sub">${esc(current.brand || 'Unknown brand')} · #${current.id} · ${Math.round(current.remaining_g || 0)}g</div>
        </div>
      </div>`
      : '<div class="slot-empty-state">No Flightdeck spool assigned to this slot.</div>';
    const suggestionHtml = bestCandidate && (!current || mismatch) ? `
      <div class="slot-suggestion">
        <div>
          <span>Best stored match</span>
          <strong>${esc(bestCandidate.color_name || bestCandidate.color_hex || 'Colour')} · ${esc(bestCandidate.material)}${bestCandidate.subtype ? ` ${esc(bestCandidate.subtype)}` : ''}</strong>
          <p>${esc(bestCandidate.brand || 'Unknown brand')} · #${bestCandidate.id} · ${Math.round(bestCandidate.remaining_g || 0)}g · ${esc(_spoolStorageLocationName(bestCandidate.storage_location_id))}</p>
        </div>
        <button type="button" class="spool-action-btn spool-action-label" data-slot-spool-id="${bestCandidate.id}">Assign suggested spool</button>
      </div>`
      : '';
    const pickerRows = candidates.length ? candidates.map(s => {
      const pct = s.label_weight_g > 0 ? Math.round(s.remaining_g * 100 / s.label_weight_g) : 0;
      const loc = _spoolStorageLocationName(s.storage_location_id);
      const score = _slotCandidateScore(s, report);
      const suggested = score < 96;
      const searchable = `${loc} ${s.material || ''} ${s.subtype || ''} ${s.brand || ''} ${s.color_name || ''} ${s.color_hex || ''} #${s.id}`.toLowerCase();
      return `<button type="button" class="slot-spool-option" data-slot-spool-id="${s.id}" data-search="${esc(searchable)}">
        <span class="location-spool-swatch" style="${_spoolColorStyle(s)}"></span>
        <span class="slot-spool-option-main">
          <strong>${esc(s.color_name || s.color_hex || 'Colour')} · ${esc(s.material)}${s.subtype ? ` ${esc(s.subtype)}` : ''}${suggested ? ' <em>Suggested</em>' : ''}</strong>
          <small>${esc(s.brand || 'Unknown brand')} · #${s.id} · ${Math.round(s.remaining_g || 0)}g (${pct}%)</small>
        </span>
        <span class="slot-spool-location">${esc(loc)}</span>
      </button>`;
    }).join('') : '<div class="slot-empty-state">No stored spools available.</div>';
    const homeName = current?.home_storage_location_name || _spoolStorageLocationName(current?.home_storage_location_id);
    const autoLocationLabel = homeName
      ? `Return home (${homeName})`
      : 'Return home';
    const returnHelp = current
      ? (homeName && homeName !== 'Unassigned'
        ? `Home shelf memory is set: empty-slot auto-return and Return spool will put spool #${current.id} back in ${homeName} unless you choose another shelf.`
        : `Home shelf memory is still learning: return spool #${current.id} to a shelf once and Flightdeck will use that as its default home next time.`)
      : '';
    const locationOptions = `<option value="">${esc(autoLocationLabel)}</option>` + (
      _spoolLocations.length
        ? _spoolLocations.map(loc => `<option value="${loc.id}">${esc(loc.name)}</option>`).join('')
        : ''
    );
    body.innerHTML = `
      <div class="slot-doctor slot-doctor-${doctor.cls}">
        <div>
          <span>AMS Profile Doctor</span>
          <strong>${esc(doctor.label)}</strong>
        </div>
        <p>${esc(doctor.detail)}</p>
      </div>
      <div class="slot-current">
        <div class="slot-trust-board">
          <div class="slot-trust-card">
            <div class="slot-current-label">Printer report</div>
            ${printerReportHtml}
          </div>
          <div class="slot-trust-card">
            <div class="slot-current-label">Flightdeck assignment</div>
            ${currentHtml}
          </div>
        </div>
        ${mismatch ? `<div class="slot-warning">${esc(mismatch)}</div>` : ''}
        ${suggestionHtml}
        ${current ? `
          <div class="slot-actions slot-actions-primary">
            <a class="spool-action-btn spool-action-detail" href="#/spool/${current.id}">Details</a>
            ${report && !report.empty && !report.active ? `<button class="spool-action-btn spool-action-label" data-slot-load>Load AMS slot</button>` : ''}
            ${report && !report.empty && report.active ? `<button class="spool-action-btn spool-action-weigh" data-slot-unload>Unload AMS slot</button>` : ''}
            <button class="spool-action-btn spool-action-label" data-slot-label-print="${current.id}">Label</button>
            <button class="spool-action-btn spool-action-weigh" data-slot-weigh="${current.id}">Weigh</button>
          </div>
          <div class="slot-actions slot-actions-secondary">
            <button class="spool-action-btn spool-action-label" data-slot-trust-flightdeck="${current.id}">Trust Flightdeck</button>
            ${report ? `<button class="spool-action-btn spool-action-edit" data-slot-trust-printer="${current.id}">Trust Printer</button>` : ''}
            <select class="slot-clear-location" data-slot-clear-location>${locationOptions}</select>
            <button class="spool-action-btn spool-action-danger" data-slot-clear="${current.id}">Return spool</button>
          </div>
          ${returnHelp ? `<div class="slot-return-memory">${esc(returnHelp)}</div>` : ''}` : ''}
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
      _spoolMoveSyncToast(await r.json().catch(() => ({})), printer?.custom_name || printerId, slotLabel);
      await _refreshSpoolsByPrinter();
      load();
      });
    });

    body.querySelector('[data-slot-trust-flightdeck]')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      const id = btn.dataset.slotTrustFlightdeck;
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Syncing';
      const r = await fetch(`/api/spools/${id}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printer_id: printerId, slot: Number(slotIndex) }),
      });
      if (!r.ok) showToast('AMS sync failed', 'Flightdeck could not push this spool to the printer slot.', 'error');
      else _spoolMoveSyncToast(await r.json().catch(() => ({})), printer?.custom_name || printerId, slotLabel);
      await refreshPrinters();
      await _refreshSpoolsByPrinter();
      btn.textContent = old;
      btn.disabled = false;
      load();
    });

    body.querySelector('[data-slot-trust-printer]')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      const id = btn.dataset.slotTrustPrinter;
      const old = btn.textContent;
      const rawStorageId = body.querySelector('[data-slot-clear-location]')?.value || '';
      const storageId = rawStorageId ? Number(rawStorageId) : null;
      btn.disabled = true;
      btn.textContent = 'Updating';
      const r = await fetch(`/api/spools/${id}/trust_printer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printer_id: printerId,
          slot: Number(slotIndex),
          storage_location_id: storageId,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        showToast('Trust Printer failed', err.detail?.message || err.detail || 'Flightdeck could not update this spool from the printer report.', 'error');
      }
      await refreshPrinters();
      await _refreshSpoolsByPrinter();
      btn.textContent = old;
      btn.disabled = false;
      load();
    });

    body.querySelector('#slot-spool-filter')?.addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      const terms = q.split(/\s+/).filter(Boolean);
      body.querySelectorAll('[data-slot-spool-id]').forEach(row => {
        const search = row.dataset.search || '';
        if (!search) return;
        row.hidden = !!(terms.length && !terms.every(term => search.includes(term)));
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

    body.querySelector('[data-slot-load]')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      const confirmed = await _confirmModal(`Load ${slotLabel} on ${printer.custom_name || printer.model_name || printerId}? Flightdeck will ask the printer to feed the AMS filament. Inventory is unchanged.`);
      if (!confirmed) return;
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Loading';
      try {
        await sendAmsLoad({ printerId, slotIndex });
        showToast('AMS load requested', `${slotLabel} load command sent.`, 'success');
        await new Promise(resolve => setTimeout(resolve, 1200));
        await refreshPrinters();
        load();
      } catch (err) {
        showToast('AMS load failed', err.message || '', 'error');
        btn.textContent = old;
        btn.disabled = false;
      }
    });

    body.querySelector('[data-slot-unload]')?.addEventListener('click', async e => {
      const btn = e.currentTarget;
      const confirmed = await _confirmModal(`Unload ${slotLabel} from ${printer.custom_name || printer.model_name || printerId}? Flightdeck will ask the printer to retract the active AMS filament. Inventory is unchanged until the printer reports empty or you clear the slot.`);
      if (!confirmed) return;
      const old = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Unloading';
      try {
        await sendAmsUnload({ printerId, slotIndex });
        showToast('AMS unload requested', `${slotLabel} unload command sent.`, 'success');
        await new Promise(resolve => setTimeout(resolve, 1200));
        await refreshPrinters();
        load();
      } catch (err) {
        showToast('AMS unload failed', err.message || '', 'error');
        btn.textContent = old;
        btn.disabled = false;
      }
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
        showToast('Label print failed', err.message || '', 'error');
        btn.textContent = old;
      } finally {
        setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 1400);
      }
    });

    body.querySelector('[data-slot-weigh]')?.addEventListener('click', async e => {
      const id = e.currentTarget.dataset.slotWeigh;
      const spool = _allSpools.find(s => String(s.id) === String(id));
      const emptyText = await _inputModal({
        title: 'Empty spool weight',
        message: 'Leave blank to use 0g tare.',
        value: spool?.empty_spool_weight_g ?? '',
        inputType: 'number',
        okLabel: 'Weigh',
      });
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
      if (_amsFlatSlot(unit, slot) === slotIndex) {
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

function _spoolColorScheme(value) {
  const scheme = String(value || 'solid').toLowerCase();
  return _COLOR_SCHEMES.some(item => item.value === scheme) ? scheme : 'solid';
}

function _spoolColorBackground(hex, scheme = 'solid', color2 = null, color3 = null) {
  const color = _normHex(hex) || '#808080';
  const second = _normHex(color2) || '#f8fafc';
  const third = _normHex(color3) || '#111827';
  switch (_spoolColorScheme(scheme)) {
    case 'dual':
      return `linear-gradient(90deg, ${color} 0 50%, ${second} 50% 100%)`;
    case 'tri':
      return `linear-gradient(90deg, ${color} 0 33%, ${second} 33% 66%, ${third} 66% 100%)`;
    case 'rainbow':
      return 'linear-gradient(90deg, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #a855f7, #ec4899)';
    case 'gradient':
      return `linear-gradient(135deg, ${color}, ${second})`;
    case 'mixed':
      return `repeating-linear-gradient(135deg, ${color} 0 8px, ${second} 8px 16px, ${third} 16px 24px)`;
    default:
      return color;
  }
}

function _spoolColorStyle(spoolOrHex, scheme = undefined, color2 = null, color3 = null) {
  const hex = typeof spoolOrHex === 'object' ? spoolOrHex?.color_hex : spoolOrHex;
  const value = typeof spoolOrHex === 'object' ? spoolOrHex?.color_scheme : scheme;
  const second = typeof spoolOrHex === 'object' ? spoolOrHex?.color_hex_2 : color2;
  const third = typeof spoolOrHex === 'object' ? spoolOrHex?.color_hex_3 : color3;
  return `background:${_spoolColorBackground(hex, value, second, third)}`;
}

function _spoolProgressColor(pct) {
  if (pct >= 50) return 'var(--printing)';
  if (pct >= 20) return '#f59e0b';
  return 'var(--error)';
}

function _spoolConfidenceHtml(s, compact = false) {
  const c = s.confidence || {};
  const level = c.level || 'estimated';
  const label = c.label || 'Estimated';
  const score = c.score != null ? `${Math.round(c.score)}%` : '--';
  const reasons = (c.reasons || []).join(' · ');
  const title = [score, reasons].filter(Boolean).join(' · ');
  return `<span class="spool-confidence spool-confidence-${level}" title="${esc(title)}">
    ${compact ? '' : `<b>${esc(label)}</b>`}<small>${esc(score)}</small>
  </span>`;
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

function _openSpoolActionModal(spoolId, el, refresh = _refreshSpoolsSurface) {
  const spool = _allSpools.find(s => String(s.id) === String(spoolId));
  const title = spool
    ? `Spool #${spool.id} · ${[spool.color_name, spool.material, spool.subtype].filter(Boolean).join(' ')}`
    : `Spool #${spoolId}`;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const actions = _SPOOL_ACTIONS.map(a => _spoolActionControl(a, spoolId, true)).join('');
  overlay.innerHTML = `
    <div class="modal-box spool-action-modal">
      <div class="modal-header">
        <span class="modal-title">${esc(title)}</span>
        <button class="modal-close-btn">✕</button>
      </div>
      <div class="spool-action-modal-grid">${actions}</div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close-btn')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  _attachSpoolListEvents(el, overlay, refresh);
}

function _spoolGroupKey(s) {
  return [
    s.material || '',
    s.subtype || '',
    s.brand || '',
    s.color_name || '',
    _normHex(s.color_hex) || s.color_hex || '',
    Math.round(Number(s.label_weight_g || 0)),
    s.archived_at ? 'archived' : 'active',
  ].map(v => String(v).trim().toLowerCase()).join('|');
}

function _spoolGroupLocationSummary(group) {
  const names = new Set();
  for (const s of group) {
    if (s.location_printer_id) {
      const p = _latestPrinters.find(x => x.id === s.location_printer_id);
      names.add(p?.custom_name ?? s.location_printer_id);
    } else {
      names.add(_spoolStorageLocationName(s.storage_location_id));
    }
  }
  const list = [...names].filter(Boolean);
  if (!list.length) return 'No location';
  if (list.length === 1) return list[0];
  return `${list[0]} +${list.length - 1}`;
}

function _spoolGroupedCards(spools) {
  const groups = new Map();
  for (const s of spools) {
    const key = _spoolGroupKey(s);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return [...groups.values()]
    .map(group => group.sort((a, b) => Number(a.id || 0) - Number(b.id || 0)))
    .sort((a, b) => {
      const aLatest = Math.max(...a.map(s => Number(s.id || 0)));
      const bLatest = Math.max(...b.map(s => Number(s.id || 0)));
      return aLatest - bLatest;
    });
}

function _spoolGroupCounts(spools) {
  const counts = new Map();
  for (const s of spools) {
    const key = _spoolGroupKey(s);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function _spoolGroupCardHtml(group) {
  if (group.length === 1) return _spoolCardHtml(group[0]);
  const first = group[0];
  const latestId = Math.max(...group.map(s => Number(s.id || 0)));
  const rollTitle = group.map(s => `#${s.id}`).join(', ');
  const totalRemaining = group.reduce((sum, s) => sum + Number(s.remaining_g || 0), 0);
  const totalLabel = group.reduce((sum, s) => sum + Number(s.label_weight_g || 0), 0);
  const used = Math.max(0, totalLabel - totalRemaining);
  const pct = totalLabel > 0 ? Math.round(totalRemaining * 100 / totalLabel) : 0;
  const barColor = _spoolProgressColor(pct);
  const bandColor = first.color_hex || '#404040';
  const textColor = _spoolTextColor(bandColor);
  const locationSummary = _spoolGroupLocationSummary(group);
  const confidenceScores = group.map(s => Number(s.confidence?.score ?? 0)).filter(n => !isNaN(n));
  const confidenceAvg = confidenceScores.length
    ? Math.round(confidenceScores.reduce((sum, n) => sum + n, 0) / confidenceScores.length)
    : null;
  const rollChips = group.map(s => {
    const rollPct = s.label_weight_g > 0 ? Math.round(s.remaining_g * 100 / s.label_weight_g) : 0;
    const cls = rollPct < 20 ? ' spool-low' : rollPct < 50 ? ' spool-amber' : '';
    return `<a class="spool-roll-chip${cls}" href="#/spool/${s.id}" title="#${s.id} · ${Math.round(s.remaining_g || 0)}g">#${s.id}</a>`;
  }).join('');
  const rows = group.map(s => {
    const rollPct = s.label_weight_g > 0 ? Math.round(s.remaining_g * 100 / s.label_weight_g) : 0;
    const cls = rollPct < 20 ? ' spool-low' : rollPct < 50 ? ' spool-amber' : '';
    const p = _latestPrinters.find(x => x.id === s.location_printer_id);
    const loc = s.location_printer_id
      ? `${p?.custom_name ?? s.location_printer_id} ${_amsSlotLabel(p, s.location_slot)}`
      : _spoolStorageLocationName(s.storage_location_id);
    return `<div class="spool-group-roll">
      <a class="spool-group-roll-id" href="#/spool/${s.id}">#${s.id}</a>
      <span class="spool-group-roll-grams${cls}">${Math.round(s.remaining_g || 0)}g</span>
      <span class="spool-group-roll-loc" title="${esc(loc)}">${esc(loc)}</span>
      <button class="spool-group-manage spool-action-btn spool-action-more" data-action="manage" data-id="${s.id}" title="Spool actions">Manage</button>
    </div>`;
  }).join('');
  return `<div class="spool-card spool-group-card" data-spool-group="${esc(_spoolGroupKey(first))}">
    <div class="spool-card-band" style="${_spoolColorStyle(first)};color:${textColor}">
      <span class="spool-color-name">${esc(first.color_name || '—')}</span>
      <span class="spool-id-badge" title="${esc(`${group.length} rolls · latest #${latestId} · ${rollTitle}`)}">${group.length} rolls</span>
    </div>
    <div class="spool-card-body">
      <div class="spool-card-row">
        <span class="spool-material">${esc(first.material)}${first.subtype ? ' ' + esc(first.subtype) : ''}</span>
        <span class="spool-location-badge" title="${esc(locationSummary)}">${esc(locationSummary)}</span>
      </div>
      <div class="spool-card-row spool-brand">${esc(first.brand || 'Unknown brand')}</div>
      <div class="spool-remaining-row">
        <span class="spool-remaining-label">Combined ${group.length} rolls</span>
        <span class="spool-remaining-pct${pct < 20 ? ' spool-low' : pct < 50 ? ' spool-amber' : ''}">${pct}%</span>
        <span class="spool-remaining-g">${Math.round(totalRemaining)}g</span>
      </div>
      <div class="spool-progress-bar">
        <div class="spool-progress-fill" style="width:${pct}%;background:${barColor}"></div>
      </div>
      <div class="spool-meta-row">
        <span class="spool-meta">${Math.round(totalLabel)}g total</span>
        ${confidenceAvg != null ? `<span class="spool-meta">${confidenceAvg}% trust</span>` : ''}
      </div>
      <div class="spool-roll-chips">${rollChips}</div>
      <details class="spool-group-details">
        <summary class="spool-group-summary">Rolls <span>${group.length}</span></summary>
        <div class="spool-group-rolls">${rows}</div>
      </details>
    </div>
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
    <div class="spool-card-band" style="${_spoolColorStyle(s)};color:${textColor}">
      <span class="spool-color-name">${s.color_name || '—'}</span>
      <span class="spool-id-badge">#${s.id}</span>
    </div>
    <div class="spool-card-body">
      <div class="spool-card-row">
        <span class="spool-material">${s.material}${s.subtype ? ' ' + s.subtype : ''}</span>
        ${locBadge}
      </div>
      <div class="spool-card-row spool-confidence-row">${_spoolConfidenceHtml(s)}</div>
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
      <td class="spool-td"><span class="spool-table-swatch" style="${_spoolColorStyle(s)}"></span></td>
      <td class="spool-td">${s.material}</td>
      <td class="spool-td spool-td-muted">${s.subtype || '—'}</td>
      <td class="spool-td">${s.brand}</td>
      <td class="spool-td spool-td-muted">${loc}</td>
      <td class="spool-td">${_spoolConfidenceHtml(s, true)}</td>
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
        ${th('location_printer_id','Location')}<th class="spool-th">Trust</th>${th('label_weight_g','Label')}${th('remaining_g','Remaining')}
        <th class="spool-th">Actions</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function _spoolCabinetTileHtml(s) {
  const pct = s.label_weight_g > 0 ? Math.round(s.remaining_g * 100 / s.label_weight_g) : 0;
  const bandColor = s.color_hex || '#404040';
  const textColor = _spoolTextColor(bandColor);
  const pctCls = pct < 20 ? ' spool-low' : pct < 50 ? ' spool-amber' : '';
  return `<div class="spool-cabinet-tile" data-spool-id="${s.id}">
    <a class="spool-cabinet-swatch" href="#/spool/${s.id}" style="${_spoolColorStyle(s)};color:${textColor}" title="#${s.id} ${esc(s.color_name || '')}">
      <span>${esc(s.color_name || bandColor)}</span>
      <b>#${s.id}</b>
    </a>
    <div class="spool-cabinet-info">
      <strong>${esc(s.material)}${s.subtype ? ` ${esc(s.subtype)}` : ''}</strong>
      <span>${esc(s.brand || '')}</span>
      <em class="${pctCls}">${Math.round(s.remaining_g || 0)}g · ${pct}%</em>
    </div>
    <div class="spool-cabinet-actions">
      <button class="spool-action-btn spool-action-label" data-action="label" data-id="${s.id}" title="Print label">Label</button>
      <button class="spool-action-btn spool-action-edit" data-action="edit" data-id="${s.id}" title="Edit">Edit</button>
    </div>
  </div>`;
}

function _spoolCabinetHtml(spools) {
  const stored = [...spools].filter(s => !s.location_printer_id && !s.archived_at);
  const loaded = [...spools].filter(s => s.location_printer_id && !s.archived_at);
  const locations = _spoolLocations.length
    ? _spoolLocations
    : [{ id: '', name: 'Unassigned', notes: '' }];
  const laneHtml = locations.map(loc => {
    const items = stored
      .filter(s => String(s.storage_location_id ?? '') === String(loc.id ?? ''))
      .sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    const grams = items.reduce((sum, s) => sum + Number(s.remaining_g || 0), 0);
    return `<section class="spool-cabinet-lane">
      <div class="spool-cabinet-lane-head">
        <div>
          <strong>${esc(loc.name || 'Unassigned')}</strong>
          <span>${esc(loc.notes || 'Storage shelf')}</span>
        </div>
        <b>${items.length} · ${(grams / 1000).toFixed(2)}kg</b>
      </div>
      <div class="spool-cabinet-tiles">
        ${items.length ? items.map(_spoolCabinetTileHtml).join('') : '<div class="spool-cabinet-empty">No spools here.</div>'}
      </div>
    </section>`;
  }).join('');
  const loadedHtml = loaded.length ? `<section class="spool-cabinet-lane spool-cabinet-lane-loaded">
    <div class="spool-cabinet-lane-head">
      <div>
        <strong>Loaded</strong>
        <span>Currently sitting in printers</span>
      </div>
      <b>${loaded.length}</b>
    </div>
    <div class="spool-cabinet-tiles">
      ${loaded.sort((a, b) => Number(a.id || 0) - Number(b.id || 0)).map(_spoolCabinetTileHtml).join('')}
    </div>
  </section>` : '';
  return `<div class="spool-cabinet-view">${laneHtml}${loadedHtml}</div>`;
}

function _applySpoolFilters(spools) {
  const f = _spoolsFilter;
  const thresh = _latestLowStockPct;
  const filtered = spools.filter(s => {
    if (f.status === 'active'   && s.archived_at)  return false;
    if (f.status === 'archived' && !s.archived_at) return false;
    if (f.printer && s.location_printer_id !== f.printer) return false;
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
      const haystack = [
        `#${s.id}`,
        String(s.id || ''),
        s.material,
        s.brand,
        s.subtype,
        s.color_name,
        s.color_hex,
        s.notes,
        s.storage_location_name,
        s.location_printer_id,
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const groupCounts = f.slotFilter === 'multiples' ? _spoolGroupCounts(filtered) : null;
  const multiples = groupCounts
    ? filtered.filter(s => (groupCounts.get(_spoolGroupKey(s)) || 0) > 1)
    : filtered;
  return multiples.sort((a, b) => {
    const va = a[_spoolsSortKey], vb = b[_spoolsSortKey];
    if (typeof va === 'string') return _spoolsSortDir * (va || '').localeCompare(vb || '');
    return _spoolsSortDir * ((va ?? 0) - (vb ?? 0));
  });
}

function _stockInLocationOptions(selected = '', opts = {}) {
  const locs = _spoolLocations.length ? _spoolLocations : [];
  const selectedValue = opts.defaultFirst && String(selected ?? '') === '' && locs[0]?.id
    ? String(locs[0].id)
    : String(selected ?? '');
  return `<option value="">Select location</option>` + locs.map(loc =>
    `<option value="${loc.id}"${selectedValue === String(loc.id) ? ' selected' : ''}>${esc(loc.name)}</option>`
  ).join('');
}

function _stockInRollLabel(roll) {
  return `${roll.color_name || 'Colour'} ${roll.material || ''}${roll.subtype ? ` ${roll.subtype}` : ''} · ${roll.brand || 'Unknown'}`.trim();
}

function _stockInLineHtml(index, defaultWeight) {
  const colours = ['#808080', '#ffffff', '#111827', '#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];
  const colourButtons = colours.map(c =>
    `<button type="button" class="stock-in-colour-chip" style="background:${c}" data-stock-colour="${c}" aria-label="${c}"></button>`
  ).join('');
  return `<div class="stock-in-line" data-line-index="${index}">
    <div class="stock-in-line-head">
      <strong>Roll type ${index + 1}</strong>
      <button type="button" class="stock-in-remove-line" aria-label="Remove roll type">Remove</button>
    </div>
    <div class="stock-in-line-grid">
      <label>Qty <input name="quantity" type="number" min="1" max="100" value="1"></label>
      <label>Material <input name="material" value="PLA"></label>
      <label>Brand <input name="brand" placeholder="Brand" value="Bambu Lab"></label>
      <label>Type <input name="subtype" placeholder="Basic, Silk, Matte"></label>
      <label>Colour name <input name="color_name" placeholder="Magenta"></label>
      <label class="stock-in-colour-field">Colour
        <span class="stock-in-colour-row">
          <input name="color_hex" type="color" value="#808080">
          <span>${colourButtons}</span>
        </span>
      </label>
      <label>Label weight <input name="label_weight_g" type="number" min="0" step="1" value="${defaultWeight}"></label>
      <label>Tare <input name="empty_spool_weight_g" type="number" min="0" step="1" placeholder="Optional"></label>
      <label>Location <select name="storage_location_id">${_stockInLocationOptions('', { defaultFirst: true })}</select></label>
      <label class="stock-in-notes">Notes <input name="notes" placeholder="Optional notes"></label>
    </div>
  </div>`;
}

function _stockInRenumberLines(form) {
  form.querySelectorAll('.stock-in-line').forEach((line, index) => {
    line.dataset.lineIndex = index;
    const title = line.querySelector('.stock-in-line-head strong');
    if (title) title.textContent = `Roll type ${index + 1}`;
    line.querySelector('.stock-in-remove-line').disabled = form.querySelectorAll('.stock-in-line').length <= 1;
  });
}

async function _renderStockInView(listEl) {
  const params = _routeParams('#/spools');
  const scanToken = params.get('token') || '';
  const [orders, scanRoll] = await Promise.all([
    fetch('/api/stock-in/orders').then(r => r.json()).catch(() => []),
    scanToken ? fetch(`/api/stock-in/rolls/${encodeURIComponent(scanToken)}`).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null),
  ]);
  const defaultWeight = Number(_serverSettings.default_label_weight_g || 1000) || 1000;
  const orderRows = orders.length ? orders.map(order => {
    const rolls = order.rolls || [];
    const rollRows = rolls.map(roll => `
      <tr>
        <td><span class="stock-in-swatch" style="background:${esc(roll.color_hex || '#808080')}"></span></td>
        <td>${esc(_stockInRollLabel(roll))}<small>${esc(roll.storage_location_name || 'Select location')}</small></td>
        <td>${Math.round(Number(roll.label_weight_g || 0))}g</td>
        <td>${roll.status === 'received' ? `<a href="#/spool/${roll.spool_id}">Spool #${roll.spool_id}</a>` : roll.status === 'cancelled' ? '<span class="badge stock-cancelled">Cancelled</span>' : '<span class="badge">Pending</span>'}</td>
        <td class="stock-in-row-actions">
          ${roll.status === 'pending' ? `
            <button class="tiny-btn" data-stock-edit="${esc(roll.token)}">Edit</button>
            <button class="tiny-btn danger" data-stock-clear="${esc(roll.token)}">Clear</button>
            <a class="tiny-btn" href="#/spools?view=incoming&token=${encodeURIComponent(roll.token)}">Receive</a>
          ` : roll.status === 'received' ? `<a class="tiny-btn" href="#/spool/${roll.spool_id}">Open spool</a>` : `<small>${esc(roll.cancel_reason || 'Cleared')}</small>`}
        </td>
      </tr>`).join('');
    return `<section class="stock-in-order" data-order-id="${order.id}">
      <div class="stock-in-order-head">
        <div>
          <h3>Order #${order.id}</h3>
          <p>${esc(order.supplier || 'Supplier not set')} ${order.order_ref ? `· ${esc(order.order_ref)}` : ''}</p>
        </div>
        <div class="stock-in-counts">${order.received_count || 0}/${rolls.length} received</div>
        <button class="button" data-stock-sheet="${order.id}">Open sheet</button>
        <button class="button" data-stock-print="${order.id}">Print / PDF</button>
      </div>
      <table class="stock-in-table"><tbody>${rollRows}</tbody></table>
    </section>`;
  }).join('') : `<div class="filament-empty">No stock-in batches yet.</div>`;

  const scanPanel = scanRoll ? `<section class="stock-in-scan-card">
    <div>
      <div class="settings-section-title">Receive Roll</div>
      <h3>${esc(_stockInRollLabel(scanRoll))}</h3>
      <p>${esc(scanRoll.supplier || 'Supplier not set')} ${scanRoll.order_ref ? `· ${esc(scanRoll.order_ref)}` : ''}</p>
    </div>
    ${scanRoll.status === 'received' ? `
      <div class="stock-in-received">Already received as <a href="#/spool/${scanRoll.spool_id}">Spool #${scanRoll.spool_id}</a></div>
    ` : `
      <form class="stock-in-receive-form" data-token="${esc(scanRoll.token)}">
        <label>Location <select name="storage_location_id">${_stockInLocationOptions(scanRoll.storage_location_id || '', { defaultFirst: true })}</select></label>
        <label>Remaining <input name="remaining_g" type="number" min="0" step="1" value="${Math.round(Number(scanRoll.label_weight_g || defaultWeight))}"></label>
        <label>Label weight <input name="label_weight_g" type="number" min="0" step="1" value="${Math.round(Number(scanRoll.label_weight_g || defaultWeight))}"></label>
        <label>Tare <input name="empty_spool_weight_g" type="number" min="0" step="1" value="${scanRoll.empty_spool_weight_g ?? ''}"></label>
        <label class="stock-in-notes">Notes <input name="notes" value="${esc(scanRoll.notes || '')}" placeholder="Optional notes"></label>
        <label class="stock-in-check"><input name="print_label" type="checkbox" checked> Print permanent spool label</label>
        <button class="button primary" type="submit">Receive and number spool</button>
      </form>`}
  </section>` : scanToken ? `<section class="stock-in-scan-card stock-in-warn">Incoming roll not found.</section>` : '';

  listEl.innerHTML = `
    ${scanPanel}
    <section class="stock-in-create">
      <div class="settings-section-title">Create Receiving Sheet</div>
      <form id="stock-in-create-form" class="stock-in-form">
        <div class="stock-in-order-fields">
          <label>Supplier <input name="supplier" placeholder="e.g. Bambu Lab"></label>
          <label>Order ref <input name="order_ref" placeholder="Invoice or PO"></label>
          <label class="stock-in-notes">Order notes <input name="order_notes" placeholder="Optional order notes"></label>
        </div>
        <div class="stock-in-lines" id="stock-in-lines">
          ${_stockInLineHtml(0, defaultWeight)}
        </div>
        <div class="stock-in-form-actions">
          <button type="button" class="button" id="stock-in-add-line">+ Add roll type</button>
          <button class="button primary" type="submit">Create sheet</button>
        </div>
      </form>
    </section>
    <section class="stock-in-orders">
      <div class="settings-section-title">Recent Stock In</div>
      ${orderRows}
    </section>`;

  listEl.querySelector('#stock-in-create-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const fieldValue = (line, name) => line.querySelector(`[name="${name}"]`)?.value ?? '';
    const numberOrNull = (line, name) => {
      const v = String(fieldValue(line, name) || '').trim();
      return v === '' ? null : Number(v);
    };
    const lines = [...form.querySelectorAll('.stock-in-line')].map(line => {
      return {
        quantity: Number(fieldValue(line, 'quantity') || 1),
        material: String(fieldValue(line, 'material') || '').trim(),
        brand: String(fieldValue(line, 'brand') || '').trim(),
        subtype: String(fieldValue(line, 'subtype') || '').trim() || null,
        color_name: String(fieldValue(line, 'color_name') || '').trim() || null,
        color_hex: String(fieldValue(line, 'color_hex') || '#808080'),
        label_weight_g: Number(fieldValue(line, 'label_weight_g') || defaultWeight),
        empty_spool_weight_g: numberOrNull(line, 'empty_spool_weight_g'),
        storage_location_id: numberOrNull(line, 'storage_location_id'),
        notes: String(fieldValue(line, 'notes') || '').trim() || null,
      };
    }).filter(line => line.material && line.brand);
    if (!lines.length) return showToast('Stock-in needs a roll', 'Add at least one material and brand.', 'warn');
    const body = {
      supplier: String(fd.get('supplier') || '').trim() || null,
      order_ref: String(fd.get('order_ref') || '').trim() || null,
      notes: String(fd.get('order_notes') || '').trim() || null,
      lines,
    };
    const r = await fetch('/api/stock-in/orders', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (!r.ok) return showToast('Stock-in failed', (await r.json()).detail || 'Could not create sheet', 'error');
    const order = await r.json();
    showToast('Receiving sheet created', `${order.rolls?.length || 0} roll QR codes ready`, 'success');
    await _renderStockInView(listEl);
    _openStockInSheet(order);
  });

  const createForm = listEl.querySelector('#stock-in-create-form');
  if (createForm) {
    createForm.addEventListener('click', e => {
      const colourBtn = e.target.closest('[data-stock-colour]');
      if (colourBtn) {
        const line = colourBtn.closest('.stock-in-line');
        const input = line?.querySelector('input[name="color_hex"]');
        if (input) input.value = colourBtn.dataset.stockColour;
        return;
      }
      if (e.target.closest('#stock-in-add-line')) {
        const linesEl = createForm.querySelector('#stock-in-lines');
        linesEl.insertAdjacentHTML('beforeend', _stockInLineHtml(linesEl.querySelectorAll('.stock-in-line').length, defaultWeight));
        _stockInRenumberLines(createForm);
        return;
      }
      const remove = e.target.closest('.stock-in-remove-line');
      if (remove) {
        const line = remove.closest('.stock-in-line');
        if (line && createForm.querySelectorAll('.stock-in-line').length > 1) line.remove();
        _stockInRenumberLines(createForm);
      }
    });
    _stockInRenumberLines(createForm);
  }

  listEl.querySelector('.stock-in-receive-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const num = name => {
      const v = String(fd.get(name) || '').trim();
      return v === '' ? null : Number(v);
    };
    const body = {
      storage_location_id: num('storage_location_id'),
      remaining_g: num('remaining_g'),
      label_weight_g: num('label_weight_g'),
      empty_spool_weight_g: num('empty_spool_weight_g'),
      notes: String(fd.get('notes') || '').trim() || null,
      print_label: !!fd.get('print_label'),
    };
    const r = await fetch(`/api/stock-in/rolls/${encodeURIComponent(form.dataset.token)}/receive`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
    });
    if (!r.ok) return showToast('Receive failed', (await r.json()).detail || 'Could not receive roll', 'error');
    const result = await r.json();
    const spoolId = result.spool?.id;
    showToast(`Spool #${spoolId} created`, result.label_printed ? 'Label printed' : (result.label_error || 'Label not printed'), result.label_error ? 'warn' : 'success');
    location.hash = `#/spool/${spoolId}`;
  });

  listEl.querySelectorAll('[data-stock-print]').forEach(btn => {
    btn.addEventListener('click', () => {
      const order = orders.find(o => String(o.id) === String(btn.dataset.stockPrint));
      if (order) _printStockInSheet(order);
    });
  });
  listEl.querySelectorAll('[data-stock-sheet]').forEach(btn => {
    btn.addEventListener('click', () => {
      const order = orders.find(o => String(o.id) === String(btn.dataset.stockSheet));
      if (order) _openStockInSheet(order);
    });
  });
  listEl.querySelectorAll('[data-stock-edit]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const roll = orders.flatMap(o => o.rolls || []).find(r => r.token === btn.dataset.stockEdit);
      if (roll) _openStockInRollEdit(roll, () => _renderStockInView(listEl));
    });
  });
  listEl.querySelectorAll('[data-stock-clear]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = await _inputModal({
        title: 'Clear incoming roll',
        message: 'Use this for damaged stock, wrong details, or a bad scan.',
        value: 'Damaged or incorrect',
        okLabel: 'Clear',
      });
      if (reason === null) return;
      const r = await fetch(`/api/stock-in/rolls/${encodeURIComponent(btn.dataset.stockClear)}/cancel`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ reason: reason.trim() || 'Cleared' }),
      });
      if (!r.ok) return showToast('Clear failed', (await r.json()).detail || 'Could not clear roll', 'error');
      showToast('Incoming roll cleared', reason.trim() || 'Cleared', 'success');
      await _renderStockInView(listEl);
    });
  });
}

function _stockInSheetBodyHtml(order) {
  const rolls = order.rolls || [];
  const rows = rolls.map((roll, idx) => {
    const status = roll.status === 'received' ? `Spool #${roll.spool_id}` : 'Pending';
    return `<div class="stock-sheet-row${roll.status === 'cancelled' ? ' stock-sheet-row-cancelled' : ''}">
      <div class="stock-sheet-index">${idx + 1}</div>
      <img src="/api/stock-in/rolls/${encodeURIComponent(roll.token)}/qr.png">
      <div class="stock-sheet-roll">
        <strong>${esc(_stockInRollLabel(roll))}</strong>
        <div class="stock-sheet-meta">
          <span><i class="stock-in-swatch" style="background:${esc(roll.color_hex || '#808080')}"></i>${esc(roll.color_name || roll.color_hex || '')}</span>
          <span>${Math.round(Number(roll.label_weight_g || 0))}g</span>
          <span>${esc(roll.storage_location_name || 'Select location')}</span>
          <span>${esc(status)}</span>
        </div>
        <small>${esc(roll.token)}</small>
      </div>
      <div class="stock-sheet-row-actions">
        ${roll.status === 'pending' ? `
          <button class="tiny-btn" data-stock-edit="${esc(roll.token)}">Edit</button>
          <button class="tiny-btn danger" data-stock-clear="${esc(roll.token)}">Clear</button>
          <a class="tiny-btn" href="#/spools?view=incoming&token=${encodeURIComponent(roll.token)}">Receive</a>
        ` : roll.status === 'received' ? `<a class="tiny-btn" href="#/spool/${roll.spool_id}">Open spool</a>` : `<small>${esc(roll.cancel_reason || 'Cleared')}</small>`}
      </div>
    </div>`;
  }).join('');
  return `<div class="stock-sheet">
    <div class="stock-sheet-head">
      <div>
        <h1>Flightdeck Stock In #${order.id}</h1>
        <p>${esc(order.supplier || 'Supplier not set')} ${order.order_ref ? `· ${esc(order.order_ref)}` : ''}</p>
      </div>
      <div class="stock-sheet-count">${rolls.length} rolls</div>
    </div>
    <div class="stock-sheet-table">${rows}</div>
  </div>`;
}

function _openStockInSheet(order) {
  const existing = document.querySelector('.stock-sheet-overlay');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay stock-sheet-overlay';
  overlay.innerHTML = `<div class="stock-sheet-modal">
    <div class="stock-sheet-modal-head">
      <div>
        <div class="settings-section-title">Receiving Sheet</div>
        <strong>Stock In #${order.id}</strong>
      </div>
      <div class="stock-sheet-actions">
        <button type="button" class="button" data-stock-sheet-print>Print / Save PDF</button>
        <button type="button" class="button" data-stock-sheet-close>Close</button>
      </div>
    </div>
    ${_stockInSheetBodyHtml(order)}
  </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('[data-stock-sheet-close]')?.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('[data-stock-sheet-print]')?.addEventListener('click', () => _printStockInSheet(order));
  overlay.querySelectorAll('[data-stock-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const roll = (order.rolls || []).find(r => r.token === btn.dataset.stockEdit);
      if (roll) _openStockInRollEdit(roll, async () => {
        const fresh = await fetch('/api/stock-in/orders').then(r => r.json()).catch(() => []);
        const freshOrder = fresh.find(o => String(o.id) === String(order.id));
        if (freshOrder) _openStockInSheet(freshOrder);
      });
    });
  });
  overlay.querySelectorAll('[data-stock-clear]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const reason = await _inputModal({
        title: 'Clear incoming roll',
        message: 'Use this for damaged stock, wrong details, or a bad scan.',
        value: 'Damaged or incorrect',
        okLabel: 'Clear',
      });
      if (reason === null) return;
      const r = await fetch(`/api/stock-in/rolls/${encodeURIComponent(btn.dataset.stockClear)}/cancel`, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ reason: reason.trim() || 'Cleared' }),
      });
      if (!r.ok) return showToast('Clear failed', (await r.json()).detail || 'Could not clear roll', 'error');
      const fresh = await fetch('/api/stock-in/orders').then(r => r.json()).catch(() => []);
      const freshOrder = fresh.find(o => String(o.id) === String(order.id));
      showToast('Incoming roll cleared', reason.trim() || 'Cleared', 'success');
      if (freshOrder) _openStockInSheet(freshOrder);
    });
  });
}

function _openStockInRollEdit(roll, onSaved) {
  if (roll.status !== 'pending') return showToast('Cannot edit roll', 'Only pending incoming rolls can be edited.', 'warn');
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay stock-edit-overlay';
  overlay.innerHTML = `<div class="stock-edit-modal">
    <div class="stock-sheet-modal-head">
      <div>
        <div class="settings-section-title">Edit Incoming Roll</div>
        <strong>${esc(_stockInRollLabel(roll))}</strong>
      </div>
      <button type="button" class="button" data-stock-edit-close>Close</button>
    </div>
    <form class="stock-edit-form">
      <label>Material <input name="material" value="${esc(roll.material || '')}"></label>
      <label>Brand <input name="brand" value="${esc(roll.brand || '')}"></label>
      <label>Type <input name="subtype" value="${esc(roll.subtype || '')}"></label>
      <label>Colour name <input name="color_name" value="${esc(roll.color_name || '')}"></label>
      <label>Colour <input name="color_hex" type="color" value="${esc(roll.color_hex || '#808080')}"></label>
      <label>Label weight <input name="label_weight_g" type="number" min="0" step="1" value="${Math.round(Number(roll.label_weight_g || 0))}"></label>
      <label>Tare <input name="empty_spool_weight_g" type="number" min="0" step="1" value="${roll.empty_spool_weight_g ?? ''}"></label>
      <label>Location <select name="storage_location_id">${_stockInLocationOptions(roll.storage_location_id || '')}</select></label>
      <label class="stock-in-notes">Notes <input name="notes" value="${esc(roll.notes || '')}" placeholder="Optional notes"></label>
      <div class="stock-edit-actions">
        <button type="button" class="button" data-stock-edit-close>Cancel</button>
        <button class="button primary" type="submit">Save roll</button>
      </div>
    </form>
  </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-stock-edit-close]').forEach(btn => btn.addEventListener('click', close));
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.stock-edit-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const num = name => {
      const v = String(fd.get(name) || '').trim();
      return v === '' ? null : Number(v);
    };
    const body = {
      material: String(fd.get('material') || '').trim(),
      brand: String(fd.get('brand') || '').trim(),
      subtype: String(fd.get('subtype') || '').trim() || null,
      color_name: String(fd.get('color_name') || '').trim() || null,
      color_hex: String(fd.get('color_hex') || '#808080'),
      label_weight_g: num('label_weight_g') ?? roll.label_weight_g,
      empty_spool_weight_g: num('empty_spool_weight_g'),
      storage_location_id: num('storage_location_id'),
      notes: String(fd.get('notes') || '').trim() || null,
    };
    const r = await fetch(`/api/stock-in/rolls/${encodeURIComponent(roll.token)}`, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
    });
    if (!r.ok) return showToast('Save failed', (await r.json()).detail || 'Could not update roll', 'error');
    close();
    showToast('Incoming roll updated', `${body.color_name || body.material} saved`, 'success');
    if (onSaved) await onSaved();
  });
}

function _printStockInSheet(order) {
  const win = window.open('', '_blank');
  if (!win) return showToast('Print sheet blocked', 'Allow popups to print or save PDF.', 'warn');
  win.document.write(`<!doctype html><html><head><title>Flightdeck Stock In #${order.id}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:24px;color:#111}
      h1{margin:0 0 4px;font-size:24px}.stock-sheet-head{display:flex;justify-content:space-between;gap:16px;margin-bottom:18px}
      .stock-sheet-head p{margin:0;color:#555}.stock-sheet-count{font-weight:700}
      .stock-sheet-table{display:grid;gap:10px}.stock-sheet-row{border:1px solid #ccc;border-radius:8px;padding:10px;display:grid;grid-template-columns:34px 96px 1fr;gap:12px;align-items:center;break-inside:avoid}
      img{width:96px;height:96px}.stock-sheet-index{font-size:18px;font-weight:700}.stock-sheet-roll strong{display:block;margin-bottom:6px}
      .stock-sheet-meta{display:flex;flex-wrap:wrap;gap:8px 14px;color:#333;font-size:13px}.stock-sheet-meta span{white-space:nowrap}
      .stock-in-swatch{border:1px solid #aaa;border-radius:999px;display:inline-block;height:12px;margin-right:5px;vertical-align:-1px;width:12px}
      small{display:block;color:#666;margin-top:6px}.tiny-btn{display:none}
      @media print{body{margin:12mm}.stock-sheet-row{page-break-inside:avoid}}
    </style></head><body>
    ${_stockInSheetBodyHtml(order)}
    <script>setTimeout(()=>print(),400)</script>
    </body></html>`);
  win.document.close();
}

function _renderSpoolList(el) {
  const listEl = el.querySelector('#spool-list');
  if (!listEl) return;
  if (_spoolsViewMode === 'incoming') {
    listEl.className = 'stock-in-view';
    listEl.innerHTML = `<div class="detail-placeholder" style="min-height:8rem">Loading stock-in…</div>`;
    _renderStockInView(listEl);
    return;
  }
  if (_spoolsViewMode === 'catalogue') {
    listEl.className = 'spool-catalogue-settings';
    listEl.innerHTML = _filamentCategoryHtml(_spoolsFilamentSummary, _spoolsFilamentCosts);
    _attachFilamentEvents(listEl, () => _renderSpoolsContent(el));
    return;
  }
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
  } else if (_spoolsViewMode === 'cabinet') {
    listEl.className = '';
    listEl.innerHTML = _spoolCabinetHtml(filtered);
  } else {
    listEl.className = 'spool-card-grid';
    listEl.innerHTML = _spoolGroupedCards(filtered).map(_spoolGroupCardHtml).join('');
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
        <input class="spool-search" type="search" placeholder="Search spools…" value="${_spoolsFilter.search}">
        <button class="spool-add-btn">+ Add Spool</button>
      </div>
    </div>
    ${_spoolIntelligenceHtml(intelligence)}
    <div class="spool-filter-bar">
        <div class="spool-view-toggle">
          <button class="spool-view-btn${_spoolsViewMode==='cards'?' active':''}" data-view="cards">Cards</button>
          <button class="spool-view-btn${_spoolsViewMode==='table'?' active':''}" data-view="table">Table</button>
          <button class="spool-view-btn${_spoolsViewMode==='cabinet'?' active':''}" data-view="cabinet">Cabinet</button>
          <button class="spool-view-btn${_spoolsViewMode==='incoming'?' active':''}" data-view="incoming">Stock In</button>
          <button class="spool-view-btn${_spoolsViewMode==='catalogue'?' active':''}" data-view="catalogue">Filament catalogue</button>
        </div>
        <div class="spool-chips spool-toolbar-chips">
          ${fc('status','active','Active')}${fc('status','archived','Archived')}
          <span class="spool-chip-sep"></span>
          ${fc('slotFilter','all','All')}${fc('slotFilter','multiples','Multiples')}${fc('slotFilter','loaded','Loaded')}${fc('slotFilter','storage','Shelved')}${fc('slotFilter','low','Low stock')}
        </div>
        <select class="spool-filter-sel" data-fkey="material">${matOpts}</select>
        <select class="spool-filter-sel" data-fkey="brand">${brandOpts}</select>
    </div>
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
    <div id="spool-list"></div>`;
}

function _refreshSpoolsSurface() {
  return location.hash.startsWith('#/spools') ? renderSpoolsView() : _renderSettingsContent('spools');
}

function _attachSpoolListEvents(el, listEl, refresh = _refreshSpoolsSurface) {
  listEl.addEventListener('click', e => {
    if (e.target.closest('button, a, input, select, textarea, summary, details, .spool-action-menu')) return;
    const card = e.target.closest('.spool-card[data-spool-id]');
    if (!card || !listEl.contains(card)) return;
    location.hash = `#/spool/${card.dataset.spoolId}`;
  });
  listEl.querySelectorAll('.spool-action-btn[data-action]').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const { action, id } = btn.dataset;
      const costs = await fetch('/api/filament/costs').then(r => r.json()).catch(() => []);
      if (action === 'manage') {
        _openSpoolActionModal(id, el, refresh);
      } else if (action === 'edit') {
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
          showToast('Label print failed', err.message || '', 'error');
          btn.textContent = old;
        } finally {
          setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 1400);
        }
      } else if (action === 'weigh') {
        const spool = _allSpools.find(s => s.id == id);
        const currentEmpty = spool?.empty_spool_weight_g ?? '';
        const emptyText = await _inputModal({
          title: 'Empty spool weight',
          message: 'Leave blank to use 0g tare.',
          value: currentEmpty,
          inputType: 'number',
          okLabel: 'Weigh',
        });
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
          showToast('Scale read failed', _scaleFriendlyMessage(err.message || 'Scale read failed'), 'error');
          btn.textContent = old;
        } finally {
          btn.disabled = false;
        }
      } else if (action === 'duplicate') {
        const spool = _allSpools.find(s => s.id == id);
        if (spool) _openSpoolModal(costs, refresh, {...spool, id: null, location_printer_id: null, location_slot: null});
      } else if (action === 'archive') {
        if (!await _confirmModal('Archive this spool?')) return;
        await fetch(`/api/spools/${id}/archive`, { method: 'POST' });
        refresh();
      } else if (action === 'reset') {
        if (!await _confirmModal('Reset remaining weight to label weight?')) return;
        await fetch(`/api/spools/${id}/reset_weight`, { method: 'POST' });
        refresh();
      } else if (action === 'delete') {
        if (!await _confirmModal('Permanently delete this spool?')) return;
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
      const targetHash = _spoolsViewMode === 'cards'
        ? '#/spools'
        : `#/spools?view=${encodeURIComponent(_spoolsViewMode)}`;
      if (location.hash.startsWith('#/spools') && location.hash !== targetHash) {
        history.replaceState(null, '', targetHash);
        _lastSpoolsRouteKey = targetHash;
      }
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
  const p0 = prefill || {};
  const title = isEdit ? `Edit Spool #${p0.id}` : 'Add Spool';
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

  const defaultLabelWeight = Number(_serverSettings.default_label_weight_g || 1000) || 1000;
  const initialLabelWeight = p0.label_weight_g ?? defaultLabelWeight;
  const initialRemainingWeight = p0.remaining_g ?? p0.label_weight_g ?? defaultLabelWeight;
  const initHex = p0.color_hex || '#808080';
  const initHex2 = p0.color_hex_2 || '#f8fafc';
  const initHex3 = p0.color_hex_3 || '#111827';
  const initScheme = _spoolColorScheme(p0.color_scheme);
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
  const schemeOpts = _COLOR_SCHEMES.map(item =>
    `<option value="${item.value}"${initScheme === item.value ? ' selected' : ''}>${item.label}</option>`
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
            <div class="spool-scan-panel" id="sm-spool-scan">
              <div class="spool-scan-head">
                <div>
                  <strong>Spool scan</strong>
                  <span>Camera or label photo</span>
                </div>
                <div class="spool-scan-actions">
                  <button type="button" class="spool-inline-btn spool-scan-toggle" id="sm-scan-toggle">Open</button>
                  <button type="button" class="spool-inline-btn" id="sm-scan-start">Camera</button>
                  <label class="spool-inline-btn spool-file-btn" for="sm-scan-file">Photo</label>
                  <input id="sm-scan-file" type="file" accept="image/*" hidden>
                </div>
              </div>
              <div class="spool-scan-body" id="sm-scan-body">
                <div class="spool-scan-stage hidden" id="sm-scan-stage">
                  <video id="sm-scan-video" playsinline muted></video>
                  <canvas id="sm-scan-canvas" hidden></canvas>
                  <img id="sm-scan-photo" alt="">
                </div>
                <div class="spool-scan-controls hidden" id="sm-scan-controls">
                  <button type="button" class="spool-inline-btn" id="sm-scan-capture">Capture</button>
                  <button type="button" class="spool-inline-btn" id="sm-scan-read">Read label</button>
                  <button type="button" class="spool-inline-btn" id="sm-scan-stop">Stop</button>
                </div>
                <div class="spool-scan-result" id="sm-scan-result">Stage 2: capture the label, then Flightdeck will try to read brand, material, and colour.</div>
              </div>
            </div>
            <div id="sm-spool-preview" class="spool-draft-card"></div>
            <div id="sm-catalogue-results" class="spool-catalogue-results hidden"></div>
          </div>
        </div>
        <div class="spool-form-section">Filament identity</div>
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
        <div class="spool-form-row spool-extra-colour-row hidden" id="sm-color-2-row">
          <label class="spool-form-label">Second colour</label>
          <div class="spool-color-row">
            <input id="sm-color-2-picker" type="color" value="${initHex2}" class="spool-color-picker">
            <input id="sm-color-2-hex" class="spool-form-input spool-color-hex" type="text" value="${initHex2}" maxlength="7">
            <div id="sm-color-2-preview" class="spool-color-preview" style="background:${initHex2}"></div>
          </div>
        </div>
        <div class="spool-form-row spool-extra-colour-row hidden" id="sm-color-3-row">
          <label class="spool-form-label">Third colour</label>
          <div class="spool-color-row">
            <input id="sm-color-3-picker" type="color" value="${initHex3}" class="spool-color-picker">
            <input id="sm-color-3-hex" class="spool-form-input spool-color-hex" type="text" value="${initHex3}" maxlength="7">
            <div id="sm-color-3-preview" class="spool-color-preview" style="background:${initHex3}"></div>
          </div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Colour name</label>
          <input id="sm-color-name" class="spool-form-input" type="text" placeholder="e.g. Jade White" value="${p0.color_name||''}" list="sm-colour-name-options">
          <datalist id="sm-colour-name-options">
            ${['Black','White','Silver','Grey','Red','Orange','Yellow','Green','Cyan','Blue','Purple','Pink','Magenta','Brown','Rainbow'].map(v => `<option value="${v}"></option>`).join('')}
          </datalist>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Colour scheme</label>
          <select id="sm-color-scheme" class="spool-form-input">${schemeOpts}</select>
        </div>
        <div class="spool-form-section">Spool weight</div>
        <div class="spool-form-row">
          <label class="spool-form-label">Label weight *</label>
          <div class="spool-inline-row">
            <input id="sm-label-g" class="spool-form-input spool-weight-input" type="number" min="1" value="${initialLabelWeight}"> g
          </div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Remaining</label>
          <div class="spool-inline-row">
            <input id="sm-remaining-g" class="spool-form-input spool-weight-input" type="number" min="0" value="${initialRemainingWeight}"> g
            <button type="button" class="spool-inline-btn" id="sm-weigh-btn">Weigh</button>
            <span class="spool-form-hint">(defaults to label weight)</span>
          </div>
        </div>
        <div class="spool-form-row">
          <label class="spool-form-label">Empty spool</label>
          <div class="spool-inline-row">
            <input id="sm-empty-g" class="spool-form-input spool-weight-input" type="number" min="0" value="${p0.empty_spool_weight_g??''}" placeholder="0"> g
            <span class="spool-form-hint" id="sm-empty-hint">tare weight</span>
          </div>
        </div>
        <div class="spool-form-section">Where it lives</div>
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
  const picker2   = overlay.querySelector('#sm-color-2-picker');
  const hexIn2    = overlay.querySelector('#sm-color-2-hex');
  const preview2  = overlay.querySelector('#sm-color-2-preview');
  const picker3   = overlay.querySelector('#sm-color-3-picker');
  const hexIn3    = overlay.querySelector('#sm-color-3-hex');
  const preview3  = overlay.querySelector('#sm-color-3-preview');
  const color2Row = overlay.querySelector('#sm-color-2-row');
  const color3Row = overlay.querySelector('#sm-color-3-row');
  const schemeSel = overlay.querySelector('#sm-color-scheme');
  const preview   = overlay.querySelector('#sm-color-preview');
  const labelG    = overlay.querySelector('#sm-label-g');
  const remainG   = overlay.querySelector('#sm-remaining-g');
  const emptyG    = overlay.querySelector('#sm-empty-g');
  const emptyHint = overlay.querySelector('#sm-empty-hint');
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
  const spoolPreview = overlay.querySelector('#sm-spool-preview');
  const catalogueSync = overlay.querySelector('#sm-catalogue-sync');
  const catalogueChips = overlay.querySelector('#sm-catalogue-chips');
  const scanPanel = overlay.querySelector('#sm-spool-scan');
  const scanToggle = overlay.querySelector('#sm-scan-toggle');
  const scanBody = overlay.querySelector('#sm-scan-body');
  const scanStart = overlay.querySelector('#sm-scan-start');
  const scanFile = overlay.querySelector('#sm-scan-file');
  const scanStage = overlay.querySelector('#sm-scan-stage');
  const scanVideo = overlay.querySelector('#sm-scan-video');
  const scanCanvas = overlay.querySelector('#sm-scan-canvas');
  const scanPhoto = overlay.querySelector('#sm-scan-photo');
  const scanControls = overlay.querySelector('#sm-scan-controls');
  const scanCapture = overlay.querySelector('#sm-scan-capture');
  const scanRead = overlay.querySelector('#sm-scan-read');
  const scanStop = overlay.querySelector('#sm-scan-stop');
  const scanResult = overlay.querySelector('#sm-scan-result');
  let scanStream = null;
  let scanObjectUrl = null;
  let scanLastImageSource = '';
  let scanOcrLoading = null;
  let scanExpanded = window.matchMedia?.('(min-width: 721px)').matches ?? true;

  let matNewMode = false;
  let brandNewMode = false;
  let _colorLock = false;
  function syncColor(hex) {
    if (_colorLock) return;
    _colorLock = true;
    const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
    preview.style.background = _spoolColorBackground(valid ? hex : '#808080', schemeSel?.value || 'solid', hexIn2?.value, hexIn3?.value);
    if (valid) {
      picker.value = hex;
      hexIn.value = hex;
      overlay.querySelectorAll('.spool-swatch').forEach(s =>
        s.classList.toggle('selected', s.dataset.hex === hex)
      );
    }
    _colorLock = false;
  }

  function syncExtraColor(input, pickerEl, previewEl, fallback) {
    const hex = input.value.trim();
    const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
    const color = valid ? hex : fallback;
    previewEl.style.background = color;
    if (valid) pickerEl.value = hex;
    syncColor(hexIn.value);
    updateDraftPreview();
  }

  function updateSchemeColourRows() {
    const scheme = _spoolColorScheme(schemeSel.value);
    const needsSecond = ['dual', 'tri', 'gradient', 'mixed'].includes(scheme);
    const needsThird = ['tri', 'mixed'].includes(scheme);
    color2Row.classList.toggle('hidden', !needsSecond);
    color3Row.classList.toggle('hidden', !needsThird);
  }

  function updatePrevPicks() {
    if (isEdit) return;
    const mat   = matNewMode  ? matNewIn.value.trim().toUpperCase() : matSel.value;
    const brand = brandNewMode ? brandNewIn.value.trim() : brandSel.value;
    if (!mat || !brand) { prevPicks.classList.add('hidden'); return; }
    const seen = new Set();
    const picks = [];
    for (const s of [..._allSpools].sort((a, b) => Number(b.id || 0) - Number(a.id || 0))) {
      if (s.material !== mat || s.brand !== brand || s.archived_at) continue;
      const key = (s.color_hex || '') + '|' + (s.color_name || '') + '|' + (s.subtype || '');
      if (seen.has(key)) continue;
      seen.add(key);
      picks.push(s);
    }
    if (!picks.length) { prevPicks.classList.add('hidden'); return; }
    prevPicks.innerHTML =
      `<span class="spool-prev-label">Previously used (${picks.length}):</span>` +
      `<div class="spool-prev-swatches">` +
      picks.map(s =>
        `<button type="button" class="spool-prev-swatch" data-hex="${s.color_hex||'#808080'}" data-name="${s.color_name||''}" data-subtype="${s.subtype||''}" data-weight="${s.label_weight_g}" title="#${s.id} · ${s.color_name||s.color_hex}${s.subtype?' · '+s.subtype:''}">` +
        `<span class="spool-prev-dot" style="background:${s.color_hex||'#808080'}"></span>` +
        `<span class="spool-prev-id">#${s.id}</span>` +
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
        applyDefaultTare();
        updateDraftPreview();
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
    updateDraftPreview();
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

  function setEmptySpoolValue(value, source, force = false) {
    if (value == null || value === '' || (emptyG.dataset.touched && !force)) return false;
    emptyG.value = Math.round(Number(value));
    if (emptyHint) emptyHint.textContent = _tareHintText(source);
    return true;
  }

  function tareFallbackFor(material, brand, subtype = '') {
    const saved = costLookup[`${material}|||${brand || ''}`]?.empty_spool_weight_g;
    if (saved != null) return { value: saved, source: { kind: 'saved', brand } };
    const estimate = _brandTareEstimate(brand, subtype);
    if (estimate) return { value: estimate.grams, source: { kind: 'estimate', brand: estimate.brand } };
    return null;
  }

  function applyCatalogueEntry(item) {
    const material = String(item.material || '').toUpperCase();
    const brand = item.brand || '';
    ensureMaterialBrand(material, brand);
    overlay.querySelector('#sm-subtype').value = item.subtype || item.product || '';
    syncColor(item.color_hex || '#808080');
    overlay.querySelector('#sm-color-name').value = item.color_name || '';
    if (item.filament_weight_g) {
      labelG.value = Math.round(Number(item.filament_weight_g));
      if (!remainG.dataset.touched) remainG.value = labelG.value;
    }
    if (item.empty_spool_weight_g != null) {
      setEmptySpoolValue(item.empty_spool_weight_g, { kind: 'catalogue' });
    } else {
      const tareFallback = tareFallbackFor(material, brand, item.subtype || item.product || '');
      if (tareFallback) setEmptySpoolValue(tareFallback.value, tareFallback.source);
    }
    catalogueResults.classList.add('hidden');
    cataloguePicked.innerHTML = `
      <span class="spool-catalogue-swatch" style="background:${item.color_hex || '#808080'}"></span>
      <span><b>${esc(item.color_name || 'Colour')}</b><small>${esc(brand)} · ${esc(material)}${item.subtype ? ` · ${esc(item.subtype)}` : ''}${item.filament_weight_g ? ` · ${Math.round(item.filament_weight_g)}g` : ''}</small><em>Catalogue match applied · editable before saving</em></span>
    `;
    cataloguePicked.classList.remove('hidden');
    catalogueSearch.value = `${brand} ${material} ${item.color_name || ''}`.trim();
    updateDraftPreview('Catalogue match applied');
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

  function setCatalogueSearch(q, note = 'Scan hint applied') {
    const cleaned = String(q || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    catalogueSearch.value = cleaned;
    updateDraftPreview(note);
    searchCatalogue();
  }

  function applyScanWords(words) {
    const text = String(words || '').replace(/\s+/g, ' ').trim();
    if (!text) return [];
    const upper = text.toUpperCase();
    const material = [
      ['PLA+', /\bPLA\s*\+|\bPLA\s*PLUS\b/],
      ['PLA', /\bPLA\b/],
      ['PETG', /\bPETG\b|\bPET-G\b/],
      ['ASA', /\bASA\b/],
      ['ABS', /\bABS\b/],
      ['TPU', /\bTPU\b/],
      ['PA', /\bPA\b|\bNYLON\b/],
      ['PC', /\bPC\b|\bPOLYCARBONATE\b/],
    ].find(([, rx]) => rx.test(upper))?.[0] || '';
    const brandAliases = [
      ['Bambu', /\bBAMBU(?:\s+LAB)?\b/],
      ['eSun', /\bESUN\b|\bE-SUN\b/],
      ['Polymaker', /\bPOLYMAKER\b/],
      ['Overture', /\bOVERTURE\b/],
      ['SunLu', /\bSUNLU\b/],
      ['Creality', /\bCREALITY\b/],
      ['Prusament', /\bPRUSAMENT\b/],
      ['Hatchbox', /\bHATCHBOX\b/],
      ['Inland', /\bINLAND\b/],
      ['Colorfabb', /\bCOLORFABB\b/],
    ];
    const knownBrand = materials.flatMap(m => matBrands[m] || []).find(b => b && upper.includes(String(b).toUpperCase()));
    const brand = knownBrand || brandAliases.find(([, rx]) => rx.test(upper))?.[0] || '';
    const subtype = [
      ['Basic', /\bBASIC\b/],
      ['Matte', /\bMATTE\b/],
      ['Silk', /\bSILK\b/],
      ['Plus', /\bPLUS\b/],
      ['Pro', /\bPRO\b/],
      ['Tough', /\bTOUGH\b/],
      ['Carbon Fiber', /\bCARBON\b|\bCF\b/],
      ['High Speed', /\bHIGH\s*SPEED\b|\bHS\b/],
    ].find(([, rx]) => rx.test(upper))?.[0] || '';
    const colourMap = [
      ['Black', '#1a1a1a', /\bBLACK\b/],
      ['White', '#ffffff', /\bWHITE\b/],
      ['Red', '#ef4444', /\bRED\b/],
      ['Blue', '#3b82f6', /\bBLUE\b/],
      ['Green', '#22c55e', /\bGREEN\b/],
      ['Yellow', '#eab308', /\bYELLOW\b/],
      ['Orange', '#f97316', /\bORANGE\b/],
      ['Purple', '#a855f7', /\bPURPLE\b/],
      ['Pink', '#ec4899', /\bPINK\b/],
      ['Magenta', '#ec4899', /\bMAGENTA\b/],
      ['Silver', '#c0c0c0', /\bSILVER\b/],
      ['Grey', '#808080', /\bGREY\b|\bGRAY\b/],
      ['Brown', '#7c3f20', /\bBROWN\b/],
      ['Rainbow', '#ec4899', /\bRAINBOW\b/],
    ].find(([, , rx]) => rx.test(upper));
    if (brand && material) {
      ensureMaterialBrand(material, brand);
    } else if (material) {
      if (matNewMode) matToggle.click();
      if (brandNewMode) brandToggle.click();
      if (matBrands[material]) {
        matSel.value = material;
        populateBrands(material);
        brandSel.value = '';
      } else {
        matNewMode = false;
        matToggle.click();
        matNewIn.value = material;
      }
    } else if (brand) {
      const materialForBrand = materials.find(m => (matBrands[m] || []).includes(brand));
      if (materialForBrand) ensureMaterialBrand(materialForBrand, brand);
    }
    if (subtype && !overlay.querySelector('#sm-subtype').value.trim()) {
      overlay.querySelector('#sm-subtype').value = subtype;
    }
    if (colourMap) {
      overlay.querySelector('#sm-color-name').value = colourMap[0];
      syncColor(colourMap[1]);
      if (colourMap[0] === 'Rainbow') {
        schemeSel.value = 'mixed';
        updateSchemeColourRows();
      }
    }
    const applied = [brand, material, colourMap?.[0], subtype].filter(Boolean);
    const query = applied.join(' ');
    if (query) setCatalogueSearch(query, 'Label text applied');
    applyDefaultTare();
    updatePrevPicks();
    updateDraftPreview('Label text applied');
    return applied;
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s: max ? d / max : 0, v: max };
  }

  function hsvToHex(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return '#' + [r, g, b].map(n => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('');
  }

  function colourNameFromHue(h, s, v) {
    if (v < 0.18) return 'Black';
    if (s < 0.16 && v > 0.82) return 'White';
    if (s < 0.18) return v > 0.58 ? 'Silver' : 'Grey';
    if (h < 15 || h >= 345) return 'Red';
    if (h < 38) return 'Orange';
    if (h < 65) return 'Yellow';
    if (h < 155) return 'Green';
    if (h < 195) return 'Cyan';
    if (h < 255) return 'Blue';
    if (h < 290) return 'Purple';
    if (h < 345) return 'Magenta';
    return 'Colour';
  }

  async function loadScanImage(source) {
    if (source instanceof HTMLCanvasElement || source instanceof HTMLImageElement) return source;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Unable to read scan image'));
      img.src = source;
    });
  }

  async function detectLabelSwatchColour(source = scanLastImageSource) {
    if (!source) return null;
    const image = await loadScanImage(source);
    const width = Math.min(640, image.naturalWidth || image.width || 0);
    const height = Math.round(width * ((image.naturalHeight || image.height || 1) / (image.naturalWidth || image.width || 1)));
    if (!width || !height) return null;
    scanCanvas.width = width;
    scanCanvas.height = height;
    const ctx = scanCanvas.getContext('2d');
    ctx.drawImage(image, 0, 0, width, height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const bins = new Map();
    for (let y = 2; y < height - 2; y += 2) {
      for (let x = 2; x < width - 2; x += 2) {
        const i = (y * width + x) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const hsv = rgbToHsv(r, g, b);
        if (hsv.s < 0.34 || hsv.v < 0.24 || hsv.v > 0.92) continue;
        let whiteNeighbours = 0;
        for (let oy = -18; oy <= 18; oy += 9) {
          for (let ox = -18; ox <= 18; ox += 9) {
            const nx = Math.max(0, Math.min(width - 1, x + ox));
            const ny = Math.max(0, Math.min(height - 1, y + oy));
            const ni = (ny * width + nx) * 4;
            const nr = data[ni], ng = data[ni + 1], nb = data[ni + 2];
            const nh = rgbToHsv(nr, ng, nb);
            if (nh.s < 0.22 && nh.v > 0.68) whiteNeighbours += 1;
          }
        }
        if (whiteNeighbours < 5) continue;
        const bin = Math.round(hsv.h / 12) * 12;
        const current = bins.get(bin) || { count: 0, h: 0, s: 0, v: 0 };
        current.count += 1;
        current.h += hsv.h;
        current.s += hsv.s;
        current.v += hsv.v;
        bins.set(bin, current);
      }
    }
    const best = [...bins.values()].sort((a, b) => b.count - a.count)[0];
    if (!best || best.count < 6) return null;
    const h = best.h / best.count;
    const s = best.s / best.count;
    const v = Math.min(0.95, Math.max(0.35, best.v / best.count));
    return { name: colourNameFromHue(h, s, v), hex: hsvToHex(h, Math.max(0.55, s), v), confidence: best.count };
  }

  async function applyScanSwatchColour(source = scanLastImageSource, force = false) {
    if (!force && overlay.querySelector('#sm-color-name').value.trim()) return null;
    try {
      const colour = await detectLabelSwatchColour(source);
      if (!colour) return null;
      overlay.querySelector('#sm-color-name').value = colour.name;
      syncColor(colour.hex);
      updateDraftPreview('Label colour detected');
      return colour;
    } catch {
      return null;
    }
  }

  function setScanMessage(message, kind = '') {
    scanResult.textContent = message;
    scanResult.classList.toggle('spool-scan-warn', kind === 'warn');
    scanResult.classList.toggle('spool-scan-good', kind === 'good');
  }

  function setScanExpanded(expanded) {
    scanExpanded = !!expanded;
    scanPanel.classList.toggle('spool-scan-collapsed', !scanExpanded);
    scanBody.classList.toggle('hidden', !scanExpanded);
    scanToggle.textContent = scanExpanded ? 'Hide' : 'Open';
  }

  function stopScanStream() {
    if (scanStream) {
      scanStream.getTracks().forEach(track => track.stop());
      scanStream = null;
    }
    scanVideo.srcObject = null;
    scanControls.classList.add('hidden');
    scanStart.disabled = false;
  }

  async function detectBarcodeFromImage(source) {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'qr_code'] });
      const results = await detector.detect(source);
      return results?.[0]?.rawValue || null;
    } catch {
      return null;
    }
  }

  async function ensureOcrEngine() {
    if (window.Tesseract?.recognize) return window.Tesseract;
    if (!scanOcrLoading) {
      scanOcrLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
        script.async = true;
        script.onload = () => window.Tesseract?.recognize ? resolve(window.Tesseract) : reject(new Error('OCR engine did not load'));
        script.onerror = () => reject(new Error('OCR engine download failed'));
        document.head.appendChild(script);
      });
    }
    return scanOcrLoading;
  }

  async function runScanOcr(source = scanLastImageSource) {
    if (!source) {
      setScanMessage('Capture or choose a photo first, then read the label.', 'warn');
      return;
    }
    const oldText = scanRead.textContent;
    scanRead.disabled = true;
    scanRead.textContent = 'Reading';
    setScanMessage('Reading label text...');
    try {
      const tesseract = await ensureOcrEngine();
      const result = await tesseract.recognize(source, 'eng', {
        logger: info => {
          if (info?.status) {
            const pct = Number.isFinite(info.progress) ? ` ${Math.round(info.progress * 100)}%` : '';
            setScanMessage(`Reading label: ${info.status}${pct}`);
          }
        },
      });
      const text = result?.data?.text?.trim() || '';
      if (!text) {
        setScanMessage('No readable label text found. Try a closer, brighter photo.', 'warn');
        return;
      }
      const applied = applyScanWords(text);
      const hasColour = ['Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink', 'Magenta', 'Silver', 'Grey', 'Brown', 'Rainbow'].some(c => applied.includes(c));
      let swatchColour = null;
      if (!hasColour) swatchColour = await applyScanSwatchColour(source);
      if (swatchColour) applied.push(swatchColour.name);
      if (applied.length) {
        setScanMessage(`Applied from label: ${applied.join(' · ')}`, 'good');
      } else {
        setScanMessage('Label text was too noisy to apply safely. Try a closer photo or type the visible details.', 'warn');
      }
    } catch (err) {
      setScanMessage(`${err?.message || 'OCR failed'}. You can still type the visible brand/material into search.`, 'warn');
    } finally {
      scanRead.disabled = false;
      scanRead.textContent = oldText;
    }
  }

  async function captureScanFrame() {
    if (!scanVideo.videoWidth || !scanVideo.videoHeight) {
      setScanMessage('Camera is still warming up. Try capture again.', 'warn');
      return;
    }
    scanCanvas.width = scanVideo.videoWidth;
    scanCanvas.height = scanVideo.videoHeight;
    const ctx = scanCanvas.getContext('2d');
    ctx.drawImage(scanVideo, 0, 0, scanCanvas.width, scanCanvas.height);
    const dataUrl = scanCanvas.toDataURL('image/jpeg', 0.86);
    scanLastImageSource = dataUrl;
    scanPhoto.src = dataUrl;
    scanPhoto.hidden = false;
    const barcode = await detectBarcodeFromImage(scanCanvas);
    if (barcode) {
      setScanMessage(`Barcode found: ${barcode}. Searching catalogue.`, 'good');
      setCatalogueSearch(barcode, 'Barcode scan applied');
    } else {
      setScanMessage('Photo captured. No barcode found, reading label text...');
      runScanOcr(dataUrl);
    }
  }

  scanStart.addEventListener('click', async () => {
    setScanExpanded(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanMessage('Camera capture is not available in this browser. Use Photo instead.', 'warn');
      return;
    }
    scanStart.disabled = true;
    setScanMessage('Opening camera...');
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      scanVideo.srcObject = scanStream;
      scanVideo.hidden = false;
      scanPhoto.hidden = true;
      scanStage.classList.remove('hidden');
      scanControls.classList.remove('hidden');
      await scanVideo.play();
      setScanMessage('Hold the filament label steady, then capture.');
    } catch (err) {
      scanStart.disabled = false;
      setScanMessage(err?.name === 'NotAllowedError' ? 'Camera permission was blocked. Use Photo or allow camera access.' : 'Unable to open camera. Use Photo instead.', 'warn');
    }
  });

  scanToggle.addEventListener('click', () => setScanExpanded(!scanExpanded));
  scanCapture.addEventListener('click', () => captureScanFrame());
  scanRead.addEventListener('click', () => runScanOcr());
  scanStop.addEventListener('click', () => stopScanStream());
  scanFile.addEventListener('change', async () => {
    const file = scanFile.files?.[0];
    if (!file) return;
    setScanExpanded(true);
    stopScanStream();
    if (scanObjectUrl) URL.revokeObjectURL(scanObjectUrl);
    scanObjectUrl = URL.createObjectURL(file);
    scanLastImageSource = scanObjectUrl;
    scanPhoto.src = scanObjectUrl;
    scanPhoto.hidden = false;
    scanVideo.hidden = true;
    scanStage.classList.remove('hidden');
    setScanMessage('Photo loaded. Checking for barcode...');
    await new Promise(resolve => {
      if (scanPhoto.complete) resolve();
      else scanPhoto.onload = resolve;
    });
    const barcode = await detectBarcodeFromImage(scanPhoto);
    if (barcode) {
      setScanMessage(`Barcode found: ${barcode}. Searching catalogue.`, 'good');
      setCatalogueSearch(barcode, 'Barcode photo applied');
    } else {
      applyScanWords(file.name.replace(/\.[^.]+$/, ' '));
      setScanMessage('Photo loaded. No barcode found, reading label text...');
      runScanOcr(scanObjectUrl);
    }
  });

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
      showToast('Catalogue sync failed', err.message || '', 'error');
    } finally {
      setTimeout(() => { catalogueSync.disabled = false; catalogueSync.textContent = old; }, 1300);
    }
  });

  function selectedMaterialBrand() {
    const mat = matNewMode ? matNewIn.value.trim().toUpperCase() : matSel.value;
    const brand = brandNewMode ? brandNewIn.value.trim() : brandSel.value;
    return { mat, brand };
  }

  function updateDraftPreview(note = '') {
    const { mat, brand } = selectedMaterialBrand();
    const subtype = overlay.querySelector('#sm-subtype')?.value.trim();
    const colorName = overlay.querySelector('#sm-color-name')?.value.trim();
    const hex = /^#[0-9a-fA-F]{6}$/.test(hexIn.value.trim()) ? hexIn.value.trim() : '#808080';
    const hex2 = /^#[0-9a-fA-F]{6}$/.test(hexIn2.value.trim()) ? hexIn2.value.trim() : null;
    const hex3 = /^#[0-9a-fA-F]{6}$/.test(hexIn3.value.trim()) ? hexIn3.value.trim() : null;
    const scheme = schemeSel?.value || 'solid';
    const label = Math.round(parseFloat(labelG.value) || 0);
    const remaining = Math.round(parseFloat(remainG.value) || label || 0);
    const pct = label > 0 ? Math.max(0, Math.min(100, Math.round(remaining * 100 / label))) : 0;
    const locMode = overlay.querySelector('input[name="sm-loc"]:checked')?.value || 'storage';
    const locText = locMode === 'loaded'
      ? `${printerSel.options[printerSel.selectedIndex]?.textContent || 'Printer'} · ${slotSel.options[slotSel.selectedIndex]?.textContent || 'Slot'}`
      : `${storageSel.options[storageSel.selectedIndex]?.textContent || 'Storage'}`;
    const titleLine = [colorName || 'Colour', mat || 'Material', subtype].filter(Boolean).join(' · ');
    const brandLine = [brand || 'Brand', locText].filter(Boolean).join(' · ');
    const spoolIdLine = isEdit && p0.id ? `<span class="spool-draft-id">Spool #${esc(p0.id)}</span>` : '';
    spoolPreview.innerHTML = `
      <div class="spool-draft-swatch" style="${_spoolColorStyle(hex, scheme, hex2, hex3)}"></div>
      <div class="spool-draft-main">
        <strong>${esc(titleLine || 'Choose filament')}</strong>
        <span>${esc(brandLine)}</span>
        ${note ? `<em>${esc(note)}</em>` : ''}
      </div>
      <div class="spool-draft-weight">
        ${spoolIdLine}
        <strong>${remaining || '—'}g</strong>
        <span>${label ? `${pct}% of ${label}g` : 'weight pending'}</span>
      </div>`;
  }

  function applyDefaultTare(force = false) {
    if (isEdit && !force) return;
    if (emptyG.dataset.touched && !force) return;
    const { mat, brand } = selectedMaterialBrand();
    const subtype = overlay.querySelector('#sm-subtype')?.value.trim();
    const tareFallback = tareFallbackFor(mat, brand, subtype);
    if (tareFallback) {
      setEmptySpoolValue(tareFallback.value, tareFallback.source, force);
    } else if (!emptyG.dataset.touched && !p0.empty_spool_weight_g) {
      emptyG.value = '';
      if (emptyHint) emptyHint.textContent = 'tare weight';
    }
  }

  matSel.addEventListener('change', () => populateBrands(matSel.value));
  brandSel.addEventListener('change', () => { applyDefaultTare(); updatePrevPicks(); updateDraftPreview(); });
  matNewIn.addEventListener('input', () => { applyDefaultTare(); updatePrevPicks(); updateDraftPreview(); });
  brandNewIn.addEventListener('input', () => { applyDefaultTare(); updatePrevPicks(); updateDraftPreview(); });

  // New material toggle
  matToggle.addEventListener('click', () => {
    matNewMode = !matNewMode;
    matSel.classList.toggle('hidden', matNewMode);
    matNewIn.classList.toggle('hidden', !matNewMode);
    matToggle.textContent = matNewMode ? '✕' : '+';
    applyDefaultTare();
    updateDraftPreview();
  });

  // New brand toggle
  brandToggle.addEventListener('click', () => {
    brandNewMode = !brandNewMode;
    brandSel.classList.toggle('hidden', brandNewMode);
    brandNewIn.classList.toggle('hidden', !brandNewMode);
    brandToggle.textContent = brandNewMode ? '✕' : '+';
    applyDefaultTare();
    updateDraftPreview();
  });

  picker.addEventListener('input', () => { syncColor(picker.value); updateDraftPreview(); });
  picker.addEventListener('change', () => { syncColor(picker.value); updateDraftPreview(); });
  hexIn.addEventListener('input', () => { syncColor(hexIn.value); updateDraftPreview(); });
  picker2.addEventListener('input', () => { hexIn2.value = picker2.value; syncExtraColor(hexIn2, picker2, preview2, '#f8fafc'); });
  picker2.addEventListener('change', () => { hexIn2.value = picker2.value; syncExtraColor(hexIn2, picker2, preview2, '#f8fafc'); });
  hexIn2.addEventListener('input', () => syncExtraColor(hexIn2, picker2, preview2, '#f8fafc'));
  picker3.addEventListener('input', () => { hexIn3.value = picker3.value; syncExtraColor(hexIn3, picker3, preview3, '#111827'); });
  picker3.addEventListener('change', () => { hexIn3.value = picker3.value; syncExtraColor(hexIn3, picker3, preview3, '#111827'); });
  hexIn3.addEventListener('input', () => syncExtraColor(hexIn3, picker3, preview3, '#111827'));
  schemeSel.addEventListener('change', () => { updateSchemeColourRows(); syncColor(hexIn.value); updateDraftPreview(); });

  const _swatchNames = {
    '#1a1a1a':'Black','#ffffff':'White','#c0c0c0':'Silver','#808080':'Grey',
    '#ef4444':'Red','#f97316':'Orange','#eab308':'Yellow','#22c55e':'Green',
    '#06b6d4':'Cyan','#3b82f6':'Blue','#a855f7':'Purple','#ec4899':'Pink',
  };
  const _knownSwatchNames = new Set(Object.values(_swatchNames));
  const _colourAliases = [
    { name: 'Black', hex: '#1a1a1a', keys: ['black', 'blk'] },
    { name: 'White', hex: '#ffffff', keys: ['white', 'wht'] },
    { name: 'Silver', hex: '#c0c0c0', keys: ['silver', 'sil'] },
    { name: 'Grey', hex: '#808080', keys: ['grey', 'gray', 'gry'] },
    { name: 'Red', hex: '#ef4444', keys: ['red'] },
    { name: 'Orange', hex: '#f97316', keys: ['orange', 'org'] },
    { name: 'Yellow', hex: '#eab308', keys: ['yellow', 'yel'] },
    { name: 'Green', hex: '#22c55e', keys: ['green', 'grn'] },
    { name: 'Cyan', hex: '#06b6d4', keys: ['cyan', 'aqua'] },
    { name: 'Blue', hex: '#3b82f6', keys: ['blue', 'blu'] },
    { name: 'Purple', hex: '#a855f7', keys: ['purple', 'purp', 'violet'] },
    { name: 'Pink', hex: '#ec4899', keys: ['pink', 'pnk'] },
    { name: 'Magenta', hex: '#ec4899', keys: ['magenta', 'mag'] },
    { name: 'Brown', hex: '#7c3f20', keys: ['brown', 'brn'] },
    { name: 'Rainbow', hex: '#ec4899', keys: ['rainbow', 'multi'] },
  ];

  function colourAliasMatch(value) {
    const needle = String(value || '').trim().toLowerCase();
    if (!needle) return null;
    const exact = _colourAliases.find(c => c.name.toLowerCase() === needle || c.keys.includes(needle));
    if (exact) return exact;
    const matches = _colourAliases.filter(c =>
      c.name.toLowerCase().startsWith(needle) || c.keys.some(k => k.startsWith(needle))
    );
    return matches.length === 1 ? matches[0] : null;
  }

  function applyColourNameAlias(value) {
    const match = colourAliasMatch(value);
    if (!match) return false;
    const nameEl = overlay.querySelector('#sm-color-name');
    nameEl.value = match.name;
    syncColor(match.hex);
    if (match.name === 'Rainbow') {
      schemeSel.value = 'mixed';
      updateSchemeColourRows();
    }
    updateDraftPreview('Colour matched');
    return true;
  }

  overlay.querySelectorAll('.spool-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      syncColor(sw.dataset.hex);
      const nameEl = overlay.querySelector('#sm-color-name');
      if (!nameEl.value || _knownSwatchNames.has(nameEl.value)) {
        nameEl.value = _swatchNames[sw.dataset.hex] || '';
      }
      updateDraftPreview();
    });
  });

  updateSchemeColourRows();
  syncExtraColor(hexIn2, picker2, preview2, '#f8fafc');
  syncExtraColor(hexIn3, picker3, preview3, '#111827');
  syncColor(initHex);

  labelG.addEventListener('input', () => {
    if (!remainG.dataset.touched) remainG.value = labelG.value;
    updateDraftPreview();
  });
  remainG.addEventListener('input', () => { remainG.dataset.touched = '1'; updateDraftPreview(); });
  emptyG.addEventListener('input', () => {
    emptyG.dataset.touched = '1';
    if (emptyHint) emptyHint.textContent = 'manual tare';
  });
  overlay.querySelector('#sm-subtype')?.addEventListener('input', () => {
    applyDefaultTare();
    updateDraftPreview();
  });
  const colorNameInput = overlay.querySelector('#sm-color-name');
  colorNameInput?.addEventListener('input', () => {
    if (!applyColourNameAlias(colorNameInput.value)) updateDraftPreview();
  });
  colorNameInput?.addEventListener('change', () => {
    applyColourNameAlias(colorNameInput.value);
  });
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
      updateDraftPreview('Scale reading applied');
    } catch (err) {
      showToast('Scale read failed', _scaleFriendlyMessage(err.message || 'Scale read failed'), 'error');
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
      updateDraftPreview();
    });
  });

  function updateSlots() {
    const opt = printerSel.options[printerSel.selectedIndex];
    const kind = opt?.dataset.kind || 'bambu';
    if (kind !== 'bambu') {
      const printer = _latestPrinters.find(x => x.id === printerSel.value);
      const mmuUnit = printer?.mmu?.[0];
      if (mmuUnit?.num_gates > 1) {
        slotSel.innerHTML = Array.from({length: mmuUnit.num_gates}, (_, i) => {
          const gate = mmuUnit.gates?.[i];
          const label = gate?.material ? `T${i} · ${gate.material}` : `T${i}`;
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
          const flatIdx = _amsFlatSlot(unit, slot);
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
  printerSel.addEventListener('change', () => { updateSlots(); updateDraftPreview(); });
  slotSel.addEventListener('change', () => updateDraftPreview());
  storageSel.addEventListener('change', () => updateDraftPreview());
  updateSlots();
  updateDraftPreview();
  setScanExpanded(scanExpanded);

  function closeSpoolModal() {
    stopScanStream();
    if (scanObjectUrl) URL.revokeObjectURL(scanObjectUrl);
    overlay.remove();
  }
  overlay.querySelector('.modal-close-btn').addEventListener('click', () => closeSpoolModal());
  overlay.querySelector('#sm-cancel').addEventListener('click', () => closeSpoolModal());
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSpoolModal(); });

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
    const scheme = _spoolColorScheme(schemeSel.value);
    const needsSecond = ['dual', 'tri', 'gradient', 'mixed'].includes(scheme);
    const needsThird = ['tri', 'mixed'].includes(scheme);
    if (needsSecond && !/^#[0-9a-fA-F]{6}$/.test(hexIn2.value.trim())) { hexIn2.focus(); return; }
    if (needsThird && !/^#[0-9a-fA-F]{6}$/.test(hexIn3.value.trim())) { hexIn3.focus(); return; }
    const body = {
      material, brand, color_hex: hex, label_weight_g: labelW,
      remaining_g:    parseFloat(remainG.value) || labelW,
      empty_spool_weight_g: emptyW,
      subtype:        overlay.querySelector('#sm-subtype').value.trim()    || null,
      color_name:     overlay.querySelector('#sm-color-name').value.trim() || null,
      color_hex_2:    needsSecond ? hexIn2.value.trim() : null,
      color_hex_3:    needsThird ? hexIn3.value.trim() : null,
      color_scheme:   scheme,
      notes:          overlay.querySelector('#sm-notes').value.trim()      || null,
      location_printer_id: locMode === 'loaded' ? printerSel.value : null,
      location_slot:       locMode === 'loaded' ? parseInt(slotSel.value) : null,
      storage_location_id: locMode === 'storage' && storageSel.value ? parseInt(storageSel.value, 10) : null,
    };

    // Auto-create new brand in catalogue if needed
    if ((matNewMode || brandNewMode) && !isNaN(labelW)) {
      const tareFallback = tareFallbackFor(material, brand, body.subtype || '');
      await fetch(`/api/filament/costs/${encodeURIComponent(material)}/${encodeURIComponent(brand)}`, {
        method: 'PUT', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({
          cost_per_gram: 0,
          comment: 'Added via spool form',
          empty_spool_weight_g: emptyW ?? tareFallback?.value ?? null,
        }),
      }).catch(() => {});
    }

    const btn = overlay.querySelector('#sm-submit');
    btn.disabled = true; btn.textContent = '…';
    try {
      let savedData = null;
      if (isEdit) {
        const r = await fetch(`/api/spools/${prefill.id}`, {
          method: 'PUT', headers: {'Content-Type':'application/json'},
          body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(await _spoolSaveErrorMessage(r, 'Unable to save spool'));
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
          btn.textContent = _spoolConflictMessage(err);
          setTimeout(() => { btn.textContent = submitLabel; btn.disabled = false; }, 3000);
          return;
        }
        if (!mr.ok) throw new Error(await _spoolSaveErrorMessage(mr, 'Unable to move spool'));
        savedData = await mr.json().catch(() => ({}));
      } else {
        const r = await fetch('/api/spools', {
          method: 'POST', headers: {'Content-Type':'application/json'},
          body: JSON.stringify(body),
        });
        if (r.status === 409) {
          const err = await r.json();
          btn.textContent = _spoolConflictMessage(err);
          setTimeout(() => { btn.textContent = submitLabel; btn.disabled = false; }, 3000);
          return;
        }
        if (!r.ok) throw new Error(await _spoolSaveErrorMessage(r, 'Unable to add spool'));
        savedData = await r.json().catch(() => ({}));
      }
      closeSpoolModal();
      if (locMode === 'loaded') {
        _spoolMoveSyncToast(
          savedData,
          printerSel.options[printerSel.selectedIndex]?.textContent || printerSel.value,
          slotSel.options[slotSel.selectedIndex]?.textContent || 'AMS slot',
        );
      }
      onSaved();
    } catch (err) {
      btn.textContent = err?.message || 'Error';
      setTimeout(() => { btn.textContent = submitLabel; btn.disabled = false; }, 3500);
    }
  });
}

function _spoolConflictMessage(err) {
  const detail = err?.detail;
  if (detail && typeof detail === 'object') return detail.message || `Slot occupied (#${detail.conflict_spool_id ?? '?'})`;
  return typeof detail === 'string' ? detail : 'Slot occupied';
}

function _spoolMoveSyncToast(data, printerLabel = 'Printer', slotLabel = 'AMS slot') {
  if (!data || data.ams_sync == null) return;
  if (data.ams_sync) {
    showToast('AMS profile sent', `${printerLabel} · ${slotLabel}`, 'success');
  } else {
    showToast('Spool saved', `Flightdeck updated, but ${printerLabel} did not confirm the AMS profile sync.`, 'warning');
  }
}

async function _spoolSaveErrorMessage(response, fallback = 'Unable to save spool') {
  try {
    const data = await response.json();
    const detail = data?.detail;
    if (detail && typeof detail === 'object') return detail.message || fallback;
    if (typeof detail === 'string') return detail;
  } catch {}
  try {
    const text = await response.text();
    if (text) return text.slice(0, 80);
  } catch {}
  return fallback;
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
        <span class="location-spool-swatch" style="${_spoolColorStyle(s)}"></span>
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
        <span class="location-spool-swatch" style="${_spoolColorStyle(s)}"></span>
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

  if (category === 'setup') {
    el.innerHTML = `<div class="detail-placeholder" style="min-height:10rem">Checking install…</div>`;
    const [health, printers, scale, labelPrinter, version] = await Promise.all([
      fetch('/api/setup/health').then(r => r.json()).catch(() => null),
      fetch('/api/printers').then(r => r.json()).catch(() => (_latestPrinters || [])),
      fetch('/api/scale/status').then(r => r.json()).catch(() => ({})),
      fetch('/api/label_printer/status').then(r => r.json()).catch(() => ({})),
      fetch('/api/update/status').then(r => r.json()).catch(() => ({})),
    ]);
    el.innerHTML = health
      ? _setupHealthHtml(health, { printers, scale, labelPrinter, version })
      : `<div class="settings-empty">Setup health is unavailable.</div>`;
    _attachSetupEvents(el);
  } else if (category === 'printers') {
    el.innerHTML = `<div class="detail-placeholder" style="min-height:10rem">Loading…</div>`;
    let printers = [];
    try {
      const r = await fetch('/api/config/printers');
      if (r.ok) printers = await r.json();
    } catch {}
    _settingsPrinterEntries = printers;
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
  } else if (category === 'preferences') {
    el.innerHTML = _preferencesCategoryHtml();
    _attachPreferencesEvents(el);
  } else if (category === 'appearance') {
    el.innerHTML = _appearanceCategoryHtml();
    _attachAppearanceEvents(el);
  } else if (category === 'slicer') {
    el.innerHTML = `<div class="detail-placeholder" style="min-height:10rem">Loading…</div>`;
    const [profileData, printers] = await Promise.all([
      fetch('/api/slicer/profiles').then(r => r.json()).catch(() => null),
      fetch('/api/printers').then(r => r.json()).catch(() => (_latestPrinters || [])),
    ]);
    el.innerHTML = _slicerCategoryHtml(profileData, printers);
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
  const params = _routeParams('#/spools');
  if (params.has('filter')) {
    const filter = params.get('filter');
    if (['all', 'loaded', 'storage', 'low'].includes(filter)) _spoolsFilter.slotFilter = filter;
  }
  if (params.has('view')) {
    const view = params.get('view');
    if (['cards', 'table', 'cabinet', 'incoming', 'catalogue'].includes(view)) _spoolsViewMode = view;
  }
  _spoolsFilter.printer = params.get('printer') || '';
  const [spools, summary, costs, filamentSummary, locations, intelligence] = await Promise.all([
    fetch('/api/spools').then(r => r.json()).catch(() => []),
    fetch('/api/spools/summary').then(r => r.json()).catch(() => ({})),
    fetch('/api/filament/costs').then(r => r.json()).catch(() => []),
    fetch('/api/filament/summary').then(r => r.json()).catch(() => ({})),
    fetch('/api/spool-locations').then(r => r.json()).catch(() => []),
    fetch('/api/spools/intelligence').then(r => r.json()).catch(() => ({})),
  ]);
  _spoolLocations = locations;
  _spoolsFilamentSummary = filamentSummary;
  _spoolsFilamentCosts = costs;
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
          (href === '#/settings' && _settingsCategory === 'setup')
        );
      });
      _renderSettingsContent(_settingsCategory);
    });
  });

  await _renderSettingsContent(_settingsCategory);
}

loadSettings();
initSidebarResizer();
loadInstanceInfo().then(() => {
  if (_latestPrinters?.length) updateDashboard(_latestPrinters);
});
connectWS();
_refreshSpoolsByPrinter();
initNotifBtn();
window.addEventListener('hashchange', router);

if (!FLIGHTDECK_DEMO && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/static/sw.js').catch(() => {});
}
router();
