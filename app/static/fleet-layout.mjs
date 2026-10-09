// Viewer preferences only. These helpers never dispatch printer commands.
export function readPins(value) {
  const pins = Object.create(null);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return pins;
  for (const [id, slot] of Object.entries(value)) {
    if (Number.isSafeInteger(slot) && slot >= 0 && slot < 10000) pins[id] = slot;
  }
  return pins;
}

export function remainingSeconds(printer) {
  const raw = printer.job?.eta_seconds;
  if (raw == null || !Number.isFinite(Number(raw)) || Number(raw) < 0) return Infinity;
  const ratio = Number(printer.eta_calibration?.ratio);
  return Number(raw) * (Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
}

export function orderFleet(printers, pins, compareFallback) {
  const automatic = [...printers].sort((a, b) => {
    const activeA = a.state === 'printing', activeB = b.state === 'printing';
    if (activeA !== activeB) return activeA ? -1 : 1;
    if (activeA) {
      const etaA = remainingSeconds(a), etaB = remainingSeconds(b);
      if (etaA !== etaB) return etaA < etaB ? -1 : 1;
    }
    return compareFallback(a, b) || String(a.id).localeCompare(String(b.id));
  });
  const slots = new Array(automatic.length);
  const held = automatic.filter(p => Object.hasOwn(pins, p.id))
    .sort((a, b) => pins[a.id] - pins[b.id] || String(a.id).localeCompare(String(b.id)));
  for (const p of held) {
    let slot = Math.min(pins[p.id], slots.length - 1);
    while (slot < slots.length && slots[slot]) slot++;
    if (slot === slots.length) slot = slots.findIndex(p => !p);
    slots[slot] = p;
  }
  const free = automatic.filter(p => !Object.hasOwn(pins, p.id));
  let next = 0;
  for (let i = 0; i < slots.length; i++) if (!slots[i]) slots[i] = free[next++];
  return slots;
}

export function moveFleetPin(ordered, pins, id, target) {
  const index = ordered.findIndex(p => p.id === id);
  if (index < 0 || !ordered.length) return readPins(pins);
  const position = Math.max(0, Math.min(ordered.length - 1, target));
  const moved = [...ordered];
  moved.splice(index, 1);
  moved.splice(position, 0, ordered[index]);
  const result = readPins(pins);
  // Move existing reservations with their cards, so dragging never steals a pin.
  moved.forEach((p, slot) => { if (p.id === id || Object.hasOwn(result, p.id)) result[p.id] = slot; });
  return result;
}
