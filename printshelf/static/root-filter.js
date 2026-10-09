(() => {
  const EXCLUDED_ROOT_IDS = new Set([
    // PrintShelf's own ZIP extraction workspace is not a source library.
    "koko-extracted",
  ]);

  async function refreshRootFilter() {
    const sel = document.getElementById("filterRoot");
    if (!sel) return;

    try {
      const res = await fetch("/api/browse?hidden=false", {
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) return;
      const data = await res.json();
      const roots = Array.isArray(data.roots) ? data.roots : [];
      const visibleIds = new Set(
        roots
          .filter((root) => Number(root.asset_count || 0) > 0)
          .map((root) => String(root.id || ""))
          .filter((id) => id && !EXCLUDED_ROOT_IDS.has(id)),
      );

      const previous = sel.value;
      for (const option of [...sel.options]) {
        if (!option.value) continue;
        option.hidden = !visibleIds.has(option.value);
        option.disabled = option.hidden;
      }

      if (previous && !visibleIds.has(previous)) {
        sel.value = "";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } catch (err) {
      console.warn("PrintShelf root filter refresh failed", err);
    }
  }

  async function waitForPrintShelf() {
    for (let i = 0; i < 40; i += 1) {
      const sel = document.getElementById("filterRoot");
      if (sel && sel.options.length > 1) {
        await refreshRootFilter();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  window.addEventListener("load", () => {
    waitForPrintShelf();

    for (const id of ["refreshLibraryBtn", "scanBtn", "saveFoldersBtn"]) {
      document.getElementById(id)?.addEventListener("click", () => {
        setTimeout(refreshRootFilter, 1500);
      });
    }
  });
})();
