const $ = (id) => document.getElementById(id);

let folders = [];
let collections = [];
let filaments = [];
let scanIssues = [];
let editingCollectionId = null;
let selectedId = null;
let activeKind = "";
let activeKindsCsv = "";
let libraryItems = [];
let selectedIds = new Set();
/** Last file selected without Shift — used as the start of a Shift range. */
let lastSelectAnchorId = null;
let browseMode = "all"; // folders | all
let browseRootId = null;
let browseFolder = "";
const PAGE_SIZE = 200;
let libraryTotal = 0;
let libraryHasMore = false;
let libraryView = "designs"; // designs | assets (assets used for duplicates / folders)
let ignoreGlobs = [];
let scanWatchTimer = null;
let activeDesignId = null;
let designAssetsCache = [];
let scanWatchTicks = 0;
let lastScanRunning = false;
let lastThumbsRunning = false;
let statusPollTimer = null;
let psModalResolver = null;

const TYPE_PRESETS = [
  {
    title: "Kinds",
    items: [
      { id: "__all__", label: "All files" },
      { id: "__models__", label: "Models" },
      { id: "__images__", label: "Images" },
      { id: "__documents__", label: "Documents" },
      { id: "__archives__", label: "Archives" },
      { id: "__duplicates__", label: "Duplicates" },
    ],
  },
  {
    title: "Model formats",
    items: [
      { id: "stl", label: "STL" },
      { id: "3mf", label: "3MF" },
      { id: "gcode.3mf", label: "Gcode 3MF" },
      { id: "obj", label: "OBJ" },
      { id: "__step__", label: "STEP" },
      { id: "__fbx__", label: "FBX" },
      { id: "__3dm__", label: "3DM" },
    ],
  },
  {
    title: "Archive formats",
    items: [
      { id: "zip", label: "ZIP" },
      { id: "__tgz__", label: "TGZ" },
      { id: "__targz__", label: "TAR.GZ" },
      { id: "__tar__", label: "TAR" },
      { id: "__rar__", label: "RAR" },
      { id: "__7z__", label: "7Z" },
    ],
  },
];

const IMAGE_KINDS = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"]);

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function thumbUrlFor(item, { cover = false } = {}) {
  const kind = String(cover ? (item.cover_kind || "") : (item.kind || "")).toLowerCase();
  const assetId = Number(cover ? (item.cover_asset_id || 0) : (item.id || 0));
  const version = encodeURIComponent(String((item.content_hash || item.thumb_path || "")).slice(0, 16));
  if (assetId && IMAGE_KINDS.has(kind)) {
    return `/api/assets/${assetId}/image?v=${version}`;
  }
  if (item.thumb_path) {
    return `/api/thumbs/${encodeURIComponent(item.thumb_path)}?v=${version}`;
  }
  return "";
}

/** PrintShelf toast — replaces browser alert(). */
function psToast(title, detail = "", kind = "info", ms = 4200) {
  const host = $("psToasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `ps-toast ${kind === "ok" || kind === "error" ? kind : ""}`.trim();
  el.innerHTML = `
    <div class="ps-toast-mark">PS</div>
    <div class="ps-toast-copy">
      <p class="ps-toast-title">${escapeHtml(title)}</p>
      ${detail ? `<p class="ps-toast-detail">${escapeHtml(detail)}</p>` : ""}
    </div>
    <button type="button" class="ps-toast-close" aria-label="Dismiss">×</button>`;
  const dismiss = () => {
    if (el.classList.contains("leaving")) return;
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 220);
  };
  el.querySelector(".ps-toast-close")?.addEventListener("click", dismiss);
  host.appendChild(el);
  if (ms > 0) setTimeout(dismiss, ms);
}

function closeCardMenus(except = null) {
  document.querySelectorAll(".card-menu.open, .detail-menu.open").forEach((el) => {
    if (except && el === except) return;
    el.classList.remove("open");
  });
}

async function openOnPc(assetId, mode = "open") {
  if (!assetId) {
    psToast("Can't open on PC", "No file selected.", "error");
    return false;
  }
  const label = mode === "reveal" ? "Reveal in Explorer" : "Open on PC";
  psToast(label, "Talking to Windows worker…", "ok", 4000);
  const u = new URL(`/api/assets/${assetId}/open-on-pc`, window.location.origin);
  u.searchParams.set("mode", mode === "reveal" ? "reveal" : "open");
  try {
    const r = await fetch(u.toString(), { method: "POST" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = typeof data.detail === "string" ? data.detail : `${label} failed`;
      psToast(`Couldn't ${mode === "reveal" ? "reveal" : "open"}`, detail, "error", 10000);
      return false;
    }
    psToast(
      mode === "reveal" ? "Revealed in Explorer" : "Opened on PC",
      data.windows_path || data.file_name || "Windows default app",
      "ok",
      6000,
    );
    return true;
  } catch (err) {
    psToast(`Couldn't ${mode === "reveal" ? "reveal" : "open"}`, String(err.message || err), "error", 8000);
    return false;
  }
}

function mountActionMenu(host, items) {
  if (!host) return;
  const btn = host.querySelector(".card-menu-btn, .detail-menu-btn");
  const panel = host.querySelector(".card-menu-panel, .detail-menu-panel");
  if (!btn || !panel) return;
  panel.innerHTML = items.map((it) => `
    <button type="button" class="card-menu-item${it.danger ? " danger" : ""}" data-menu-action="${escapeHtml(it.id)}"
      ${it.disabled ? "disabled" : ""}>${escapeHtml(it.label)}</button>`).join("");
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const willOpen = !host.classList.contains("open");
    closeCardMenus();
    if (willOpen) host.classList.add("open");
  };
  panel.onclick = (e) => {
    e.stopPropagation();
    const target = e.target.closest("[data-menu-action]");
    if (!target || target.disabled) return;
    const id = target.dataset.menuAction;
    host.classList.remove("open");
    const item = items.find((x) => x.id === id);
    if (item?.run) item.run();
  };
}

/** PrintShelf confirm modal — replaces browser confirm(). */
function psConfirm({
  title = "Confirm",
  body = "",
  eyebrow = "Confirm",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  const root = $("psModalRoot");
  if (!root) {
    const plain = `${title}\n\n${String(body).replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")}`;
    return Promise.resolve(window.confirm(plain));
  }
  if (psModalResolver) {
    psModalResolver(false);
    psModalResolver = null;
  }
  $("psModalEyebrow").textContent = eyebrow;
  $("psModalTitle").textContent = title;
  $("psModalBody").innerHTML = body;
  const confirmBtn = $("psModalConfirm");
  const cancelBtn = $("psModalCancel");
  const altBtn = $("psModalAlt");
  confirmBtn.hidden = false;
  if (altBtn) altBtn.hidden = true;
  confirmBtn.textContent = confirmLabel;
  cancelBtn.textContent = cancelLabel;
  confirmBtn.classList.toggle("danger", !!danger);
  confirmBtn.classList.toggle("card-open", true);
  confirmBtn.onclick = () => closePsModal(true);
  cancelBtn.onclick = () => closePsModal(false);
  root.hidden = false;
  confirmBtn.focus();
  return new Promise((resolve) => {
    psModalResolver = (value) => {
      root.hidden = true;
      psModalResolver = null;
      resolve(value);
    };
  });
}

/** Choice modal — returns the selected option value, or null if cancelled. */
function psChoice({
  title = "Choose",
  body = "",
  eyebrow = "Choose",
  options = [],
  cancelLabel = "Cancel",
} = {}) {
  const root = $("psModalRoot");
  if (!root || !options.length) return Promise.resolve(null);
  if (psModalResolver) {
    psModalResolver(null);
    psModalResolver = null;
  }
  $("psModalEyebrow").textContent = eyebrow;
  $("psModalTitle").textContent = title;
  const list = options.map((opt) => {
    const last = opt.last ? " is-last" : "";
    return `<li><button type="button" class="ps-choice-opt${last}" data-ps-choice="${escapeHtml(opt.value)}">
      <strong>${escapeHtml(opt.label)}</strong>
      ${opt.detail ? `<span>${escapeHtml(opt.detail)}</span>` : ""}
    </button></li>`;
  }).join("");
  $("psModalBody").innerHTML = `${body ? `<p style="margin:0 0 12px">${body}</p>` : ""}
    <ul class="ps-slicer-choice">${list}</ul>`;
  const confirmBtn = $("psModalConfirm");
  const cancelBtn = $("psModalCancel");
  const altBtn = $("psModalAlt");
  confirmBtn.hidden = true;
  if (altBtn) altBtn.hidden = true;
  cancelBtn.textContent = cancelLabel;
  cancelBtn.onclick = () => closePsModal(null);
  root.hidden = false;
  cancelBtn.focus();
  const onClick = (ev) => {
    const btn = ev.target.closest("[data-ps-choice]");
    if (!btn || !root.contains(btn)) return;
    closePsModal(btn.getAttribute("data-ps-choice"));
  };
  root.addEventListener("click", onClick);
  return new Promise((resolve) => {
    psModalResolver = (value) => {
      root.removeEventListener("click", onClick);
      root.hidden = true;
      confirmBtn.hidden = false;
      psModalResolver = null;
      resolve(value);
    };
  });
}

function closePsModal(value) {
  if (psModalResolver) psModalResolver(value);
}

const SLICER_TARGET_KEY = "printshelf.slicerTarget.v1";
const PRINT_PRINTER_KEY = "printshelf.printPrinter.v1";
const WATCHED_FOLDERS_COLLAPSED_KEY = "meshfinder.settings.watchedFoldersCollapsed.v1";

function slicerTargetLabel(target) {
  return target === "desktop_orca" ? "OrcaSlicer" : "Bambu Studio";
}

function setWatchedFoldersCollapsed(collapsed) {
  const body = $("watchedFoldersBody");
  const btn = $("watchedFoldersToggle");
  if (body) body.classList.toggle("settings-collapsed", !!collapsed);
  if (btn) btn.textContent = collapsed ? "Expand" : "Collapse";
  try {
    localStorage.setItem(WATCHED_FOLDERS_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch (_) {}
}

function isPrintableName(name) {
  const lower = String(name || "").toLowerCase();
  return (
    lower.endsWith(".gcode.3mf")
    || lower.endsWith(".3mf")
    || lower.endsWith(".gcode")
    || lower.endsWith(".gco")
    || lower.endsWith(".gcode.gz")
    || lower.endsWith(".ufp")
  );
}

function isReadyToQueue(item, zipEntry = "") {
  const kind = item?.kind || "";
  if (kind === "gcode" || kind === "gcode.3mf" || kind === "3mf") return true;
  if (kind === "zip" && zipEntry && isPrintableName(zipEntry)) {
    const lower = String(zipEntry).toLowerCase();
    // Mesh-only zip entries still need slicing.
    if (lower.endsWith(".stl") || lower.endsWith(".obj")) return false;
    return true;
  }
  return false;
}

function needsSlicerFirst(item, zipEntry = "") {
  const kind = item?.kind || "";
  if (kind === "stl" || kind === "obj") return true;
  if (kind === "zip" && zipEntry) {
    const lower = String(zipEntry).toLowerCase();
    return lower.endsWith(".stl") || lower.endsWith(".obj");
  }
  return false;
}

function printDisabledReason(item, zipEntry = "") {
  if (isMobileClient()) return "Use on PC / Tailscale desktop";
  if (isReadyToQueue(item, zipEntry) || needsSlicerFirst(item, zipEntry)) return "";
  if (item?.kind === "zip" && !zipEntry) return "Pick a printable inside the ZIP first";
  return "Not a printable file";
}

async function pickPrinter(item = null) {
  let printers = [];
  try {
    const data = await api("/api/printers");
    printers = data.printers || [];
  } catch (err) {
    psToast("Can't reach Flightdeck", String(err.message || err), "error", 8000);
    return null;
  }
  if (!printers.length) {
    psToast("No printers", "Flightdeck has no queueable printers right now.", "error");
    return null;
  }
  const last = localStorage.getItem(PRINT_PRINTER_KEY) || "";
  const hint = item?.suggested_printer || null;
  const scored = scorePrintersForAsset(printers, item);
  const choice = await psChoice({
    eyebrow: "Print this",
    title: "Which printer?",
    body: hint?.label
      ? `File looks aimed at <strong>${escapeHtml(hint.label)}</strong> — still your call. Auto-sends when free.`
      : "Queues on Flightdeck and auto-sends when that printer is free.",
    options: scored.map((p) => ({
      value: p.id,
      label: p.name,
      detail: [
        p.kind,
        p.state,
        p.score > 0 ? "suggested" : "",
        p.id === last ? "last used" : "",
      ].filter(Boolean).join(" · "),
      last: p.score > 0 || p.id === last,
    })),
  });
  if (!choice) return null;
  localStorage.setItem(PRINT_PRINTER_KEY, choice);
  return choice;
}

function scorePrintersForAsset(printers, item) {
  const hint = item?.suggested_printer || {};
  const tokens = [];
  for (const raw of [hint.printer_model, hint.folder_hint, hint.label]) {
    const t = String(raw || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (t) tokens.push(t);
  }
  const path = String(item?.rel_path || item?.abs_path || "").toLowerCase();
  for (const part of path.split(/[/\\]/)) {
    const t = part.replace(/[^a-z0-9]+/g, "");
    if (/^(h2[cd]|x1[ce]|p1[sp]|a1mini|a1|voron)/.test(t)) tokens.push(t);
  }
  const uniq = [...new Set(tokens)];
  return [...printers]
    .map((p) => {
      const blob = `${p.id}${p.name}${p.model}`.toLowerCase().replace(/[^a-z0-9]+/g, "");
      let score = 0;
      for (const t of uniq) {
        if (!t) continue;
        if (blob.includes(t) || t.includes(String(p.id || "").toLowerCase())) score += 10;
        if (String(p.model || "").toLowerCase().replace(/[^a-z0-9]+/g, "") === t) score += 20;
        if (String(p.id || "").toLowerCase() === t) score += 30;
      }
      return { ...p, score };
    })
    .sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
}

async function printThis(item, { zipEntry = "" } = {}) {
  const reason = printDisabledReason(item, zipEntry);
  if (reason) {
    psToast("Can't print this", reason, "error");
    return false;
  }

  // Printers can't eat raw STL/OBJ — open slicer, then Print this again on the sliced file.
  if (needsSlicerFirst(item, zipEntry)) {
    const go = await psConfirm({
      eyebrow: "Slice first",
      title: "This file isn’t sliced yet",
      body: "Printers need a <strong>.3mf / .gcode.3mf / .gcode</strong>. Open it in Bambu/Orca, slice, save, then hit <strong>Print this</strong> on the sliced file (or the NAS copy).",
      confirmLabel: "Open in slicer",
      cancelLabel: "Cancel",
      danger: false,
    });
    if (!go) return false;
    return openInSlicer(item, { zipEntry });
  }

  const printerId = await pickPrinter(item);
  if (!printerId) return false;

  const u = new URL(`/api/assets/${item.id}/print`, window.location.origin);
  u.searchParams.set("printer_id", printerId);
  if (item.kind === "zip" && zipEntry) u.searchParams.set("entry", zipEntry);

  psToast("Queuing on Flightdeck", "Uploading to the print queue…", "ok", 4000);
  let data = {};
  try {
    const r = await fetch(u.toString(), { method: "POST" });
    data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = typeof data.detail === "string" ? data.detail : "Queue upload failed";
      psToast("Couldn't queue print", detail, "error", 10000);
      return false;
    }
  } catch (err) {
    psToast("Couldn't queue print", String(err.message || err), "error", 8000);
    return false;
  }

  const printer = data.printer_name || printerId;
  const job = data.job_id != null ? ` · job #${data.job_id}` : "";
  const warn = data.is_sliced === false
    ? " · project 3MF — check plates/filament in Flightdeck"
    : "";
  psToast(
    `Queued on ${printer}`,
    `${data.filename || item.file_name}${job}${warn} · Flightdeck → Queue`,
    "ok",
    9000,
  );
  return true;
}

function manifoldToastDetail(manifold, fallback = "") {
  if (!manifold || manifold.skipped) return fallback;
  const before = Number(manifold.before) || 0;
  const after = Number(manifold.after) || 0;
  if (before === 0) return fallback ? `${fallback} · Manifold OK` : "Manifold OK";
  if (manifold.repaired) {
    const line = after === 0
      ? `Repaired ${before} → 0 open edges`
      : `Repaired ${before} → ${after} left`;
    return fallback ? `${fallback} · ${line}` : line;
  }
  // Checked but not improved (e.g. Luban chops with intentional open edges).
  const line = `${before} open edges (unchanged)`;
  return fallback ? `${fallback} · ${line}` : line;
}

async function pickSlicerTarget() {
  const last = localStorage.getItem(SLICER_TARGET_KEY) || "bambu_studio";
  const choice = await psChoice({
    eyebrow: "Open in slicer",
    title: "Which slicer?",
    body: "Same handoff as Flightdeck — opens the real file on your Windows PC.",
    options: [
      {
        value: "bambu_studio",
        label: "Bambu Studio",
        detail: "Desktop Bambu Studio on your PC",
        last: last === "bambu_studio",
      },
      {
        value: "desktop_orca",
        label: "OrcaSlicer",
        detail: "Desktop Orca on your PC",
        last: last === "desktop_orca",
      },
    ],
  });
  if (!choice) return null;
  localStorage.setItem(SLICER_TARGET_KEY, choice);
  return choice;
}

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

function fmtBytes(n) {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function fileCountLabel(n) {
  const count = Number(n) || 0;
  return count === 1 ? "1 file" : `${count} files`;
}

function idsForAction(fallbackId) {
  /** Prefer multi-select; otherwise the open detail asset. */
  if (selectedIds.size > 0) return [...selectedIds];
  if (fallbackId != null) return [Number(fallbackId)];
  return [];
}

async function hideIds(ids) {
  if (!ids.length) return;
  const isDesignView = libraryView === "designs";
  let result = null;
  if (ids.length === 1) {
    result = await api(
      isDesignView ? `/api/designs/${ids[0]}/hide` : `/api/assets/${ids[0]}/hide`,
      { method: "POST", body: "{}" },
    );
  } else {
    result = await api(
      isDesignView ? "/api/designs/hide-bulk" : "/api/assets/bulk/hide",
      { method: "POST", body: JSON.stringify({ ids }) },
    );
  }
  if (result && Number(result.updated || 0) <= 0) {
    throw new Error("No files were updated by Hide.");
  }
  clearSelection();
  selectedId = null;
  window.PrintShelfViewer?.unmountOrbitViewer?.();
  $("detail").innerHTML = `<div class="detail-empty">Hidden ${fileCountLabel(ids.length)} from library. Use “Show hidden” to find ${ids.length === 1 ? "it" : "them"} again.</div>`;
  await refreshStats();
  await loadLibrary();
}

async function unhideIds(ids) {
  if (!ids.length) return;
  const isDesignView = libraryView === "designs";
  let result = null;
  if (ids.length === 1) {
    result = await api(
      isDesignView ? `/api/designs/${ids[0]}/unhide` : `/api/assets/${ids[0]}/unhide`,
      { method: "POST", body: "{}" },
    );
  } else {
    result = await api(
      isDesignView ? "/api/designs/unhide-bulk" : "/api/assets/bulk/unhide",
      { method: "POST", body: JSON.stringify({ ids }) },
    );
  }
  if (result && Number(result.updated || 0) <= 0) {
    throw new Error("No files were updated by Unhide.");
  }
  clearSelection();
  await refreshStats();
  await loadLibrary();
}

async function deleteIdsFromDisk(ids, { names = [] } = {}) {
  if (!ids.length) return;
  const label = fileCountLabel(ids.length);
  const sample = names.filter(Boolean).slice(0, 8);
  const more = ids.length > sample.length
    ? `<br>…and ${ids.length - sample.length} more`
    : "";
  const listBit = sample.length
    ? `<br><br><strong>${sample.map(escapeHtml).join("<br>")}</strong>${more}`
    : `<br><br>${escapeHtml(label)} will be removed from the NAS/disk and the library.`;

  // Check for identical byte-copies elsewhere in the library (common with Thingiverse dumps).
  let copyExtra = 0;
  let copyPaths = [];
  try {
    const seen = new Set(ids.map(Number));
    for (const id of ids.slice(0, 20)) {
      const data = await api(`/api/assets/${id}/copies`);
      for (const c of data.copies || []) {
        if (seen.has(Number(c.id))) continue;
        seen.add(Number(c.id));
        copyExtra += 1;
        if (copyPaths.length < 6) copyPaths.push(c.rel_path || c.file_name || String(c.id));
      }
    }
  } catch (err) {
    console.warn("copies lookup failed", err);
  }

  const copyBit = copyExtra
    ? `<br><br><strong>${copyExtra} identical cop${copyExtra === 1 ? "y" : "ies"}</strong> still exist in other folders`
      + (copyPaths.length ? `:<br>${copyPaths.map(escapeHtml).join("<br>")}` : ".")
      + `<br>Deleting only the selected file leaves those copies for the next scan.`
    : "";

  const ok = await psConfirm({
    eyebrow: "Destructive action",
    title: `Delete ${label} from disk?`,
    body: `This permanently removes the file${ids.length === 1 ? "" : "s"} from disk and the library.${listBit}${copyBit}<br><br>This cannot be undone.`,
    confirmLabel: "Delete permanently",
    danger: true,
  });
  if (!ok) return false;

  let deleteDuplicates = false;
  if (copyExtra) {
    deleteDuplicates = await psConfirm({
      eyebrow: "Identical copies found",
      title: `Also delete ${copyExtra} identical cop${copyExtra === 1 ? "y" : "ies"}?`,
      body: `Same file bytes live in other folders. Choose <strong>Delete all copies</strong> to remove every matching copy from disk, or cancel this step to delete only your selection.`,
      confirmLabel: "Delete all copies",
      danger: true,
    });
  } else {
    const ok2 = await psConfirm({
      eyebrow: "Last check",
      title: "Delete for real?",
      body: `Confirm once more: permanently delete <strong>${escapeHtml(label)}</strong> from disk.`,
      confirmLabel: "Yes, delete",
      danger: true,
    });
    if (!ok2) return false;
  }

  const q = deleteDuplicates ? "?delete_duplicates=true" : "";
  let deletedCount = 0;
  let failed = [];
  let leftover = 0;
  if (ids.length === 1) {
    const res = await api(`/api/assets/${ids[0]}/delete${q}`, { method: "POST", body: "{}" });
    deletedCount = res.deleted_count || 1;
    leftover = res.other_copies_count || 0;
  } else {
    const res = await api(`/api/assets/bulk/delete${q}`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    deletedCount = res.deleted_count || 0;
    failed = res.failed || [];
    leftover = res.other_copies_count || 0;
  }
  clearSelection();
  selectedId = null;
  window.PrintShelfViewer?.unmountOrbitViewer?.();
  await refreshStats();
  // Prefer live stats after delete — bulk leftover mid-batch was misleading.
  let stillDup = 0;
  try {
    const s = await api("/api/stats");
    stillDup = Number(s.duplicates || 0);
  } catch {
    stillDup = leftover;
  }
  $("detail").innerHTML = `<div class="detail-empty">Deleted ${fileCountLabel(deletedCount)} from disk${failed.length ? ` · ${failed.length} failed` : ""}${stillDup ? ` · ${stillDup} duplicate files still in library` : ""}.</div>`;
  if (failed.length) {
    psToast(
      `Deleted ${deletedCount}, ${failed.length} failed`,
      failed.slice(0, 8).map((f) => `${f.id}: ${f.error}`).join("\n"),
      "error",
      8000,
    );
  } else if (stillDup) {
    psToast(
      "Deleted — some duplicates remain",
      `${stillDup} duplicate file(s) still in the library. Open the Duplicates tab to finish.`,
      "error",
      7000,
    );
  } else {
    psToast("Deleted from disk", `${fileCountLabel(deletedCount)} · no duplicates left`, "ok");
  }
  await loadLibrary();
  return true;
}

function switchView(name) {
  document.querySelectorAll(".view").forEach((el) => el.classList.toggle("hidden", el.id !== `view-${name}`));
  document.querySelectorAll(".nav-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === name));
}

function updateTypeTabCounts(byKind, total, duplicates = 0) {
  document.querySelectorAll(".type-count").forEach((el) => {
    const key = el.dataset.countFor || "";
    if (key === "__duplicates__") {
      el.textContent = String(duplicates || 0);
      return;
    }
    el.textContent = String(key ? (byKind[key] || 0) : (total || 0));
  });
  const dupTab = document.querySelector('.type-tab[data-kind="__duplicates__"]');
  if (dupTab) {
    const n = Number(duplicates || 0);
    dupTab.hidden = n <= 0;
    if (n <= 0 && activeKind === "__duplicates__") {
      setActiveKind("");
    }
  }
}

function updateScanBanner(scan, byKind, totalAssets) {
  const banner = $("scanBanner");
  if (!banner) return;
  const running = !!(scan && scan.running);
  banner.hidden = !running;
  if (!running) return;
  const where = scan.current_path ? scan.current_path : "walking folders…";
  $("scanBannerTitle").textContent = "Scanning library…";
  $("scanBannerDetail").textContent =
    `${scan.files_seen || 0} seen · ${scan.files_upserted || 0} new · ${scan.files_skipped || 0} unchanged`
    + (scan.files_failed ? ` · ${scan.files_failed} failed` : "")
    + ` · ${where}`;
  const order = ["zip", "stl", "obj", "3mf", "gcode.3mf", "gcode"];
  const parts = order
    .filter((k) => byKind[k] != null)
    .map((k) => `<span class="pill">${escapeHtml(k)} ${byKind[k]}</span>`);
  if (totalAssets != null) {
    parts.unshift(`<span class="pill">all ${totalAssets}</span>`);
  }
  $("scanBannerKinds").innerHTML = parts.join("");
}

function formatStatusLine(scan, thumbs) {
  const bits = [];
  if (scan?.running) {
    const where = scan.current_path ? ` · ${scan.current_path}` : "";
    bits.push(
      `Scanning… ${scan.files_seen || 0} seen / ${scan.files_upserted || 0} new / ${scan.files_skipped || 0} unchanged${where}`,
    );
  }
  if (thumbs?.running) {
    bits.push(`Thumbs… ${thumbs.updated || 0}/${thumbs.checked || 0}`);
  }
  if (bits.length) return bits.join(" · ");
  if (thumbs?.status === "ok" && thumbs.updated) {
    return `Thumbs rebuilt: ${thumbs.updated}`
      + (scan?.status === "ok"
        ? ` · Last scan: ${scan.files_upserted || 0} new / ${scan.files_seen || 0} total`
        : "");
  }
  const skipN = Array.isArray(scan?.skipped_roots) ? scan.skipped_roots.length : 0;
  const skipBit = skipN
    ? ` · ${skipN} share${skipN === 1 ? "" : "s"} unmounted (library kept)`
    : "";
  if (scan?.status === "ok" || (scan?.status === "error" && skipN && !(scan.files_seen > 0))) {
    if (scan?.status === "error" && skipN && !(scan.files_seen > 0)) {
      return (scan.error || "Mounts not ready — remount shares, then Rescan") + skipBit;
    }
    return `Last scan: ${scan.files_upserted || 0} new · ${scan.files_skipped || 0} unchanged · ${scan.files_seen || 0} total`
      + (scan.files_failed ? ` · ${scan.files_failed} failed` : "")
      + skipBit;
  }
  if (scan?.error) return String(scan.error);
  return scan?.status || thumbs?.status || "idle";
}

function ensureStatusWatch(scanRunning, thumbsRunning) {
  const need = !!(scanRunning || thumbsRunning);
  if (need && !statusPollTimer) {
    scanWatchTicks = 0;
    statusPollTimer = setInterval(() => {
      watchStatusTick().catch(console.error);
    }, 2000);
  }
  if (!need && statusPollTimer) {
    clearInterval(statusPollTimer);
    statusPollTimer = null;
  }
  // Keep legacy alias in sync for any stray references.
  scanWatchTimer = statusPollTimer;
}

async function refreshLibraryView({ reloadGrid = true, rescan = false } = {}) {
  if (rescan) {
    const root = browseMode === "folders" && browseRootId ? browseRootId : "";
    const q = root ? `?root_id=${encodeURIComponent(root)}` : "";
    try {
      await api(`/api/scan${q}`, { method: "POST", body: "{}" });
      psToast(
        "Scanning for new files…",
        root
          ? `Refreshing ${root === "kidabah-pc" ? "Kidabah PC" : root === "koko-kidabah" ? "NAS" : root} from disk`
          : "Walking watched folders — files stay on screen while it runs",
        "ok",
        6000,
      );
    } catch (err) {
      psToast("Couldn't start scan", String(err.message || err), "error");
    }
  }
  await refreshStats();
  if (reloadGrid) await loadLibrary();
}

async function watchStatusTick() {
  const live = $("scanLiveRefresh");
  const s = await api("/api/stats");
  const scan = s.scan || {};
  const thumbs = s.thumbs || {};
  const byKind = s.by_kind || {};
  const kinds = Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(" · ") || "no files yet";
  const dupBit = s.duplicates ? `<br><span class="pill warn">duplicates ${s.duplicates}</span>` : "";
  const hiddenBit = s.hidden ? `<br><span class="pill">hidden ${s.hidden}</span>` : "";
  const collBit = s.collections ? `<br><span class="pill">collections ${s.collections}</span>` : "";
  const filamentBit = s.filaments ? `<br><span class="pill">filaments ${s.filaments}</span>` : "";
  const issueBit = s.scan_issues ? `<br><span class="pill warn">scan issues ${s.scan_issues}</span>` : "";
  $("railStats").innerHTML = `<strong>${s.designs ?? "—"}</strong> designs · <strong>${s.assets}</strong> files<br>${kinds}${dupBit}${hiddenBit}${collBit}${filamentBit}${issueBit}`;
  updateScanIssuesBadge(s.scan_issues || 0);
  updateTypeTabCounts(byKind, s.assets || 0, s.duplicates || 0);
  updateScanBanner(scan, byKind, s.assets || 0);
  $("scanStatus").textContent = formatStatusLine(scan, thumbs);

  scanWatchTicks += 1;
  // Reload the grid every ~10s while a scan is live (not during thumbs-only).
  if (live?.checked && scan.running && scanWatchTicks % 5 === 0) {
    await loadLibrary({ preserveScroll: true });
  }

  const scanWas = lastScanRunning;
  const thumbsWas = lastThumbsRunning;
  lastScanRunning = !!scan.running;
  lastThumbsRunning = !!thumbs.running;

  if (!scan.running && !thumbs.running) {
    ensureStatusWatch(false, false);
    $("scanBtn").disabled = false;
    $("rebuildThumbsBtn").disabled = false;
    if (scanWas || thumbsWas) {
      await loadLibrary({ preserveScroll: true });
    }
  } else {
    ensureStatusWatch(!!scan.running, !!thumbs.running);
  }
}

async function refreshStats() {
  const s = await api("/api/stats");
  const byKind = s.by_kind || {};
  const kinds = Object.entries(byKind).map(([k, v]) => `${k}: ${v}`).join(" · ") || "no files yet";
  const dupBit = s.duplicates ? `<br><span class="pill warn">duplicates ${s.duplicates}</span>` : "";
  const hiddenBit = s.hidden ? `<br><span class="pill">hidden ${s.hidden}</span>` : "";
  const collBit = s.collections ? `<br><span class="pill">collections ${s.collections}</span>` : "";
  const filamentBit = s.filaments ? `<br><span class="pill">filaments ${s.filaments}</span>` : "";
  const issueBit = s.scan_issues ? `<br><span class="pill warn">scan issues ${s.scan_issues}</span>` : "";
  $("railStats").innerHTML = `<strong>${s.designs ?? "—"}</strong> designs · <strong>${s.assets}</strong> files<br>${kinds}${dupBit}${hiddenBit}${collBit}${filamentBit}${issueBit}`;
  updateScanIssuesBadge(s.scan_issues || 0);
  updateTypeTabCounts(byKind, s.assets || 0, s.duplicates || 0);
  const scan = s.scan || {};
  const thumbs = s.thumbs || {};
  updateScanBanner(scan, byKind, s.assets || 0);
  ensureStatusWatch(!!scan.running, !!thumbs.running);
  lastScanRunning = !!scan.running;
  lastThumbsRunning = !!thumbs.running;
  $("scanStatus").textContent = formatStatusLine(scan, thumbs);
  // If we were on Duplicates and they all cleared, jump back to All and reload.
  if (activeKind === "__duplicates__" && !(s.duplicates > 0)) {
    setActiveKind("");
    await loadLibrary();
  }
}

function setActiveKind(kind) {
  activeKind = kind || "";
  activeKindsCsv = "";
  document.querySelectorAll(".type-tab").forEach((btn) => {
    const on = (btn.dataset.kind || "") === activeKind;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  syncTypeMenuUi();
}

function typePresetLabel() {
  if (activeKind === "__duplicates__") return "Duplicates";
  if (activeKind === "__models__") return "Models";
  if (activeKind === "__images__") return "Images";
  if (activeKind === "__documents__") return "Documents";
  if (activeKind === "__archives__") return "Archives";
  if (activeKind === "__step__") return "STEP";
  if (activeKind === "__fbx__") return "FBX";
  if (activeKind === "__3dm__") return "3DM";
  if (activeKind === "__tgz__") return "TGZ";
  if (activeKind === "__targz__") return "TAR.GZ";
  if (activeKind === "__tar__") return "TAR";
  if (activeKind === "__rar__") return "RAR";
  if (activeKind === "__7z__") return "7Z";
  if (activeKind && !activeKindsCsv) return activeKind.toUpperCase();
  if (activeKindsCsv) {
    const ks = activeKindsCsv.split(",").map((s) => s.trim()).filter(Boolean);
    if (ks.length === 1) return ks[0].toUpperCase();
    return `${ks.length} formats`;
  }
  return "More types";
}

function syncTypeMenuUi() {
  const btn = $("typeMenuBtn");
  const panel = $("typeMenuPanel");
  const wrap = $("typeMenuWrap");
  if (btn) btn.textContent = `${typePresetLabel()} ▾`;
  const key = activeKind || "__all__";
  panel?.querySelectorAll(".type-menu-item").forEach((el) => {
    el.classList.toggle("active", el.getAttribute("data-type-id") === key);
  });
  const open = !!(wrap && wrap.classList.contains("open"));
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (panel) panel.hidden = !open;
}

function closeTypeMenu() {
  const wrap = $("typeMenuWrap");
  if (!wrap) return;
  wrap.classList.remove("open");
  syncTypeMenuUi();
}

function renderTypeMenu() {
  const panel = $("typeMenuPanel");
  if (!panel) return;
  panel.innerHTML = `
    <div class="type-menu-grid">
      ${TYPE_PRESETS.map((group) => `
        <div class="type-menu-col">
          <h4>${escapeHtml(group.title)}</h4>
          ${group.items.map((item) => {
            return `<button type="button" class="type-menu-item" data-type-id="${escapeHtml(item.id)}">${escapeHtml(item.label)}</button>`;
          }).join("")}
        </div>`).join("")}
    </div>`;
  panel.querySelectorAll(".type-menu-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-type-id") || "__all__";
      if (id === "__all__") {
        setActiveKind("");
      } else if (id === "__models__") {
        activeKind = "__models__";
        activeKindsCsv = "stl,obj,3mf,gcode.3mf";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__images__") {
        activeKind = "__images__";
        activeKindsCsv = "jpg,jpeg,png,gif,webp,bmp,svg";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__documents__") {
        activeKind = "__documents__";
        activeKindsCsv = "pdf,txt,md";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__archives__") {
        activeKind = "__archives__";
        activeKindsCsv = "zip,rar,7z,tar,tgz,tar.gz";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__step__") {
        activeKind = "__step__";
        activeKindsCsv = "step,stp";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__fbx__") {
        activeKind = "__fbx__";
        activeKindsCsv = "fbx";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__3dm__") {
        activeKind = "__3dm__";
        activeKindsCsv = "3dm";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__tgz__") {
        activeKind = "__tgz__";
        activeKindsCsv = "tgz";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__targz__") {
        activeKind = "__targz__";
        activeKindsCsv = "tar.gz";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__tar__") {
        activeKind = "__tar__";
        activeKindsCsv = "tar";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__rar__") {
        activeKind = "__rar__";
        activeKindsCsv = "rar";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__7z__") {
        activeKind = "__7z__";
        activeKindsCsv = "7z";
        document.querySelectorAll(".type-tab").forEach((x) => {
          x.classList.toggle("active", false);
          x.setAttribute("aria-selected", "false");
        });
      } else if (id === "__duplicates__") {
        setActiveKind("__duplicates__");
      } else {
        setActiveKind(id);
      }
      if (activeKind === "__duplicates__") {
        browseMode = "all";
        document.querySelectorAll(".view-mode").forEach((b) => {
          b.classList.toggle("active", b.dataset.mode === "all");
        });
      }
      clearSelection();
      closeTypeMenu();
      loadLibrary().catch(console.error);
      syncTypeMenuUi();
    });
  });
  syncTypeMenuUi();
}

function updateBulkBar() {
  const bar = $("bulkBar");
  if (!bar) return;
  const n = selectedIds.size;
  // File cards (Folders / Duplicates) support multi-select — keep the bar visible
  // so Select all isn't hidden until something is already checked.
  const selectable = libraryItems.length > 0 && (
    browseMode === "folders"
    || activeKind === "__duplicates__"
    || libraryView === "assets"
  );
  bar.hidden = !selectable;
  if ($("bulkCount")) $("bulkCount").textContent = n ? `${n} selected` : "Select files";
  bar.classList.toggle("bulk-bar--idle", n === 0);
  for (const id of ["bulkHideBtn", "bulkUnhideBtn", "bulkAddCollectionBtn", "bulkDeleteBtn", "bulkClearBtn"]) {
    const btn = $(id);
    if (btn) btn.disabled = n === 0;
  }
}

function syncSelectionUi() {
  document.querySelectorAll(".card:not(.folder-card)").forEach((card) => {
    const id = Number(card.dataset.id);
    const on = selectedIds.has(id);
    card.classList.toggle("selected", on);
    const cb = card.querySelector(".card-check");
    if (cb) cb.checked = on;
  });
  updateBulkBar();
}

function libraryIndexOf(id) {
  const num = Number(id);
  return libraryItems.findIndex((x) => Number(x.id) === num);
}

function toggleSelected(id, on, { setAnchor = true } = {}) {
  const num = Number(id);
  if (on) selectedIds.add(num);
  else selectedIds.delete(num);
  const card = document.querySelector(`.card[data-id="${num}"]`);
  if (card) {
    card.classList.toggle("selected", on);
    const cb = card.querySelector(".card-check");
    if (cb) cb.checked = on;
  }
  if (setAnchor) lastSelectAnchorId = num;
  updateBulkBar();
}

/** Select every visible file from anchor → target (inclusive). Shift alone replaces; Ctrl/Cmd+Shift adds. */
function selectRangeInclusive(fromId, toId, { additive = false } = {}) {
  const a = libraryIndexOf(fromId);
  const b = libraryIndexOf(toId);
  if (a < 0 || b < 0) {
    toggleSelected(toId, true);
    return;
  }
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (!additive) selectedIds.clear();
  for (let i = lo; i <= hi; i++) {
    selectedIds.add(Number(libraryItems[i].id));
  }
  // Keep the original anchor so further Shift-clicks extend from the same top/start.
  if (lastSelectAnchorId == null) lastSelectAnchorId = Number(fromId);
  syncSelectionUi();
}

function clearSelection() {
  selectedIds.clear();
  lastSelectAnchorId = null;
  document.querySelectorAll(".card.selected").forEach((c) => c.classList.remove("selected"));
  document.querySelectorAll(".card-check").forEach((cb) => { cb.checked = false; });
  updateBulkBar();
}

function filterParams() {
  const params = new URLSearchParams();
  const q = $("search").value.trim();
  if (q) params.set("q", q);
  if (activeKind === "__duplicates__") {
    params.set("duplicates", "true");
  } else if (activeKindsCsv) {
    params.set("kinds", activeKindsCsv);
  } else if (activeKind) {
    params.set("kind", activeKind);
  }
  const source = $("filterSource").value;
  if (source) params.set("source_kind", source);
  const root = $("filterRoot")?.value;
  if (root) params.set("root_id", root);
  const filament = $("filterFilament")?.value;
  if (filament) params.set("filament_id", filament);
  const collectionId = $("filterCollection")?.value;
  if (collectionId) params.set("collection_id", collectionId);
  const sort = $("sortBy")?.value;
  if (sort && sort !== "seen") params.set("sort", sort);
  else if (sort) params.set("sort", "seen");
  if ($("filterTextures").checked) params.set("has_textures", "true");
  if ($("filterSliced").checked) params.set("is_sliced", "true");
  if ($("filterHidden")?.checked) params.set("hidden", "true");
  else params.set("hidden", "false");
  return params;
}

function parseTagsInput(raw) {
  return String(raw || "")
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function fillCollectionFilter() {
  const sel = $("filterCollection");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">All collections</option>`
    + collections.map((c) => {
      const id = String(c.id);
      const n = Number(c.asset_count || 0);
      return `<option value="${escapeHtml(id)}">${escapeHtml(c.name || `Collection ${id}`)} (${n})</option>`;
    }).join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function filamentLabel(f) {
  if (!f) return "";
  const bits = [
    String(f.brand || "").trim(),
    String(f.material || "").trim(),
    String(f.name || "").trim(),
  ].filter(Boolean);
  return bits.join(" · ") || `Filament ${f.id ?? ""}`.trim();
}

function fillFilamentFilter() {
  const sel = $("filterFilament");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">All filaments</option>`
    + filaments.map((f) => {
      const id = String(f.id);
      return `<option value="${escapeHtml(id)}">${escapeHtml(filamentLabel(f))}</option>`;
    }).join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function fillRootFilter() {
  const sel = $("filterRoot");
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = `<option value="">All folders</option>`
    + folders.map((f) => {
      const id = escapeHtml(f.id || "");
      const label = escapeHtml(f.label || f.id || "folder");
      return `<option value="${id}">${label}</option>`;
    }).join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function renderCrumbs(crumbs) {
  const el = $("crumbs");
  if (!el) return;
  if (browseMode !== "folders" || !crumbs?.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;
  el.innerHTML = crumbs.map((c, i) => {
    const btn = `<button type="button" class="crumb" data-root="${escapeHtml(c.root_id || "")}" data-folder="${escapeHtml(c.folder || "")}">${escapeHtml(c.label)}</button>`;
    return i ? `<span class="crumb-sep">/</span>${btn}` : btn;
  }).join("");
  el.querySelectorAll(".crumb").forEach((btn) => {
    btn.addEventListener("click", () => {
      const root = btn.dataset.root || "";
      browseRootId = root || null;
      browseFolder = btn.dataset.folder || "";
      clearSelection();
      loadLibrary().catch(console.error);
    });
  });
}

function appendFolderCard(grid, { title, meta, onOpen }) {
  const card = document.createElement("article");
  card.className = "card folder-card";
  card.innerHTML = `
    <div class="card-thumb"><span class="folder-mark">▣</span></div>
    <div class="card-body">
      <h3 class="card-title">${escapeHtml(title)}</h3>
      <div class="card-meta">${meta}</div>
    </div>`;
  card.addEventListener("click", onOpen);
  grid.appendChild(card);
}

function appendDesignCard(grid, item) {
  const card = document.createElement("article");
  card.className = "card design-card" + (Number(item.id) === Number(activeDesignId) ? " active" : "");
  card.dataset.designId = String(item.id);
  const kinds = (item.kinds || []).slice(0, 4);
  const n = Number(item.asset_count) || 0;
  const coverId = item.cover_asset_id;
  const isZipCover = (item.cover_kind || kinds[0] || "") === "zip";
  const thumbSrc = thumbUrlFor(item, { cover: true });
  card.innerHTML = `
    <div class="card-menu">
      <button type="button" class="card-menu-btn" aria-label="More actions">⋮</button>
      <div class="card-menu-panel" role="menu"></div>
    </div>
    <div class="card-thumb"><span class="pill thumb-kind">${escapeHtml(item.cover_kind || "design")}</span>${thumbSrc
      ? `<img src="${thumbSrc}" alt="" loading="lazy">`
      : ""}</div>
    <div class="card-body">
      <h3 class="card-title">${escapeHtml(item.name || "Design")}</h3>
      <div class="card-meta">
        <span class="pill">${n} file${n === 1 ? "" : "s"}</span>
        ${kinds.map((k) => `<span class="pill">${escapeHtml(k)}</span>`).join("")}
        ${item.source_kind ? `<span>${escapeHtml(item.source_kind)}</span>` : ""}
        ${item.is_sliced ? "<span>sliced</span>" : ""}
        ${item.has_textures ? "<span>textures</span>" : ""}
        ${(item.tags || []).slice(0, 2).map((t) => `<span class="pill tag">${escapeHtml(t)}</span>`).join("")}
      </div>
    </div>`;
  const img = card.querySelector(".card-thumb img");
  if (img) {
    img.addEventListener("error", () => {
      if (!img.dataset.thumbFallbackTried && item.thumb_path) {
        img.dataset.thumbFallbackTried = "1";
        img.src = `/api/thumbs/${encodeURIComponent(item.thumb_path)}?v=${encodeURIComponent(
          ((item.content_hash || item.thumb_path || "") + "").slice(0, 16)
        )}`;
        return;
      }
      const host = card.querySelector(".card-thumb");
      if (host) host.innerHTML = `<span class="pill">${escapeHtml(item.cover_kind || "design")}</span>`;
    });
  }
  const openInShelf = () => selectDesign(item.id).catch(console.error);
  card.addEventListener("click", (e) => {
    if (e.target.closest(".card-menu")) return;
    openInShelf();
  });
  card.addEventListener("dblclick", (e) => {
    if (e.target.closest(".card-menu")) return;
    e.preventDefault();
    openInShelf();
  });
  const menuItems = [
    { id: "open", label: "Open in PrintShelf", run: openInShelf },
  ];
  if (coverId) {
    menuItems.push(
      {
        id: "pc",
        label: isZipCover ? "Open zip on PC" : "Open on PC",
        run: () => openOnPc(coverId, "open"),
      },
      {
        id: "reveal",
        label: "Reveal in Explorer",
        run: () => openOnPc(coverId, "reveal"),
      },
    );
  }
  mountActionMenu(card.querySelector(".card-menu"), menuItems);
  grid.appendChild(card);
}

async function selectDesign(id) {
  activeDesignId = Number(id);
  document.querySelectorAll(".design-card").forEach((c) => {
    c.classList.toggle("active", Number(c.dataset.designId) === activeDesignId);
  });
  let design;
  try {
    design = await api(`/api/designs/${id}`);
  } catch (err) {
    $("detail").innerHTML = `<p class="detail-hint" style="color:var(--danger)">Failed to load design: ${escapeHtml(String(err.message || err))}</p>`;
    return;
  }
  designAssetsCache = design.assets || [];
  const preferred = design.cover_asset_id
    || designAssetsCache.find((a) => a.kind === "gcode.3mf")?.id
    || designAssetsCache.find((a) => a.kind === "3mf")?.id
    || designAssetsCache[0]?.id;
  if (!preferred) {
    $("detail").innerHTML = `<div class="detail-empty">This design has no visible files.</div>`;
    return;
  }
  await selectAsset(preferred, { design });
}

function appendAssetCard(grid, item) {
  const card = document.createElement("article");
  const checked = selectedIds.has(item.id);
  card.className = "card"
    + (item.id === selectedId ? " active" : "")
    + (checked ? " selected" : "");
  card.dataset.id = String(item.id);
  const thumbSrc = thumbUrlFor(item);
  card.innerHTML = `
    <input type="checkbox" class="card-check" ${checked ? "checked" : ""} aria-label="Select ${escapeHtml(item.file_name)}">
    <div class="card-menu">
      <button type="button" class="card-menu-btn" aria-label="More actions">⋮</button>
      <div class="card-menu-panel" role="menu"></div>
    </div>
    <div class="card-thumb"><span class="pill thumb-kind">${escapeHtml(item.kind)}</span>${thumbSrc
      ? `<img src="${thumbSrc}" alt="" loading="lazy">`
      : ""}</div>
    <div class="card-body">
      <h3 class="card-title">${escapeHtml(item.file_name)}</h3>
      <div class="card-meta">
        <span class="pill">${escapeHtml(item.kind)}</span>
        <span>${escapeHtml(item.source_kind)}</span>
        ${item.copy_count > 1 ? `<span class="pill warn">${item.copy_count} copies</span>` : ""}
        ${item.hidden ? "<span class=\"pill warn\">hidden</span>" : ""}
        ${item.has_textures ? "<span>textures</span>" : ""}
        ${item.is_sliced ? "<span>sliced</span>" : ""}
        ${(item.tags || []).slice(0, 3).map((t) => `<span class="pill tag">${escapeHtml(t)}</span>`).join("")}
        ${activeKind === "__duplicates__" && item.rel_path
          ? `<span title="${escapeHtml(item.rel_path)}">${escapeHtml(item.rel_path.length > 48 ? `…${item.rel_path.slice(-46)}` : item.rel_path)}</span>`
          : ""}
      </div>
    </div>`;
  const check = card.querySelector(".card-check");
  check.addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.shiftKey) {
      e.preventDefault();
      const anchor = lastSelectAnchorId ?? item.id;
      selectRangeInclusive(anchor, item.id, { additive: e.ctrlKey || e.metaKey });
    }
  });
  check.addEventListener("change", (e) => {
    toggleSelected(item.id, e.target.checked);
  });
  const img = card.querySelector(".card-thumb img");
  if (img) {
    img.addEventListener("error", () => {
      if (!img.dataset.thumbFallbackTried && item.thumb_path) {
        img.dataset.thumbFallbackTried = "1";
        img.src = `/api/thumbs/${encodeURIComponent(item.thumb_path)}?v=${encodeURIComponent(
          ((item.content_hash || item.thumb_path || "") + "").slice(0, 16)
        )}`;
        return;
      }
      const host = card.querySelector(".card-thumb");
      if (host) host.innerHTML = `<span class="pill">${escapeHtml(item.kind)}</span>`;
    });
  }
  const openInShelf = () => {
    lastSelectAnchorId = Number(item.id);
    selectAsset(item.id).catch(console.error);
  };
  card.addEventListener("click", (e) => {
    if (e.target.closest(".card-menu") || e.target.closest(".card-check")) return;
    if (e.shiftKey) {
      e.preventDefault();
      const anchor = lastSelectAnchorId ?? item.id;
      selectRangeInclusive(anchor, item.id, { additive: e.ctrlKey || e.metaKey });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      toggleSelected(item.id, !selectedIds.has(item.id));
      return;
    }
    openInShelf();
  });
  card.addEventListener("dblclick", (e) => {
    if (e.target.closest(".card-menu") || e.target.closest(".card-check")) return;
    e.preventDefault();
    openInShelf();
  });
  mountActionMenu(card.querySelector(".card-menu"), [
    { id: "open", label: "Open in PrintShelf", run: openInShelf },
    {
      id: "pc",
      label: item.kind === "zip" ? "Open zip on PC" : "Open on PC",
      run: () => openOnPc(item.id, "open"),
    },
    { id: "reveal", label: "Reveal in Explorer", run: () => openOnPc(item.id, "reveal") },
  ]);
  grid.appendChild(card);
}

function removeLoadMoreBar() {
  $("loadMoreBar")?.remove();
}

function renderLoadMoreBar(host) {
  removeLoadMoreBar();
  if (!libraryHasMore || !host) return;
  const bar = document.createElement("div");
  bar.id = "loadMoreBar";
  bar.className = "load-more-bar";
  bar.innerHTML = `
    <span>Showing ${libraryItems.length.toLocaleString()} of ${libraryTotal.toLocaleString()}</span>
    <button type="button" class="secondary" id="loadMoreBtn">Load more</button>`;
  host.appendChild(bar);
  $("loadMoreBtn")?.addEventListener("click", () => {
    loadLibrary({ preserveScroll: true, append: true }).catch(console.error);
  });
}

async function loadLibrary({ preserveScroll = false, append = false } = {}) {
  const q = $("search").value.trim();
  // Searching while ZIP/STL tab is active hides other kinds — clear type filter on search.
  if (q && activeKind && activeKind !== "__duplicates__") {
    setActiveKind("");
  }
  const dupMode = activeKind === "__duplicates__";
  // Search / Duplicates force flat "all files" results
  const useFolders = browseMode === "folders" && !q && !dupMode;
  const params = filterParams();
  const grid = $("grid");
  const pane = $("gridPane");
  const scrollTop = preserveScroll && pane ? pane.scrollTop : 0;

  if (useFolders || !append) {
    libraryHasMore = false;
    removeLoadMoreBar();
  }

  try {
    if (useFolders) {
      if (browseRootId) params.set("root_id", browseRootId);
      if (browseFolder) params.set("folder", browseFolder);
      const data = await api(`/api/browse?${params}`);
      renderCrumbs(data.crumbs || []);
      libraryItems = data.items || [];
      libraryTotal = Number(data.total_files || libraryItems.length) || 0;
      libraryHasMore = false;
      const visible = new Set(libraryItems.map((i) => i.id));
      selectedIds = new Set([...selectedIds].filter((id) => visible.has(id)));
      const next = document.createElement("div");
      next.className = "grid";

      if (data.mode === "roots") {
        if (!(data.roots || []).length) {
          next.innerHTML = `<div class="detail-empty">No files yet. Add folders and hit Rescan.</div>`;
        } else {
          for (const root of data.roots) {
            appendFolderCard(next, {
              title: root.label || root.id,
              meta: `<span class="pill">${escapeHtml(root.source_kind)}</span><span>${root.asset_count} files</span>`,
              onOpen: () => {
                browseRootId = root.id;
                browseFolder = "";
                clearSelection();
                loadLibrary().catch(console.error);
              },
            });
          }
        }
        grid.replaceWith(next);
        next.id = "grid";
        updateBulkBar();
        if (pane && preserveScroll) pane.scrollTop = scrollTop;
        return;
      }

      for (const folder of data.folders || []) {
        appendFolderCard(next, {
          title: folder.name,
          meta: `<span class="pill">folder</span><span>${folder.asset_count} files</span>`,
          onOpen: () => {
            browseFolder = folder.folder;
            clearSelection();
            loadLibrary().catch(console.error);
          },
        });
      }
      for (const item of libraryItems) appendAssetCard(next, item);
      if (!(data.folders || []).length && !libraryItems.length) {
        next.innerHTML = `<div class="detail-empty">Empty folder.</div>`;
      } else if (data.truncated) {
        const note = document.createElement("div");
        note.className = "detail-empty";
        note.textContent = `Showing first ${libraryItems.length} of ${data.total_files} files in this folder.`;
        next.appendChild(note);
      }
      grid.replaceWith(next);
      next.id = "grid";
      updateBulkBar();
      if (pane && preserveScroll) pane.scrollTop = scrollTop;
      return;
    }

    renderCrumbs([]);
    const offset = append ? libraryItems.length : 0;
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    libraryView = dupMode ? "assets" : "designs";
    const endpoint = dupMode ? "/api/assets" : "/api/designs";
    const data = await api(`${endpoint}?${params}`);
    const page = data.items || [];
    libraryTotal = Number(data.total || 0) || 0;
    if (append) {
      const seen = new Set(libraryItems.map((i) => i.id));
      for (const item of page) {
        if (!seen.has(item.id)) libraryItems.push(item);
      }
    } else {
      libraryItems = page;
    }
    libraryHasMore = libraryItems.length < libraryTotal;
    const visible = new Set(libraryItems.map((i) => i.id));
    selectedIds = new Set([...selectedIds].filter((id) => visible.has(id)));

    if (append) {
      removeLoadMoreBar();
      for (const item of page) {
        if (libraryView === "designs") {
          if (!grid.querySelector(`.design-card[data-design-id="${item.id}"]`)) appendDesignCard(grid, item);
        } else if (!grid.querySelector(`.card[data-id="${item.id}"]`)) {
          appendAssetCard(grid, item);
        }
      }
      renderLoadMoreBar(pane || grid.parentElement);
      updateBulkBar();
      if (pane && preserveScroll) pane.scrollTop = scrollTop;
      return;
    }

    const next = document.createElement("div");
    next.className = "grid";
    if (!libraryItems.length) {
      const qText = $("search")?.value?.trim();
      let emptyMsg = "No files yet. Add folders and hit Rescan.";
      if (dupMode) emptyMsg = "No duplicate files — nice. This tab will hide itself.";
      else if ($("filterHidden")?.checked) emptyMsg = "No hidden files.";
      else if (qText) {
        emptyMsg = `No matches for “${qText}”. Try Rescan/Refresh if the file is new on disk, or clear the type filter.`;
      }
      next.innerHTML = `<div class="detail-empty">${escapeHtml(emptyMsg)}</div>`;
    } else {
      if (dupMode) {
        const note = document.createElement("div");
        note.className = "detail-empty";
        note.style.gridColumn = "1 / -1";
        note.textContent = `${libraryTotal || libraryItems.length} duplicate files (same bytes in more than one place). Delete extras — keep one. Tab disappears when none are left.`;
        next.appendChild(note);
      } else {
        const note = document.createElement("div");
        note.className = "detail-empty";
        note.style.gridColumn = "1 / -1";
        note.textContent = "Grouped by name in the same folder — open a design to see STL / 3MF / gcode files.";
        next.appendChild(note);
      }
      for (const item of libraryItems) {
        if (libraryView === "designs") appendDesignCard(next, item);
        else appendAssetCard(next, item);
      }
    }
    grid.replaceWith(next);
    next.id = "grid";
    renderLoadMoreBar(pane || next.parentElement);
    updateBulkBar();
    if (pane && preserveScroll) pane.scrollTop = scrollTop;
  } catch (err) {
    console.error(err);
    // Leave existing grid intact on failure so the pane doesn't go black.
    if (!grid.children.length) {
      grid.innerHTML = `<div class="detail-empty">Couldn't load library: ${escapeHtml(err.message || err)}</div>`;
    }
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

async function copyText(btn, text, okLabel = "Copied") {
  if (!text) {
    btn.textContent = "No path";
    psToast("Nothing to copy", "No path available for this file.", "error");
    return;
  }
  const prev = btn.dataset.label || btn.textContent;
  let ok = false;
  // navigator.clipboard often fails on plain http:// LAN hosts (not a secure context).
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = false;
    }
  }
  if (!ok) ok = fallbackCopy(text);
  btn.textContent = ok ? okLabel : "Copy failed";
  if (ok) psToast(okLabel, text, "ok", 2600);
  else psToast("Copy failed", "Could not copy to the clipboard.", "error");
  setTimeout(() => { btn.textContent = prev; }, 1600);
}

function isMacOS() {
  const ua = navigator.userAgent || "";
  const plat = navigator.platform || "";
  return /Mac|iPhone|iPad|iPod/i.test(plat) || /Macintosh|Mac OS X/i.test(ua);
}

function isMobileClient() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

async function openInSlicer(item, { zipEntry = "" } = {}) {
  if (isMobileClient()) {
    psToast(
      "Open on a PC",
      "Bambu Studio / Orca need a desktop. On your phone, use Copy Windows path instead.",
      "info",
    );
    return false;
  }

  const kind = item.kind || "";
  const openable = ["stl", "obj", "3mf", "gcode.3mf"].includes(kind);
  const isZip = kind === "zip";
  if (!openable && !isZip) {
    psToast("Can't open in slicer", "Not a slicer file type.", "error");
    return false;
  }
  if (isZip && !zipEntry) {
    psToast("Can't open in slicer", "Pick a printable inside the ZIP first.", "error");
    return false;
  }

  const target = await pickSlicerTarget();
  if (!target) return false;
  const label = slicerTargetLabel(target);

  // Same handoff as Flightdeck: Pi → Windows worker → slicer.exe <path>.
  const u = new URL(`/api/assets/${item.id}/open-slicer`, window.location.origin);
  u.searchParams.set("target", target);
  if (isZip && zipEntry) u.searchParams.set("entry", zipEntry);

  psToast(`Opening in ${label}`, "Flightdeck Windows worker handoff…", "ok", 4000);
  let data = {};
  try {
    const r = await fetch(u.toString(), { method: "POST" });
    data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = typeof data.detail === "string" ? data.detail : "Slicer handoff failed";
      psToast("Couldn't open slicer", detail, "error", 10000);
      return false;
    }
  } catch (err) {
    psToast("Couldn't open slicer", String(err.message || err), "error", 8000);
    return false;
  }

  const via = data.via === "open-path" ? "NAS path (File → Open style)" : (data.filename || "model");
  psToast(`Opened in ${label}`, manifoldToastDetail(data.manifold, via), "ok", 7000);
  return true;
}

async function extractToShelf(item, { zipEntry = "" } = {}) {
  if (!item || item.kind !== "zip") {
    psToast("Can't extract", "Only ZIP archives can be rescued.", "error");
    return false;
  }
  // Prefer the highlighted printable — closure zipEntry can lag after nested peek.
  const activeBtn = document.querySelector(".zip-entry-btn.active");
  const entry = (activeBtn?.dataset?.entry || zipEntry || "").trim();
  if (!entry) {
    const hasRar = (item.meta?.entries || []).some((e) => /\.rar$/i.test(e?.name || ""));
    const hasNested = (item.meta?.nested_zips || []).length > 0
      || (item.meta?.entries || []).some((e) => /\.zip$/i.test(e?.name || ""));
    let detail = "Pick an STL/OBJ/3MF in the printable list first.";
    if (hasRar) {
      detail = "This ZIP has a .rar inside, not printables. Open the .rar with 7-Zip on your PC, then drop the meshes into PrintShelf Extracted.";
    } else if (hasNested) {
      detail = "Peek a nested ZIP first, then pick a printable.";
    } else if ((item.meta?.printable_count || 0) === 0) {
      detail = "No STL/OBJ/3MF inside this archive — nothing to rescue.";
    }
    psToast("Can't extract", detail, "error", 10000);
    return false;
  }
  const leaf = String(entry).split("/").pop() || entry;
  const ok = await psConfirm({
    eyebrow: "Extract to shelf",
    title: "Rescue this printable?",
    body: `Copy <strong>${escapeHtml(leaf)}</strong> into <strong>PrintShelf Extracted</strong> on the NAS, then open it as its own design card. The zip stays put.`,
    confirmLabel: "Extract",
    cancelLabel: "Cancel",
  });
  if (!ok) return false;

  const btn = $("extractShelfBtn");
  if (btn) btn.disabled = true;
  // Sticky until we finish — big STLs can take a while after the old 4s toast vanished.
  const toastHost = $("psToasts");
  psToast("Extracting…", `${leaf} · writing to NAS + indexing`, "ok", 0);
  const u = new URL(`/api/assets/${item.id}/extract`, window.location.origin);
  u.searchParams.set("entry", entry);
  let data = {};
  const clearStickyToasts = () => {
    toastHost?.querySelectorAll(".ps-toast").forEach((el) => el.remove());
  };
  try {
    const r = await fetch(u.toString(), { method: "POST" });
    data = await r.json().catch(() => ({}));
    clearStickyToasts();
    if (!r.ok) {
      let detail = "Extract failed";
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((d) => d.msg || d).join("; ");
      psToast("Couldn't extract", detail, "error", 10000);
      return false;
    }
  } catch (err) {
    clearStickyToasts();
    psToast("Couldn't extract", String(err.message || err), "error", 8000);
    return false;
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.title = entry
        ? "Copy this printable into PrintShelf Extracted on the NAS"
        : "Needs an STL/OBJ/3MF selected — this zip may only have photos or a .rar inside";
    }
  }

  const name = data.file_name || leaf;
  psToast(
    data.reused ? "Already on the shelf" : "Rescued to shelf",
    `${name} → PrintShelf Extracted`,
    "ok",
    7000,
  );
  // Open the new card first — don't block on a full library reload.
  if (data.design_id) {
    browseMode = "all";
    setActiveKind("");
    document.querySelectorAll(".view-mode").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === "all");
    });
    try {
      await selectDesign(data.design_id);
    } catch (err) {
      psToast("Extracted, but couldn't open card", String(err.message || err), "error", 8000);
    }
    loadLibrary().catch(() => {});
  } else if (data.asset_id) {
    try {
      await selectAsset(data.asset_id);
    } catch (err) {
      psToast("Extracted, but couldn't open file", String(err.message || err), "error", 8000);
    }
  }
  return true;
}

async function extractAllToShelf(item) {
  if (!item || item.kind !== "zip") {
    psToast("Can't extract", "Only ZIP archives can be rescued.", "error");
    return false;
  }
  const hasRar = (item.meta?.entries || []).some((e) => /\.rar$/i.test(e?.name || ""));
  const printableCount = Number(item.meta?.printable_count || 0);
  const body = hasRar && printableCount === 0
    ? `This ZIP wraps a <strong>.rar</strong>. PrintShelf will stream it out, unpack with 7-Zip on the Pi (full RAR codecs), and index the meshes into <strong>PrintShelf Extracted</strong> as one kit card. Big archives can take a few minutes.`
    : `Rescue every STL/OBJ/3MF inside this ZIP into <strong>PrintShelf Extracted</strong> (up to 80). Nested .zip one level deep included; .rar members are unpacked with 7-Zip.`;
  const ok = await psConfirm({
    eyebrow: "Extract all",
    title: "Rescue all printables?",
    body,
    confirmLabel: "Extract all",
    cancelLabel: "Cancel",
  });
  if (!ok) return false;

  const btn = $("extractAllShelfBtn");
  if (btn) btn.disabled = true;
  const toastHost = $("psToasts");
  psToast("Extracting all…", hasRar ? "Unpacking RAR on the Pi — hang tight" : "Writing printables to NAS + indexing", "ok", 0);
  const clearStickyToasts = () => {
    toastHost?.querySelectorAll(".ps-toast").forEach((el) => el.remove());
  };
  let data = {};
  try {
    const r = await fetch(`/api/assets/${item.id}/extract-all`, { method: "POST" });
    data = await r.json().catch(() => ({}));
    clearStickyToasts();
    if (!r.ok) {
      let detail = "Extract all failed";
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((d) => d.msg || d).join("; ");
      psToast("Couldn't extract all", detail, "error", 12000);
      return false;
    }
  } catch (err) {
    clearStickyToasts();
    psToast("Couldn't extract all", String(err.message || err), "error", 10000);
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }

  const n = Number(data.extracted) || 0;
  const via = data.rar_unpacked ? "from nested RAR" : "from ZIP";
  psToast(
    n ? `Rescued ${n} file${n === 1 ? "" : "s"}` : "Nothing new",
    `${via} → PrintShelf Extracted${data.errors?.length ? ` · ${data.errors.length} skipped` : ""}`,
    "ok",
    8000,
  );
  browseMode = "all";
  setActiveKind(""); // leave ZIP tab so new STLs are findable
  if ($("search")) $("search").value = "";
  document.querySelectorAll(".view-mode").forEach((b) => {
    b.classList.toggle("active", b.dataset.mode === "all");
  });
  const firstDesign = (data.design_ids || [])[0];
  if (firstDesign) {
    try {
      await selectDesign(firstDesign);
    } catch (err) {
      console.error(err);
    }
  }
  loadLibrary().catch(() => {});
  return true;
}

async function selectAsset(id, { design = null } = {}) {
  selectedId = Number(id);
  document.querySelectorAll(".card:not(.folder-card):not(.design-card)").forEach((c) => {
    c.classList.toggle("active", Number(c.dataset.id) === selectedId);
  });
  window.PrintShelfViewer?.unmountOrbitViewer?.();
  let item;
  try {
    item = await api(`/api/assets/${id}`);
  } catch (err) {
    $("detail").innerHTML = `<p class="detail-hint" style="color:var(--danger)">Failed to load details: ${escapeHtml(String(err.message || err))}</p>`;
    return;
  }
  let designCtx = design;
  if (!designCtx && item.design_id) {
    try {
      designCtx = await api(`/api/designs/${item.design_id}`);
      activeDesignId = Number(item.design_id);
      designAssetsCache = designCtx.assets || [];
    } catch (_) {
      designCtx = null;
    }
  } else if (designCtx) {
    activeDesignId = Number(designCtx.id);
    designAssetsCache = designCtx.assets || [];
  }
  const siblings = designCtx?.assets || designAssetsCache || [];
  try {
  const filaments = item.meta?.filaments || [];
  const sidecars = item.sidecars || [];
  const winPath = item.windows_path || "";
  const winFolder = item.windows_folder || "";
  const isZip = item.kind === "zip";
  const zipMeta = item.meta || {};
  const zipEntries = zipMeta.entries || [];
  let zipPrintables = [...(zipMeta.printables || [])];
  let zipKinds = { ...(zipMeta.printable_by_kind || {}) };
  const nestedZips = (zipMeta.nested_zips && zipMeta.nested_zips.length)
    ? zipMeta.nested_zips
    : zipEntries.filter((e) => /\.zip$/i.test(e.name || ""));
  const hasNested = nestedZips.length > 0;
  const hasMesh = item.meta?.has_mesh === true
    || Number(item.triangle_count) > 0
    || item.kind === "stl"
    || item.kind === "obj"
    || (isZip && (zipPrintables.length > 0 || hasNested));
  // Trust API can_orbit when present; don't force orbit for mesh-less gcode.3mf.
  const canOrbit = item.can_orbit === true
    || (item.can_orbit == null && hasMesh && ["stl", "obj", "3mf", "gcode.3mf", "zip"].includes(item.kind));
  const plateThumb = item.thumb_path
    ? `/api/thumbs/${encodeURIComponent(item.thumb_path)}?v=${encodeURIComponent((item.content_hash || item.thumb_path).slice(0, 12))}`
    : "";
  const showPlatePreview = !canOrbit && plateThumb && ["3mf", "gcode.3mf", "gcode"].includes(item.kind);
  const slicerKinds = ["stl", "obj", "3mf", "gcode.3mf"];
  const canSlicer = slicerKinds.includes(item.kind)
    || (isZip && (zipPrintables.length > 0 || hasNested));
  let zipEntry = isZip ? (zipPrintables[0]?.name || "") : "";
  const slicerDisabledReason = () => {
    if (slicerKinds.includes(item.kind)) {
      if (isMobileClient()) return "Use on PC with Bambu/Orca";
      return "";
    }
    if (isZip) {
      if (!zipEntry) return hasNested ? "Peek a nested ZIP, then pick a printable" : "Pick a printable inside the ZIP first";
      if (isMobileClient()) return "Use on PC with Bambu/Orca";
      return "";
    }
    return "Not a slicer file type";
  };
  const renderPrintablesList = (list, count) => {
    const host = $("zipPrintables");
    if (!host) return;
    if (!list.length) {
      host.innerHTML = `<li class="detail-hint" style="list-style:none">No printables in this archive.</li>`;
      return;
    }
    host.innerHTML = list.map((e, idx) => `
      <li>
        <button type="button" class="zip-entry-btn" data-entry="${escapeHtml(e.name)}" data-idx="${idx}">
          <strong>${escapeHtml(e.kind)}</strong> · ${escapeHtml(e.name)} · ${fmtBytes(e.size_bytes)}
        </button>
      </li>`).join("");
    const note = $("zipPrintablesNote");
    if (note) {
      note.textContent = (count || 0) > list.length
        ? `Showing first ${list.length} of ${count}.`
        : "";
      note.hidden = !note.textContent;
    }
  };
  const designBar = siblings.length > 1
    ? `<div class="design-bar">
         <div class="design-bar-title">${escapeHtml(designCtx?.name || item.design_name || "Design")}
           <span class="meta-hint">${siblings.length} files in this design</span></div>
         <div class="design-assets">
           ${siblings.map((a) => `
             <button type="button" class="design-asset-btn${Number(a.id) === selectedId ? " active" : ""}" data-asset-id="${a.id}">
               <span class="pill">${escapeHtml(a.kind)}</span>
               <span>${escapeHtml(a.file_name)}</span>
             </button>`).join("")}
         </div>
       </div>`
    : "";
  $("detail").innerHTML = `
    ${designBar}
    <h2>${escapeHtml(item.file_name)}</h2>
    <div class="detail-path">${escapeHtml(item.abs_path)}</div>
    ${winPath ? `<div class="detail-path" title="Windows path">${escapeHtml(winPath)}</div>` : ""}
    <div class="detail-section viewer-section">
      <h3>${showPlatePreview ? "Plate preview" : "3D preview"}</h3>
      ${canOrbit
        ? `<div class="viewer-toolbar">
             ${isZip ? `<span class="viewer-entry-label" id="orbitEntryLabel"></span>` : ""}
             <label class="check viewer-detail-toggle">
               <input type="checkbox" id="orbitHighDetail"> Higher detail
             </label>
           </div>
           <div class="orbit-viewer" id="orbitViewer"></div>
           <p class="viewer-note" id="orbitNote" hidden></p>
           ${isZip ? `<p class="detail-hint" id="orbitHint">${zipPrintables.length
             ? "Click a printable below to load it in the viewer."
             : "Peek a nested archive below, then click a printable to orbit."}</p>` : ""}`
        : showPlatePreview
          ? `<div class="plate-preview"><img src="${plateThumb}" alt="Plate preview" loading="lazy"></div>
             <p class="detail-hint">Sliced plate image — this file has no mesh to orbit (normal for many .gcode.3mf).</p>`
          : isZip
          ? `<p class="detail-hint">No printable meshes (STL/OBJ/3MF) found inside this ZIP.</p>`
          : item.kind === "gcode"
            ? `<p class="detail-hint">Sliced G-code — no mesh orbit. Thumbnails come from Prusa/Cura embeds when present.</p>`
            : `<p class="detail-hint">No 3D orbit for this file type.</p>`}
    </div>
    <div class="detail-section">
      <h3>Tags &amp; notes</h3>
      <label class="meta-label">Tags <span class="meta-hint">comma-separated</span></label>
      <input type="text" id="designTagsInput" class="meta-input" value="${escapeHtml(((designCtx?.tags != null ? designCtx.tags : item.tags) || []).join(", "))}" placeholder="to print, gift, junk…">
      <label class="meta-label">Notes</label>
      <textarea id="designNotesInput" class="meta-input meta-notes" rows="3" placeholder="Anything useful about this design…">${escapeHtml(designCtx?.notes ?? item.design_notes ?? "")}</textarea>
      <button type="button" class="card-open secondary" id="saveDesignMetaBtn">Save tags &amp; notes</button>
    </div>
    <div class="detail-section">
      <h3>Library filament</h3>
      <div class="detail-actions">
        <select id="assetFilamentSelect" class="meta-input" style="min-width:220px">
          <option value="">No filament assigned</option>
          ${filaments.map((f) => `
            <option value="${f.id}" ${Number(item.assigned_filament_id || 0) === Number(f.id) ? "selected" : ""}>
              ${escapeHtml(filamentLabel(f))}
            </option>`).join("")}
        </select>
        <button type="button" class="card-open secondary" id="assignFilamentBtn">Assign</button>
        <button type="button" class="card-open secondary" id="newFilamentBtn">+ New filament</button>
      </div>
      <p class="detail-hint" id="assetFilamentHint">${item.assigned_filament
        ? `Assigned: ${escapeHtml(filamentLabel(item.assigned_filament))}`
        : "Assign a filament profile to this file so you can filter your library by material/colour."}</p>
    </div>
    <div class="kv">
      <div><span>Design</span><span>${escapeHtml(item.design_name)}</span></div>
      ${item.suggested_printer?.label
        ? `<div><span>Sliced for</span><span>${escapeHtml(item.suggested_printer.label)}${item.meta?.printer_model ? "" : " (folder hint)"}</span></div>`
        : (item.meta?.printer_model
          ? `<div><span>Sliced for</span><span>${escapeHtml(item.meta.printer_model)}</span></div>`
          : "")}
      <div><span>Type</span><span>${escapeHtml(item.kind === "gcode" ? (item.meta?.extension === ".gco" ? "gcode (.gco)" : "gcode") : item.kind)}</span></div>
      <div><span>Source</span><span>${escapeHtml(item.source_kind)} · ${escapeHtml(item.root_id)}</span></div>
      <div><span>Size</span><span>${fmtBytes(item.size_bytes)}</span></div>
      ${(item.kind === "stl" || item.kind === "obj")
        ? `<div><span>Manifold</span><span id="manifoldStatus">Checking…</span></div>`
        : ""}
      ${isZip ? `
        <div><span>Files in zip</span><span>${zipMeta.entry_count ?? "—"}</span></div>
        <div><span>Uncompressed</span><span>${fmtBytes(zipMeta.uncompressed_bytes || 0)}</span></div>
        <div><span>Printables inside</span><span id="zipPrintableCount">${zipMeta.printable_count ?? 0}</span></div>
        <div><span>Nested zips</span><span>${nestedZips.length}</span></div>
        <div><span>Inside types</span><span id="zipInsideTypes">${Object.keys(zipKinds).length
          ? Object.entries(zipKinds).map(([k, v]) => `${k}: ${v}`).join(" · ")
          : "—"}</span></div>
      ` : item.kind === "gcode" ? `
        <div><span>Slicer</span><span>${escapeHtml(item.meta?.generator || "—")}</span></div>
        <div><span>Print time</span><span>${escapeHtml(item.meta?.print_time || "—")}</span></div>
        <div><span>Filament</span><span>${escapeHtml(
          item.meta?.filament_used
            || (item.meta?.filament_used_g ? `${item.meta.filament_used_g} g` : "")
            || item.meta?.filament_used_mm
            || "—"
        )}</span></div>
        <div><span>Layer height</span><span>${escapeHtml(item.meta?.layer_height || "—")}</span></div>
        <div><span>Layers</span><span>${item.meta?.layer_count ?? "—"}</span></div>
        <div><span>Printer</span><span>${escapeHtml(item.meta?.printer_model || item.meta?.flavor || "—")}</span></div>
      ` : `
        <div><span>Triangles / faces</span><span>${item.triangle_count ?? "—"}</span></div>
        <div><span>Textures</span><span>${item.has_textures ? "yes" : "no"}</span></div>
        <div><span>Sliced</span><span>${item.is_sliced ? "yes" : "no"}</span></div>
      `}
    </div>
    ${isZip && hasNested ? `
      <div class="detail-section">
        <h3>Nested archives</h3>
        <p class="detail-hint">Peek opens one level inside without extracting to the NAS.</p>
        <ul class="sidecar-list zip-nested" id="zipNested">
          ${nestedZips.map((e) => `
            <li>
              <button type="button" class="zip-nested-btn" data-entry="${escapeHtml(e.name)}">
                <strong>zip</strong> · ${escapeHtml(e.name)} · ${fmtBytes(e.size_bytes)}
                <span class="pill">Peek</span>
              </button>
            </li>`).join("")}
        </ul>
        <p class="detail-hint" id="zipPeekStatus" hidden></p>
      </div>` : ""}
    ${isZip ? `
      <div class="detail-section" id="zipPrintablesSection" ${zipPrintables.length || hasNested ? "" : "hidden"}>
        <h3 id="zipPrintablesTitle">Printables in zip</h3>
        <ul class="sidecar-list zip-printables" id="zipPrintables">
          ${zipPrintables.length ? zipPrintables.map((e, idx) => `
            <li>
              <button type="button" class="zip-entry-btn" data-entry="${escapeHtml(e.name)}" data-idx="${idx}">
                <strong>${escapeHtml(e.kind)}</strong> · ${escapeHtml(e.name)} · ${fmtBytes(e.size_bytes)}
              </button>
            </li>`).join("") : `<li class="detail-hint" style="list-style:none">Peek a nested archive to list printables.</li>`}
        </ul>
        <p class="detail-hint" id="zipPrintablesNote" hidden></p>
      </div>` : ""}
    ${isZip && zipEntries.length ? `
      <div class="detail-section">
        <h3>Zip contents</h3>
        <ul class="sidecar-list zip-entries">
          ${zipEntries.map((e) => `
            <li>${escapeHtml(e.name)} · ${fmtBytes(e.size_bytes)}</li>
          `).join("")}
        </ul>
        ${zipMeta.list_truncated
          ? `<p class="detail-hint">Showing first ${zipEntries.length} of ${zipMeta.entry_count} files.</p>`
          : ""}
        ${item.meta?.error ? `<p class="detail-hint" style="color:var(--danger)">${escapeHtml(item.meta.error)}</p>` : ""}
      </div>` : ""}
    ${filaments.length ? `
      <div class="detail-section">
        <h3>Filaments</h3>
        <div class="filament-row">
          ${filaments.map((f) => `
            <div title="${escapeHtml(f.type || "")}">
              <div class="swatch" style="background:${escapeHtml(f.colour || "#888")}"></div>
            </div>`).join("")}
        </div>
      </div>` : ""}
    ${item.meta?.plates?.length ? `
      <div class="detail-section">
        <h3>Plates</h3>
        <div class="kv">
          ${item.meta.plates.map((p) => `<div><span>${escapeHtml(p.name || "plate")}</span><span>${(p.filament_ids || []).length} filaments</span></div>`).join("")}
        </div>
      </div>` : ""}
    ${item.meta?.texture_refs || sidecars.length ? `
      <div class="detail-section">
        <h3>Sidecars / textures</h3>
        <ul class="sidecar-list">
          ${sidecars.map((s) => `<li><strong>${escapeHtml(s.role)}</strong> · ${escapeHtml(s.file_name)} · ${fmtBytes(s.size_bytes)}</li>`).join("") || "<li>None found</li>"}
        </ul>
        ${item.meta?.missing_textures?.length ? `<p class="lede">Missing: ${escapeHtml(item.meta.missing_textures.join(", "))}</p>` : ""}
      </div>` : ""}
    <div class="detail-section">
      <div class="detail-actions detail-actions-top">
        <div class="detail-menu" id="detailMenu">
          <button type="button" class="card-open secondary detail-menu-btn" aria-label="More actions">⋮ More</button>
          <div class="detail-menu-panel card-menu-panel" role="menu"></div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="card-open" type="button" id="printThisBtn"
          ${printDisabledReason(item, zipEntry) ? "disabled" : ""}
          title="${escapeHtml(printDisabledReason(item, zipEntry) || "Queue on Flightdeck — auto-sends when free")}">Print this</button>
        <button class="card-open secondary" type="button" id="copyWinFolderBtn" data-label="Copy folder path" ${winFolder ? "" : "disabled"}
          title="${winFolder ? "Copy folder path — paste into Explorer (Ctrl+L)" : "Set a Windows path on this watched folder in Folders"}">Copy folder path</button>
        <button class="card-open secondary slicer-btn" type="button" id="openSlicerBtn"
          ${slicerDisabledReason() ? "disabled" : ""}
          title="${escapeHtml(slicerDisabledReason() || "Open in Bambu Studio or Orca")}">Open in slicer</button>
        ${isZip ? `<button class="card-open secondary" type="button" id="extractShelfBtn"
          title="${zipEntry
            ? "Copy this printable into PrintShelf Extracted on the NAS"
            : "Needs an STL/OBJ/3MF selected — this zip may only have photos or a .rar inside"}">Extract to shelf</button>
        <button class="card-open secondary" type="button" id="extractAllShelfBtn"
          title="Rescue all printables (unpacks nested .rar with 7-Zip on the Pi)">Extract all</button>` : ""}
        <button class="card-open secondary" type="button" id="openOnPcBtn"
          title="Open with the Windows default app (zip → Explorer / 7-Zip)">${isZip ? "Open zip on PC" : "Open on PC"}</button>
        <button class="card-open secondary" type="button" id="copyWinPathBtn" data-label="Copy file path" ${winPath ? "" : "disabled"}>Copy file path</button>
        <button class="card-open secondary" type="button" id="copyPiPathBtn" data-label="Copy Pi path">Copy Pi path</button>
      </div>
      <div class="detail-actions danger-actions">
        ${item.hidden
          ? `<button class="card-open secondary" type="button" id="unhideBtn">${selectedIds.size > 1 ? `Unhide ${selectedIds.size}` : "Unhide"}</button>`
          : `<button class="card-open secondary" type="button" id="hideBtn">${selectedIds.size > 1 ? `Hide ${selectedIds.size} from library` : "Hide from library"}</button>`}
        <button class="card-open danger" type="button" id="deleteDiskBtn">${selectedIds.size > 1 ? `Delete ${selectedIds.size} from disk…` : "Delete from disk…"}</button>
      </div>
      <p class="detail-hint" id="printHint">${printDisabledReason(item, zipEntry)
        ? `Print this: ${printDisabledReason(item, zipEntry)}.`
        : (needsSlicerFirst(item, zipEntry)
          ? "Print this: STL/OBJ need slicing first — opens Bambu/Orca, then queue the sliced .3mf/.gcode."
          : "Print this queues .3mf / .gcode.3mf / .gcode on Flightdeck and auto-sends when free.")}</p>
      <p class="detail-hint">${winFolder
        ? "Copy folder path → Explorer address bar (Ctrl+L → Ctrl+V) to jump straight to the file’s folder."
        : "Set a Windows path on this watched folder in Folders to enable folder / file copy."}</p>
      <p class="detail-hint" id="slicerHint">${canSlicer
        ? (isMobileClient()
          ? "Open in slicer needs Bambu/Orca on a PC. On your phone, use Copy file path."
          : "Open in slicer asks Bambu or Orca, checks manifold (MakerDeck-style sanitize if needed), then hands off via the Windows worker.")
        : item.kind === "gcode"
          ? "Raw G-code is already sliced — use Print this to queue it, or copy the file path."
          : "Slicer open is for STL, OBJ, 3MF, and ZIP printables."}</p>
      ${isZip ? `<p class="detail-hint" id="extractHint">${zipEntry
        ? "Extract to shelf copies the selected printable into <strong>PrintShelf Extracted</strong> on the NAS and opens it as its own design card. The zip stays put."
        : (zipEntries.some((e) => /\.rar$/i.test(e.name || ""))
          ? "This ZIP only wraps a <strong>.rar</strong> (or photos) — no STL/OBJ/3MF to rescue. Open the .rar on your PC (7-Zip), then put the meshes on the NAS / Extracted folder."
          : (hasNested
            ? "Peek a nested ZIP below, then pick an STL/OBJ/3MF before Extract to shelf."
            : "No printables in this archive — Extract needs an STL, OBJ, or 3MF inside the ZIP."))}</p>` : ""}
      <p class="detail-hint">${selectedIds.size > 1
        ? `Selection active: Hide/Delete will apply to all ${selectedIds.size} selected files.`
        : `Hide keeps the file on disk. Delete removes the file${sidecars.length ? " and indexed sidecars/textures" : ""} permanently.`}</p>
    </div>`;
  const syncSlicerBtn = () => {
    const btn = $("openSlicerBtn");
    if (!btn) return;
    const reason = slicerDisabledReason();
    btn.disabled = Boolean(reason);
    btn.title = reason || "Open in Bambu Studio or Orca";
  };
  const syncPrintBtn = () => {
    const btn = $("printThisBtn");
    if (!btn) return;
    const reason = printDisabledReason(item, zipEntry);
    btn.disabled = Boolean(reason);
    btn.title = reason || "Queue on Flightdeck — auto-sends when free";
    const hint = $("printHint");
    if (hint) {
      if (reason) {
        hint.textContent = `Print this: ${reason}.`;
      } else if (needsSlicerFirst(item, zipEntry)) {
        hint.textContent = "Print this: STL/OBJ need slicing first — opens Bambu/Orca, then queue the sliced .3mf/.gcode.";
      } else {
        hint.textContent = "Print this queues .3mf / .gcode.3mf / .gcode on Flightdeck and auto-sends when free.";
      }
    }
  };
  const syncExtractBtn = () => {
    const btn = $("extractShelfBtn");
    if (!btn) return;
    // Always clickable — toast explains when there's nothing to rescue.
    btn.disabled = false;
    btn.title = zipEntry
      ? "Copy this printable into PrintShelf Extracted on the NAS"
      : "Needs an STL/OBJ/3MF selected — this zip may only have photos or a .rar inside";
    const hint = $("extractHint");
    if (hint) {
      if (zipEntry) {
        hint.innerHTML = "Extract to shelf copies the selected printable into <strong>PrintShelf Extracted</strong> on the NAS and opens it as its own design card. The zip stays put.";
      } else if (zipEntries.some((e) => /\.rar$/i.test(e.name || ""))) {
        hint.innerHTML = "This ZIP only wraps a <strong>.rar</strong> (or photos) — no STL/OBJ/3MF to rescue. Open the .rar on your PC (7-Zip), then put the meshes on the NAS / Extracted folder.";
      } else if (hasNested) {
        hint.textContent = "Peek a nested ZIP below, then pick an STL/OBJ/3MF before Extract to shelf.";
      } else {
        hint.textContent = "No printables in this archive — Extract needs an STL, OBJ, or 3MF inside the ZIP.";
      }
    }
  };
  $("printThisBtn")?.addEventListener("click", () => {
    printThis(item, { zipEntry });
  });
  $("openSlicerBtn")?.addEventListener("click", () => {
    openInSlicer(item, { zipEntry });
  });
  $("extractShelfBtn")?.addEventListener("click", () => {
    const active = document.querySelector(".zip-entry-btn.active");
    extractToShelf(item, { zipEntry: active?.dataset?.entry || zipEntry });
  });
  $("extractAllShelfBtn")?.addEventListener("click", () => {
    extractAllToShelf(item);
  });
  $("openOnPcBtn")?.addEventListener("click", () => {
    openOnPc(item.id, "open");
  });
  const detailMenuItems = [
    {
      id: "pc",
      label: isZip ? "Open zip on PC" : "Open on PC",
      run: () => openOnPc(item.id, "open"),
    },
    { id: "reveal", label: "Reveal in Explorer", run: () => openOnPc(item.id, "reveal") },
  ];
  if (isZip) {
    detailMenuItems.push(
      {
        id: "extract",
        label: "Extract to shelf…",
        run: () => {
          const active = document.querySelector(".zip-entry-btn.active");
          extractToShelf(item, { zipEntry: active?.dataset?.entry || zipEntry });
        },
      },
      {
        id: "extractAll",
        label: "Extract all printables…",
        run: () => extractAllToShelf(item),
      },
    );
  }
  mountActionMenu($("detailMenu"), detailMenuItems);
  if ((item.kind === "stl" || item.kind === "obj") && $("manifoldStatus")) {
    api(`/api/assets/${item.id}/manifold?repair=false`)
      .then((m) => {
        const el = $("manifoldStatus");
        if (!el) return;
        if (m.skipped) {
          el.textContent = "—";
          return;
        }
        const before = Number(m.before) || 0;
        el.textContent = before === 0 ? "OK" : `${before.toLocaleString()} open edges`;
        el.style.color = before === 0 ? "var(--ok, #34d399)" : "var(--warn, #fbbf24)";
      })
      .catch(() => {
        const el = $("manifoldStatus");
        if (el) el.textContent = "—";
      });
  }
  $("copyWinPathBtn")?.addEventListener("click", () => copyText($("copyWinPathBtn"), winPath));
  $("copyWinFolderBtn")?.addEventListener("click", () => copyText($("copyWinFolderBtn"), winFolder, "Folder path copied"));
  $("copyPiPathBtn")?.addEventListener("click", () => copyText($("copyPiPathBtn"), item.abs_path));
  $("assignFilamentBtn")?.addEventListener("click", async () => {
    const sel = $("assetFilamentSelect");
    const raw = sel ? String(sel.value || "").trim() : "";
    const filamentId = raw ? Number(raw) : null;
    const label = filamentId
      ? (filaments.find((f) => Number(f.id) === filamentId)?.name || "filament")
      : "none";
    try {
      await api(`/api/assets/${item.id}/filament`, {
        method: "POST",
        body: JSON.stringify({ filament_id: filamentId }),
      });
      psToast("Filament updated", `Assigned: ${label}`, "ok");
      await loadFilaments();
      await loadLibrary({ preserveScroll: true });
      await selectAsset(item.id, { design: designCtx });
    } catch (err) {
      psToast("Filament assign failed", String(err.message || err), "error");
    }
  });
  $("newFilamentBtn")?.addEventListener("click", async () => {
    const name = String(window.prompt("Filament name", "") || "").trim();
    if (!name) return;
    const material = String(window.prompt("Material (optional, e.g. PLA/PETG)", "") || "").trim();
    const brand = String(window.prompt("Brand (optional)", "") || "").trim();
    const colour = String(window.prompt("Colour hex (optional, e.g. #60B4EB)", "") || "").trim();
    try {
      await api("/api/filaments", {
        method: "POST",
        body: JSON.stringify({
          name,
          material,
          brand,
          colour_hex: colour,
        }),
      });
      await loadFilaments();
      const sel = $("assetFilamentSelect");
      const created = filaments.find((f) => String(f.name || "").toLowerCase() === name.toLowerCase());
      if (sel && created) sel.value = String(created.id);
      psToast("Filament created", filamentLabel(created || { name }), "ok");
    } catch (err) {
      psToast("Create filament failed", String(err.message || err), "error");
    }
  });
  $("saveDesignMetaBtn")?.addEventListener("click", async () => {
    const btn = $("saveDesignMetaBtn");
    const tags = parseTagsInput($("designTagsInput")?.value);
    const notes = $("designNotesInput")?.value ?? "";
    if (btn) btn.disabled = true;
    try {
      const designId = designCtx?.id || item.design_id;
      if (designId) {
        await api(`/api/designs/${designId}`, {
          method: "PATCH",
          body: JSON.stringify({ tags, notes }),
        });
      } else {
        await api(`/api/assets/${item.id}/design`, {
          method: "PATCH",
          body: JSON.stringify({ tags, notes }),
        });
      }
      psToast("Saved", "Tags and notes updated for this design.", "ok");
      await loadLibrary({ preserveScroll: true });
      await selectAsset(item.id, { design: designId ? await api(`/api/designs/${designId}`) : null });
    } catch (err) {
      psToast("Save failed", String(err.message || err), "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  document.querySelectorAll(".design-asset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const aid = Number(btn.dataset.assetId);
      if (aid) selectAsset(aid, { design: designCtx }).catch(console.error);
    });
  });
  $("hideBtn")?.addEventListener("click", async () => {
    try {
      const ids = idsForAction(id);
      await hideIds(ids);
      psToast("Hidden from library", fileCountLabel(ids.length), "ok");
    } catch (err) {
      psToast("Hide failed", String(err.message || err), "error");
    }
  });
  $("unhideBtn")?.addEventListener("click", async () => {
    try {
      const ids = idsForAction(id);
      await unhideIds(ids);
      psToast("Unhidden", fileCountLabel(ids.length), "ok");
      if (ids.length === 1) await selectAsset(ids[0]);
    } catch (err) {
      psToast("Unhide failed", String(err.message || err), "error");
    }
  });
  $("deleteDiskBtn")?.addEventListener("click", async () => {
    try {
      const ids = idsForAction(id);
      const names = ids.length === 1
        ? [item.file_name]
        : libraryItems.filter((x) => ids.includes(x.id)).map((x) => x.file_name);
      await deleteIdsFromDisk(ids, { names });
    } catch (err) {
      psToast("Delete failed", String(err.message || err), "error");
    }
  });
  if (canOrbit) {
    const mountOrbit = async (highDetail) => {
      for (let i = 0; i < 40 && !window.PrintShelfViewer?.mountOrbitViewer; i++) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!window.PrintShelfViewer?.mountOrbitViewer) {
        if ($("orbitViewer")) {
          $("orbitViewer").innerHTML = `<div class="viewer-status error">3D viewer failed to load (check network / CDN).</div>`;
        }
        return;
      }
      const detail = highDetail ? "high" : "standard";
      let url = `/api/assets/${id}/model?detail=${detail}`;
      if (isZip) {
        if (!zipEntry) {
          if ($("orbitViewer")) {
            $("orbitViewer").innerHTML = `<div class="viewer-status">Pick a printable in the list below.</div>`;
          }
          return;
        }
        url += `&entry=${encodeURIComponent(zipEntry)}`;
        if ($("orbitEntryLabel")) {
          $("orbitEntryLabel").textContent = zipEntry.split("/").pop() || zipEntry;
        }
      }
      await window.PrintShelfViewer.mountOrbitViewer($("orbitViewer"), {
        url,
        noteEl: $("orbitNote"),
      });
    };
    $("orbitHighDetail")?.addEventListener("change", (e) => {
      mountOrbit(Boolean(e.target.checked)).catch(console.error);
    });
    $("zipPrintables")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".zip-entry-btn");
      if (!btn) return;
      zipEntry = btn.dataset.entry || "";
      document.querySelectorAll(".zip-entry-btn").forEach((b) => b.classList.toggle("active", b === btn));
      syncSlicerBtn();
      syncPrintBtn();
      syncExtractBtn();
      mountOrbit(Boolean($("orbitHighDetail")?.checked)).catch(console.error);
    });
    if (isZip) {
      if (zipPrintables.length) {
        const firstBtn = document.querySelector(".zip-entry-btn");
        if (firstBtn) firstBtn.classList.add("active");
        await mountOrbit(false);
      } else if ($("orbitViewer")) {
        $("orbitViewer").innerHTML = `<div class="viewer-status">${hasNested
          ? "Peek a nested archive below to load printables."
          : "No printables loaded yet — peek a nested archive or pick one below."}</div>`;
      }
    } else {
      // STL / OBJ / 3MF — mount immediately (zip-only branch used to skip these).
      await mountOrbit(false);
    }
  } else if (isZip && zipPrintables.length) {
    $("zipPrintables")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".zip-entry-btn");
      if (!btn) return;
      zipEntry = btn.dataset.entry || "";
      document.querySelectorAll(".zip-entry-btn").forEach((b) => b.classList.toggle("active", b === btn));
      syncSlicerBtn();
      syncPrintBtn();
      syncExtractBtn();
    });
    const firstBtn = document.querySelector(".zip-entry-btn");
    if (firstBtn) firstBtn.classList.add("active");
  }

  $("zipNested")?.addEventListener("click", async (e) => {
    const btn = e.target.closest(".zip-nested-btn");
    if (!btn) return;
    const nestedEntry = btn.dataset.entry || "";
    const status = $("zipPeekStatus");
    document.querySelectorAll(".zip-nested-btn").forEach((b) => b.classList.toggle("active", b === btn));
    if (status) {
      status.hidden = false;
      status.textContent = `Peeking ${nestedEntry}…`;
    }
    try {
      const data = await api(`/api/assets/${id}/nested?entry=${encodeURIComponent(nestedEntry)}`);
      zipPrintables = data.printables || [];
      zipKinds = data.printable_by_kind || {};
      zipEntry = zipPrintables[0]?.name || "";
      const section = $("zipPrintablesSection");
      if (section) section.hidden = false;
      if ($("zipPrintablesTitle")) {
        $("zipPrintablesTitle").textContent = `Printables in ${nestedEntry.split("/").pop()}`;
      }
      if ($("zipPrintableCount")) $("zipPrintableCount").textContent = String(data.printable_count ?? zipPrintables.length);
      if ($("zipInsideTypes")) {
        $("zipInsideTypes").textContent = Object.keys(zipKinds).length
          ? Object.entries(zipKinds).map(([k, v]) => `${k}: ${v}`).join(" · ")
          : "—";
      }
      if ($("orbitHint")) {
        $("orbitHint").textContent = zipPrintables.length
          ? "Click a printable below to load it in the viewer."
          : "No printables found in that nested archive.";
      }
      renderPrintablesList(zipPrintables, data.printable_count);
      if (status) {
        status.textContent = data.error
          ? `Peek failed: ${data.error}`
          : `Found ${data.printable_count || 0} printable(s) in ${nestedEntry.split("/").pop()}.`;
      }
      syncSlicerBtn();
      syncPrintBtn();
      syncExtractBtn();
      if (zipEntry && $("orbitViewer") && window.PrintShelfViewer?.mountOrbitViewer) {
        const firstBtn = document.querySelector(".zip-entry-btn");
        if (firstBtn) firstBtn.classList.add("active");
        // Re-bind isn't needed — zipPrintables click is on parent.
        const high = Boolean($("orbitHighDetail")?.checked);
        const detail = high ? "high" : "standard";
        let url = `/api/assets/${id}/model?detail=${detail}&entry=${encodeURIComponent(zipEntry)}`;
        if ($("orbitEntryLabel")) {
          $("orbitEntryLabel").textContent = zipEntry.split("/").pop() || zipEntry;
        }
        await window.PrintShelfViewer.mountOrbitViewer($("orbitViewer"), {
          url,
          noteEl: $("orbitNote"),
        });
      }
    } catch (err) {
      if (status) status.textContent = String(err.message || err);
    }
  });

  syncSlicerBtn();
  syncPrintBtn();
  syncExtractBtn();
  // Do not reload the library here — that flashed/cleared the thumb grid.
  } catch (err) {
    $("detail").innerHTML = `<p class="detail-hint" style="color:var(--danger)">Failed to render details: ${escapeHtml(String(err.message || err))}</p>`;
  }
}

function renderIgnoreGlobs() {
  const el = $("ignoreGlobsInput");
  if (el) el.value = (ignoreGlobs || []).join("\n");
}

function collectionRulesLabel(item = {}) {
  const mode = String(item.mode || "auto");
  if (mode === "manual") return "manual list";
  const r = item.rules || {};
  const bits = [];
  if (r.q) bits.push(`q:${r.q}`);
  if (r.kind) bits.push(r.kind);
  if (r.root_id) bits.push(r.root_id);
  if (r.tags_any?.length) bits.push(`#${r.tags_any.join(", #")}`);
  if (r.has_textures) bits.push("textures");
  if (r.is_sliced) bits.push("sliced");
  return bits.length ? bits.join(" · ") : "all files";
}

function resetCollectionForm() {
  const form = $("collectionForm");
  if (!form) return;
  editingCollectionId = null;
  form.reset();
  const modeSel = form.querySelector('[name="mode"]');
  if (modeSel) modeSel.value = "auto";
  form.querySelector('[name="name"]')?.focus();
}

function fillCollectionForm(item) {
  const form = $("collectionForm");
  if (!form || !item) return;
  editingCollectionId = Number(item.id);
  form.querySelector('[name="name"]').value = item.name || "";
  form.querySelector('[name="mode"]').value = item.mode || "auto";
  form.querySelector('[name="q"]').value = item.rules?.q || "";
  form.querySelector('[name="kind"]').value = item.rules?.kind || "";
  form.querySelector('[name="tags_any"]').value = (item.rules?.tags_any || []).join(", ");
  form.querySelector('[name="has_textures"]').checked = !!item.rules?.has_textures;
  form.querySelector('[name="is_sliced"]').checked = !!item.rules?.is_sliced;
}

function renderCollections() {
  const host = $("collectionList");
  if (!host) return;
  if (!collections.length) {
    host.innerHTML = `<p class="lede">No collections yet.</p>`;
    return;
  }
  host.innerHTML = collections.map((c) => `
    <div class="collection-row">
      <div>
        <strong>${escapeHtml(c.name || `Collection ${c.id}`)}</strong>
        <div class="meta">
          <span class="pill">${escapeHtml(c.mode || "auto")}</span>
          <span>${Number(c.asset_count || 0)} files</span>
          <span>${escapeHtml(collectionRulesLabel(c))}</span>
        </div>
      </div>
      <div class="collection-actions">
        <button type="button" class="secondary edit-collection" data-id="${c.id}">Edit</button>
        <button type="button" class="secondary delete-collection" data-id="${c.id}">Delete</button>
      </div>
    </div>
  `).join("");
  host.querySelectorAll(".edit-collection").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.id);
      const item = collections.find((x) => Number(x.id) === id);
      if (item) fillCollectionForm(item);
    });
  });
  host.querySelectorAll(".delete-collection").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const item = collections.find((x) => Number(x.id) === id);
      if (!item) return;
      const ok = await psConfirm({
        eyebrow: "Delete collection",
        title: `Delete ${item.name}?`,
        body: "This only removes the collection. Files stay where they are.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await api(`/api/collections/${id}`, { method: "DELETE" });
      if ($("filterCollection")?.value === String(id)) $("filterCollection").value = "";
      await loadCollections();
      await loadLibrary();
      psToast("Collection deleted", item.name, "ok");
    });
  });
}

async function loadCollections() {
  const out = await api("/api/collections");
  collections = out.items || [];
  fillCollectionFilter();
  renderCollections();
}

async function loadFilaments() {
  const out = await api("/api/filaments");
  filaments = out.items || [];
  fillFilamentFilter();
}

function renderScanIssues() {
  const host = $("scanIssuesList");
  if (!host) return;
  if (!scanIssues.length) {
    host.innerHTML = `<p class="lede">No unresolved scan issues.</p>`;
    return;
  }
  host.innerHTML = scanIssues.map((i) => `
    <div class="scan-issue-row">
      <div class="scan-issue-title">${escapeHtml(i.file_name || "file")}</div>
      <div class="scan-issue-meta">
        ${escapeHtml(i.error || "Unknown error")}<br>
        ${escapeHtml(i.abs_path || "")}<br>
        root: ${escapeHtml(i.root_id || "—")} · attempts: ${Number(i.attempts || 0)}
      </div>
      <div class="scan-issue-actions">
        <button type="button" class="secondary retry-issue" data-id="${i.id}">Retry</button>
        <button type="button" class="secondary ignore-issue" data-id="${i.id}">Ignore</button>
      </div>
    </div>
  `).join("");
  host.querySelectorAll(".retry-issue").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      try {
        await api("/api/scan_issues/retry", { method: "POST", body: JSON.stringify({ ids: [id] }) });
        psToast("Retry started", "Rescanning source for this issue.", "ok");
        await loadScanIssues();
        await refreshStats();
      } catch (err) {
        psToast("Retry failed", String(err.message || err), "error");
      }
    });
  });
  host.querySelectorAll(".ignore-issue").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      try {
        await api(`/api/scan_issues/${id}/ignore`, { method: "POST", body: "{}" });
        psToast("Issue ignored", "Hidden from unresolved list.", "ok");
        await loadScanIssues();
        await refreshStats();
      } catch (err) {
        psToast("Ignore failed", String(err.message || err), "error");
      }
    });
  });
}

function updateScanIssuesBadge(n) {
  const btn = $("scanIssuesBtn");
  if (!btn) return;
  const count = Number(n || 0);
  btn.hidden = false;
  btn.textContent = `Scan issues (${count})`;
}

async function loadScanIssues() {
  const out = await api("/api/scan_issues?unresolved_only=true&ignored=false&limit=200");
  scanIssues = out.items || [];
  renderScanIssues();
  updateScanIssuesBadge(scanIssues.length);
}

async function saveCollectionFromForm() {
  const form = $("collectionForm");
  if (!form) return;
  const fd = new FormData(form);
  const mode = String(fd.get("mode") || "auto");
  const payload = {
    name: String(fd.get("name") || "").trim(),
    mode,
    rules: {
      q: String(fd.get("q") || "").trim(),
      kind: String(fd.get("kind") || "").trim(),
      tags_any: parseTagsInput(fd.get("tags_any") || ""),
      has_textures: form.querySelector('[name="has_textures"]').checked ? true : null,
      is_sliced: form.querySelector('[name="is_sliced"]').checked ? true : null,
    },
  };
  if (mode === "manual") {
    payload.rules = {};
  }
  if (!payload.name) {
    psToast("Collection name required", "Add a name first.", "error");
    return;
  }
  if (editingCollectionId) {
    await api(`/api/collections/${editingCollectionId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    psToast("Collection updated", payload.name, "ok");
  } else {
    await api("/api/collections", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    psToast("Collection created", payload.name, "ok");
  }
  resetCollectionForm();
  await loadCollections();
  await refreshStats();
  await loadLibrary();
}

async function addSelectedToCollection() {
  const ids = [...selectedIds];
  if (!ids.length) {
    psToast("Nothing selected", "Pick one or more files first.", "error");
    return;
  }
  const manuals = collections.filter((c) => String(c.mode || "") === "manual");
  if (!manuals.length) {
    psToast("No manual collections", "Create a manual collection in Folders first.", "error");
    return;
  }
  const choice = await psChoice({
    eyebrow: "Manual collection",
    title: "Add selected files to which collection?",
    options: manuals.map((c, i) => ({
      value: String(c.id),
      label: c.name || `Collection ${c.id}`,
      detail: `${Number(c.asset_count || 0)} files`,
      last: i === manuals.length - 1,
    })),
  });
  if (!choice) return;
  await api(`/api/collections/${choice}/assets`, {
    method: "POST",
    body: JSON.stringify({ ids }),
  });
  await loadCollections();
  psToast("Added to collection", `${ids.length} file${ids.length === 1 ? "" : "s"}`, "ok");
}

async function loadFolders() {
  const cfg = await api("/api/config");
  folders = cfg.watched_folders || [];
  ignoreGlobs = cfg.ignore_globs || [];
  fillRootFilter();
  renderFolders();
  renderIgnoreGlobs();
}

async function saveIgnoreGlobs() {
  const raw = $("ignoreGlobsInput")?.value || "";
  const patterns = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out = await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({ watched_folders: folders, ignore_globs: patterns }),
  });
  folders = out.watched_folders || folders;
  ignoreGlobs = out.ignore_globs || patterns;
  fillRootFilter();
  renderFolders();
  renderIgnoreGlobs();
  psToast("Exclude patterns saved", "Takes effect on the next Rescan.", "ok");
}

function renderFolders() {
  const el = $("folderList");
  if (!folders.length) {
    el.innerHTML = `<p class="lede">No folders yet.</p>`;
    return;
  }
  el.innerHTML = folders.map((f, i) => {
    const hint = f.path_hint || (!f.path_ok ? "Path not found on the Pi" : "");
    return `
    <div class="folder-row${f.path_ok === false ? " folder-row-warn" : ""}">
      <div>
        <strong>${escapeHtml(f.label || f.id)}</strong><br>
        <span class="pill">${escapeHtml(f.source_kind)}</span>
        ${f.path_ok === false ? `<span class="pill warn">missing on Pi</span>` : ""}
      </div>
      <div class="detail-path" style="margin:0">
        ${escapeHtml(f.path)}
        ${f.windows_path ? `<br><span class="pill">win</span> ${escapeHtml(f.windows_path)}` : "<br><span class=\"pill\">no Windows path</span>"}
        ${hint ? `<br><span class="folder-path-warn">${escapeHtml(hint)}</span>` : ""}
      </div>
      <button type="button" data-i="${i}" class="secondary remove-folder">Remove</button>
    </div>`;
  }).join("");
  el.querySelectorAll(".remove-folder").forEach((btn) => {
    btn.addEventListener("click", () => {
      folders.splice(Number(btn.dataset.i), 1);
      renderFolders();
    });
  });
}

async function saveFolders() {
  const out = await api("/api/config", {
    method: "PUT",
    body: JSON.stringify({ watched_folders: folders }),
  });
  folders = out.watched_folders || folders;
  fillRootFilter();
  renderFolders();
  await refreshStats();
  if (out.warnings?.length) {
    psToast("Folders saved — path problem", out.warnings.join(" · "), "error");
  } else {
    psToast("Folders saved", "Paths look good on the Pi.", "ok");
  }
}

function bind() {
  $("psModalCancel")?.addEventListener("click", () => closePsModal(false));
  $("psModalConfirm")?.addEventListener("click", () => closePsModal(true));
  $("psModalRoot")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-ps-modal-dismiss]")) closePsModal(false);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".card-menu, .detail-menu")) closeCardMenus();
    if (!e.target.closest("#typeMenuWrap")) closeTypeMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCardMenus();
      if ($("psModalRoot") && !$("psModalRoot").hidden) closePsModal(false);
    }
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
  renderTypeMenu();
  $("typeMenuBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const wrap = $("typeMenuWrap");
    if (!wrap) return;
    wrap.classList.toggle("open");
    syncTypeMenuUi();
  });
  ["search", "filterSource", "filterRoot", "filterFilament", "filterCollection", "sortBy", "filterTextures", "filterSliced", "filterHidden"].forEach((id) => {
    $(id)?.addEventListener("input", () => loadLibrary().catch(console.error));
    $(id)?.addEventListener("change", () => loadLibrary().catch(console.error));
  });
  $("typeTabs")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".type-tab");
    if (!btn || btn.hidden) return;
    setActiveKind(btn.dataset.kind || "");
    clearSelection();
    // Duplicates is a flat sweep across the library.
    if ((btn.dataset.kind || "") === "__duplicates__") {
      browseMode = "all";
      document.querySelectorAll(".view-mode").forEach((b) => {
        b.classList.toggle("active", b.dataset.mode === "all");
      });
    }
    loadLibrary().catch(console.error);
  });
  $("viewModes")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".view-mode");
    if (!btn) return;
    browseMode = btn.dataset.mode || "folders";
    document.querySelectorAll(".view-mode").forEach((b) => {
      b.classList.toggle("active", b === btn);
    });
    if (browseMode === "folders") {
      // keep current place; if coming from all-files, start at roots
      if (!browseRootId) browseFolder = "";
    }
    clearSelection();
    loadLibrary().catch(console.error);
  });
  $("bulkSelectAllBtn")?.addEventListener("click", () => {
    for (const item of libraryItems) selectedIds.add(item.id);
    lastSelectAnchorId = libraryItems[0] ? Number(libraryItems[0].id) : null;
    syncSelectionUi();
  });
  $("bulkClearBtn")?.addEventListener("click", () => clearSelection());
  $("bulkHideBtn")?.addEventListener("click", async () => {
    try {
      const ids = [...selectedIds];
      await hideIds(ids);
      psToast("Hidden from library", fileCountLabel(ids.length), "ok");
    } catch (err) {
      psToast("Hide failed", String(err.message || err), "error");
    }
  });
  $("bulkUnhideBtn")?.addEventListener("click", async () => {
    try {
      const ids = [...selectedIds];
      await unhideIds(ids);
      psToast("Unhidden", fileCountLabel(ids.length), "ok");
    } catch (err) {
      psToast("Unhide failed", String(err.message || err), "error");
    }
  });
  $("bulkAddCollectionBtn")?.addEventListener("click", () => {
    addSelectedToCollection().catch((err) => psToast("Add to collection failed", String(err.message || err), "error"));
  });
  $("bulkDeleteBtn")?.addEventListener("click", async () => {
    try {
      const ids = [...selectedIds];
      const names = libraryItems.filter((x) => ids.includes(x.id)).map((x) => x.file_name);
      await deleteIdsFromDisk(ids, { names });
    } catch (err) {
      psToast("Delete failed", String(err.message || err), "error");
    }
  });
  $("refreshLibraryBtn")?.addEventListener("click", () => {
    // Refresh = look on disk (scoped to current root in Folders), then reload the grid.
    refreshLibraryView({ rescan: true }).catch(console.error);
  });
  $("scanBannerRefreshBtn")?.addEventListener("click", () => {
    refreshLibraryView({ rescan: false }).catch(console.error);
  });
  $("scanBtn").addEventListener("click", async () => {
    $("scanBtn").disabled = true;
    try {
      await api("/api/scan", { method: "POST", body: "{}" });
      await refreshStats(); // starts live scan banner + watch
    } catch (err) {
      $("scanStatus").textContent = String(err.message || err);
      $("scanBtn").disabled = false;
    }
  });
  $("rebuildThumbsBtn").addEventListener("click", async () => {
    $("rebuildThumbsBtn").disabled = true;
    try {
      await api("/api/thumbs/rebuild", { method: "POST", body: "{}" });
      await refreshStats(); // status line shows Thumbs… and Scan… together
    } catch (err) {
      $("scanStatus").textContent = String(err.message || err);
      $("rebuildThumbsBtn").disabled = false;
    }
  });
  $("scanIssuesBtn")?.addEventListener("click", async () => {
    switchView("settings");
    setWatchedFoldersCollapsed(true);
    $("scanIssuesList")?.scrollIntoView({ behavior: "smooth", block: "start" });
    await loadScanIssues();
  });
  $("refreshIssuesBtn")?.addEventListener("click", () => loadScanIssues().catch(console.error));
  $("retryAllIssuesBtn")?.addEventListener("click", async () => {
    try {
      await api("/api/scan_issues/retry", { method: "POST", body: JSON.stringify({ ids: [] }) });
      psToast("Retry started", "Rescanning roots with unresolved issues.", "ok");
      await refreshStats();
      await loadScanIssues();
    } catch (err) {
      psToast("Retry failed", String(err.message || err), "error");
    }
  });
  $("folderForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const path = String(fd.get("path") || "").trim();
    const looksWindows = /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || (path.includes("\\") && !path.startsWith("/"));
    if (looksWindows) {
      psToast(
        "Use a Pi path",
        "PrintShelf scans from the Pi. Put files on the NAS (/mnt/koko-kidabah/…) or mount that folder on the Pi — C:\\… won’t work here.",
        "error",
      );
      return;
    }
    folders.push({
      id: String(fd.get("id") || "").trim(),
      label: String(fd.get("label") || "").trim(),
      path,
      windows_path: String(fd.get("windows_path") || "").trim(),
      source_kind: String(fd.get("source_kind") || "local"),
    });
    e.target.reset();
    renderFolders();
  });
  $("saveFoldersBtn").addEventListener("click", () => saveFolders().catch(console.error));
  $("saveIgnoreBtn")?.addEventListener("click", () => saveIgnoreGlobs().catch(console.error));
  $("watchedFoldersToggle")?.addEventListener("click", () => {
    const isCollapsed = $("watchedFoldersBody")?.classList.contains("settings-collapsed");
    setWatchedFoldersCollapsed(!isCollapsed);
  });
  try {
    const collapsed = localStorage.getItem(WATCHED_FOLDERS_COLLAPSED_KEY) === "1";
    setWatchedFoldersCollapsed(collapsed);
  } catch (_) {
    setWatchedFoldersCollapsed(false);
  }
  $("collectionForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    saveCollectionFromForm().catch((err) => psToast("Save collection failed", String(err.message || err), "error"));
  });
  $("collectionResetBtn")?.addEventListener("click", () => resetCollectionForm());
}

async function boot() {
  bind();
  await loadFolders();
  await loadCollections();
  await loadFilaments();
  await loadScanIssues();
  await refreshStats();
  await loadLibrary();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot().catch((err) => {
  $("railStats").textContent = String(err.message || err);
});
