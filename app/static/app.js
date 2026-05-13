import { computePosition, flip, offset, arrow } from
  'https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.6.3/+esm';

const POLL_MS = 5000;

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
const HOVER_DELAY_MS = 200;
const LONG_PRESS_MS = 400;

// ── Popover singleton ──────────────────────────────────────────────────────

const popover = document.createElement('div');
popover.id = 'preview-popover';
popover.setAttribute('role', 'tooltip');
const arrowEl = document.createElement('div');
arrowEl.id = 'popover-arrow';
popover.appendChild(arrowEl);
document.body.appendChild(popover);

let activeCard = null;
let hoverTimer = null;
let longPressTimer = null;

function formatTime(seconds) {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function showPreview(card) {
  if (activeCard === card) return;
  activeCard = card;
  const id = card.dataset.printerId;

  let data = null;
  try {
    const resp = await fetch(`/api/printers/${id}/preview`);
    if (resp.ok) data = await resp.json();
  } catch { /* network error — render with no data */ }

  if (data) {
    const filename = data.filename.replace(/.*\//, '');
    const totalTime = formatTime(data.estimated_total_seconds);
    const layerH = data.layer_height_mm ? `${data.layer_height_mm}mm` : null;
    const filament = [
      data.filament_weight_g ? `~${data.filament_weight_g.toFixed(0)}g` : null,
      data.filament_type,
    ].filter(Boolean).join(' · ');

    const imgHtml = data.image_url
      ? `<img src="${data.image_url}" alt="print preview">`
      : `<div class="popover-placeholder">□</div>`;

    const metaRight = [layerH ? `Layer ${layerH}` : null, `Total ${totalTime}`]
      .filter(Boolean).join(' · ');

    popover.innerHTML = `
      ${imgHtml}
      <div class="popover-body">
        <div class="popover-filename">${filename}</div>
        <div class="popover-details"><span>${metaRight}</span></div>
        ${filament ? `<div class="popover-filament">${filament}</div>` : ''}
      </div>`;
  } else {
    // §6 fallback: show placeholder icon + whatever we already know from card data
    const card_p = activeCard?._printerData;
    const filename = card_p?.job?.filename?.replace(/.*\//, '') ?? '';
    popover.innerHTML = `
      <div class="popover-placeholder">□</div>
      <div class="popover-body">
        ${filename ? `<div class="popover-filename">${filename}</div>` : ''}
        <div class="popover-details"><span>Preview unavailable</span></div>
      </div>`;
  }
  popover.appendChild(arrowEl);

  popover.classList.add('visible');
  await reposition(card);
}

async function reposition(card) {
  const { x, y, placement, middlewareData } = await computePosition(card, popover, {
    placement: 'top',
    middleware: [
      offset(8),
      flip(),
      arrow({ element: arrowEl }),
    ],
  });

  Object.assign(popover.style, { left: `${x}px`, top: `${y}px` });

  const { x: ax, y: ay } = middlewareData.arrow;
  const side = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[placement.split('-')[0]];
  Object.assign(arrowEl.style, {
    left: ax != null ? `${ax}px` : '',
    top: ay != null ? `${ay}px` : '',
    [side]: '-5px',
    bottom: '', right: '',
  });
}

function hidePreview() {
  popover.classList.remove('visible');
  activeCard = null;
}

// ── Event wiring ───────────────────────────────────────────────────────────

function attachCardEvents(card) {
  // Desktop hover with intent delay
  card.addEventListener('mouseenter', () => {
    hoverTimer = setTimeout(() => showPreview(card), HOVER_DELAY_MS);
  });
  card.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
    hidePreview();
  });

  // Mobile long-press
  card.addEventListener('touchstart', e => {
    longPressTimer = setTimeout(() => {
      e.preventDefault();
      showPreview(card);
    }, LONG_PRESS_MS);
  }, { passive: false });
  card.addEventListener('touchend', () => clearTimeout(longPressTimer));
  card.addEventListener('touchmove', () => clearTimeout(longPressTimer));

  // Keyboard toggle
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activeCard === card ? hidePreview() : showPreview(card);
    }
    if (e.key === 'Escape') hidePreview();
  });
}

// Dismiss on outside click
document.addEventListener('click', e => {
  if (activeCard && !activeCard.contains(e.target) && !popover.contains(e.target)) {
    hidePreview();
  }
});

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

function renderCard(p) {
  const isActive = p.state === 'printing' || p.state === 'paused' || p.state === 'finished';
  const tabAttr = isActive ? ' tabindex="0"' : '';
  const dataAttr = isActive ? ` data-printer-id="${p.id}"` : '';

  const temps = Object.entries(p.temps || {})
    .map(([k, r]) => renderTemp(TEMP_LABELS[k] ?? k, r))
    .join('');

  let body = '';

  if (p.state === 'finished' && p.job) {
    const filename = p.job.filename.replace(/.*\//, '');
    const hotend = p.temps?.hotend?.actual ?? 0;
    const cooling = hotend > 50
      ? `<div class="job-meta"><span>Hotend cooling · ${hotend.toFixed(0)}°</span></div>`
      : '';
    body = `
      <div class="job">
        <div class="job-filename" title="${p.job.filename}">${filename}</div>
        <div class="job-meta"><span>Print complete</span><span>Layer ${p.job.layer_current ?? '—'}/${p.job.layer_total ?? '—'}</span></div>
        ${cooling}
      </div>`;

  } else if (p.job) {
    const pct = (p.job.progress * 100).toFixed(0);
    const filename = p.job.filename.replace(/.*\//, '');
    const layers = p.job.layer_current != null && p.job.layer_total != null
      ? `Layer ${p.job.layer_current}/${p.job.layer_total}`
      : '';
    body = `
      <div class="job">
        <div class="job-filename" title="${p.job.filename}">${filename}</div>
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

  const idleEntries = Object.entries(p.idle_info || {});
  const idleRows = idleEntries.length > 0 && p.state === 'idle' ? `
    <div class="idle-info">
      ${idleEntries.map(([k, v]) => `
        <div class="idle-row">
          <span class="idle-label">${k}</span>
          <span class="idle-value">${v}</span>
        </div>`).join('')}
    </div>` : '';

  const error = p.error ? `<div class="error-msg">${p.error}</div>` : '';
  const badgeLabel = p.state === 'finished' ? 'complete' : p.state;

  return `
    <div class="card"${tabAttr}${dataAttr}>
      <div class="card-header">
        <div class="printer-identity">
          <div class="printer-icon">${getIcon(p.icon)}</div>
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

// ── Poll loop ──────────────────────────────────────────────────────────────

async function refresh() {
  try {
    const printers = await fetch('/api/printers').then(r => r.json());
    const grid = document.getElementById('printer-grid');
    grid.innerHTML = printers.map(renderCard).join('');

    grid.querySelectorAll('[data-printer-id]').forEach(card => {
      const p = printers.find(x => x.id === card.dataset.printerId);
      if (p) card._printerData = p;
      attachCardEvents(card);
    });

    document.getElementById('refresh-time').textContent =
      `Updated ${new Date().toLocaleTimeString()}`;

    const active = printers.filter(p => p.state === 'printing' || p.state === 'paused').length;
    const idle = printers.filter(p => p.state === 'idle' || p.state === 'finished').length;
    document.getElementById('dash-footer').innerHTML =
      `<span>flightdeck · 192.168.4.127</span>` +
      `<span>${printers.length} printers · ${active} active · ${idle} idle</span>`;
  } catch (e) {
    console.error('fetch failed', e);
  }
}

refresh();
setInterval(refresh, POLL_MS);
