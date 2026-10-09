# Bambu-Run comparison notes

Date: 2026-06-15

Source inspected:
- https://github.com/RunLit/Bambu-Run
- Local temporary clone used for inspection only: `%TEMP%/bambu-run-inspect`

Important license note:
- The GitHub repository page showed GPL-3.0, while `pyproject.toml` in the repo declared MIT.
- Until that mismatch is clarified, treat Bambu-Run as reference material only.
- Do not copy their code or full colour catalog into Flightdeck.

## Summary

Bambu-Run is a self-hosted Bambu monitoring and filament inventory dashboard. It overlaps with Flightdeck in Bambu telemetry, AMS inventory, print history, and filament usage. Its useful value for Flightdeck is mostly as a field checklist: Bambu MQTT fields, cloud task metadata, token/auth handling, and Bambu filament colour naming.

Flightdeck should not adopt its Django/dashboard architecture. Flightdeck's stronger angle remains the live print-room cockpit: cameras, queue/reprint, recovery, AMS/loadout truth, skip objects, Print Memory, cost, and operator workflow.

## Feature comparison

| Area | Bambu-Run | Flightdeck implication |
| --- | --- | --- |
| Runtime | Django app plus collector service | No architecture change needed |
| Bambu data path | Uses `bambu-lab-cloud-api` plus MQTT collector | Compare field coverage only |
| Bambu auth | Username/password, email verification, saved token | Add clearer Bambu token/account health later |
| Print history | Tracks MQTT jobs and can link Bambu cloud tasks | Possible Print Memory enrichment |
| Filament tracking | AMS snapshots, auto-created filaments, percent usage | Compare matching fields; keep Flightdeck spool truth model |
| Colour catalog | Bundled Bambu colour text files | Build our own safe catalog/importer from official/user-owned sources |
| AMS HT handling | Notes that physical AMS unit IDs like `128` matter | Confirms our AMS HT caution; do not refactor mapping casually |
| MCP/tools | Query helpers for printer status/history/filaments | Useful idea for future Walkthrough/assistant mode |

## Useful implementation clues

### Cloud task sync

Bambu-Run wraps the Bambu cloud task endpoint:

- `v1/user-service/my/tasks`

Fields it stores from tasks include:

- task id
- design id / design title
- plate title
- model id / profile id
- plate index
- device serial
- cover URL
- weight grams
- length mm
- cost time seconds
- cloud status
- bed type
- use AMS
- print mode
- AMS detail mapping
- cloud start/end time

Potential Flightdeck value:

- Better Print Memory display names for Bambu cloud-origin jobs.
- Cloud-reported weight/duration as a secondary truth source.
- Possible per-filament usage reconciliation if `amsDetailMapping` is reliable.
- Backfill/diagnostic tool for jobs where local MQTT was interrupted.

Guardrail:

- This should be optional. Flightdeck must stay useful in LAN/local-first operation and not depend on Bambu cloud.

### Bambu auth/session handling

Bambu-Run expects Bambu account credentials or a saved token. Its setup flow warns users that Bambu may email a verification code, then stores `BAMBU_TOKEN` for future runs.

Potential Flightdeck value:

- A Settings/Diagnostics card that says whether Bambu cloud token support is configured.
- A plain-English diagnostic for expired cloud login/token.
- A future one-shot "refresh Bambu cloud token" setup helper.

Guardrail:

- Keep printer LAN access and local MQTT/FTP separate from optional cloud sync.

### MQTT parser checklist

Fields worth comparing against Flightdeck's Bambu parser:

- AMS tray: `id`, `tray_id_name`, `tray_type`, `tray_sub_brands`, `tray_color`, `remain`, `tray_weight`, `tray_diameter`, `tray_temp`
- AMS tray identity: `tag_uid`, `tray_uuid`, `tray_info_idx`
- AMS calibration/material: `k`, `n`, `cali_idx`, `total_len`, `cols`
- AMS temperature guidance: `nozzle_temp_min`, `nozzle_temp_max`, `bed_temp`, `bed_temp_type`
- AMS unit: `ams_id`, `id`, `humidity`, `humidity_raw`, `temp`, `dry_time`, `chip_id`, `info`
- AMS global: `ams_exist_bits`, `tray_exist_bits`, `tray_now`, `tray_pre`, `tray_tar`, `ams_status`, `ams_rfid_status`, `tray_is_bbl_bits`, `tray_read_done_bits`
- Printer: `gcode_state`, `mc_percent`, `mc_remaining_time`, `layer_num`, `total_layer_num`, `gcode_file`, `subtask_name`, `task_id`, `project_id`, `profile_id`, `print_type`
- Fans: `cooling_fan_speed`, `heatbreak_fan_speed`, `big_fan1_speed`, `big_fan2_speed`
- Health: `print_error`, `hms`, `stg_cur`, `lifecycle`, `wifi_signal`
- External spool: `vt_tray`

Dual-nozzle clue:

- Bambu-Run notes that H2C/H2D-style dual nozzle telemetry can appear under `print.device.extruder.info[]`.
- It treats index `0` as right and index `1` as left.
- It notes a bit-packed `temp` value: target in the high 16 bits, current in the low 16 bits.

This should be verified against live BigBoy telemetry before changing Flightdeck.

### AMS type labels

Bambu-Run maps these AMS `info` codes:

| `info` code | Label |
| --- | --- |
| `1001` | AMS |
| `1003` | AMS 2 Pro |
| `2104` | AMS HT |

Potential Flightdeck value:

- Compare with live MQTT dumps and use as a fallback label source if our current type naming is incomplete.

Guardrail:

- Treat these as observed hints, not universal truth, until verified on our printers.

## Bambu colour catalog notes

Bambu-Run ships colour text files under `docs/Bambu_Color_Catalog/`.

Do not copy the full catalog into Flightdeck until license/source is clarified. Use it as a shape reference for our own safe catalog.

Observed file inventory from the temporary clone:

| File | Estimated hex colours | Notes |
| --- | ---: | --- |
| `ABS.txt` | 14 | Name plus `Hex:#RRGGBB` format |
| `ASA.txt` | 0 | Nonstandard/short format in inspected clone |
| `PA6-GF.txt` | 0 | Nonstandard/short format in inspected clone |
| `PC FR.txt` | 0 | Nonstandard/short format in inspected clone |
| `PETG HF.txt` | 0 | Nonstandard/short format in inspected clone |
| `PETG Translucent.txt` | 0 | Nonstandard/short format in inspected clone |
| `PLA Basic.txt` | 30 | Name plus `Hex:#RRGGBB` format |
| `PLA Matte.txt` | 25 | Name plus `Hex:#RRGGBB` format |
| `PLA Wood.txt` | 0 | Nonstandard/short format in inspected clone |

Small sample only, not a full import:

| Family | Colour name | Hex |
| --- | --- | --- |
| PLA Basic | Jade White | `#FFFFFF` |
| PLA Basic | Magenta | `#EC008C` |
| PLA Basic | Gold | `#E4BD68` |
| PLA Basic | Mistletoe Green | `#3F8E43` |
| PLA Basic | Red | `#C12E1F` |
| PLA Basic | Purple | `#5E43B7` |
| PLA Basic | Beige | `#F7E6DE` |
| PLA Basic | Pink | `#F55A74` |
| PLA Basic | Sunflower Yellow | `#FEC600` |
| PLA Basic | Bronze | `#847D48` |

Safe Flightdeck plan for colour support:

1. Create a Flightdeck-owned colour catalog schema, not a copied Bambu-Run import.
2. Source colours from official Bambu filament pages/PDFs or user-provided files.
3. Store source attribution and import date per catalog row.
4. Match by material, sub-type, brand, and RGB hex.
5. Treat transparent Bambu colours carefully: MQTT may report alpha as `00`; display should show clear/transparent rather than solid black.
6. Add a dry-run importer before writing any spool colour names.

## Suggested Flightdeck backlog items

1. Bambu parser comparison
   - Compare the field checklist above against `app/printers/bambu.py`.
   - Add missing passive telemetry fields only if they improve UI, diagnostics, or spool truth.

2. Optional Bambu cloud task sync
   - Start as a diagnostics/backfill tool for Print Memory.
   - Do not make cloud sync part of dispatch or basic printer operation.

3. Bambu auth health card
   - Detect configured/not configured/expired token states.
   - Explain the difference between local printer access and optional Bambu cloud enrichment.

4. Flightdeck colour catalog
   - Build from official/user-owned source files.
   - Use Bambu-Run only as a reminder of file shape and matching fields.

5. Walkthrough Mode tie-in
   - Later, use printer/filament/history query helpers as the basis for a guided "put Flightdeck through its paces" checklist.

