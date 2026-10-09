/**
 * MakerDeck — Shared Navigation Component  b614
 * Auto-injects consistent nav bar across all MakerDeck tools.
 */

const BUILD = 'b614';

const TOOLS = [
  { id: 'container', label: 'Container', href: 'index.html' },
  { id: 'painter',   label: 'STL Painter', href: 'painter.html' },
  { id: 'paper3d',   label: 'Paper3D', href: 'paper3d.html' },
  { id: 'meshprep',  label: 'Mesh Prep', href: 'meshprep.html' },
  { id: 'chop',      label: 'Chop', href: 'chop.html' },
];

function detectActiveTool() {
  const path = location.pathname.toLowerCase();
  if (path.includes('painter')) return 'painter';
  if (path.includes('meshprep')) return 'meshprep';
  if (path.includes('chop')) return 'chop';
  if (path.includes('paper3d') || path.includes('voronoi')) return 'paper3d';
  return 'container';
}

function applyEmbeddedMeshPrepLayout(active) {
  if (active !== 'meshprep' || window.self === window.top) return;

  document.documentElement.classList.add('meshprep-embedded');
  const style = document.createElement('style');
  style.id = 'meshprep-embedded-layout';
  style.textContent = `
    html.meshprep-embedded .md-nav { display:none !important; }
    html.meshprep-embedded .app {
      --diag-h: 286px;
      grid-template-columns: var(--sidebar-w) 1fr !important;
      grid-template-rows: minmax(0,1fr) var(--diag-h) var(--footer-h) !important;
      grid-template-areas:
        "sidebar viewport"
        "dock dock"
        "footer footer" !important;
    }
    html.meshprep-embedded .sidebar { min-height:0; }
    html.meshprep-embedded .viewport { min-height:0; }
    .meshprep-dock {
      grid-area:dock; min-height:0; position:relative; z-index:12;
      display:grid; grid-template-rows:34px minmax(0,1fr);
      background:#090f18; border-top:1px solid rgba(184,117,255,.42);
      box-shadow:0 -10px 28px rgba(0,0,0,.22);
    }
    .meshprep-dock.collapsed { grid-template-rows:34px 0; }
    .meshprep-dock-head {
      display:flex; align-items:center; gap:12px; padding:0 12px;
      background:linear-gradient(90deg,rgba(184,117,255,.12),rgba(39,211,255,.035));
      border-bottom:1px solid rgba(184,117,255,.18); color:#d3a7ff;
      font-size:11px; font-weight:800; letter-spacing:.08em; cursor:pointer; user-select:none;
    }
    .meshprep-dock-head .dock-sub { color:#7f96ad; font-weight:600; letter-spacing:0; }
    .meshprep-dock-head .dock-spacer { flex:1; }
    .meshprep-dock-head button { border:0; background:transparent; color:#d3a7ff; cursor:pointer; font:inherit; }
    .meshprep-dock-body {
      min-height:0; overflow:auto; padding:10px 12px 12px;
      display:grid; grid-template-columns:repeat(2,minmax(340px,1fr)); gap:12px; align-items:start;
    }
    .meshprep-dock.collapsed .meshprep-dock-body { display:none; }
    .meshprep-dock .intersection-panel,.meshprep-dock .boundary-panel,.meshprep-dock .boundary-repair-complete {
      margin:0; min-width:0; max-height:none;
    }
    .meshprep-dock .intersection-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:6px; }
    .meshprep-dock .boundary-list { display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:8px; }
    .meshprep-dock .boundary-group+.boundary-group { margin-top:0; }
    .meshprep-dock .boundary-group.open { grid-column:span 1; }
    @media (max-width:900px) {
      html.meshprep-embedded .app { --diag-h:240px; }
      .meshprep-dock-body { grid-template-columns:1fr; }
    }
  `;
  document.head.appendChild(style);

  const installDock = () => {
    const app = document.querySelector('.app');
    const viewport = document.querySelector('.viewport');
    if (!app || !viewport || document.querySelector('.meshprep-dock')) return;

    const dock = document.createElement('section');
    dock.className = 'meshprep-dock';
    dock.innerHTML = `<div class="meshprep-dock-head"><span>DIAGNOSTICS</span><span class="dock-sub">Shell intersections · boundaries · repair evidence</span><span class="dock-spacer"></span><button type="button" aria-label="Collapse diagnostics">▼</button></div><div class="meshprep-dock-body"></div>`;
    app.insertBefore(dock, document.querySelector('.md-footer'));

    const body = dock.querySelector('.meshprep-dock-body');
    const movePanels = () => {
      for (const id of ['intersectionPanel','boundaryPanel','boundaryRepairComplete']) {
        const panel = document.getElementById(id);
        if (panel && panel.parentElement !== body) body.appendChild(panel);
      }
    };
    movePanels();

    const head = dock.querySelector('.meshprep-dock-head');
    const button = head.querySelector('button');
    head.addEventListener('click', () => {
      const collapsed = dock.classList.toggle('collapsed');
      document.querySelector('.app')?.style.setProperty('--diag-h', collapsed ? '34px' : '286px');
      button.textContent = collapsed ? '▲' : '▼';
      button.setAttribute('aria-label', collapsed ? 'Expand diagnostics' : 'Collapse diagnostics');
      window.dispatchEvent(new Event('resize'));
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installDock, { once:true });
  else installDock();
}

export function injectNav(targetSelector = '.md-nav') {
  let nav = document.querySelector(targetSelector);
  if (!nav) {
    nav = document.createElement('nav');
    nav.className = 'md-nav';
    const app = document.querySelector('.app');
    if (app) app.prepend(nav);
    else document.body.prepend(nav);
  }

  const active = detectActiveTool();
  applyEmbeddedMeshPrepLayout(active);

  nav.innerHTML = `
    <a class="md-nav-home" href="index.html" title="Back to MakerDeck">&#x2302;</a>
    <a class="md-nav-brand" href="index.html">Maker<span>Deck</span></a>
    <div class="md-nav-links">
      ${TOOLS.map(t => `<a class="md-nav-link${t.id === active ? ' active' : ''}" href="${t.href}">${t.label}</a>`).join('')}
    </div>
    <div class="md-nav-spacer"></div>
    <span class="md-nav-build">${BUILD}</span>
  `;
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => injectNav());
} else {
  injectNav();
}
