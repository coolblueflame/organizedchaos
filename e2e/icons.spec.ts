/**
 * Icon rasterizer — inert in CI. Renders public/icons/icon.svg to the PNG
 * sizes the manifest needs. Run after changing the SVG:
 *   ICONS=1 npx playwright test icons --project=chromium
 */
import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.skip(!process.env.ICONS, 'icon rasterizer — set ICONS=1 to run');
test.skip(({ browserName }) => browserName !== 'chromium', 'one renderer is enough');

const SIZES: Array<[number, string, boolean]> = [
  [512, 'public/icons/icon-512.png', false],
  [192, 'public/icons/icon-192.png', false],
  [512, 'public/icons/icon-maskable-512.png', true], // safe-zone padded, full-bleed bg
  [180, 'public/icons/apple-touch-icon.png', true],  // iOS rounds corners itself
];

test('rasterize app icons', async ({ page }) => {
  const svg = readFileSync('public/icons/icon.svg', 'utf8');
  for (const [size, path, fullBleed] of SIZES) {
    // Full-bleed variants: square background (no transparent corners), icon scaled to the safe zone.
    const inner = fullBleed ? Math.round(size * 0.8) : size;
    const pad = Math.round((size - inner) / 2);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`
      <body style="margin:0;width:${size}px;height:${size}px;background:${fullBleed ? '#0b0e14' : 'transparent'}">
        <div style="padding:${pad}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div>
      </body>`);
    await page.screenshot({ path, omitBackground: !fullBleed });
  }
});
