/** Save multi-file exports as a folder (File System Access API). Falls back to ZIP elsewhere. */

const IDB_NAME = "makerdeck-export-v1";
const IDB_STORE = "handles";
const DOWNLOADS_ROOT_KEY = "downloads-root";
const PICKER_HINT_KEY = "makerdeck-export-picker-hint";

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadRootHandle() {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(DOWNLOADS_ROOT_KEY);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function storeRootHandle(handle) {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, DOWNLOADS_ROOT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function folderExportSupported() {
  return !!window.isSecureContext && typeof window.showDirectoryPicker === "function";
}

export function folderExportBlockedReason() {
  if (folderExportSupported()) return "";
  if (!window.isSecureContext) {
    return "Folder export needs a secure connection (https://). A ZIP will download instead.";
  }
  return "This browser can't save folders directly. A ZIP will download instead.";
}

export function exportFolderPickerHint(exportFolderName) {
  const safeName = normalizeFolderName(exportFolderName);
  return `Folder window: click Downloads → Select Folder (don't type "${safeName}" at the bottom). MakerDeck creates that folder for you. After the first time, exports go straight to Downloads/${safeName}/.`;
}

async function ensureWritePermission(handle) {
  if (!handle?.queryPermission) return false;
  let perm = await handle.queryPermission({ mode: "readwrite" });
  if (perm === "granted") return true;
  if (!handle.requestPermission) return false;
  perm = await handle.requestPermission({ mode: "readwrite" });
  return perm === "granted";
}

async function confirmFirstPicker(exportFolderName) {
  const safeName = normalizeFolderName(exportFolderName);
  const lines = [
    `Export folder: ${safeName}`,
    "",
    "In the folder window that opens next:",
    "1. Click Downloads in the left sidebar",
    '2. Click "Select Folder"',
    "",
    "Do NOT type the name in the box at the bottom — that causes “Path does not exist”.",
    "",
    `MakerDeck creates "${safeName}" inside Downloads automatically.`,
    "",
    "Or: New folder → name it → select it → Select Folder.",
    "",
    "Continue?",
  ];
  if (!confirm(lines.join("\n"))) {
    throw Object.assign(new Error("Export cancelled"), { name: "AbortError" });
  }
  localStorage.setItem(PICKER_HINT_KEY, "1");
}

async function pickDownloadsParent(exportFolderName) {
  if (!localStorage.getItem(PICKER_HINT_KEY)) {
    await confirmFirstPicker(exportFolderName);
  }
  const handle = await window.showDirectoryPicker({
    mode: "readwrite",
    startIn: "downloads",
    id: "makerdeck-export-parent",
  });
  await storeRootHandle(handle);
  return handle;
}

/** Call from Export dialog submit (user click) before any async mesh work. */
export async function prepareExportFolderAccess(exportFolderName) {
  let parentHandle = await loadRootHandle();
  if (parentHandle && await ensureWritePermission(parentHandle)) {
    return parentHandle;
  }
  return pickDownloadsParent(exportFolderName);
}

function normalizeFolderName(raw) {
  let name = String(raw || "").trim().replace(/[/\\?%*:|"<>]/g, "-");
  name = name.replace(/\.zip$/i, "");
  name = name.replace(/^[/\\]+|[/\\]+$/g, "");
  return name || "makerdeck-export";
}

async function resolveExportDirectory(parentHandle, folderName) {
  const safeName = normalizeFolderName(folderName);
  if (parentHandle.name.toLowerCase() === safeName.toLowerCase()) {
    return { dir: parentHandle, pathLabel: safeName };
  }
  const dir = await parentHandle.getDirectoryHandle(safeName, { create: true });
  const parentLabel = parentHandle.name || "Downloads";
  return { dir, pathLabel: `${parentLabel}/${safeName}` };
}

function toBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return new TextEncoder().encode(data);
  return new Uint8Array(data);
}

function normalizeFolderFiles(files) {
  return files.map((file) => ({
    name: String(file.name).replace(/^[/\\]+/, ""),
    data: toBytes(file.data),
  }));
}

export function sanitizeExportFolderName(raw) {
  return normalizeFolderName(raw);
}

/** Write files into `{parent}/{folderName}/` (or directly if parent already matches). */
export async function saveFilesToExportFolder(folderName, files, parentHandle) {
  if (!parentHandle) throw new Error("No export folder access");
  const { dir, pathLabel } = await resolveExportDirectory(parentHandle, folderName);
  const entries = normalizeFolderFiles(files);
  for (const file of entries) {
    const fh = await dir.getFileHandle(file.name, { create: true });
    const writable = await fh.createWritable();
    await writable.write(file.data);
    await writable.close();
  }
  return {
    folderName: normalizeFolderName(folderName),
    pathLabel,
    fileCount: entries.length,
    fileNames: entries.map((f) => f.name),
  };
}

export function isFolderExportCancelled(err) {
  return err?.name === "AbortError" || err?.name === "NotAllowedError";
}
