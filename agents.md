# Pinball Roulette Agent Handoff

Last updated: 2026-06-11

This file is the required handoff source for Codex, Claude, and any other agent or PC continuing this project. Read this before changing code.

## Update Rule

- Every meaningful code or behavior change must update this `agents.md` file in the same turn.
- Add the new change to `Recent Updates`, adjust `Current State`, and update `Open Tasks` if the task list changes.
- Never leave this file stale after changing generation logic, physics, UI, map saving/loading, or validation rules.

## Project

- Local app URL: `http://localhost:3000/`
- Stack: Vinext/Next-style React app, TypeScript, canvas rendering.
- Main game file: `app/pinball-roulette.tsx`
- Custom map editor: `app/custom-map-builder.tsx`
- Styles: `app/globals.css`
- GitHub Pages SPA entry: `spa/main.tsx` and `spa/index.html`
- GitHub Pages Vite config: `vite.github-pages.config.ts`
- Sites preview image: `public/screenshot.jpeg`
- Package scripts:
  - `npm run lint`
  - `npm run build`
  - `npm run build:gh-pages`
  - `npm run preview:gh-pages`
  - `npm run dev`

## User Goal

Build a vertical pinball roulette game similar to `https://lazygyu.github.io/roulette/`, but with random/saveable maps, custom maps, player-name balls, ranking, recording, shuffled starts, and safer obstacle/path generation.

Players are counted by comma-separated non-empty names only. Example: `나, 하나, 둘` means 3 players. Empty comma slots must not create players.

## Current State

- Board is tall and vertical: `BOARD_WIDTH = 430`; generated map height is dynamic by complexity.
- Balls start at the same height and are shuffled horizontally.
- Generated maps store `path?: PathNode[]` and balls are constrained inside the path.
- Random maps include zigzag/funnel/chambers/split/cascade/chaos structures.
- Generated paths become more curved as complexity increases; complexity 4-5 use more control points, stronger bends, and wider lanes.
- Zigzag maps add route-safe centerline deflector pins so balls cannot take a pure straight drop through the route.
- Non-zigzag generated maps add route-safe anti-straight deflector pins at separated route positions.
- Generated maps reserve and preserve at least one rotating booster, including maps created through `랜덤 생성`.
- Complexity 4-5 generated maps add protected left/right rotating side bars before the finish line while keeping the central finish drop lane open.
- Generated obstacle counts increase by complexity, while each candidate is distributed along the route and must pass route-clearance checks before it is kept.
- The `랜덤 생성` button keeps the currently selected complexity and only randomizes the generated structure/seed.
- Split islands may create branches, but must keep both lanes wider than the ball.
- Ranking is shown in the right side panel, not the top-right area.
- Winner condition supports `First`, `Last`, and winner count.
- Recording support exists through `canvas.captureStream` and `MediaRecorder`.
- Start order can be shuffled.
- During a run, the board viewport auto-follows the leading falling balls so the screen descends with the action.
- Balls receive path-flow velocity toward the upcoming generated route center so curved paths produce lateral movement instead of pure vertical drops.
- Multiplayer races use velocity-only race pressure, drafting, turbulence, breakaway drag, and trailing progress floors to create repeated rank reversals without relocating balls.
- Finish line is drawn at the bottom with `getFinishLineY(boardHeight)`.
- The right side panel has a local feedback area for future feature/map ideas.
- Custom map page exists at `/custom`.
- Custom map builder treats drawn walls as editable route boundary walls and derives saved `path` metadata from left/right wall intersections.
- Custom map builder tolerates small boundary-wall endpoint/sample gaps, snaps circular obstacles to the nearest safe same-height in-path position, and shows minimum save conditions in the right status panel.
- Custom map builder has a separate `내부 벽` tool for in-path divider/island geometry. Boundary walls still define the outer route, while internal walls are stored in `walls` with an `inner-wall-*` id prefix, drawn in yellow, and ignored when deriving the outer `path`.
- Custom map builder can edit saved custom maps. The game saved-map list shows a `수정` link for custom maps, `/custom?edit=<id>` auto-loads that map, local edits overwrite the existing local record, and D1 edits use `PUT /api/maps/:id`.
- Custom map route width rules are split: a passage only needs `MIN_CUSTOM_PASSAGE_WIDTH = 35` to be valid, but pins/bumpers/exploders/rotating bars require `MIN_CUSTOM_OBSTACLE_PATH_WIDTH = BALL_RADIUS * 2 + 76`.
- Custom rotating bars may be attached to a boundary wall only when the sampled route width is at least `MIN_WALL_ATTACHED_BOOSTER_PATH_WIDTH = BALL_RADIUS * 2 + 108`; finish-lane and open-route validation still apply.
- GitHub Pages static SPA build exists and outputs to `dist/github-pages`.
- The static SPA uses hash routing (`#/custom`) and localStorage-only map saves.
- Local `GET /api/maps` returns `{ maps: [] }` with HTTP 200 when the local D1 binding/table is unavailable, avoiding console noise while preserving the API path.

## Mandatory Rules

- Do not randomly relocate balls as a stuck fix. The user explicitly forbids arbitrary ball repositioning.
- Prevent stuck states by map generation, obstacle spacing, route clearance, and physics behavior only.
- Balls must not leave the path on generated maps.
- Start height must be identical for all balls.
- The map must remain vertical and progress downward.
- A generated path must not be blocked by internal single bars. Internal walls must form meaningful branch/new-path structures, not dead blockers.
- Do not create decorative/outside wall bars outside the playable route. Walls should be path boundaries, valid internal branch geometry, or in-path finish funnel geometry only.
- Obstacles must be inside the path, but not so close to walls that a ball can be trapped.
- If a branch/split island is generated, the gap between the branch geometry and outer path walls must be larger than the ball.
- The finish zone must always have an open central drop lane to the finish line.
- Obstacle components must not be too close together.
- Bumpers must not create long bounce loops. Consecutive bumper hits should help the ball continue downward.
- Any saved old map loaded into the game should be sanitized by current safety rules.
- Use `apply_patch` for manual file edits.
- Do not use destructive git commands.
- Keep the GitHub Pages target separate from the Vinext/Cloudflare build; do not remove `/api/maps` unless the user explicitly changes deployment strategy.

## Important Implementation Notes

- `BALL_RADIUS = 10`
- `ROUTE_CLEARANCE = BALL_RADIUS + 10`
- `WALL_TRAP_CLEARANCE = BALL_RADIUS * 2 + 18`
- `BUMPER_WALL_CLEARANCE = BALL_RADIUS * 2 + 20`
- `MIN_OBSTACLE_GAP = 64`
- `getObstacleGap(complexity)` relaxes obstacle spacing gradually at higher complexity while preserving route checks.
- `MIN_BRANCH_LANE_WIDTH = BALL_RADIUS * 2 + 44`
- `MIN_INTERNAL_WALL_LANE_WIDTH = BALL_RADIUS * 2 + 44` in the custom builder requires internal divider/island walls to leave ball-sized left/right lanes inside the outer path.
- `MIN_CUSTOM_PASSAGE_WIDTH = 35` lets narrow custom routes save when a ball can pass.
- `CUSTOM_ROUTE_CLEARANCE = BALL_RADIUS + 4` is used by custom-builder open-route and finish-lane checks so 35px passages validate without lowering obstacle placement rules.
- `MIN_CUSTOM_OBSTACLE_PATH_WIDTH = BALL_RADIUS * 2 + 76` is required before custom pins, bumpers, exploders, or rotating bars can be placed.
- `MIN_WALL_ATTACHED_BOOSTER_PATH_WIDTH = BALL_RADIUS * 2 + 108` is required before custom rotating bars can touch a route boundary wall.
- `DEFAULT_BOARD_HEIGHT = 1420`
- `MAX_PATH_HORIZONTAL_STEP = 76` limits random path point side-to-side movement so generated walls do not create bounce-back pockets.
- `MAX_HIGH_COMPLEXITY_PATH_STEP = 88` lets higher-complexity paths use stronger side-to-side curves while keeping per-segment movement capped.
- Generated board height currently uses `getGeneratedBoardHeight(complexity) = 1180 + level * 150`.
- `MapLayout.height` stores the generated board height.
- Finish positions are dynamic through `getFinishLineY(boardHeight)` and `getFinishClearStartY(boardHeight)`.
- `FINISH_DROP_CLEARANCE = BALL_RADIUS + 8`
- Current fall tuning: `gravity = 0.18`, `maxFallSpeed = 5.7`, `maxRiseSpeed = -11.1`.
- Path-flow tuning: `PATH_FLOW_ACCEL = 0.0032`, capped by `PATH_FLOW_MAX_ACCEL = 0.16`.
- Race-pressure tuning: `RACE_DRAFT_GAP = 120`, `RACE_DRAFT_ACCEL = 0.2`, `RACE_DRAFT_SPEED_BONUS = 4.2`, `RACE_LEADER_DRAG = 0.18`, `RACE_LEADER_BREAKAWAY_DRAG = 0.22`, and `RACE_TRAILING_PROGRESS_FLOOR = 4.3`.
- Strict simulation gates are available through `npm run simulate -- --min-overtakes=3 --min-lateral-travel=24 --overtake-sample-frames=6 ...`.

Safety helpers in `app/pinball-roulette.tsx`:

- `hasOpenRoute(...)`: checks whether a ball-sized route exists through walls and obstacles.
- `routeIsOpen(...)`
- `makeObstaclesRouteSafe(...)`: prunes unsafe obstacle combinations while preserving route-safe zigzag deflector pins during narrow-path pruning.
- `isCircleClearOfWalls(...)`: prevents pins/bumpers/exploders from being placed too close to walls.
- `isBoosterClearOfWalls(...)`: checks rotating booster sweep clearance from walls.
- `isProtectedBooster(...)`: preserves required boosters and finish-side boosters during route-safety pruning.
- `addRequiredBooster(...)`: reserves an early required rotating booster before ordinary obstacle placement.
- `ensureRequiredBoosterAfterPrune(...)`: restores a short required rotating booster after safety pruning if all boosters were removed, pruning nearby circular obstacles when necessary.
- `addFinishSideBoosters(...)`: adds finish-side rotating bars on complexity 4-5 maps.
- `ensureFinishSideBoostersAfterPrune(...)`: restores missing finish-side bars after safety pruning, using shorter fallback bars when side lanes are tight.
- `pickDistributedPathPoint(...)`: spreads obstacle candidates through the full vertical route so higher obstacle counts do not cluster into traps.
- `hasBumperLaneSpace(...)`: prevents bumper chains in the same lane.
- `addZigzagDeflectorPins(...)`: adds one or two centerline pins to zigzag maps before other obstacles so direct vertical drops must deflect at least once. If the coarse route checker cannot prove the base zigzag route is open, placement falls back to path/wall clearance checks to avoid skipping the deflector on validator false negatives.
- `addRouteDeflectorPins(...)`: adds route-safe anti-straight pins to non-zigzag generated maps at separated vertical positions.
- `hasBranchLaneClearance(...)`: prevents split geometry from creating unpassable lanes.
- `blocksFinishDropLane(...)`
- `segmentBlocksFinishDropLane(...)`
- `sanitizeMapLayout(...)`: cleans older saved maps on load.
  It also removes legacy outside finish side walls (`finish-left`, `finish-right`).
- `app/static-spa.ts`: exposes static SPA detection and hash-link conversion.
- `app/app-link.tsx`: shared anchor wrapper used instead of `next/link` so both Vinext and Vite SPA builds work.
- Feedback records are stored in browser `localStorage` under `pinball-roulette-feedback-v1` and capped at 12 recent items.
- `spa/main.tsx`: static-only React entry that switches between game and custom builder by URL hash.
- `vite.github-pages.config.ts`: builds `dist/github-pages`, copies `index.html` to `404.html`, and writes `.nojekyll`.

Custom map helpers in `app/custom-map-builder.tsx`:

- `buildCustomPathFromWalls(...)`: samples drawn boundary walls from top to bottom and derives playable `path` metadata from the outer left/right wall intersections.
  It tolerates small y-sample/endpoint gaps and reports missing/narrow/steep sample counts for the status panel.
- `isInternalWall(...)`: identifies custom internal divider/island walls by `inner-wall-*` ids so those walls collide in-game but do not alter outer route derivation.
- `hasInternalWallLaneClearance(...)`: requires custom internal walls to stay far enough from both outer route boundaries before saving.
- `findCirclePlacementPoint(...)`: snaps pins, bumpers, and exploders to the nearest same-height safe in-path x-position when the click is slightly outside the required wall/path clearance.
- `isCustomBoosterPlacementSafe(...)`: allows custom rotating bars to touch a boundary only in wide-enough lanes while preserving finish-lane and path-inside checks.
- Saved custom maps can be loaded for editing from local storage or D1. Older path-only custom maps are converted back into editable boundary walls with `createBoundaryWallsFromPath(...)`.
- `validateCustomMapForSave(...)`: blocks saving if the custom path is incomplete, too narrow, too sharply bent, has unsafe obstacles, closes the finish drop lane, or lacks an open route.
- The custom builder's `경계벽` tool is for route boundaries. Use `내부 벽` for in-path dividers or closed island/triangle geometry; saving fails if internal walls leave too little lane clearance, block the finish lane, or remove the open top-to-bottom route.

Physics notes:

- Bumper collision tracks `bumperCooldown` and `bumperChain`.
- Bumper contacts always add downward progress velocity and use reduced side kick to avoid wall-bumper loops.
- Pin collisions deflect balls but always restore mild downward progress so dense pin areas cannot create long upward loops.
- Route-deflector pin contacts add a small lateral impulse so centered hits cannot continue as pure vertical drops.
- Path-flow velocity steers balls toward the upcoming path center; this is not relocation and does not move balls directly.
- Race pressure is velocity-only and applies only during multiplayer runs to create catch-up, breakaway drag, trailing progress, and repeated overtakes.
- Wall collisions cap upward rebounds at neutral vertical speed so slower fall tuning does not create long wall-bounce loops.
- There must be no `releaseStuckBall`, `findReleasePoint`, `isReleasePointOpen`, `bestY`, or `stuckTime` anti-stuck relocation logic in the code.

## Recent Updates

- 2026-06-09: Added `npm run simulate` (`scripts/simulate-pinball.cjs`) to run deterministic bulk simulations against the actual map generation and physics functions with 40s limits for complexity 1-2 and 60s limits for complexity 3-5.
- 2026-06-10: Increased generated path curvature by complexity with more path control points, stronger high-level bend strength, wider high-complexity lanes, and capped larger side-to-side steps.
- 2026-06-10: Increased obstacle counts by complexity: more pin clusters, distributed single pins, bumpers, exploders, and boosters are attempted at higher levels, using distributed route positions, complexity-scaled spacing, and existing route-safety checks.
- 2026-06-10: Added centerline deflector pins to zigzag maps, preserved them during obstacle safety pruning, allowed them on route-checker false negatives when path/wall clearance passes, and changed `랜덤 생성` to preserve the selected complexity instead of choosing a new one.
- 2026-06-10: Slowed ball fall speed by reducing gravity to `0.18`, max fall speed to `5.7`, and downward impulse floors from pins, bumpers, boosters, and exploders while keeping downward progress behavior. Wall collisions now cap upward rebound at neutral vertical speed to avoid slow-fall wall loops.
- 2026-06-10: Adjusted run-time board auto-scroll to follow the leading falling balls with an earlier viewport offset and faster interpolation.
- 2026-06-10: Added required rotating-booster reservation and post-prune restoration so generated/random maps always keep at least one `boost-required-*` or regular `boost-*` rotating booster.
- 2026-06-10: Added a right-panel feedback area that stores recent feature/map ideas locally for future implementation planning.
- 2026-06-10: Added protected finish-side rotating bars for complexity 4-5 maps so the final approach can include left/right lane hazards before the finish line without blocking the central drop lane. Finish-side bars now require extra wall clearance (`BALL_RADIUS + 20`) so the rotating sweep does not create wall pockets.
- 2026-06-10: Reworked the custom map builder so users create the guide route by drawing editable boundary walls. The builder now derives the saved path from those walls, previews the derived lane, validates route width/continuity/finish clearance/open route on save, and treats the old guide button as an editable sample boundary generator.
- 2026-06-10: Added strict simulator gates for minimum lateral travel and rank reversals, added route-flow velocity, multiplayer race pressure/drafting/breakaway controls, generic route deflectors for non-zigzag maps, and board-center targeting for first zigzag deflectors so generated maps avoid straight drops and produce repeated overtakes without ball relocation.
- 2026-06-10: Changed local `GET /api/maps` to return an empty map list with HTTP 200 when D1 is unavailable, keeping local rendering console-clean while retaining D1 save behavior for configured deployments.
- 2026-06-10: Improved the custom map builder by tolerating small boundary-wall sampling gaps, snapping circular obstacles to nearby safe in-path positions, and showing minimum path/obstacle conditions beside the route status so users can see why a custom map is not ready.
- 2026-06-11: Added a separate custom-builder `내부 벽` tool for horizontal/diagonal in-path divider and closed island geometry, kept internal walls out of outer path derivation, added internal-wall lane-clearance validation/status text, split boundary/internal wall counts, and rendered internal walls in yellow.
- 2026-06-11: Added saved custom-map editing through game-card `수정` links and `/custom?edit=<id>`, local overwrite saves, and D1 update support through `PUT /api/maps/:id`.
- 2026-06-11: Split custom map width rules so narrow ball-passable routes can save without obstacles, while pins/bumpers/exploders/rotating bars require wider lanes; wide custom lanes now allow rotating bars to attach to boundary walls if finish-lane and open-route checks pass.
- 2026-06-11: Lowered the custom map passage-only minimum width to 35px and added a custom route-clearance value for open-route/finish-lane validation so 35px passages can save while narrow lanes still reject pins, bumpers, exploders, and rotating bars.
- 2026-06-09: Optimized `npm run simulate` by compiling the game module directly instead of using a VM context, and added `--target-balls` for million-scale ball simulation runs.
- 2026-06-09: Changed rotating booster collision from forced upward kicks to downward progress assists so booster loops do not keep balls cycling in the same section.
- 2026-06-09: Added wall-contact damping that limits excessive upward rebounds from path and internal walls without relocating balls.
- 2026-06-09: Replaced the finish gauntlet's trapping pins, kickers, and kinked funnel with low-bounce finish guide rails that preserve the central drop lane.
- 2026-06-09: Changed exploder impulses to create lateral variation while preserving downward progress, preventing repeat blast loops.
- 2026-06-09: Reduced split-island generation for low complexity maps; complexity 1 now generates no split islands and complexity 2 only keeps them for explicit split maps.
- 2026-06-09: Reduced bumper upward kicks and extended bumper-chain memory so bumper contacts turn into downward progress sooner.
- 2026-06-09: Increased wall clearance for circular obstacles and saved-map sanitization to prevent balls wedging between pins/bumpers/exploders and path walls.
- 2026-06-09: Changed bumper contacts to always add downward progress and reduced side kicks to prevent wall-bumper loops in high-player split maps.
- 2026-06-09: Added rotating-booster wall clearance checks using the full sweep radius so boosters cannot trap balls against path walls.
- 2026-06-09: Tightened split-island lane width checks, increased branch sampling density, and removed optional split islands from non-split/non-chaos/non-chambers structures.
- 2026-06-09: Added a larger bumper-specific wall clearance so bumpers cannot form repeat traps against path walls.
- 2026-06-09: Removed the old below-board reset fallback so simulation code contains no arbitrary ball relocation branch.
- 2026-06-09: Added right side ranking panel and removed ranking from top-right.
- 2026-06-09: Made all balls start at the same height.
- 2026-06-09: Added path metadata to generated maps and path confinement for balls.
- 2026-06-09: Added custom map builder page and guide path saving.
- 2026-06-09: Removed internal single-wall blockers from random maps.
- 2026-06-09: Added branch clearance checks so split lanes are passable.
- 2026-06-09: Added bottom `FINISH` line.
- 2026-06-09: Added finish-zone central drop-lane safety.
- 2026-06-09: Increased obstacle spacing and route validation.
- 2026-06-09: Removed arbitrary anti-stuck ball relocation after user explicitly forbade it.
- 2026-06-09: Strengthened pin/bumper/exploder wall-clearance checks and route checks before obstacle placement.
- 2026-06-09: Added bumper-chain physics so repeated bumper hits do not trap balls for a long time.
- 2026-06-09: Created this `agents.md` handoff file and made it mandatory to update on every future behavior/code change.
- 2026-06-09: Added deployment notes for GitHub Pages vs Cloudflare operation.
- 2026-06-09: Made generated map height increase by complexity and wired canvas, finish line, route checks, scrolling, saving, and custom map metadata to dynamic height.
- 2026-06-09: Slowed ball fall speed slightly and removed outside finish side wall bars from new and loaded saved maps.
- 2026-06-09: Increased split branch lane clearance so branch geometry cannot create narrow side pockets that trap balls.
- 2026-06-09: Limited random path point horizontal movement to reduce mid-path bounce-back pockets while keeping the route varied.
- 2026-06-09: Capped upward velocity after pin collisions so dense pin areas deflect balls without trapping them in long loops.
- 2026-06-09: Fixed simulation script lint compatibility without changing simulation behavior.
- 2026-06-09: Added a separate GitHub Pages static SPA build target with hash routing, localStorage-only map saving, `404.html`, and `.nojekyll` output.

## Open Tasks

- Test more random seeds visually, especially complexity 4-5, to ensure maps still have enough fun obstacles after safety pruning.
- Consider adding deterministic generation tests for route safety if the project gets a test framework.
- Consider adding a visible "map safety" debug overlay only for development, not in the user-facing UI.
- Consider adding closed-island grouping/fill previews for custom internal walls so triangle interiors can be visibly shaded as non-playable space.
- If deploying with Sites, refresh `public/screenshot.jpeg` after significant visual changes.

## Deployment Notes

- Current Vinext build creates `dist/client` assets and server/RSC output, but `dist/client` does not currently contain a standalone `index.html` suitable for GitHub Pages.
- GitHub Pages can host this game through `npm run build:gh-pages`.
- GitHub Pages output is `dist/github-pages`.
- GitHub Pages static routing uses URL hashes, so custom map builder is `#/custom`.
- For GitHub Pages, `/api/maps` will not exist. Static mode skips API calls and uses localStorage map saves only; shared server map storage still requires Cloudflare Workers/Pages or a separate API.
- GitHub Pages needs SPA routing support for `/custom`; usually deploy `index.html` plus a copied `404.html`, or use hash routing.
- If the requirement includes shared saved maps, prefer Cloudflare Workers/Pages or keep GitHub Pages as frontend only and call a separate Cloudflare Worker API.
- If implementing GitHub Pages, also add a GitHub Actions workflow that builds the static target and deploys the generated static folder through `actions/upload-pages-artifact` and `actions/deploy-pages`.

## Validation Checklist

Run after behavior or rendering changes:

1. `npm run lint`
2. `npm run build`
3. `npm run simulate -- --target-balls=1000000 --players=1,2,3,5,8,12,20,30,30,30,30,30 --min-overtakes=3 --min-lateral-travel=24 --overtake-sample-frames=6 --fail-fast`
4. Render `http://localhost:3000/` and inspect the board.
5. Check that balls are not arbitrarily relocated.
6. Check that the finish lane is open.
7. Check that obstacles are not placed against walls or clustered into traps.
8. Update `public/screenshot.jpeg` after visual changes.
9. Update this `agents.md`.

## Browser Testing Note

The in-app browser tool has repeatedly failed in this Windows environment with:

`windows sandbox failed: spawn setup refresh`

On 2026-06-10, the Browser plugin skill also could not load because
`scripts/browser-client.mjs` was missing from the enabled Browser plugin folder.
On 2026-06-10, a later Browser runtime attempt failed with `Browser is not available: iab`.
On 2026-06-11, the Browser runtime connected successfully and was used for `/custom` interaction QA.
When the in-app browser is unavailable, continue validation with headless Chrome
screenshots, for example:

```powershell
& 'C:\Program Files\Google\Chrome\Application\chrome.exe' --headless=new --disable-gpu --no-sandbox --disable-application-cache --run-all-compositor-stages-before-draw --virtual-time-budget=5000 --window-size=1440,1800 --screenshot='C:\tmp\pinball-check.png' 'http://localhost:3000/?v=check'
```

Then inspect the generated screenshot and refresh `public/screenshot.jpeg` if the visual state changed.

## Last Validation

- 2026-06-10: `npm run lint`, `npm run build`, and `npm run build:gh-pages` passed.
- 2026-06-10: Verified 10,000 explicit zigzag maps across complexities 1-5; every map kept at least one `pin-zigzag-deflector-*` pin.
- 2026-06-10: Ran `npm run simulate -- --target-balls=1000000 --players=1,2,3,5,8,12,20,30,30,30,30,30 --progress-every=20000 --fail-fast`; passed with `totalBalls=1000007`, `failureCount=0`, and max finish times by complexity: c1 5.20s, c2 7.90s, c3 12.12s, c4 15.13s, c5 18.97s.
- 2026-06-10: Rendered `http://localhost:3000/` through headless Chrome with a 5s virtual-time budget and confirmed the board, balls, path walls, and obstacles draw correctly.
- 2026-06-10: After slowing fall tuning, `npm run lint`, `npm run build`, and `npm run build:gh-pages` passed. A 100,000-ball smoke run passed with `failureCount=0`.
- 2026-06-10: After slowing fall tuning, ran `npm run simulate -- --target-balls=1000000 --players=1,2,3,5,8,12,20,30,30,30,30,30 --progress-every=20000 --fail-fast`; passed with `totalBalls=1000007`, `failureCount=0`, and max finish times by complexity: c1 5.27s, c2 8.47s, c3 10.98s, c4 13.12s, c5 15.85s.
- 2026-06-10: After auto-scroll tuning, `npm run lint`, `npm run build`, and `npm run build:gh-pages` passed. Chrome CDP verified that pressing `시작` moved `.stage-wrap.scrollTop` from `0` to `630` after 7 seconds.
- 2026-06-10: After required-booster tuning, verified 10,000 random maps across complexities 1-5; every map had at least one rotating booster. `npm run lint`, `npm run build`, `npm run build:gh-pages`, and a 100,000-ball simulation passed with `failureCount=0`.
- 2026-06-10: After adding the feedback area, `npm run lint`, `npm run build`, and `npm run build:gh-pages` passed. Chrome CDP verified typing a feedback message, pressing `의견 저장`, rendering the saved card, and writing one record to `pinball-roulette-feedback-v1`.
- 2026-06-10: After adding finish-side rotating bars, verified 2,000 random complexity 4-5 maps; every map had two `boost-finish-side-*` boosters and none blocked the central finish drop lane. `npm run simulate -- --target-balls=100000 --players=1,2,3,5,8,12,20,30,30,30,30,30 --progress-every=5000 --fail-fast` passed with `totalBalls=100015`, `failureCount=0`, and max finish times by complexity: c1 5.12s, c2 7.27s, c3 9.55s, c4 13.53s, c5 14.83s. `npm run lint`, `npm run build`, and `npm run build:gh-pages` passed, and a headless Chrome screenshot confirmed the page/canvas renders.
- 2026-06-10: After the custom boundary-wall builder rework, `npm run lint`, `npm run build`, and `npm run build:gh-pages` passed. A direct custom-builder validation confirmed sample boundary walls derive a ready path with `minWidth=130` and pass `validateCustomMapForSave`; a sample custom map simulation finished 8/8 balls. Headless Chrome rendered `/custom` with the new `경계벽` tool and route status panel.
- 2026-06-10: After route-flow/race-pressure/deflector tuning, `npm run simulate -- --target-balls=1000000 --players=1,2,3,5,8,12,20,30,30,30,30,30 --min-overtakes=3 --min-lateral-travel=24 --overtake-sample-frames=6 --progress-every=20000 --fail-fast` passed with `totalBalls=1000007`, `failureCount=0`, min lateral travel by complexity: c1 55.53px, c2 101.00px, c3 100.42px, c4 135.89px, c5 131.98px; min overtakes by complexity: c1 3, c2 4, c3 5, c4 5, c5 6; and max finish times: c1 5.42s, c2 9.92s, c3 10.55s, c4 13.27s, c5 15.42s.
- 2026-06-10: Final checks after route-flow/race-pressure/API fallback changes: `npm run lint`, `npm run build`, and `npm run build:gh-pages` passed; `GET /api/maps` returned HTTP 200 with an empty local list when D1 was unavailable; headless Chrome rendered `http://localhost:3000/`, captured a screenshot, clicked `시작`, completed a 3-player race, updated rankings, and reported no relevant console warnings/errors.
- 2026-06-11: After adding the custom `내부 벽` tool, `npm run lint`, `npm run build`, and `npm run build:gh-pages` passed. Browser QA rendered `http://localhost:3000/custom`, drew two wide boundary walls and a three-segment triangular internal wall, confirmed status `OK`, minimum width `280`, counts `경계벽 2` and `내부벽 3`, saved the map locally, captured a screenshot, and reported no relevant console warnings/errors.
- 2026-06-11: After adding custom map editing and split width/rotating-bar placement rules, `npm run lint`, `npm run build`, and `npm run build:gh-pages` passed. Direct custom-builder checks confirmed a 50px route saves without obstacles, narrow routes reject pins, and a 160px route accepts a boundary-attached rotating bar. Direct game sanitize checks confirmed that same wall-attached custom rotating bar is preserved while narrow-route pins are removed.
- 2026-06-11: Browser QA saved a sample custom map, confirmed the game saved-map card exposes a `수정` link, opened `/custom?edit=<local-id>`, confirmed edit mode, condition text (`통과폭`, `장애물폭`, wall attachment threshold), and `수정 저장`, then saved over the existing local record with no relevant console warnings/errors.
- 2026-06-11: Ran the strict 1,000,000-ball simulator gate after the custom edit/width-rule change: `npm run simulate -- --target-balls=1000000 --players=1,2,3,5,8,12,20,30,30,30,30,30 --min-overtakes=3 --min-lateral-travel=24 --overtake-sample-frames=6 --progress-every=1000 --fail-fast`; passed with `totalBalls=1000007`, `failureCount=0`, min lateral travel by complexity: c1 55.53px, c2 101.00px, c3 100.42px, c4 135.89px, c5 131.98px; min overtakes by complexity: c1 3, c2 4, c3 5, c4 5, c5 6; and max finish times: c1 5.42s, c2 9.92s, c3 10.55s, c4 13.27s, c5 15.42s.
- 2026-06-11: After lowering custom passage-only width to 35px, direct checks confirmed 34px routes are not ready, 35px routes save without obstacles, 35px routes reject pins, and a 35px straight custom map finished 30/30 simulated balls. Ran 1,000,000 randomized custom width/rotating-bar rule checks; passed with passage threshold 35px, obstacle threshold 96px, wall-attachment threshold 128px, `wallAttachAllowed=494507`, `wallAttachRejectedBelowThreshold=505493`, and no failures.
