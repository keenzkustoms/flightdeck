## 2026-10-02 — Compact machine controls and wider AMS workspace
- User requested temperatures/cooling beneath Movement, with a wider right-hand filament panel so AMS 1 and AMS HT can sit alongside each other.
- Live workspace now uses a narrow left column stacking Movement and compact thermal controls, with Loaded filament occupying the remaining width. Temperature rows and fan controls are compact; all existing IDs, handlers and interlocks retained.
- AMS units wrap when the available width is insufficient; phone layout stacks both columns. Static cache versions app 746 / CSS 518.
- Verified in local demo: 1280px and 1440px AMS 1/HT side by side, 1024px wraps units, 390px stacks panels with no document overflow. Six Node control/layout tests pass; app.js syntax check passes; no preview console errors. Publication follows verification; Pi deployment still pending (currently 5925d4d). Windows Git HEAD/index still at prior base; use published 5925d4d as the comparison base when publishing this change. Preserve unrelated local changes.

## 2026-10-02 Publication confirmed

GitHub main was advanced without force to 5925d4d1dedcd7b836c42289dfd1aebf822c6174 and read back to verify it. Commit: https://github.com/Kidabah/flightdeck/commit/5925d4d1dedcd7b836c42289dfd1aebf822c6174. Only the 12 intended rebuild/parser/test/documentation files are included; app/camera.py, Jukebox and PrintShelf edits are excluded. Nine tests passed. The committed handoff contains deployment instructions; this local confirmation records the resulting SHA. Windows local HEAD remains 8daad1b because its Git metadata is not writable here. Do not stage and push the identical code again without reconciling with remote main.

Pi deployment is still pending and unverified. Pull main, restart flightdeck.service, confirm active and static cache app.js 745 / style.css 516, then verify live workspace and cameras. The user is providing the Pi-side SSH actions because this session cannot read its SSH key.

---
## 2026-10-02 Publication handoff (workspace rebuild first pass)

Publishing the tested first rebuild pass to main through the GitHub connection because this session cannot write the Windows checkout's Git index. Includes the combined live controls row, upcoming per-printer queue, remaining-time Fleet Wall ordering and persistent drag/keyboard pins; also includes the updater filename parsing fix. Nine focused tests passed (six Node and three Python), JS syntax and diff whitespace checks passed. Earlier browser demo verification is recorded below. Static cache: app.js 745, style.css 516, demo-runtime.js 10. See docs/FLIGHTDECK_REBUILD.md for the accepted roadmap and remaining work.

Pi deployment is pending: pull main, restart flightdeck.service for the backend parser fix, confirm service active and the served static versions, then verify the real camera wall and printer workspace. No physical commands are required for that verification. Local Windows HEAD/index are not advanced by a GitHub publication; do not mistake the resulting local diff for a second unpublished change. Preserve unrelated local edits when reconciling the checkout.

Live troubleshooting outcome: the user stashed the generated Amy graph and the Pi reported dirty=false on 8daad1b. H2D camera port 322 first refused, then timed out while ping remained healthy; it opened after LAN Only Liveview changes. User supplied a screenshot confirming all three camera images returned and said Bambu Studio camera activation may have contributed. The exact trigger remains uncertain. app/camera.py is a pre-existing local edit and is NOT included in this publication.

---
## 2026-10-02 Session update (updater blockage diagnosis)

The Windows desktop launcher connects to https://flightdeck.tail7de73e.ts.net; its updater checks the Pi checkout, not the Windows source checkout. The screenshot reports a local graph-data.js change. Found and locally fixed a parsing bug: _git_text().strip() removed the first porcelain status column space, so the first unstaged filename lost its first letter. The likely actual path is amy/viewer/graph-data.js, a generated notes index (amy/build.py). Three regression tests and backend AST validation passed. app/main.py and tests/test_update_paths.py remain local/uncommitted; this backend fix requires service restart after deployment.

Live remediation is NOT complete: old LAN IP timed out; Tailscale SSH reached the host, but the existing dedicated SSH key could not be read despite granted filesystem access. No Pi stash, restore, pull or restart was performed. Do not describe this as fixed live. Preserve the generated file with a path-specific stash before clearing the blocker; do not reset the repository or discard the source notes. Recheck the exact live path/diff first. The rebuild is still uncommitted/unpublished, so clearing the local-change blocker alone cannot install it.

---
## 2026-10-02 Session update (Flightdeck rebuild: first implementation)

Started the WatchTower-inspired rebuild from the agreed design brief. This is a local implementation, not a verified Pi deployment.

- Live printer workspace: camera/current job above, upcoming per-printer queue beside the job, and Movement → Loaded filament → Temperatures & cooling below. Reuses existing control handlers and state interlocks. Queue fetch is shared/throttled to 15 seconds during live updates; failures show an unavailable notice rather than a false empty result.
- Fleet Wall: active printing machines sort by calibrated remaining time, unknown ETA follows known ETA, and other states retain existing attention/bench ordering. Drag Move to reserve a card position; arrow keys provide placement too. Pin/Unpin and Restore automatic order are available. Preferences save in the viewer's browser. Telemetry reordering moves existing card nodes rather than rebuilding camera elements.
- Demo repair: filled missing route containers and added the single-printer telemetry response so direct printer links work. Excluded the existing usage endpoint from that matcher.
- New files: app/static/fleet-layout.mjs; tests/fleet-layout.test.mjs; tests/live-workspace.test.mjs; docs/FLIGHTDECK_REBUILD.md. Updated app.js, style.css, index.html, demo.html, demo-runtime.js. Static cache: app.js 745, style.css 516, demo-runtime.js 10.
- Verification: six Node tests passed (ETA ordering/calibration, stable pins, collisions/removal/48 devices, movement/thermal interlocks and separate control groups); JS syntax checked. Browser demo verified pointer drag, keyboard placement, reset, reload persistence, H2D/Voron panels, per-printer queue and unavailable AMS on Voron. Camera height/layout checked after fixing collapsed flex layout. Phone page has no document overflow; existing horizontally scrollable sub-tabs extend within the printer container. No errors in the clean workspace browser session. No physical commands issued.
- Git: commit attempted but .git/index.lock creation was denied even after checkout and Git-directory write grants. Changes remain local and uncommitted. No unrelated files staged.
- Deployment: not pushed or deployed; Pi commit/service/static versions have NOT been checked. Backend unchanged. After deployment verify actual camera refresh, queue updates and physical-control gating before acceptance; frontend hard refresh required. Do not claim fixture counts prove host camera capacity.
- Next: finish the compact/all-in-one workspace polish (files/upload currently use Browse print files), scalable fleet-card filters/grouping/density, then real LAN discovery progress/pairing. Shared smart queue, filament remapping/library metadata, AI detection and ejection remain scoped later milestones in docs/FLIGHTDECK_REBUILD.md.
- Preserved pre-existing edits in app/camera.py, jukebox/docker-compose.yml and PrintShelf scripts; unrelated untracked files were not included.

---
## 2026-10-02 Session update (fleet history on Print Memory)

Latest commit: `28b5744` — Print Memory now opens with a card for each printer: finished print time, filament used, and finished / failed / cancelled counts. The day filter at the top of the list changes that window. Click a card to show only that printer.

- Files: `app/db.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`. Cache: `style.css?v=513`, `app.js?v=742`.
- Backend change. Hard refresh Print Memory. Pi pull plus `flightdeck.service` restart.

---

## 2026-10-02 Session update (AMS slot remaining meter)

Latest commit: `d761138` — Each AMS colour slot now shows a small green bar and percent so remaining filament stays visible after the H2D AMS view loads. The full Loaded list was only appearing on restart, before AMS data replaced it.

- Files: `app/static/app.js`, `app/static/style.css`, `app/static/index.html`. Cache: `style.css?v=512`, `app.js?v=741`.
- UI only. Hard refresh the printer page. Pi pull is enough; Flightdeck restart is optional.

---

## 2026-09-27 Session update (jarvis folder is now amy)

Latest commit: `d17508b` — The Amy tree moved from `jarvis/` to `amy/`. The Pi user unit is `amy.service`. Desktop shortcut and the local Amy window were pointed at the new path. Old session notes still say jarvis.

- Files: `amy/` (renamed from `jarvis/`), `.gitignore`, `tests/test_flightdeck_page.py`, `tests/test_printer_voice.py`.
- Pi: stop `jarvis`, pull, move `config.json` into `amy/`, enable `amy.service`. Local Amy was restarted. No Flightdeck service restart.

---

## 2026-09-27 Session update (duplicates appear while listing)

Latest commit: `23b285a` — Matches were hidden until the whole library had been counted. A second copy is now compared as soon as it is seen, so the list fills while the file count is still climbing.

- Files: `printshelf/desk/server.py`, `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=33`.
- Local MeshFinder was restarted and Analyze is running again. Open Duplicates. No Pi service restart.

---

## 2026-09-27 Session update (duplicates scan keeps matches)

Latest commit: `717228e` — The empty Duplicates page was an unfinished scan, not a clean library. The old library still has 532 copies in 243 groups, mostly on Koko. The scan now lists that share without stat-ing every excluded folder, saves matches as it finds them, and includes whole zip archives as well as the models inside them.

- Files: `printshelf/desk/server.py`, `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=32`.
- Local MeshFinder was restarted and Analyze is running. Open Duplicates to watch the count. No Pi service restart.

---

## 2026-09-26 Session update (tick folders to exclude)

Latest commit: `37c62d6` — Each folder has a checkbox. A button above the list reads “N folders to exclude” and hides every ticked folder in one go. The tree stays put. The config folders were already saved as excluded; a hard refresh drops them from this window.

- Files: `printshelf/desk/static/app.js`, `style.css`, `index.html`. Cache: `style.css?v=22`, `app.js?v=31`.
- Hard refresh. The window was left running so the duplicate scan can finish. No Pi service restart.

---

## 2026-09-26 Session update (exclude no longer jumps to Koko)

Latest commit: `04c8db7` — Exclude from library only removes that folder row. The tree stays scrolled where it is, and the gallery stays on the folder you already had open.

- Files: `printshelf/desk/static/app.js`, `style.css`, `index.html`. Cache: `style.css?v=21`, `app.js?v=30`.
- Hard refresh. The window was left running so the duplicate scan can finish. No Pi service restart.

---

## 2026-09-26 Session update (exclude stays put)

Latest commit: `d879773` — Exclude from library is back on the folder menu. Hiding a folder only removes that row. The tree no longer jumps back to the last folder you opened.

- Files: `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=29`.
- Hard refresh. The window was left running so the duplicate scan can finish. No Pi service restart.

---

## 2026-09-26 Session update (no exclude reminder)

Latest commit: `7fe11fc` — right-click on a folder no longer offers Exclude from library. Folders already hidden stay hidden. The duplicate scan was left running.

- Files: `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=28`.
- Hard refresh to pick it up. No window restart, so Analyze can keep going. No Pi service restart.

---

## 2026-09-26 Session update (Analyze no longer blanks the page)

Latest commit: `f3ad7fd` — clicking Analyze left the request unread, so the next check came back as HTTP 501 and wiped the page. That body is read now. Open Duplicates and press Analyze again.

- Files: `printshelf/desk/server.py`, `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=27`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (plain duplicates)

Latest commit: `108c5bb` — Duplicates sits under Collections. Analyze finds the same file saved twice. Keep one, delete the spare loose copies. Copies inside a zip are listed and left alone. No filters, review tabs, or geometry matching.

- Files: `printshelf/desk/server.py`, `printshelf/desk/static/app.js`, `style.css`, `index.html`. Cache: `app.js?v=26`, `style.css?v=20`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (Flightdeck icon opens Flightdeck)

Latest commit: `2cc2fdb` — clicking Flightdeck was raising MeshFinder, because both icons start through pythonw and Windows treated them as one app. Each window now has its own taskbar identity, and the shortcuts were stamped to match.

- Files: `desktop/launch.py`, `printshelf/desk/launch.py`, `printshelf/desktop/launch.py`.
- Local MeshFinder reopened. No Pi service restart.

---

## 2026-09-26 Session update (path bar and a draggable folder edge)

Latest commit: `620fa17` — the folder path sits across the top, like Meshory. Click a parent to jump there, or the house to go to the top of that library. Drag the edge between the folders and the cards to make the tree wider. Double-click that edge to put it back.

- Files: `printshelf/desk/static/app.js`, `style.css`, `index.html`. Cache: `app.js?v=25`, `style.css?v=19`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (Favourites and Collections stay put)

Latest commit: `0252ac2` — Favourites and Collections sit under the Folders heading and stay there. Only the directory list scrolls.

- Files: `printshelf/desk/static/app.js`, `style.css`, `index.html`. Cache: `app.js?v=24`, `style.css?v=18`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (click a folder to close it)

Latest commit: `e7646ff` — click an open directory again and it folds shut. The little mark shows › when closed and ⌄ when open. Hard refresh if the tree still only grows.

- Files: `printshelf/desk/static/app.js`, `style.css`, `index.html`. Cache: `app.js?v=23`, `style.css?v=17`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (folder list scrolls under the heading)

Latest commit: `d3204f5` — Folders and Add stay put. The directory list scrolls underneath them. The top bar stays above that.

- Files: `printshelf/desk/static/style.css`, `index.html`. Cache: `style.css?v=16`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (cards back in frame)

Latest commit: `49fe6e6` — a card takes its height from how wide the column is, so 3, 4, and 5 keep the model in the picture instead of stretching to the window.

- Files: `printshelf/desk/static/style.css`, `index.html`. Cache: `style.css?v=15`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (cards came back)

Latest commit: `1592e3e` — the 5-across view had flattened every card into a line. The picture area takes its height from the card width again, so 3, 4, and 5 all show the model.

- Files: `printshelf/desk/static/style.css`, `app.js`, `index.html`. Cache: `style.css?v=14`, `app.js?v=22`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (3, 4, 5 cards)

Latest commit: `c857f4f` — the grid is 3, 4, or 5 across, and the card grows and shrinks with that so the model stays whole.

- The old 2 and 6 buttons locked the card height. A card is now a bit taller than it is wide, and that shape holds at every size.
- Files: `printshelf/desk/static/index.html`, `style.css`. Cache: `style.css?v=13`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (card spacing and FDM tag)

Latest commit: `182e7ea` — printable cards show an FDM tag, and the grid has more room between cards.

- Files: `printshelf/desk/static/app.js`, `style.css`, `index.html`. Cache: `app.js?v=21`, `style.css?v=12`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (whole folder, not each zip)

Latest commit: `95bcc4c` — clicking a folder loads every zip in it, the way Meshory loads Dragon Ball Z.

- Zip files are no longer separate branches in the tree. The first page mixes models from each zip in that folder. Show more keeps going through the rest.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=20`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (desktop icon)

Latest commit: `0b059b4` — clicking the MeshFinder desktop icon brings the window forward.

- The window was opening behind other apps, and a second click did not pull it up. A click now raises it.
- Files: `printshelf/desk/launch.py`. No cache bump.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (document cards)

Latest commit: `74a4be2` — a PDF, text, markdown, or CSV file gets a card picture.

- Turn Printable off and documents show up. A PDF uses the first page. Text files show the opening lines on a page, with the file type in the corner. They no longer sit there as the word DOC.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=19`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (cut-off STL files)

Latest commit: `4fe4872` — MeshFinder opens an STL whose header claims more triangles than the file holds.

- `tronco_boo.stl` and `tronco_gotenks.stl` in the Dragon Ball zip are short copies. The viewer was reading past the end of the file. It now draws the triangles that are there and says the copy looks cut off. Cards get a picture too.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/viewer.js`, `vendor/loaders/STLLoader.js`, `index.html`. Cache: `viewer.js?v=11`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (saved library map)

Latest commit: `eb270fb` — MeshFinder reopens on the tree you had open and the folder you were in.

- Expanded folders and the last place are saved. The file list from the last scan is used straight away, and a fresh walk happens in the background only when that list is a few hours old.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=18`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (shift-select)

Latest commit: `ce04d1a` — shift-click selects a run of cards while adding to a collection.

- Click the first card, then shift-click the last. Everything between them is selected and the bar can add them.
- Files: `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=17`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (collections)

Latest commit: `68ffb9b` — collections use an in-app window, not a browser prompt.

- Collections sits in the folder list. New collection opens a name window. Add models turns Printable off, and selecting cards shows a bar to add them.
- Right-click a folder for Show in Explorer, Rename, Exclude from library, or Add to collection. Exclude only hides it here.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/`. Cache: `app.js?v=16`, `style.css?v=11`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (empty folder note)

Latest commit: `b95bb8e` — a folder of only subfolders no longer looks like a failed scan.

- DONE FILES 1 has 19 folders and no files of its own. With All off, the grid stays empty until a subfolder is opened.
- Files: `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=13`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (MeshFinder matches the app)

Latest commit: `589ab3b` — MeshFinder uses the Flightdeck window style.

- Header, colours, and sidebar now follow the other desktop apps. Opening it again brings the same window forward.
- Files: `printshelf/desk/launch.py`, `printshelf/desk/static/`. Cache: `style.css?v=9`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (painter opens in the app)

Latest commit: `80dd2b9` — Send to STL Painter opens the Flightdeck app, not the browser.

- The handoff still uploads the model to the Pi. The desktop window then switches to STL Painter. The first send may reopen the app if that window is an older copy.
- Files: `desktop/launch.py`, `printshelf/desk/server.py`, `printshelf/desk/static/`. Cache: `app.js?v=12`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (send to STL Painter)

Latest commit: `23b04e4` — right-click a model and it opens in STL Painter on the Pi.

- Send to STL Painter uploads the STL, OBJ, or 3MF to Flightdeck and opens Painter with that file. It does not start a print.
- Hard refresh Flightdeck so the shell is `app.js?v=740` and Painter says **b630**.
- MeshFinder cache: `app.js?v=11`. Local window reopened. Pi service restarted.

---

## 2026-09-26 Session update (library search)

Latest commit: `8a04378` — a search box at the top matches file names.

- Type two or more letters. Printable still applies, so turn it off to find SVGs and pictures. Ctrl+F focuses the box. Escape clears it.
- Names on this PC show up straight away. Files inside zips, and files on the Koko share, join in once a background list finishes. The first pass through Koko can take a while.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/`. Cache: `app.js?v=10`, `style.css?v=8`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (card menu and printable filter)

Latest commit: `ecf1625` — right-click a card, and switch between printable files and everything else.

- Right-click a card for Open, Open in slicer, Show in Explorer, Go to location, and favourites. Go to location opens that folder in the tree and highlights the file.
- Printable is on by default, so the grid stays models. Turn it off to also see pictures, SVGs, and documents.
- Search and Send to STL Painter are next, once the painter app path is known.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/`. Cache: `app.js?v=9`, `style.css?v=7`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (solid 3MF view, card details, favourites)

Latest commit: `907f4c9` — the bed view stays solid, cards show zip and size, and a heart saves favourites.

- A round 3MF looked like dust on the bed because the viewer skipped most triangles. It now uses the same solid surface as the card.
- Each card shows the kind, the zip name when the file is inside one, the file name, and the size. A heart adds it to Favourites in the folder list.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/`. Cache: `app.js?v=8`, `style.css?v=6`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (3MF cards and viewer)

Latest commit: `def3fb1` — a 3MF gets a picture on the card and opens on the bed.

- STL and OBJ were already solid. A 3MF was still just the word. The mesh inside the package is drawn the same way, and a click puts it on the bed so a face can be laid flat.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/app.js`, `viewer.js`, `index.html`. Cache: `app.js?v=7`, `viewer.js?v=10`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (solid shaded cards)

Latest commit: `53ddb8a` — card pictures are shaded models, not a dotted sketch.

- The dotted cards looked rough. A card now draws the real surface, shaded, so a dog or a figure reads as the model. The first pass through a folder takes a few seconds per new file, then the picture is saved.
- Files: `printshelf/desk/server.py`. Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (solid mesh cards)

Latest commit: `65ef2d7` — card pictures are filled in instead of a dotted shell.

- The first pictures were only dots, so the models looked full of holes. Each card now paints a solid surface. A real opening in the mesh, like the top of a cup, still shows.
- Files: `printshelf/desk/server.py`. Same card URL. Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (cards are pictures of the mesh)

Latest commit: `40bd747` — STL and OBJ cards get a picture from the server.

- The window never painted the 3D preview onto the card, so they stayed as the word STL. The server now draws a small picture of the mesh, including models inside a zip, and the card shows that picture the same way it shows a photo.
- Desktop shortcut: `MeshFinder.lnk` opens the local library. The taskbar icon still opens the Pi library.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/app.js`, `index.html`. Cache: `app.js?v=6`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (STL cards show the model)

Latest commit: `3a27ae5` — library cards draw a picture of the mesh, including models packed in a zip.

- Cards only said STL because anything over 8MB was skipped, and almost every mesh in Downloads is that big. A short sample of the file is drawn on the card instead of loading the whole model. STL cards fill in first. A big OBJ takes a few seconds the first time, then it is cached.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/`. Cache: `app.js?v=5`, `viewer.js?v=9`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (face highlight covers a patch)

Latest commit: `c92b9b3` — hovering a smooth model lights a patch, not one triangle.

- A curved nose was one tiny triangle because only perfectly flat neighbours joined. The highlight now grows across triangles facing the same way and stops at a sharp edge. Clicking lays that patch on the bed.
- Files: `printshelf/desk/static/viewer.js`, `index.html`. Cache: `viewer.js?v=8`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (grid cards and whole-face highlight)

Latest commit: `c4f082a` — library cards keep their height, and a click highlights the whole flat face.

- The 2-across view had squeezed every card into a line. Cards now keep a picture area and a name. Hover lights the whole flat face, not one triangle, including on OBJ.
- Files: `printshelf/desk/static/`. Cache: `app.js?v=4`, `style.css?v=5`, `viewer.js?v=7`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (click a face to lay it on the bed)

Latest commit: `3e71672` — click a face in the local viewer and that face goes flat on the bed.

- Drag still orbits. A click, without a drag, turns the clicked face down onto the plate. The face under the pointer lights up first.
- Files: `printshelf/desk/static/viewer.js`, `style.css`, `index.html`. Cache: `viewer.js?v=6`, `style.css?v=4`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (model grid before the viewer)

Latest commit: `8bcf96a` — the local library opens as a grid of models.

- Four across is the default. 2, 6, and list are on the same bar. All shows every model in the folder and its subfolders, including models inside zips. Click a card to open the viewer. Library brings the grid back.
- Files: `printshelf/desk/server.py`, `printshelf/desk/static/`. Cache: `app.js?v=3`, `style.css?v=3`, `viewer.js?v=5`.
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (OBJ stands, STL stays Z-up)

Latest commit: `e475325` — OBJ models keep their own up axis so they are not rolled onto the plate.

- An OBJ dog was treated as Z-up, which laid him on his side. OBJ now sits on its lowest Y. STL still sits on Z, then stands up on the grid.
- Files: `printshelf/desk/static/viewer.js`, `printshelf/desk/static/index.html` (`viewer.js?v=4`).
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (model sits on the plate)

Latest commit: `41d6dbf` — models stand on the grid instead of through it.

- The viewer was centring the mesh, so the plate cut through the middle. The lowest point is now z = 0 and the model stands on the grid.
- Files: `printshelf/desk/static/viewer.js`, `printshelf/desk/static/index.html` (`viewer.js?v=3`).
- Local window reopened. No Pi service restart.

---

## 2026-09-26 Session update (local viewer was covered)

Latest commit: `d404ae7` — the local viewer was hidden behind an empty panel.

- The placeholder and picture panes stayed on top of the model, so the middle looked blank. They now get out of the way. The 3D library loads from this PC.
- Files: `printshelf/desk/static/`. Reopen the local window.
- Runs on the PC. No Pi service restart.

---

## 2026-09-26 Session update (MeshFinder local window, stage 1)

Latest commit: `c85a656` — a local MeshFinder window on this PC.

- Stage 1 only. Folders on the left, the open file in the middle, files on the right. Downloads is the starting folder. STL and OBJ orbit. Pictures, PDF, and text open in the middle. A zip opens like a folder. Open in slicer hands the file to Windows.
- The taskbar icon still opens the Pi library. This window is separate.
- Files: `printshelf/desk/server.py`, `printshelf/desk/launch.py`, `printshelf/desk/static/`.
- Runs on the PC. No Pi service restart.

---

## 2026-09-26 Session update (MeshFinder scan stays usable)

Latest commit: `b2834fd` — MeshFinder lists files while a scan runs.

- A library scan was re-reading every unchanged zip and committing once per file, so the grid sat on blank cards and the API stopped answering. Unchanged files are now marked seen in batches. Mesh thumbs for old zips stay on Rebuild thumbs.
- Cards show the file type straight away, then the picture when it loads.
- Files: `printshelf/app/scanner.py`, `printshelf/app/db.py`, `printshelf/static/app.js`, `printshelf/static/style.css`, `printshelf/static/index.html`.
- Cache: `app.js?v=76`, `style.css?v=69`. Restart printshelf. Reopen MeshFinder.

---

## 2026-09-25 Session update (check a spool in the AMS)

Latest commit: `6873e01` — “Check if spool 14 is in AMS 1 slot 2 on BigBoy” reads Flightdeck.

- She answers from the spool list. “Where is spool 14” and “what’s in AMS 1 slot 2” work too. She does not move the spool.
- AMS 1 slot 2 is the second slot of the first AMS. AMS HT stays the HT bay.
- Files: `jarvis/server.py`, `jarvis/workshop_actions.py`.
- Amy restarted. Pi jarvis restart is in the deploy.

---

## 2026-09-25 Session update (spool into AMS HT)

Latest commit: `904227d` — “Put spool 12 in BigBoy’s AMS HT” loads that slot.

- She looks the spool up by its number and moves it into the AMS. Leave the slot off and she uses the HT bay. “AMS HT slot 2” is the second HT slot. She does not start a print.
- Same words work for Big Girl and the X1C. A normal AMS uses “AMS slot 1”.
- Files: `jarvis/server.py`, `jarvis/workshop_actions.py`.
- Amy restarted. Pi jarvis restart is in the deploy.

---

## 2026-09-25 Session update (print vocabulary)

Latest commit: `131aacf` — Amy understands more than the word queue.

- Reprint, print, print again, send, run, start, fire, and kick off a named file all start it on the printer you name. Queue, que, add, put, and line up only wait.
- “Start the print” or “send the print” with no file name still does not pick a file. Pause and stop are unchanged.
- Files: `jarvis/workshop_actions.py`, `jarvis/server.py`.
- Amy restarted. Pi jarvis restart is in the deploy.

---

## 2026-09-25 Session update (reprint a named file)

Latest commit: `5733cdc` — “Reprint pla box on BigBoy” starts that file.

- “Reprint pla box on BigBoy” finds the file and sends it. “Print pla box on BigBoy” does the same. “Queue the pla box on BigBoy” still waits and does not start.
- Pause, resume, and stop are unchanged.
- Files: `jarvis/workshop_actions.py`, `jarvis/server.py`.
- Amy needs a restart. Pi jarvis restart is in the deploy. No Flightdeck page change.

---

## 2026-09-25 Session update (queue by a short phrase)

Latest commit: `1901570` — “Queue the pla box on BigBoy” finds the file and waits.

- “Queue the pla box on BigBoy” works the same as the longer “open desktop 3mf … and queue it” line. Two matches, she asks which one. The job is marked Waiting, so an idle printer does not start it. Press send on the Queue page when you want it to print.
- A test upload of pla box did start, because the old queue still auto-sends. That print was cancelled and BigBoy is idle. Say it again after this deploy and it should wait.
- “Stop the print on BigBoy” now sends cancel, which is the action the printer accepts.
- Files: `jarvis/server.py`, `jarvis/workshop_actions.py`, `app/main.py`, `app/db.py`, `app/static/app.js`, `app/static/style.css`.
- Cache: `app.js?v=739`, `style.css?v=511`. Hard refresh Flightdeck. Amy was restarted. Pi deploy includes the backend restart.

---

## 2026-09-25 Session update (queue a named file)

Latest commit: `822c920` — “Queue it on BigBoy” puts that file on his queue.

- “Open desktop 3mf bedscraper_pla and queue it on BigBoy” finds the file and adds it to BigBoy’s queue. Two matches, she asks which one. She does not start the print.
- Files: `jarvis/server.py`, `jarvis/workshop_actions.py`, `app/main.py`.
- Restart Amy. Backend restart on the Pi is included in deploy.

---

## 2026-09-25 Session update (open any folder)

Latest commit: `fab104a` — Amy opens whatever folder you name.

- “Open the downloads folder”, “open folder Projects”, or a full path. She opens that folder so you can paste a file. She does not send it to a printer.
- File: `jarvis/server.py`, `jarvis/workshop_actions.py`.
- Amy was restarted. Downloads was opened once to check it.

---

## 2026-09-25 Session update (Flightdeck pages)

Latest commit: `5a571e6` — Amy opens a page inside Flightdeck.

- “Open the queue” switches the Flightdeck window to the Queue. Same for Spools, Fleet Wall, Flight Tower, Projects, Settings, and a printer (“open BigBoy”). She does not start a print from that.
- Files: `desktop/launch.py`, `jarvis/server.py`, `jarvis/workshop_actions.py`.
- Flightdeck was reopened so the page switch is live. Ask her again if you want another page.

---

## 2026-09-25 Session update (Amy stays up, and her icon)

Latest commit: `8dee8d5` — Amy naps later, and the taskbar button is her face.

- Quiet time before a nap is 90 minutes now (it was 6). She yawns around the hour mark. Click the AWAKE chip under her name to switch 30m, 1h, 90m, 2h, or STAY UP. STAY UP lasts until you say goodnight.
- You can also say “stay awake”, “stay awake for an hour”, or “nap after 20 minutes”.
- Taskbar and shortcuts use her head, not the Python icon.
- Files: `jarvis/viewer/index.html`, `jarvis/viewer/amy-icon.png`, `jarvis/desktop/amy.ico`, `jarvis/desktop/launch.py`.
- Close Amy and open her again so the chip and the new icon load.

---

## 2026-09-25 Session update (pause a named printer)

Latest commit: `189615c` — Pause reaches Flightdeck again.

- “Pause the print on BigBoy” was refused because Amy was calling `http://100.106.112.104:8000`, and nothing is listening there. Flightdeck answers on `https://flightdeck.tail7de73e.ts.net`.
- Named pause, resume, and stop work in casual mode too. Music pause stays with Spotify. She still does not start a print from that.
- Files: `jarvis/server.py`, `jarvis/workshop_actions.py`, `jarvis/desktop/paths.py`.
- Local Amy was restarted. Say it again. BigBoy is printing, so pause will actually pause that job.

---

## 2026-09-25 Session update (Cindy Vinyl small player)

Latest commit: `755a607` — Small player shrinks the desktop window to the transport bar.

- Small player was hiding the room and leaving a large black window. The resize hook never reached the window.
- The ribbon mode now sizes the real window to 680×210 above the taskbar. ROOM restores the room.
- File: `jukebox/desktop/launch.py`. Reopen Cindy Vinyl. No Pi restart needed for the window.

---

## 2026-09-25 Session update (Cindy Vinyl play freeze)

Latest commit: `8b75eec` — Play no longer freezes the desktop window.

- Hitting Play hung the window because the audio stream advertised a body and then closed before any bytes arrived. Navidrome could not see the music: the library links point at `/share/Cindy`, `/share/Checked`, and `/share/Jamal`, and those shares were not mounted inside the container.
- Those shares are mounted now, and a missing track comes back as an error instead of a cut-off stream.
- Files: `jukebox/app/main.py`, `jukebox/docker-compose.mora.yml`.
- Vinyl on Mora was restarted with this. The desktop window was reopened. Hit Play again.

---

## 2026-09-25 Session update (Cindy Vinyl music and small player)

Latest commit: `954d17d` — Small player can shrink the Vinyl window, and the library is pointed at the live music shares again.

- Every album was marked missing because the library view pointed at empty mount folders. It now follows `/share/Cindy`, `/share/Checked`, and `/share/Jamal`. 41224 albums are visible again.
- Small player resizes the desktop window to the compact player. ROOM opens the large room again.
- Files: `jukebox/desktop/launch.py`, `jukebox/scripts/build-mora-library-view.sh`.
- Reopen Cindy Vinyl. No Pi restart needed for the window. Hard refresh if a crate still looks empty.

---

## 2026-09-25 Session update (Cindy Vinyl window, add an app by name)

Latest commit: `6af065e` — Cindy Vinyl opens in her own window, and Amy can find an app and add it to the allow list.

- Desktop, Start Menu, and the Chrome Apps shortcut open `jukebox/desktop/launch.py` (player on Mora at `http://flightdeck-nas:4541`).
- “Add Sample to your allow list” finds the Start Menu shortcut or registered program and saves the path. She launches it only if you also say to launch or open it.
- Files: `jukebox/desktop/launch.py`, `jukebox/desktop/start-cindy-vinyl.ps1`, `jukebox/scripts/Install-CindyVinyl.ps1`, `jukebox/scripts/Install-CindyVinyl.bat`, `jarvis/amy-hands/desktop_actions.py`, `jarvis/server.py`.
- Restart Amy Hands and the Amy window brain.

---

## 2026-09-25 Session update (open any app comes to the front)

Latest commit: pending - “Open” and “Launch” bring that app’s window forward. Same for every app, not only Flightdeck.

- Shortcuts open as a normal window.
- Amy focuses the real window (exact or whole-word title, and the app’s own process). A nearby name like Flightdeck3dprinters is left alone.
- If it is already open, even on the taskbar, she brings that window forward.
- “Amy open Flightdeck” and “openflightdeck” both count, and the same glued form works for other apps.
- Files: `jarvis/amy-hands/desktop_actions.py`, `jarvis/amy-hands/amy_hands.py`, `jarvis/server.py`, `desktop/launch.py`, `printshelf/desktop/launch.py`, both start scripts.
- Restart Amy Hands and the Amy window brain.

---

## 2026-09-25 Session update (shortcuts point at the new windows)

Latest commit: pending - Desktop, Start Menu, Chrome Apps, and login Flightdeck shortcuts open the new windows.

- Updated shortcut targets to `desktop/launch.py` and `printshelf/desktop/launch.py`.
- Icons kept.
- Tray startup shortcut still starts the tray helper. Tray Open now launches the new Flightdeck window (`scripts/windows/flightdeck-tray.py`). Restart the tray (or next login) to pick that up.

---

## 2026-09-25 Session update (Amy is not Flightdeck, mic won't act on noise)

Latest commit: pending - Amy's window is just Amy, and muddy mic audio cannot delete, deploy, or launch apps.

- Window title and corner label are **Amy**. Flightdeck is only the dashboard app.
- She is told her starfield is not the Flightdeck window.
- Delete, move, copy, launch, close, and empty-spam only run when his actual words ask for that action.
- A delete or spam empty still needs a clear yes (`yes delete`, `approve`, `empty spam`). She cannot invent that approval.
- Short mic scraps (a couple of tiny words) are dropped before chat.
- Files: `jarvis/viewer/index.html`, `jarvis/desktop/launch.py`, `jarvis/server.py`.
- Close and reopen the Amy window once so the title bar changes. Restart Jarvis so the safety rules load.

---

## 2026-09-25 Session update (Flightdeck desktop window)

Latest commit: pending - Flightdeck now opens as its own window, and Amy can launch it.

- New window app: `desktop/launch.py` and `desktop/start-flightdeck.ps1`.
- Start Menu shortcut: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Flightdeck.lnk`.
- Amy Hands allowlist includes Flightdeck. Say **open Flightdeck**. A second open focuses the existing window.
- The page is still the Pi dashboard at `https://flightdeck.tail7de73e.ts.net`.
- Files: `desktop/launch.py`, `desktop/start-flightdeck.ps1`, `jarvis/amy-hands/desktop_actions.py`, `jarvis/server.py`, `jarvis/notes/workshop/amy-prompts.md`.
- Restart Amy Hands on the PC, and Jarvis (Pi + the Amy window) so she knows the app name.

---

## 2026-09-25 Session update (MeshFinder desktop app)

Latest commit: pending - MeshFinder now opens as its own window, and Amy can launch it.

- New window app: `printshelf/desktop/launch.py` and `start-meshfinder.ps1`.
- Start Menu shortcut: `%APPDATA%\Microsoft\Windows\Start Menu\Programs\MeshFinder.lnk`.
- Amy Hands allowlist includes MeshFinder. Say **open MeshFinder**. A second open focuses the existing window.
- The page is still the Pi library at `https://flightdeck.tail7de73e.ts.net:8100`.
- Files: `printshelf/desktop/launch.py`, `printshelf/desktop/start-meshfinder.ps1`, `jarvis/amy-hands/desktop_actions.py`, `jarvis/server.py`, `jarvis/notes/workshop/amy-prompts.md`.
- Restart Amy Hands on the PC, and Jarvis (Pi + the Amy window) so she knows the app name. Flightdeck restart is not required for the window itself.

---

## 2026-09-25 Session update (deploy pi accepts normal asks)

Latest commit: pending - “deploy pi again”, “deploy to the pi”, and “try deploy pi” now run the deploy.

- A sentence had to be almost exact, so a normal ask fell through to chat.
- She still ignores unrelated deploy talk (“deploy the printer”, “deploy my project”).
- If a deploy sentence misses, the words she heard are appended to `%APPDATA%\Amy\heard.log`.
- Files: `jarvis/server.py`, `jarvis/notes/workshop/amy-prompts.md`.
- Restart Jarvis on the Pi and the Amy window brain on the PC.

---

## 2026-09-25 Session update (deploy pi hears the full sentence)

Latest commit: pending - Virtual Amy now treats “Amy can you deploy pi” as the deploy command.

- The first version only matched the bare words “deploy pi”, so “Amy can you deploy pi” fell through to normal chat.
- She now accepts that sentence, “can you deploy the pi”, and “please deploy pi”. Unrelated deploy talk still does nothing.
- Files: `jarvis/server.py`, `jarvis/notes/workshop/amy-prompts.md`.
- Restart Jarvis on the Pi and the Amy window brain on the PC. A Flightdeck restart alone does not load this.

---

## 2026-09-25 Session update (virtual Amy phrase: deploy pi)

Latest commit: 020963e - Teach virtual Amy the exact phrase deploy pi.

- Virtual Amy (the voice app, not Cursor) now treats **deploy pi** as an exact phrase.
- She runs `/home/flightdeck/bin/flightdeck-deploy` (git pull --ff-only, then restart `flightdeck.service`).
- On the Pi she runs that script directly. On the PC window she SSHes with `flightdeck_cursor` and runs the same script.
- Nearby wording such as "pull and restart" does nothing.
- Files: `jarvis/server.py`, `jarvis/notes/workshop/amy-prompts.md`.
- Pi Jarvis now binds `127.0.0.1` (`AMY_BIND`) so Tailscale can keep HTTPS on `:4700`. Binding all interfaces clashes with that and crash-loops Jarvis.
- No UI cache-bust. Restart **jarvis** (user service on the Pi, and the Amy window brain on the PC) so she loads the phrase. A Flightdeck restart alone does not.
- Backend restart required: jarvis yes. flightdeck only when the phrase is used.

---

## 2026-09-24 Session update (Pi memory safety hotfix for ZIP previews)

Latest commit: 535e825 - Reduced ZIP thumbnail generation RAM pressure to avoid Pi instability during rescan/rebuild.

- Updated `printshelf/app/parsers/ziparchive.py`:
  - Lowered max in-memory ZIP preview entry size from 80MB to 24MB.
  - ZIP preview candidate selection now prefers lightweight mesh kinds only (`stl`, `obj`).
  - Skips heavy `3mf`/`gcode.3mf` decode during archive thumb backfill.
- Impact:
  - Greatly reduces memory spikes on Raspberry Pi when processing many ZIP assets.
  - ZIPs without a safe preview candidate fall back to shared ZIP icon (stable behavior).
- Backend restart required: yes.
- Hard refresh optional.

---

## 2026-09-24 Session update (ZIP thumb backfill trigger fix)

Latest commit: 44620b5 - Existing ZIP rows with printable contents are now forced to regenerate per-asset ZIP previews instead of staying on shared archive icons.

- Updated `printshelf/app/scanner.py`:
  - Added ZIP backfill detection logic that inspects stored `meta_json.printable_count` and current `thumb_path`.
  - For unchanged ZIP assets, scanner now reparses when a printable archive is still on non-`zip3` thumb naming.
  - Thumb rebuild flow now applies ZIP-specific need checks (uses `meta_json`) rather than generic current-thumb checks.
  - Legacy/unknown ZIP metadata now triggers one reparse pass to populate proper preview metadata.
- Result:
  - `Rescan` and `Rebuild thumbs` can finally migrate old ZIP rows to per-archive model previews.
- Backend restart required: yes (scanner behavior changed).
- Hard refresh optional.

---

## 2026-09-24 Session update (ZIP cards get real model thumbs)

Latest commit: c3c7517 - ZIP assets now generate per-file thumbnails from contained printables, so ZIP cards look like regular model cards instead of generic archive tiles.

- Backend (`printshelf/app/parsers/ziparchive.py`):
  - ZIP parser now chooses a preview candidate from contained printables (prefers STL/3MF/Gcode 3MF/OBJ).
  - Reads that entry in-memory and reuses existing parsers to generate `thumb_bytes`.
  - Stores selected `preview_entry` in ZIP meta for future viewer flow use.
- Thumbnail pipeline (`printshelf/app/thumbs.py`, `printshelf/app/scanner.py`):
  - ZIP thumbs now use per-asset hashed filenames (`*_zip3.png`) instead of one shared image filename.
  - Shared `_shared_zip2.png` icon remains as fallback when a ZIP has no previewable printable.
  - Thumb rebuild for ZIP now reparses ZIP and regenerates real preview thumbs when possible.
- Frontend (`printshelf/static/app.js`, `printshelf/static/index.html`):
  - ZIP thumb URLs now version by asset hash/path (not fixed `zip2` token), so per-ZIP previews refresh correctly.
  - Cache-bust bumped to `app.js?v=75`.
- Backend restart required: yes (parser/scanner/thumb behavior changed).
- Hard refresh recommended once.

---

## 2026-09-24 Session update (Documents purge path-normalization fix)

Latest commit: f067005 - Existing indexed `Documents/...` entries are now purged reliably even when stored paths mix slash styles.

- Updated `printshelf/app/scanner.py` (`purge_junk_assets`):
  - Expanded `Documents` path match rules to include:
    - `rel_path` with forward slashes and backslashes
    - `abs_path` with forward slashes and backslashes
  - Ensures already-indexed game artifacts under `Documents/My Games` are marked missing on next scan regardless of stored path format.
- Backend restart required: yes (scanner logic changed).
- Hard refresh optional.

---

## 2026-09-24 Session update (Exclude Documents folder from scan)

Latest commit: 1880333 - MeshFinder now excludes `Documents` directories from scanning so game-generated junk (for example `Documents/My Games`) is not scraped into the library.

- Updated `printshelf/app/scanner.py`:
  - Added `documents` to hard-skipped directory names (case-insensitive) so scanner will not descend into any `Documents` folder.
  - Added purge rule to mark existing indexed assets under `Documents/...` as missing on next scan.
- Updated `printshelf/config.example.json`:
  - Added ignore glob: `**/Documents/**`.
- Document file-type support remains intact for non-Documents paths.
- Backend restart required: yes (scanner skip rules changed).
- Hard refresh optional.

---

## 2026-09-24 Session update (Hide/no-op hardening)

Latest commit: 757b95d - Hide/Unhide now handles mixed design/asset id payloads defensively and no longer reports success when zero rows changed.

- Backend (`printshelf/app/main.py`):
  - Design hide/unhide single endpoints now fall back to resolving asset id -> design id when needed.
  - Design bulk hide/unhide endpoints now also map incoming ids through `assets.id -> design_id` and hide by merged design-id set.
  - Prevents stale/mixed frontend payloads from silently doing nothing.
- Frontend (`printshelf/static/app.js`):
  - `hideIds(...)` / `unhideIds(...)` now inspect response `updated`.
  - If `updated <= 0`, throws a visible error instead of showing false “Hidden/Unhidden” success.
- Cache-bust:
  - Bumped `printshelf/static/index.html` to `app.js?v=74`.
- Backend restart required: yes (route behavior changed).
- Hard refresh required once.

---

## 2026-09-24 Session update (Hide API route collision fix)

Latest commit: 0ab7f39 - Fixed design bulk hide/unhide API path collision that caused `design_id` int parse errors when posting to `/api/designs/bulk/...`.

- Backend (`printshelf/app/main.py`):
  - Renamed design bulk routes to unambiguous static paths:
    - `POST /api/designs/hide-bulk`
    - `POST /api/designs/unhide-bulk`
  - Avoids conflict with dynamic route `POST /api/designs/{design_id}/hide`.
- Frontend (`printshelf/static/app.js`):
  - Updated design-view hide/unhide calls to new bulk endpoints.
- Cache-bust:
  - Bumped `printshelf/static/index.html` to `app.js?v=73`.
- Backend restart required: yes (route changes).
- Hard refresh required once.

---

## 2026-09-24 Session update (Design-selection hide/unhide fix)

Latest commit: 2d241b1 - Bulk Hide/Unhide now correctly targets selected design cards (all assets under each design) instead of asset-id endpoints.

- Backend (`printshelf/app/main.py`):
  - Added design hide endpoints:
    - `POST /api/designs/{design_id}/hide`
    - `POST /api/designs/{design_id}/unhide`
  - Added design bulk endpoints:
    - `POST /api/designs/bulk/hide`
    - `POST /api/designs/bulk/unhide`
  - Each updates `assets.hidden` by `design_id`.
- Frontend (`printshelf/static/app.js`):
  - `hideIds(...)` and `unhideIds(...)` now route to design endpoints when library view is `designs`.
  - Keeps asset endpoints for asset-view workflows.
- Cache-bust:
  - Bumped `printshelf/static/index.html` to `app.js?v=72`.
- Backend restart required: yes (new API routes).
- Hard refresh recommended once.

---

## 2026-09-24 Session update (Narrow game-folder ignore)

Latest commit: 95f79db - Added focused scan ignore for `Documents/My Games` so game-generated image assets are excluded without broadly dropping other Windows folders.

- Updated `printshelf/config.example.json` ignore globs:
  - Added: `**/Documents/My Games/**`
- Intent:
  - Excludes noisy game-generated PNG/profile artifacts (for example Division reward thumbnail junk) while keeping other Windows content scanable.
- Backend restart required: no (config value only; takes effect with next scan/config reload).
- Hard refresh optional.

---

## 2026-09-24 Session update (Raster image decode rescue)

Latest commit: 880b48e - Image preview API now normalizes raster files via Pillow before sending, rescuing odd/truncated PNG/JPG files that fail direct browser decode.

- Updated `printshelf/app/main.py` (`GET /api/assets/{asset_id}/image`):
  - Added raster-kind normalization path (`jpg/jpeg/png/gif/webp/bmp`) using Pillow.
  - Enables `ImageFile.LOAD_TRUNCATED_IMAGES` and re-encodes to PNG bytes for response.
  - Falls back to direct file streaming if Pillow decode/convert fails.
- Backend restart required: yes (API route behavior changed).
- Hard refresh recommended once.

---

## 2026-09-24 Session update (PNG path resolution follow-up)

Latest commit: be062ce - Image endpoint now prefers indexed root-relative file paths before absolute paths, reducing false mismatches on mounted/symlinked NAS paths.

- Updated `printshelf/app/main.py` (`GET /api/assets/{asset_id}/image`):
  - Candidate path order changed to try `root_path + rel_path` first, then `abs_path`.
  - If strict `root_path` lexical check fails for chosen candidate, fallback allows files still under watched folders.
  - This targets remaining PNG cards that were still falling back to placeholder thumbs despite existing files.
- Backend restart required: yes (API route behavior changed).
- Hard refresh recommended once.

---

## 2026-09-24 Session update (Image card resiliency pass)

Latest commit: 6f20be1 - Image card loading is now more fault-tolerant for PNG-heavy libraries with mixed NAS path records.

- Backend (`printshelf/app/main.py`):
  - `GET /api/assets/{asset_id}/image` now reads `rel_path` and builds multiple candidate paths (`abs_path`, `root_path/rel_path`).
  - Uses first existing file candidate before returning image response.
  - Retains root-bound safety checks after candidate resolution.
- Frontend (`printshelf/static/app.js`):
  - On card image load error, retries once via `/api/thumbs/{thumb_path}` before falling back to kind pill tile.
  - Applied to both design cards and asset cards.
- Cache-bust:
  - Bumped `printshelf/static/index.html` to `app.js?v=71`.
- Backend restart required: yes (API route behavior changed).
- Hard refresh recommended once.

---

## 2026-09-24 Session update (PNG preview mount-path fix)

Latest commit: d46262f - Image preview endpoint now accepts legitimate NAS/bind-mounted asset paths that were being falsely rejected for some PNG cards.

- Updated `printshelf/app/main.py` (`GET /api/assets/{asset_id}/image`):
  - Switched from strict resolve-based watched-folder check to lexical validation against the asset's indexed `root_path`.
  - Keeps fallback watched-folder validation when `root_path` is absent.
  - Prevents false 403s on bind mounts/symlinked paths while preserving path-safety checks.
- Backend restart required: yes (API route behavior changed).
- Hard refresh recommended once.

---

## 2026-09-24 Session update (Direct image file previews on cards)

Latest commit: 9bed231 - MeshFinder now serves image cards from source files directly, so JPG/PNG/SVG previews still render even when thumb generation is stale or unavailable.

- Backend (`printshelf/app/main.py`):
  - Added `GET /api/assets/{asset_id}/image` for image kinds (`jpg/jpeg/png/gif/webp/bmp/svg`).
  - Endpoint validates asset visibility and watched-folder safety, then streams the real image file with guessed MIME type.
- Frontend (`printshelf/static/app.js`):
  - Card image URL helper now uses `/api/assets/{id}/image` for image assets/covers.
  - Non-image kinds still use `/api/thumbs/{name}` as before.
- Cache-bust:
  - Bumped `printshelf/static/index.html` to `app.js?v=70`.
- Backend restart required: yes (new API route).
- Hard refresh recommended once.

---

## 2026-09-24 Session update (Image thumbnail cache-bust)

Latest commit: 1a43da6 - Raster image cards now force-refresh to new thumbnail filenames, avoiding stale placeholder tile cache hits.

- Updated `printshelf/app/thumbs.py`:
  - Added versioned thumbnail suffixes for raster image kinds:
    - `jpg2`, `jpeg2`, `png2`, `gif2`, `webp2`, `bmp2`
  - This changes generated thumb filenames so browsers fetch fresh images instead of reusing cached placeholder URLs.
- Updated `printshelf/app/scanner.py`:
  - `_thumb_is_current(...)` now validates the new raster suffixes.
  - Rebuild thumbs now treats old raster suffixes as stale and regenerates upgraded filenames.
- Backend restart required: yes (scanner/thumb logic changed).
- Hard refresh recommended once.

---

## 2026-09-24 Session update (Image cards backfill on rescan)

Latest commit: 8fbda6d - Rescan now backfills older image rows so PNG/JPG/etc cards get real thumbnails instead of placeholder tiles.

- Updated `printshelf/app/scanner.py`:
  - Detects unchanged raster image assets missing width/height metadata and reparses them during scan.
  - Prevents historical "unchanged skip" logic from leaving older image rows on placeholder thumbs forever.
  - Expanded thumb rebuild defaults to include raster image kinds (`jpg/jpeg/png/gif/webp/bmp`).
- Updated `printshelf/app/main.py`:
  - `/api/thumbs/rebuild` now includes image kinds so thumbnail rebuild can repair image cards without a full NAS walk.
- Backend restart required: yes (scanner/API behavior changes).
- Hard refresh recommended once.

---

## 2026-09-24 Session update (Image tile thumbnails fixed)

Latest commit: 1e8f728 - MeshFinder now generates thumbnail previews for image files so image tiles are no longer blank.

- Added `printshelf/app/parsers/imagefile.py` with `parse_image(...)`:
  - Creates PNG thumbnail bytes for raster formats (jpg/jpeg/png/gif/webp/bmp) using PIL.
  - Keeps SVG indexed; SVG currently falls back without rendered thumbnail bytes.
- Wired image kinds into `parse_asset(...)` dispatch in `printshelf/app/parsers/__init__.py`.
- Existing indexed image entries may need thumbnail regeneration (rescan/refresh thumbs) to backfill previews.
- Backend restart required: yes (parser changes).
- Hard refresh recommended once.

---

## 2026-09-24 Session update (Enable image/doc/archive indexing)

Latest commit: <built-in function hash> - MeshFinder now scans and indexes image/document and extra archive/model file types.

- Updated kind detection in printshelf/app/parsers/__init__.py to recognize:
  - Model: step/stp (as step), bx, 3dm
  - Archives: 
ar, 7z, 	ar, 	gz, 	ar.gz
  - Images: jpg, jpeg, png, gif, webp, mp, svg
  - Documents: pdf, 	xt, md
- Expanded scanner filename prefilter in printshelf/app/scanner.py to include those extensions so they are actually walked/upserted.
- Existing files require a rescan to appear in MeshFinder.
- Backend restart required: yes (scanner/parser changes).
- Hard refresh optional (UI unchanged).

---

## 2026-09-23 Session update (Type menu categories expanded)

Latest commit: <built-in function hash> - Expanded MeshFinder type dropdown to include Kinds categories and STEP entry.

- Updated More types dropdown in printshelf/static/app.js with:
  - Kinds: Images, Documents, Archives
  - Model formats: STEP, OBJ, FBX, 3DM (plus existing STL/3MF/Gcode 3MF)
  - Archive formats: ZIP, TGZ, TAR.GZ, TAR, RAR, 7Z
- Added preset label mapping for the new selections in the type menu button text.
- Updated dropdown layout in printshelf/static/style.css to 3 columns (Kinds / Model formats / Archive formats).
- Cache-bust bumped in printshelf/static/index.html to style.css?v=68 and pp.js?v=69.
- Backend restart required: no (UI-only).
- Hard refresh recommended once.

---

## 2026-09-23 Session update (Type arrow dropdown menu)

Latest commit: <built-in function hash> - Added Meshory-style type arrow dropdown with grouped file filters.

- Frontend (printshelf/static/index.html, printshelf/static/style.css, printshelf/static/app.js):
  - Added More types ▾ button beside type tabs.
  - Added grouped dropdown menu (Kinds, Model formats, Archive formats).
  - Added presets for Models (STL/OBJ/3MF/Gcode 3MF), Archives (ZIP), and Duplicates.
  - Added menu state sync + active highlighting + close-on-outside-click.
  - Kept quick tabs (All/STL/3MF/Gcode 3MF/OBJ/ZIP) unchanged.
- Backend (printshelf/app/main.py):
  - Added kinds CSV query support to browse/designs/assets filtering.
  - Supports grouped multi-kind filter requests from the new dropdown presets.
- Cache-bust bumped: style.css?v=67, pp.js?v=68.
- Backend restart required: yes (API query support).
- Hard refresh recommended after deploy.

---

## 2026-09-23 Session update (Collapsible watched folders)

Latest commit: <built-in function hash> - Added collapsible Watched folders card and auto-collapse when opening Scan issues.

- Added watchedFoldersToggle and collapsible body wrapper in printshelf/static/index.html.
- Added collapse styles (settings-card-head, settings-collapsed) in printshelf/static/style.css.
- Added collapse state logic and persistence in printshelf/static/app.js (localStorage key: meshfinder.settings.watchedFoldersCollapsed.v1).
- Clicking Scan issues now switches to Folders, collapses Watched folders, and scrolls to the issues panel.
- Cache-bust bumped to style.css?v=66 and pp.js?v=67.
- Backend restart required: no (UI-only).
- Hard refresh recommended once.

---

## 2026-09-23 Session update (Scan issues button visibility fix)

Latest commit: <built-in function hash> - Scan issues button now always visible with count, including zero.

- Updated printshelf/static/app.js to always render Scan issues (N) instead of hiding at zero.
- Updated default button text in printshelf/static/index.html and bumped pp.js?v=66.
- Backend restart required: no (UI-only).
- Hard refresh recommended once to load latest app.js.

---

## 2026-09-23 Session update (MeshFinder scan issues panel)

Latest commit: <built-in function hash> - Added unresolved scan issues tracking + retry/ignore workflow in MeshFinder.

- Backend:
  - Added scan_issues table/index in printshelf/app/db.py.
  - Scanner now records per-file failures and auto-resolves an issue when a file later scans successfully (printshelf/app/scanner.py).
  - Added API endpoints in printshelf/app/main.py:
    - GET /api/scan_issues
    - POST /api/scan_issues/{id}/ignore
    - POST /api/scan_issues/ignore
    - POST /api/scan_issues/retry
  - Stats now include unresolved scan issue count (scan_issues).
- Frontend:
  - Added sidebar Scan issues button with unresolved count badge.
  - Added Settings > Scan issues list with Retry / Ignore per file and Retry all unresolved.
  - Added rail stat pill for scan issue count.
  - Cache-bust versions bumped to pp.js?v=65 and style.css?v=65.
- Backend restart required: yes (scanner/API + DB migration).
- Hard refresh recommended after deploy.

---

## 2026-09-23 Session update (MeshFinder hotfix: startup crash)

Latest commit: <built-in function hash> - Fixed PrintShelf/MeshFinder startup crash after filament migration.

- Root cause: schema script created idx_assets_assigned_filament before old DBs had ssets.assigned_filament_id.
- Fix: removed that index creation from base schema and kept it in migration flow after column-add in printshelf/app/db.py.
- Result: service starts cleanly on existing DBs; filament feature remains intact.
- Backend restart required: yes (done).
- Hard refresh: recommended once backend is back up.

---

## 2026-09-23 Session update (MeshFinder filament assignments)

Latest commit: <built-in function hash> - Added filament library + per-file assignment + filter in MeshFinder.

- Backend:
  - Added ilaments table and ssets.assigned_filament_id migration in printshelf/app/db.py.
  - Added filament APIs in printshelf/app/main.py:
    - GET/POST/PATCH/DELETE /api/filaments
    - POST /api/assets/{asset_id}/filament
  - Added ilament_id filtering support to browse/designs/assets queries.
  - Stats now include ilaments count.
- Frontend:
  - Added Assigned filament library filter in printshelf/static/index.html.
  - Added detail panel filament assign UI (+ quick create) in printshelf/static/app.js.
  - Added rail stat badge for filament count.
  - Bumped cache-bust versions in printshelf/static/index.html to pp.js?v=64 / style.css?v=64.
- Backend restart required: yes (API + DB migration).
- Hard refresh recommended after deploy (new JS/UI controls).

---

## 2026-09-23 Session update (MeshFinder icon refresh)

Latest commit: <built-in function hash> - New MeshFinder icon set (SVG/PNG/ICO) and favicon cache-bust links.

- Replaced app icon artwork with MeshFinder monogram + search mark in:
  - printshelf/static/printshelf-icon.svg
  - printshelf/static/icon-192.png
  - printshelf/static/icon-512.png
  - printshelf/static/apple-touch-icon.png
  - printshelf/static/printshelf.ico
- Updated icon links in printshelf/static/index.html to ?v=2 for cache-busting.
- Cache-bust versions currently served: pp.js?v=63, style.css?v=63 (unchanged).
- Restart required: no (static UI-only), but deploy restart is harmless.
- Hard refresh: recommended to pick up new favicon/PWA icon.

---

## 2026-09-23 Session update (MeshFinder UI rename)

Latest commit: <built-in function hash> - Rebranded PrintShelf app name and UI title to MeshFinder (safe UI-only pass).

- Changed UI branding from PrintShelf to MeshFinder in printshelf/static/index.html and printshelf/static/manifest.json.
- Kept backend paths/service names unchanged to avoid deployment risk.
- Cache-bust versions currently served: pp.js?v=63, style.css?v=63 (unchanged).
- Restart required: no (UI-only), but service restart run during deploy is harmless.
- Hard refresh: recommended once to refresh PWA/app name.

---

## 2026-09-23 Session update (Amy links are clickable)

Latest commit: `f16eb68` - Reply URLs stay on screen (not read aloud) and are clickable. Desktop opens them in the system browser. Relaunch Amy.

---

## 2026-09-22 Session update (row strip overflow fix)

Latest commit: `30c5602` - D1 R2/R3 number strips were overflowing the label border. Equal columns + auto-shrink font. QL-700 samples printed for R1–R3.

---

## 2026-09-21 Session update (drawer label print menus)

Latest commit: `3a6ad1b` - Cabinet: click D# / R# for drawer banner + row strip print. Slot menu: Spool label + Home location label. QL-700 layouts match the approved samples. Hard refresh Spools (`storage-*.js?v=2`).

---

## 2026-09-21 Session update (drawer homes = label numbers)

Latest commit: `34f78f1` - Lined drawer homes to spool display_id (was off-by-one on internal id). Guard trigger + migrate use label number. Rack rows already archived. Hard refresh Spools / Cabinet.

---

## 2026-09-21 Session update (no star-star from markdown)

Latest commit: `9afbac6` - TTS was reading **bold** as "star star". Strip markdown before speak. Restart Amy.

---

## 2026-09-21 Session update (TTS symbols spoken)

Latest commit: `0086fb4` - Special chars still mangled Laura. Expand $, %, #, @, etc. to English words; strip emoji/CJK; switch default to English-only eleven_flash_v2. Restart Amy.

---

## 2026-09-21 Session update (zombie Amy recovers)

Latest commit: `b7926b7` - Amy brain was up but window gone; single-instance lock blocked relaunch. Clear orphan launch.py when no Amy window, then start. Amy is up again.

---

## 2026-09-21 Session update (Laura stays English)

Latest commit: `a2146c7` - ElevenLabs turbo v2.5 was auto-detecting Chinese on pastes with numbers/symbols. Force language_code=en + normalize fancy punctuation. Restart Amy.

---

## 2026-09-21 Session update (Amy start crash fix)

Latest commit: `a2a641c` - launch.py had a mangled em-dash that crashed print() on Windows cp1252 before the window opened (brain still up). ASCII + UTF-8 stdout. Amy is running again.

---

## 2026-09-21 Session update (ghost snore hush)

Latest commit: `3c36a3e` - Zombie Amy windows were still asleep + snoring after relaunches. Killed orphans; snore pauses when window hidden; close kills audio; single-instance lock so a second launch cannot leave another sawmill. **Relaunch Amy** if you want her back.

---

## 2026-09-20 Session update (WATCH actually sees you)

Latest commit: `07ac868` — CAMERA LIVE wasn’t enough: frames only went on narrow keywords, and capture could send a blank frame. Broader WATCH triggers, wait for real webcam pixels, reject black frames, webcam-specific `/see` prompt. **Relaunch Amy** (or hard refresh); turn WATCH on, wait a beat, ask **can you see me**.

---


Latest commit: `3c263ef` — Soft-quiet/mute no longer overwrites sleep UI to STANDBY / Quiet — say talk. Good Night + SLEEPING stay until wake. Hard refresh / reopen Amy.

---# 2026-09-20 Session update (sleep no longer resizes out of FOCUS)

Latest commit: `1153d89` — Sleep no longer calls go_big (that crashed Focus). Stays small; sleep chrome calmed; input stays focusable. Reopen Amy.

---# 2026-09-20 Session update (no Edit bar + sleep stays full-bleed)

Latest commit: `c49fea7` — Removed white **Edit** menu (clipboard still Ctrl/right-click). Sleep exits FOCUS so lights-out is full window. **TALK** while asleep opens ears only — no wake. Reopen Amy desktop.

---# 2026-09-20 Session update (ASK no longer wakes for snore rib)

Latest commit: `d90d1d1` — Bug: ASK button force-woke before ask(), so snore ribs hit the LLM. Sleep is sealed; ASK/voice only hush unless **wake up Amy**. Reopen Amy.

---# 2026-09-20 Session update (snore hush stays asleep)

Latest commit: `477ec92` — Snore ribs no longer wake + LLM. Stay asleep, hush only. Broader phrases + any short interjection while snoring. Reopen Amy / hard refresh.

---# 2026-09-20 Session update (Amy snoring)

Latest commit: 98e0b01 — Sleep starts a looping snore (`amy-snore.wav` Tunetank clip, 16-bit). Rib her (**you sound like a bear** / **stop snoring** / **quiet**) → hush, stays asleep. Wake as usual. Reopen Amy; say **bedtime**.

---# 2026-09-20 Session update (casual mode workshop gate)

Latest commit: `0d9749e` — In **CASUAL**, clear printer/Flightdeck asks get a wink + “hit PRINT / say 3D print mode” instead of answering. Notes + FD tools only in print mode. Restart Amy.

---# 2026-09-20 Session update (Amy talk_mode persist + chip)

Latest commit: `5c13a06` — Persist casual/print `talk_mode` in config.json; **CASUAL/PRINT** chip above status (click to toggle). Survives restart. Reopen Amy.

---# 2026-09-20 Session update (Amy copy/paste)

Latest commit: `85880a8` — Native clipboard bridge (Ctrl+C/V/X, Edit menu, right-click) so Chris can copy between Cursor and Amy. **Must fully relaunch Amy desktop** (not just refresh) so launch.py loads.

---# 2026-09-19 Session update (Amy whistle actually plays)

Latest commit: `8b670fc` — Whistle was hitting the LLM (text "Fweeeet!") instead of SFX. Looser phrase match; play WAV via Web Audio decodeAudioData (HTML Audio fallback + louder synth); persona told not to fake whistles. Reopen Amy; say **whistle** — expect `♪` + sound, not banter.

---# 2026-09-19 Session update (Amy whistle 16-bit)

Latest commit: `05508aa` — Whistle/yawn were 24-bit WAVs (WebView2 often silent). Converted to 16-bit, trimmed whistle to ~5s, hardened SFX play + preload. Reopen Amy; say **whistle**.

---# 2026-09-19 Session update (Amy sleep wake + STT)

Latest commit: _(pending)_ — Fix: while asleep Whisper discarded all audio so wake phrases never landed. Sleep now still listens for wake. Whisper forced `language=en` + AU/Amy prompt; mic VAD a bit more sensitive + AGC. Reopen Amy; say **wake up Amy** if she's sleeping. Glowing **TALK** = ears open.

---# 2026-09-19 Session update (Amy Thunderbird mail)

Latest commit: _(pending)_ — Email defaults to **Thunderbird** (Chris's app). Empty spam opens Thunderbird for Empty Junk after approval. Restart Hands + Amy.

---# 2026-09-19 Session update (Amy PC file + email tools)

Latest commit: _(pending)_ — Hands can create folders, copy/move files, delete with explicit approval, open email, empty spam with approval (Outlook Junk auto; Gmail opens Spam). Roots only. Restart Hands + Amy. Say **yes delete** / **yes empty spam** to approve.

---# 2026-09-19 Session update (Amy mobile layout)

Latest commit: _(pending)_ — Narrow/phone browser gets a compact chat layout (no galaxy). Open Tailscale HTTPS `:4700` on phone for talk. Hands + framed desktop Amy stay PC-only. Hard refresh on phone.

---# 2026-09-19 Session update (sleep GIF brighter whites)

Latest commit: _(pending)_ — Boosted `Good Night` / Z whites on `amy-sleep.gif`; removed CSS shade over the GIF so text pops. Reopen Amy / say bedtime.

---# 2026-09-19 Session update (Amy sleep GIF)

Latest commit: _(pending)_ — Wired Tenor goodnight GIF as `amy-sleep.gif`: trimmed bright intro, dark sleep+Z loop only, darkened + cyan night tint. Bedtime/sleep uses it automatically. Reopen Amy.

---# 2026-09-19 Session update (Amy lights-out sleep)

Latest commit: _(pending)_ — Sleep/bedtime plays CSS lights-out (iris dim + floating Zzz) and dims the galaxy. Optional GIF: drop `jarvis/viewer/sounds/amy-sleep.gif` to replace Zzz. Reopen Amy.

--- 2026-09-19 Session update (Amy bedtime yawn)

Latest commit: ``ff9969c`` — Say **bedtime** / **goodnight** / **night night** / **go to sleep** → Laura goodnight + yawn SFX + sleep. Wake as usual. Reopen Amy.

--- 2026-09-19 Session update (Amy whistle + yawn SFX)

Latest commit: ``11eb282`` — Real `amy-whistle.wav` / `amy-yawn.wav` in `jarvis/viewer/sounds/`. Whistle/sing plays the melody; ~3 min idle yawns then sleepy nudge; sleep at ~6 min. Reopen Amy / hard refresh. Server serves `.wav`.

---# 2026-09-19 Session update (Explorer behind Amy)

Latest commit: _(pending)_ — Opening a folder/file drops Amy's always-on-top and focuses Explorer so it isn't hidden behind her. Say **come back** to float again. Restart Hands + Amy.

--- 2026-09-19 Session update (Amy TALK glow fix)

Latest commit: ``1d12317`` — Glowing button is **TALK** (ears open), dim **QUIET** (soft quiet). Previous glowing QUIET looked like permanent mute. Bare "quiet" while speaking = barge-in only; **don't talk** for quiet. Reopen framed Amy.

--- 2026-09-19 Session update (Amy TALK/QUIET)

Latest commit: ``3cf8521`` — Mic control renamed **TALK** / **QUIET** (say **talk** / **don't talk**). Soft quiet keeps Whisper armed so voice "talk" actually works (old mute killed the mic, so unmute could never be heard). Hard refresh / reopen framed Amy. UI in `jarvis/viewer/index.html`.

---
## 2026-09-19 Session update (Amy casual mode + Temora weather)

Latest commit: `d14034e` — Amy defaults to **casual** (normal-person chat, no printer flavour). Say **3D print mode** / **print mode** / **workshop mode** for workshop Amy; **normal mode** / **casual mode** to switch back. Fixed Temora weather: default was `Temora NSW` which Open-Meteo returns zero hits for ("can't find on the map"); also handles "weather like in …". Hardcoded AU towns + AU-prefer geocode. Restart Amy (Pi + local). UI cache-bust N/A (server persona).

---# 2026-09-19 Session update (Amy always on top)

Latest commit: `6bb5407` — Amy stays on top by default; say minimise to drop, come back to restore. go large keeps on top. Compact ring clip padding included. Reopen framed Amy.

---
## 2026-09-19 Session update (Amy go-large + compact polish)

Latest commit: `719fd94` — Whisper “amiga lodge” → go large; compact shows RING/EYES again, less top pad, ears uncropped, always-on-top while small. Reopen framed Amy.

---
## 2026-09-19 Session update (Amy compact centre v2)

Latest commit: `1dc3894` — Compact mode: matched hud/dock widths, 4-col tool grid so FILE/MIC/STOP/ASK no longer clip, face video object-position nudge, go-small window 420x720. Reopen framed Amy. UI + launch.py.

---
## 2026-09-19 Session update (Amy compact centre)

Latest commit: `9c7911f` ? Compact / go-small layout centred: `#hud` was still right-anchored, brand/search still showed. Face + dock now centre in the slim window. Reopen framed Amy (or hard refresh `/?desktop=1`). UI-only; restart optional.

---

## 2026-09-19 Session update (Amy prompts cheat sheet)

Latest commit: _(pending)_ ? Added jarvis/notes/workshop/amy-prompts.md smart-prompts cheat sheet for natural commands (Hands, volume, tabs, allowlist). Rebuild notes index; restart Amy.

---

## 2026-09-19 Session update (Hands desktop + media)

Latest commit: _(pending)_ â€” Amy Hands: launch allowlisted apps (Spotify+play), media play/pause/next/prev/stop, open file / open-with, close window. Random albums stay on Cindy Vinyl. Restart Hands on PC + Amy on Pi.

---

## 2026-09-19 Session update (voice interrupt + Explorer)

Latest commit: _(pending)_ â€” Fix Whisper barge-in (mic was held busy for whole ask/speak). STOP on pointerdown. Hands open_file_explorer opens local folders via explorer.exe. Restart Amy + Hands.

---

## 2026-09-19 Session update (Amy Laura + STOP)

Latest commit: _(pending)_ â€” Switch TTS back to ElevenLabs **Laura** (Starter plan). STOP hard-kills in-flight TTS; Whisper can barge-in with stop/wait. Desktop + Pi 	ts_provider: elevenlabs. Restart Amy / reopen framed app.

---

ï»¿## 2026-09-19 Session update (Amy mute + transcript + second listen)

Latest commit: `2ad6f0f` â€” Mute sticks (WebView SpeechRecognition no longer force-unmutes). Desktop mic ignores echo while she talks so the next utterance still fires. Shows `You: â€¦` in the answer box + transcript in the input. Restart local Amy / reopen `/?desktop=1`. Pi: pull + restart.

---

## 2026-09-19 Session update (Amy Whisper WAV PCM)

Latest commit: 37b62ef ? Desktop mic captures PCM via ScriptProcessor, wraps as WAV, and posts multipart `/stt`. Server normalizes mime + detects RIFF/WAV so Whisper no longer gets invalid MediaRecorder webm. Restart local Amy + reopen `/?desktop=1`. Pi: pull + restart.

---

## 2026-09-19 Session update (Amy Whisper STT harden)

Latest commit: `61635b1` ? Desktop mic posts multipart `/stt` (FormData); server accepts multipart + JSON. Restart local Amy + reopen `/?desktop=1`.

---

## 2026-09-19 Session update (Amy desktop Whisper mic)

Latest commit: `cffe1dc` ? Real pywebview Amy app uses OpenAI Whisper STT (/?desktop=1) because WebView2 can't run Google SpeechRecognition. Nova TTS still on. `.\start-amy-desktop.ps1` opens the framed app; `--chrome` fallback remains.

---
## 2026-09-19 Session update (Amy OpenAI Nova TTS)

Latest commit: `0f2db71` â€” `tts_provider: openai` + voice **nova** for tonight (ElevenLabs free quota exhausted). Falls back to Laura when provider is elevenlabs again. Desktop AppData config updated; restart local Amy / hard refresh.

---

## 2026-09-19 Session update (Amy desktop wrap)

Latest commit: `9ccd8c1` â€” Windows desktop wrap under `jarvis/desktop/`: WebView2 window + local `server.py` on `127.0.0.1:4700` + Hands on `:4701`. AppData config (`%APPDATA%\Amy\config.json`). Dev: `jarvis/desktop/start-amy-desktop.ps1`. Build: `build-windows.ps1` â†’ `dist/Amy/Amy.exe`. Pi browser Amy unchanged (`AMY_BIND` / `AMY_CONFIG` / `AMY_ROOT` hooks).

Hard refresh not required for Pi unless pulling `server.py` bind/env changes. Restart Amy on Pi after pull. Desktop: paste API keys into AppData config; load Chrome extension for tabs.

---

## 2026-09-19 Session update (Amy whistle tune + stop + Hands)

Latest commit: `0b85e12` â€” Amy whistles a **multi-note tune** (ask â€œwhistleâ€). **STOP** button + Escape + better barge-in (interim â€œstopâ€). Hands clears stale tab cmds; tab tools tell you if Chrome extension isnâ€™t loaded. Run `jarvis/amy-hands/start-amy-hands.ps1` then Load unpacked `chrome-extension`.

Hard refresh Amy. Restart Amy on Pi (backend). Hands restarted on PC.

---

## 2026-09-19 Session update (Amy on-demand whistle)

Latest commit: `dced8f8` â€” Say or type **whistle** / **sing** (or â€œwhistle for meâ€) and Amy plays the idle whistle tone immediately â€” no 3â€‘minute wait.

Hard refresh Amy (`Cache-Control: no-store` on viewer). No backend restart required.

---

## 2026-09-18 Session update (Amy Hands search fix)

Latest commit: `39d0f46` â€” Fixed `NameError: re is not defined` in Amy Hands `/search`. PC agent restarted; folder search works again.

No Pi restart needed (Hands runs on PC). Chrome tabs still need the unpacked extension loaded.

---

## 2026-09-18 Session update (Amy sleep + Hands)

Latest commit: `0cbc1b4` â€” Sleep mode (dark circle, â€œwake up Amyâ€), idle whistle/nudge ~3m then sleep ~6m. New **Amy Hands** PC companion (`jarvis/amy-hands`) for folder search + Chrome tab focus/open via extension. Set `hands_base_url` on Pi to the PC Tailscale IP `:4701`.

Hard refresh Amy. On PC: `python jarvis/amy-hands/amy_hands.py` + load unpacked Chrome extension.

---

## 2026-09-18 Session update (Amy files + internet)

Latest commit: _(pending)_ â€” Amy accepts drag/drop or FILE attach (text + images), and can `web_search` / `fetch_url` via Luna tool calls. Uploads land in `jarvis/uploads/` (gitignored).

Hard refresh `https://flightdeck.tail7de73e.ts.net:4700`. `systemctl --user restart jarvis`.

---

## 2026-09-18 Session update (Amy mic duck / no self-replies)

Latest commit: _(pending)_ â€” Mic ducks while Amy thinks/talks + 900ms echo cooldown so Laura isnâ€™t heard as Chris. Stops the self-answer loop.

Hard refresh `https://flightdeck.tail7de73e.ts.net:4700`.

---

## 2026-09-18 Session update (Amy no intro)

Latest commit: _(pending)_ â€” Removed boot greeting text/speech (â€œAmy online on Lunaâ€¦â€). First click still unlocks audio only.

Hard refresh `https://flightdeck.tail7de73e.ts.net:4700`.

---

## 2026-09-18 Session update (Amy Laura voice / ElevenLabs)

Latest commit: _(pending)_ â€” Amy can speak as ElevenLabs **Laura** (`FGY2WhTYpPnrIDTdsKH5`) via `/tts`. Needs `elevenlabs_api_key` in `jarvis/config.json` (`deploy/set-elevenlabs-key.py`). Falls back to browser TTS until keyed.

Hard refresh `https://flightdeck.tail7de73e.ts.net:4700`. `systemctl --user restart jarvis`.

---

## 2026-09-18 Session update (Amy sexier TTS)

Latest commit: _(pending)_ â€” Amy voice: lower pitch (0.82), slower rate (0.92), prefer warm Samantha/Moira/Hazel-style system voices over bright chipmunk energy. Browser TTS ceiling still applies.

Hard refresh `https://flightdeck.tail7de73e.ts.net:4700`.

---

## 2026-09-18 Session update (Amy FINISH_MS 1400)

Latest commit: _(pending)_ â€” Mic end-of-thought pause raised **900 â†’ 1400 ms** so Amy stops cutting Chris mid-sentence. Synced viewer + `amy-voice.md` + server note.

Hard refresh `https://flightdeck.tail7de73e.ts.net:4700`.

---

## 2026-09-18 Session update (Amy voice + clear-on-enter)

Latest commit: _(pending)_ â€” Amy TTS picks a warmer Aussie-leaning voice (Karen/Catherine/Ariaâ€¦), slight pitch/rate bump. Chat input clears on Enter/ASK and after mic finish.

Hard refresh `https://flightdeck.tail7de73e.ts.net:4700`. Restart optional.

---

## 2026-09-18 Session update (Amy on GPT-5.6 Luna)

Latest commit: `94e9a3f` â€” Amy brain defaults to **`gpt-5.6-luna`** (OpenAI API prepaid credits). Jarvisâ†’Amy dialogue purge in notes/persona. OpenRouter still optional via `provider`/`openai_base_url`. Drop coin: https://platform.openai.com/settings/organization/billing/

Hard refresh `https://flightdeck.tail7de73e.ts.net:4700`. `systemctl --user restart jarvis`.

---

## 2026-09-18 Session update (Amy Tripo face)

Latest commit: `453ea63` â€” Amy HUD now uses Chris's Tripo showcase loop (`viewer/amy-face.webm` / `.mp4`) instead of the SVG circle face. Mode glows still map listening/talking/thinking.

Hard refresh `https://flightdeck.tail7de73e.ts.net:4700`. `systemctl --user restart jarvis`.

---

## 2026-09-18 Session update (Amy rebrand + HUD fix)

Latest commit: `5921228` â€” Workshop assistant is **Amy** (not Jarvis): face HUD, Chris/Kidabah address, funny personality, note panel moved left to fix HUD clash. Mic needs HTTPS â€” Tailscale Serve on `:4700`.

Hard refresh `https://flightdeck.tail7de73e.ts.net:4700` (prefer HTTPS for mic). `systemctl --user restart jarvis`.

---

## 2026-09-18 Session update (Jarvis HUD polish)

Latest commit: `8674a65` â€” Jarvis viewer now has Flightdeck-flavoured command chrome: cyan HUD ring, speaking/model chips, RING/CUBE/FACE views, EYES organ (WATCH/HOLO/FOCUS stubs), denser starfield, search bar, and more workshop notes for a fuller galaxy.

Hard refresh `http://100.106.112.104:4700` (Ctrl+F5). `systemctl --user restart jarvis` after pull.

---

## 2026-09-18 Session update (Jarvis workshop on Flightdeck Pi)

Latest commit: `4d7953e` â€” **Jarvis** lives at `jarvis/` (runtime on Pi via user systemd). Dedicated 16GB Pi deferred until a spare PSU exists; current 8GB Flightdeck Pi has ~5.8â€¯Gi available and runs Jarvis fine on **:4700**.

- Notes galaxy + voice (Web Speech), butler persona, `/chat` `/remember` `/see`, preflight harness
- Flightdeck tools: calibrate / status / pause-resume-stop with nicknames BigBoyâ†’`h2d`, Big Girlâ†’`o1c2`, X1Câ†’`x1c`, Greyhoundâ†’`greyhound`
- User systemd: `systemctl --user status|restart jarvis`
- Open UI: `http://100.106.112.104:4700` â€” paste OpenAI key into `~/flightdeck/jarvis/config.json` (from `config.example.json`) for notes Q&A; tools work without a key
- Verified live: â€œrun a calibration on BigBoyâ€ â†’ Flightdeck calibration start OK

Hard refresh not required (separate port). Backend: user `jarvis.service` already active.

---

## 2026-09-17 Session update (Painter OBJ drop-in)

Latest commit: `ef0e7cb` â€” Painter **b629**. Drop/browse now accepts **`.obj`** alongside STL/3MF (batch folder too). Quads/ngons fan-triangulate; same seat-on-bed orientation as STL.

Hard refresh Painter **b629** (`painter.html?v=629`; `painter.js?v=629`; Flightdeck shell `app.js?v=737`). Drop an OBJ and paint.

---

## 2026-09-01 â€” PrintShelf mount readiness fix

- PrintShelf watched folders could remain configured while the Library showed `0 designs / 0 files`. The scanner guarded `/mnt` and `/media` roots with `os.path.ismount()` only; Linux bind mounts can legitimately return false there because the bind target may share the same device as its parent.
- Scanner readiness now reads `/proc/self/mountinfo`, which reflects the PrintShelf service's own mount namespace and recognises bind, CIFS and NFS mount points. `os.path.ismount()` remains a fallback. Dead empty `/mnt/...` placeholders are still refused so a reboot cannot mark the whole library missing.
- Unreadable roots are also refused explicitly as `not_readable`.
- Validation: `python -m py_compile printshelf/app/scanner.py` plus source guards for mountinfo/bind-mount handling.
- Next physical gate: pull/restart PrintShelf on the Pi and Rescan. The existing Koko Kidabah, Kidabah PC and Mora Kidabah home watched folders should index again if their mounts are present.

# SESSION_NEXT (active)

Recent Flightdeck / MakerDeck session notes (last ~4 weeks). Older history: [docs/archive/SESSION_NEXT_before_2026-06-28.md](docs/archive/SESSION_NEXT_before_2026-06-28.md).

MakerDeck detailed notes: [makerforge/SESSION_NEXT.md](makerforge/SESSION_NEXT.md).

---

## 2026-08-24 Session update (Mesh Prep Stage 2C planar convex quad repair)

Mesh Prep now supports one additional conservative selected-boundary repair: a simple closed planar convex four-edge loop. Sanitiser Core v5 validates current topology, consistent winding, four unique vertices, tight planarity, convexity, and non-degenerate triangulation, then appends exactly two faces across the shorter valid diagonal. Existing Float32 coordinates remain unchanged; there is no welding, vertex movement, shell joining, or arbitrary polygon filling.

The shared UI gate now dispatches three-edge loops to Stage 2B and four-edge loops to Stage 2C, requiring an N-edge repair to add exactly `N-2` faces, remove exactly N open edges, and leave non-manifold edges unchanged. The supplied deterministic and live-browser box calibration passes: faces `10 â†’ 12`, open edges `4 â†’ 0`, boundary groups `1 â†’ 0`, watertight `NO â†’ YES`, and non-manifold edges `0 â†’ 0`. Derived concave, non-planar, five-edge, complex/branched, and missing-selection cases are refused. Stage 1, Stage 2A, Stage 2B triangular repair, Stage 2B.1 persistent IDs, Auto-Frame, and BING remain green. Do not generalise to five-plus-edge polygons yet.

---

## 2026-08-24 Session update (Mesh Prep Stage 2B.1 persistent boundary IDs)

Live testing with three separate triangular holes exposed a UI identity bug: after repairing original Boundary 1, the two surviving openings were renumbered Boundary 1 / Boundary 2 even though they were the original Boundary 2 / Boundary 3. Stage 2B.1 fixes identity in `makerforge/meshprep.html` only. Each boundary now receives a canonical signature from its topology, edge count, and sorted quantized segments; matching signatures retain their original IDs through re-analysis and sequential repairs. IDs reset only when a genuinely new STL is loaded.

The deterministic regression passes `Boundary 1, 2, 3 â†’ Boundary 2, 3 â†’ Boundary 3`. Stage 1, Stage 2A, Stage 2B triangular repair, syntax, source-parity, and diff checks remain green. `sanitiser-core.js` was unchanged by this identity fix. The separate quad-only Stage 2C checkpoint is now recorded above.

---

## 2026-08-24 Session update (Mesh Prep Stage 2B triangular repair)

Mesh Prep now exposes the first deliberately narrow Stage 2B geometry operation: **REPAIR SELECTED** appears only for a simple closed three-edge / three-vertex boundary. Sanitiser Core v4 copies every existing Float32 coordinate unchanged and appends exactly one oppositely wound replacement triangle. It refuses complex or branched boundaries, larger polygonal openings, inconsistent or stale selections, and degenerate replacement faces; there is still no welding, vertex movement, shell joining, general triangulation, or topology reconstruction.

The UI re-analyses the candidate result before accepting it. The repair must add exactly one face, reduce open edges by exactly three, and leave non-manifold edge count unchanged; otherwise the original mesh is preserved. The deterministic and live-browser calibration both pass: faces `3 â†’ 4`, open edges `3 â†’ 0`, boundary groups `1 â†’ 0`, watertight `NO â†’ YES`, and non-manifold edges `0 â†’ 0`. Stage 1 and every Stage 2A diagnostic, classification, highlight, complex-topology, Auto-Frame, and BING contract remain green. Next: validate triangular repair on deliberately broken real meshes; do not generalise Stage 2B yet.

---

## 2026-08-24 Session update (Mesh Prep Boundary Auto-Frame)

Mesh Prep Stage 2A now frames a selected boundary with surrounding-model context before firing the BING locator. The sidebar is narrowed from 300 px to 280 px; camera fit uses 20% boundary-span padding, a conservative 1.65x distance multiplier, and a minimum-distance floor so broad or tilted openings do not over-zoom. The 420 ms eased camera move keeps the current view direction and fires BING only after the camera settles.

This Auto-Frame checkpoint is presentation-only. Stage 2A remains diagnostic: boundary selection highlights and reframes the existing open-edge loop but does not fill holes, weld vertices, join shells, reconstruct topology, or otherwise modify geometry. Embedded-module syntax, the complete Stage 1 / Stage 2A calibration suite, and diff checks passed. The separate triangular-only Stage 2B checkpoint is now recorded above.

---

## 2026-08-24 Session update (Mesh Prep Sanitiser Stage 2A recovery)

Recovered the missing August 20 Mesh Prep Sanitiser work without using or overwriting unrelated local changes. Stage 1 removes only degenerate and duplicate/reversed faces. Stage 2A groups open edges into boundary components and reports topology, centroid, edge count, perimeter, maximum span, and conservative `SMALL` / `REVIEW` / `MAJOR` / `COMPLEX` diagnostics. It remains inspection-only: no hole filling, vertex welding, shell joining, or topology reconstruction.

The missing `sanitiser-core.js?v=3` was reconstructed from the surviving v2 core, recovered Stage 2A UI, and authoritative calibration handoff. The exact calibration passes at 3 faces, 3 open edges, 1 shell, watertight NO, 1 MAJOR boundary, 3 edges, 40.0 mm span, and 120.0 mm perimeter. Live browser validation from the active checkout confirmed Boundary 1 selection, the three-edge locator, BING animation, and no console errors. The category thresholds outside the recovered MAJOR calibration are conservative reconstructions and remain diagnostic only.

At the recovery handoff, the next job was **Boundary Auto-Frame** with roughly 15â€“20% viewport padding. That presentation pass is now complete; deliberately holed real-model validation remains next. Do not begin Stage 2B repair rules until the inspector is trusted on those models.

---

## 2026-08-19 Session update (MakerDeck b623 hoodie container loads again)

b622 split `hoodie-stubby.js` into two module caches (`app.js` `?v=622` vs `geometry.js`/`features.js` `?v=598`), so Hoodie container built an empty mesh. One import version now. Hard refresh (`app.js?v=735`, MakerDeck `app.js?v=623` / **b623**). Header **b623**. Click Hoodie container again.

---

## 2026-08-19 Session update (MakerDeck b622 preset cleanup)

Ooshies stand and Temora Vet shelf are off MakerDeck. Stubby holder is labelled **Hoodie container** (internal id still `stubbyHolder`). Sign / plaque stays.

Hard refresh (`app.js?v=734`, MakerDeck `app.js?v=622` / **b622**). Header **b622**. Re-open MakerDeck.

---

## 2026-08-19 Session update (Painter b626 protected bucket and colour swap)

Painter now has a **Bucket** tool that fills the connected base-model region under the click, plus **Swap base colours** controls for exchanging two painted filament slots. Stamped artwork is a protected layer: brush, spray, selection, smart fill, bucket, colour swap, and Clear Paint cannot alter its faces. Reopening a split Painter 3MF restores the body/art boundary, so the protection survives export and import.

Feature commit: `0362a36` â€” hard refresh Painter **b626** (`painter.html?v=626`; Painter module `v=624`; Flightdeck shell `app.js?v=733`). Painter module syntax, `node makerforge/test/painter-art.mjs`, 3MF round-trip artwork-boundary assertions, and diff checks passed before deployment.

---

## 2026-08-19 Session update (Bambu Lab brand normalisation and colour entry)

Legacy Flightdeck `Bambu` inventory/catalogue/cost records are promoted to `Bambu Lab` at startup, and all new spool, restock, incoming-stock, catalogue, cost, and empty-spool-profile writes use the same spelling. Queue/Profile Doctor matching also treats either historical spelling as one brand, so BigBoyâ€™s AMS slot 3 no longer blocks merely because the printer says `Bambu Lab` while Flightdeck previously stored `Bambu`.

The Spool Manager Colour name field is no longer a hidden colour-alias/autocomplete rule. It preserves every character the operator types, disables browser autocomplete, and leaves swatch clicks as the only intentional standard-name helper.

Feature commit: `a149fdf` â€” Flightdeck shell cache-busted to `app.js?v=732`. Focused Bambu alias/preflight assertions, Python compile, JavaScript syntax, and diff checks passed before deployment.

---

## 2026-08-19 Session update (Painter b625 free artwork move)

Painter artwork now has separate on-model transforms: drag the small blue centre target to move the live preview continuously over the fabric, and drag the outer blue ring to rotate it. A normal click still establishes the initial position. Size and Rotation labels are now editable number fields that stay synchronised with their sliders; Enter or clicking away applies the value.

Feature commit: `2093056` â€” hard refresh Painter **b625** (`painter.html?v=625`; Flightdeck shell `app.js?v=731`). `node makerforge/test/painter-art.mjs`, Painter module syntax, and browser b625 control/console checks passed.

---

## 2026-08-19 Session update (Painter b624 adjustable artwork)

Painter artwork is no longer committed on the first chest click. **b624** first positions a live logo preview, then exposes a blue on-model rotation ring plus the Rotation slider; only **Stamp artwork** turns that position into 3MF geometry. After stamping, **Adjust artwork** reopens the same logo so it can be moved or rotated again without uploading or tracing it again. Escape/Cancel abandons the pending adjustment and keeps the existing stamp.

Feature commit: `427432f` â€” hard refresh Painter **b624** (`painter.html?v=624`; Flightdeck shell `app.js?v=730`). `node makerforge/test/painter-art.mjs`, Painter module syntax, and local browser console smoke passed.

---

## 2026-08-19 Session update (Painter b623 3MF volume export)

The b622 Painter preview could be perfect while Bambu Studio rejected the saved 3MF configuration and deleted zero-volume objects. The split exporter used a recursive external component reference: a parent object and its mesh resource shared the same ID. b623 uses valid pairs (`1 â†’ 2` for Body and `3 â†’ 4` for Art), adds the mandatory `mimetype`, and emits only Bambu-safe, printer-neutral project settings.

Feature commit: `762fbb9` â€” hard refresh Painter **b623** (`painter.html?v=623`, `painter.js?v=623`; Flightdeck shell `app.js?v=729`), reload the model/artwork, stamp it, then export a completely new 3MF. `node makerforge/test/painter-art.mjs` passed, including a 3MF split-volume round trip and config/package assertions.

---

## 2026-08-19 Session update (Painter b622 curved artwork)

Painter now stamps artwork onto the actual nearby chest surface even when an imported STL has reversed face winding. The old sampler rejected those triangles and could revert to a flat plane that passed through a curved shirt. The relief remains a separate closed 3MF part, 0.04 mm clear of the surface and 0.72 mm proud.

Feature commit: `b594dbc` â€” MakerDeck **b622**. The Painter frame is cache-busted to `painter.html?v=622` and the Flightdeck shell to `app.js?v=728`. `node makerforge/test/painter-art.mjs` passed, including a reversed-winding curved-surface regression case. Reload the model, stamp again, and export a new 3MF; prior exports retain their former decal mesh.

---

## 2026-08-19 Session update (PETG-CF AMS profile)

Feature commit: `35a16d6` â€” a Flightdeck spool recorded as `PETG` with subtype `CF` (including Siddament PETG CF) now programs the AMS with Bambu's `GFG98 Â· Generic PETG-CF` profile, at its 240â€“270 Â°C range. Plain PETG remains `GFG99 Â· Generic PETG`.

Validated locally with the exact Siddament spool shape: the emitted AMS command is `GFG98`, `PETG-CF`, `Generic PETG-CF`, and Profile Doctor clears the mismatch. Deployed to the Pi: Flightdeck is active and H2C / AMS HT slot 1 now reports `Generic PETG-CF` / `GFG98` for spool #119. The printer remained physically idle after the profile replay.

## 2026-08-18 Session update (Hoodie art sits on the fabric)

Latest commit: `f0f1140` â€” MakerDeck **b621**. Export was carving the panther into Body (0.24 mm embed + CSG pocket), which is the jagged Fusion mesh and the rough print. Body stays the original hoodie; crest sits on the chest (~0.84 mm proud). Red/black still trimmed apart.

Latest local/Pi change:
- Hard refresh (`app.js?v=727`, MakerDeck `app.js?v=621` / **b621**). Header **b621**. Re-export a **new** 3MF. Fusion Body = plain hoodie, Art = separate crest on the chest. Do not click Repair.

Previous:
- Print-safe hoodie bitmap cleanup (b620).

---

## 2026-08-17 Session update (H2C slice kept dumping RHS grouping)

Latest commit: `9a4fb63` â€” MakerDeck **b618**. July 6 `Vase_1.gcode.3mf` (working) vs tonightâ€™s `blue grey vase.3mf`: both dual-nozzle, but the new file flushed extras into infill (`flush_into_infill=1`), omitted per-nozzle printable areas, and used H2D presets. H2C slice then remaps Prepareâ€™s RHS grouping to left-only. Match the working vase: flush off, H2C AMS/printable zones, Generic PLA @BBL H2C.

Latest local/Pi change:
- Hard refresh (`app.js?v=724`, MakerDeck `app.js?v=618` / **b618**). Header **b618**. Re-export the blue/grey vase. Prepare can still show extras on the right; after slice grouping should keep a right nozzle (like the July vase: left white, right colour). Do not click Set to Optimal.

Previous:
- Hoodie runner in front of crest (`67cc0ac`).

---

## 2026-08-17 Session update (Hoodie runner in front of crest)

Latest commit: `67cc0ac` â€” MakerDeck **b615**. b613â€™s sprue went *through* the body (Art Red â†” Body at layer 79, empty layers, floating grey) so Studio dumped the art back to filament 1. Back to the b606 path that actually coloured: separate objects, crest **on** the chest (not embedded), 1.6 mm runner **in front of** the hoodie with a bar that joins the art.

Latest local/Pi change:
- Hard refresh (`app.js?v=721`, MakerDeck `app.js?v=615` / **b615**). Header **b615**. Re-export a **new** 3MF. Prepare: Body + Art as separate objects. Expect two thin coloured sticks in front of the chest from the plate up to the crest â€” snip after print. Slice **Filament** view: white / red / black; grouping left=1, right=2+3. No Repair. No â€œArt Red â†” Bodyâ€, no empty-layer, no floating grey.

Previous:
- Hoodie H2C object extruders + sprues (`b4d70f0`).

---

## 2026-08-17 Session update (Hoodie H2C object extruders + sprues)

Latest commit: `b4d70f0` â€” MakerDeck **b613**. H2C ignores assembled/painted volume extruders (slice = filament 1, right nozzle empty, crest as grey relief). Export is separate objects again (the only path that coloured in Prepare) with a **continuous sprue** from the plate to the crest (no empty-layer skip) and a boolean gap between red/black so they donâ€™t fight on the right nozzle.

Latest local/Pi change:
- Hard refresh (`app.js?v=720`, MakerDeck `app.js?v=613` / **b613**). Header **b613**. Re-export a **new** 3MF. Prepare: Body + Art as separate objects, 3 filaments, no empty-layer / floating / redâ†”grey conflict. Slice **Filament** view: white body, red crest, black knight; grouping left=1, right=2+3. Do not click Repair.

Previous:
- Hoodie one object per colour volume (`51a7c66`).

---

## 2026-08-17 Session update (Hoodie one object per colour volume)

Latest commit: `51a7c66` â€” MakerDeck **b612**, hoodie is **one object** with one volume per colour (red pieces merged). No separate plate objects, no bed foot.

Latest local/Pi change:
- b611 got colours in Prepare (crest + tower) then slice dumped them: Art Red/Grey gcode conflicts, Art Red 3 floating, empty layers from the bed foot. Same-colour meshes are merged; they are parts of one assembled object so overlap on the chest is legal. Hard refresh (`app.js?v=719`, MakerDeck `app.js?v=612` / **b612**). Header **b612**. Re-export. Prepare: one hoodie, no â€œArt Red 3â€, no conflict/floating/empty-layer warnings. Then slice Filament view.

Previous:
- Hoodie separate objects + bed foot (`5ce5988`).

---

Latest commit: `5ce5988` â€” MakerDeck **b611**, hoodie colours as **separate objects** (the only H2C path that used red/black) with a hidden bed foot so Studio cannot drop the crest.

Latest local/Pi change:
- Paint / assembled volumes never made H2C use extra filaments. b606 did â€” then auto-drop put art on the plate. Each art mesh now has a tiny foot at body Z. Hard refresh (`app.js?v=718`, MakerDeck `app.js?v=611` / **b611**). Header **b611**. Re-export. Prepare should list Body + Art (not one lump). Slice Filament view: white/red/black; crest still on the chest. Do not click Repair.

Previous:
- Hoodie Bambu object_1 volumes (`37a10d3`).

---

Latest commit: `37a10d3` â€” MakerDeck **b610**, hoodie colours are volumes inside **one** `object_1.model` (how Studio actually saves multi-part objects).

Latest local/Pi change:
- b609 was still the wrong production layout (one file per colour). H2C ignored those part extruders â€” same all-white slice, right nozzle empty, mid-plate. Hard refresh (`app.js?v=717`, MakerDeck `app.js?v=610` / **b610**). Header **b610**. Re-export a **new** 3MF. Prepare tab: one hoodie with Body / Art parts. Filament view: white/red/black. Grouping left=1, right=2+3. Do not click Repair.

Previous:
- Hoodie native volumes (`59527ce`).

---

Latest commit: `59527ce` â€” MakerDeck **b609**, hoodie colours are real Bambu volumes in **one** assembled object.

Latest local/Pi change:
- Placement was never the bug (model was already mid-plate). H2C ignores triangle `paint_color`; separate plate objects dropped the crest. Export now writes `3D/Objects/object_N.model` + one parent with `p:path` components. Hard refresh (`app.js?v=716`, MakerDeck `app.js?v=609` / **b609**). Header **b609**. Re-export a **new** 3MF. Object list = one hoodie; Filament view = white/red/black; grouping left=1, right=2+3; crest stays on the chest. Do not click Repair.

Previous:
- Hoodie off the left-only strip (`f194013`).

---

Latest commit: `f194013` â€” MakerDeck **b608**, hoodie sits in the H2C **dual-nozzle** zone (25â€“325 mm), not the left-nozzle-only strip.

Latest local/Pi change:
- Right nozzle was empty because the 3MF put the model at the origin (left-only). Placement is assemble-only now; printable areas match H2C. Hard refresh (`app.js?v=715`, MakerDeck `app.js?v=608` / **b608**). Header **b608**. Re-export. Model should sit in the middle of the plate, not on â€œLeft nozzle only areaâ€.

Previous:
- Hoodie paint on one object (`1a47cc9`).

---

## 2026-08-17 Session update (Hoodie paint, not separate objects)

Latest commit: `1a47cc9` â€” MakerDeck **b607**, logo stays on the hoodie. b606 separate objects dropped art to the plate (tiny red at the hem, tower still 3-colour).

Latest local/Pi change:
- One object again; crest/text triangles are AMS-painted (not a second object that H2C auto-drops). Hard refresh (`app.js?v=714`, MakerDeck `app.js?v=607` / **b607**). Header **b607**. Re-export. Do not click Repair.

Previous:
- Hoodie colours as separate objects (`642d53b`).

---

## 2026-08-17 Session update (Hoodie colours as separate objects)

Latest commit: `642d53b` â€” MakerDeck **b606**, hoodie Body / Art / Text are **separate 3MF objects** (assembled), so H2C cannot union the crest onto filament 1.

Latest local/Pi change:
- Slice used only filament 1 (0 colour changes, right nozzle empty) because the assembly was one object and H2C printed it all as white. Hard refresh (`app.js?v=713`, MakerDeck `app.js?v=606` / **b606**). Header **b606**. Re-export. Object list should show Body + Art Red + Art Dark grey + Text, not a single â€œ1â€.

Previous:
- Hoodie AMS HT left only (`42267fb`).

---

## 2026-08-17 Session update (Hoodie AMS HT left only)

Latest commit: `42267fb` â€” MakerDeck **b605**, left nozzle = **AMS HT**, right nozzle = **regular AMS**. White/red/black no longer all labelled HT-A.

Latest local/Pi change:
- 3MF was missing `extruder_ams_count`, so Studio parked every PLA Basic on HT-A. Now left is `1#0|4#1` (HT) and right is `1#1|4#0` (AMS). Hard refresh (`app.js?v=712`, MakerDeck `app.js?v=605` / **b605**). Header **b605**. Re-export.

Previous:
- Hoodie dual nozzle (`00b15f0`).

---

## 2026-08-17 Session update (Hoodie dual nozzle)

Latest commit: `00b15f0` â€” MakerDeck **b604**, hoodie 3MF maps **white body to left** (AMS HT) and **red/black art to right**. Prime tower on (right nozzle cannot purge into left infill).

Latest local/Pi change:
- b602/b603 pinned every slot to the left, so Studio showed right nozzle empty. Dual map is back; colour merge still caps ~3â€“4 slots so the tower should stay far under the old 20h. Hard refresh (`app.js?v=711`, MakerDeck `app.js?v=604` / **b604**). Header **b604**. Re-export. Filament grouping: 1 on left, 2+3 on right.

Previous:
- Hoodie dark grey stays black (`2d7b7a4`).

---

## 2026-08-17 Session update (Hoodie dark grey stays black)

Latest commit: `2d7b7a4` â€” MakerDeck **b603**, crest **Dark grey** (knight) no longer merges into the white body slot.

Latest local/Pi change:
- b602 parked `Art Dark grey` on filament 1, so the knight vanished. Dark grey / black now get their own slot (priority: body, red, black, white). Hard refresh (`app.js?v=710`, MakerDeck `app.js?v=603` / **b603**). Header **b603**. Re-export. Do not click Set to Optimal.

Previous:
- Hoodie no prime tower (`5291bf3`).

---

## 2026-08-17 Session update (Hoodie no prime tower)

Latest commit: `5291bf3` â€” MakerDeck **b602**, hoodie 3MF maps all filaments to the **left** nozzle, merges similar crest colours (cap 4), and keeps **prime tower off** via `different_settings_to_system`.

Latest local/Pi change:
- 19h 44m + tower was 8 AMS slots with art on the **right** nozzle (flush-into-body cannot eat right-nozzle purges). Export now: ~3â€“4 filaments all on left, tower off, purge into hoodie infill/objects. Hard refresh (`app.js?v=709`, MakerDeck `app.js?v=602` / **b602**). Header **b602**. Re-export. In Studio: do **not** click â€œSet to Optimalâ€ (that puts colours back on the right). Prime tower should be off.

Previous:
- Hoodie 3MF loads as H2C 0.24 Standard (`beaf424`).

---

## 2026-08-17 Session update (Hoodie 3MF loads as H2C 0.24 Standard)

Latest commit: `beaf424` â€” MakerDeck **b601**, 3MF is a real Bambu project on **0.24mm Standard @BBL H2C**.

Latest local/Pi change:
- Studio dumped settings because Application was `BambuStudio` (no version) and the JSON had no `nozzle_diameter` / `extruder_type`. There is no Hoodie Fast in System presets â€” fastest stock is **0.24mm Standard**. Hard refresh (`app.js?v=708`, MakerDeck `app.js?v=601` / **b601**). Header **b601**. Re-export. Process dropdown should show 0.24mm Standard, no â€œinvalid configâ€.

Previous:
- Hoodie 0.4 slice cracks (`ee77d2a`).

---

## 2026-08-17 Session update (Hoodie 0.4 slice cracks + H2C config)

Latest commit: `ee77d2a` â€” MakerDeck **b600**, thicker 0.4 mm stamp; 3MF is H2C 0.4 / 0.20mm Standard.

Latest local/Pi change:
- Grey cracks in the crest and LITTLE were a 0.62 mm stamp (one 0.4 mm line). Export is ~0.90 mm (two lines) with a deeper bite into the fabric. 3MF now says **Bambu Lab H2C 0.4 nozzle** + **0.20mm Standard @BBL H2C** so Studio should keep the settings (not 20 hr geometry-only). Hard refresh (`app.js?v=707`, MakerDeck `app.js?v=600` / **b600**). Header **b600**. Re-click Stubby holder, re-export. **Do not click Repair.**

Previous:
- Hoodie Body 3 open edges (`cf8f26c`).

---

## 2026-08-17 Session update (Hoodie Body 3 open edges)

Latest commit: `cf8f26c` â€” MakerDeck **b599**, 3MF sanitiser strips duplicate faces before peel so the hoodie Body stays closed.

Latest local/Pi change:
- Export warned â€œBody 3 openâ€ because peel treated 24 duplicate faces as non-manifold and punched a hole. Duplicates go first now. Hard refresh (`app.js?v=706`, MakerDeck `app.js?v=599` / **b599**). Header **b599**. Re-click Stubby holder, export 3MF. **Do not click Repair.**

Previous:
- Hoodie back uses the chest stamp (`c1d7dee`).

---

## 2026-08-17 Session update (Hoodie back uses the chest stamp)

Latest commit: `c1d7dee` â€” MakerDeck **b598**, back text uses the same Y-stamp + 5-pass blur as the chest.

Latest local/Pi change:
- Front LITTLE is close because it stamps on a min-Y heightfield with pocket-close blur. Back now uses that same path on the outer +Y skin (no cylinder unwrap, no normals). Face â†’ Back, type in Text. PNG still chest-only. Hard refresh (`app.js?v=705`, MakerDeck `app.js?v=598` / **b598**). Header **b598**. Re-click Stubby holder.

Previous:
- Drop hoodie back text (`fa27395`).

---

## 2026-08-17 Session update (Drop hoodie back text)

Latest commit: `fa27395` â€” MakerDeck **b597**, stubby holder text/logo on the chest only.

Latest local/Pi change:
- Back text on the hoodie well was never going to sit clean (cylinder + stamp kept clipping/crumpling). Face Back is gone. Type in Text or drop a PNG on the chest. Hard refresh (`app.js?v=704`, MakerDeck `app.js?v=597` / **b597**). Header **b597**. Re-click Stubby holder.

Previous:
- Hoodie back text wraps the cylinder (`26ab787`).

---

## 2026-08-17 Session update (Hoodie back text wraps the cylinder)

Latest commit: `26ab787` â€” MakerDeck **b596**, back text wraps around the well like a can label.

Latest local/Pi change:
- Chest-style Y-stamp cannot sit on the cylindrical back â€” letters crumpled into the wall. Back text now unwraps around `backY` (same Text box, Face â†’ Back). Front logo unchanged. Hard refresh (`app.js?v=703`, MakerDeck `app.js?v=596` / **b596**). Header **b596**. Re-click Stubby holder, Face â†’ Back â€” rear text, type again.

Previous:
- Hoodie back text uses the front stamp (`efff7b2`).

---

## 2026-08-17 Session update (Hoodie back text uses the front stamp)

Latest commit: `efff7b2` â€” MakerDeck **b595**, back text uses the same Y-stamp as the chest.

Latest local/Pi change:
- Back LITTLE was a comb of spikes from offsetting along noisy surface normals. Back text now uses the same setup as the front: type in the Text box, stamp along world Y. Face Front = chest logo or text; Back = rear text. Hard refresh (`app.js?v=702`, MakerDeck `app.js?v=595` / **b595**). Header **b595**. Re-click Stubby holder.

Previous:
- Hoodie back letters wrap the curve (`3973047`).

---

## 2026-08-17 Session update (Hoodie back letters wrap the curve)

Latest commit: `3973047` â€” MakerDeck **b594**, back text follows the outer curve, not a flat plane.

Latest local/Pi change:
- LITTLE was buried at the spine and floating at the ends because the back field was flattened and offset in +Y. It now keeps the cylinder envelope and stamps along the surface normal. Front unchanged. Hard refresh (`app.js?v=701`, MakerDeck `app.js?v=594` / **b594**). Header **b594**. Re-click Stubby holder.

Previous:
- Hoodie back text through the wall (`32986c3`).

---

## 2026-08-17 Session update (Hoodie back text through the wall)

Latest commit: `32986c3` â€” MakerDeck **b593**, back stamp uses the outer fabric only.

Latest local/Pi change:
- Back LITTLE was shredded through the well wall because the heightfield kept every vertex past Y=2 (inner well + outer skin). It now only samples the outer back. Front chest path unchanged. Hard refresh (`app.js?v=700`, MakerDeck `app.js?v=593` / **b593**). Header **b593**. Re-click Stubby holder.

Previous:
- Undo b591 front spikes (`be456ba`).

---

## 2026-08-17 Session update (Undo b591 front field)

Latest commit: `be456ba` â€” MakerDeck **b592**, chest logo field restored; back-only drape stays.

Latest local/Pi change:
- b591 sampled the pouch interior and exploded the front shield into spikes. Front heightfield is back to the pocket-close blur. Back text path unchanged. Hard refresh (`app.js?v=699`, MakerDeck `app.js?v=592` / **b592**). Header **b592**. Re-click Stubby holder and drop the PNG again.

Previous:
- Hoodie LITTLE Swiss cheese (`cd0ad7b`) â€” reverted.

---

## 2026-08-17 Session update (Hoodie LITTLE Swiss cheese)

Latest commit: `cd0ad7b` â€” MakerDeck **b591**, chest stamp follows the pocket skin.

Latest local/Pi change:
- LITTLE on the chest was holey because the heightfield was mean-blurred behind the kangaroo pocket, then sat 0.04 mm â€œonâ€ that fake surface. Stamp now follows the outer fabric; preview sits 0.25 mm proud. Hard refresh (`app.js?v=698`, MakerDeck `app.js?v=591` / **b591**). Header **b591**. Re-click Stubby holder.

Previous:
- Hoodie back text too deep (`01fbcff`).

---

## 2026-08-17 Session update (Hoodie back text too deep)

Latest commit: `01fbcff` â€” MakerDeck **b590**, back text sits on the fabric again.

Latest local/Pi change:
- b589 embedded 0.55 mm into the hoodie on preview, so LITTLE punched through the back. Preview is a 0.5 mm stamp on the fabric; export only bites 0.12 mm for bonding. Back heightfield no longer mean-blurs inward. Hard refresh (`app.js?v=697`, MakerDeck `app.js?v=590` / **b590**). Header **b590**. Re-click Stubby holder, Face â†’ Back â€” text.

Previous:
- Hoodie shield slice + manifold (`edb6a7c`).

---

## 2026-08-17 Session update (Hoodie shield slice + manifold)

Latest commit: `edb6a7c` â€” MakerDeck **b589**, 3MF sanitiser peels 3+ face edges; crest embeds into the fabric.

Latest local/Pi change:
- Bambuâ€™s â€œ24 non-manifold edgesâ€ on `stubby-holder-65x145mm` was real: the sanitiser only counted **open** (1-face) edges, so a closed hoodie with 3-face edges skipped repair. Shield also sat ~0.04 mm off the chest so the slice could drop it. Hard refresh (`app.js?v=696`, MakerDeck `app.js?v=589` / **b589**). Header **b589**. Re-click Stubby holder, re-drop the PNG, re-export 3MF. **Do not click Repair.** Side view: crest and back text should sit in the fabric.

Previous:
- Hoodie text on the back (`7007588`).

---

## 2026-08-17 Session update (Hoodie text on the back)

Latest commit: `7007588` â€” MakerDeck **b588**, Face Back puts text on the rear, chest logo stays.

Latest local/Pi change:
- Stubby holder Face is Front or Back. PNG/logo stays on the chest; Text on Back drapes on the rear fabric. Hard refresh (`app.js?v=695`, MakerDeck `app.js?v=588` / **b588**). Header **b588**. Art tab â†’ Face â†’ **Back â€” text**, then type on the Text pane.

Previous:
- Stubby holder empty after b586 (`b5bbbe7`).

---

## 2026-08-17 Session update (Stubby holder empty after b586)

Latest commit: `b5bbbe7` â€” MakerDeck **b587**, one hoodie-stubby module instance.

Latest local/Pi change:
- Clicking Stubby holder loaded the STL into one JS cache and built the mesh from another (empty) because `hoodie-stubby.js?v=586` vs `?v=585`. Hard refresh (`app.js?v=694`, MakerDeck `app.js?v=587` / **b587**). Header must say **b587**. Click Stubby holder again.

Previous:
- Hoodie AMS flush (`23da307`).

---

## 2026-08-17 Session update (Hoodie 18h slice was AMS, not geometry)

Latest commit: `23da307` â€” MakerDeck **b586**, one-object 3MF + flush into the hoodie body.

Latest local/Pi change:
- test2 in Bambu was **18h 43m** with 553 AMS swaps, prime tower on, flush-into-infill off. Crest is ~56 mm tall so it hits ~280 layers Ã— 3 colours. Next export is one assembly (not separate objects), purge into infill, no tower, art on the right H2D nozzle. Hard refresh (`app.js?v=693`, MakerDeck `app.js?v=586` / **b586**). Re-export 3MF. In the open slicer: Flush into infill + objects, multiplier ~0.4, prime tower off, then slice again. Orca preset **0.28mm Hoodie Fast @H2D**.

Previous:
- Hoodie crest stamp (`bf04e9f`).

---

## 2026-08-17 Session update (Hoodie crest is a fine stamp)

Latest commit: `bf04e9f` â€” MakerDeck **b585**, shared-vertex chest stamp, no 0.22 mm cells / scanlines.

Latest local/Pi change:
- St George was Lego-blocky with horizontal scanlines because b584 forced 0.22 mm voxels and `DECAL_LAYER_MM` row banding. Chest art now uses Painterâ€™s shared-vertex heightfield (~0.06 mm start, grid cap 520 â‰ˆ 0.11 mm on a 56 mm logo). Skin stays 0.04 / ~0.72 mm. Hard refresh (`app.js?v=692`, MakerDeck `app.js?v=585` / **b585**). Header must say **b585**. Re-click Stubby holder and drop the PNG again.

Previous:
- Hoodie stamp matches Painter thickness (`57fee2b`).

---

## STOP â€” pick up 2026-08-17 (hoodie logo still not crisp)

Latest commit: `57fee2b` / `19593e3` â€” session parked. MakerDeck **b584** is live. Do not ship another depth/drape tweak until crispness is fixed.

**What Chris sees:** St George crest on the hoodie in MakerDeck is blocky, scanlined, and a bit engraved. STL Painter is the look we want (thin stamp on the fabric, clean edges). He was comparing Painter vs MakerDeck; MakerDeck is the one thatâ€™s wrong.

**This is the same family of bugs as this morning, not a new one.**

| When | What we did | What it caused |
| --- | --- | --- |
| Painter b590 | Paint colours onto hoodie triangles | Jagged red spikes (`f13c15b` / b591 undid this) |
| Painter b589 | One prism per bitmap cell | Millions of faces, 0-byte 3MF. Fix: **shared-vertex heightfield**, grid ~0.2 mm |
| Painter b584â€“b588 | Raw PNG grey halo | Fringe / saw-teeth around the shield |
| MakerDeck b584 tonight | Forced hoodie art to **0.22 mm cells** + row banding | **Tonightâ€™s â€œnot crispâ€** â€” stepped letters, horizontal scanlines |

**Tomorrow â€” do this:**

1. **Undo the 0.22 mm hoodie cap** in `features.js` (`buildFlatShapeGroupsSolidMesh` stepMm and `buildWrapTraceSlabMesh` stepPx). That cap is why ST. GEORGE / ILLAWARRA look like Lego. Box art stays crisp at **0.035 mm export / 0.05 mm preview**.
2. **Do not row-band the crest** with `DECAL_LAYER_MM` (0.2 mm). Thatâ€™s the horizontal striations across the shield.
3. **Keep** b584â€™s good bits: Painter skin **0.04 mm**, shell **~0.72 mm**, smoothed front-face chest field. Those fixed the side-on brick, not the top-down pixels.
4. Prefer **Painterâ€™s `appendStampHeightfield`** (`makerforge/js/painter-art.js`) on MakerDeckâ€™s `getEmbossFaceFrame` / chest field â€” one shell per colour, shared verts â€” instead of voxel marching with fat cells.
5. **Never** paint the hoodie mesh triangles again (b591). Logo stays a separate colour part.
6. If the grey halo is back, reuse Painterâ€™s `scrubTraceMat` / paper knockout â€” donâ€™t restamp the raw PNG.

**Do not:** another proud/depth pass, pocket-interior drape, or painting the STL. Crispness is grid + builder, not millimetres of offset.

Hard refresh still **b584** until tomorrowâ€™s build. Re-click Stubby holder after the crisp fix.

Previous:
- MakerDeck hoodie stamp matches Painter thickness (`57fee2b`).

---

## 2026-08-16 Session update (MakerDeck hoodie stamp matches Painter)

Latest commit: `57fee2b` â€” Match MakerDeck hoodie logos to STL Painter's thin smooth stamp.

Latest local/Pi change:
- MakerDeck was voxel-extruding a noisy chest field (~0.85 mm proud). It now uses Painterâ€™s skin (0.04 mm) + ~0.72 mm shell, a smoothed front-face heightfield, and a ~0.22 mm grid. Hard refresh (`app.js?v=691`, MakerDeck `app.js?v=584` / **b584**). Header must say **b584**. Re-click Stubby holder, drop the PNG again.

Previous:
- Hoodie 3MF Bambu export (`29aa8ab`).

---

## 2026-08-16 Session update (Hoodie 3MF survives Bambu)

Latest commit: `29aa8ab` â€” Export hoodie logos as closed 3MF solids that stay standing in Bambu.

Latest local/Pi change:
- MakerDeck preview was right; Bambu dropped the art as zero-volume parts and auto-dropped the hoodie onto its back. 3MF now ships Body + colour art as separate objects, closed ~0.8 mm proud slabs, no auto_drop. Hard refresh (`app.js?v=690`, MakerDeck `app.js?v=583` / **b583**). Header must say **b583**. Re-export 3MF from MakerDeck (not the original STL).

Previous:
- Hoodie stamp follows fabric (`7c08c52`).

---

## 2026-08-16 Session update (Hoodie stamp follows the fabric)

Latest commit: `7c08c52` â€” Sit hoodie logos on the outer fabric instead of a recessed chest plane.

Latest local/Pi change:
- b581 still flattened the stamp onto the chest plane while the pocket stuck out (side-view step). Art now follows the front-most fabric and sits ~0.85 mm proud. Hard refresh (`app.js?v=689`, MakerDeck `app.js?v=582` / **b582**). Header must say **b582**. Re-click Stubby holder, drop the PNG again.

Previous:
- Hoodie stamp too deep (`8cbe554`).

---

## 2026-08-16 Session update (Hoodie stamp too deep)

Latest commit: `8cbe554` â€” Keep hoodie chest logos as a shallow stamp, not a pocket carve.

Latest local/Pi change:
- Per-vertex chest drape was sampling the pouch interior and pulling the WAK logo ~28 mm into the pocket. Art now sits on hole-closed front fabric (~0.4 mm proud). Hard refresh (`app.js?v=688`, MakerDeck `app.js?v=581` / **b581**). Header must say **b581**. Re-click Stubby holder, drop the PNG again.

Previous:
- Stubby holder round1 crash (`d1e7ef6`).

---

## 2026-08-16 Session update (Stubby holder round1 crash)

Latest commit: `d1e7ef6` â€” Fix Stubby holder crash: round1 was missing after the chest-drape change.

Latest local/Pi change:
- Clicking Stubby holder threw `round1 is not defined`. Helper is back. Hard refresh (`app.js?v=687`, MakerDeck `app.js?v=580` / **b580**). Header must say **b580**.

Previous:
- Hoodie chest art drape (`21449f9`).

---

## 2026-08-16 Session update (Hoodie chest art sits on the surface)

Latest commit: `21449f9` â€” Drape MakerDeck logos onto the hoodie chest instead of the belly bounding box.

Latest local/Pi change:
- The logo was floating in front of the hoodie because art sat on the pocket AABB, not the chest. It now drapes onto the chest surface. Hard refresh (`app.js?v=686`, MakerDeck `app.js?v=579` / **b579**). Header must say **b579**. Re-click Stubby holder, drop the PNG again.

Previous:
- Hoodie is the MakerDeck stubby holder (`085927b`).

---

## 2026-08-16 Session update (Hoodie is the MakerDeck stubby holder)

Latest commit: `085927b` â€” Put the Panthers hoodie mesh in MakerDeck as Stubby holder.

Latest local/Pi change:
- Stubby holder is the hoodie (150 mm / 65 mm well), not the can-cup. Drop a PNG on the Art tab â€” chest logo exports as a separate colour part like other MakerDeck boxes. Hard refresh (`app.js?v=685`, MakerDeck `app.js?v=578` / **b578**). Header must say **b578**.

Previous:
- MakerDeck stubby holder cup (`6713cfe`).

---

## 2026-08-16 Session update (MakerDeck stubby holder back)

Latest commit: `6713cfe` â€” Restore the MakerDeck stubby holder preset so wrap art can be tested on a cup.

Latest local/Pi change:
- Painter logo still does not transfer the way MakerDeck wrap-art does, so the parametric **Stubby holder** is back on MakerDeck Quick presets. Can vs Bottle, Easy 68 mm / Snug 67.5 mm. Drop a PNG on the Art tab â€” it wraps the cup wall. Export is `*-base.3mf` + `*-stack.3mf`. Hard refresh (`app.js?v=684`, MakerDeck `app.js?v=577` / **b577**). Header must say **b577**.

Previous:
- Painter logo separate 3MF part (`f13c15b`).

---

## 2026-08-16 Session update (Painter logo clean edges + separate 3MF part)

Latest commit: `f13c15b` â€” Stop painting hoodie triangles; export the logo as its own 3MF part.

Latest local/Pi change:
- b590 painted the chest mesh, so the crest grew jagged red spikes and a white triangle. Logo now sits on the surface again (~0.72 mm) and exports as `object_2` so Bambu keeps it after slice without shattering the hoodie. Hard refresh (`app.js?v=683`, Painter `painter.html?v=591` / **b591**). Reload the STL, stamp once, export. Preview colour mode: **Filament**.

Previous:
- Painter logo survives slice (`55f1b8f`).

---

## 2026-08-16 Session update (Painter logo survives slice)

Latest commit: `55f1b8f` â€” Sink Painter logos into the hoodie so Bambu keeps them after slice.

Latest local/Pi change:
- Logo showed in Prepare then vanished after slice (15s filament changes). The stamp was a 0.32 mm shell floating 0.14 mm off the chest, so the slicer dropped it. Stamp now embeds ~0.55 mm, is ~0.8 mm thick, stacks ink above the white plate, and paints the hoodie triangles (including white). Hard refresh (`app.js?v=682`, Painter `painter.html?v=590` / **b590**). Reload the STL, stamp once, export. In Preview switch the colour legend from Line Type to **Filament**.

Previous:
- Painter 3MF empty export (`40a1ea7`).

---

## 2026-08-16 Session update (Painter 3MF export empty file)

Latest commit: `40a1ea7` â€” Stop Painter logo stamps from writing a 0-byte 3MF.

Latest local/Pi change:
- The painted hoodie 3MFs (`obj_1_Hoodie_stubby_150x65_painted.3mf`, `test.3mf`) are **0 bytes** â€” the save picker created the file, then export died building a per-cell stamp mesh (white crest plate = hundreds of thousands of isolated prisms). Those files cannot be repaired; reload the STL and re-export.
- Stamp is now a shared-vertex heightfield, grid capped (~0.2 mm), 3MF XML is built in one join, empty exports are rejected. Hard refresh (`app.js?v=681`, Painter `painter.html?v=589` / **b589**). Header must say **b589**. Reload the hoodie STL, stamp the logo once, export again.

Previous:
- Tools dismiss failed queue leftovers (`420acc3`).

---

## 2026-08-16 Session update (Tools dismiss failed queue leftovers)

Latest commit: `420acc3` â€” Add Settings â†’ Tools dismiss for failed/cancelled queue leftovers.

Latest local/Pi change:
- Tools can dismiss leftover failed/cancelled queue rows (like BigBoy job #307) without touching the printer. Hard refresh (`app.js?v=680`, `style.css?v=509`).

Previous:
- Clear BigBoy cancelled-print fault (`29391e8`).

---

## 2026-08-16 Session update (Clear BigBoy cancelled-print fault)

Latest commit: `29391e8` â€” Treat Bambu 0300-400C (printing was cancelled) as a cleared cancel, not a live fault.

Latest local/Pi change:
- BigBoy was stuck `error` after a cancelled print (`0300-400C`). Flightdeck now dismisses that retained FAILED banner and sends `clean_print_error`. Backend restart required.

Previous:
- Painter sit logo on hoodie (`75369e1`).

---

## 2026-08-16 Session update (Painter sit logo on hoodie)

Latest commit: `75369e1` â€” Sit Painter logos on the hoodie surface and drop the grey under-layer.

Latest local/Pi change:
- Stamp follows the chest (no more flat slab cutting in). Logo sits ~0.14 mm on top, ~0.32 mm thick. Pale grey fringe layers are dropped.
- Hard refresh (`app.js?v=679`, Painter `painter.html?v=588` / **b588**). Reload the hoodie STL, drop the logo, stamp once. Header must say **b588**.

Previous:
- Painter stop restamping grey PNG (`019832a`).

---

## 2026-08-16 Session update (Painter stop restamping the grey PNG)

Latest commit: `019832a` â€” Stop Painter from rebuilding the grey logo fringe off the raw PNG.

Latest local/Pi change:
- Stamp uses the scrubbed trace only (no raw-PNG fallback that put the grey halo back). Grey layers and border-connected grey pixels are dropped; the white crest plate stays; 1px spikes on the plate edge are opened off.
- Hard refresh (`app.js?v=678`, Painter `painter.html?v=587` / **b587**). Reload the hoodie STL, drop the logo, stamp once. Header must say **b587**.

Previous:
- Painter clip logo to ink island (`0ebd0de`).

---

## 2026-08-16 Session update (Painter clip logo to ink island)

Latest commit: 0ebd0de â€” Clip Painter logos to the sealed red/black island and stop fringe growth.

Latest local/Pi change:
- Stamp now floods from the crop edge and stops at a sealed red/black outline, so the grey halo around the shield is punched. Slab downsample needs a majority of ink (no more fat saw-teeth).
- Hard refresh (`app.js?v=677`, Painter `painter.html?v=586` / **b586**). Reload the hoodie STL, drop the logo, stamp once.

Previous:
- Painter source-flood logo mat (`36a232f`).

---

## 2026-08-16 Session update (Painter source-flood logo mat)

Latest commit: `36a232f` â€” Knock out logo paper from the PNG pixels, and replace the old stamp.

Latest local/Pi change:
- Artwork scrub now floods the **source PNG** from the border (same idea as MakerDeck paper knockout), so grey/white mats die even when they were quantized as White.
- Re-stamp replaces the previous logo mesh. Hard refresh (`app.js?v=676`, Painter `painter.html?v=585` / **b585**). Reload the hoodie STL, drop the logo, stamp once.

Previous:
- Painter punch grey logo halo (`2734919`).

---

## 2026-08-15 Session update (Painter punch grey logo halo)

Latest commit: `2734919` â€” Punch grey halo outside the crest, not just the full-frame mat.

Latest local/Pi change:
- Flood from the crop edge through grey/empty so a jagged silver halo around the shield is removed. Interior white stays.
- Hard refresh (`app.js?v=675`, Painter `painter.html?v=584` / **b584**). Undo the old stamp (geometry), drop/trace again, click the chest.

Previous:
- Painter drop grey logo mat (`358bbea`).

---

## 2026-08-15 Session update (Painter drop grey logo mat)

Latest commit: `358bbea` â€” Drop the grey bounding-mat around Painter team logos.

Latest local/Pi change:
- Multi-colour stamp now throws away grey/white paper that hugs the image edge (the jagged grey box around the Dragons crest). Shield colours stay.
- Hard refresh (`app.js?v=674`, Painter `painter.html?v=583` / **b583**). Undo or Clear Paint, drop/trace again, stamp the chest.

Previous:
- Painter multi-colour team-logo trace (`2dd3bab`).

---

## 2026-08-15 Session update (Painter multi-colour team-logo trace)

Latest commit: `2dd3bab` â€” Stamp Painter logos via MakerDeck Multi-colour AMS trace.

Latest local/Pi change:
- STL Painter Artwork uses the same **Multi-colour â€” team logo (AMS)** trace as Art on box, then extrudes those ink layers (no grey mat, no pixel shards).
- Threshold / Invert match MakerDeck. Hard refresh (`app.js?v=673`, Painter `painter.html?v=582` / **b582**). Drop the logo again, wait for "AMS colours traced", then click the chest.

Previous:
- Painter MakerDeck-style logo (`3ddb736`).

---

## 2026-08-15 Session update (Painter MakerDeck-style logo)

Latest commit: `3ddb736` â€” Stamp artwork as raised logo geometry, not painted triangles.

Latest local/Pi change:
- STL Painter Artwork now builds MakerDeck-style ~0.28 mm slabs on the click plane (same clear logo look as boxes/vases).
- Hard refresh (`app.js?v=672`, Painter `painter.html?v=581` / **b581**). Clear Paint, then stamp the logo again.

Previous:
- Painter stamp sharpness (`0217012`).

---

## 2026-08-15 Session update (Painter stamp sharpness)

Latest commit: `0217012` â€” Stop shattered logo stamps in STL Painter.

Latest local/Pi change:
- Artwork stamp auto Fine (Ultra if still coarse). Only paints faces mostly on solid logo pixels.
- Ignores anti-alias white/grey fringe; re-stamp wipes the stamp rectangle.
- Hard refresh (`app.js?v=671`, Painter `painter.html?v=580` / **b580**). Clear Paint then stamp again on the hoodie.

Previous:
- Painter PNG/JPG artwork (`f04b288`).

---

## 2026-08-15 Session update (Painter PNG/JPG artwork)

Latest commit: `f04b288` â€” Accept PNG/JPG artwork in STL Painter, not just SVG.

Latest local/Pi change:
- Artwork drop now takes **PNG, JPG, WebP, GIF**, plus SVG. White-background knockout for photos (toggle).
- Logo colours come from the image palette. Same click-to-stamp on the mesh.
- Hard refresh (`app.js?v=670`, Painter `painter.html?v=579` / **b579**). Backend restart not required.

Previous:
- Painter SVG artwork (`5b10ec9`).

---

## 2026-08-15 Session update (Painter SVG artwork)

Latest commit: `5b10ec9` â€” Stamp SVG artwork onto meshes in STL Painter.

Latest local/Pi change:
- STL Painter Paint tab: drop an SVG, set size/rotation, click the model to stamp as paint.
- SVG colours map onto AMS slots; Active slot stamps a silhouette. Ghost preview on hover.
- Hard refresh (`app.js?v=669`, Painter `painter.html?v=578` / **b578**). Backend restart not required (static only).

Previous:
- Tiered sell strategies (`751290b`).

---

## 2026-08-15 Session update (Tiered sell strategies)

Latest commit: `751290b` â€” Add batch, machine-hour, and value sell strategies on top of shop costing.

Latest local/Pi change:
- Settings â†’ Costing keeps **floor** (filament + shop hours + optional labour) as true cost.
- New **Sell strategies**: Shop markup (current default), Batch (filament Ã— 4â€“6), Machine-hour (filament + hours Ã— rate), Value (filament Ã— 10 as an art starting price). Fail buffer (default 8%) is in sell prices only. Design $/hr is a separate quote-helper line.
- Quote helper, passports, and projects show all three plus Suggested from the strategy you pick. Save costing after choosing.
- Hard refresh (`app.js?v=668`, `style.css?v=508`). Backend restart required.

Previous:
- Queue Release / Tools (`ecff7b1`).

---

## 2026-08-15 Session update (Queue Release / Tools)

Latest commit: `ecff7b1` â€” Add Flightdeck-only queue Release so stuck printing jobs can be cleared from the UI.

Latest local/Pi change:
- Printing/uploading queue rows now have **Release** (Queue page and Settings â†’ Tools). Drops the Flightdeck row only â€” does not cancel or stop the printer. If the bay is idle, the next pending job may auto-start.
- Settings â†’ **Tools** lists stuck jobs and flags when the printer is idle but the queue still says printing.
- Hard refresh (`app.js?v=667`, `style.css?v=507`). Backend restart required.

Previous:
- Quote-slice .gcode.3mf (`a917993`).

---

## 2026-08-15 Session update (Quote-slice .gcode.3mf)

Latest commit: `a917993` â€” Keep quote-slice output as .gcode.3mf and sanitize MakerWorld H2D G-code placeholders.

Latest local/Pi change:
- Docker sidecar was saving quote-slices as generic `result.3mf`, so Print Bay still showed **Slice** on the source. Output is now `{source}_{printer}.gcode.3mf`. Print Bay offers **Queue sliced** when that sibling exists (also treats leftover `result.3mf` as sliced).
- MakerWorld/H2D 3MF custom G-code: rewrite `{elsif}` / `ceil()` / `filament_map` / `old_extruder_variant` so Orca 2.4.0-alpha can slice highland cow style files.
- Hard refresh (`app.js?v=666`). Backend restart on Pi **and** Windows worker.

Previous:
- H2D G-code placeholders (`f7290ce`).

---

## 2026-08-14 Session update (H2D G-code placeholders)

Latest commit: `f7290ce` â€” Strip unknown H2D G-code placeholders so Docker Orca can slice MakerWorld 3MFs.

Latest local/Pi change:
- Nightly Orca (and even stable 2.4.2) still fails windowless CLI without Mesa. Slice unsliced now uses the Docker sidecar (`:3003`, Orca 2.4.0-alpha) when **Use Slicer API** is on.
- H2D machine G-code uses placeholders that alpha does not know (`cooling_filter_enabled`, `timelapse_inline_photo`, `farthest_point_timelapse_enabled`). Flightdeck treats those as false (keep `{else}` / ternary false-arm) and retries leftover unknown vars from the sidecar error.
- Friendly slicer errors skip the useless `Slic3r::CLI::run found error` footer.
- Desktop Orca is now **2.4.2** (was Nightly). Local CLI still needs a `mesa\` copy from Bambu Studio for windowless GPU; sidecar is the working path.
- Backend restart required on the Pi **and** Windows worker. Hard refresh not required (`app.js?v=665`). On highland cow hit **Slice unsliced**.

Previous:
- Multi-plate queue split (`0700b11`).

---

## 2026-08-14 Session update (Multi-plate queue split)

Latest commit: `0700b11` â€” Queue an all-plates `.gcode.3mf` as one job per plate.

Latest local/Pi change:
- Bambu **Export all plates** `.gcode.3mf` now enqueues **N prints** (plate 1â€¦N), not one print of plate 1.
- Each queue row shows `Plate 3 of 8` plus that plateâ€™s time/grams/thumbnail; send uses `Metadata/plate_N.gcode`.
- Projects file row shows `8 plates Â· â€¦` when the export has more than one plate.
- Hard refresh (`app.js?v=665`). Backend restart required.

Previous:
- Project quote line items (`b026b71`).

---

## 2026-08-14 Session update (Project quote line items)

Latest commit: `b026b71` â€” Show filament, shop time, labour, and suggested separately on Projects.

Latest local/Pi change:
- Project quote was labelling the full floor as â€œshopâ€, so filament looked extra. Cards now split filament / shop hours / my time / suggested.
- Hard refresh (`app.js?v=664`). Backend restart required.

Previous:
- 3MF CLI sentinels (`516e8a1`).

---

## 2026-08-14 Session update (3MF CLI sentinels)

Latest commit: `516e8a1` â€” Strip Bambu inherit-sentinels so Orca CLI can slice MakerWorld 3MFs.

Latest local/Pi change:
- Orca CLI was failing with `Param values in 3mf/config` because Bambu writes `-1` / filament `0` inherit sentinels. Flightdeck now strips those from `project_settings.config` before slice (and retries any leftover keys from the error).
- Backend restart required. On Bully hit **Slice unsliced**.

Previous:
- Slice without dead sidecar (`dfe35b7`).

---

## 2026-08-14 Session update (Slice without dead sidecar)

Latest commit: `dfe35b7` â€” Quote slices use Windows Orca when the Slicer API sidecar is down.

Latest local/Pi change:
- Project auto-slice was timing out on the offline Slicer API (`:3003`). 3MF/project files now go to the Windows workerâ€™s local Orca (`orca-slicer.exe`) and skip the sidecar unless an H2D STL/OBJ actually needs it.
- Backend restart required. On the Bully project hit **Slice unsliced**.

Previous:
- Project auto-slice (`2b1fe1a`).

---

## 2026-08-14 Session update (Project auto-slice)

Latest commit: `2b1fe1a` â€” Auto-slice unsliced project 3MF files for quotes.

Latest local/Pi change:
- Drop a MakerWorld / Save Project `.3mf` (or STL) into a Project: Flightdeck background-slices it with slicer defaults and writes a `.gcode.3mf` into the vault folder, then quotes grams/time.
- Pick **Slice / quote printer** on the project (or Auto matches the 3MF printer / first printer with defaults). **Slice unsliced** retries failures.
- Needs Settings â†’ Slicer defaults + worker/API. Hard refresh (`app.js?v=663`, `style.css?v=506`). Backend restart required.

Previous:
- Overhead electric name match (`44f0f71`).

---

## 2026-08-14 Session update (Overhead electric name match)

Latest commit: `44f0f71` â€” Only fill the Electricity overhead from Power this month.

Latest local/Pi change:
- â€œDaily Network Electricity Accessâ€ was matching `electric` in the name and getting overwritten to the power $ total. Power now binds only to the dedicated Electricity line (id/name exactly Electricity).
- Hard refresh (`app.js?v=662`). Re-enter the network line amount if it already saved as the power figure.

Previous:
- Electricity from power calc (`60ff95e`).

---

## 2026-08-14 Session update (Electricity from power calc)

Latest commit: `60ff95e` â€” Fill Costing Electricity overhead from Power this month.

Latest local/Pi change:
- Monthly overheads **Electricity** is filled from the Power this month $ total (print hours Ã— wiki watts Ã— tariff). Shop rate updates live; Save costing to persist.
- Hard refresh (`app.js?v=661`, `style.css?v=505`). Backend restart optional.

Previous:
- Power this month (`f17089a`).

---

## 2026-08-14 Session update (Power this month)

Latest commit: `f17089a` â€” Estimate print electricity from History hours Ã— Bambu wiki watts Ã— tariff.

Latest local/Pi change:
- Settings â†’ Costing: **Power this month** panel â€” month picker, print hours by printer, wiki avg W (material-aware when known), editable W overrides, $/kWh tariff â†’ kWh and $.
- Does **not** dump the whole bill onto printers; shop-rate overhead â€œElectricityâ€ line stays a bill share. Quotes still use shop $/hr.
- API: `GET /api/costing/power?month=YYYY-MM`. Costing settings store `electricity_rate_per_kwh` + optional `power_watts` overrides.
- Hard refresh (`app.js?v=660`, `style.css?v=504`). Backend restart required.

Previous:
- Projects delete stick (`97999f4`).

---

## 2026-08-14 Session update (Projects delete stick)

Latest commit: `97999f4` â€” Keep deleted Projects from coming back via orphan folder adopt.

Latest local/Pi change:
- Delete project was toasting success then immediately re-adopting the vault folder. Dismissed folders are now remembered so delete sticks; files still stay on disk.
- Hard refresh (`app.js?v=659`). Backend restart required.

Previous:
- Projects Bambu Save vs Export (`cf6bdfd`).

---

## 2026-08-14 Session update (Projects â€” Bambu Save vs Export)

Latest commit: `cf6bdfd` â€” Explain Bambu Save Project vs plate .gcode.3mf exports in Projects.

Latest local/Pi change:
- Bambu **Save Project** `.3mf` keeps plate previews but empties `slice_info` â€” Flightdeck now labels that clearly instead of â€œNot sliced yetâ€.
- Quotes need **Export plate data** `.gcode.3mf` files (per plate). Orphan `Projects/*` vault folders are re-linked on Projects list.
- Hard refresh (`app.js?v=658`). Backend restart required.

Previous:
- Project folders (`03ca599`).

---

## 2026-08-14 Session update (Project folders)

Latest commit: `03ca599` â€” Add project folders so a vault kit quotes from sliced grams and time.

Latest local/Pi change:
- New **Projects** tab: named Print Vault folder (`Projects/Summer Goose`), drop sliced plates, Flightdeck sums grams + time from 3MF/gcode.
- Quote uses Costing shop rate: filament, printer-hours (shop floor), and **elapsed** (overlap = max(longest plate, total Ã· printers)).
- PrintShelf stays the library. Hard refresh (`app.js?v=657`, `style.css?v=503`). **Backend restart required.**

Previous:
- Shop costing for local quotes (`3db4475`).

---

## 2026-08-14 Session update (Shop costing for local quotes)

Latest commit: `3db4475` â€” Add shop costing so local quotes cover overhead without a full labour rate.

Latest local/Pi change:
- Settings â†’ **Costing**: monthly overheads (Bambu, electricity, other), expected print hours (prefill from last 30 days), markup %, optional â€œmy timeâ€ $/hr (default $0).
- Derived **shop rate** = monthly Ã· hours. Quote helper: grams + hours â†’ filament / time / floor / suggested.
- Passports and Print Memory show **filament / time / floor / suggested**. Filament `total_cost` is unchanged so old numbers donâ€™t lie.
- Hard refresh (`app.js?v=656`, `style.css?v=502`). **Backend restart required.**

Previous:
- Flight Recorder Windows lockup (`68f3635`).

---

## 2026-08-13 Session update (Flight Recorder â€” Windows lockup)

Latest commit: `68f3635` â€” Don't auto-decode Bambu clips in Flight Recorder

Latest local/Pi change:
- Opening a print passport auto-loaded the Flight Recorder video (`preload=metadata`). Bambu harvested MP4s keep `moov` at the **end**, so the browser downloads the whole clip and hardware-decodes it immediately â€” that can freeze/crash Windows (GPU TDR).
- Videos now `preload="none"` (click play to load), previous clip is aborted when switching prints, and new harvests/uploads are remuxed with faststart.
- Hard refresh (`app.js?v=655`). Backend restart required.

Previous:
- Painter Flip + Chop socket seating (`482d294`).

---

## 2026-08-13 Session update (Painter â€” Flip + Chop socket seating)

Latest commit: `482d294` â€” Painter Flip; seat on cut face not socket

Latest local/Pi change:
- Chop connector sockets were fooling Painter's "lay on bed" heuristic (minY = pocket floor â†’ Trix sat on her snout). Now scores the dominant flat instead.
- **Flip** / Spin 90Â° / Roll 90Â° in Painter (toolbar + Model tab) so you can turn a model over.
- Hard refresh (`app.js?v=654`, Painter **b577** / `painter.html?v=577`). Reload Trix if she is already open.

Previous:
- Chop Flexi range + own menu (`f654a16`).

---

## 2026-08-13 Session update (Chop â€” Flexi range + own menu)

Latest commit: `f654a16` â€” Chop Flexi Cut 256 planes; own sidebar tab

Latest local/Pi change:
- Flexi Cut plane count max **64 â†’ 256**; adjust-plane slider is 10Ã— finer (full piece length).
- **Chop** is now its own Flightdeck sidebar tab (`#/chop`), same iframe pattern as STL Painter. Still reachable from MakerDeck too.
- Hard refresh (`app.js?v=653` / `style.css?v=501`). Chop HTML is served fresh on first open of the tab.

Previous:
- Vinyl â€” drop Taskbar, playlist in Small (`59393e0`).

---

## 2026-08-12 Session update (Vinyl â€” drop Taskbar, playlist in Small)

Latest commit: `59393e0` â€” Remove Taskbar; + Playlist in Small player

Latest local/Mora change:
- Removed Taskbar mode (worth a shot; canâ€™t embed in the OS bar).
- Small player keeps **SPIN** and now has **+ Playlist** beside it.
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- Taskbar layout attempts.

---

## 2026-08-12 Session update (Vinyl â€” Taskbar layout fix)

Latest commit: `0a8b7f6` â€” Taskbar fills window as one row

Latest local/Mora change:
- Taskbar mode was leaving a huge empty grey slab (ribbon CSS pinned the bar to the bottom).
- Now fills the compact window as a single strip; also stops the â‰¤700px wrap stacking.
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- Dock above OS taskbar (`81794a0`).

---

## 2026-08-12 Session update (Vinyl â€” Taskbar above OS bar)

Latest commit: `81794a0` â€” Dock compact modes above Windows taskbar

Latest local/Mora change:
- Taskbar/Small player now re-measure `outerHeight` and sit **above** the Windows taskbar (was sliding underneath).
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- Taskbar mode (`5fdd075`).

---

## 2026-08-12 Session update (Vinyl â€” Taskbar mode)

Latest commit: `5fdd075` â€” Third chrome mode: Taskbar strip

Latest local/Mora change:
- Header **Taskbar** (and â‹¯ / Smallâ†’Taskbar chip) docks an ultra-slim strip (~560Ã—92).
- Taskbar keeps art, title, prev/play/next, **Small**, **ROOM**.
- Modes: vinyl room â†’ Small player â†’ Taskbar.
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- Small player button (`9c657e6`).

---

## 2026-08-12 Session update (Vinyl â€” Small player button)

Latest commit: `9c657e6` â€” Named Small player size (680Ã—210)

Latest local/Mora change:
- Header **Small player** button (and â‹¯ menu) opens the compact player at the size Chris liked.
- **ROOM** still restores the full vinyl room.
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- ROOM restore + shuffle/norm (`cc5dca5`).

---

## 2026-08-12 Session update (Vinyl â€” ROOM restore + ribbon controls)

Latest commit: `cc5dca5` â€” ROOM opens vinyl room; keep shuffle/norm on ribbon

Latest local/Mora change:
- **ROOM** (not Windows maximise) opens a clean large vinyl-room window.
- Windows maximise while ribboned is redirected through the same ROOM restore.
- Shuffle + loudness normalise stay on the slim ribbon bar.
- Hard refresh / reopen Cindy. Rebuild `vinyl` on Mora.

Previous:
- Ribbon SPIN visibility (`af924d2`).

---

## 2026-08-12 Session update (Vinyl â€” ribbon SPIN actually shows)

Latest commit: `af924d2` â€” SPIN/ROOM always on slim bar; fix ribbon race

Latest local/Mora change:
- SPIN + ROOM show whenever the window is short (not only when `.ribbon` class sticks).
- Entering ribbon no longer immediately auto-exits (race with resizeTo).
- ROOM restores a tall window so the vinyl room can come back.
- Hard refresh / reopen the installed Cindy app. Rebuild `vinyl` on Mora.

Previous:
- Ribbon SPIN attempt (`d039444`).

---

## 2026-08-12 Session update (Vinyl â€” ribbon fixes)

Latest commit: `d039444` â€” Ribbon SPIN + auto-restore on maximise

Latest local/Mora change:
- Ribbon bar now has **SPIN** (random sleeve) and **â–´ Room** to browse crates.
- Maximising / expanding the window auto-restores the full vinyl room (no more gray â€œPlaying in the ribbonâ€ stuck state).
- Hard refresh Vinyl. Rebuild `vinyl` on Mora.

Previous:
- Ribbon mode first pass (`7e0e694`).

---

## 2026-08-12 Session update (Vinyl â€” minimise to ribbon)

Latest commit: `7e0e694` â€” Cindy Vinyl ribbon / windowshade mode

Latest local/Mora change:
- **â–¬** in the header (and â‹¯ â†’ Minimise to ribbon) collapses the vinyl room to a slim now-playing bar. â–´ or Escape restores.
- Installed PWA: tries to shrink the window and dock it to the bottom of the screen.
- Browser (Edge/Chrome): uses a floating always-on-top ribbon when Document Picture-in-Picture is available.
- Hard refresh Vinyl (`http://192.168.4.77:4541`). Rebuild `vinyl` on Mora.

Previous:
- Chop part-number offset (`fe47d5f`).

---

## 2026-08-12 Session update (Chop â€” part # away from connectors)

Latest commit: `pending` â€” Stamp part numbers in a corner, not on the peg

Latest local/Pi change:
- Auto-finish was engraving huge centered part numbers on the same cut face as the connector â†’ jagged boolean junk.
- Numbers are now small and in a **corner**; skipped if the face is too small to host both.
- Hard refresh Chop (`mesh-cut.js?v=24`). Recut (or undo + recut) to clear existing artifacts.

Previous:
- Chop UI flow (`c618353`).

---

## 2026-08-12 Session update (Chop â€” tidy sidebar, finish by default)

Latest commit: `c618353` â€” Chop UI flow + connectors/part # after every cut

Latest local/Pi change:
- Sidebar is now **Load â†’ Setup â†’ Cut â†’ Finish â†’ Pieces** instead of a pile of add-on panels.
- **Connectors** and **Part numbers** are on by default and run automatically after Commit Cut / Auto-Chop. Uncheck to skip; â€œApply to current piecesâ€ re-runs on an existing cut.
- Hard refresh Chop (`mesh-cut.js?v=23`).

Previous:
- Thickness-capped pegs / merge strips connectors (`2bb01b4`).

---

## 2026-08-12 Session update (Chop â€” merge strips connectors / no punch-through)

Latest commit: `2bb01b4` â€” Thickness-capped pegs; merge removes internal connectors

Latest local/Pi change:
- Thin neck/shell joints were getting pegs that punched through; merge kept that geometry.
- Connector depth now capped at **40% of wall thickness** (skip if wall &lt; 8 mm).
- **Merge Selected** strips any connector that sat between the pieces you merge.
- Hard refresh Chop (`mesh-cut.js?v=22`). Undo connectors, re-add, then merge â€” or merge now to strip the poking peg.

Previous:
- Catch missing joints (`5e5fbce`).

---

## 2026-08-12 Session update (Chop â€” catch missing joints)

Latest commit: `5e5fbce` â€” Detect staggered cut faces; lower tiny-face skip to 22mm

Latest local/Pi change:
- Some joints got no connectors: adjacency only matched near-identical scars (missed staggered/partial overlaps), and the 40mm skip was too aggressive.
- `findAdjacentPieces` now uses UV AABB overlap + slightly looser normal/plane tolerances.
- Tiny-face glue-only threshold lowered to **22 mm**; mid faces still get small pegs.
- Hard refresh Chop (`mesh-cut.js?v=21`). Undo + Add Connectors again.

Previous:
- Skip tiny-face connectors (`9de77f1`).

---

## 2026-08-12 Session update (Chop â€” skip connectors on tiny faces)

Latest commit: `9de77f1` â€” Skip connectors on faces under 40mm

Latest local/Pi change:
- Ear-tip / sliver joints still got pegs that swallowed the piece.
- Add Connectors now skips interfaces where the shared face min-dim is **&lt; 40 mm** (glue only); status reports how many were skipped.
- Hard refresh Chop (`mesh-cut.js?v=20`). Tiny pieces can still be **Merge Selected** into a neighbour if you don't want them separate.

Previous:
- Connector 30Ã—18 cap (`9446912`).

---

## 2026-08-12 Session update (Chop â€” connectors smaller again)

Latest commit: `9446912` â€” Lower connector cap to 30Ã—18 mm

Latest local/Pi change:
- Neck/rump pegs still looked brick-like at 55mm/40mm depth.
- Cap now **30 mm** wide, depth **â‰¤18 mm** (0.6Ã— width); face ratio 40%â†’12%.
- Hard refresh Chop (`mesh-cut.js?v=19`). Undo + Add Connectors on a clean cut.

Previous:
- Connector size cap 55mm (`9d5f003`).

---

## 2026-08-12 Session update (Chop â€” LuBan connectors, smaller)

Latest commit: `9d5f003` â€” Cap connector size / depth so pegs aren't bricks

Latest local/Pi change:
- After LuBan single-connector pass, life-size faces still got oversized pegs (up to ~35% of face, depth 1.5Ã— width).
- Now: width blends 55%â†’18% of face min-dim, **hard cap 55 mm**; depth = min(0.75Ã—width, 40 mm).
- Hard refresh Chop (`mesh-cut.js?v=18`). Undo + Add Connectors again on a clean cut.

Previous:
- LuBan single connectors (`1a994e3`).

---

## 2026-08-12 Session update (Chop â€” LuBan-style single connectors)

Latest commit: `1a994e3` â€” One proportional connector per joint (LuBan-style)

Latest local/Pi change:
- **Problem:** Add Connectors tiled a dense grid of tiny pegs (~12 mm cap) across every cut face â€” unprintable on life-size Trixie pieces vs LuBanâ€™s single large interlocking peg.
- **Fix:** One centred peg/socket per shared interface; width scales with face size (~85% of min dim on small faces, ~35% on large). Shrinks to fit organic cut boundaries.
- Files: `makerforge/js/mesh-cut.js`, `makerforge/chop.html` (`mesh-cut.js?v=17`), `makerforge/test/chop-manifold.mjs`.
- Hard refresh Chop. UI-only static â€” pull required; restart optional.
- Verified: `chop-manifold.mjs` â€” all 203 checks passed.

Previous:
- Cindy Vinyl post-outage recovery (`35157e2`).

---

## 2026-08-08 Session update (Cindy Vinyl â€” post-power-outage recovery)

Latest commit: `35157e2` â€” Fix Mora vinyl mounts after Cindy NAS offline / reboot

Latest Mora change:
- **Root cause:** power outage â†’ Cindy NAS off â†’ Mora lost `/share/{Cindy,Checked,Jamal}` remote mounts â†’ `cindy-navidrome` exited; vinyl health/covers/stream failed.
- **Fix:** Navidrome compose now bind-mounts `/volume2/cindy-vinyl/mounts/{Cindy,Checked,Jamal}` (stable SSD paths). New `jukebox/scripts/mount-cindy-on-mora.sh` CIFS-mounts Cindy when it's back online.
- **Deployed on Mora:** Navidrome restarted; `/api/health` ok, random album 200. **Playback needs Cindy NAS powered on** + run mount script.
- When Cindy is back: on Mora (sudo) `cd /volume2/cindy-vinyl/compose && sh mount-cindy-on-mora.sh && sh build-mora-library-view.sh && docker compose -f docker-compose.mora.yml restart navidrome`
- LAN: `http://192.168.4.77:4541` â€” no app.js bump (infra only).

Previous:
- Vinyl â€” add to playlist from crates/Stacks (`6cd9885`).

---

## 2026-08-04 Session update (MakerDeck â€” new Chop plane-cutting tool)

Latest local/Pi change:
- New MakerDeck tool **Chop** (`/makerdeck/chop.html`): load STL/OBJ â†’ scale to a target size â†’ straight/angled plane cuts â†’ per-piece STL export, with a bed-fit pill sourced from `printers.yaml` build volumes.
- From-scratch plane-cutting core (`makerforge/js/mesh-cut.js`) â€” no CSG existed in the repo before. Verified watertight via new `makerforge/test/chop-manifold.mjs` (axis-aligned / angled / vertex-through / multi-loop / chained cuts, all 0 open edges) and a scripted headless-Chrome pass.
- New STL+OBJ loaders (`makerforge/js/mesh-import.js`), new `GET /api/printers/bed-sizes` endpoint.
- Connectors (pegs/sockets) and part-number stamping intentionally deferred to a follow-up session â€” this is Phase 1 only.
- **Backend restart required** (new API route).
- MakerDeck session notes â†’ [makerforge/SESSION_NEXT.md](makerforge/SESSION_NEXT.md)

Previous:
- Vinyl â€” add to playlist from crates/Stacks (`6cd9885`).

---

## 2026-08-04 Session update (Vinyl â€” add to playlist from crates/Stacks)

Latest commit: `6cd9885` â€” Add albums/tracks from crates & Stacks to playlist

Latest Mora change:
- Sleeve â‹¯ on crates + Found in the stacks albums: **Add album to playlist**.
- Stacks track tiles â‹¯: **Add to playlist**.
- Reuses existing playlist APIs; no new crates.
- Also ships `python-multipart` (cover upload Form routes).
- Mora compose host port is **4541 only** (Tailscale serve owns 4540).
- Hard refresh Vinyl (`http://192.168.4.77:4541`).

Previous:
- H-series unload path-skip (`0caaa79`).

---

## 2026-08-03 Session update (H-series unload â€” drop path skip)

Latest commit: `0caaa79` â€” Always unload low-temp before H-series high-temp jobs

Latest local/Pi change:
- BigBoy test (job #243): ASA on left metadata + PETG on AMS HT skipped unload because of H2D â€œother pathâ€ logic.
- Removed that skip â€” any low-temp at `tray_now` before a high-temp queue job now auto-unloads.
- **Backend restart required**.

Previous:
- H-series unload gate (`6653256`).

---

## 2026-08-03 Session update (H-series high-temp nozzle unload)

Latest commit: `6653256` â€” Auto-unload low-temp before H-series high-temp queue jobs

Latest local/Pi change:
- On **H-series** queue dispatch: if the job needs high-temp (ABS/ASA/PA/PC/â€¦) and AMS `tray_now` still shows low-temp (PLA/PETG/TPU/â€¦) at the nozzle, Flightdeck **auto-unloads**, waits until clear (up to 5 min), then starts the print.
- Preflight shows an info line; decisions logged as `ams_unload_before_high_temp*`.
- Files: `app/main.py`, `app/printers/bambu.py` (unload-without-slot now heats to tray_now material).
- **Backend restart required** after Pi pull.

Previous:
- Loudness normaliser (`4d329fe`).

---

## 2026-08-03 Session update (Cindy Vinyl â€” loudness normalise)

Latest commit: `4d329fe` â€” Add deck loudness normaliser

Latest local/Mora change:
- Deck control **âŒ€** toggles Web Audio loudness normalise (levels quiet/loud tracks). Preference saved in `localStorage`.
- Live on Mora â€” hard refresh Vinyl (`http://192.168.4.77:4541`).

Previous:
- Vinyl on Mora (`9f3d922`).

---

## 2026-08-03 Session update (Cindy Vinyl â†’ Mora)

Latest commit: `9f3d922` â€” Move Cindy Vinyl and Navidrome onto Mora volume2

Latest local/Mora change:
- Vinyl + Navidrome now run on **Mora** (`192.168.4.77`), data on SSD `/volume2/cindy-vinyl/`, music via `/share/{Cindy,Checked,Jamal}`.
- LAN URL: `http://192.168.4.77:4541` (reinstall Desktop shortcut / hard refresh bookmarks).
- Tailscale serve on Mora: `https://flightdeck-nas.tail7de73e.ts.net:4540/` (may need DSM firewall allow if it times out).
- Pi `cindy-vinyl` + `cindy-navidrome` stopped with `restart=no`.
- Files: `jukebox/docker-compose.mora.yml`, `scripts/build-mora-library-view.sh`, `scripts/migrate-vinyl-to-mora.py`.

Previous:
- Open helper fix (`5a400e7`).

---

## 2026-08-01 Session update (Cindy Vinyl â€” Open helper fix)

Latest commit: `5a400e7` â€” Fix cindyvinyl:// Explorer open (path mangling)

Latest local/Pi change:
- Open helper was killing paths with PowerShell `-replace '/' '\'`; now uses base64 UNC + `.Replace` + error popup/log.
- Re-run `install-cindy-open.ps1` once (Run with PowerShell), hard refresh `?v=94`.

Previous:
- Open in Explorer (`e97d155`).

---

## 2026-08-01 Session update (Cindy Vinyl â€” Open in Explorer)

Latest commit: `e97d155` â€” On Cindy opens Explorer (not just copy)

Latest local/Pi change:
- On Cindy **Open** launches the album folder / selects the track file in Windows Explorer.
- Needs a one-time helper: download `install-cindy-open.ps1` from the modal â†’ Run with PowerShell (registers `cindyvinyl://`).
- Hard refresh `?v=93`. Rebuild `vinyl`.

Previous:
- On Cindy live data (`9de7fc4`).

---

## 2026-08-01 Session update (Cindy Vinyl â€” On Cindy live data)

Latest commit: `9de7fc4` â€” Sleeve â‹¯ On Cindy live album/track paths

Latest local/Pi change:
- Sleeve **â‹¯** is a menu: **Edit namesâ€¦** / **On Cindyâ€¦**.
- On Cindy pulls live Navidrome tags + library/UNC paths for the album and each track (click a track to load its path).
- Tracks panel gets a **Cindy** button per side for the same lookup.
- Hard refresh `?v=92`. Rebuild `vinyl`.

Previous:
- Smooth platter hold loop (`74b7dd5`).

---

## 2026-08-01 Session update (Cindy Vinyl â€” smooth platter loop)

Latest commit: `74b7dd5` â€” Fix record spin jump at hold seam

Latest local/Pi change:
- Amp-rack hold loop was 8â†’9s (wrong period); now one real revolution (31 frames @ 24fps â‰ˆ 1.29s) with frame-accurate seek.
- CSS label no longer resets to 0Â° on pause (`animation-play-state` instead of tearing down the animation).
- Lounge freezes the arm-down frame (no clean seam in that footage) while the label keeps spinning.
- Hard refresh `?v=91`. Rebuild `vinyl`.

Previous:
- Center cover + Aâ€“Z by artist (`4b62eea`).

---

## 2026-07-31 Session update (Cindy Vinyl â€” centered sleeve + Aâ€“Z by artist)

Latest commit: `4b62eea` â€” Center cover; Aâ€“Z by artist (filter pack collapse)

Latest local/Pi change:
- Now-playing cover sits centered in the hero gap (not stuck on the far right); a bit larger.
- Aâ€“Z crate files by **album artist** (record-store style): Deep Purple â†’ D, comps on **VA**.
- After folder-collapse, drop sleeves that no longer match the letter (VA chart packs leaking into A).
- Hard refresh `?v=90`. Rebuild `vinyl`.

Previous:
- Aâ€“Z more sleeves paging (`12b2b8d`).

---

## 2026-07-31 Session update (Cindy Vinyl â€” Aâ€“Z more sleeves)

Latest commit: `12b2b8d` â€” Page through all sleeves in a letter

Latest local/Pi change:
- Aâ€“Z was capped at 36 sleeves; now shows â€œN of totalâ€ and a **More sleeves** button to append the next page (PageDown also loads more).
- Backend caches the full collapsed letter list and serves `offset`/`hasMore`.
- Hard refresh `?v=89`. Rebuild `vinyl`.

Previous:
- Light theme `#71788A` bg (`3c80eee`).

---

## 2026-07-31 Session update (Cindy Vinyl â€” light/dark amp-rack themes)

Latest commit: `812cc1e` â€” Light white-crate theme; remove Tracks Amp panel

Latest local/Pi change:
- Removed the Tracks Amp VU/EQ panel; volume lives in the transport bar again.
- Themes: **Dark Â· Amp rack** (default, dark crate), **Light Â· Amp rack** (white Cindy crate + light room chrome), **Dark Â· Lounge**.
- Both amp-rack themes share the deck-on-amp footage; crate + page chrome switch with the room.
- Hard refresh `?v=84`. Rebuild `vinyl`.

Previous:
- Queue finish reconcile (`04f9e2f`).

---

## 2026-07-31 Session update (queue: finished prints not marked CANCELLED)

Latest commit: `04f9e2f` â€” Mark stuck queue jobs DONE after real finish

Latest local/Pi change:
- Pyramid job showed CANCELLED + â€œCleared stale queue state after printer returned to idleâ€ even though the print had finished and the printer was idle.
- Cause: queue row stayed `printing` after a missed finish transition; reconciler treated idle/finished as stale cancel.
- Now: `finished` / recent finish / last print FINISHED matching the queue filename â†’ mark DONE; only true orphans get the soft cancel.
- Backend restart required.

Previous:
- Vinyl crate speed (`8051c77`).

---

## 2026-07-31 Session update (Cindy Vinyl â€” fast crates / startup)

Latest commit: `8051c77` â€” Precompute folder stubs; warm Aâ€“Z (~0.1s digs)

Latest local/Pi change:
- Cold Aâ€“Z was ~24â€“31s: crate collapse built full tracklists / re-scanned `media_file` per pack.
- One library pass now primes merge maps + slim folder sleeves; letter A warmed before ready.
- Pi bench after deploy: A/K/R/newest/letters all ~0.1â€“0.15s (was 24s+ cold).
- Letters GROUP BY; shared cover httpx client; cue videos after first crate paint.
- Hard refresh `?v=83`. Rebuild `vinyl`.

Previous:
- Amp-rack theme / crate carousel polish (Claude touch-up series).

---

## 2026-07-30 Session update (Cindy Vinyl â€” crate-carousel Aâ€“Z browse)

Latest commit: `3f8ec8f` â€” Cindy Vinyl: crate-carousel A-Z browse

Latest local/Pi change:
- Aâ€“Z letter-chip rail replaced with a themed crate carousel: the real "Cindy Â· Vinyl" crate photo as the frame, sleeves paged per non-empty letter inside its interior opening.
- `[` / `]` page between letters (not â†/â†’ â€” already bound to track skip). New `GET /api/letters` (cached) supplies the non-empty-letter list once, so empty letters are skipped entirely.
- Sleeve click-to-play and drag-to-deck unchanged (reuses `sleeveButton()`). CSS perspective/tilt on the sleeves is deferred to a follow-up pass.
- Hard refresh `?v=63`. Rebuild `vinyl` (backend + static change).

Previous:
- Windows folder drop play (`32a3747`).

---

## 2026-07-30 Session update (Cindy Vinyl â€” Windows folder drop play)

Latest commit: `32a3747` â€” Play dropped Windows folders locally

Latest local/Pi change:
- Chris was dropping Explorer folders (status showed the old â€œcanâ€™t dropâ€ line).
- Deck now accepts OS folder/file drops: walks mp3/flac/m4a/â€¦ and plays via blob URLs.
- Hard refresh `?v=62`. Rebuild `vinyl`.

Previous:
- Pointer-drag sleeves (`5b33b14`).

---

## 2026-07-30 Session update (Cindy Vinyl â€” pointer drag, no âŠ˜ cursor)

Latest commit: `5b33b14` â€” Pointer-drag sleeves onto deck (skip HTML5 âŠ˜)

Latest local/Pi change:
- HTML5 drag showed the Windows âŠ˜ â€œcanâ€™t dropâ€ cursor in Edge app windows even over the deck.
- Sleeve / track / queue â†’ deck now uses pointer capture drag (no HTML5 DnD).
- Hard refresh `?v=61`. Rebuild `vinyl`.

Previous:
- Folder-pack drop harden (`22e1d8f`).

---

## 2026-07-30 Session update (Cindy Vinyl â€” folder-pack drop fix)

Latest commit: `22e1d8f` â€” Harden folder-pack drops; collapse Aâ€“Z; virtualize track list

Latest local/Pi change:
- Dropping folder packs was flaky / felt broken: DnD payload race, drop zone only on the photo, and huge packs (100â€“600 tracks) froze the Tracks panel with cover imgs.
- Keep drag payload longer; accept drop on whole `.hero-main`; status when drop misses.
- Aâ€“Z / VA letter rail now folder-collapses (over-fetch then merge).
- Tracks list virtualizes (~80 rows, covers near the needle only).
- Hard refresh `?v=60`. Rebuild `vinyl` (backend letter collapse).

Previous:
- Prism sleeve on cupboard (`6685cb5`).

---

## 2026-07-30 Session update (Cindy Vinyl â€” icon, VA crate, prism sleeve)

Latest commit: `f499bc5` â€” App icon; VA Aâ€“Z chip; prism sleeve cover back (bigger)

Latest local/Pi change:
- `cindy-vinyl.ico` for Windows shortcuts + favicon; installer downloads icon from LAN.
- Aâ€“Z adds **VA** chip (Various Artists / compilation albums via SQLite).
- Restored leaning prism sleeve cover at ~15.5% width (a bit bigger than before), in front of the glass.
- Hard refresh `?v=58`. Rebuild `vinyl`. Re-run installer on Mazâ€™s PC for the icon.

Previous:
- LAN :4541 + Windows install (`e29e1b4` / UNC fix `eecaf3f`).

---

## 2026-07-30 Session update (Cindy Vinyl â€” drag & drop onto deck)

Latest commit: `a5731ca` â€” Drag sleeves/tracks onto the deck to play

Latest local/Pi change:
- Left vinyl colour alone.
- Drag a crate/search sleeve, a search track, or a Tracks-panel side onto the deck â€” gold â€œDrop to playâ€ highlight, then it cues up.
- Hard refresh `?v=50`. Rebuild `vinyl`.

Previous:
- Album-gated tint (`6d333c9`).

---

## 2026-07-30 Session update (Cindy Vinyl â€” colour per album)

Latest commit: `6d333c9` â€” Random vinyl tint only when the album changes

Latest local/Pi change:
- Vinyl colour stays put across tracks on the same record; new random tint when a different album lands.
- Hard refresh `?v=49`. Rebuild `vinyl` (static).

Previous:
- Faster label swaps (`8a2eb63`).

---

## 2026-07-30 Session update (Cindy Vinyl â€” faster label swaps)

Latest commit: `8a2eb63` â€” Reuse sleeve-sized covers; prefetch; cache covers

Latest local/Pi change:
- Platter label was fetching 600px covers (cache miss vs crate sleeves at 300). Now uses 300px, prefetches nearby queue covers, and `/api/cover` sends `Cache-Control` for a week.
- Hard refresh `?v=48`. Rebuild `vinyl` (backend cover headers).

Previous:
- Warm tint polish (`14e5f71`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” warm tint palette polish)

Latest commit: `14e5f71` â€” Warmer vinyl colours; tiny label/tint nudge

Latest local/Pi change:
- Chris called `?v=46` the best yet â€” light polish only: warmer oxblood/plum/amber resin palette (less neon), slightly richer soft-light, micro-nudge label onto spindle.
- Hard refresh `?v=47`. Rebuild `vinyl`.

Previous:
- Circular label spin (`cab13bb`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” stop orbiting centre label)

Latest commit: `cab13bb` â€” Circular label spins in place; tint stays soft

Latest local/Pi change:
- Centre art was an ellipse being rotated â€” that made it orbit inside the record. Now a circle with `rotateX` pose; only the inner wrapper spins.
- Tint stays the softer fuller-disc fade from `?v=45`.
- Hard refresh `?v=46`. Rebuild `vinyl`.

Previous:
- Dial back tint wipe (`53616cf`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” dial back tint wipe)

Latest commit: `53616cf` â€” Softer arm fade; fuller colour disc

Latest local/Pi change:
- Hard right-half wipe was too aggressive (looked like a left wedge). Now a gentle far-right fade only, slightly softer opacity, smaller centre hole.
- Hard refresh `?v=45`. Rebuild `vinyl`.

Previous:
- Screen-space elliptical tint (`ed3694f`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” screen-space elliptical tint)

Latest commit: `ed3694f` â€” Elliptical tint (no rotateX); arm-side wipe; bigger label

Latest local/Pi change:
- Tint is an ellipse in screen space (perspective via widthâ‰ height) so the arm cutout lines up with the video â€” `rotateX` was fighting the mask.
- Soft-light blend + hard wipe on the right half where the tonearm lives.
- Larger elliptical centre art covers the Navidrome/baked-in label.
- Hard refresh `?v=44`. Rebuild `vinyl`.

Previous:
- Sleeve edit + overlay polish (`a0c3caa`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” sleeve Edit â‹¯ + overlay polish)

Latest commit: `a0c3caa` â€” Sleeve edit; tilt/shrink tint; arm corridor; cover label

Latest local/Pi change:
- Each crate sleeve has â‹¯ â†’ Edit names (album/artist) without spinning first.
- Colour tint: more back-tilt (`rotateX(58deg)`), slightly smaller, bigger centre hole, wider arm cutout so gold sits on top; centre art enlarged to cover baked-in video label.
- Hard refresh `?v=43`. Rebuild `vinyl`.

Previous:
- Nudge + arm mask (`b0dcb93`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” nudge + arm over tint)

Latest commit: `b0dcb93` â€” Micro-nudge label; mask colour under tonearm

Latest local/Pi change:
- Nudged platter overlay right/down to `41.5% / 56%`.
- Colour tint punches out the tonearm path so gold arm sits on top; slightly softer opacity.
- Hard refresh `?v=41`. Rebuild `vinyl`.

Previous:
- Centre label + arm park (`0e38b7c`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” centre label + arm park + colour)

Latest commit: `0e38b7c` â€” Nudge label onto spindle; short hold; visible vinyl tint

Latest local/Pi change:
- Label was ~5% left of the spindle â€” moved to 40.2% / 54.8%; spin on inner wrapper so 3D pose doesnâ€™t drift.
- Hold loop back to 3.55â†’4.2s so the arm stays on the outer grooves (long loop was crawling then snapping).
- Vinyl colour is a saturated translucent groove ring (soft-light on black was invisible).
- Hard refresh `?v=40`. Rebuild `vinyl`.

Previous:
- Revolution hold + centre art (`a812eaf`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” label seam + colour + centre art)

Latest commit: `a812eaf` â€” Revolution hold loop; spinning centre label; random vinyl colour

Latest local/Pi change:
- Hold loop is one platter revolution (3.55â†’5.008s) so label phase matches at the seam.
- Restored spinning album-art label over the platter centre (covers residual video jump).
- Random vinyl colour tint each track (`mix-blend-mode` so the video tonearm stays visible).
- Hard refresh `?v=39`. Rebuild `vinyl` (static only; restart optional).

Previous:
- Tight outer-groove loop (`02b6a6f`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” strip hero overlays)

Latest commit: `10448c8` â€” Remove prism sleeve + platter overlays

Latest local/Pi change:
- Hero is photo/video only â€” no floating album sleeve or fake spinning label.
- Cover art stays in the transport bar / track list.
- Waiting on Chrisâ€™s new ~10s locked-camera loop (easier than cinematic + overlays).
- Hard refresh `?v=32`. Rebuild `vinyl`.

Previous:
- Forward hold + new still (`4d0b37c`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” tight outer-groove loop)

Latest commit: `02b6a6f` â€” Loop only outer-groove spin (~0.65s)

Latest local/Pi change:
- Hold loop was 2.0â†’5.15s so the arm crawled to the label then jumped back.
- Now loops 3.55â†’4.2s (needle parked on the lead-in). Hard refresh `?v=38`.

Previous:
- Spin loop after drop (`d27f956`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” keep spinning after drop)

Latest commit: `d27f956` â€” Forward play + spin loop (no freeze)

Latest local/Pi change:
- Cue-in is the forward first ~5.4s (spin up / arm over).
- Then loops 2.0sâ†’5.15s so the platter keeps spinning with the arm down.
- Queue end still plays the lift/stop outro. Hard refresh `?v=37`. Rebuild `vinyl`.

Previous:
- Full drop then freeze (`5b42922`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” full drop then freeze)

Latest commit: `5b42922` â€” Longer cue-in; donâ€™t abort mid-drop

Latest local/Pi change:
- Cue-in is the full arm-to-record move (~4.5s), then freeze on that frame.
- Fixed video kickoff so a transient `play()` reject no longer freezes mid-swing.
- Hard refresh `?v=36`. Rebuild `vinyl`.

Previous:
- Freeze after short cue-in (`5d9086d`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” freeze after cue-in)

Latest commit: `5d9086d` â€” Arm drops once, then freezes (no hold loop jump)

Latest local/Pi change:
- After cue-in, freeze on needle-down frame instead of looping a hold clip that jumped the arm back.
- Hard refresh `?v=35`. Rebuild `vinyl`.

Previous:
- New arm-lift clip (`a215cd6`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” new arm-lift stop clip)

Latest commit: `a215cd6` â€” Wire Chrisâ€™s arm-lift / stop 10s clip

Latest local/Pi change:
- New video split: short reverse drop-in (~2.2s), forward hold loop (~3.5s), cue-out lift/stop (~4.5s).
- Rest `deck.png` = end still. Hard refresh `?v=34`. Rebuild `vinyl`.

Previous:
- Overflow menu + properties (`10448c8`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” â‹¯ menu + properties)

Latest commit: `10448c8` â€” Top-right menu: Cindy path + rename props

Latest local/Pi change:
- Hero overlays stripped (photo/video only).
- Header **â‹¯** menu: Show on Cindy (UNC path), Properties (Vinyl-only album/track rename), Refresh packs.
- Overrides stored on Pi at `/home/flightdeck/cindy-vinyl-data` â€” Cindy stays read-only.
- Hard refresh `?v=33`. Rebuild `vinyl`.

Previous:
- Forward hold + new still (`4d0b37c`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” forward hold + new deck still)

Latest commit: `4d0b37c` â€” Forward-only spin loop + fresher rest still

Latest local/Pi change:
- Hold loop is **forward-only** (no reverse spin).
- Rest/startup `deck.png` replaced with Chrisâ€™s matched still; prism sleeve + platter retuned for 16:9.
- Hard refresh `?v=31`. Rebuild `vinyl`.

Previous:
- Ping-pong hold (`5267827`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” loop hold after cue-in)

Latest commit: `5267827` â€” Ping-pong hold loop; no snap back to still

Latest local/Pi change:
- Cue-in trimmed (~1.35s), then seamless handoff to `deck-cue-hold.mp4` (forward+reverse of post-drop).
- Stays on video while playing; pause freezes frame; queue end still plays cue-out then static rest.
- Hard refresh `?v=30`. Rebuild `vinyl`.

Previous:
- Start/stop cues (`3298d22`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” start/stop cue clips)

Latest commit: `3298d22` â€” Silent spin-up / spin-down deck cues

Latest local/Pi change:
- `start.mp4` â†’ `deck-cue-in.mp4`, stop clip â†’ `deck-cue-out.mp4` (audio stripped).
- Play from rest â†’ cue-in (~3s), then static deck + spinning label + prism sleeve.
- Queue end â†’ cue-out (~1.8s). Pause / track skip keep hold (no re-cue).
- Hard refresh `?v=29`. Rebuild `cindy-vinyl` (`vinyl` service).

Previous:
- Prism sleeve lean (`72fbda1`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” sleeve on Technics prism)

Latest commit: `72fbda1` â€” Album cover leans against Technics prism

Latest local/Pi change:
- Now-playing cover moved off the wall frame; sits in front of the glass Technics prism like a sleeve leaning on the table.
- Hard refresh `?v=28`. Rebuild `cindy-vinyl` (static only).

Previous:
- Square wall sleeve (`603e358` / `eb86c66`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” wall album art)

Latest commit: `eb86c66` â€” Album cover on framed gold Technics disc

Latest local/Pi change:
- Now-playing cover sits on the wall gold record behind the deck (circular overlay).
- Platter label still spins. Hard refresh `?v=26`. Rebuild `cindy-vinyl`.

Previous:
- PWA packaging (`753d6ba`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” PWA app)

Latest commit: `753d6ba` â€” PWA manifest + icons; Install like PrintShelf

Latest local/Pi change:
- Cindy Vinyl is installable: `manifest.json`, `sw.js`, icons, root routes.
- Hard refresh `?v=25`. Rebuild `cindy-vinyl`.
- For Chrome **Install**: `sudo tailscale serve --bg --https=4540 http://127.0.0.1:4540` then open HTTPS `:4540`.
- Optional desktop shortcut: `jukebox/scripts/create-desktop-shortcut.ps1`.

Previous:
- Transport polish (`5a02518`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” transport polish)

Latest commit: `5a02518` â€” Volume, time readout, keyboard shortcuts

Latest local/Pi change:
- Transport: `0:00 / 3:55` beside seek; volume slider + mute (persisted).
- Keys: Space play/pause, â†/â†’ skip, â†‘/â†“ volume, M mute (ignored while typing in search).
- Hard refresh Vinyl `?v=24`. Rebuild `cindy-vinyl`.

Previous:
- Spinning platter restored (`3915b28`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” spinning platter restored)

Latest commit: `3915b28` â€” Restore spinning label; park tonearm video for split clips

Latest local/Pi change:
- Back to `deck.png` + spinning platter label (`?v=23`).
- Tonearm MP4 kept in `jukebox/static/` for later once Chris supplies cue-in / cue-out splits.
- Rebuild `cindy-vinyl`.

Previous:
- Silent SL1200 tonearm attempt (`7232c69`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” silent SL1200 tonearm)

Latest commit: `7232c69` â€” Silent deck-arm.mp4 cue-in/out on play/end

Latest local/Pi change:
- Your `SL1200.mp4` â†’ `jukebox/static/deck-arm.mp4` (**audio stripped**, ~272KB).
- Hero deck is a muted `<video>`: cue-in on track start, hold needle-down, cue-out when queue ends.
- Pause mid-track keeps needle down. Hard refresh Vinyl `?v=22`.
- Rebuild `cindy-vinyl` on Pi.

Previous:
- Folder-pack merge + Cindy symlink view (`19555f3` / `303151a`).

---

## 2026-07-29 Session update (Cindy Vinyl â€” pack merge + no-touch Cindy)

Latest commit: `19555f3` â€” Folder-pack merge + Cindy symlink view (skip #recycle)

Latest local/Pi change:
- **Cindy stays read-only** (PrintShelf-style): no retagging / no writes on the NAS.
- Pi-local `cindy-library-view` symlinks MUSIC/JAMAL/CHECKED **minus** `#recycle` for Navidrome.
- `ND_SCANNER_PURGEMISSING=full` clears junk after a full scan.
- Vinyl proxy merges VA weekly packs (same folder, split tags) into one sleeve + full tracklist.
- Hard refresh Vinyl `?v=21` / `:4540`. Rebuild containers after `build-cindy-library-view.sh`.
- After deploy: trigger Navidrome **full scan** so MUSIC/JAMAL appear and recycle drops out.

Previous:
- Cindy Vinyl Technics deck stage.

---

## 2026-07-29 Session update (Cindy Vinyl Jukebox)

Latest commit: *(see log)* â€” Cindy Vinyl Technics deck stage

Latest local/Pi change:
- Mount Cindy **MUSIC + CHECKED + JAMAL** â†’ `/mnt/cindy/*` (`mount-cindy.sh`, boot remount).
- **Navidrome** on `:4533` (indexes ~5.4TB; first scan takes hours).
- **Cindy Vinyl** UI on `:4540` â€” Technics SL-1200 Limited hero (black/gold lounge), spinning label, SPIN/crates.
- Hard refresh `?v=2` / `http://flightdeck.tail7de73e.ts.net:4540`
- Secrets: `jukebox/.env` on Pi only. Creds: `~/.smbcredentials-cindy`.

Previous:
- Mora Kidabah home mount (`bc1acbf`).

Latest commit: `bc1acbf` â€” Mount Mora User Homes/Kidabah for PrintShelf

Latest local/Pi change:
- Mount helper `mount-nas-mora.sh` â†’ `/mnt/nas-mora` (bind of `User Homes/Kidabah`).
- Remount-on-boot includes Mora when `~/.smbcredentials-mora` exists.
- PrintShelf watched folder id `nas-mora` (windows path `\\192.168.4.77\User Homes\Kidabah`).
- Live on Pi: Mora mounted; Folders shows **Mora Kidabah home**.

Previous:
- Pi reboot library wipe guard (`c1b4bf2`).

---

## 2026-07-29 Session update (Pi reboot emptied PrintShelf library)

Latest commit: `c1b4bf2` â€” Guard scan against unmounted /mnt shares

Latest local/Pi change:
- Pi reboot dropped CIFS mounts; Refresh scanned empty `/mnt/*` dirs and marked **all** assets `missing=1`.
- Restored DB (`missing=0` for 4922 assets); remounted Kidabah PC.
- Scanner now **skips unmounted `/mnt`/`/media` roots** and only mark-missing for roots it actually walked.
- Mount helper scripts: `mount-koko-kidabah.sh`, `remount-printshelf-shares.sh`.
- Hard refresh PrintShelf `?v=63`. Backend restart required.

Previous:
- PrintShelf Refresh + select bar (`423db5d`).

---

## 2026-07-28 Session update (Ooshies stand v2)

Latest commit: `f9fed68` â€” Retune Ooshies stand to ~218Ã—93Ã—244 + photo look

Latest local/Pi change:
- MakerDeck **b576**: proportions from peg-scaled reference STL; deep base tongue, side pills, 7 uppers.
- Hard refresh MakerDeck `?v=576`.

Previous:
- Ooshies stand v1 (`c695f73`).

---

## 2026-07-28 Session update (Ooshies stand)

Latest commit: `c695f73` â€” MakerDeck Ooshies stand (tab-slot kit, 52mm figure clearance)

Latest local/Pi change:
- New MakerDeck preset **Ooshies stand** â€” pegs 6.5Ã—10, gap for 40â€“50 mm figures, sides+shelves kit export.
- Hard refresh MakerDeck `?v=575` / **b575**.

Previous:
- Real RAR unpack + kit cards (`651cef1`).

---

## 2026-07-28 Session update (real RAR unpack + kit cards)

Latest commit: `651cef1` â€” Prefer 7zz for RAR; reject 0-byte stubs; one kit card under PrintShelf Extracted

Latest local/Pi change:
- Debian `7z` left empty STL shells (â€œUnsupported Methodâ€). Now prefers `~/bin/7zz` (full RAR codecs).
- Empty stubs are purged / never counted as success; re-extract rewrites them.
- Multi-file kits under `PrintShelf Extracted/<kit>/â€¦` group into **one** design card.
- Hard refresh `?v=61`. Restart required. Re-run Extract all on Art Guy zips after deploy.

Previous:
- Search clears type filter (`d1d4524`).

---

## 2026-07-28 Session update (search clears type filter)

Latest commit: `d1d4524` â€” Clear ZIP/type tab when searching or after extract

Latest local/Pi change:
- Searching no longer stays stuck on the ZIP tab (which hid rescued STLs).
- Extract / Extract all clears the type filter so new designs show up.
- Hard refresh `?v=60`. Try search `Champion` or `Diorama`.

Previous:
- Extract all / RAR (`fc6fc3e`).

---

## 2026-07-28 Session update (extract all / RAR)

Latest commit: `fc6fc3e` â€” Extract all printables (unpack nested RAR via 7z)

Latest local/Pi change:
- ZIP **Extract all** rescues every printable; if the zip only wraps a `.rar`, streams it out and unpacks with Pi `7z`, then indexes meshes.
- Test case: `3D Art Guy-â€¦002.zip` â†’ nested Crusader Diorama `.rar`.
- Hard refresh `?v=59`. Restart required. Big RARs can take minutes.

Previous:
- Open zip on PC (`e0f30ea`).

---

## 2026-07-28 Session update (open zip on PC)

Latest commit: `e0f30ea` â€” Card â‹® menu + Open zip on PC / Reveal in Explorer

Latest local/Pi change:
- Design/asset cards: **â‹®** menu â€” Open in PrintShelf, Open zip on PC, Reveal in Explorer.
- Detail: **Open zip on PC** + â‹® More. Double-click still opens in shelf.
- Needs **Windows Flightdeck worker restarted** (new `/api/slicer/worker/shell-open`).
- Hard refresh PrintShelf `?v=58`. Restart Pi Flightdeck + PrintShelf.

Previous:
- RAR extract UX (`27c6b64`).

---

## 2026-07-28 Session update (extract UX)

Latest commit: `27c6b64` â€” Explain RAR-only / empty zips on Extract

Latest local/Pi change:
- Extract button always clickable; toast explains when zip has only a `.rar` / no printables.
- Hard refresh `?v=57`.

Previous:
- Sticky extract toast (`41aefb8`). Zip extract (`be0001b`).

---

## 2026-07-28 Session update (zip extract)

Latest commit: `be0001b` â€” Zip extract â†’ PrintShelf Extracted design card

Latest local/Pi change:
- ZIP detail **Extract to shelf** rescues the selected printable into `/mnt/koko-kidabah/PrintShelf Extracted`, indexes it, opens the new design card.
- Nested `Outer.zip/inner.stl` supported. Zip stays put.
- Hard refresh `?v=55`. Restart required.

Previous:
- Design grouping / stem titles (`77d4216` / `a22b9da`).

---

## 2026-07-28 Session update (design grouping)

Latest commit: `a22b9da` â€” Design cards use stem names

Latest local/Pi change:
- Library **Designs** tab groups STL/3MF/gcode siblings (same folder + stem).
- Detail lists files in the design; Print/Slicer still per asset.
- Card titles use the file stem (not parent folder like `H2D`).
- Hard refresh `?v=54`. Restart required. Re-run `regroup-designs.py` to refresh names.

Previous:
- group_key migrate fix (`41da9d7`). Design grouping (`fec980d`).

---

## 2026-07-27 Session update (delete copies)

Latest commit: `213e056` â€” Warn / delete identical NAS copies

Latest local/Pi change:
- Delete **does** remove from NAS (verified). Files â€œcoming backâ€ were usually **duplicate copies** in other folders.
- Delete flow now detects identical content-hash copies and offers **Delete all copies**.
- Hard refresh `?v=46`. Restart required.

Previous today:
- Kidabah PC mount. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (Kidabah PC mount)

Latest commit: `f8f18af` â€” (ops) Mount Kidabah PC Desktop/Downloads/Documents

Latest local/Pi change:
- Windows share `PrintShelfRoots` â†’ junctions to Desktop/Downloads/Documents.
- Pi mount `/mnt/kidabah-pc` (CIFS via `printshelf-pi` account); PrintShelf watched folder **Kidabah PC**.
- Remount `@reboot` via `/home/flightdeck/bin/mount-kidabah-pc.sh`. PC must be on for scan/orbit of those files.
- Hard refresh Folders; Rescan.

Previous today:
- Watched-folder path warnings (`a8c235b`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (watched folder Pi paths)

Latest commit: `a8c235b` â€” Warn when watched folder path missing on Pi

Latest local/Pi change:
- Downloads wasnâ€™t scanning: Pi path was `C:\Users\â€¦` (Windows). PrintShelf only walks Linux mounts.
- Folders UI shows **missing on Pi** + blocks adding Windows paths as Pi paths.
- Hard refresh `?v=45`. Restart required.

Previous today:
- Shared ZIP thumb (`66dcd18`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (shared ZIP thumb)

Latest commit: `66dcd18` â€” Don't delete shared ZIP thumb on asset delete

Latest local/Pi change:
- ZIP icons vanished because deleting any ZIP unlinked `_shared_zip2.png` (shared by all cards).
- Regenerated on Pi; delete skips shared thumbs; thumb GET auto-recreates if missing.
- Hard refresh `?v=44`. Restart required.

Previous today:
- ASCII STL orbit (`a278b81`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (ASCII STL orbit)

Latest commit: `a278b81` â€” PrintShelf orbit ASCII STL again

Latest local/Pi change:
- Fake-STL harden broke **ASCII** meshes (e.g. `Vase_01_SMALL.stl`): binary-only preview + viewer header check.
- Preview converts/serves ASCII; viewer skips binary count check when file looks like `solid`+`facet`.
- Hard refresh `?v=43`. Restart required.

Previous today:
- PNG-as-STL junk (`7a2caf4`); G-code indexing. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (fake STL previews)

Latest commit: `7a2caf4` â€” Skip Thingiverse PNG-as-STL junk

Latest local/Pi change:
- Orbit crash `Invalid typed array length` was **PNG card previews** with `.stl` names (e.g. `card_preview_*.stl`).
- Scanner skips / purges them; preview API no longer serves raw fakes; viewer guards image magic.
- Hard refresh `?v=42`. Restart + purge (scan or SQL) required.

Previous today:
- G-code indexing (`3fbf996`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (G-code indexing)

Latest commit: `3fbf996` â€” PrintShelf index `.gcode` / `.gco`

Latest local/Pi change:
- **Why Baby Doll G-code was missing:** scanner only knew STL/OBJ/3MF/ZIP, and live `ignore_globs` had `**/*.gcode`.
- Now indexes `.gcode` + `.gco` as kind `gcode` (Cura + PrusaSlicer headers, Prusa thumbs).
- New **G-code** type tab. Hard refresh `?v=41`. Restart + rescan required.
- Remove `**/*.gcode` from Pi `printshelf/config.json` ignore list on deploy.

Previous today:
- Manifold hole-fill (`4703ae6`); slicer handoff. Archives in `docs/archive/`.

---

## 2026-07-27 Session update

Latest commit: `4703ae6` â€” PrintShelf fill tiny manifold holes

Latest local/Pi change:
- Manifold sanitize now **caps small open-edge loops** after weld/peel.
- Part_37: **98 â†’ 0 open edges** âœ“
- Hard refresh `?v=40`. Restart done.

Previous today:
- Manifold check (`84d3e86`); Bambu/Orca choice. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (folder browse)

Latest commit: `0216556` â€” PrintShelf folder browse

Latest local/Pi change:
- Library **Folders** mode (default): watched roots â†’ nested folders â†’ files, with breadcrumbs.
- **All files** still available for the flat grid. Search forces flat results.
- Hard refresh `?v=17`. Restart required.

Previous today:
- ZIP orbit + thumb fix (`97fd1e5`); 3MF orbit; multi-select. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (ZIP orbit)

Latest commit: `97fd1e5` â€” ZIP orbit + broken thumb fix

Latest local/Pi change:
- **ZIP orbit**: click a printable inside a zip â†’ loads in the detail viewer.
- Grid no longer shows broken black thumbs (missing files resolved / onerror fallback). Hit **Rebuild thumbs** for Dryad etc.
- Hard refresh `?v=16`. Restart required.

Previous today:
- 3MF orbit (`79e1ae5`); multi-select; ZIP index. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (3MF orbit)

Latest commit: `79e1ae5` â€” PrintShelf 3MF orbit + mesh thumbs

Latest local/Pi change:
- **3MF orbit** in the detail viewer (extract mesh â†’ preview STL). Works for model 3MFs; profile-only packs still wonâ€™t orbit.
- Mesh thumbs (`3mf2`) when embedded preview missing/too dark. **Rebuild thumbs** for nicer 3MF cards.
- Hard refresh `?v=15`. Restart required.

Previous today:
- Multi-select (`8a46c8f`); ZIP; hide/delete. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (multi-select)

Latest commit: `8a46c8f` â€” PrintShelf multi-select bulk hide/delete

Latest local/Pi change:
- **Multi-select** cards (checkbox / Ctrl-click) + bulk bar: Select all visible, Hide, Unhide, Delete from disk.
- Hard refresh `?v=14`. Restart `printshelf.service` required.

Previous today:
- ZIP category (`49db5d7`); hide/delete; orbit. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (ZIP)

Latest commit: `49db5d7` â€” PrintShelf ZIP category

Latest local/Pi change:
- Index **`.zip`** archives (contents list + printable counts inside; no extract).
- New **ZIP** type tab. Hard refresh `?v=13`. Restart + **Rescan** required for thousands of zips.

Previous today:
- Hide/delete (`522ba7d` / `b558494`); orbit; type tabs; PWA. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (hide/delete)

Latest commit: `b558494` â€” PrintShelf hide/delete + localhost bind for Tailscale

Latest local/Pi change:
- **Hide from library** (stays on disk, survives rescan) + **Delete from disk** (confirm Ã—2; removes file + indexed sidecars).
- **Show hidden** filter + Unhide. DB column `assets.hidden`.
- Service binds `127.0.0.1:8100` (Tailscale HTTPS owns public `:8100`). Use `https://flightdeck.tail7de73e.ts.net:8100`.
- Hard refresh `app.js?v=12`. Restart done.

Previous today:
- Denser orbit previews (`b54b62e`); type tabs; PWA. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (orbit density)

Latest commit: `b54b62e` â€” denser PrintShelf orbit previews + Higher detail

Latest local/Pi change:
- Orbit preview default raised to **400k** tris (was 180k); **Higher detail** toggle â†’ **750k**.
- Hard refresh `app.js?v=11` / `viewer.js?v=11`. Restart `printshelf.service` required.

Previous today:
- Library type tabs (`f1bb170`); PWA (`ac66be8`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (type tabs)

Latest commit: `f1bb170` â€” PrintShelf library type tabs

Latest local/Pi change:
- Library **type tabs** (All / STL / 3MF / Gcode 3MF / OBJ) with counts; replaced the type dropdown.
- Hard refresh PrintShelf `app.js?v=10` / `style.css?v=10`. Restart optional (static).

Previous today:
- PrintShelf **PWA** install (`ac66be8`); Tailscale HTTPS `:8100`. Archives in `docs/archive/`.

---

## 2026-07-27 Session update (PWA)

Latest commit: `ac66be8` â€” PrintShelf PWA install (same as Flightdeck)

Latest local/Pi change:
- PrintShelf **PWA**: `manifest.json` + minimal `sw.js`, brand icons, Install as app.
- Tailscale Serve HTTPS on port **8100** â†’ `https://flightdeck.tail7de73e.ts.net:8100`
- Hard refresh `app.js?v=9` / `style.css?v=9` / `viewer.js?v=9`. Restart `printshelf.service` required.
- Optional Windows shortcut: `printshelf/scripts/create-desktop-shortcut.ps1`

Previous today:
- Detail pane **3D orbit viewer** for STL/OBJ (`cc8f20b`). Archives in `docs/archive/`.

---

## 2026-07-27 Session update (orbit viewer)

Latest commit: `cc8f20b` â€” PrintShelf orbit viewer for STL/OBJ

Latest local/Pi change:
- Detail pane **3D orbit viewer** (Three.js) for STL/OBJ via `/api/assets/{id}/model` (decimated ~180k tris when huge).
- 3MF stays thumbnail-only for now.
- Hard refresh PrintShelf `app.js?v=8` / `style.css?v=8` / `viewer.js?v=8`. Restart `printshelf.service` required.

Previous (2026-07-26):
- Ignore / purge `*_temp.obj`; mesh-only OBJ thumbs (`obj4`). Archives in `docs/archive/`.

---

## 2026-07-26 Session update

Latest commit: `9ad2f21` â€” filter temp OBJ + unique mesh thumbs

Latest local/Pi change:
- Ignore / purge `*_temp.obj` junk from the library.
- OBJ thumbs are **mesh-only** (no shared folder texture) â†’ `obj4`; hard refresh `app.js?v=7` + Rebuild thumbs.

Previous:
- Z-up orientation; STL5; thumb rebuild. Archives in `docs/archive/`.

---

## 2026-07-25 Session update

Latest local/static change:
- MakerDeck **b574** â€” Brush/nozzle size sliders are logarithmic (fine control at small sizes; no tinyâ†’huge jumps).
- Hard refresh Painter build **b574**. No backend restart required.
- MakerDeck session notes â†’ [`makerforge/SESSION_NEXT.md`](makerforge/SESSION_NEXT.md)

Previous local/static change:
- MakerDeck **b573** â€” Freehand brush stops on mouse-up; much less drag lag (live tint, fewer dabs/move).
- Hard refresh Painter `painter.js?v=573`. No backend restart required.

Previous local/static change:
- MakerDeck **b572** â€” Fixed Smart fill sprawl: classic facing-patch default (Wrap off, 40Â°); Wrap uses surface path so pillars donâ€™t get air-jumped.
- Hard refresh Painter `painter.js?v=572`. No backend restart required.

Previous local/static change:
- MakerDeck **b571** â€” Rebuilt STL Painter paint core: hide-as-hard-mask, clean hold-to-paint strokes, Smart fill masked, Clean Edge select-then-Fill/Clear.
- Hard refresh Painter `painter.js?v=571`. No backend restart required.

Older local/static change:
- MakerDeck **b570** â€” Edit shelf **Slot base** from solid/no-slot down to a **0.2 mm** floor (never a through-hole).
- Hard refresh MakerDeck `app.js?v=570` / `style.css?v=570`. No backend restart required.

Previous local/static change:
- MakerDeck **b569** â€” Edit shelf **Shelf length** max raised from 120 mm to **200 mm** (slider + geometry clamp).
- Hard refresh MakerDeck `app.js?v=569` / `style.css?v=569`. No backend restart required.

---

## 2026-07-24 Session update

Latest local/static change:
- Print History amber **Weigh** no longer asks "Was this the only spool actually used?" for multi-spool prints; it reconciles only the selected row so the remaining spool rows can still be weighed one by one.
- Static cache bumped to `app.js?v=650`; frontend refresh required.

Previous local/static change:
- Dymo scale reads now prefer `/dev/hidraw*`, poll up to 1.5s for the next scale report instead of sampling instantly, and accept a small 2g stability band. Raw report `03 04 02 00 00 01` maps to ~256g, proving the active-report path.
- Backend restart required after pull.

Older local/static change:
- Print History **Weigh** now sends a best-effort `/api/scale/keep-awake` before `/api/scale/read`, and "No non-zero scale reading" now tells the user to put the spool on, wake/tare the scale, and retry.
- Static cache bumped to `app.js?v=649`; frontend refresh required.

Older local/static change:
- Dymo scale reads now use non-blocking HID reads instead of a blocking `read(16)`, so missing/no-report states can fail quickly instead of hanging until the 12s API timeout.
- Backend restart required after pull.

Older local/static change:
- Print History amber **Weigh** now performs an explicit `/api/scale/read` first, validates the gross grams, then posts that `reading_g` into reconcile. This avoids the Weigh button sitting at `...` while reconcile owns the scale read.
- Static cache bumped to `app.js?v=648`; frontend refresh required. Backend already supports the passed `reading_g`.

Older local/static change:
- Scale-backed weigh/reconcile reads now run off the async event loop with a 12s timeout, so a stuck scale read can fail the weigh action without freezing all Flightdeck routes.
- Backend restart required after pull.

Older local/static change:
- Print History amber **Weigh** now opens a scale-read confirmation first, skips the manual starting-weight prompt, and then preserves the existing multi-spool "only spool used?" confirm/cancel behavior.
- Static cache bumped to `app.js?v=647`; frontend refresh only.

Older local/static change:
- Print History amber **Weigh** actions now use the scale-backed reconcile path instead of asking for remaining grams manually.
- Because the backend has the spool id, it uses that spool's `empty_spool_weight_g` or matching material/brand tare fallback, reads the gross scale weight, and stores remaining filament grams after subtracting tare.
- Plain **Reconcile** still allows manual remaining-filament entry for non-suggested rows or no-scale situations.
- Static cache bumped to `app.js?v=646`; frontend refresh only.

Older local/static change:
- Print History spool usage rows now show **Expected remaining Xg** under the deducted/used grams when `remaining_after_g` is available.
- This makes low-stock weigh-in hints explain themselves without changing deduction, reconcile, or correction logic.
- Static cache bumped to `app.js?v=645`; frontend refresh only.

---



