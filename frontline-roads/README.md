# FRONTLINE ROADS — modular source v0.33.1 tab resume recovery

## Tab resume and boot recovery v0.33.1

- Returning from another browser tab no longer depends on an unbounded network-first module request. Versioned application assets are served from the installed cache immediately and refreshed in the background.
- Navigation and asset network requests have explicit timeouts, so a suspended Android network request cannot leave the page permanently at `BOOT`.
- Visibility, freeze, pagehide, BFCache pageshow and discarded-tab restoration share one save/pause/resume path. Established games restore the playing HUD instead of exposing the initial-base overlay.
- A boot watchdog presents a reload action after a bounded wait without deleting the save.

Implementation and verification are documented in `docs/tab-resume-recovery-v0.33.1.md`.

## Civilization road federation v0.33.0

- Civilization progression now continues through levels 5–7: Steel Citadel, Machine City and Road Federation. Level 7 removes both major-base and field-base placement limits while construction reach remains bounded at 345m and 255m.
- Steel and mechanism resources, six settlement facilities, complete defense tiers through Tier 7, and field-barracks upgrades through Tier 7 are integrated into production, storage, progression, construction and save restoration.
- Engineer, artillery and command squads extend late-game operations. Territory expansion is unlimited at level 7, but global command capacity remains capped at 40 active squads to preserve tactical control and runtime stability.
- Enemy generations 5–7, enemy-base levels through 8, and steel, machine and command-fortress bases create denser late fronts. A carried wave clock launches at most one wave per update, preventing load or promotion backlogs from appearing simultaneously.
- Facility descriptions now use one canonical role/summary/effect/placement definition. Missing descriptions, gate/barrier wording collisions and duplicated detail paragraphs are covered by structural tests.
- A nine-scenario production combat harness validates underbuilt, standard and fortified level 5–7 defenses on a ten-front road network. Standard level 7 sustains a 525-moving-enemy peak without city defeat.

Implementation and verification are documented in `docs/civilization-road-federation-v0.33.0.md` and `docs/playtest-civilization-v0.33.0.json`.

## HUD camera placement and balance validation v0.32.12

- Gameplay zoom and focus controls now live in the HUD grid instead of floating over the tactical map. The compact row cannot cover the context panel, construction descriptions, action buttons, or the facility carousel.
- Portrait, wider and landscape layouts place the controls beside the base summary without absolute positioning, so they consume no separate map-overlay area.
- A production-system playtest harness runs seven ten-minute civilization pressure scenarios covering standard, underbuilt, and fortified defenses. It records moving enemy population, city durability, destroyed defenses, automatic repairs, wave count, and simulation cost.
- The current dense-front settings are retained: standard civilization level 4 survives a 322-enemy peak with four facility losses, while an underbuilt level 4 city is defeated. A fortified layout reduces losses to two while retaining a 296-enemy peak.

Implementation and results are documented in `docs/hud-camera-balance-v0.32.12.md` and `docs/playtest-balance-v0.32.12.json`.

## Dense-front performance v0.32.11

- Standard and power-saving rendering batch enemy markers, cache the complete combat layer between simulation changes, suppress per-unit rings in dense scenes, and limit visible enemy health bars. Static roads and radar framing remain separately cached.
- HUD refreshes reuse one detached road-graph snapshot instead of cloning the full map for every panel. Automatic survey polling no longer opens a full transactional world clone every half second when no survey work is due.
- Regional combat classification computes base/player anchors once per assignment pass, reuses the first spatial snapshot, and skips empty regional updates. Threat ranking keeps only the top eight candidates without sorting the full enemy population.
- Civilization now increases actual battlefield population, wave size, launch cadence, and departure density. Enemy caps progress through 220/320/440/580/720 from civilization level 0 through 4, while the generation grace period delays the next density tier.
- Civilization level 0 retains its existing wave size and interval so the opening balance is unchanged.

Implementation, benchmark data and verification are documented in `docs/dense-front-performance-v0.32.11.md`.

## Modal display recovery v0.32.10

- Radar quality changes no longer apply `backdrop-filter`, `filter`, clipping, or opacity rules to full-screen command panels. This prevents Android Chromium from rendering only the dark overlay while hiding the menu or civilization card.
- The mobile quality sequence now advances from power-saving to standard to high-detail instead of jumping directly from power-saving to the most expensive profile.
- Menu, civilization, base command, and deployment panels can always be closed by tapping the dark backdrop or pressing Escape. Visibility changes also keep `aria-hidden` synchronized.
- Malformed and cross-coupled legacy CSS selector lists were removed so radar rendering preferences affect radar decoration only, not interactive DOM panels.

Implementation and verification are documented in `docs/modal-display-recovery-v0.32.10.md`.

## Construction range, intercept and camera controls v0.32.9

- Civilization build ranges now use bounded level tables instead of exponential doubling. Major bases progress through 85/120/160/205/255m and field bases through 50/75/105/140/180m. Player and expedition mobile ranges remain fixed at 85m and 120m.
- Tapping an active enemy-unit marker exposes direct dispatch. The selected enemy ID becomes a moving intercept mission; the squad replans toward the enemy's next road node and automatically returns after the target is destroyed or lost.
- The normal gameplay HUD now has independent zoom controls plus instant focus buttons for the currently selected base and the player's current position.
- Range labels in base command and placement guidance read the same canonical range definitions used by gameplay. Obsolete exponential multiplier fields were removed.

Implementation and verification are documented in `docs/construction-intercept-camera-v0.32.9.md`.

## Road acquisition completeness v0.32.8

This release makes road acquisition lossless for supported road classes. It adds motorway and trunk roads, preserves disconnected major roads and separate carriageways, retains sparse roads across chunk boundaries, and refreshes road regions created by older acquisition specifications.

The initial map, player frontier expansion, and survey facilities use the same road classification and parsing pipeline. OSM source node and way identities are retained through chunk merging and compact save encoding so overlapping acquisitions do not erase or duplicate roads.

Implementation and verification are documented in `docs/road-acquisition-completeness-v0.32.8.md`.
