/** Art helpers — text/trace edits go straight to `state` (no draft layer). */

export function appliedHasArt(state) {
  const trace = state.embossTraceRects;
  return (
    state.embossTraceEnabled ||
    !!trace?.shapeGroups?.length ||
    !!trace?.strokePaths?.length ||
    !!String(state.embossText || "")
      .split(/\r?\n/)
      .some((l) => l.trim()) ||
    (state.embossSvgEnabled && !!state.embossSvgText?.trim())
  );
}

export function preferredEmbossFace(state) {
  if (state.lidEnabled && (state.lidType === "slip" || state.lidType === "plug" || state.lidType === "flat" || state.lidType === "screw")) {
    return "lid";
  }
  return state.embossFace || "front";
}
