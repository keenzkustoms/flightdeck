const $ = (id) => document.getElementById(id);

function extLabel(name) {
  const base = String(name || "").split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot < 0) return "DOC";
  return base.slice(dot + 1).toUpperCase().slice(0, 8) || "DOC";
}

let selected = null;
let browse = { path: "", name: "" };
let folderBrowse = null;
let libraryRoots = [];
let pathFile = "";
let pathStatus = "Pick a folder";
let addingTo = "";
let printableWas = null;
let pickAnchor = null;
const picked = new Map();
let libraryBrowse = null;
let searchQuery = "";
let searchToken = 0;
let searchTimer = 0;
let galleryOffset = 0;
let cols = "4";
const favourites = new Set();
const thumbCache = new Map();
const thumbQueue = [];
let thumbBusy = false;

function fileUrl(item) {
  const q = new URLSearchParams({ path: item.path, entry: item.entry || "" });
  return `/api/file?${q}`;
}

function previewUrl(item) {
  const q = new URLSearchParams({ path: item.path, entry: item.entry || "" });
  return `/api/preview?${q}`;
}

function thumbRank(item) {
  const kind = item.kind === "stl" ? 0 : 1;
  return kind * 1e15 + (Number(item.size) || 0);
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function hideStage() {
  $("viewer").hidden = true;
  $("picture").hidden = true;
  $("doc").hidden = true;
  $("empty").hidden = true;
  $("gallery").hidden = true;
  window.MeshFinderViewer?.unmountViewer?.();
}

function showEmpty(text) {
  hideStage();
  $("empty").hidden = false;
  $("empty").textContent = text;
  $("backBtn").hidden = !browse.path;
}

function showGallery() {
  hideStage();
  $("gallery").hidden = false;
  $("backBtn").hidden = true;
  $("openFile").disabled = true;
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function pumpThumbs() {
  if (thumbBusy) return;
  if (!window.MeshFinderViewer?.renderThumb) {
    setTimeout(pumpThumbs, 50);
    return;
  }
  const job = thumbQueue.shift();
  if (!job) return;
  if (!job.img.isConnected) {
    pumpThumbs();
    return;
  }
  thumbBusy = true;
  window.MeshFinderViewer.renderThumb(previewUrl(job.item), job.item.kind)
    .then((url) => {
      thumbCache.set(job.key, url);
      if (job.img.isConnected) job.img.src = url;
    })
    .catch(() => {})
    .finally(() => {
      thumbBusy = false;
      pumpThumbs();
    });
}

function queueThumb(item, img) {
  const key = `${item.path}\n${item.entry || ""}`;
  if (thumbCache.has(key)) {
    img.src = thumbCache.get(key);
    return;
  }
  thumbQueue.push({ item, img, key });
  thumbQueue.sort((a, b) => thumbRank(a.item) - thumbRank(b.item));
  pumpThumbs();
}

function favKey(item) {
  return `${item.path}\n${item.entry || ""}`;
}

function zipName(item) {
  if (!item.entry) return "";
  const parts = String(item.path || "").split(/[/\\]/);
  return parts[parts.length - 1] || "";
}

function paintHeart(button, on) {
  button.classList.toggle("on", on);
  button.textContent = on ? "♥" : "♡";
  button.title = on ? "Remove from favourites" : "Add to favourites";
}

async function refreshFavs() {
  const data = await api("/api/favourites");
  favourites.clear();
  for (const item of data.items || []) favourites.add(favKey(item));
  return data.items || [];
}

async function toggleFav(item, button) {
  const key = favKey(item);
  if (favourites.has(key)) {
    const q = new URLSearchParams({ path: item.path, entry: item.entry || "" });
    await api(`/api/favourites?${q}`, { method: "DELETE" });
    favourites.delete(key);
    paintHeart(button, false);
    if (browse.path === "favourites") button.closest(".model-card")?.remove();
    return;
  }
  await api("/api/favourites", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: item.path,
      entry: item.entry || "",
      name: item.name,
      kind: item.kind,
      size: item.size || 0,
    }),
  });
  favourites.add(key);
  paintHeart(button, true);
}

function renderCard(item) {
  const card = document.createElement("div");
  card.className = "model-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.dataset.key = favKey(item);
  const thumb = document.createElement("div");
  thumb.className = "model-thumb";
  const img = document.createElement("img");
  img.alt = "";
  const kind = document.createElement("span");
  kind.className = "model-kind";
  kind.textContent = item.kind === "doc" ? extLabel(item.name) : item.kind.toUpperCase();
  thumb.appendChild(kind);
  const heart = document.createElement("button");
  heart.type = "button";
  heart.className = "fav-btn";
  paintHeart(heart, favourites.has(favKey(item)));
  heart.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleFav(item, heart).catch((err) => showEmpty(err.message || String(err)));
  });
  thumb.appendChild(heart);
  if (item.kind === "image" || item.kind === "svg") {
    img.src = fileUrl(item);
    thumb.appendChild(img);
    kind.remove();
  } else if (item.kind === "stl" || item.kind === "obj" || item.kind === "3mf" || item.kind === "gcode.3mf" || item.kind === "doc") {
    img.src = previewUrl(item);
    thumb.appendChild(img);
    img.addEventListener("load", () => kind.remove());
  }
  const body = document.createElement("div");
  body.className = "model-body";
  const tags = document.createElement("div");
  tags.className = "model-tags";
  const pill = document.createElement("span");
  pill.className = "kind-pill";
  pill.textContent = item.kind === "doc" ? extLabel(item.name) : item.kind.toUpperCase();
  tags.appendChild(pill);
  const zip = zipName(item);
  if (zip) {
    const zipEl = document.createElement("span");
    zipEl.className = "zip-name";
    zipEl.title = zip;
    zipEl.textContent = zip;
    tags.appendChild(zipEl);
  }
  const name = document.createElement("div");
  name.className = "model-name";
  name.textContent = item.name;
  name.title = item.name;
  const meta = document.createElement("div");
  meta.className = "model-meta";
  meta.textContent = fmtBytes(item.size);
  const foot = document.createElement("div");
  foot.className = "model-foot";
  foot.appendChild(meta);
  if (item.kind === "stl" || item.kind === "obj" || item.kind === "3mf" || item.kind === "gcode.3mf" || item.kind === "gcode") {
    const tech = document.createElement("span");
    tech.className = "tech-tag";
    tech.textContent = "FDM";
    foot.appendChild(tech);
  }
  body.appendChild(tags);
  body.appendChild(name);
  body.appendChild(foot);
  card.appendChild(thumb);
  card.appendChild(body);
  card._item = item;
  if (picked.has(favKey(item))) card.classList.add("picked");
  card.addEventListener("click", (event) => {
    if (!addingTo) {
      selectFile(item, card);
      return;
    }
    if (event.shiftKey && pickAnchor) {
      event.preventDefault();
      selectPickRange(pickAnchor, card);
      return;
    }
    togglePick(item, card);
    pickAnchor = card;
  });
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    showCardMenu(event.clientX, event.clientY, item, card);
  });
  return card;
}

function splitLibraryPath(full) {
  const norm = String(full || "").replaceAll("/", "\\").replace(/\\+$/, "");
  let best = "";
  for (const root of libraryRoots) {
    const candidate = String(root).replaceAll("/", "\\").replace(/\\+$/, "");
    const low = norm.toLowerCase();
    const rootLow = candidate.toLowerCase();
    if ((low === rootLow || low.startsWith(`${rootLow}\\`)) && candidate.length > best.length) best = candidate;
  }
  if (!best) {
    const name = baseName(norm);
    return name ? [{ name, path: norm }] : [];
  }
  const rest = norm.slice(best.length).replace(/^\\+/, "");
  const parts = [{ name: baseName(best) || best, path: best }];
  let acc = best;
  for (const bit of rest.split("\\")) {
    if (!bit) continue;
    acc = `${acc}\\${bit}`;
    parts.push({ name: bit, path: acc });
  }
  return parts;
}

function pathSep() {
  const span = document.createElement("span");
  span.className = "path-sep";
  span.setAttribute("aria-hidden", "true");
  span.textContent = "›";
  return span;
}

function renderPath(status) {
  if (typeof status === "string") pathStatus = status;
  const segs = $("pathsegs");
  if (!segs) return;
  segs.innerHTML = "";
  const titles = { favourites: "Favourites", search: "Search", collections: browse.name || "Collections", duplicates: "Duplicates" };
  if (!browse.path || titles[browse.path]) {
    const label = document.createElement("span");
    label.className = "path-current";
    label.textContent = titles[browse.path] || "Library";
    segs.appendChild(label);
  } else {
    const parts = splitLibraryPath(browse.path);
    parts.forEach((part, index) => {
      if (index) segs.appendChild(pathSep());
      const last = index === parts.length - 1 && !pathFile;
      if (last) {
        const current = document.createElement("span");
        current.className = "path-current";
        current.textContent = part.name;
        segs.appendChild(current);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "path-seg";
      button.textContent = part.name;
      button.addEventListener("click", () => {
        openCrumb(part.path, part.name).catch((err) => showEmpty(err.message || String(err)));
      });
      segs.appendChild(button);
    });
    if (pathFile) {
      segs.appendChild(pathSep());
      const current = document.createElement("span");
      current.className = "path-current";
      current.textContent = pathFile;
      segs.appendChild(current);
    }
  }
  $("crumb").textContent = pathFile ? "" : pathStatus;
}

async function openCrumb(path, name) {
  pathFile = "";
  selected = null;
  $("search").value = "";
  searchQuery = "";
  searchToken += 1;
  try {
    await expandTo(path);
  } catch {
    /* the gallery still opens if the tree cannot walk that far */
  }
  await loadGallery(path, name || baseName(path));
}

async function goPathHome() {
  pathFile = "";
  if (browse.path && !["favourites", "search", "collections", "duplicates"].includes(browse.path)) {
    const top = splitLibraryPath(browse.path)[0];
    if (top) {
      await openCrumb(top.path, top.name);
      return;
    }
  }
  if (folderBrowse?.path && !["favourites", "search", "collections", "duplicates"].includes(folderBrowse.path)) {
    await openCrumb(folderBrowse.path, folderBrowse.name);
    return;
  }
  if (libraryRoots[0]) await openCrumb(libraryRoots[0], baseName(libraryRoots[0]));
}

function mountSplit() {
  const split = $("split");
  if (!split) return;
  const saved = Number(localStorage.getItem("meshfinder.treeWidth"));
  if (saved >= 180 && saved <= 640) document.documentElement.style.setProperty("--tree-width", `${saved}px`);
  let drag = null;
  const widthAt = (clientX) => {
    const next = drag.width + (clientX - drag.x);
    return Math.min(640, Math.max(180, next));
  };
  split.addEventListener("pointerdown", (event) => {
    drag = { x: event.clientX, width: $("tree").parentElement.getBoundingClientRect().width };
    split.classList.add("dragging");
    split.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  split.addEventListener("pointermove", (event) => {
    if (!drag) return;
    document.documentElement.style.setProperty("--tree-width", `${widthAt(event.clientX)}px`);
  });
  const finish = (event) => {
    if (!drag) return;
    const width = widthAt(event.clientX);
    drag = null;
    split.classList.remove("dragging");
    localStorage.setItem("meshfinder.treeWidth", String(Math.round(width)));
  };
  split.addEventListener("pointerup", finish);
  split.addEventListener("pointercancel", finish);
  split.addEventListener("dblclick", () => {
    document.documentElement.style.setProperty("--tree-width", "240px");
    localStorage.setItem("meshfinder.treeWidth", "240");
  });
}

async function loadGallery(path, name, { append = false } = {}) {
  if (!append) {
    pathFile = "";
    browse = { path, name: name || path };
    galleryOffset = 0;
    thumbQueue.length = 0;
    $("gallery").innerHTML = `<div class="note">Gathering models…</div>`;
    showGallery();
  }
  const q = new URLSearchParams({
    path,
    recursive: $("showAll").checked ? "1" : "0",
    printable: $("printable").checked ? "1" : "0",
    offset: String(galleryOffset),
    limit: "120",
  });
  const data = await api(`/api/gallery?${q}`);
  const host = $("gallery");
  if (!append) host.innerHTML = "";
  host.querySelector(".more-row")?.remove();
  const items = data.items || [];
  if (!items.length && !append) {
    host.innerHTML = `<div class="note">Nothing in this folder. Open one on the left, or turn on All to include subfolders.</div>`;
  }
  for (const item of items) host.appendChild(renderCard(item));
  galleryOffset += items.length;
  const shown = galleryOffset;
  const more = data.truncated ? " · more below" : "";
  renderPath(`${browse.name || "Library"} · ${shown} shown${more}`);
  if (data.truncated) {
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "text-btn more-row";
    moreBtn.textContent = "Show more";
    moreBtn.addEventListener("click", () => {
      loadGallery(browse.path, browse.name, { append: true }).catch((err) => showEmpty(err.message || String(err)));
    });
    host.appendChild(moreBtn);
  }
  if (!append) saveSession();
}

function leaveSearch() {
  searchToken += 1;
  searchQuery = "";
  const back = libraryBrowse;
  if (!back?.path || back.path === "search") return;
  if (back.path === "favourites") {
    showFavourites().catch((err) => showEmpty(err.message || String(err)));
    return;
  }
  if (back.path === "duplicates") {
    showDuplicates().catch((err) => showEmpty(err.message || String(err)));
    return;
  }
  loadGallery(back.path, back.name).catch((err) => showEmpty(err.message || String(err)));
}

async function loadSearch(query, { append = false } = {}) {
  const token = ++searchToken;
  const sameQuery = searchQuery === query && browse.path === "search";
  searchQuery = query;
  if (browse.path !== "search") libraryBrowse = { path: browse.path, name: browse.name };
  if (!append) {
    pathFile = "";
    browse = { path: "search", name: "Search" };
    galleryOffset = 0;
    thumbQueue.length = 0;
    if (!sameQuery) $("gallery").innerHTML = `<div class="note">Searching…</div>`;
    showGallery();
  }
  const q = new URLSearchParams({
    q: query,
    printable: $("printable").checked ? "1" : "0",
    offset: String(galleryOffset),
    limit: "120",
  });
  const data = await api(`/api/search?${q}`);
  if (token !== searchToken) return;
  const host = $("gallery");
  if (!append) host.innerHTML = "";
  host.querySelector(".more-row")?.remove();
  const items = data.items || [];
  if (!items.length && !append) {
    const hint = data.indexing
      ? "Searching file names…"
      : ($("printable").checked
        ? "Nothing matched. Turn Printable off to include pictures, SVGs, and documents."
        : "Nothing matched.");
    host.innerHTML = `<div class="note">${hint}</div>`;
  }
  for (const item of items) host.appendChild(renderCard(item));
  galleryOffset += items.length;
  const more = data.truncated ? " · more below" : "";
  const pending = data.indexing ? " · still reading zip files" : "";
  renderPath(`Search “${query}” · ${galleryOffset} shown${more}${pending}`);
  if (data.indexing && token === searchToken) {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      if (searchQuery === query) {
        loadSearch(query).catch((err) => showEmpty(err.message || String(err)));
      }
    }, 2000);
  }
  if (data.truncated) {
    const moreBtn = document.createElement("button");
    moreBtn.type = "button";
    moreBtn.className = "text-btn more-row";
    moreBtn.textContent = "Show more";
    moreBtn.addEventListener("click", () => {
      loadSearch(searchQuery, { append: true }).catch((err) => showEmpty(err.message || String(err)));
    });
    host.appendChild(moreBtn);
  }
}

async function selectFile(item, card) {
  selected = item;
  document.querySelectorAll(".model-card").forEach((el) => el.classList.remove("active"));
  card?.classList.add("active");
  $("openFile").disabled = false;
  $("backBtn").hidden = false;
  pathFile = item.name;
  renderPath();
  const url = fileUrl(item);
  if (item.kind === "stl" || item.kind === "obj" || item.kind === "3mf" || item.kind === "gcode.3mf") {
    hideStage();
    $("backBtn").hidden = false;
    $("viewer").hidden = false;
    if (!window.MeshFinderViewer?.mountViewer) {
      showEmpty("The 3D viewer did not start.");
      return;
    }
    try {
      await window.MeshFinderViewer.mountViewer($("viewer"), { url, kind: item.kind });
    } catch (err) {
      showEmpty(err.message || String(err));
    }
    return;
  }
  if (item.kind === "image" || item.kind === "svg") {
    hideStage();
    $("backBtn").hidden = false;
    $("picture").hidden = false;
    $("picture").innerHTML = "";
    const img = document.createElement("img");
    img.alt = item.name;
    img.src = url;
    $("picture").appendChild(img);
    return;
  }
  if (item.kind === "doc") {
    hideStage();
    $("backBtn").hidden = false;
    $("doc").hidden = false;
    $("doc").innerHTML = "";
    if (item.name.toLowerCase().endsWith(".pdf")) {
      const frame = document.createElement("iframe");
      frame.src = url;
      $("doc").appendChild(frame);
      return;
    }
    const res = await fetch(url);
    $("doc").textContent = await res.text();
    return;
  }
  showEmpty("This one opens with Open in slicer.");
  $("backBtn").hidden = false;
}

const excludePicks = new Set();

function excludeLabel() {
  const button = $("excludeBtn");
  if (!button) return;
  const count = excludePicks.size;
  button.hidden = count === 0;
  button.textContent = count === 1 ? "1 folder to exclude" : `${count} folders to exclude`;
}

function removeExcludedRows(paths) {
  const tree = $("tree");
  const scroll = tree.scrollTop;
  for (const path of paths) {
    const row = document.querySelector(`.tree-row[data-path="${CSS.escape(path)}"]`);
    const wrap = row?.closest(".tree-item") || row?.parentElement;
    if (document.activeElement && wrap?.contains(document.activeElement)) document.activeElement.blur();
    wrap?.remove();
    excludePicks.delete(path);
  }
  const keep = () => { tree.scrollTop = scroll; };
  keep();
  requestAnimationFrame(keep);
  excludeLabel();
  saveSession();
}

async function excludePaths(paths) {
  const saved = [];
  try {
    for (const path of paths) {
      await api("/api/exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      saved.push(path);
    }
  } finally {
    if (saved.length) removeExcludedRows(saved);
  }
}

function treeKids(row) {
  const kids = row?.parentElement?.nextElementSibling;
  if (kids?.classList.contains("tree-children")) return kids;
  return row?.nextElementSibling?.classList.contains("tree-children") ? row.nextElementSibling : null;
}

function folderRow(item, depth) {
  const wrap = document.createElement("div");
  wrap.className = "tree-item";
  const line = document.createElement("div");
  line.className = "tree-line";
  line.style.paddingLeft = `${depth * 14}px`;
  const row = document.createElement("button");
  row.type = "button";
  row.className = "tree-row";
  row.dataset.path = item.path;
  row.dataset.depth = String(depth);
  const mark = item.kind === "zip" || item.kind === "zipdir" ? "zip" : "dir";
  row.innerHTML = `<span class="twist" aria-hidden="true"></span><span class="mark">${mark}</span><span class="name"></span>`;
  row.querySelector(".name").textContent = item.name;
  if (item.kind !== "zipdir") {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "tree-check";
    box.title = "Mark this folder to exclude";
    box.checked = excludePicks.has(item.path);
    box.addEventListener("click", () => {
      if (box.checked) excludePicks.add(item.path);
      else excludePicks.delete(item.path);
      excludeLabel();
    });
    line.appendChild(box);
  }
  const children = document.createElement("div");
  children.className = "tree-children";
  children.hidden = true;
  row.addEventListener("pointerdown", (event) => {
    row.dataset.button = String(event.button);
    if (event.button !== 0) event.preventDefault();
  });
  row.addEventListener("contextmenu", (event) => {
    if (item.kind === "zipdir") return;
    event.preventDefault();
    event.stopPropagation();
    showTreeMenu(event.clientX, event.clientY, item);
  });
  row.addEventListener("click", async (event) => {
    if (event.target.closest(".tree-check")) return;
    if (row.dataset.button && row.dataset.button !== "0") {
      row.dataset.button = "0";
      return;
    }
    const open = children.childElementCount > 0 && !children.hidden;
    document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
    if (open) {
      children.hidden = true;
      row.classList.remove("open");
      saveSession();
      return;
    }
    $("search").value = "";
    searchQuery = "";
    searchToken += 1;
    await loadGallery(item.path, item.name);
    if (!children.dataset.loaded) {
      children.dataset.loaded = "1";
      const q = new URLSearchParams({ path: item.path });
      if (item.prefix) q.set("prefix", item.prefix);
      const data = await api(`/api/list?${q}`);
      const folders = (data.folders || []).slice(0, 400);
      if (!folders.length) {
        children.hidden = true;
        row.classList.remove("open");
        saveSession();
        return;
      }
      for (const folder of folders) children.appendChild(folderRow(folder, depth + 1));
    }
    if (children.childElementCount) {
      children.hidden = false;
      row.classList.add("open");
    }
    saveSession();
  });
  line.appendChild(row);
  wrap.appendChild(line);
  wrap.appendChild(children);
  return wrap;
}

function rememberFolder() {
  if (browse.path && !["favourites", "search", "collections", "duplicates"].includes(browse.path)) {
    folderBrowse = { path: browse.path, name: browse.name };
  }
}

function collectionsRow() {
  const wrap = document.createElement("div");
  const row = document.createElement("button");
  row.type = "button";
  row.className = "tree-row";
  row.style.paddingLeft = "8px";
  row.innerHTML = `<span class="mark">col</span><span class="name">Collections</span>`;
  row.addEventListener("click", async () => {
    document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
    $("search").value = "";
    searchQuery = "";
    searchToken += 1;
    await showCollections();
  });
  wrap.appendChild(row);
  return wrap;
}

async function showCollections() {
  rememberFolder();
  browse = { path: "collections", name: "Collections" };
  showGallery();
  const data = await api("/api/collections");
  const groups = data.items || [];
  const host = $("gallery");
  host.innerHTML = "";
  const page = document.createElement("div");
  page.className = "collect-page";
  page.innerHTML = `<div class="collect-head"><div><div class="collect-name">Collections</div><div class="collect-meta">${groups.length} collection${groups.length === 1 ? "" : "s"}</div></div><button type="button" class="open-btn" data-act="new">New collection</button></div>`;
  const list = document.createElement("div");
  list.className = "collect-list";
  if (!groups.length) {
    list.innerHTML = `<div class="note">No collections yet. Create one to group files across folders.</div>`;
  }
  for (const group of groups) list.appendChild(collectionCard(group));
  page.appendChild(list);
  host.appendChild(page);
  pathFile = "";
  renderPath(`Collections · ${groups.length}`);
}

function collectionCard(group) {
  const card = document.createElement("div");
  card.className = "collect-card";
  const count = (group.items || []).length;
  const info = document.createElement("div");
  const title = document.createElement("button");
  title.type = "button";
  title.className = "text-btn collect-name";
  title.textContent = group.name;
  title.addEventListener("click", () => showCollection(group));
  const meta = document.createElement("div");
  meta.className = "collect-meta";
  meta.textContent = count === 1 ? "1 item" : `${count} items`;
  info.appendChild(title);
  info.appendChild(meta);
  const actions = document.createElement("div");
  const add = document.createElement("button");
  add.type = "button";
  add.className = "text-btn";
  add.textContent = "Add models";
  add.addEventListener("click", () => startAdding(group.name));
  const rename = document.createElement("button");
  rename.type = "button";
  rename.className = "text-btn";
  rename.textContent = "Rename";
  rename.addEventListener("click", () => renameCollection(group.name));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "text-btn";
  remove.textContent = "Delete";
  remove.addEventListener("click", () => deleteCollection(group.name));
  actions.append(add, rename, remove);
  card.append(info, actions);
  return card;
}

async function showCollection(group) {
  rememberFolder();
  browse = { path: "collections", name: group.name };
  showGallery();
  const host = $("gallery");
  host.innerHTML = "";
  const items = group.items || [];
  if (!items.length) {
    host.innerHTML = `<div class="note">Nothing in ${group.name} yet.</div>`;
  }
  for (const item of items) host.appendChild(renderCard(item));
  pathFile = "";
  renderPath(`${group.name} · ${items.length}`);
}

let dialogSubmit = null;

function openDialog({ title, placeholder, value, submit, choices, onSubmit }) {
  dialogSubmit = onSubmit;
  $("collectTitle").textContent = title;
  $("collectName").placeholder = placeholder || "";
  $("collectName").value = value || "";
  $("collectSubmit").textContent = submit || "Create";
  const list = $("collectChoices");
  list.innerHTML = "";
  list.hidden = !choices?.length;
  for (const choice of choices || []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-btn";
    button.textContent = choice.label;
    button.addEventListener("click", () => {
      closeCollectDialog();
      Promise.resolve(choice.onPick()).catch((err) => showEmpty(err.message || String(err)));
    });
    list.appendChild(button);
  }
  $("collectDialog").hidden = false;
  $("collectName").focus();
  $("collectName").select();
}

function openCollectDialog() {
  openDialog({
    title: "New collection",
    placeholder: "Collection name",
    submit: "Create",
    onSubmit: async (name) => {
      await api("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      await showCollections();
    },
  });
}

function closeCollectDialog() {
  $("collectDialog").hidden = true;
  dialogSubmit = null;
}

async function startAdding(name) {
  rememberFolder();
  addingTo = name;
  printableWas = $("printable").checked;
  $("printable").checked = false;
  pickAnchor = null;
  picked.clear();
  $("addTitle").textContent = `Adding to "${name}"`;
  $("addBanner").hidden = false;
  updatePickBar();
  const back = folderBrowse;
  if (back?.path) {
    await loadGallery(back.path, back.name);
    return;
  }
  const data = await api("/api/list");
  const first = (data.folders || [])[0];
  if (first) await loadGallery(first.path, first.name);
}

function stopAdding() {
  const wasOff = printableWas === false;
  addingTo = "";
  pickAnchor = null;
  picked.clear();
  $("addBanner").hidden = true;
  $("pickBar").hidden = true;
  document.querySelectorAll(".model-card.picked").forEach((el) => el.classList.remove("picked"));
  if (printableWas !== null) $("printable").checked = printableWas;
  printableWas = null;
  if (!wasOff && folderBrowse?.path) {
    loadGallery(folderBrowse.path, folderBrowse.name).catch((err) => showEmpty(err.message || String(err)));
  }
}

function selectPickRange(from, to) {
  const cards = [...document.querySelectorAll("#gallery .model-card")];
  let start = cards.indexOf(from);
  let end = cards.indexOf(to);
  if (start < 0) start = end;
  if (end < 0) return;
  if (start > end) [start, end] = [end, start];
  for (let i = start; i <= end; i += 1) {
    const card = cards[i];
    const item = card._item;
    if (!item) continue;
    picked.set(favKey(item), item);
    card.classList.add("picked");
  }
  updatePickBar();
}

function togglePick(item, card) {
  const key = favKey(item);
  if (picked.has(key)) {
    picked.delete(key);
    card.classList.remove("picked");
  } else {
    picked.set(key, item);
    card.classList.add("picked");
  }
  updatePickBar();
}

function updatePickBar() {
  const count = picked.size;
  $("pickBar").hidden = !addingTo || count === 0;
  $("pickCount").textContent = count === 1 ? "1 selected" : `${count} selected`;
  $("pickAdd").textContent = `Add ${count} to "${addingTo}"`;
}

function renameCollection(name) {
  openDialog({
    title: "Rename collection",
    value: name,
    submit: "Rename",
    onSubmit: async (next) => {
      if (next === name) return;
      await api("/api/collections/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, newName: next }),
      });
      await showCollections();
    },
  });
}

async function deleteCollection(name) {
  if (!window.confirm(`Delete the collection "${name}"? The files stay where they are.`)) return;
  const q = new URLSearchParams({ name });
  await api(`/api/collections?${q}`, { method: "DELETE" });
  await showCollections();
}

let restoring = false;
let sessionTimer = 0;

function saveSession() {
  if (restoring) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    const place = browse.path && !["favourites", "search", "collections", "duplicates"].includes(browse.path)
      ? { path: browse.path, name: browse.name }
      : (folderBrowse || { path: "", name: "" });
    const open = [...document.querySelectorAll(".tree-row[data-path]")].filter((row) => {
      const kids = treeKids(row);
      return kids && kids.classList.contains("tree-children") && !kids.hidden;
    }).map((row) => row.dataset.path);
    api("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        open,
        place,
        printable: $("printable").checked,
        showAll: $("showAll").checked,
      }),
    }).catch(() => {});
  }, 400);
}

async function expandTo(target) {
  let previous = "";
  for (let guard = 0; guard < 40; guard += 1) {
    const known = [...document.querySelectorAll(".tree-row[data-path]")].map((row) => row.dataset.path);
    const next = known
      .filter((path) => target.toLowerCase() === path.toLowerCase() || target.toLowerCase().startsWith(`${path.toLowerCase()}\\`))
      .sort((a, b) => b.length - a.length)[0];
    if (!next || next === previous) return;
    previous = next;
    const row = document.querySelector(`.tree-row[data-path="${CSS.escape(next)}"]`);
    const children = treeKids(row);
    if (!row || !children) return;
    children.hidden = false;
    if (!children.childElementCount) {
      const data = await api(`/api/list?${new URLSearchParams({ path: row.dataset.path })}`);
      const depth = Number(row.dataset.depth || 0) + 1;
      const folders = (data.folders || []).slice(0, 400);
      if (!folders.length) children.hidden = true;
      for (const folder of folders) children.appendChild(folderRow(folder, depth));
    }
    if (next.toLowerCase() === target.toLowerCase()) {
      document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
      row.classList.add("active");
      if (children.childElementCount && !children.hidden) row.classList.add("open");
      row.scrollIntoView({ block: "nearest" });
      return;
    }
    if (children.childElementCount && !children.hidden) row.classList.add("open");
  }
}

async function loadTree({ openPath = "", openName = "" } = {}) {
  excludePicks.clear();
  excludeLabel();
  await refreshFavs().catch(() => {});
  const session = openPath ? null : await api("/api/session").catch(() => null);
  if (session) {
    restoring = true;
    $("printable").checked = session.printable !== false;
    $("showAll").checked = !!session.showAll;
  }
  const data = await api("/api/list");
  libraryRoots = data.roots || (data.folders || []).map((folder) => folder.path);
  const pins = $("pins");
  pins.innerHTML = "";
  pins.appendChild(favouritesRow());
  pins.appendChild(collectionsRow());
  pins.appendChild(duplicatesRow());
  const host = $("tree");
  host.innerHTML = "";
  const folders = data.folders || [];
  for (const folder of folders) host.appendChild(folderRow(folder, 0));
  if (openPath) {
    restoring = false;
    await loadGallery(openPath, openName || baseName(openPath));
    return;
  }
  const place = session?.place?.path || "";
  if (place && !["favourites", "search", "collections", "duplicates"].includes(place)) {
    try {
      for (const path of session.open || []) await expandTo(path);
      await expandTo(place);
      restoring = false;
      await loadGallery(place, session.place.name || baseName(place));
      return;
    } catch {
      restoring = false;
    }
  }
  restoring = false;
  if (!folders.length) {
    host.insertAdjacentHTML("beforeend", `<div class="note">Add a folder to start.</div>`);
    return;
  }
  await loadGallery(folders[0].path, folders[0].name);
}

async function showFavourites() {
  rememberFolder();
  browse = { path: "favourites", name: "Favourites" };
  galleryOffset = 0;
  $("gallery").innerHTML = "";
  showGallery();
  const items = await refreshFavs();
  const host = $("gallery");
  if (!items.length) {
    host.innerHTML = `<div class="note">No favourites yet. Use the heart on a card.</div>`;
  }
  for (const item of items) host.appendChild(renderCard(item));
  pathFile = "";
  renderPath(`Favourites · ${items.length}`);
}

function favouritesRow() {
  const wrap = document.createElement("div");
  const row = document.createElement("button");
  row.type = "button";
  row.className = "tree-row";
  row.style.paddingLeft = "8px";
  row.innerHTML = `<span class="mark">fav</span><span class="name">Favourites</span>`;
  row.addEventListener("click", async () => {
    document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
    $("search").value = "";
    searchQuery = "";
    searchToken += 1;
    await showFavourites();
  });
  wrap.appendChild(row);
  return wrap;
}

let dupTimer = 0;
let lastDup = null;
const dupKeep = new Map();

function dupCopyKey(copy) {
  return `${copy.path}\0${copy.entry || ""}`;
}

function chosenKeep(group) {
  const copies = group.copies || [];
  const saved = dupKeep.get(group.hash);
  if (saved && copies.some((copy) => dupCopyKey(copy) === saved)) return saved;
  const looseLocal = copies.find((copy) => !copy.entry && !String(copy.path).startsWith("\\\\"));
  const loose = copies.find((copy) => !copy.entry);
  return dupCopyKey(looseLocal || loose || copies[0] || { path: "", entry: "" });
}

function dupWhere(copy) {
  if (copy.entry) return `${baseName(copy.path)} · ${copy.entry}`;
  return copy.path;
}

function dupGroup(group) {
  const card = document.createElement("div");
  card.className = "dup-group";
  const keep = chosenKeep(group);
  const copies = group.copies || [];
  const head = document.createElement("div");
  head.className = "dup-group-head";
  const label = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = copies[0]?.name || "File";
  const sub = document.createElement("div");
  sub.className = "dup-meta";
  sub.textContent = `${group.count} copies · ${fmtBytes(group.reclaimable)} spare`;
  label.append(strong, sub);
  head.appendChild(label);
  const spare = copies.filter((copy) => !copy.entry && dupCopyKey(copy) !== keep);
  if (spare.length) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "text-btn";
    button.textContent = spare.length === 1 ? "Delete spare" : `Delete ${spare.length} spares`;
    button.addEventListener("click", () => {
      deleteSpares(group, spare).catch((err) => showEmpty(err.message || String(err)));
    });
    head.appendChild(button);
  }
  card.appendChild(head);
  for (const copy of copies) {
    const row = document.createElement("div");
    row.className = "dup-copy";
    const where = document.createElement("div");
    where.className = "dup-where";
    where.title = dupWhere(copy);
    where.textContent = dupWhere(copy);
    row.appendChild(where);
    const key = dupCopyKey(copy);
    if (!copy.entry && key !== keep) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "text-btn";
      button.textContent = "Keep this one";
      button.addEventListener("click", () => {
        dupKeep.set(group.hash, key);
        if (lastDup) renderDuplicates(lastDup);
      });
      row.appendChild(button);
    } else {
      const tag = document.createElement("span");
      tag.className = "dup-tag";
      tag.textContent = copy.entry ? "in a zip" : "keep";
      row.appendChild(tag);
    }
    card.appendChild(row);
  }
  return card;
}

function renderDuplicates(data) {
  const host = $("gallery");
  host.innerHTML = "";
  const page = document.createElement("div");
  page.className = "dup-page";
  const head = document.createElement("div");
  head.className = "dup-head";
  const title = document.createElement("div");
  const name = document.createElement("div");
  name.className = "dup-title";
  name.textContent = "Duplicates";
  const meta = document.createElement("div");
  meta.className = "dup-meta";
  const foundBit = data.groupCount ? ` · ${data.groupCount} identical so far` : "";
  if (data.running) {
    meta.textContent = data.phase === "hashing"
      ? `Checking files that share a size · ${data.hashed || 0} checked${foundBit}`
      : `Looking through the library · ${data.scanned || 0} files${foundBit}`;
  } else if (data.error) {
    meta.textContent = data.error;
  } else if (data.phase === "partial") {
    meta.textContent = data.groupCount
      ? `${data.groupCount} identical files so far · scan stopped after ${data.scanned || 0} files`
      : `Scan stopped after ${data.scanned || 0} files. Analyze to keep going.`;
  } else if (data.groupCount) {
    const more = data.capped ? ` · showing ${(data.groups || []).length} largest` : "";
    meta.textContent = `${data.groupCount} identical file${data.groupCount === 1 ? "" : "s"} · ${fmtBytes(data.reclaimable)} spare${more}`;
  } else if (data.complete || data.built) {
    const checked = data.scanned ? `Checked ${data.scanned} files. ` : "";
    meta.textContent = `${checked}No identical copies.`;
  } else {
    meta.textContent = "Not checked yet. Analyze reads the library and lists copies.";
  }
  if ((data.warnings || []).length) meta.textContent += ` · ${data.warnings[0]}`;
  title.append(name, meta);
  const action = document.createElement("button");
  action.type = "button";
  action.className = "open-btn";
  action.textContent = data.running ? "Stop" : "Analyze";
  action.addEventListener("click", () => {
    const path = data.running ? "/api/duplicates/stop" : "/api/duplicates/analyze";
    api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(() => refreshDuplicates())
      .catch((err) => {
        if (lastDup && browse.path === "duplicates") {
          renderDuplicates({ ...lastDup, running: false, error: err.message || String(err) });
          return;
        }
        showEmpty(err.message || String(err));
      });
  });
  head.append(title, action);
  page.appendChild(head);
  if (data.running && !(data.groups || []).length) {
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = "Copies show up here as soon as two files match. Still reading the library.";
    page.appendChild(note);
  }
  if (!data.running && !(data.groups || []).length) {
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = data.phase === "partial"
      ? "Analyze again to walk the library from the start."
      : (data.complete || data.built)
        ? "Nothing to clean up."
        : "Analyze when you want a look. Matches show up while it is still reading.";
    page.appendChild(note);
  }
  for (const group of data.groups || []) page.appendChild(dupGroup(group));
  host.appendChild(page);
  pathFile = "";
  renderPath(meta.textContent);
}

async function deleteSpares(group, spare) {
  const network = spare.some((copy) => String(copy.path).startsWith("\\\\"));
  const noun = spare.length === 1 ? "this spare copy" : `${spare.length} spare copies`;
  const extra = network ? " One of them is on a network drive, which has no Trash." : "";
  if (!window.confirm(`Delete ${noun} for good?${extra} This cannot be undone.`)) return;
  const data = await api("/api/duplicates/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hash: group.hash,
      remove: spare.map((copy) => ({ path: copy.path, entry: "" })),
    }),
  });
  lastDup = data;
  if (browse.path === "duplicates") renderDuplicates(data);
}

async function refreshDuplicates() {
  const data = await api("/api/duplicates");
  if (browse.path !== "duplicates") return;
  lastDup = data;
  renderDuplicates(data);
  clearTimeout(dupTimer);
  if (data.running) {
    dupTimer = setTimeout(() => {
      refreshDuplicates().catch((err) => {
        if (browse.path !== "duplicates") return;
        dupTimer = setTimeout(() => {
          refreshDuplicates().catch(() => {});
        }, 2000);
        if (lastDup) renderDuplicates({ ...lastDup, error: err.message || String(err) });
      });
    }, 1500);
  }
}

async function showDuplicates() {
  rememberFolder();
  browse = { path: "duplicates", name: "Duplicates" };
  pathFile = "";
  showGallery();
  clearTimeout(dupTimer);
  $("gallery").innerHTML = `<div class="note">Looking up duplicates…</div>`;
  await refreshDuplicates();
}

function duplicatesRow() {
  const wrap = document.createElement("div");
  const row = document.createElement("button");
  row.type = "button";
  row.className = "tree-row";
  row.style.paddingLeft = "8px";
  row.innerHTML = `<span class="mark">dup</span><span class="name">Duplicates</span>`;
  row.addEventListener("click", async () => {
    document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
    row.classList.add("active");
    $("search").value = "";
    searchQuery = "";
    searchToken += 1;
    await showDuplicates();
  });
  wrap.appendChild(row);
  return wrap;
}

function parentFolder(item) {
  const parts = String(item.path || "").split(/[/\\]/);
  parts.pop();
  return parts.join("\\");
}

function baseName(path) {
  const parts = String(path || "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

async function fillTreeChildren(row) {
  const children = treeKids(row);
  if (!children) return;
  children.hidden = false;
  if (children.childElementCount) return;
  const q = new URLSearchParams({ path: row.dataset.path });
  const data = await api(`/api/list?${q}`);
  const depth = Number(row.dataset.depth || 0) + 1;
  for (const folder of (data.folders || []).slice(0, 400)) {
    children.appendChild(folderRow(folder, depth));
  }
}

async function goToLocation(item) {
  const folder = parentFolder(item);
  const rows = [...document.querySelectorAll(".tree-row[data-path]")];
  const root = rows
    .map((row) => row.dataset.path)
    .filter((path) => folder.toLowerCase() === path.toLowerCase() || folder.toLowerCase().startsWith(`${path.toLowerCase()}\\`))
    .sort((a, b) => b.length - a.length)[0];
  if (!root) {
    showEmpty("That folder is not in the library tree.");
    return;
  }
  let current = root;
  let row = document.querySelector(`.tree-row[data-path="${CSS.escape(current)}"]`);
  const rest = folder.slice(root.length).replace(/^[/\\]/, "");
  for (const part of rest.split(/[/\\]/).filter(Boolean)) {
    if (!row) break;
    await fillTreeChildren(row);
    current = `${current}\\${part}`;
    row = document.querySelector(`.tree-row[data-path="${CSS.escape(current)}"]`);
  }
  document.querySelectorAll(".tree-row").forEach((el) => el.classList.remove("active"));
  row?.classList.add("active");
  row?.scrollIntoView({ block: "nearest" });
  await loadGallery(folder, baseName(folder));
  const card = document.querySelector(`.model-card[data-key="${CSS.escape(favKey(item))}"]`);
  if (card) {
    document.querySelectorAll(".model-card").forEach((el) => el.classList.remove("active"));
    card.classList.add("active");
    card.scrollIntoView({ block: "center" });
  }
}

let menuItem = null;
let menuCard = null;
let menuMode = "card";

function hideCardMenu() {
  $("cardMenu").hidden = true;
  menuItem = null;
  menuCard = null;
}

function showTreeMenu(x, y, item) {
  menuMode = "tree";
  menuItem = item;
  menuCard = null;
  const menu = $("cardMenu");
  const actions = [
    ["explorer", "Show in Explorer"],
    ["rename", "Rename..."],
    ["exclude", "Exclude from library"],
    ["collection", "Add to collection"],
  ];
  menu.innerHTML = "";
  for (const [act, label] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.act = act;
    button.textContent = label;
    menu.appendChild(button);
  }
  menu.hidden = false;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - 220))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - 46 * actions.length))}px`;
}

async function runTreeAction(act) {
  const item = menuItem;
  hideCardMenu();
  if (!item?.path) return;
  if (act === "explorer") {
    await api("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path }),
    });
    return;
  }
  if (act === "rename") {
    openDialog({
      title: "Rename",
      value: item.name,
      submit: "Rename",
      onSubmit: async (name) => {
        if (name === item.name) return;
        const saved = await api("/api/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: item.path, name }),
        });
        await loadTree({ openPath: saved.path, openName: saved.name });
      },
    });
    return;
  }
  if (act === "exclude") {
    await excludePaths([item.path]);
    return;
  }
  if (act === "collection") {
    const data = await api("/api/collections").catch(() => ({ items: [] }));
    const addTo = async (name) => {
      await api("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: item.path, name }),
      });
      const keep = browse.path && browse.path !== "favourites" && browse.path !== "search" && browse.path !== "collections" && browse.path !== "duplicates";
      await loadTree(keep ? { openPath: browse.path, openName: browse.name } : {});
    };
    openDialog({
      title: "Add to collection",
      placeholder: "New collection name",
      submit: "Create",
      choices: (data.items || []).map((group) => ({ label: group.name, onPick: () => addTo(group.name) })),
      onSubmit: addTo,
    });
  }
}

function showCardMenu(x, y, item, card) {
  menuMode = "card";
  menuItem = item;
  menuCard = card;
  const menu = $("cardMenu");
  const fav = favourites.has(favKey(item));
  const actions = [["open", "Open"]];
  if (item.kind !== "doc") actions.push(["slicer", "Open in slicer"]);
  if (item.kind === "stl" || item.kind === "obj" || item.kind === "3mf") {
    actions.push(["painter", "Send to STL Painter"]);
  }
  actions.push(
    ["explorer", "Show in Explorer"],
    ["locate", "Go to location"],
    ["fav", fav ? "Remove from favourites" : "Add to favourites"],
  );
  menu.innerHTML = "";
  for (const [act, label] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.act = act;
    button.textContent = label;
    menu.appendChild(button);
  }
  menu.hidden = false;
  const width = 210;
  const height = 46 * actions.length;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height))}px`;
}

async function runMenuAction(act) {
  const item = menuItem;
  const card = menuCard;
  hideCardMenu();
  if (!item) return;
  if (act === "open") {
    await selectFile(item, card);
    return;
  }
  if (act === "painter") {
    await api("/api/painter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path, entry: item.entry || "" }),
    });
    pathFile = "";
    renderPath(`${item.name} · opened in the Flightdeck app`);
    return;
  }
  if (act === "slicer") {
    await api("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path, entry: item.entry || "" }),
    });
    return;
  }
  if (act === "explorer") {
    await api("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: item.path }),
    });
    return;
  }
  if (act === "locate") {
    await goToLocation(item);
    return;
  }
  if (act === "fav") {
    const heart = card?.querySelector(".fav-btn");
    if (heart) await toggleFav(item, heart);
  }
}

$("cardMenu").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const run = menuMode === "tree" ? runTreeAction : runMenuAction;
  run(button.dataset.act).catch((err) => showEmpty(err.message || String(err)));
});
document.addEventListener("click", () => hideCardMenu());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!$("cardMenu").hidden) {
      hideCardMenu();
      return;
    }
    if (!$("collectDialog").hidden) {
      closeCollectDialog();
      return;
    }
    if (searchQuery || document.activeElement === $("search")) {
      $("search").value = "";
      leaveSearch();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    $("search").focus();
    $("search").select();
  }
});

$("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const query = $("search").value.trim();
    if (query.length < 2) {
      if (searchQuery) leaveSearch();
      return;
    }
    loadSearch(query).catch((err) => showEmpty(err.message || String(err)));
  }, 280);
});

$("gallery").addEventListener("click", (event) => {
  if (event.target.closest("[data-act='new']")) openCollectDialog();
});

$("collectForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const name = $("collectName").value.trim();
  const submit = dialogSubmit;
  if (!name || !submit) return;
  closeCollectDialog();
  Promise.resolve(submit(name)).catch((err) => showEmpty(err.message || String(err)));
});
$("collectCancel").addEventListener("click", closeCollectDialog);
$("collectDismiss").addEventListener("click", closeCollectDialog);
$("collectDialog").addEventListener("click", (event) => {
  if (event.target === $("collectDialog")) closeCollectDialog();
});
$("addDone").addEventListener("click", stopAdding);
$("pickClose").addEventListener("click", stopAdding);
$("pickAdd").addEventListener("click", () => {
  const items = [...picked.values()].map((item) => ({
    path: item.path,
    entry: item.entry || "",
    name: item.name,
    kind: item.kind,
    size: item.size || 0,
  }));
  api("/api/collections/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: addingTo, items }),
  }).then(() => {
    picked.clear();
    pickAnchor = null;
    document.querySelectorAll(".model-card.picked").forEach((el) => el.classList.remove("picked"));
    updatePickBar();
    renderPath(`Added ${items.length} to "${addingTo}"`);
  }).catch((err) => showEmpty(err.message || String(err)));
});

$("showAll").addEventListener("change", () => {
  if (!browse.path || browse.path === "favourites" || browse.path === "search" || browse.path === "collections" || browse.path === "duplicates") return;
  loadGallery(browse.path, browse.name).catch((err) => showEmpty(err.message || String(err)));
});

$("printable").addEventListener("change", () => {
  if (browse.path === "search" && searchQuery) {
    loadSearch(searchQuery).catch((err) => showEmpty(err.message || String(err)));
    return;
  }
  if (!browse.path || browse.path === "favourites" || browse.path === "collections" || browse.path === "duplicates") return;
  loadGallery(browse.path, browse.name).catch((err) => showEmpty(err.message || String(err)));
});

$("viewSwitch").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  cols = button.dataset.cols || "4";
  $("gallery").className = `gallery cols-${cols}`;
  $("viewSwitch").querySelectorAll("button").forEach((el) => el.classList.toggle("on", el === button));
});

$("backBtn").addEventListener("click", () => {
  selected = null;
  pathFile = "";
  showGallery();
  renderPath();
});

$("excludeBtn").addEventListener("click", async () => {
  const paths = [...excludePicks];
  if (!paths.length) return;
  const button = $("excludeBtn");
  button.disabled = true;
  try {
    await excludePaths(paths);
  } catch (err) {
    showEmpty(err.message || String(err));
    excludeLabel();
  } finally {
    button.disabled = false;
  }
});

$("addFolder").addEventListener("click", async () => {
  let path = "";
  try {
    if (window.pywebview?.api?.pick_folder) path = await window.pywebview.api.pick_folder();
  } catch {
    path = "";
  }
  if (!path) path = window.prompt("Folder on this PC") || "";
  path = path.trim();
  if (!path) return;
  try {
    await api("/api/roots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    await loadTree();
  } catch (err) {
    showEmpty(err.message || String(err));
  }
});

$("openFile").addEventListener("click", async () => {
  if (!selected) return;
  try {
    await api("/api/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: selected.path, entry: selected.entry || "" }),
    });
  } catch (err) {
    showEmpty(err.message || String(err));
  }
});

loadTree().catch((err) => showEmpty(err.message || String(err)));
mountSplit();
$("pathHome").addEventListener("click", () => {
  goPathHome().catch((err) => showEmpty(err.message || String(err)));
});
