const POLL_MS = 5000;

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
  const temps = Object.entries(p.temps || {})
    .map(([k, r]) => renderTemp(TEMP_LABELS[k] ?? k, r))
    .join('');

  let job = '';
  if (p.job) {
    const pct = (p.job.progress * 100).toFixed(0);
    const filename = p.job.filename.replace(/.*\//, '');
    const layers = p.job.layer_current != null && p.job.layer_total != null
      ? `Layer ${p.job.layer_current}/${p.job.layer_total}`
      : '';
    job = `
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

  return `
    <div class="card">
      <div class="card-header">
        <span class="printer-name">${p.name}</span>
        <span class="badge badge-${p.state}">${p.state}</span>
      </div>
      ${temps ? `<div class="temps">${temps}</div>` : ''}
      ${job}
      ${error}
    </div>`;
}

async function refresh() {
  try {
    const printers = await fetch('/api/printers').then(r => r.json());
    document.getElementById('printer-grid').innerHTML = printers.map(renderCard).join('');
    document.getElementById('refresh-time').textContent =
      `Updated ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    console.error('fetch failed', e);
  }
}

refresh();
setInterval(refresh, POLL_MS);
