const selected = new Set();
let busy = false;
let enhanceQueued = false;

function candidateId(node) { return Number(node?.dataset?.spoolId); }

function syncCandidate(node) {
  const id = candidateId(node);
  if (!Number.isFinite(id)) return;
  let mark = node.querySelector('.fd-storage-checkmark');
  if (!mark) {
    mark = document.createElement('span');
    mark.className = 'fd-storage-checkmark';
    mark.setAttribute('aria-hidden', 'true');
    node.prepend(mark);
  }
  const checked = selected.has(id);
  const wanted = checked ? '✓' : '';
  if (mark.textContent !== wanted) mark.textContent = wanted;
  node.classList.toggle('fd-checkbox-selected', checked);
  if (node.getAttribute('aria-pressed') !== (checked ? 'true' : 'false')) node.setAttribute('aria-pressed', checked ? 'true' : 'false');
}

function eligibleCandidates(root) {
  return [...root.querySelectorAll('.fd-storage-candidate[data-spool-id]')];
}

function syncToolbar(root) {
  const title = root.querySelector('.fd-storage-candidate-title');
  if (!title) return;
  let tools = root.querySelector('.fd-storage-check-tools');
  if (!tools) {
    tools = document.createElement('div');
    tools.className = 'fd-storage-check-tools';
    tools.innerHTML = '<span class="fd-storage-check-count">0 selected</span><button type="button" data-check-action="all">Select all</button><button type="button" data-check-action="clear">Clear</button><button type="button" class="primary" data-check-action="assign">Assign selected</button>';
    title.after(tools);
  }
  const count = tools.querySelector('.fd-storage-check-count');
  const wantedCount = `${selected.size} selected`;
  if (count && count.textContent !== wantedCount) count.textContent = wantedCount;
  const assign = tools.querySelector('[data-check-action="assign"]');
  if (assign) assign.disabled = busy || selected.size === 0;
  const done = root.querySelector('[data-storage-action="close-quick"]');
  if (done) {
    done.disabled = busy;
    done.textContent = selected.size ? `Done · Assign ${selected.size}` : 'Done';
    done.title = selected.size ? `Assign ${selected.size} checked spool${selected.size === 1 ? '' : 's'} to their numbered drawer homes and finish` : 'Close Fast Assign';
  }
}

function enhance() {
  enhanceQueued = false;
  const root = document.getElementById('fd-drawer-storage');
  if (!root) return;
  eligibleCandidates(root).forEach(syncCandidate);
  syncToolbar(root);
  const hint = root.querySelector('.fd-storage-quick-head span');
  const hintText = 'Tick any spools you physically have and skip any you do not. Done saves every checked spool straight to its matching numbered drawer home.';
  if (hint && hint.textContent !== hintText) hint.textContent = hintText;
  const emptyHint = root.querySelector('.fd-storage-selected:not(.has-selection) span');
  const emptyText = 'Use the check marks in the list. You can skip any spool that is not in your hand.';
  if (emptyHint && emptyHint.textContent !== emptyText) emptyHint.textContent = emptyText;
}

function scheduleEnhance() {
  if (enhanceQueued) return;
  enhanceQueued = true;
  requestAnimationFrame(enhance);
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...options });
  let body = null;
  try { body = await response.json(); } catch (_) {}
  if (!response.ok) throw new Error(body?.detail?.message || body?.detail || body?.message || `HTTP ${response.status}`);
  return body;
}

async function assignChecked(root) {
  if (busy || !selected.size) return;
  busy = true;
  syncToolbar(root);
  try {
    const [spools, locations] = await Promise.all([apiJson('/api/spools'), apiJson('/api/spool-locations')]);
    const byId = new Map(spools.map(s => [Number(s.id), s]));
    const byNumber = new Map();
    for (const loc of locations) {
      const match = /^D[1-6] R[1-3] #(\d{1,3})$/.exec(String(loc?.name || '').trim());
      if (match) byNumber.set(Number(match[1]), loc);
    }
    const ids = [...selected].sort((a, b) => Number(byId.get(a)?.display_id ?? a) - Number(byId.get(b)?.display_id ?? b));
    const completed = [];
    for (const id of ids) {
      const spool = byId.get(id);
      if (!spool) throw new Error(`Spool ${id} is no longer available.`);
      const number = Number(spool.display_id ?? spool.id);
      const target = byNumber.get(number);
      if (!target) throw new Error(`Spool #${number} has no matching drawer position.`);
      await apiJson(`/api/spools/${id}/move`, {
        method: 'POST',
        body: JSON.stringify({ printer_id: null, slot: null, storage_location_id: Number(target.id), replace_existing: false, sync_ams: false }),
      });
      completed.push(number);
      selected.delete(id);
    }
    alert(`FlightDeck: assigned ${completed.length} spool${completed.length === 1 ? '' : 's'} to their numbered drawer homes.`);
    location.reload();
  } catch (error) {
    alert(`FlightDeck bulk assign stopped: ${error.message || error}`);
    busy = false;
    enhance();
  }
}

document.addEventListener('click', event => {
  const root = document.getElementById('fd-drawer-storage');
  if (!root) return;

  const done = event.target.closest('[data-storage-action="close-quick"]');
  if (done && root.contains(done) && selected.size) {
    event.preventDefault();
    event.stopImmediatePropagation();
    assignChecked(root);
    return;
  }

  const action = event.target.closest('[data-check-action]');
  if (action && root.contains(action)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const nodes = eligibleCandidates(root);
    if (action.dataset.checkAction === 'all') nodes.forEach(node => selected.add(candidateId(node)));
    if (action.dataset.checkAction === 'clear') selected.clear();
    if (action.dataset.checkAction === 'assign') { assignChecked(root); return; }
    nodes.forEach(syncCandidate);
    syncToolbar(root);
    return;
  }
  const candidate = event.target.closest('.fd-storage-candidate[data-spool-id]');
  if (!candidate || !root.contains(candidate)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const id = candidateId(candidate);
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  syncCandidate(candidate);
  syncToolbar(root);
}, true);

const observer = new MutationObserver(records => {
  if (!records.some(record => [...record.addedNodes].some(node => node.nodeType === 1 && (node.id === 'fd-drawer-storage' || node.querySelector?.('#fd-drawer-storage, .fd-storage-candidate'))))) return;
  scheduleEnhance();
});

function boot() {
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleEnhance();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
