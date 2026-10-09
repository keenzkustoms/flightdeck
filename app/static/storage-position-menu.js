const DRAWER_RE = /^D([1-6]) R([1-3]) #(\d{1,3})$/;
let menuState = null;

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function json(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  let body = null;
  try { body = await response.json(); } catch (_) {}
  if (!response.ok) {
    throw new Error(body?.detail?.message || body?.detail || body?.message || `HTTP ${response.status}`);
  }
  return body;
}

function closeMenu() {
  document.getElementById("fd-position-menu")?.remove();
  menuState = null;
}

function placeMenu(node, anchor) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(330, window.innerWidth - 24);
  node.style.width = `${width}px`;
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
  const below = rect.bottom + 8;
  const top = below + node.offsetHeight <= window.innerHeight - 12
    ? below
    : Math.max(12, rect.top - node.offsetHeight - 8);
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

function currentText(spool, locations) {
  if (spool.location_printer_id) {
    const slot = spool.location_slot == null ? "" : ` · slot ${Number(spool.location_slot) + 1}`;
    return `${spool.location_printer_id}${slot}`;
  }
  const loc = locations.find((item) => Number(item.id) === Number(spool.storage_location_id));
  return loc?.name || "Away / location not set";
}

async function positionData(locationId) {
  const [spools, locations] = await Promise.all([json("/api/spools"), json("/api/spool-locations")]);
  const location = locations.find((item) => Number(item.id) === Number(locationId));
  const spool =
    spools.find((item) => Number(item.home_storage_location_id) === Number(locationId)) ||
    spools.find(
      (item) =>
        Number(item.storage_location_id) === Number(locationId) &&
        DRAWER_RE.test(String(location?.name || ""))
    );
  return { spool, location, locations };
}

function openDetails(spoolId) {
  closeMenu();
  location.hash = `#/spool/${Number(spoolId)}`;
}

function openAwayAssignment(spoolId) {
  closeMenu();
  const selector = `[data-action="assign"][data-id="${CSS.escape(String(spoolId))}"]`;
  const button =
    document.querySelector(`#spools-body ${selector}`) || document.querySelector(selector);
  if (button) {
    button.click();
    return;
  }
  location.hash = "#/spools";
  setTimeout(() => document.querySelector(`#spools-body ${selector}`)?.click(), 100);
}

async function markHome(spool, homeLocation) {
  await json(`/api/spools/${spool.id}/move`, {
    method: "POST",
    body: JSON.stringify({
      printer_id: null,
      slot: null,
      storage_location_id: Number(homeLocation.id),
      replace_existing: false,
      sync_ams: false,
    }),
  });
  closeMenu();
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

async function printLabel(url, okMessage) {
  await json(url, { method: "POST" });
  // Prefer Flightdeck toast; never use window.alert for successful prints.
  if (typeof window.showToast === "function") {
    window.showToast(okMessage, "QL-700", "success");
    return;
  }
  const root = document.getElementById("fd-drawer-storage");
  if (root) {
    let node = root.querySelector(".fd-storage-toast");
    if (!node) {
      node = document.createElement("div");
      node.className = "fd-storage-toast";
      root.append(node);
    }
    node.className = "fd-storage-toast ok";
    node.textContent = okMessage;
    node.hidden = false;
    clearTimeout(node._hideTimer);
    node._hideTimer = setTimeout(() => { node.hidden = true; }, 2800);
  }
}

function renderMenu(anchor, data) {
  closeMenu();
  const { spool, location, locations } = data;
  const node = document.createElement("div");
  node.id = "fd-position-menu";
  node.className = "fd-position-menu";
  const slotName = location?.name || `Position #${anchor.dataset.slotNumber || "?"}`;
  const homeId = location?.id;

  if (!spool) {
    node.innerHTML = `
      <div class="fd-position-menu-head"><b>${esc(slotName)}</b><span>Unassigned home</span></div>
      <button type="button" data-pos-action="assign">＋ <span><b>Assign with Fast Assign</b><small>Place a legacy spool into this home</small></span></button>
      <button type="button" data-pos-action="print-home" ${homeId ? "" : "disabled"}>🏷 <span><b>Home location label</b><small>Mark this empty slot on the drawer</small></span></button>
    `;
  } else {
    const displayId = spool.display_id ?? spool.id;
    const atHome =
      !spool.location_printer_id && Number(spool.storage_location_id) === Number(location.id);
    node.innerHTML = `
      <div class="fd-position-menu-head">
        <b>S${esc(displayId)} · ${esc(slotName)}</b>
        <span>${atHome ? "Physically at home" : `Away · ${esc(currentText(spool, locations))}`}</span>
      </div>
      <button type="button" data-pos-action="home" ${atHome ? "disabled" : ""}>🏠 <span><b>Home</b><small>${atHome ? "Already in this position" : "Return this spool to its permanent home"}</small></span></button>
      <button type="button" data-pos-action="away">↗ <span><b>Away</b><small>${atHome ? "Choose where this spool is going" : `Currently ${esc(currentText(spool, locations))}`}</small></span></button>
      <button type="button" data-pos-action="print-spool">🏷 <span><b>Spool label</b><small>Full spool sticker with QR</small></span></button>
      <button type="button" data-pos-action="print-home" ${homeId ? "" : "disabled"}>📍 <span><b>Home location label</b><small>Slot marker for ${esc(slotName)}</small></span></button>
      <button type="button" data-pos-action="details">● <span><b>Detailed View</b><small>Full spool details, weight confidence and filament moves</small></span></button>
    `;
  }

  document.body.append(node);
  placeMenu(node, anchor);
  menuState = { anchor, data, kind: "slot" };

  node.onclick = async (event) => {
    const button = event.target.closest("[data-pos-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.posAction;
    button.disabled = true;
    try {
      if (action === "home") await markHome(spool, location);
      if (action === "away") openAwayAssignment(spool.id);
      if (action === "details") openDetails(spool.id);
      if (action === "assign") {
        closeMenu();
        document.querySelector('#fd-drawer-storage [data-storage-action="quick"]')?.click();
      }
      if (action === "print-spool") {
        await printLabel(`/api/label_printer/print/${spool.id}`, `Spool #${spool.display_id ?? spool.id} label printed`);
        closeMenu();
      }
      if (action === "print-home") {
        await printLabel(`/api/label_printer/home/${homeId}`, `Home label ${slotName} printed`);
        closeMenu();
      }
    } catch (error) {
      button.disabled = false;
      button.title = String(error.message || error);
      alert(`FlightDeck storage: ${error.message || error}`);
    }
  };
}

/** Print menu when clicking a drawer header or row label (outside Fast Assign). */
export function openDrawerPrintMenu(anchor, { drawer, row = null } = {}) {
  closeMenu();
  const node = document.createElement("div");
  node.id = "fd-position-menu";
  node.className = "fd-position-menu";
  const first = (drawer - 1) * 27 + 1;
  const last = first + 26;
  const rowStart = row ? (drawer - 1) * 27 + (row - 1) * 9 + 1 : null;
  const rowNums =
    rowStart != null ? Array.from({ length: 9 }, (_, i) => rowStart + i).join(" · ") : "";

  const title = row ? `D${drawer} · ROW ${row}` : `DRAWER D${drawer}`;
  const sub = row ? `Spools ${rowNums}` : `Spools ${first}–${last} · 9 per row · 3 rows`;

  node.innerHTML = `
    <div class="fd-position-menu-head"><b>${esc(title)}</b><span>${esc(sub)}</span></div>
    <button type="button" data-pos-action="print-drawer">🗄 <span><b>Drawer banner</b><small>DRAWER D${drawer} · SPOOLS ${first}–${last}</small></span></button>
    ${
      row
        ? `<button type="button" data-pos-action="print-row">☰ <span><b>Row strip</b><small>D${drawer} · ROW ${row} · ${esc(rowNums)}</small></span></button>`
        : `<button type="button" data-pos-action="print-row-1">☰ <span><b>Row 1 strip</b><small>${first}–${first + 8}</small></span></button>
           <button type="button" data-pos-action="print-row-2">☰ <span><b>Row 2 strip</b><small>${first + 9}–${first + 17}</small></span></button>
           <button type="button" data-pos-action="print-row-3">☰ <span><b>Row 3 strip</b><small>${first + 18}–${last}</small></span></button>`
    }
  `;

  document.body.append(node);
  placeMenu(node, anchor);
  menuState = { anchor, kind: "drawer", drawer, row };

  node.onclick = async (event) => {
    const button = event.target.closest("[data-pos-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.posAction;
    button.disabled = true;
    try {
      if (action === "print-drawer") {
        await printLabel(`/api/label_printer/drawer/${drawer}`, `Drawer D${drawer} banner printed`);
      } else if (action === "print-row" && row) {
        await printLabel(`/api/label_printer/drawer/${drawer}/row/${row}`, `D${drawer} R${row} strip printed`);
      } else if (action?.startsWith("print-row-")) {
        const r = Number(action.split("-").pop());
        await printLabel(`/api/label_printer/drawer/${drawer}/row/${r}`, `D${drawer} R${r} strip printed`);
      }
      closeMenu();
    } catch (error) {
      button.disabled = false;
      alert(`FlightDeck labels: ${error.message || error}`);
    }
  };
}

document.addEventListener(
  "click",
  async (event) => {
    const root = document.getElementById("fd-drawer-storage");
    const slot = event.target.closest("#fd-drawer-storage .fd-storage-slot");
    if (slot && root?.contains(slot)) {
      const fastAssignOpen = Boolean(root.querySelector(".fd-storage-quick:not([hidden])"));
      if (fastAssignOpen && root.querySelector(".fd-storage-candidate.selected")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        renderMenu(slot, await positionData(Number(slot.dataset.locationId)));
      } catch (error) {
        alert(`FlightDeck storage: ${error.message || error}`);
      }
      return;
    }
    if (menuState && !event.target.closest("#fd-position-menu")) closeMenu();
  },
  true
);

window.addEventListener("hashchange", closeMenu);
window.addEventListener("resize", closeMenu);
window.addEventListener("scroll", closeMenu, true);
