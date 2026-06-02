const state = {
  view: "overview",
  printerId: "h2d",
  paused: false,
  alerts: [
    { title: "AMS profile mismatch", body: "X1C slot 2 reports Generic PLA while Flightdeck expects eSUN PLA+." },
    { title: "Low spool watch", body: "H2D has two loaded rolls below the warning threshold." },
  ],
  activity: ["Demo started", "Simulated fleet loaded"],
};

const printers = [
  { id: "h2d", name: "H2D", shop: "BigBoy", state: "printing", job: "can_openerV2", progress: 37, eta: "2h 41m", chips: ["Dual nozzle", "AMS route", "17 reliability events"] },
  { id: "x1c", name: "X1C", shop: "Greyhound Ludicrous", state: "warn", job: "ready for next job", progress: 0, eta: "idle", chips: ["1 AMS mismatch", "2 failures in 14d"] },
  { id: "voron", name: "Voron 2.4 350", shop: "Greyhound Elite V2", state: "idle", job: "Vivid loaded", progress: 0, eta: "idle", chips: ["MMU route", "maintenance ok"] },
];

const spools = [
  { id: 3, colour: "White", mat: "ASA Normal", brand: "Siddament", grams: 536, pct: 54, hex: "#ffffff", label: "#111827", confidence: "Verified 88%" },
  { id: 2, colour: "Red", mat: "ASA Normal", brand: "Siddament", grams: 295, pct: 29, hex: "#ef2723", label: "#fff", confidence: "Verified 88%" },
  { id: 31, colour: "Lemon Yellow", mat: "PLA Matte", brand: "Bambu Lab", grams: 238, pct: 24, hex: "#ffe66d", label: "#111827", confidence: "Estimated 80%" },
  { id: 20, colour: "Black", mat: "PLA+", brand: "3DFillies", grams: 106, pct: 11, hex: "#1b1b19", label: "#fff", confidence: "Estimated 80%" },
  { id: 48, colour: "Red", mat: "ABS+", brand: "eSUN", grams: 700, pct: 70, hex: "#f04343", label: "#fff", confidence: "Verified 90%" },
  { id: 56, colour: "Black", mat: "PLA+", brand: "3DFillies", grams: 112, pct: 11, hex: "#111111", label: "#fff", confidence: "Estimated 75%" },
];

const files = [
  { name: "can_openerV2.3mf", printer: "H2D", status: "Ready", size: "14.2 MB" },
  { name: "bed_scraper_multi.3mf", printer: "H2D", status: "Blocked: colour missing", size: "6.1 MB" },
  { name: "orca_cube_abs.gcode", printer: "Voron", status: "Ready", size: "420 KB" },
  { name: "tabby_cat_3d_model.3mf", printer: "X1C", status: "Ready", size: "12.8 MB" },
];

const maintenance = [
  { task: "H2D lead screw lubrication", detail: "Due in 18 print hours", tone: "warn" },
  { task: "H2D clean build plate", detail: "Ready after current job", tone: "ok" },
  { task: "X1C carbon rods", detail: "45 print hours left", tone: "ok" },
  { task: "Voron belt tension", detail: "Manual check scheduled", tone: "ok" },
];

const qs = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const printer = () => printers.find(p => p.id === state.printerId) || printers[0];

function tickClock() {
  qs("#demo-clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function badge(text, tone = "") {
  return `<span class="badge ${tone}">${esc(text)}</span>`;
}

function addActivity(text) {
  state.activity.unshift(text);
  state.activity = state.activity.slice(0, 8);
  renderSide();
}

function addAlert(title, body) {
  state.alerts.unshift({ title, body });
  renderSide();
}

function toast(text) {
  const el = qs("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { el.hidden = true; }, 2400);
}

function demoAction(label, detail, alert = false) {
  addActivity(`${label}: ${detail}`);
  if (alert) addAlert(label, detail);
  toast(`${label}: ${detail}`);
}

function renderFleet() {
  qs("#fleet-list").innerHTML = printers.map(p => `
    <button class="fleet-card ${p.id === state.printerId ? "active" : ""}" data-printer="${p.id}" type="button">
      <span>
        <strong>${esc(p.name)}</strong><br>
        <small>${esc(p.shop)} - ${esc(p.job)}</small>
      </span>
      ${badge(p.state === "warn" ? "watch" : p.state, p.state)}
    </button>
  `).join("");
  document.querySelectorAll("[data-printer]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.printerId = btn.dataset.printer;
      state.view = "live";
      renderAll();
    });
  });
}

function renderSide() {
  qs("#alerts").innerHTML = state.alerts.length ? state.alerts.map(a => `
    <div class="alert"><strong>${esc(a.title)}</strong><small>${esc(a.body)}</small></div>
  `).join("") : `<p class="muted">No demo alerts.</p>`;
  qs("#activity").innerHTML = state.activity.map(item => `
    <div class="activity-row"><small>${esc(item)}</small></div>
  `).join("");
}

function renderOverview() {
  const p = printer();
  return `
    <div class="stage-card">
      <div class="stage-row">
        <div class="stage-title">
          <p class="stage-label">Demo overview</p>
          <h2>Show the whole Flightdeck story in five minutes.</h2>
          <p class="muted">Start with fleet health, jump to a live printer, show stock confidence, then close on Print Bay and maintenance.</p>
        </div>
        <div class="command-strip">
          <button class="stage-btn green" data-view-jump="live">Open live printer</button>
          <button class="stage-btn" data-view-jump="spools">Show spools</button>
        </div>
      </div>
    </div>
    <div class="stage-card">
      <p class="stage-label">Current demo pick</p>
      <h2>${esc(p.name)} - ${esc(p.shop)}</h2>
      <div class="progress"><span style="--w:${p.progress || 4}%"></span></div>
      <p class="muted">${p.chips.map(esc).join(" - ")}</p>
    </div>
    <div class="object-list">
      ${["Dashboard: fleet status and host health", "Flight Tower: dispatch recommendation", "Live Printer: camera, commands, filament route", "Spools: paint chart, labels, confidence", "Print Bay: vault, queue, compatibility"].map((item, i) => `
        <div class="object-row"><strong>${i + 1}. ${esc(item)}</strong>${badge(i < 2 ? "safe" : "interactive", i < 2 ? "ok" : "warn")}</div>
      `).join("")}
    </div>
  `;
}

function renderLive() {
  const p = printer();
  const paused = state.paused || p.state === "warn";
  return `
    <div class="stage-card">
      <div class="stage-row">
        <div class="stage-title">
          <p class="stage-label">${p.state === "printing" ? "Now printing" : "Status"}</p>
          <h2>${esc(p.name)} - ${esc(p.job)}</h2>
          <p class="muted">${p.progress}% - Flightdeck ETA ${esc(p.eta)} - commands are simulated</p>
        </div>
        <div class="command-strip">
          <button class="stage-btn green" data-action="light">Light</button>
          <button class="stage-btn amber" data-action="pause">${paused ? "Resume" : "Pause"}</button>
          <button class="stage-btn" data-action="skip">Skip object</button>
          <button class="stage-btn red" data-action="estop">E-stop</button>
        </div>
      </div>
    </div>
    <div class="camera-box">
      <div class="camera-overlay">
        <strong>${esc(p.job)}</strong>
        <span>${p.progress}% - ${esc(p.eta)}</span>
      </div>
    </div>
    <div class="stage-card">
      <p class="stage-label">Filament route</p>
      <div class="object-row"><strong>AMS HT - Spool #2 Red ASA</strong>${badge("feeding right nozzle", "ok")}</div>
      <div class="object-row"><strong>AMS 1 S1 - Spool #3 White ASA</strong>${badge("ready left nozzle", "idle")}</div>
    </div>
  `;
}

function renderSpools() {
  return `
    <div class="stage-card">
      <div class="stage-row">
        <div>
          <p class="stage-label">Spool inventory</p>
          <h2>Paint-chart stock with weight confidence.</h2>
          <p class="muted">The demo pretends a scale and Brother QL-700 are available.</p>
        </div>
        <div class="command-strip">
          <button class="stage-btn green" data-action="label">Print label</button>
          <button class="stage-btn amber" data-action="weigh">Weigh spool</button>
        </div>
      </div>
    </div>
    <div class="spool-chart"><div class="spool-grid">
      ${spools.map(s => `
        <article class="spool-card">
          <div class="spool-colour" style="--c:${s.hex};--label:${s.label}"><span>${esc(s.colour)}</span><span>#${s.id}</span></div>
          <div class="spool-card-body">
            <strong>${esc(s.mat)}</strong>
            <span>${esc(s.brand)}</span>
            <strong>${s.pct}% ${s.grams}g</strong>
            <span>${esc(s.confidence)}</span>
          </div>
        </article>
      `).join("")}
    </div></div>
  `;
}

function renderBay() {
  return `
    <div class="stage-card">
      <div class="stage-row">
        <div>
          <p class="stage-label">Print Bay</p>
          <h2>Queue files, stage to vault, and explain blockers.</h2>
          <p class="muted">This is where the demo shows compatibility checks without touching SD cards.</p>
        </div>
        <button class="stage-btn green" data-action="queue">Queue selected</button>
      </div>
    </div>
    <div class="bay-list">
      ${files.map(f => `
        <div class="bay-row">
          <span><strong>${esc(f.name)}</strong><br><small>${esc(f.size)} - ${esc(f.printer)}</small></span>
          ${badge(f.status, f.status.includes("Blocked") ? "error" : "ok")}
        </div>
      `).join("")}
    </div>
  `;
}

function renderMaintenance() {
  return `
    <div class="stage-card">
      <p class="stage-label">Maintenance</p>
      <h2>Usage-aware care without copying someone else's layout.</h2>
      <p class="muted">Bambu care counters, Voron manual tasks, and operator history all sit in one schedule.</p>
    </div>
    <div class="maintenance-grid">
      ${maintenance.map(m => `
        <div class="maint-row">
          <span><strong>${esc(m.task)}</strong><br><small>${esc(m.detail)}</small></span>
          <button class="mini-btn ${m.tone === "warn" ? "amber" : "green"}" data-action="maint">Log done</button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderStage() {
  const renderers = { overview: renderOverview, live: renderLive, spools: renderSpools, bay: renderBay, maintenance: renderMaintenance };
  qs("#stage").innerHTML = (renderers[state.view] || renderOverview)();
  document.querySelectorAll("[data-view-jump]").forEach(btn => {
    btn.addEventListener("click", () => { state.view = btn.dataset.viewJump; renderAll(); });
  });
  document.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "pause") {
        state.paused = !state.paused;
        demoAction(state.paused ? "Print paused" : "Print resumed", `${printer().name} demo state changed`, state.paused);
        renderAll();
      } else if (action === "estop") {
        demoAction("E-stop blocked", "Demo mode shows the warning but never sends the command", true);
      } else if (action === "light") {
        demoAction("Light toggled", `${printer().name} chamber light simulation`);
      } else if (action === "skip") {
        demoAction("Object skipped", "bedscraper.stl #7 marked excluded in demo");
      } else if (action === "label") {
        demoAction("Label printed", "Spool #3 label simulated for DK-22212");
      } else if (action === "weigh") {
        demoAction("Weight captured", "Scale read simulated at 536g");
      } else if (action === "queue") {
        demoAction("Queue updated", "can_openerV2 added to H2D demo queue");
      } else if (action === "maint") {
        demoAction("Maintenance logged", "Task reset in demo only");
      }
    });
  });
}

function renderNav() {
  document.querySelectorAll(".demo-nav button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === state.view);
    btn.onclick = () => { state.view = btn.dataset.view; renderAll(); };
  });
}

function renderAll() {
  renderNav();
  renderFleet();
  renderStage();
  renderSide();
}

qs("#clear-alerts").addEventListener("click", () => {
  state.alerts = [];
  addActivity("Demo alerts cleared");
  renderSide();
});

tickClock();
setInterval(tickClock, 10000);
renderAll();
