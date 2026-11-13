/**
 * Lazily mounts the 5 native `<dialog>` modals (`#dialog-victory`, `#dialog-failure`, `#dialog-pause`,
 * `#dialog-save-transfer`, `#dialog-install`) and `#pwa-update-toast` into `document.body` on startup
 * if not already present, keeping `index.html` focused on the core screen shell (`ARCH-ERGONOMICS-01`).
 */
export const DIALOGS_AND_TOAST_TEMPLATE = `
    <!-- 1. Victory Modal (#dialog-victory) -->
    <dialog id="dialog-victory" class="game-dialog" closedby="none" aria-labelledby="victory-title">
      <div class="dialog-card victory-dialog-card">
        <canvas id="victory-fx-canvas" class="victory-fx-canvas" aria-hidden="true"></canvas>
        <div class="dialog-header victory-header">
          <svg
            id="victory-crest-ornament"
            class="victory-crest-ornament"
            viewBox="0 0 120 120"
            width="64"
            height="64"
            fill="none"
            aria-hidden="true"
          >
            <circle cx="60" cy="60" r="54" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 5" />
            <circle cx="60" cy="60" r="44" stroke="currentColor" stroke-width="1.8" />
            <rect x="29" y="29" width="62" height="62" stroke="currentColor" stroke-width="1.4" transform="rotate(45 60 60)" />
            <rect x="29" y="29" width="62" height="62" stroke="currentColor" stroke-width="1.4" />
            <polygon points="60,8 65,22 60,30 55,22" fill="currentColor" />
            <polygon points="60,112 65,98 60,90 55,98" fill="currentColor" />
            <polygon points="8,60 22,65 30,60 22,55" fill="currentColor" />
            <polygon points="112,60 98,65 90,60 98,55" fill="currentColor" />
            <circle cx="60" cy="60" r="14" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="2" />
            <polygon points="60,49 63,57 71,60 63,63 60,71 57,63 49,60 57,57" fill="currentColor" />
          </svg>
          <h2 id="victory-title" class="dialog-title">Level Cleared!</h2>
          <p id="victory-subtitle" class="dialog-subtitle">Shredder Perfection!</p>
        </div>

        <div id="victory-stars" class="victory-stars" aria-label="Earned Stars"><span class="star-slot earned">★</span><span class="star-slot earned">★</span><span class="star-slot earned">★</span></div>

        <div id="victory-under-par-banner" class="under-par-easter-egg" hidden></div>

        <div class="victory-stats-grid">
          <div class="stat-box">
            <span class="stat-label">Moves vs. Par</span>
            <strong id="victory-moves" class="stat-value">2 / 2</strong>
          </div>
          <div class="stat-box">
            <span class="stat-label">Coins Earned</span>
            <strong id="victory-coins-total" class="stat-value text-gold">+80 Coins</strong>
          </div>
        </div>

        <p id="victory-coins-breakdown" class="coins-breakdown">
          First Clear: +50 • Stars: +30
        </p>

        <!-- Persistent Chest Progress Meters on Victory (FR-34) -->
        <div class="victory-chests-row">
          <div class="victory-chest-mini">
            <div class="chest-header">
              <span>◇ Shred Chest</span>
              <span id="victory-shred-chest-text" class="chest-counter">2 / 100</span>
            </div>
            <div class="progress-track" aria-hidden="true">
              <div id="victory-shred-chest-fill" class="progress-fill fill-cyan" style="width: 2%"></div>
            </div>
          </div>
          <div class="victory-chest-mini">
            <div class="chest-header">
              <span>★ Level Chest</span>
              <span id="victory-milestone-chest-text" class="chest-counter">Lvl 10</span>
            </div>
            <div class="progress-track" aria-hidden="true">
              <div id="victory-milestone-chest-fill" class="progress-fill fill-gold" style="width: 10%"></div>
            </div>
          </div>
        </div>

        <div id="victory-chest-fanfare" class="chest-fanfare-box" hidden></div>

        <div class="dialog-actions">
          <button type="button" id="btn-victory-home" class="btn-tactile btn-sanctuary">
            ‹ Map
          </button>
          <button type="button" id="btn-victory-replay" class="btn-tactile btn-secondary">
            ↻ Replay
          </button>
          <button type="button" id="btn-next-level" class="btn-tactile btn-primary" autofocus>
            ▶ Next Level
          </button>
        </div>
      </div>
    </dialog>

    <!-- 2. Failure / Retry Modal (#dialog-failure) -->
    <dialog id="dialog-failure" class="game-dialog" closedby="none" aria-labelledby="failure-title">
      <div class="dialog-card">
        <div class="dialog-header">
          <h2 id="failure-title" class="dialog-title">Out of Moves</h2>
          <p id="failure-reason" class="dialog-subtitle">
            Retry for free, spend a Zen Blessing or Coins to continue, or switch to Zen Mode!
          </p>
        </div>

        <div class="dialog-actions dialog-actions-vertical">
          <button type="button" id="btn-retry-level" class="btn-tactile btn-primary" autofocus>
            ↻ Try Again (Free)
          </button>
          <button type="button" id="btn-use-zen-blessing" class="btn-tactile btn-blessing" hidden>
            🌿 Zen Blessing: +5 Moves (Free · 1/3)
          </button>
          <button type="button" id="btn-continue-level" class="btn-tactile btn-warning">
            ➕ +5 Moves (150 Coins)
          </button>
          <button type="button" id="btn-failure-zen" class="btn-tactile btn-secondary">
            🌿 Switch to Zen Mode · Lvl 1
          </button>
          <button type="button" id="btn-failure-home" class="btn-tactile btn-sanctuary">
            ‹ Return to Sanctuary Map
          </button>
        </div>
      </div>
    </dialog>

    <!-- 3. Settings Modal (#dialog-pause) -->
    <dialog id="dialog-pause" class="game-dialog" closedby="any" aria-labelledby="pause-title">
      <div class="dialog-card dialog-card-wide pause-dialog-card">
        <div class="dialog-header-row">
          <h2 id="pause-title" class="dialog-title">Settings</h2>
          <button
            type="button"
            id="btn-pause-close"
            class="btn-tactile btn-icon"
            aria-label="Close Settings"
          >
            ✕
          </button>
        </div>

        <!-- Primary Navigation & Level Controls First (Zero Scrolling Needed) -->
        <div class="pause-nav-section">
          <div class="dialog-actions-grid pause-primary-grid">
            <button type="button" id="btn-pause-resume" class="btn-tactile btn-primary" autofocus>
              ▶ Resume
            </button>
            <button type="button" id="btn-pause-home" class="btn-tactile btn-sanctuary">
              ‹ Sanctuary Map
            </button>
            <button type="button" id="btn-pause-restart" class="btn-tactile btn-secondary btn-compact">
              ↻ Restart Level
            </button>
            <button type="button" id="btn-pause-skip" class="btn-tactile btn-secondary btn-compact">
              Skip Level (Free) ▸▸
            </button>
          </div>
        </div>

        <!-- Compact 2-Column Architectural Settings Grid -->
        <div class="settings-list">
          <label class="setting-row">
            <span>Sound FX</span>
            <input type="checkbox" id="toggle-sfx" checked />
          </label>
          <label class="setting-row">
            <span>Music</span>
            <input type="checkbox" id="toggle-music" checked />
          </label>
          <label class="setting-row">
            <span>Haptics</span>
            <input type="checkbox" id="toggle-haptics" checked />
          </label>
          <label class="setting-row">
            <span>Colorblind</span>
            <input type="checkbox" id="toggle-colorblind" />
          </label>
          <label class="setting-row">
            <span>High Contrast</span>
            <input type="checkbox" id="toggle-high-contrast" />
          </label>
          <label class="setting-row">
            <span>Low Motion</span>
            <input type="checkbox" id="toggle-reduced-motion" />
          </label>
          <label class="setting-row setting-row-wide">
            <span>Frame Rate</span>
            <select id="select-quality-tier" class="select-tactile">
              <option value="AUTO">Auto (120Hz / 60Hz)</option>
              <option value="ULTRA_120">Ultra 120Hz</option>
              <option value="BALANCED_60">Balanced 60Hz</option>
            </select>
          </label>
        </div>

        <div class="dialog-actions-grid pause-utility-grid">
          <button type="button" id="btn-pause-save-transfer" class="btn-tactile btn-secondary btn-compact">
            Backup &amp; Sync Save
          </button>
          <button type="button" id="btn-pause-install" class="btn-tactile btn-install btn-compact">
            Install App Guide
          </button>
        </div>

        <details class="telemetry-details">
          <summary>Performance Telemetry</summary>
          <div id="telemetry-readout" class="telemetry-bar" aria-live="off">
            FPS: 120 | Work: 0.8ms | Tier: ULTRA_120 | Backend: WEBGL2
          </div>
        </details>
      </div>
    </dialog>

    <!-- 4. Save Backup, QR Code & Import Diff Modal (#dialog-save-transfer) -->
    <dialog
      id="dialog-save-transfer"
      class="game-dialog"
      closedby="any"
      aria-labelledby="save-transfer-title"
    >
      <div class="dialog-card dialog-card-wide">
        <div class="dialog-header-row">
          <h2 id="save-transfer-title" class="dialog-title">✦ Backup, QR &amp; Cross-Device Sync</h2>
          <button
            type="button"
            id="btn-save-transfer-close"
            class="btn-tactile btn-icon"
            aria-label="Close Save Backup Modal"
          >
            ✕
          </button>
        </div>

        <div class="save-transfer-body">
          <!-- Export Section -->
          <div class="save-panel">
            <h3 class="panel-heading">↗ Export Your Progress</h3>
            <p class="panel-desc">
              Copy your compact <code>SB1-...</code> Save Code, scan the offline QR code on another
              device, or download a JSON backup file.
            </p>
            <textarea
              id="save-code-output"
              class="code-textarea"
              rows="2"
              readonly
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              aria-label="Current Save Code"
            ></textarea>
            <div class="button-row-wrap">
              <button
                type="button"
                id="btn-copy-save-code"
                class="btn-tactile btn-primary btn-compact"
              >
                Copy Code
              </button>
              <button
                type="button"
                id="btn-copy-sync-url"
                class="btn-tactile btn-secondary btn-compact"
              >
                Copy Magic Sync URL
              </button>
              <button
                type="button"
                id="btn-download-json"
                class="btn-tactile btn-secondary btn-compact"
              >
                Download .json File
              </button>
            </div>

            <div class="qr-wrapper">
              <div id="qr-code-container" class="qr-box" aria-label="Save Sync QR Code"></div>
              <span class="qr-caption"
                >Scan with phone camera to open &amp; preview this save immediately</span
              >
            </div>
          </div>

          <!-- Import Section -->
          <div class="save-panel">
            <h3 class="panel-heading">↙ Import Save Code or JSON</h3>
            <p class="panel-desc">
              Paste a <code>SB1-...</code> save code or upload a <code>.json</code> backup. You will
              see a side-by-side comparison before overwriting.
            </p>
            <textarea
              id="save-code-input"
              class="code-textarea"
              rows="2"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="Paste SB1-... save code or JSON here"
              aria-label="Save Code or JSON to Import"
            ></textarea>
            <div class="button-row-wrap">
              <button
                type="button"
                id="btn-preview-import"
                class="btn-tactile btn-primary btn-compact"
              >
                Preview Import
              </button>
              <button
                type="button"
                id="btn-upload-json"
                class="btn-tactile btn-secondary btn-compact"
              >
                Upload .json File
              </button>
              <input
                type="file"
                id="file-upload-json"
                accept=".json,application/json"
                hidden
              />
              <button
                type="button"
                id="btn-restore-backup"
                class="btn-tactile btn-warning btn-compact"
                hidden
              >
                ↺ Undo Last Import (Restore Backup)
              </button>
            </div>
            <p id="save-transfer-status" class="transfer-status" role="status" aria-live="polite"></p>

            <!-- Side-by-Side Diff Confirmation View (UX-06) -->
            <div id="import-diff-panel" class="import-diff-panel" hidden>
              <h4 class="diff-heading">✦ Confirm Save Overwrite</h4>
              <div class="diff-columns">
                <div class="diff-col">
                  <h5>Current Local Save</h5>
                  <ul id="diff-current-list" class="diff-list"></ul>
                </div>
                <div class="diff-col diff-col-incoming">
                  <h5>Incoming Save</h5>
                  <ul id="diff-incoming-list" class="diff-list"></ul>
                </div>
              </div>
              <div class="button-row-wrap">
                <button
                  type="button"
                  id="btn-confirm-import"
                  class="btn-tactile btn-primary btn-compact"
                >
                  ✓ Confirm Overwrite
                </button>
                <button
                  type="button"
                  id="btn-cancel-import"
                  class="btn-tactile btn-secondary btn-compact"
                >
                  ✕ Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </dialog>

    <!-- 5. Install App Guide Modal (#dialog-install) -->
    <dialog id="dialog-install" class="game-dialog" closedby="any" aria-labelledby="install-title">
      <div class="dialog-card">
        <div class="dialog-header-row">
          <h2 id="install-title" class="dialog-title">✦ Install ShredBlocks App</h2>
          <button
            type="button"
            id="btn-install-close"
            class="btn-tactile btn-icon"
            aria-label="Close Install Guide"
          >
            ✕
          </button>
        </div>

        <p class="dialog-subtitle">
          Play 100% offline in full-screen standalone mode—even in Airplane Mode!
        </p>

        <div id="native-install-banner" class="install-step-card" hidden>
          <h3>✦ 1-Tap Instant Install</h3>
          <p>Your browser supports direct app installation:</p>
          <button type="button" id="btn-trigger-native-install" class="btn-tactile btn-primary">
            Install ShredBlocks Now
          </button>
        </div>

        <div class="install-steps-grid">
          <div class="install-step-card">
            <h3>◇ Android (Chrome / Edge)</h3>
            <ol>
              <li>Tap the browser menu icon (<strong>⋮</strong>) in the top-right corner.</li>
              <li>Select <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li>
              <li>Tap <strong>Install</strong> to launch full-screen at up to 120Hz!</li>
            </ol>
          </div>

          <div class="install-step-card">
            <h3>◇ iPhone &amp; iPad (Safari)</h3>
            <ol>
              <li>Tap the <strong>Share</strong> button (<strong>↑</strong>) in the Safari toolbar.</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong> in the top-right corner.</li>
            </ol>
          </div>
        </div>
      </div>
    </dialog>

    <!-- Contextual In-Flow App Update Notification Banner (STOR-03 / PWA-UPDATE-01) -->
    <div id="pwa-update-toast" class="pwa-update-toast" role="status" aria-live="polite" hidden>
      <div class="pwa-update-meta">
        <span class="pwa-update-badge"><span class="pwa-update-dot" aria-hidden="true"></span>NEW</span>
        <span class="pwa-update-label">App Update Ready</span>
      </div>
      <div class="pwa-toast-actions">
        <button
          type="button"
          id="btn-pwa-update-now"
          class="btn-tactile btn-warning btn-compact pwa-btn-update"
        >
          ↻ Update
        </button>
        <button
          type="button"
          id="btn-pwa-update-dismiss"
          class="btn-tactile btn-secondary btn-compact pwa-btn-later"
        >
          Later
        </button>
      </div>
    </div>
`;

export function ensureDialogsMounted(): void {
  if (typeof document === 'undefined' || !document.body) return;
  if (document.getElementById('dialog-victory')) return;
  document.body.insertAdjacentHTML('beforeend', DIALOGS_AND_TOAST_TEMPLATE);
}
