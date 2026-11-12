# ShredBlocks: Color Jam — Architecture Index & On-Demand Reference Router

To keep agent context lean and ensure every documentation file fits comfortably within a single `read_file` call (`ARCH-ERGONOMICS-01`), detailed specifications are organized into **4 focused on-demand reference guides**. Load only the guide(s) relevant to your task:

| Reference Guide | When to Load | Invariant Codes & Topics Covered |
| :--- | :--- | :--- |
| **[`docs/PHYSICS_AND_MECHANICS.md`](PHYSICS_AND_MECHANICS.md)** | Modifying `src/core/*`, `src/input/*`, or `src/render/camera-3d.ts` | `UX-01`, `DRAG-01..07`, `F-01..08`, `MECH-04`, `SANCTUM-01..02`, `VAULT-01..02`, `GATE-STEP-01`, `GATE-ICE-01`, `C1-03` (ray-plane math, swept raycast, gate clearance, mid-drag capture, Mystery Vault stasis, 9-step clear cascade & 4-entry-point parity). |
| **[`docs/RENDERING_AND_SHADERS.md`](RENDERING_AND_SHADERS.md)** | Modifying `src/render/*`, `src/audio/*`, or title/shader animations | `AX-01..02`, `STONE-TABLET-01`, `MYSTIC-RELIC-01`, `RELIC-AWAKEN-01`, `BLOCK-STONE-01`, `GUMMY-01`, `WOOD-GRAIN-01`, `NEON-CYBER-01`, `STONE-FLOOR-01`, `TRAY-IDENTITY-01`, `IDLE-01..06` (4-pass WebGL2, `plinthSpans`, Z-layer table `zCbSymbol = 0.692`, 5 skins & 5 trays, zero-filter 120Hz `#game-canvas`, `.astrolabe-backlight-halo`, prewarmed `0.58s` burst). |
| **[`docs/PROGRESSION_AND_ECONOMY.md`](PROGRESSION_AND_ECONOMY.md)** | Modifying `src/levels/*`, `src/core/board*.ts`, or economy/rewards | `UX-03`, `RAMP-01..05`, `DENSITY-01`, `PORTRAIT-01..02`, `STARS-SLACK-01`, `TIMED-BOMB-01`, `ZEN-CALM-01`, `FINAL-TOUCH-01`, `STUCK-01`, `UNDO-RES-01`, `ECON-01..04`, `ECON-V2` (6 epochs, `L1–12` / `L13–25` / `L26+` ramp, Challenge/Zen/Timed, coalescing, Hint Free Moves, chests, payouts). |
| **[`docs/UI_PWA_STORAGE_AND_SEO.md`](UI_PWA_STORAGE_AND_SEO.md)** | Modifying `index.html`, `public/*`, `src/ui/*`, `src/styles/*`, `src/storage/*`, `scripts/generate-icons.ts`, or `vite.config.ts` | `TITLE-LOGO-01`, `TYPOGRAPHY-01`, `TITLE-DOCK-FIT-01`, `UI-DEPTH-01`, `UI-BTN-COLOR-01`, `MAP-JOURNEY-01`, `MAP-LINKED-PATH-01`, `VIEWPORT-01`, `TITLE-TRANSITION-01`, `NAV-HISTORY-01`, `PWA-UPDATE-01`, `SEO-OG-FAVICON-01`, `STOR-01..02`, `ENDLESS-SAVE-01`, `SAVE-SEC-01` (UI planes, self-hosted fonts, Zen Mystic icons, Cloudflare Pages favicons & OG card, SW stamping, dual-layer save codec & CSP). |

---

## Extension Checklists & Ergonomics (`ARCH-ERGONOMICS-01`)

1. **Adding a New Cosmetic Theme**:
   - Register the ID in `SkinId`, `TrayId`, or `ParticleStyleId` in [`src/core/types.ts`](../src/core/types.ts).
   - Add the catalog entry in [`src/ui/catalog-meta.ts`](../src/ui/catalog-meta.ts) (re-exported by [`src/main.ts`](../src/main.ts)) and the `.swatch-<id>` preview in [`src/styles/themes-and-nav.css`](../src/styles/themes-and-nav.css).
   - Add the shader/palette branch in [`src/render/render-types.ts`](../src/render/render-types.ts) and [`src/render/shaders-3d.ts`](../src/render/shaders-3d.ts) / [`shaders-tray-materials.ts`](../src/render/shaders-tray-materials.ts).
2. **Single-Call File-Size Budget (`ARCH-ERGONOMICS-01`)**:
   - Every repository `.ts`, `.css`, `.html`, `.md`, `.js`, `.json`, `.jsonc`, or `.svg` file (except `package-lock.json`) must stay `<= 800 lines` and `<= 45,000 bytes` (aim for `<= 750 lines`), verified by [`tests/unit/sanctums-and-architecture.test.ts`](../tests/unit/sanctums-and-architecture.test.ts).
   - Multi-pass render logic lives in `src/render/pass1..3*.ts`, `particle-fx.ts`, `relic-awakening-fx.ts`, and `canvas2d-fallback.ts` via `RenderPassContext`; UI views live in `src/ui/*.ts` via `AppViewContext`; domain barrels (`physics.ts`, `gate-clearance.ts`, `board.ts`, `generator.ts`, `mesh-generator.ts`, `renderer-3d.ts`, `pointer-controller.ts`, `main.ts`) re-export extracted sub-modules.
3. **Public Repository Portability & Zero Machine-Specific Bindings (`REPO-PORTABILITY-01`)**:
   - Because this repository is public (`MIT`), never commit secrets, API keys, `.env*` files, `.certs/` private keys, Cloudflare `account_id`/`zone_id` bindings, private LAN IPs, or machine-specific paths (`/Users/<user>`, `/home/<user>`, `C:\Users\<user>`, `.gemini/<dir>`).
   - Resolve filesystem paths in Vite configs, build/icon/harness scripts, and tests via `process.cwd()` or `fileURLToPath(new URL(..., import.meta.url))` with optional environment overrides (e.g., `VISUAL_OUT_DIR`), enforced automatically in [`tests/unit/sanctums-and-architecture.test.ts`](../tests/unit/sanctums-and-architecture.test.ts).
