(() => {
  if (!window.FLIGHTDECK_DEMO) return;

  const nowIso = () => new Date().toISOString();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const demoCameraAssets = {
    h2d: '/static/demo-assets/h2d-camera.png',
    x1c: '/static/demo-assets/x1c-camera.png',
    greyhound: '/static/demo-assets/voron-camera.png',
  };

  const demoSpools = [
    spool(3, 'ASA', 'Siddament', 'Normal', '#FFFFFF', 'White', 536, 'h2d', 0, null, null, 88),
    spool(2, 'ASA', 'Siddament', 'Normal', '#F72323', 'Red', 295, 'h2d', 512, null, null, 88),
    spool(31, 'PLA', 'Bambu Lab', 'Matte', '#F7D959', 'Lemon Yellow', 238, 'h2d', 1, null, null, 80),
    spool(20, 'PLA+', '3DFillies', null, '#111111', 'Black', 106, null, null, 1, 'Shelf #1', 75),
    spool(48, 'ABS+', 'eSUN', null, '#EF4444', 'Red', 700, 'x1c', 1, null, null, 90),
    spool(56, 'PLA+', '3DFillies', null, '#111111', 'Black', 112, null, null, 2, 'Shelf #2', 75),
    spool(68, 'ABS', 'Siddament', null, '#1A1A1A', 'Black', 1002, null, null, 3, 'Shelf #3', 88),
    spool(70, 'ABS', 'Siddament', null, '#FFFFFF', 'White', 956, null, null, 3, 'Shelf #3', 88),
  ];

  const demoPrinters = [
    {
      id: 'h2d',
      model_name: 'H2D',
      custom_name: 'BigBoy',
      icon: 'bambu',
      kind: 'bambu',
      state: 'paused',
      temps: {
        hotend_l: { actual: 252, target: 255 },
        hotend_r: { actual: 252, target: 255 },
        bed: { actual: 108, target: 110 },
        chamber: { actual: 48, target: 0 },
      },
      job: {
        filename: 'can_openerV2.gcode.3mf',
        subtask_name: 'can_openerV2',
        progress: 0,
        eta_seconds: 15900,
        layer_current: 0,
        layer_total: 530,
      },
      substage: 'Print paused',
      idle_info: {},
      ams: [
        ams(0, 'AMS 1', 33, 25.5, [
          slot(0, 'ASA', '#FFFFFF', 'Siddament', 'P461bccf', 'Siddament ASA', true),
          slot(1, 'PLA', '#F7D959', 'Generic', 'GFL99', 'Generic PLA'),
          slot(2, 'PLA', '#EC4899', 'Generic', 'GFL99', 'Generic PLA'),
          slot(3, '', '', '', '', '', false, true),
        ], true),
        ams(128, 'AMS HT', 24, 22.6, [
          slot(0, 'ASA', '#F72323', 'Siddament', 'P461bccf', 'Siddament ASA', true),
        ], true),
      ],
      mmu: [],
      maintenance: [
        maint('bambu:ls', 'ls', 'Lubricate lead screws', 'due', true, 'Printer reported LS care via Bambu MQTT'),
        maint('bambu:ld', 'ld', 'Clean build plate', 'ok', false, 'Ready after current job'),
      ],
      light_state: 'on',
      temperature_presets: presets(),
      error: null,
      last_seen: nowIso(),
      updated_at: nowIso(),
      eta_calibration: { ratio: 1.004, count: 8 },
      health: health('watch', 'Watch', 68, 19, 6, ['17 failed/cancelled prints in 14d']),
      _error_print_id: null,
    },
    {
      id: 'x1c',
      model_name: 'X1C',
      custom_name: 'Greyhound Ludicrous',
      icon: 'bambu',
      kind: 'bambu',
      state: 'idle',
      temps: {
        hotend: { actual: 26, target: 0 },
        bed: { actual: 22, target: 0 },
        chamber: { actual: 26, target: 0 },
      },
      job: null,
      substage: null,
      idle_info: { 'Last print': 'obj_1_orange tabby cat 3d model - 3h 24m' },
      ams: [
        ams(0, 'AMS 1', 40, 24.6, [
          slot(0, '', '', '', '', '', false, true),
          slot(1, 'PLA+', '#EF4444', 'Generic', 'GFL99', 'Generic PLA', false),
          slot(2, '', '', '', '', '', false, true),
          slot(3, '', '', '', '', '', false, true),
        ], false),
      ],
      mmu: [],
      maintenance: [
        maint('bambu:cr', 'cr', 'Clean carbon rods', 'due', true, 'Printer reported CR care via Bambu MQTT'),
        maint('bambu:ls', 'ls', 'Lubricate lead screws', 'due', true, 'Printer reported LS care via Bambu MQTT'),
      ],
      light_state: 'off',
      temperature_presets: presets(),
      error: null,
      last_seen: nowIso(),
      updated_at: nowIso(),
      health: health('watch', 'Watch', 50, 4, 2, ['2 failed/cancelled prints in 14d']),
      _error_print_id: null,
    },
    {
      id: 'greyhound',
      model_name: 'Voron 2.4 350',
      custom_name: 'Greyhound Elite V2',
      icon: 'voron',
      kind: 'moonraker',
      state: 'idle',
      temps: {
        hotend: { actual: 31, target: 0 },
        bed: { actual: 28, target: 0 },
        chamber: { actual: 29, target: 0 },
      },
      job: null,
      substage: null,
      idle_info: { 'Last print': 'Cube_ABS_1h14m.gcode - cancelled' },
      ams: [],
      mmu: [
        { unit: 0, label: 'Vivid', gates: [
          { idx: 0, material: 'ABS+', color: '#1a1a1a', active: false, state: 'pre_gate' },
          { idx: 1, material: 'PLA', color: '#F7D959', active: true, state: 'gear' },
          { idx: 2, material: 'ASA', color: '#FFFFFF', active: false, state: 'idle' },
          { idx: 3, material: 'PETG', color: '#808080', active: false, state: 'idle' },
        ] },
      ],
      maintenance: [
        maint('manual:vivid', 'vivid', 'Inspect Vivid filament path', 'ok', false, 'Manual Voron task'),
      ],
      light_state: 'off',
      temperature_presets: presets(),
      error: null,
      last_seen: nowIso(),
      updated_at: nowIso(),
      health: health('watch', 'Watch', 44, 6, 3, ['3 failed/cancelled prints in 14d']),
      _error_print_id: null,
    },
  ];

  const demoQueue = [
    {
      id: 101,
      printer_id: 'h2d',
      position: 1,
      filename: 'bed_scraper_multi_8h1m.gcode.3mf',
      file_size: 621224,
      status: 'pending',
      estimated_seconds: 29160,
      filament_weight_g: 157,
      filament_type: 'PLA',
      filament_colors: JSON.stringify([{ type: 'PLA', color: '#FFFFFF', used_g: 100 }, { type: 'PLA', color: '#F72323', used_g: 57 }]),
      has_preview: 1,
      preflight: { status: 'ready', message: 'Ready' },
    },
    {
      id: 102,
      printer_id: 'x1c',
      position: 1,
      filename: 'abbiesdogtest.gcode.3mf',
      file_size: 807221,
      status: 'blocked',
      estimated_seconds: 92340,
      filament_weight_g: 348,
      filament_type: 'PLA',
      filament_colors: JSON.stringify([{ type: 'PLA', color: '#FFFFFF', used_g: 280 }, { type: 'PLA', color: '#7C4B00', used_g: 68 }]),
      error_msg: 'Missing colour coverage: Brown not loaded',
      has_preview: 1,
      preflight: { status: 'blocked', message: 'Missing colour coverage: Brown not loaded' },
    },
  ];

  const demoNotifications = [
    note(1, 'warn', 'AMS profile mismatch', 'X1C - Generic PLA differs from Flightdeck assignment.', '#/printer/x1c'),
    note(2, 'info', 'Demo mode active', 'All controls are simulated.', '#/'),
  ];

  function spool(id, material, brand, subtype, color_hex, color_name, remaining_g, printer, slot, storageId, storageName, score) {
    return {
      id, material, brand, subtype, color_hex, color_name,
      label_weight_g: 1000,
      remaining_g,
      empty_spool_weight_g: 140,
      location_printer_id: printer,
      location_slot: slot,
      storage_location_id: storageId,
      storage_location_name: storageName,
      notes: null,
      added_at: '2026-06-02 10:00:00',
      archived_at: null,
      confidence: {
        score,
        level: score >= 85 ? 'verified' : 'estimated',
        label: score >= 85 ? 'Verified' : 'Estimated',
        reasons: ['demo data', 'tare set'],
        usage_count: id === 3 ? 1 : 0,
        deducted_g: id === 3 ? 68.4 : 0,
        reconciled_count: 0,
        last_usage_at: null,
        last_reconciled_at: null,
      },
    };
  }

  function slot(idx, type, color, brand, profile_id, profile_name, active = false, empty = false) {
    return { idx, type, color, brand, profile_id, profile_name, active, empty };
  }

  function ams(unit, label, humidity, temperature, slots, dryCapable) {
    return {
      unit, label, slots, humidity, humidity_level: 2, temperature,
      dry_time: 0, drying: false, dry_capable: dryCapable,
      dry_status: 0, dry_sub_status: 0, dry_sf_reason: [],
      dry_setting: { filament: '', temperature: -1, duration: -1 },
    };
  }

  function maint(id, code, title, state, is_due, detail) {
    return { id, code, title, source: id.startsWith('bambu:') ? 'bambu_mqtt' : 'manual', state, is_due, info: 'DEMO', detail };
  }

  function presets() {
    return {
      hotend: [{ label: 'PLA', value: 220 }, { label: 'PETG', value: 245 }, { label: 'ASA', value: 255 }, { label: 'ABS', value: 250 }],
      bed: [{ label: 'PLA', value: 65 }, { label: 'PETG', value: 80 }, { label: 'ASA', value: 110 }, { label: 'ABS', value: 100 }],
    };
  }

  function health(status, label, success_rate_14d, prints_14d, failures_14d, reasons) {
    return { status, label, success_rate_14d, prints_14d, failures_14d, early_failures_14d: 1, reasons: reasons.map(message => ({ level: 'watch', message })) };
  }

  function note(id, level, title, message, link) {
    return { id, level, title, message, link, created_at: nowIso(), read_at: null };
  }

  function fileTarget(id, label, model, kind, files, actions = {}) {
    return { id, label, model, kind, files, error: null, actions: { format_sd: kind === 'bambu', format_sd_ready: false, ...actions } };
  }

  function file(name, kind = 'file', size = null) {
    return { name, path: name, kind, size, modified: '2026-06-02 10:00:00' };
  }

  function jsonResponse(value, status = 200) {
    return new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function textResponse(value, status = 200, type = 'text/plain') {
    return new Response(value, { status, headers: { 'Content-Type': type } });
  }

  function demoImage(label, colour = '#3b82f6') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
      <rect width="640" height="360" fill="#090b12"/>
      <rect x="32" y="42" width="576" height="276" rx="18" fill="#111827" stroke="#334155"/>
      <path d="M88 250h464" stroke="#475569" stroke-width="8" stroke-linecap="round"/>
      <path d="M150 110h310l52 65H108z" fill="${colour}" opacity="0.88"/>
      <circle cx="174" cy="236" r="18" fill="#64748b"/>
      <circle cx="492" cy="236" r="18" fill="#64748b"/>
      <text x="64" y="70" fill="#93c5fd" font-family="Arial" font-size="20" font-weight="700">FLIGHTDECK DEMO</text>
      <text x="64" y="304" fill="#e5e7eb" font-family="Arial" font-size="26" font-weight="700">${escapeSvg(label)}</text>
    </svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function escapeSvg(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  }

  function route(url, options = {}) {
    const u = new URL(url, location.origin);
    const path = u.pathname;
    const method = (options.method || 'GET').toUpperCase();

    if (path === '/api/settings') return jsonResponse({ temp_unit: 'F', time_format: '24h', accent: '#3b82f6' });
    if (path.startsWith('/api/settings/')) return method === 'GET' ? jsonResponse({ value: null }) : jsonResponse({ ok: true, demo: true });
    if (path === '/api/instance') return jsonResponse({
      app: 'flightdeck-demo',
      address: 'demo.local',
      hardware: 'Demo Pi 5 8GB',
      runtime: 'standalone demo',
      host: {
        load: { one: 0.42, five: 0.38, fifteen: 0.31, cores: 4, pct: 10 },
        memory: { total: 8589934592, available: 6442450944, used: 2147483648, pct: 25 },
        disk: { path: '/demo-data', total: 503446224896, free: 460820905984, used: 42625318912, pct: 8.5 },
      },
      camera_workers: { count: 3, expected_max: 3, ok: true, detail: '3 static demo camera feeds' },
    });
    if (path === '/api/setup/health') return jsonResponse({
      status: 'ready',
      summary: { required_ok: 7, required_total: 7, optional_ok: 5, optional_total: 5 },
      checks: [
        { key: 'demo', label: 'Demo safety', ok: true, level: 'ok', detail: 'No live printer APIs are used', optional: false },
        { key: 'data', label: 'Demo data', ok: true, level: 'ok', detail: 'Simulated fleet loaded', optional: false },
      ],
    });
    if (path === '/api/printers') return jsonResponse(clone(demoPrinters));
    if (path.match(/^\/api\/printers\/[^/]+\/camera$/)) {
      const id = decodeURIComponent(path.split('/')[3]);
      return jsonResponse({ url: demoCameraAssets[id] || demoImage(`${id.toUpperCase()} camera`, id === 'h2d' ? '#ef4444' : '#3b82f6') });
    }
    if (path.match(/^\/api\/printers\/[^/]+\/thumbnail$/)) return textResponse('', 404);
    if (path.match(/^\/api\/printers\/[^/]+\/control$/)) return jsonResponse({ ok: true, demo: true });
    if (path.match(/^\/api\/printers\/[^/]+\/set-temp$/)) return jsonResponse({ ok: true, demo: true });
    if (path.match(/^\/api\/printers\/[^/]+\/ams\/.*\/dry$/)) return jsonResponse({ ok: true, demo: true });
    if (path.match(/^\/api\/printers\/[^/]+\/ams\/(load|unload)$/)) return jsonResponse({ ok: true, demo: true });
    if (path.match(/^\/api\/printers\/[^/]+\/exclude-object$/)) return jsonResponse({ ok: true, demo: true });
    if (path.match(/^\/api\/printers\/[^/]+\/objects$/)) return jsonResponse({
      supported: true,
      objects: [
        { id: 1, name: 'Can_opener_body1_5.2mm_holes.STL', label: 'Can_opener_body1_5.2mm_holes.STL', state: 'printing' },
        { id: 2, name: 'Can_opener_button_part1_5.2mm_holes.STL', label: 'Can_opener_button_part1_5.2mm_holes.STL', state: 'queued' },
        { id: 3, name: 'Can_opener_side2_4.8mm_pins.STL', label: 'Can_opener_side2_4.8mm_pins.STL', state: 'queued' },
        { id: 4, name: 'Can_opener_side1_4.8mm_pins.STL', label: 'Can_opener_side1_4.8mm_pins.STL', state: 'queued' },
        { id: 5, name: 'Can_opener_button_part2_5.2mm_holes.STL', label: 'Can_opener_button_part2_5.2mm_holes.STL', state: 'queued' },
        { id: 6, name: 'Can_opener_spring1.STL', label: 'Can_opener_spring1.STL', state: 'queued' },
        { id: 7, name: 'Can_opener_hook1_6.2mm_hole.STL', label: 'Can_opener_hook1_6.2mm_hole.STL', state: 'queued' },
      ],
    });
    if (path.match(/^\/api\/printers\/[^/]+\/maintenance$/)) return jsonResponse([
      { id: 1, title: 'Lubricate lead screws', notes: 'Demo manual task', due_at: null, days_until_due: null, interval_days: null, interval_prints: null, interval_hours: 250, hours_since: 232, prints_since: 4, is_due: false, archived_at: null, last_completed_at: '2026-05-21' },
      { id: 2, title: 'Clean build plate', notes: 'Triggered after ASA work', due_at: null, days_until_due: null, interval_days: null, interval_prints: 10, interval_hours: null, hours_since: 42, prints_since: 11, is_due: true, archived_at: null, last_completed_at: '2026-05-28' },
    ]);
    if (path.match(/^\/api\/printers\/[^/]+\/maintenance\/.+/)) return jsonResponse({ ok: true, demo: true });
    if (path.match(/^\/api\/printers\/[^/]+\/history\/calendar/)) return jsonResponse(calendarDemo());
    if (path.match(/^\/api\/printers\/[^/]+\/history\/day/)) return jsonResponse(historyDemo());
    if (path.match(/^\/api\/printers\/[^/]+\/prints\/latest-finished$/)) return jsonResponse({ print_id: 501, notes: '' });
    if (path.match(/^\/api\/printers\/[^/]+\/prints\/\d+\/decisions$/)) return jsonResponse([
      { created_at: '2026-06-02 10:10:00', event: 'job_started', detail: 'Demo print started' },
      { created_at: '2026-06-02 10:14:00', event: 'spool_deducted', detail: 'Spool #3 68.4g deducted' },
    ]);
    if (path.match(/^\/api\/printers\/[^/]+\/prints\/\d+\/snapshot$/)) return textResponse('', 404);
    if (path === '/api/spools') return jsonResponse(clone(demoSpools));
    if (path === '/api/spools/summary') return jsonResponse({
      total_remaining_g: 4310,
      total_consumed_g: 11320,
      total_count: demoSpools.length,
      in_printer_count: 4,
      low_stock_count: 3,
      low_stock_pct: 20,
      by_material: [
        { material: 'ASA', grams: 1831 },
        { material: 'PLA', grams: 238 },
        { material: 'PLA+', grams: 218 },
        { material: 'ABS', grams: 2958 },
      ],
    });
    if (path === '/api/spools/intelligence' || path.startsWith('/api/spools/intelligence')) return jsonResponse({
      days: 30,
      summary: { deducted_g: 97.3, deducted_prints: 1, unattributed_prints: 0, loaded_low: 2 },
      alerts: [{ level: 'watch', message: '2 loaded demo spools are below 30%.' }],
      recent_usage: [{ spool_id: 3, printer_id: 'h2d', material: 'ASA', color_name: 'White', grams: 68.4, ended_at: nowIso() }],
      by_spool: [{ spool_id: 3, material: 'ASA', color_name: 'White', brand: 'Siddament', grams: 68.4 }],
    });
    if (path.match(/^\/api\/spools\/\d+\/trace$/)) return jsonResponse({ usage: historyDemo(), decisions: [] });
    if (path.match(/^\/api\/spools\/\d+\/(move|trust_printer|correct_weight|archive|reset_weight)$/)) return jsonResponse({ ok: true, demo: true });
    if (path.match(/^\/api\/spools\/\d+$/)) return method === 'GET' ? jsonResponse(demoSpools[0]) : jsonResponse({ ok: true, demo: true });
    if (path === '/api/spool-locations') return jsonResponse([{ id: 1, name: 'Shelf #1' }, { id: 2, name: 'Shelf #2' }, { id: 3, name: 'Shelf #3' }]);
    if (path.match(/^\/api\/spool-locations/)) return jsonResponse({ ok: true, demo: true });
    if (path === '/api/filament/costs') return jsonResponse([]);
    if (path.startsWith('/api/filament/costs/')) return jsonResponse({ ok: true, demo: true });
    if (path === '/api/filament/summary') return jsonResponse({
      total_grams: 5245,
      by_material: [
        { material: 'ASA', grams: 1831 },
        { material: 'PLA', grams: 238 },
        { material: 'PLA+', grams: 218 },
        { material: 'ABS', grams: 2958 },
      ],
    });
    if (path === '/api/filament/catalog/search') return jsonResponse({ items: [] });
    if (path === '/api/filament/catalog/sync') return jsonResponse({ ok: true, demo: true });
    if (path === '/api/files') return jsonResponse(filesDemo());
    if (path === '/api/files/reprints') return jsonResponse([]);
    if (path === '/api/files/queue' || path === '/api/files/library/copy') return jsonResponse({ ok: true, demo: true });
    if (path.match(/^\/api\/files\/bambu\/[^/]+\/clear$/)) return jsonResponse({ ok: true, demo: true });
    if (path === '/api/queue') return jsonResponse(clone(demoQueue));
    if (path === '/api/queue/summary') return jsonResponse({ h2d: 1, x1c: 1 });
    if (path.match(/^\/api\/queue\/\d+\/preview$/)) return textResponse('', 404);
    if (path.match(/^\/api\/queue\/\d+/) || path === '/api/queue/upload' || path === '/api/queue/completed') return jsonResponse({ ok: true, demo: true });
    if (path === '/api/failures') return jsonResponse(failuresDemo());
    if (path === '/api/printers/usage') return jsonResponse([
      { printer_id: 'h2d', total_seconds: 71 * 3600, total_prints: 22 },
      { printer_id: 'x1c', total_seconds: 7 * 3600, total_prints: 4 },
      { printer_id: 'greyhound', total_seconds: 112 * 3600, total_prints: 38 },
    ]);
    if (path === '/api/notifications') return method === 'DELETE' ? jsonResponse({ ok: true }) : jsonResponse(clone(demoNotifications));
    if (path.startsWith('/api/notifications/')) return jsonResponse({ ok: true, demo: true });
    if (path === '/api/scale/status') return jsonResponse({ ok: true, available: true, label: 'Dymo M10 USB scale', detail: 'Demo scale ready' });
    if (path === '/api/scale/read') return jsonResponse({ ok: true, grams: 536, stable: true });
    if (path === '/api/label_printer/status') return jsonResponse({ ok: true, available: true, label: 'Brother QL-700', detail: 'Demo label printer ready' });
    if (path.startsWith('/api/label_printer')) return jsonResponse({ ok: true, demo: true });
    if (path === '/api/config/printers') return jsonResponse(clone(demoPrinters));
    if (path.startsWith('/api/config/printers')) return jsonResponse({ ok: true, demo: true });

    return jsonResponse({ ok: true, demo: true }, 200);
  }

  function calendarDemo() {
    return {
      year: 2026,
      prints: 21,
      hours: 87.3,
      filament_kg: 0.11,
      days: {
        '2026-06-01': { count: 4, seconds: 14400 },
        '2026-06-02': { count: 2, seconds: 11800 },
      },
    };
  }

  function historyDemo() {
    return [
      { id: 501, printer_id: 'h2d', filename: 'can_openerV2', status: 'done', started_at: '2026-06-02 10:00:00', ended_at: '2026-06-02 14:30:00', duration_seconds: 16200, filament_weight_g: 97.3, filament_type: 'ASA', notes: 'Demo print', has_snapshot: false },
    ];
  }

  function failuresDemo() {
    return {
      items: [
        { id: 601, printer_id: 'x1c', printer_name: 'X1C', filename: 'abbiesdogtest.gcode.3mf', status: 'failed', started_at: '2026-06-01 12:00:00', error: 'AMS profile mismatch', progress: 0.08, material: 'PLA', timing_bucket: 'First 10m', spool_label: 'Unknown', has_snapshot: false },
        { id: 602, printer_id: 'greyhound', printer_name: 'Voron 2.4 350', filename: 'Cube_ABS_1h14m.gcode', status: 'cancelled', started_at: '2026-06-01 15:00:00', error: 'Toolhead not homed', progress: 0.02, material: 'ABS', timing_bucket: 'First 10m', spool_label: 'Spool #4', has_snapshot: false },
      ],
      total: 2,
      summary: {
        total: 2,
        by_printer: [{ key: 'x1c', label: 'X1C', count: 1 }, { key: 'greyhound', label: 'Voron 2.4 350', count: 1 }],
        by_material: [{ key: 'PLA', count: 1 }, { key: 'ABS', count: 1 }],
        by_timing: [{ key: 'First 10m', count: 2 }],
        by_spool: [{ key: 'Unknown', count: 1 }, { key: 'Spool #4', count: 1 }],
      },
    };
  }

  function filesDemo() {
    return {
      library_path: '/demo/print-vault',
      targets: [
        fileTarget('library', 'Print Vault', '', 'library', [file('can_openerV2.3mf', '3mf', 14200000), file('orca_cube_abs.gcode', 'gcode', 420000)]),
        fileTarget('greyhound', 'Greyhound Elite V2', 'Voron 2.4 350', 'moonraker', [file('orca_cube_abs.gcode', 'gcode', 420000), file('voron_panel_clip.gcode', 'gcode', 2100000)]),
        fileTarget('x1c', 'Greyhound Ludicrous', 'X1C', 'bambu', [file('tabby_cat_3d_model.gcode.3mf'), file('build-tower-2x4.gcode.3mf')]),
        fileTarget('h2d', 'BigBoy', 'H2D', 'bambu', [file('can_openerV2.gcode.3mf'), file('bed_scraper_multi_8h1m.gcode.3mf'), file('abbys_dog.gcode.3mf')]),
      ],
    };
  }

  const realFetch = typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : (input, options = {}) => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(options.method || 'GET', typeof input === 'string' ? input : input?.url);
        Object.entries(options.headers || {}).forEach(([key, value]) => xhr.setRequestHeader(key, value));
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => resolve(new Response(xhr.response, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: { 'Content-Type': xhr.getResponseHeader('Content-Type') || 'application/octet-stream' },
        }));
        xhr.onerror = () => reject(new TypeError('Network request failed'));
        xhr.send(options.body || null);
      });
  window.fetch = (input, options = {}) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (url && new URL(url, location.origin).pathname.startsWith('/api/')) {
      return Promise.resolve(route(url, options));
    }
    return realFetch(input, options);
  };

  class DemoWebSocket {
    constructor() {
      this.readyState = 0;
      setTimeout(() => {
        this.readyState = 1;
        this.onopen?.({ type: 'open' });
        this._sendPrinters();
        this._timer = setInterval(() => this._sendPrinters(), 5000);
      }, 120);
    }
    _sendPrinters() {
      this.onmessage?.({ data: JSON.stringify(clone(demoPrinters)) });
    }
    send() {}
    close() {
      this.readyState = 3;
      clearInterval(this._timer);
      this.onclose?.({ type: 'close' });
    }
  }

  window.WebSocket = DemoWebSocket;
  document.documentElement.classList.add('flightdeck-demo-mode');
})();
