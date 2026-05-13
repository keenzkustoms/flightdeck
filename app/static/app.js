import { computePosition, flip, offset, arrow } from
  'https://cdn.jsdelivr.net/npm/@floating-ui/dom@1.6.3/+esm';

const POLL_MS = 5000;
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

  try {
    const data = await fetch(`/api/printers/${id}/preview`).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });

    const filename = data.filename.replace(/.*\//, '');
    const totalTime = formatTime(data.estimated_total_seconds);
    const layerH = data.layer_height_mm ? `${data.layer_height_mm}mm` : '—';
    const filament = [
      data.filament_weight_g ? `${data.filament_weight_g.toFixed(0)}g` : null,
      data.filament_type,
    ].filter(Boolean).join(' ');

    const imgHtml = data.image_url
      ? `<img src="${data.image_url}" alt="print preview">`
      : `<div class="popover-placeholder">⬛</div>`;

    popover.innerHTML = `
      ${imgHtml}
      <div class="popover-body">
        <div class="popover-filename">${filename}</div>
        <div class="popover-details">
          <span>Total ${totalTime}</span>
          <span>Layer ${layerH}</span>
        </div>
        ${filament ? `<div class="popover-filament">${filament}</div>` : ''}
      </div>`;
    popover.appendChild(arrowEl);

  } catch {
    popover.innerHTML = `<div class="popover-body"><div class="popover-filename">Preview unavailable</div></div>`;
    popover.appendChild(arrowEl);
  }

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

  const error = p.error ? `<div class="error-msg">${p.error}</div>` : '';
  const badgeLabel = p.state === 'finished' ? 'complete' : p.state;

  return `
    <div class="card"${tabAttr}${dataAttr}>
      <div class="card-header">
        <span class="printer-name">${p.name}</span>
        <span class="badge badge-${p.state}">${badgeLabel}</span>
      </div>
      ${temps ? `<div class="temps">${temps}</div>` : ''}
      ${body}
      ${error}
    </div>`;
}

// ── Poll loop ──────────────────────────────────────────────────────────────

async function refresh() {
  try {
    const printers = await fetch('/api/printers').then(r => r.json());
    const grid = document.getElementById('printer-grid');
    grid.innerHTML = printers.map(renderCard).join('');

    grid.querySelectorAll('[data-printer-id]').forEach(attachCardEvents);

    document.getElementById('refresh-time').textContent =
      `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    console.error('fetch failed', e);
  }
}

refresh();
setInterval(refresh, POLL_MS);
