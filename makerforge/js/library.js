/** MakerDeck design library — save designs and exports for reloading prior work. */

export function libraryApiAvailable() {
  return window.location.protocol !== "file:" && window.location.origin.length > 0;
}

export function capturePreviewThumbnail(renderer) {
  if (!renderer?.domElement) return "";
  try {
    return renderer.domElement.toDataURL("image/jpeg", 0.82);
  } catch {
    return "";
  }
}

function dataUrlToBlob(dataUrl) {
  if (!dataUrl?.startsWith("data:")) return null;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const header = dataUrl.slice(0, comma);
  const b64 = dataUrl.slice(comma + 1);
  const mime = header.match(/data:([^;]+)/i)?.[1] || "application/octet-stream";
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/** Drop bulky trace mask from state — trace image ships as a separate upload. */
export function leanStateForLibrary(state) {
  if (!state || typeof state !== "object") return state || {};
  const out = { ...state };
  if (out.embossTraceRects && typeof out.embossTraceRects === "object") {
    const { maskB64, ...rest } = out.embossTraceRects;
    out.embossTraceRects = rest;
  }
  return out;
}

function normalizeLibraryFolder(raw) {
  return String(raw || "").trim().replace(/\\/g, "/").split("/")[0].trim();
}

export async function saveDesignToLibrary({ name, folder, state, stamp, thumbnail, traceImage }) {
  if (!libraryApiAvailable()) throw new Error("Design library needs MakerDeck inside Flightdeck.");
  const form = new FormData();
  form.append(
    "meta",
    JSON.stringify({
      name: String(name || "Untitled design").trim() || "Untitled design",
      folder: normalizeLibraryFolder(folder),
      format: "design",
      part: "body",
      exported_at: new Date().toISOString(),
      watermark_serial: stamp?.serial ?? null,
      state: leanStateForLibrary(state || {}),
    }),
  );
  const thumbBlob = dataUrlToBlob(thumbnail);
  if (thumbBlob) form.append("thumbnail", thumbBlob, "thumb.jpg");
  const traceBlob = dataUrlToBlob(traceImage);
  if (traceBlob) form.append("trace_image", traceBlob, "trace.jpg");

  const res = await fetch("/api/makerdeck/designs", { method: "POST", body: form });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.detail) detail = String(parsed.detail);
    } catch {
      /* plain text */
    }
    throw new Error(detail || `Design library save failed (${res.status})`);
  }
  return res.json();
}

export async function saveExportToLibrary({ blob, filename, format, part, state, stamp, thumbnail, traceImage, folder }) {
  if (!libraryApiAvailable() || !blob) return null;
  const form = new FormData();
  form.append("file", blob, filename);
  form.append(
    "meta",
    JSON.stringify({
      name: filename.replace(/\.[^.]+$/, ""),
      folder: normalizeLibraryFolder(folder),
      format,
      part,
      exported_at: new Date().toISOString(),
      watermark_serial: stamp?.serial ?? null,
      state: leanStateForLibrary(state || {}),
    }),
  );
  const thumbBlob = dataUrlToBlob(thumbnail);
  if (thumbBlob) form.append("thumbnail", thumbBlob, "thumb.jpg");
  const traceBlob = dataUrlToBlob(traceImage);
  if (traceBlob) form.append("trace_image", traceBlob, "trace.jpg");

  const res = await fetch("/api/makerdeck/exports", { method: "POST", body: form });
  if (!res.ok) {
    let detail = await res.text();
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.detail) detail = String(parsed.detail);
    } catch {
      /* plain text */
    }
    throw new Error(detail || `Design library save failed (${res.status})`);
  }
  return res.json();
}

export async function listLibraryDesigns(limit = 50, folder = undefined) {
  if (!libraryApiAvailable()) return [];
  let url = `/api/makerdeck/designs?limit=${limit}`;
  if (folder !== undefined) url += `&folder=${encodeURIComponent(folder)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load design library (${res.status})`);
  const payload = await res.json();
  return Array.isArray(payload?.designs) ? payload.designs : [];
}

export async function listLibraryFolders() {
  if (!libraryApiAvailable()) return [];
  const res = await fetch("/api/makerdeck/folders");
  if (!res.ok) throw new Error(`Could not load library folders (${res.status})`);
  const payload = await res.json();
  return Array.isArray(payload?.folders) ? payload.folders : [];
}

export async function fetchDesignParams(designId) {
  const res = await fetch(`/api/makerdeck/designs/${encodeURIComponent(designId)}/params`);
  if (!res.ok) throw new Error(`Could not load design (${res.status})`);
  return res.json();
}

export async function deleteLibraryDesign(designId) {
  const res = await fetch(`/api/makerdeck/designs/${encodeURIComponent(designId)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Could not delete design (${res.status})`);
  return res.json();
}
