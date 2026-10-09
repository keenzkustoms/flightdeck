import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../app/static/app.js', import.meta.url), 'utf8');
const ops = source.slice(source.indexOf('function _detailLiveOps(p,'), source.indexOf('function _detailCalibrationOps(p)'));
const context = vm.createContext({
  _isMoonrakerFamily: p => p.kind === 'moonraker',
  _preheatPresets: () => [{label: 'PLA', hotend: 220, bed: 60}],
  _detailCalibrationOps: () => '', esc: s => String(s ?? ''),
});
vm.runInContext(ops, context);
test('printing and offline workspaces retain movement/thermal command interlocks', () => {
  for (const kind of ['bambu', 'moonraker']) {
    for (const state of ['printing', 'offline', 'error', 'estop']) {
      const html = context._detailLiveOps({id: 'fixture', kind, state}, 'movement');
      const jogs = html.match(/<button[^>]*data-jog-axis[^>]*>/g) || [];
      assert.ok(jogs.length > 0);
      assert.ok(jogs.every(button => button.includes('disabled')));
    }
    const thermal = context._detailLiveOps({id: 'fixture', kind, state: 'offline'}, 'thermal');
    assert.ok((thermal.match(/<button[^>]*data-preheat[^>]*>/g) || []).every(button => button.includes('disabled')));
    assert.ok((thermal.match(/<input[^>]*data-fan-slider[^>]*>/g) || []).every(input => input.includes('disabled')));
  }
});
test('movement and thermal panels expose each supported control once', () => {
  const p = {id:'fixture', kind:'bambu', state:'idle'};
  const move = context._detailLiveOps(p, 'movement');
  const thermal = context._detailLiveOps(p, 'thermal');
  assert.ok(move.includes('data-jog-axis'));
  assert.ok(!move.includes('data-fan-slider'));
  assert.ok(!thermal.includes('data-jog-axis'));
  assert.ok(thermal.includes('data-preheat'));
  assert.equal((thermal.match(/data-fan-slider/g) || []).length, 3);
});
