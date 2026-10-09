import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderFleet, readPins, moveFleetPin } from '../app/static/fleet-layout.mjs';
const p = (id, eta, state = 'printing') => ({ id, state, job: { eta_seconds: eta } });
const fallback = (a, b) => a.id.localeCompare(b.id);
const ids = list => list.map(p => p.id);
test('known ETA precedes unknown; zero is valid; paused and offline do not race active jobs', () => {
  const fleet = [p('unknown', null), p('offline', 0, 'offline'), p('paused', 5, 'paused'), p('later', 100), p('now', 0), p('bad', -1)];
  assert.deepEqual(ids(orderFleet(fleet, readPins(null), fallback)), ['now', 'later', 'bad', 'unknown', 'offline', 'paused']);
});
test('calibrated ETA determines order and equal ETA is stable', () => {
  assert.deepEqual(ids(orderFleet([{...p('a', 10), eta_calibration: {ratio: 3}}, p('b', 20), p('c', 20)], {}, fallback)), ['b', 'c', 'a']);
});
test('pin survives telemetry changes; dragging shifts existing reservations; unpin restores auto order', () => {
  const fleet = [p('a', 10), p('b', 20), p('c', 30)];
  let pins = readPins({b: 0});
  pins = moveFleetPin(orderFleet(fleet, pins, fallback), pins, 'c', 0);
  assert.deepEqual(ids(orderFleet(fleet, pins, fallback)), ['c', 'b', 'a']);
  assert.deepEqual(ids(orderFleet([p('a', 1), p('b', 2), p('c', 300)], pins, fallback)), ['c', 'b', 'a']);
  assert.deepEqual(ids(orderFleet(fleet, {}, fallback)), ['a', 'b', 'c']);
});
test('removed printers, colliding pins, fleet shrink, invalid storage and 48-device fleets', () => {
  assert.deepEqual(Object.keys(readPins({a: -1, b: '2', c: 1.5})), []);
  const fleet = Array.from({length: 48}, (_, i) => p(String(i), i));
  const ordered = orderFleet(fleet, readPins({'0': 999, '1': 999, gone: 0}), fallback);
  assert.equal(ordered.length, 48);
  assert.equal(new Set(ids(ordered)).size, 48);
  assert.equal(ordered[47].id, '0');
  assert.deepEqual(orderFleet([], {gone: 4}, fallback), []);
});
