# 4-Pass WebGL2 Renderer, Materials & Satin Astrolabe Shaders

On-demand reference for **WebGL2 / Canvas2D rendering**, **Z-layer depth ordering**, **3D block skins & board tray shaders**, **120Hz frame-budget rules**, and the **Title Screen Satin Astrolabe & Relic Awakening FX**. Read this before modifying `src/render/*`, `src/audio/*`, or `src/styles/title-and-a11y.css`.

---

## 1. 4-Pass WebGL2 Pipeline & 120Hz Frame Budget (`<= 6.5ms`)

[`src/render/renderer-3d.ts`](../src/render/renderer-3d.ts) renders each frame in 4 passes (with parity in [`canvas2d-fallback.ts`](../src/render/canvas2d-fallback.ts)):
1. **Pass 1 (`renderPass1Environment` — [`pass1-courtyard.ts`](../src/render/pass1-courtyard.ts), [`pass1-gates-barriers.ts`](../src/render/pass1-gates-barriers.ts))**:
   - Draws the 3-tier **Stepped Architectural Sanctuary Plinth** (`z = -0.50, -0.34, -0.18`). **Row-Span Merging (`plinthSpans`)**: Never issue per-cell `drawMesh` calls for plinths under sculpted (`L14+`) or multi-room (`L25+`) boards; merge contiguous row spans so Pass 1 stays at `~15–24` draw calls.
   - Renders recessed courtyard tiles, stone pillars, elevator rails, generator housings, crates, and perimeter shredder gates (rollers spin at `1.35 rad/s` idle and `18.0 rad/s` only when shredding or aligned with a dragged block; queued color bars; star emblems; **3D Sculpted Frost Medallions `[❄️ N]`** via `drawBadgeMedallion3D`; shutter bars).
2. **Pass 2 (`renderPass2BarriersAndReticles` — [`pass2-barriers-and-reticles.ts`](../src/render/pass2-barriers-and-reticles.ts))**:
   - Draws **3D Sanctuary Portcullis Barriers (`⛩ N`)**, **3D Carved Sanctuary Mystery Vault Lids (`bar.isVault`, `materialStyle = 2`)** with gilded bronze bezels, indigo-violet coffered slabs, horizontal louver ribs, corner bolsters, and `[🔒 N]` medallions (leaving flush `Z = 0.008` brass corner inlays when unsealed), grid shadow reticles, green alignment beams, solver hint chevrons, 3D shockwave rings (`activeShockwaves`), and booster targeting highlights.
3. **Pass 3 (`renderPass3Blocks` — [`pass3-block-shells.ts`](../src/render/pass3-block-shells.ts), [`pass3-block-overlays.ts`](../src/render/pass3-block-overlays.ts))**:
   - Renders unlocked 3D polyomino blocks (skipping concealed `isBlockInSealedVault` blocks/welds), hardware clip-plane shred animations (`u_useClipPlane`), multi-layer inner cores, chamfered 3D circular studs (`addCylinderCapToBuilder`), glued solder bridges, **3D beveled side-flange Axis-Lock rails** (`railBeamMesh` tinted with `entry.lipHex` + champagne cap, leaving top studs 100% uncovered), **sculpted 3D badge medallions** (`drawBadgeMedallion3D`), **hollow 3D move-guide frames** (`drawHollowMoveGuideFrame`), and `AX-01` colorblind symbols.
   - **Grabbed Focus**: Lifts by `BLOCK_LIFT_DELTA_Z = 0.46`, scales `1.05x` around geometric center, casts an offset floor shadow, and dims non-grabbed blocks to `0.88x`.
   - **Directional Lighting**: Blends warm sunlit key light (`vec3(1.04, 0.98, 0.92)`) on top faces/stud bevels with cool lavender-indigo shadow fill (`vec3(0.90, 0.88, 1.03)`) on side faces.
4. **Pass 4 (`renderPass4Particles` — [`particle-fx.ts`](../src/render/particle-fx.ts), [`shaders-particles.ts`](../src/render/shaders-particles.ts))**:
   - GPU-instanced 3D particle system (`gl.drawArraysInstanced`, `MAX_PARTICLES = 2048`) supporting 5 geometric styles (`micro_cubes`, `star_confetti`, `pixel_sparks`, `soap_bubbles`, `lightning_bolts`). All cosmetic randomness must use `fxRandom()` ([`src/core/fx-random.ts`](../src/core/fx-random.ts)), never `Math.random()`.

---

## 2. Canonical 3D Block Top-Surface Z-Layer Hierarchy (`gl.DEPTH_TEST`, `gl.LEQUAL`)

| Layer / Feature | Relative `Z` | Notes |
| :--- | :--- | :--- |
| **Courtyard Floor Tile** | `0.000` (`-0.042` locked room) | Sunken Twilight Chambers (`roomId > 0` while locked) rise smoothly to `0.000` when unlocked. |
| **Block Top Face** | `0.580` | Base top face of all 19 polyomino shapes (`BLOCK_TOP_Z = 0.58`). |
| **3D Straps, Chains, Ropes & Side Rails** | `0.588 .. 0.626` | Side-flange rails (`0.13` / `0.87`) leave central `[0.34, 0.66]` circular studs 100% uncovered. |
| **Multi-Layer Inner Core Top Face** | `0.602` | Exposed through the outer shell's central cutout window. |
| **3D Beveled Obstacle Medallions** | `0.562 .. 0.648` | Two-tier plinths (`drawBadgeMedallion3D`); glyphs sit at `0.651`. Never use flat dark 2D `overlayQuad` stickers. |
| **Outer / Inner 3D Circular Studs** | `0.660` / `0.677` | Present on `classic_studs`, `gummy_jelly`, and `neon_cyber` skins. |
| **Colorblind Symbol Medallions (`zCbSymbol`)** | `0.692` (`0.696` inner) | `CB_0..9` on dark obsidian circular medallions; shifts to top-left collar `(0.21, 0.21)` on multi-layer or center-badged cells so outer/inner symbols never collide. |

---

## 3. Block Skins, Board Trays & High-Contrast Palettes (`AX-02`, `BLOCK-STONE-01`, `TRAY-IDENTITY-01`)

- **5 Block Skins (`SKIN_CATALOG` in [`catalog-meta.ts`](../src/ui/catalog-meta.ts), prices `[0, 250, 450, 750, 1200]`)**:
  - `classic_studs` (`0c`, default) $\rightarrow$ `relic_stone` (`250c`, `u_materialStyle = 6` on 8-fan worn-chamfer `meshOuterWorn` / `meshInnerCoreWorn` with `applyPolyominoWearUvs`, matte `0.83` reflectance, mineral grain, chalky bevel wear, and analytic-offset Elder-Futhark `runeDist` via `u_blockSeed`; shared by `color === 0` neutral stone sliders) $\rightarrow$ `gummy_jelly` (`450c`, style `1`, subsurface candy core & bubbles) $\rightarrow$ `carved_wood` (`750c`, style `2`, stained hardwood latewood rings & `knotDist` knots) $\rightarrow$ `neon_cyber` (`1200c`, style `3`, glossy black-glass shell + pulsing neon circuit traces). Gameplay shaders never run `voronoiRockCrack` loops (`p95WorkMs <= 6.5` at 3x mobile DPR).
- **5 Board Trays (`applyTrayMaterial` in [`shaders-tray-materials.ts`](../src/render/shaders-tray-materials.ts))**:
  - Floor tiles use `STONE_SURFACE_STYLE = 5`; plinths/walls/pillars use `TRAY_WALL_STYLE = 7` with `u_trayMaterial = 0..4`: `0` *Industrial Slate* (cleft flagstones), `1` *Warm Birch* (joined planks + pin nails), `2` *Midnight Arcade* (obsidian + pulsing cyan-magenta grid), `3` *Frosted Quartz* (faceted crystal + frost veins), `4` *Mint Studio* (jade terrazzo + emerald/gold chips).
- **High-Contrast Compatibility (`AX-02`)**: `getEffectiveTrayPalette(trayId, true)` selects `HIGH_CONTRAST_TRAY_PALETTES`, `getColorRgb(color, true)` selects high-luminance `hcRgb`, and `u_highContrast = 1.0` boosts rim contrast. Maintain `#game-canvas` pixel-diff tests in [`tests/e2e/shredblocks.spec.ts`](../tests/e2e/shredblocks.spec.ts) and reset theme/a11y flags after custom captures in [`scripts/visual-harness.ts`](../scripts/visual-harness.ts).

---

## 4. Satin Astrolabe Title Board, Relic Awakening & Idle Motion (`MYSTIC-RELIC-01`, `RELIC-AWAKEN-01`, `IDLE-01`–`06`)

- **Levitating Satin Astrolabe Relic (`u_blueprintMix = 1.0`, `STONE-TABLET-01`)**:
  - Renders any board as a **100% opaque (`blueprintAlpha = 1.0` — never `< 1.0`, which causes X-ray floor bleed under `DEPTH_TEST` + `BLEND`)** Satin Astrolabe Slate / Anodized Gunmetal artifact tinted via `u_stoneTint` (`getStoneThemeMineralTint`) with `zRelief = 0.76`, `astrolabeAlloy`, anisotropic `satinSheen`, `champagneRim` & `ivoryPearl` catch-lights, `astrolabeTicks`, anti-aliased 2D Voronoi `voronoiRockCrack` fissures, noise-driven `crackPulse` amethyst-orchid & gold glow (`totalMysticGlow <= 1.18`), `godRaySweep`, and vertex-shader levitation `rotateRelicVec` (zeroed under `reducedMotion`).
  - When `isStoneRuin` (`blueprintMix > 0.45`), Passes 1–4 omit 100% of game UI, modifiers, labels, medallions, rails, straps, queue pips, move guides, and gameplay idle motion.
  - **Zero-Copy Hardware Canvas Overlay (120Hz Mobile Rule)**: Never put CSS `filter: drop-shadow(...)` on `#game-canvas`! Backlighting and bloom live exclusively on `.astrolabe-backlight-halo` behind `#game-canvas` using compositor-only `opacity` + `scale` (`@keyframes mysticRelicAura` on Title, `@keyframes relicAwakeningBloom` for `0.58s` on Play tap) plus `@keyframes mysticGodRays`.
- **Relic Awakening Transition (`RELIC-AWAKEN-01`, [`relic-awakening-fx.ts`](../src/render/relic-awakening-fx.ts))**:
  - Tapping Play sets `blueprintMix = 0.995` (decaying to `0` over `0.58s`), adds `.relic-awakening-burst`, plays `sound.playRelicAwaken()` (PCM buffer pre-built during idle via `sound.prewarmRelicAwaken()` in [`synth.ts`](../src/audio/synth.ts) for `0ms` click stall), and spawns tumbling 3D stone shards (`-5 < scale < 0`), camera-facing dust puffs (`scale <= -10` in `smokeInstanceData` with `depthMask(false)`), amethyst/gold embers, and a floor shockwave ring. Direct `loadLevelImpl` and `switchScreenImpl` snap `blueprintMix = 0` immediately.
- **Living Courtyard Idle Motion (`IDLE-01`–`06`)**: When `reducedMotion === false` and not dragging, movable blocks breathe in a diagonal wave (`+0.038 Z`, `±1.0%` scale, `±0.008` axis-lock hint), spotlight double-bounce every `3.2s` (`+0.052 Z`), ready gates project a threshold floor aura, and delicate courtyard motes/sparks rise.
