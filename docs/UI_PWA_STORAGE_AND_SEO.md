# Sacred-Geometry UI, PWA, SEO/Favicons & Save Storage

On-demand reference for **UI layout & depth hierarchy**, **self-hosted typography**, **viewport/transition geometry**, **PWA update lifecycle**, **Zen Mystic launcher icons, Cloudflare Pages favicons & social SEO (`SEO-OG-FAVICON-01`)**, and **dual-layer save persistence & security (`STOR-01..02`, `SAVE-SEC-01`)**. Read this before modifying `index.html`, `public/*`, `src/ui/*`, `src/styles/*`, `src/storage/*`, `scripts/generate-icons.ts`, or `vite.config.ts`.

---

## 1. Title Screen, Typography & 3-Plane Depth (`TITLE-LOGO-01`, `TYPOGRAPHY-01`, `UI-DEPTH-01`)

- **Monumental Splash Logo & Self-Hosted Fonts (`TITLE-LOGO-01`, `TYPOGRAPHY-01`)**:
  - `.title-crest-banner` displays `#title-crest-heading` in **Fraunces** (`--font-logo`, weight `800`, `SOFT 60, WONK 0`, split-tone `.logo-word-shred` / `.logo-word-blocks`) paired with **Plus Jakarta Sans** (`--font-ui` `600/700`, `--font-sans` `400/500`).
  - Never load fonts from external CDNs. Both variable `.woff2` files live in `public/fonts/` (SIL OFL 1.1), preload in [`index.html`](../index.html), pre-cache in `APP_SHELL_URLS` ([`public/sw.js`](../public/sw.js)), hash into `CACHE_VERSION`, and set `font-size-adjust: from-font`. Keep `.title-crest-banner` borderless in `body.high-contrast`.
- **New vs. Returning Title Flows & Dock Fit (`TITLE-DOCK-FIT-01`)**:
  - Brand-new saves (`isNewPlayerSave(save) === true`) show **`▶ BEGIN JOURNEY`** (launching straight into Level 1) + `Restore Save` · `Settings` · conditional `Install`.
  - Returning saves show Chapter/Level + `★ / Coins / ✦` plaque, **`▶ CONTINUE · LEVEL N`**, and `Map` · `Themes` · `Sync` · `Settings` · conditional `Install`. Tapping `#btn-home-title` on `#screen-home` re-opens `#title-overlay`.
  - `.title-dock-bar` items use `flex: 1 1 0; min-width: 0` (groups `display: contents`) and stack icon-over-label at `<= 440px` when Install is visible. All Settings buttons use the gear icon.
- **3-Plane Depth Hierarchy (`UI-DEPTH-01`) & Semantic Button Colors (`UI-BTN-COLOR-01`)**:
  - *Plane 0 (Recessed Wells)*: `.economy-pills`, `.hud-stat-plaque`, `.chest-card`, `.title-returning-plaque`, `.stat-box`, `.theme-card`, `.booster-btn.locked-booster` (`inset 0 1px 2px rgba(0,0,0,0.48)`).
  - *Plane 1 (Chiseled Stone Keys)*: `.btn-tactile`, `.btn-mode-wing`, `.chip-filter`, `.booster-btn`, `.title-utility-pill`, `.setting-row` (directional `oklab` fill + `inset 0 1px 0` specular + `0 2px 0` bottom ledge).
  - *Plane 2 (Luminous Beacons)*: `.btn-primary`, `.btn-mode-pill`, `.tab-play-cta`, `.btn-warning`, `.level-node-card.current-level` (`.hud-mode-carousel` pairs a mode-tinted `#btn-mode-toggle` hero crest + inset `.moves-pill` + `⇄` swap glyph with chiseled `#btn-mode-prev` / `#btn-mode-next` side keycaps at `+0px` header height).
  - Semantic color families stay identical across all screens: **Map** = Terracotta-Amber (`.btn-sanctuary` / `.title-map-pill`), **Install** = Seafoam-Teal (`.btn-install` / `.title-install-pill`), **Play/Resume/Next** = Jade-Teal (`.btn-primary` / `.tab-play-cta`), **Secondary/Utility** = Amethyst-Slate (`.btn-secondary` / `.title-utility-pill`). Gate `:hover` inside `@media (hover: hover)`.
- **Subtle Game-Mode Ambient Framing (`MODE-AMBIENCE-01`) & Simplified `"Settings"` Modal**:
  - `#app-shell[data-play-mode][data-title-open][data-active-screen]` drives compositor-only `.mode-ambience-backdrop` layers (`~12%` opacity), `.sacred-geometry-ornament` astrolabe ring tints, and `1px` HUD / Booster-Dock / Map / Bottom-Nav hairlines (`CHALLENGE` = Burnished Gold-Bronze, `ZEN` = Sanctuary Jade-Seafoam, `TIMED` = Astral Sapphire-Cobalt) while keeping the dark Sanctuary base intact for 3D block contrast. Ambience stays `opacity: 0` on Title Screen (`MYSTIC-RELIC-01`), in Themes Studio, and in `body.high-contrast`, blooming in over `0.58s` on Play tap with zero CSS `filter` on `#game-canvas`.
  - `#dialog-pause` (`#pause-title`) is titled **`"Settings"`** (`aria-label="Settings"` on `#btn-pause`) and houses only audio, haptics, accessibility, and frame-rate settings—never a Play Mode selector, since Play Mode is a primary Map/HUD choice.

---

## 2. Sanctuary Map, Viewport Geometry & History Stack (`MAP-LINKED-PATH-01`, `VIEWPORT-01`, `NAV-HISTORY-01`)

- **Grouped Linked Sanctuary Map (`MAP-JOURNEY-01`, `MAP-LINKED-PATH-01`)**:
  - Opening `#screen-home` resets `activeRoadmapRange = 'all'`, shows `#hero-awakening-banner` (`getNextSanctuaryAwakeningText`), renders Campaign stages via O(1) `getCampaignRoadmapMeta()` (never running 300 solver passes on cold open), windows Endless stages once `unlockedMax > 324` (`301..306` + `focusLevel ± 8` + frontier), and auto-scrolls `#roadmap-list` to `.current-level` (`aria-current="step"`).
  - 5-stage `.roadmap-stage-group` flights distinguish `.completed-level` (`stars > 0`, emerald-jade `✓ Cleared`), `.zen-cleared-level` (`zenCleared && stars === 0`, seafoam `🌿 Zen`), `.skipped-level` (`skipped`, faded slate `opacity: 0.7`), `.current-level`, and `.locked-level`. Keep 1-tap `‹ Map` buttons accessible across HUD and all modals.
- **Zero-Cutoff Layout & Zero-Shift Title Transition (`VIEWPORT-01`, `TITLE-TRANSITION-01`)**:
  - Never add `viewport-fit=cover` to `<meta name="viewport">` (breaks Android WebAPK standalone `100dvh` below the status bar). Bind `#app-shell` and `.title-overlay` to `--app-height` (`syncViewportGeometryImpl`), size `#game-canvas` via container-query units (`96cqw` / `82cqh` with dynamic `--board-aspect` for portrait boards) inside `.board-stage` (`container-type: size`), and hide `.hud-top-bar` / `.booster-dock` in `#screen-game.title-backdrop-mode` via `visibility: hidden` (never `display: none` or `.board-stage` padding overrides) for `0px` canvas shift.
- **Non-URL Browser History (`NAV-HISTORY-01`)**: Uses state-only `history.pushState` / `replaceState` (`AppHistoryState`) without mutating URL pathname/query/hash so offline SW shell caching stays intact.

---

## 3. Zen Mystic Icons, Cloudflare Pages Favicons, SEO & PWA Lifecycle (`SEO-OG-FAVICON-01`, `PWA-UPDATE-01`)

- **Launcher Icons & Favicons ([`scripts/generate-icons.ts`](../scripts/generate-icons.ts))**:
  - [`public/icon.svg`](../public/icon.svg) and [`public/icon-maskable.svg`](../public/icon-maskable.svg) feature the Zen Mystic Sanctuary astrolabe, glowing Voronoi courtyard fissures, and 3D Coral/Gold/Jade blocks. Maskable icons (`icon-maskable-192.png`, `icon-maskable-512.png`) keep 100% full-bleed backgrounds and all foreground elements inside W3C safe circle `cx=256, cy=256, r <= 190` with zero outer border. [`public/apple-touch-icon.png`](../public/apple-touch-icon.png) is opaque full-bleed `180×180`.
  - `buildMultiSizeIco` generates a real binary multi-resolution [`public/favicon.ico`](../public/favicon.ico) (`16×16`, `32×32`, and Google SERP `48×48` PNG-in-ICO frames) plus `favicon-32x32.png` and `favicon-48x48.png` so Cloudflare Pages (`not_found_handling: "single-page-application"`) serves physical icon binaries with `Content-Type: image/x-icon` in [`public/_headers`](../public/_headers).
- **Social Share Preview & Modern SEO (`SEO-OG-FAVICON-01`)**:
  - [`public/og-image.png`](../public/og-image.png) (`1200×630`, generated by `generate-icons.ts`) pairs the Zen Mystic App Icon with the self-hosted `Fraunces` + `Plus Jakarta Sans` brand crest.
  - [`index.html`](../index.html) defines `canonical`, `description`, `robots` (`max-image-preview:large`), Open Graph `og:*` (`1200×630` + `alt`), X/Twitter `summary_large_image` `twitter:*`, and non-executable Schema.org `VideoGame` + `WebApplication` `<script type="application/ld+json">` (100% compatible with `SAVE-SEC-01` `script-src 'self'`), backed by [`public/robots.txt`](../public/robots.txt) and [`public/sitemap.xml`](../public/sitemap.xml).
- **Automatic SW Stamping & Update Ribbon (`pwaAutoVersionPlugin`, `PWA-UPDATE-01`)**:
  - `npm run build` ([`vite.config.ts`](../vite.config.ts)) SHA-256 hashes `dist/index.html`, `dist/assets/*`, and icon/OG assets into `CACHE_VERSION` (`dist/sw.js`) and writes `dist/version.json`.
  - [`public/sw.js`](../public/sw.js) normalizes navigation responses via `stripRedirectFlag()` (never returning `response.redirected === true`). `isPwaInstalled()` hides `#btn-title-install` / `#btn-install-header` when installed. `checkForPwaUpdateImpl` (`60s` throttle) checks on boot, menu screens, and `visibilitychange` (never mid-game), auto-applying via `SKIP_WAITING` only in the `<= 1,600ms` untouched cold-boot window or after `>= 30 min` idle; otherwise `#pwa-update-toast` mounts in-flow.

---

## 4. Dual-Layer Persistence, 53-Bit Save Codec, Migration & Security (`STOR-01..02`, `ENDLESS-SAVE-01`, `SAVE-COMPAT-01`, `SAVE-SEC-01`)

- **Dual-Layer Storage ([`save-manager.ts`](../src/storage/save-manager.ts))**: Monotonic `writeSeq` writes synchronously to `localStorage` (`'shredblocks.save.v1'`) and mirrors asynchronously to `IndexedDB` (`'ShredBlocksDB'` / `'saves'`), reconciling on `init()`. Pre-import snapshots save to `PRE_IMPORT_BACKUP_KEY` (evicted automatically if `QuotaExceededError` occurs on massive Endless saves).
- **53-Bit Binary Save Codec ([`save-code.ts`](../src/storage/save-code.ts), [`qr-svg.ts`](../src/storage/qr-svg.ts))**: `0x02` columnar binary stream using 53-bit `writeVarint` / `readVarint` (never 32-bit shifts) + O(N) hash-chain LZ77 + base64url + CRC32 (`SB1-<base64url>-<crc32hex>`), plus legacy `0x7b` UTF-8 JSON stream decoding. `{ qrCompact: true }` caps QR exports at `1,500` records so QR codes always fit ISO 18004 Version 40 (`<= 2,953` bytes).
- **Live Save Backward-Compatibility & Migration Contract (`SAVE-COMPAT-01`)**:
  - Never rename `SAVE_STORAGE_KEY`, `IDB_DB_NAME`, `IDB_STORE_NAME`, or `appId` without reading and migrating the prior key/version first.
  - Keep `SKIN_IDS`, `TRAY_IDS`, `PARTICLE_IDS`, `QUALITY_TIERS`, and `sFlags` bit positions strictly **append-only** (reordering or removing entries breaks live `SB1-...` codes).
  - Add new `SavePayload` fields with safe defaults in `sanitizeSavePayload` (for older `localStorage`/`IndexedDB`/`.json` payloads missing those keys) and append-only tagged binary trailers after `0xa5` in `packCompactSaveBytes` / `unpackCompactSaveBytes` (skipping unknown trailing bytes cleanly).
  - If `schemaVersion` ever increments (`1 -> 2`), `validateSavePayload` must accept all prior schema versions (`1 .. current`) and run deterministic `migrateV1ToV2(...)` steps across all 4 load entry points (`constructor`, `init`, `importSaveCode`, `importSaveJson`), guarded by pinned canonical v1 fixtures in [`tests/unit/save-security.test.ts`](../tests/unit/save-security.test.ts).
- **Untrusted Save Security (`SAVE-SEC-01`)**: Treat `#import=`, pasted codes, JSON files, and storage as hostile. `validateSavePayloadV1` rebuilds a whitelisted payload; render save values strictly via `textContent` / `.value` (never `innerHTML`); preserve strict CSP (`script-src 'self'`, `object-src 'none'`, `base-uri 'none'`) + `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN` across `index.html`, `public/_headers`, `vite.config.ts`, and `vite.lan.config.ts`.
