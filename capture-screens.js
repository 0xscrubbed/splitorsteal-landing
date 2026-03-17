/**
 * capture-screens.js
 * Captures Split or Steal app mockups as App Store-ready PNGs
 * iPhone 15 Pro Max: 1290 × 2796 pixels (3x scale)
 *
 * Usage: node capture-screens.js
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const MOCKUP_PATH = path.join(__dirname, 'mockups', 'app-mockups.html');
const OUT_DIR = path.join(__dirname, 'mockups', 'screenshots');

// Screens to capture: { id, filename, desc }
// iPhone 15 Pro = 393×852 @3x (actual render at 1179×2556 → closest App Store size: 1290×2796 with scale 3.28)
// We render at 393×852 CSS pixels with deviceScaleFactor=3 → 1179×2556
// For App Store max quality, use deviceScaleFactor=3.28 → exactly 1290×2796

const SCREENS = [
  { id: 'screen-ob1',      file: '01-onboarding-1-everyone-picks.png',   label: 'Onboarding 1' },
  { id: 'screen-ob2',      file: '02-onboarding-2-the-math.png',          label: 'Onboarding 2' },
  { id: 'screen-ob3',      file: '03-onboarding-3-get-started.png',       label: 'Onboarding 3' },
  { id: 'screen-home',     file: '04-home-dashboard.png',                 label: 'Home' },
  { id: 'screen-decision', file: '05-decision-split-or-steal.png',        label: 'Decision' },
  { id: 'screen-reveal',   file: '06-reveal-someone-stole.png',           label: 'Reveal' },
  { id: 'screen-settle',   file: '07-settlement-pay-up.png',              label: 'Settlement' },
];

// iPhone 15 Pro logical size
const PHONE_W = 393;
const PHONE_H = 852;
const PHONE_PADDING = 12; // frame padding each side
// Total phone frame = 393 + (12*2) border = 417 wide, 852 + (12*2) = 876 tall

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // Set viewport to full mockup page
  await page.setViewport({ width: 1600, height: 1200, deviceScaleFactor: 1 });
  await page.goto(`file://${MOCKUP_PATH}`, { waitUntil: 'networkidle0' });

  // Wait for fonts
  await new Promise(r => setTimeout(r, 2000));

  let captured = 0;
  let failed = 0;

  for (const screen of SCREENS) {
    try {
      const el = await page.$(`#${screen.id}`);
      if (!el) {
        console.warn(`  ⚠️  Element #${screen.id} not found — skipping`);
        failed++;
        continue;
      }

      const outPath = path.join(OUT_DIR, screen.file);

      // Get bounding box of the phone frame element
      const box = await el.boundingBox();

      // Capture at 3x for App Store quality (1179×2556 — accepted for iPhone 15 Pro)
      await page.setViewport({
        width: Math.ceil(box.x + box.width + 20),
        height: Math.ceil(box.y + box.height + 20),
        deviceScaleFactor: 3,
      });

      await el.screenshot({
        path: outPath,
        type: 'png',
      });

      // Get file size
      const stat = fs.statSync(outPath);
      const kb = Math.round(stat.size / 1024);
      console.log(`  ✓  ${screen.label} → ${screen.file} (${kb}KB)`);
      captured++;

    } catch (err) {
      console.error(`  ✗  ${screen.id}: ${err.message}`);
      failed++;
    }
  }

  await browser.close();

  console.log(`\nDone. ${captured} captured, ${failed} failed.`);
  console.log(`Output: ${OUT_DIR}`);

  if (captured > 0) {
    console.log('\nApp Store sizes:');
    console.log('  iPhone 15 Pro Max accepted: 1290 × 2796 px');
    console.log('  These files: ~1179 × 2556 px (iPhone 15 Pro @3x)');
    console.log('  Both are accepted by App Store Connect.');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
