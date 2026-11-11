// @ts-expect-error Node built-in module resolved at runtime by tsx
import { Buffer } from 'node:buffer';
// @ts-expect-error Node built-in module resolved at runtime by tsx
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// @ts-expect-error Node built-in module resolved at runtime by tsx
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

declare const process: {
  cwd: () => string;
  env: Record<string, string | undefined>;
  exit: (code: number) => void;
};

// Preview output dir: override with VISUAL_OUT_DIR; defaults to test-results/visual
const ARTIFACT_SCRATCH_DIR = process.env.VISUAL_OUT_DIR ?? resolve(process.cwd(), 'test-results', 'visual');

/**
 * Packs multiple RGBA PNG buffers (e.g. 16x16, 32x32, 48x48) into a standard
 * multi-resolution `.ico` binary (`ICONDIR` + `ICONDIRENTRY[]` + PNG payloads)
 * for browsers, Google Search SERP favicons, and Cloudflare Pages `/favicon.ico`.
 */
function buildMultiSizeIco(entries: ReadonlyArray<{ size: number; png: Uint8Array }>): Uint8Array {
  const count = entries.length;
  const headerSize = 6 + count * 16;
  let totalSize = headerSize;
  for (const entry of entries) {
    totalSize += entry.png.byteLength;
  }

  const out = Buffer.alloc(totalSize);
  out.writeUInt16LE(0, 0); // Reserved
  out.writeUInt16LE(1, 2); // Resource type: 1 = ICO
  out.writeUInt16LE(count, 4); // Image count

  let dataOffset = headerSize;
  for (let i = 0; i < count; i++) {
    const { size, png } = entries[i];
    const dirOffset = 6 + i * 16;
    out.writeUInt8(size >= 256 ? 0 : size, dirOffset);
    out.writeUInt8(size >= 256 ? 0 : size, dirOffset + 1);
    out.writeUInt8(0, dirOffset + 2); // Palette count (0 = truecolor)
    out.writeUInt8(0, dirOffset + 3); // Reserved
    out.writeUInt16LE(1, dirOffset + 4); // Color planes
    out.writeUInt16LE(32, dirOffset + 6); // 32 bits per pixel
    out.writeUInt32LE(png.byteLength, dirOffset + 8);
    out.writeUInt32LE(dataOffset, dirOffset + 12);
    Buffer.from(png).copy(out, dataOffset);
    dataOffset += png.byteLength;
  }
  return out;
}

async function main(): Promise<void> {
  const publicDir = resolve(process.cwd(), 'public');
  mkdirSync(ARTIFACT_SCRATCH_DIR, { recursive: true });

  const svgAny = readFileSync(resolve(publicDir, 'icon.svg'), 'utf8') as string;
  const svgMaskable = readFileSync(resolve(publicDir, 'icon-maskable.svg'), 'utf8') as string;
  const frauncesB64 = (
    readFileSync(resolve(publicDir, 'fonts', 'fraunces-latin-var.woff2')) as {
      toString: (enc: string) => string;
    }
  ).toString('base64');
  const jakartaB64 = (
    readFileSync(resolve(publicDir, 'fonts', 'plus-jakarta-sans-latin-var.woff2')) as {
      toString: (enc: string) => string;
    }
  ).toString('base64');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const renderSvgToPngBuffer = async (
      svgMarkup: string,
      size: number,
      omitBackground: boolean
    ): Promise<Uint8Array> => {
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
      const buf = (await page.screenshot({ type: 'png', omitBackground })) as Uint8Array;
      await page.close();
      return buf;
    };

    const renderSvgToPng = async (
      svgMarkup: string,
      size: number,
      outPath: string,
      omitBackground: boolean
    ): Promise<Uint8Array> => {
      const buf = await renderSvgToPngBuffer(svgMarkup, size, omitBackground);
      writeFileSync(outPath, buf);
      console.log(`Generated ${outPath} (${size}x${size})`);
      return buf;
    };

    // 1. Standard Any-purpose App Icons (transparent corners outside squircle)
    await renderSvgToPng(svgAny, 192, resolve(publicDir, 'icon-192.png'), true);
    await renderSvgToPng(svgAny, 512, resolve(publicDir, 'icon-512.png'), true);

    // 2. Maskable Full-Bleed App Icons (Android / Samsung One UI / Pixel)
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

    // 4. Cloudflare Pages & Google SERP Favicons (favicon.ico 16/32/48 + PNG 32 & 48)
    const png16 = await renderSvgToPngBuffer(svgAny, 16, true);
    const png32 = await renderSvgToPng(svgAny, 32, resolve(publicDir, 'favicon-32x32.png'), true);
    const png48 = await renderSvgToPng(svgAny, 48, resolve(publicDir, 'favicon-48x48.png'), true);
    const icoBytes = buildMultiSizeIco([
      { size: 16, png: png16 },
      { size: 32, png: png32 },
      { size: 48, png: png48 },
    ]);
    const icoPath = resolve(publicDir, 'favicon.ico');
    writeFileSync(icoPath, icoBytes);
    console.log(`Generated ${icoPath} (16x16, 32x32, 48x48 multi-size ICO, ${icoBytes.byteLength} bytes)`);

    // 5. Open Graph / Social Media Link Preview Card (1200x630 featuring the updated Zen Mystic App Icon)
    const b64Any512 = (
      readFileSync(resolve(publicDir, 'icon-512.png')) as { toString: (enc: string) => string }
    ).toString('base64');
    const ogPage = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    await ogPage.setContent(`<!doctype html>
      <html>
        <head>
          <style>
            @font-face {
              font-family: "Fraunces";
              src: url("data:font/woff2;base64,${frauncesB64}") format("woff2");
              font-weight: 400 900;
              font-style: normal;
            }
            @font-face {
              font-family: "Plus Jakarta Sans";
              src: url("data:font/woff2;base64,${jakartaB64}") format("woff2");
              font-weight: 400 800;
              font-style: normal;
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            html, body {
              width: 1200px;
              height: 630px;
              overflow: hidden;
              font-family: "Plus Jakarta Sans", -apple-system, sans-serif;
              color: #fdf8f2;
              background:
                radial-gradient(circle at 24% 50%, rgba(255, 226, 152, 0.34) 0%, rgba(214, 108, 252, 0.24) 26%, rgba(140, 64, 214, 0.08) 46%, transparent 66%),
                radial-gradient(circle at 82% 18%, rgba(246, 189, 96, 0.14) 0%, transparent 44%),
                linear-gradient(135deg, #120e24 0%, #241944 46%, #3d2459 80%, #58325d 100%);
              position: relative;
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 56px 76px;
            }
            .astrolabe-bg {
              position: absolute;
              left: 268px;
              top: 315px;
              width: 496px;
              height: 496px;
              transform: translate(-50%, -50%);
              pointer-events: none;
              opacity: 0.52;
            }
            .border-frame {
              position: absolute;
              inset: 18px;
              border-radius: 26px;
              border: 1.5px solid rgba(248, 209, 138, 0.24);
              box-shadow: inset 0 1px 0 rgba(255, 248, 234, 0.14);
              pointer-events: none;
            }
            .icon-stage {
              position: relative;
              z-index: 2;
              width: 380px;
              height: 380px;
              flex-shrink: 0;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .icon-stage img {
              width: 368px;
              height: 368px;
              display: block;
              filter: drop-shadow(0 22px 38px rgba(7, 4, 18, 0.72));
            }
            .copy-col {
              position: relative;
              z-index: 2;
              flex: 1;
              padding-left: 64px;
              display: flex;
              flex-direction: column;
              align-items: flex-start;
              justify-content: center;
              gap: 18px;
            }
            .eyebrow {
              display: inline-flex;
              align-items: center;
              gap: 10px;
              padding: 7px 15px;
              border-radius: 999px;
              background: rgba(16, 11, 34, 0.62);
              border: 1px solid rgba(246, 206, 130, 0.34);
              font-size: 13px;
              font-weight: 700;
              letter-spacing: 0.18em;
              text-transform: uppercase;
              color: #f7d283;
            }
            .wordmark {
              font-family: "Fraunces", Georgia, serif;
              font-weight: 800;
              font-variation-settings: "SOFT" 60, "WONK" 0;
              font-size: 82px;
              line-height: 0.98;
              letter-spacing: -0.02em;
              text-shadow: 0 8px 24px rgba(8, 5, 20, 0.68);
            }
            .word-shred { color: #fffbf4; }
            .word-blocks {
              background: linear-gradient(180deg, #ffeaa0 0%, #f5be58 58%, #df9228 100%);
              -webkit-background-clip: text;
              background-clip: text;
              color: transparent;
            }
            .subtitle-row {
              display: flex;
              align-items: center;
              gap: 14px;
              margin-top: -4px;
            }
            .subtitle-line {
              width: 44px;
              height: 1.5px;
              background: linear-gradient(90deg, rgba(246, 206, 130, 0.75), rgba(246, 206, 130, 0.08));
            }
            .subtitle-text {
              font-size: 18px;
              font-weight: 700;
              letter-spacing: 0.36em;
              color: #f3d499;
              text-transform: uppercase;
            }
            .tagline {
              font-size: 23px;
              font-weight: 500;
              line-height: 1.42;
              color: #e9dff5;
              max-width: 560px;
              margin-top: 4px;
            }
            .pills {
              display: flex;
              flex-wrap: wrap;
              gap: 12px;
              margin-top: 8px;
            }
            .pill {
              padding: 10px 18px;
              border-radius: 12px;
              background: linear-gradient(180deg, rgba(68, 52, 112, 0.88) 0%, rgba(40, 29, 72, 0.94) 100%);
              box-shadow: inset 0 1px 0 rgba(255, 248, 236, 0.22), 0 3px 0 rgba(8, 5, 18, 0.65);
              font-size: 15px;
              font-weight: 700;
              letter-spacing: 0.03em;
              color: #fffaf2;
            }
            .pill-jade {
              background: linear-gradient(180deg, #3ce4d0 0%, #179b8d 100%);
              box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42), 0 3px 0 #0c5852;
              color: #072826;
            }
          </style>
        </head>
        <body>
          <div class="border-frame"></div>
          <svg class="astrolabe-bg" viewBox="0 0 600 600" fill="none">
            <circle cx="300" cy="300" r="286" stroke="#F8CF7A" stroke-width="1.6" stroke-dasharray="5 9" stroke-opacity="0.65" />
            <circle cx="300" cy="300" r="262" stroke="#F8CF7A" stroke-width="1.8" stroke-opacity="0.72" />
            <circle cx="300" cy="300" r="232" stroke="#DA8BFF" stroke-width="1.4" stroke-dasharray="10 7" stroke-opacity="0.55" />
            <rect x="112" y="112" width="376" height="376" stroke="#F8CF7A" stroke-width="1.3" stroke-opacity="0.45" transform="rotate(45 300 300)" />
            <polygon points="300,4 309,24 300,42 291,24" fill="#FFE4A0" fill-opacity="0.9" />
            <polygon points="300,558 309,576 300,596 291,576" fill="#FFE4A0" fill-opacity="0.9" />
            <polygon points="4,300 24,309 42,300 24,291" fill="#FFE4A0" fill-opacity="0.9" />
            <polygon points="558,300 576,309 596,300 576,291" fill="#FFE4A0" fill-opacity="0.9" />
          </svg>
          <div class="icon-stage">
            <img src="data:image/png;base64,${b64Any512}" alt="" />
          </div>
          <div class="copy-col">
            <div class="eyebrow">✦ Tactile 3D Sanctuary Puzzle</div>
            <div class="wordmark"><span class="word-shred">Shred</span><span class="word-blocks">Blocks</span></div>
            <div class="subtitle-row">
              <span class="subtitle-text">Color Jam</span>
              <span class="subtitle-line"></span>
            </div>
            <p class="tagline">Slide tactile 3D blocks across mystic sanctuary courtyards into matching perimeter shredder gates.</p>
            <div class="pills">
              <span class="pill pill-jade">▶ Play Free Instant PWA</span>
              <span class="pill">300+ Puzzles</span>
              <span class="pill">Challenge &amp; Zen Modes</span>
              <span class="pill">Zero Ads · Offline</span>
            </div>
          </div>
        </body>
      </html>`);
    await ogPage.evaluate('document.fonts.ready');
    const ogPath = resolve(publicDir, 'og-image.png');
    const ogBuf = (await ogPage.screenshot({ type: 'png' })) as Uint8Array;
    writeFileSync(ogPath, ogBuf);
    await ogPage.close();
    console.log(`Generated ${ogPath} (1200x630, ${ogBuf.byteLength} bytes)`);

    // 6. Render Cross-Platform Launcher Mask Preview Sheet for Visual & UX Review
    const previewPage = await browser.newPage({
      viewport: { width: 1080, height: 520 },
      deviceScaleFactor: 2,
    });
    const b64Maskable = (
      readFileSync(resolve(publicDir, 'icon-maskable-512.png')) as {
        toString: (enc: string) => string;
      }
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
            h1 { font-size: 22px; letter-spacing: 0.08em; text-transform: uppercase; color: #f6bd60; }
            .grid { display: grid; grid-template-columns: repeat(4, 210px); gap: 36px; align-items: start; justify-items: center; }
            .card { display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; }
            .launcher-slot { width: 164px; height: 164px; display: flex; align-items: center; justify-content: center; position: relative; }
            .mask-oneui, .mask-pixel { width: 152px; height: 152px; overflow: hidden; box-shadow: 0 14px 28px rgba(0,0,0,0.55); position: relative; }
            .mask-oneui { border-radius: 39%; }
            .mask-pixel { border-radius: 50%; }
            .mask-oneui img, .mask-pixel img { width: 190px; height: 190px; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); }
            .mask-ios { width: 152px; height: 152px; border-radius: 22.5%; overflow: hidden; box-shadow: 0 14px 28px rgba(0,0,0,0.55); }
            .mask-ios img, .mask-any img { width: 100%; height: 100%; display: block; }
            .mask-any { width: 156px; height: 156px; filter: drop-shadow(0 14px 24px rgba(0,0,0,0.55)); }
            .app-label { font-size: 16px; font-weight: 600; color: #ffffff; text-shadow: 0 2px 6px rgba(0,0,0,0.65); }
            .platform-tag { font-size: 12px; font-weight: 700; color: #cbb8df; letter-spacing: 0.04em; }
          </style>
        </head>
        <body>
          <h1>ShredBlocks: Zen Mystic Cross-Platform PWA Icon Verification</h1>
          <div class="grid">
            <div class="card"><div class="launcher-slot"><div class="mask-oneui"><img src="data:image/png;base64,${b64Maskable}" /></div></div><div class="app-label">ShredBlocks</div><div class="platform-tag">Samsung One UI (Maskable Squircle)</div></div>
            <div class="card"><div class="launcher-slot"><div class="mask-pixel"><img src="data:image/png;base64,${b64Maskable}" /></div></div><div class="app-label">ShredBlocks</div><div class="platform-tag">Android Pixel (Maskable Circle)</div></div>
            <div class="card"><div class="launcher-slot"><div class="mask-ios"><img src="data:image/png;base64,${b64Apple}" /></div></div><div class="app-label">ShredBlocks</div><div class="platform-tag">iOS / iPadOS (180×180 Apple Touch)</div></div>
            <div class="card"><div class="launcher-slot"><div class="mask-any"><img src="data:image/png;base64,${b64Any512}" /></div></div><div class="app-label">ShredBlocks</div><div class="platform-tag">Desktop / macOS (Any Squircle)</div></div>
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
