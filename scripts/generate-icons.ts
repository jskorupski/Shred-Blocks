// @ts-expect-error Node built-in module resolved at runtime by tsx
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-expect-error Node built-in module resolved at runtime by tsx
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

declare const process: {
  cwd: () => string;
  exit: (code: number) => void;
};

const ARTIFACT_SCRATCH_DIR =
  '/Users/james/.gemini/antigravity/brain/17772f07-37b9-4f49-9df5-0a104c9e8a28/scratch';

async function main(): Promise<void> {
  const publicDir = resolve(process.cwd(), 'public');
  mkdirSync(ARTIFACT_SCRATCH_DIR, { recursive: true });

  const svgAny = readFileSync(resolve(publicDir, 'icon.svg'), 'utf8') as string;
  const svgMaskable = readFileSync(resolve(publicDir, 'icon-maskable.svg'), 'utf8') as string;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const renderSvgToPng = async (
      svgMarkup: string,
      size: number,
      outPath: string,
      omitBackground: boolean
    ): Promise<void> => {
      const page = await browser.newPage({
        viewport: { width: size, height: size },
        deviceScaleFactor: 1,
      });
      await page.setContent(
        `<!doctype html>
        <html>
          <head>
            <style>
              * { margin: 0; padding: 0; box-sizing: border-box; }
              html, body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
              svg { width: ${size}px; height: ${size}px; display: block; }
            </style>
          </head>
          <body>${svgMarkup}</body>
        </html>`
      );
      const buf = await page.screenshot({ type: 'png', omitBackground });
      writeFileSync(outPath, buf);
      await page.close();
      console.log(`Generated ${outPath} (${size}x${size})`);
    };

    // 1. Standard Any-purpose PNGs (transparent corners outside squircle)
    await renderSvgToPng(svgAny, 192, resolve(publicDir, 'icon-192.png'), true);
    await renderSvgToPng(svgAny, 512, resolve(publicDir, 'icon-512.png'), true);

    // 2. Maskable Full-Bleed PNGs (Android / Samsung One UI / Pixel)
    await renderSvgToPng(svgMaskable, 192, resolve(publicDir, 'icon-maskable-192.png'), false);
    await renderSvgToPng(svgMaskable, 512, resolve(publicDir, 'icon-maskable-512.png'), false);

    // 3. iOS / iPadOS Apple Touch Icon (180x180 opaque full-bleed with full-scale blocks)
    const svgAppleTouch = svgAny
      .replace(
        '<rect x="6" y="6" width="500" height="500" rx="112" fill="url(#sanctuarySky)"/>',
        '<rect x="0" y="0" width="512" height="512" fill="url(#sanctuarySky)"/>'
      )
      .replace(
        '<rect x="6" y="6" width="500" height="500" rx="112" fill="url(#sunburstGlow)"/>',
        '<rect x="0" y="0" width="512" height="512" fill="url(#sunburstGlow)"/>'
      )
      .replace(
        '<rect x="6" y="6" width="500" height="500" rx="112" fill="none" stroke="url(#goldRim)" stroke-width="8"/>',
        ''
      );
    await renderSvgToPng(svgAppleTouch, 180, resolve(publicDir, 'apple-touch-icon.png'), false);

    // 4. Render Cross-Platform Launcher Mask Preview Sheet for Visual & UX Review
    const previewPage = await browser.newPage({
      viewport: { width: 1080, height: 520 },
      deviceScaleFactor: 2,
    });
    const b64Maskable = (
      readFileSync(resolve(publicDir, 'icon-maskable-512.png')) as {
        toString: (enc: string) => string;
      }
    ).toString('base64');
    const b64Any = (
      readFileSync(resolve(publicDir, 'icon-512.png')) as { toString: (enc: string) => string }
    ).toString('base64');
    const b64Apple = (
      readFileSync(resolve(publicDir, 'apple-touch-icon.png')) as {
        toString: (enc: string) => string;
      }
    ).toString('base64');

    await previewPage.setContent(`<!doctype html>
      <html>
        <head>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              width: 1080px;
              height: 520px;
              background: linear-gradient(180deg, #1b1632 0%, #2f244f 60%, #44315e 100%);
              color: #fdf8f2;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              gap: 32px;
              padding: 32px;
            }
            h1 {
              font-size: 22px;
              letter-spacing: 0.08em;
              text-transform: uppercase;
              color: #f6bd60;
            }
            .grid {
              display: grid;
              grid-template-columns: repeat(4, 210px);
              gap: 36px;
              align-items: start;
              justify-items: center;
            }
            .card {
              display: flex;
              flex-direction: column;
              align-items: center;
              gap: 14px;
              text-align: center;
            }
            .launcher-slot {
              width: 164px;
              height: 164px;
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
            }
            /* Samsung One UI Superellipse / Squircle (~76% diameter crop of maskable 512) */
            .mask-oneui {
              width: 152px;
              height: 152px;
              border-radius: 39%;
              overflow: hidden;
              box-shadow: 0 14px 28px rgba(0,0,0,0.55);
              position: relative;
            }
            .mask-oneui img {
              width: 190px;
              height: 190px;
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
            }
            /* Google Pixel Circle Mask (~76% diameter crop of maskable 512) */
            .mask-pixel {
              width: 152px;
              height: 152px;
              border-radius: 50%;
              overflow: hidden;
              box-shadow: 0 14px 28px rgba(0,0,0,0.55);
              position: relative;
            }
            .mask-pixel img {
              width: 190px;
              height: 190px;
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
            }
            /* iOS Home Screen Squircle (Full 180x180 apple-touch-icon with 22.5% radius) */
            .mask-ios {
              width: 152px;
              height: 152px;
              border-radius: 22.5%;
              overflow: hidden;
              box-shadow: 0 14px 28px rgba(0,0,0,0.55);
            }
            .mask-ios img {
              width: 100%;
              height: 100%;
              display: block;
            }
            /* Desktop / macOS / Browser Any-Purpose Icon */
            .mask-any {
              width: 156px;
              height: 156px;
              filter: drop-shadow(0 14px 24px rgba(0,0,0,0.55));
            }
            .mask-any img {
              width: 100%;
              height: 100%;
              display: block;
            }
            .app-label {
              font-size: 16px;
              font-weight: 600;
              color: #ffffff;
              text-shadow: 0 2px 6px rgba(0,0,0,0.65);
            }
            .platform-tag {
              font-size: 12px;
              font-weight: 700;
              color: #cbb8df;
              letter-spacing: 0.04em;
            }
          </style>
        </head>
        <body>
          <h1>ShredBlocks: Cross-Platform PWA Launcher Icon Verification</h1>
          <div class="grid">
            <div class="card">
              <div class="launcher-slot">
                <div class="mask-oneui">
                  <img src="data:image/png;base64,${b64Maskable}" />
                </div>
              </div>
              <div class="app-label">ShredBlocks</div>
              <div class="platform-tag">Samsung One UI (Maskable Squircle)</div>
            </div>
            <div class="card">
              <div class="launcher-slot">
                <div class="mask-pixel">
                  <img src="data:image/png;base64,${b64Maskable}" />
                </div>
              </div>
              <div class="app-label">ShredBlocks</div>
              <div class="platform-tag">Android Pixel (Maskable Circle)</div>
            </div>
            <div class="card">
              <div class="launcher-slot">
                <div class="mask-ios">
                  <img src="data:image/png;base64,${b64Apple}" />
                </div>
              </div>
              <div class="app-label">ShredBlocks</div>
              <div class="platform-tag">iOS / iPadOS (180×180 Apple Touch)</div>
            </div>
            <div class="card">
              <div class="launcher-slot">
                <div class="mask-any">
                  <img src="data:image/png;base64,${b64Any}" />
                </div>
              </div>
              <div class="app-label">ShredBlocks</div>
              <div class="platform-tag">Desktop / macOS (Any Squircle)</div>
            </div>
          </div>
        </body>
      </html>`);

    const previewPath = resolve(ARTIFACT_SCRATCH_DIR, '29-launcher-icons-preview.png');
    await previewPage.screenshot({ path: previewPath });
    await previewPage.close();
    console.log(`Generated ${previewPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
