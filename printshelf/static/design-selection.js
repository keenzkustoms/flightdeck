(() => {
  const selectedDesignIds = new Set();
  let anchorDesignId = null;
  let observer = null;
  let lastLibraryContext = '';

  function designCards() {
    return [...document.querySelectorAll('#grid .design-card[data-design-id]')];
  }

  function isDesignMode() {
    return designCards().length > 0;
  }

  function libraryContextKey() {
    const activeType = document.querySelector('#typeTabs .type-tab.active')?.dataset?.kind || '';
    const activeMode = document.querySelector('#viewModes .view-mode.active')?.dataset?.mode || '';
    return JSON.stringify({
      q: document.getElementById('search')?.value || '',
      source: document.getElementById('filterSource')?.value || '',
      root: document.getElementById('filterRoot')?.value || '',
      sort: document.getElementById('sortBy')?.value || '',
      textures: !!document.getElementById('filterTextures')?.checked,
      sliced: !!document.getElementById('filterSliced')?.checked,
      hidden: !!document.getElementById('filterHidden')?.checked,
      activeType,
      activeMode,
    });
  }

  function clearStaleDetail() {
    const detail = document.getElementById('detail');
    if (!detail) return;
    window.PrintShelfViewer?.unmountOrbitViewer?.();
    detail.innerHTML = '<div class="detail-empty">Select a file to see print details.</div>';
    document.querySelectorAll('#grid .card.active').forEach((card) => card.classList.remove('active'));
  }

  function syncLibraryContext() {
    const next = libraryContextKey();
    if (!lastLibraryContext) {
      lastLibraryContext = next;
      return;
    }
    if (next === lastLibraryContext) return;
    lastLibraryContext = next;
    clearStaleDetail();
    clearDesignSelection();
  }

  function syncDesignSelectionUi() {
    const cards = designCards();
    const visibleIds = new Set(cards.map((card) => Number(card.dataset.designId)));
    for (const id of [...selectedDesignIds]) {
      if (!visibleIds.has(id)) selectedDesignIds.delete(id);
    }

    for (const card of cards) {
      const id = Number(card.dataset.designId);
      const on = selectedDesignIds.has(id);
      card.classList.toggle('selected', on);
      let cb = card.querySelector('.design-card-check');
      if (!cb) {
        cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'card-check design-card-check';
        cb.setAttribute('aria-label', 'Select design');
        card.prepend(cb);
      }
      cb.checked = on;
    }

    const bar = document.getElementById('bulkBar');
    if (!bar || !isDesignMode()) return;
    bar.hidden = false;
    const n = selectedDesignIds.size;
    const count = document.getElementById('bulkCount');
    if (count) count.textContent = n ? `${n} design${n === 1 ? '' : 's'} selected` : 'Select designs';
    bar.classList.toggle('bulk-bar--idle', n === 0);
    for (const id of ['bulkHideBtn', 'bulkDeleteBtn', 'bulkClearBtn']) {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = n === 0;
    }
    const unhide = document.getElementById('bulkUnhideBtn');
    if (unhide) {
      unhide.disabled = true;
      unhide.title = 'Unhide individual files from Folders view';
    }
  }

  function toggleDesign(id, on, setAnchor = true) {
    const num = Number(id);
    if (on) selectedDesignIds.add(num);
    else selectedDesignIds.delete(num);
    if (setAnchor) anchorDesignId = num;
    syncDesignSelectionUi();
  }

  function selectRange(fromId, toId, additive = false) {
    const cards = designCards();
    const ids = cards.map((card) => Number(card.dataset.designId));
    const a = ids.indexOf(Number(fromId));
    const b = ids.indexOf(Number(toId));
    if (a < 0 || b < 0) {
      toggleDesign(toId, true);
      return;
    }
    if (!additive) selectedDesignIds.clear();
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let i = lo; i <= hi; i += 1) selectedDesignIds.add(ids[i]);
    if (anchorDesignId == null) anchorDesignId = Number(fromId);
    syncDesignSelectionUi();
  }

  function clearDesignSelection() {
    selectedDesignIds.clear();
    anchorDesignId = null;
    syncDesignSelectionUi();
  }

  async function resolveSelectedAssets() {
    const assetIds = [];
    const names = [];
    const seen = new Set();
    for (const id of selectedDesignIds) {
      const design = await window.api(`/api/designs/${id}`);
      for (const asset of design.assets || []) {
        const aid = Number(asset.id);
        if (!aid || seen.has(aid)) continue;
        seen.add(aid);
        assetIds.push(aid);
        names.push(asset.file_name || design.name || `asset ${aid}`);
      }
    }
    return { assetIds, names };
  }

  document.addEventListener('input', (event) => {
    if (event.target.closest('#search, #filterSource, #filterRoot, #sortBy, #filterTextures, #filterSliced, #filterHidden')) {
      syncLibraryContext();
    }
  }, true);
  document.addEventListener('change', (event) => {
    if (event.target.closest('#search, #filterSource, #filterRoot, #sortBy, #filterTextures, #filterSliced, #filterHidden')) {
      syncLibraryContext();
    }
  }, true);
  document.addEventListener('click', (event) => {
    if (event.target.closest('#typeTabs .type-tab, #viewModes .view-mode, #crumbs .crumb, #grid .folder-card')) {
      queueMicrotask(syncLibraryContext);
    }
  }, true);

  document.addEventListener('click', (event) => {
    const card = event.target.closest('#grid .design-card[data-design-id]');
    if (!card) return;
    if (event.target.closest('.card-menu')) return;

    const id = Number(card.dataset.designId);
    const checkbox = event.target.closest('.design-card-check');
    if (checkbox) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.shiftKey) {
        selectRange(anchorDesignId ?? id, id, event.ctrlKey || event.metaKey);
      } else {
        toggleDesign(id, !selectedDesignIds.has(id));
      }
      return;
    }

    if (event.shiftKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectRange(anchorDesignId ?? id, id, event.ctrlKey || event.metaKey);
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleDesign(id, !selectedDesignIds.has(id));
      return;
    }

    anchorDesignId = id;
  }, true);

  document.getElementById('bulkSelectAllBtn')?.addEventListener('click', (event) => {
    if (!isDesignMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    for (const card of designCards()) selectedDesignIds.add(Number(card.dataset.designId));
    anchorDesignId = designCards()[0] ? Number(designCards()[0].dataset.designId) : null;
    syncDesignSelectionUi();
  }, true);

  document.getElementById('bulkClearBtn')?.addEventListener('click', (event) => {
    if (!isDesignMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clearDesignSelection();
  }, true);

  document.getElementById('bulkHideBtn')?.addEventListener('click', async (event) => {
    if (!isDesignMode() || !selectedDesignIds.size) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const { assetIds } = await resolveSelectedAssets();
      if (!assetIds.length) return;
      clearDesignSelection();
      await window.hideIds(assetIds);
      window.psToast?.('Hidden from library', `${assetIds.length} file${assetIds.length === 1 ? '' : 's'} across selected designs`, 'ok');
    } catch (err) {
      window.psToast?.('Hide failed', String(err.message || err), 'error');
    }
  }, true);

  document.getElementById('bulkDeleteBtn')?.addEventListener('click', async (event) => {
    if (!isDesignMode() || !selectedDesignIds.size) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const { assetIds, names } = await resolveSelectedAssets();
      if (!assetIds.length) return;
      const deleted = await window.deleteIdsFromDisk(assetIds, { names });
      if (deleted) clearDesignSelection();
    } catch (err) {
      window.psToast?.('Delete failed', String(err.message || err), 'error');
    }
  }, true);

  document.getElementById('bulkUnhideBtn')?.addEventListener('click', (event) => {
    if (!isDesignMode()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.psToast?.('Use Folders view to unhide', 'Hidden design cards do not expose their hidden files safely yet.', 'info');
  }, true);

  function watchGrid() {
    const root = document.getElementById('gridPane') || document.body;
    observer?.disconnect();
    observer = new MutationObserver(() => {
      queueMicrotask(syncDesignSelectionUi);
    });
    observer.observe(root, { childList: true, subtree: true });
    lastLibraryContext = libraryContextKey();
    syncDesignSelectionUi();
  }

  watchGrid();
})();
