import { openDrawerPrintMenu } from "./storage-position-menu.js";

const DRAWER_RE = /^D([1-6]) R([1-3]) #(\d{1,3})$/;
const SUNLU_NAME = "SUNLU Dryer";
const UNDO_STORAGE_KEY = "flightdeck.storage.lastAssignment";

let refreshTimer = null;
let observer = null;
let assigning = false;
let selectedSpoolIds = new Set();
let selectionAnchorId = null;
let lastSnapshot = null;
let bulkAssigning = false;
let lastAssignment = loadStoredUndo();

function loadStoredUndo() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(UNDO_STORAGE_KEY) || "null");
    return parsed?.items?.length ? parsed : null;
  } catch (_) {
    return null;
  }
}

function storeUndo(value) {
  lastAssignment = value?.items?.length ? value : null;
  try {
    if (lastAssignment) sessionStorage.setItem(UNDO_STORAGE_KEY, JSON.stringify(lastAssignment));
    else sessionStorage.removeItem(UNDO_STORAGE_KEY);
  } catch (_) {}
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function activeOnSpoolsPage() {
  return location.hash === "#/spools" || location.hash.startsWith("#/spools/");
}

function drawerMeta(location) {
  const match = DRAWER_RE.exec(String(location?.name || "").trim());
  if (!match) return null;
  return { drawer: Number(match[1]), row: Number(match[2]), number: Number(match[3]) };
}

function spoolDisplayId(spool) { return spool?.display_id ?? spool?.id ?? "?"; }
function spoolBrand(spool) { return spool?.brand || "Unknown brand"; }
function spoolName(spool) {
  const material = spool?.material || "Filament";
  const subtype = spool?.subtype ? ` ${spool.subtype}` : "";
  const colour = spool?.color_name || spool?.colour_name || "Unknown colour";
  return `${material}${subtype} · ${colour}`;
}
function spoolColour(spool) {
  const raw = String(spool?.color_hex || spool?.colour_hex || "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : "#64748b";
}
function isArchived(spool) { return Boolean(spool?.archived_at); }
function currentLocationId(spool) { return spool?.storage_location_id == null ? null : Number(spool.storage_location_id); }
function homeLocationId(spool) { return spool?.home_storage_location_id == null ? null : Number(spool.home_storage_location_id); }
function currentPrinter(spool) { return spool?.location_printer_id || null; }
function currentPrinterSlot(spool) { return spool?.location_slot == null ? null : Number(spool.location_slot); }
function locationsById(locations) { return new Map(locations.map(loc => [Number(loc.id), loc])); }

function effectiveHome(spool, byId) {
  const homeId = homeLocationId(spool);
  if (homeId != null) return byId.get(homeId) || null;
  const currentId = currentLocationId(spool);
  const current = currentId != null ? byId.get(currentId) : null;
  return drawerMeta(current) ? current : null;
}

function quickAssignReason(spool, byId) {
  const existingHome = effectiveHome(spool, byId);
  if (drawerMeta(existingHome)) return { eligible: false, label: "Drawer home already set" };
  if (currentPrinter(spool)) {
    const slot = currentPrinterSlot(spool);
    return { eligible: false, label: `Currently loaded${slot != null ? ` · slot ${slot + 1}` : ""}` };
  }
  const current = byId.get(currentLocationId(spool));
  if (current?.name === SUNLU_NAME) return { eligible: false, label: "Currently in SUNLU · home preserved" };
  if (!current) return { eligible: false, label: "No current storage location" };
  if (drawerMeta(current)) return { eligible: false, label: "Already in drawer storage" };
  return { eligible: true, label: `Stored at ${current.name}` };
}

async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok) {
    const detail = payload?.detail?.message || payload?.detail || payload?.message || `HTTP ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return payload;
}

async function loadSnapshot() {
  const [spools, locations] = await Promise.all([apiJson("/api/spools"), apiJson("/api/spool-locations")]);
  return {
    spools: Array.isArray(spools) ? spools.filter(s => !isArchived(s)) : [],
    locations: Array.isArray(locations) ? locations : [],
  };
}

function statusForHomeSpool(spool, homeLoc, byId) {
  if (!spool) return { text: "Empty", className: "empty" };
  const printer = currentPrinter(spool);
  if (printer) {
    const slot = currentPrinterSlot(spool);
    return { text: `Away · ${printer}${slot != null ? ` slot ${slot + 1}` : ""}`, className: "away" };
  }
  const currentId = currentLocationId(spool);
  if (currentId === Number(homeLoc.id)) return { text: "Home", className: "home" };
  const current = byId.get(currentId);
  if (current?.name === SUNLU_NAME) return { text: "Away · SUNLU", className: "sunlu" };
  if (current) return { text: `Away · ${current.name}`, className: "away" };
  return { text: "Home reserved", className: "away" };
}

function displaySortValue(spool) {
  const value = String(spoolDisplayId(spool));
  const numeric = Number(value);
  return Number.isFinite(numeric) ? { numeric, text: value } : { numeric: Number.MAX_SAFE_INTEGER, text: value };
}

function buildSnapshotModel(snapshot) {
  const byId = locationsById(snapshot.locations);
  const drawers = snapshot.locations
    .map(loc => ({ loc, meta: drawerMeta(loc) }))
    .filter(item => item.meta)
    .sort((a, b) => a.meta.number - b.meta.number);

  const homeSpoolByLocation = new Map();
  for (const spool of snapshot.spools) {
    const home = effectiveHome(spool, byId);
    if (home && drawerMeta(home) && !homeSpoolByLocation.has(Number(home.id))) {
      homeSpoolByLocation.set(Number(home.id), spool);
    }
  }

  const quickCandidates = snapshot.spools
    .map(spool => ({ spool, reason: quickAssignReason(spool, byId) }))
    .filter(item => !drawerMeta(effectiveHome(item.spool, byId)))
    .sort((a, b) => {
      const av = displaySortValue(a.spool);
      const bv = displaySortValue(b.spool);
      return av.numeric - bv.numeric || av.text.localeCompare(bv.text, undefined, { numeric: true, sensitivity: "base" });
    });

  return { byId, drawers, homeSpoolByLocation, quickCandidates };
}

function selectedEligible(model) {
  const eligible = model.quickCandidates.filter(item => item.reason.eligible);
  return eligible.filter(item => selectedSpoolIds.has(Number(item.spool.id)));
}

function drawerHtml(drawerNumber, rows, model) {
  const used = rows.filter(item => model.homeSpoolByLocation.has(Number(item.loc.id))).length;
  const first = rows[0]?.meta?.number ?? "?";
  const last = rows.at(-1)?.meta?.number ?? "?";
  const bulkReady = assigning && selectedSpoolIds.size > 0;
  const rowGroups = [1, 2, 3].map(rowNumber => {
    const slots = rows.filter(item => item.meta.row === rowNumber);
    const freeCount = slots.filter(item => !model.homeSpoolByLocation.has(Number(item.loc.id))).length;
    return `
      <div class="fd-storage-row">
        <button type="button" class="fd-storage-row-label${bulkReady ? " bulk-target" : " print-target"}"
                data-bulk-row="${drawerNumber}:${rowNumber}"
                title="${bulkReady ? `Fill D${drawerNumber} R${rowNumber} left-to-right (${freeCount} free)` : `Print labels for D${drawerNumber} R${rowNumber}`}">R${rowNumber}</button>
        <div class="fd-storage-slots">${slots.map(item => slotHtml(item, model)).join("")}</div>
      </div>`;
  }).join("");

  return `
    <section class="fd-storage-drawer" data-drawer="${drawerNumber}">
      <button type="button" class="fd-storage-drawer-head${bulkReady ? " bulk-target" : " print-target"}"
              data-bulk-drawer="${drawerNumber}"
              title="${bulkReady ? `Fill D${drawerNumber} left-to-right` : `Print labels for Drawer D${drawerNumber}`}">
        <div><strong>D${drawerNumber}</strong><span>#${first}–#${last}</span></div>
        <span class="fd-storage-count">${used}/27 home slots</span>
      </button>
      ${rowGroups}
    </section>`;
}

function slotHtml(item, model) {
  const loc = item.loc;
  const spool = model.homeSpoolByLocation.get(Number(loc.id));
  const status = statusForHomeSpool(spool, loc, model.byId);
  const selected = assigning && selectedSpoolIds.size > 0;
  const occupied = Boolean(spool);
  const targetClass = selected && !occupied ? " assign-target" : "";
  const colour = spool ? spoolColour(spool) : "transparent";
  const tooltip = spool
    ? `Spool #${spoolDisplayId(spool)} · ${spoolBrand(spool)} · ${spoolName(spool)} · ${status.text}`
    : `${loc.name} · empty`;
  return `
    <button class="fd-storage-slot ${occupied ? "occupied" : "empty"}${targetClass}"
            type="button" data-location-id="${loc.id}" data-slot-number="${item.meta.number}"
            ${occupied ? "data-occupied=\"1\"" : ""} title="${esc(tooltip)}">
      <span class="fd-storage-slot-no">#${item.meta.number}</span>
      ${spool ? `<span class="fd-storage-swatch" style="--spool-colour:${esc(colour)}"></span>` : `<span class="fd-storage-plus">+</span>`}
      <span class="fd-storage-slot-main">${spool ? `S${esc(spoolDisplayId(spool))}` : "Empty"}</span>
      <span class="fd-storage-slot-status ${status.className}">${esc(status.text)}</span>
    </button>`;
}

function candidateHtml(item, enabled) {
  const spool = item.spool;
  const selected = enabled && selectedSpoolIds.has(Number(spool.id));
  return `
    <button type="button" class="fd-storage-candidate ${selected ? "selected" : ""} ${enabled ? "" : "blocked"}"
            ${enabled ? `data-spool-id="${spool.id}"` : "disabled"}>
      <span class="fd-storage-swatch" style="--spool-colour:${esc(spoolColour(spool))}"></span>
      <span class="fd-storage-candidate-copy">
        <b>#${esc(spoolDisplayId(spool))} · ${esc(spoolBrand(spool))}</b>
        <span>${esc(spoolName(spool))}</span>
      </span>
      <em>${selected ? "Selected" : esc(item.reason.label)}</em>
    </button>`;
}

function quickAssignHtml(model) {
  const candidates = model.quickCandidates;
  const eligible = candidates.filter(item => item.reason.eligible);
  const blocked = candidates.filter(item => !item.reason.eligible);
  const selected = selectedEligible(model);
  const selectedText = selected.length === 1
    ? `Spool #${esc(spoolDisplayId(selected[0].spool))}`
    : `${selected.length} spools selected`;

  return `
    <section class="fd-storage-quick ${assigning ? "is-open" : ""}" ${assigning ? "" : "hidden"}>
      <div class="fd-storage-quick-head">
        <div>
          <strong>Fast initial assignment</strong>
          <span>Click one spool, or click the first then Shift-click the last to select a range. Click a slot, row, or drawer above to place them.</span>
        </div>
        <button type="button" class="fd-storage-btn ghost" data-storage-action="close-quick">Done</button>
      </div>
      <div class="fd-storage-quick-grid">
        <div class="fd-storage-candidates">
          <div class="fd-storage-candidate-title">Ready to assign <span>${eligible.length}</span></div>
          ${eligible.length ? eligible.map(item => candidateHtml(item, true)).join("") : `<div class="fd-storage-empty-note">No legacy-stored spools need a drawer home. 🎉</div>`}
        </div>
        <div class="fd-storage-quick-info">
          <div class="fd-storage-selected ${selected.length ? "has-selection" : ""}">
            ${selected.length ? `<div><b>${selectedText}</b><span>${selected.length === 1 ? `${esc(spoolBrand(selected[0].spool))} · ${esc(spoolName(selected[0].spool))}` : "Click R1/R2/R3 or a drawer header to fill left-to-right."}</span></div><strong>${selected.length === 1 ? "Choose a slot, row or drawer ↑" : "Choose a row or drawer ↑"}</strong>` : `<div><b>Select a spool</b><span>Shift-click the last spool to select a whole range.</span></div>`}
          </div>
          ${blocked.length ? `<details class="fd-storage-protected"><summary>${blocked.length} protected / away spool${blocked.length === 1 ? "" : "s"}</summary><div class="fd-storage-protected-list">${blocked.map(item => candidateHtml(item, false)).join("")}</div></details>` : ""}
        </div>
      </div>
    </section>`;
}

function storageHtml(snapshot) {
  const model = buildSnapshotModel(snapshot);
  const drawerLocations = model.drawers.length;
  const occupiedHomes = model.homeSpoolByLocation.size;
  const sunlu = snapshot.locations.find(loc => loc.name === SUNLU_NAME);
  const sunluSpools = sunlu ? snapshot.spools.filter(spool => currentLocationId(spool) === Number(sunlu.id)) : [];
  const legacySpools = model.quickCandidates.filter(item => item.reason.eligible).length;
  const drawers = [1, 2, 3, 4, 5, 6].map(number => {
    const rows = model.drawers.filter(item => item.meta.drawer === number);
    return drawerHtml(number, rows, model);
  }).join("");
  const undoLabel = lastAssignment?.items?.length ? `↶ Undo (${lastAssignment.items.length})` : "↶ Undo";

  return `
    <div class="fd-storage-shell">
      <section class="fd-storage-hero">
        <div><span class="fd-storage-kicker">FLIGHTDECK STORAGE</span><h2>Six-drawer spool home</h2><p>D1–D6 · R1–R3 · positions #1–162. Home stays reserved while a spool is loaded or visiting SUNLU.</p></div>
        <div class="fd-storage-actions"><button type="button" class="fd-storage-btn primary" data-storage-action="quick">${assigning ? "Assigning…" : "Fast assign"}</button><button type="button" class="fd-storage-btn" data-storage-action="undo" ${lastAssignment ? "" : "disabled"} title="${lastAssignment ? "Undo the most recent Fast Assign action" : "Nothing to undo yet"}">${undoLabel}</button><button type="button" class="fd-storage-btn" data-storage-action="refresh">Refresh</button></div>
      </section>
      <section class="fd-storage-stats">
        <div><b>${drawerLocations}</b><span>drawer positions</span></div><div><b>${occupiedHomes}</b><span>homes assigned</span></div><div><b>${162 - occupiedHomes}</b><span>homes free</span></div><div class="${legacySpools ? "needs-action" : ""}"><b>${legacySpools}</b><span>legacy spools to place</span></div><div class="sunlu"><b>${sunluSpools.length}</b><span>currently in SUNLU</span></div>
      </section>
      <div class="fd-storage-drawers">${drawers}</div>
      ${quickAssignHtml(model)}
      <section class="fd-storage-legend"><span><i class="home"></i> At home</span><span><i class="away"></i> Home reserved, spool away</span><span><i class="sunlu"></i> In SUNLU temporarily</span><span><i class="empty"></i> Empty home</span></section>
    </div>`;
}

function ensureRoot() {
  if (!activeOnSpoolsPage()) return null;
  const body = document.getElementById("spools-body");
  if (!body) return null;
  let root = document.getElementById("fd-drawer-storage");
  if (!root) {
    root = document.createElement("div");
    root.id = "fd-drawer-storage";
    body.prepend(root);
  } else if (body.firstElementChild !== root) body.prepend(root);
  return root;
}

function handleCandidateClick(spoolId, shiftKey, snapshot) {
  const model = buildSnapshotModel(snapshot);
  const eligibleIds = model.quickCandidates.filter(item => item.reason.eligible).map(item => Number(item.spool.id));
  if (!eligibleIds.includes(spoolId)) return;

  if (shiftKey && selectionAnchorId != null && eligibleIds.includes(selectionAnchorId)) {
    const a = eligibleIds.indexOf(selectionAnchorId);
    const b = eligibleIds.indexOf(spoolId);
    const [start, end] = a < b ? [a, b] : [b, a];
    selectedSpoolIds = new Set(eligibleIds.slice(start, end + 1));
  } else {
    selectedSpoolIds = new Set([spoolId]);
    selectionAnchorId = spoolId;
  }
  renderSnapshot(snapshot);
}

function targetLocations(model, drawerNumber, rowNumber = null) {
  return model.drawers
    .filter(item => item.meta.drawer === drawerNumber && (rowNumber == null || item.meta.row === rowNumber))
    .filter(item => !model.homeSpoolByLocation.has(Number(item.loc.id)))
    .sort((a, b) => a.meta.number - b.meta.number);
}

async function moveSpoolToStorage(spoolId, storageLocationId) {
  return apiJson(`/api/spools/${spoolId}/move`, {
    method: "POST",
    body: JSON.stringify({ printer_id: null, slot: null, storage_location_id: Number(storageLocationId), replace_existing: false, sync_ams: false }),
  });
}

async function undoLastAssignment() {
  if (bulkAssigning || !lastAssignment?.items?.length) return;
  bulkAssigning = true;
  const undoing = lastAssignment;
  const restored = [];
  try {
    for (const item of [...undoing.items].reverse()) {
      if (item.previousStorageLocationId == null) throw new Error(`Spool #${item.displayId} has no previous storage location to restore.`);
      await moveSpoolToStorage(item.spoolId, item.previousStorageLocationId);
      restored.push(item.displayId);
    }
    storeUndo(null);
    selectedSpoolIds.clear();
    selectionAnchorId = null;
    const fresh = await loadSnapshot();
    renderSnapshot(fresh);
    flash(`Undid ${restored.length} assignment${restored.length === 1 ? "" : "s"}.`, "ok");
  } catch (error) {
    const fresh = await loadSnapshot().catch(() => lastSnapshot);
    renderSnapshot(fresh);
    flash(`Undo stopped after ${restored.length}: ${error.message}`, "error");
  } finally {
    bulkAssigning = false;
  }
}

async function assignMany(targets) {
  if (bulkAssigning) return;
  const snapshot = lastSnapshot;
  if (!snapshot) return;
  const model = buildSnapshotModel(snapshot);
  const selected = selectedEligible(model);
  if (!selected.length) {
    flash("Select at least one spool first.", "warn");
    return;
  }
  if (targets.length < selected.length) {
    flash(`Not enough empty positions there: ${targets.length} free for ${selected.length} selected.`, "warn");
    return;
  }

  bulkAssigning = true;
  const completed = [];
  const undoItems = [];
  try {
    for (let i = 0; i < selected.length; i++) {
      const spool = selected[i].spool;
      const target = targets[i];
      const previousStorageLocationId = currentLocationId(spool);
      await moveSpoolToStorage(spool.id, target.loc.id);
      completed.push(`#${spoolDisplayId(spool)}→#${target.meta.number}`);
      undoItems.push({
        spoolId: Number(spool.id),
        displayId: String(spoolDisplayId(spool)),
        previousStorageLocationId,
        targetStorageLocationId: Number(target.loc.id),
        targetSlotNumber: Number(target.meta.number),
      });
    }
    storeUndo({ items: undoItems });
    selectedSpoolIds.clear();
    selectionAnchorId = null;
    const fresh = await loadSnapshot();
    const nextModel = buildSnapshotModel(fresh);
    const next = nextModel.quickCandidates.find(item => item.reason.eligible);
    if (assigning && next) {
      selectedSpoolIds = new Set([Number(next.spool.id)]);
      selectionAnchorId = Number(next.spool.id);
    }
    renderSnapshot(fresh);
    flash(`Assigned ${completed.length} spool${completed.length === 1 ? "" : "s"}: ${completed.join(", ")}`, "ok");
  } catch (error) {
    if (undoItems.length) storeUndo({ items: undoItems });
    const fresh = await loadSnapshot().catch(() => snapshot);
    selectedSpoolIds.clear();
    selectionAnchorId = null;
    renderSnapshot(fresh);
    flash(`Bulk assign stopped after ${completed.length}: ${error.message}`, "error");
  } finally {
    bulkAssigning = false;
  }
}

async function assignSingle(locationId, slotNumber) {
  if (selectedSpoolIds.size !== 1) {
    flash("For a single position, select exactly one spool. For a range, click R1/R2/R3 or the drawer header.", "warn");
    return;
  }
  const snapshot = lastSnapshot;
  const model = snapshot ? buildSnapshotModel(snapshot) : null;
  const selected = model ? selectedEligible(model) : [];
  if (selected.length !== 1) {
    flash("That spool is no longer safe for Fast Assign. Refreshing…", "warn");
    await refresh(true);
    return;
  }
  await assignMany([{ loc: { id: locationId }, meta: { number: slotNumber } }]);
}

function bindInteractions(root, snapshot) {
  root.onclick = async event => {
    const actionButton = event.target.closest("[data-storage-action]");
    if (actionButton && root.contains(actionButton)) {
      const action = actionButton.dataset.storageAction;
      if (action === "refresh") return refresh(true);
      if (action === "quick") { assigning = true; renderSnapshot(snapshot); return; }
      if (action === "undo") { await undoLastAssignment(); return; }
      if (action === "close-quick") { assigning = false; selectedSpoolIds.clear(); selectionAnchorId = null; renderSnapshot(snapshot); return; }
    }

    const spoolButton = event.target.closest("[data-spool-id]");
    if (spoolButton && root.contains(spoolButton)) {
      handleCandidateClick(Number(spoolButton.dataset.spoolId), event.shiftKey, snapshot);
      return;
    }

    const model = buildSnapshotModel(lastSnapshot || snapshot);
    const rowButton = event.target.closest("[data-bulk-row]");
    if (rowButton && root.contains(rowButton)) {
      const [drawer, row] = rowButton.dataset.bulkRow.split(":").map(Number);
      if (assigning && selectedSpoolIds.size > 0) {
        await assignMany(targetLocations(model, drawer, row));
      } else {
        openDrawerPrintMenu(rowButton, { drawer, row });
      }
      return;
    }

    const drawerButton = event.target.closest("[data-bulk-drawer]");
    if (drawerButton && root.contains(drawerButton)) {
      const drawer = Number(drawerButton.dataset.bulkDrawer);
      if (assigning && selectedSpoolIds.size > 0) {
        await assignMany(targetLocations(model, drawer));
      } else {
        openDrawerPrintMenu(drawerButton, { drawer });
      }
      return;
    }

    const slotButton = event.target.closest(".fd-storage-slot");
    if (!slotButton || !root.contains(slotButton)) return;
    if (!assigning || selectedSpoolIds.size === 0) { flash("Choose Fast assign and select a spool first.", "warn"); return; }
    if (slotButton.dataset.occupied === "1") { flash("That drawer position already has a home spool.", "warn"); return; }
    const locationId = Number(slotButton.dataset.locationId);
    const slotNumber = Number(slotButton.dataset.slotNumber);
    if (!Number.isFinite(locationId) || !Number.isFinite(slotNumber)) { flash("That drawer position is missing its location mapping.", "error"); return; }
    await assignSingle(locationId, slotNumber);
  };
}

function renderSnapshot(snapshot) {
  lastSnapshot = snapshot;
  const root = ensureRoot();
  if (!root) return;
  root.innerHTML = storageHtml(snapshot);
  bindInteractions(root, snapshot);
}

function flash(message, kind = "ok") {
  const root = document.getElementById("fd-drawer-storage");
  if (!root) return;
  let node = root.querySelector(".fd-storage-toast");
  if (!node) { node = document.createElement("div"); node.className = "fd-storage-toast"; root.append(node); }
  node.className = `fd-storage-toast ${kind}`;
  node.textContent = message;
  node.hidden = false;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { node.hidden = true; }, 3200);
}

async function refresh(showFeedback = false) {
  if (!activeOnSpoolsPage()) return;
  const root = ensureRoot();
  if (!root) return;
  root.classList.add("is-loading");
  try {
    const snapshot = await loadSnapshot();
    renderSnapshot(snapshot);
    if (showFeedback) flash("Drawer storage refreshed.", "ok");
  } catch (error) {
    root.innerHTML = `<div class="fd-storage-load-error"><b>Drawer storage could not load</b><span>${esc(error.message)}</span><button type="button" class="fd-storage-btn" data-storage-action="refresh">Try again</button></div>`;
    bindInteractions(root, lastSnapshot || { spools: [], locations: [] });
  } finally {
    root.classList.remove("is-loading");
  }
}

function scheduleRefresh() {
  clearTimeout(scheduleRefresh._timer);
  scheduleRefresh._timer = setTimeout(() => refresh(false), 120);
}

function boot() {
  window.addEventListener("hashchange", scheduleRefresh);
  observer = new MutationObserver(() => {
    if (!activeOnSpoolsPage()) return;
    const body = document.getElementById("spools-body");
    if (!body) return;
    const root = document.getElementById("fd-drawer-storage");
    if (!root || root.parentElement !== body) scheduleRefresh();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleRefresh();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();