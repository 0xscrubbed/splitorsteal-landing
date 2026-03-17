import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const screens = [
  { id: 'screen-onboard-1', name: '01-onboarding-everyone-picks' },
  { id: 'screen-onboard-2', name: '02-onboarding-game-theory' },
  { id: 'screen-onboard-3', name: '03-onboarding-get-started' },
  { id: 'screen-home', name: '04-home-dashboard' },
  { id: 'screen-create', name: '05-create-game' },
  { id: 'screen-decision', name: '06-the-decision' },
  { id: 'screen-reveal', name: '07-the-reveal' },
  { id: 'screen-chaos', name: '08-chaos-mode' },
  { id: 'screen-settle', name: '09-settlement' },
  { id: 'screen-share', name: '10-share-results' },
];

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Set high DPI for crisp renders
  await page.setViewport({ width: 1600, height: 4000, deviceScaleFactor: 3 });

  const htmlPath = join(__dirname, 'app-mockups.html');
  await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

  // Wait for fonts
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 1000));

  const outDir = join(__dirname, 'screenshots');

  for (const screen of screens) {
    const el = await page.$(`#${screen.id}`);
    if (!el) {
      console.log(`⚠️  Element #${screen.id} not found, skipping`);
      continue;
    }

    const outPath = join(outDir, `${screen.name}.png`);
    await el.screenshot({ path: outPath, type: 'png' });
    console.log(`✅ ${screen.name}.png`);
  }

  await browser.close();
  console.log(`\nDone! ${screens.length} screenshots saved to ${outDir}`);
})();
