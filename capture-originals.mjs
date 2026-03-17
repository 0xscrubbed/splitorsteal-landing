import puppeteer from 'puppeteer';

const screens = [
  { id: 'screen-decision', name: 'original-decision' },
  { id: 'screen-reveal', name: 'original-reveal' },
  { id: 'screen-settle', name: 'original-settlement' },
];

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 4000, deviceScaleFactor: 3 });
await page.goto('file:///Users/mitchellstuckey/.openclaw/workspace/splitorsteal-landing/mockups/app-mockups.html', { waitUntil: 'networkidle0' });
await page.evaluate(() => document.fonts.ready);
await new Promise(r => setTimeout(r, 1500));

for (const screen of screens) {
  const el = await page.$(('#' + screen.id));
  if (!el) { console.log('missing', screen.id); continue; }
  const outPath = '/Users/mitchellstuckey/.openclaw/workspace/splitorsteal-landing/public/screenshots/' + screen.name + '.png';
  await el.screenshot({ path: outPath, type: 'png' });
  console.log('done:', screen.name);
}
await browser.close();
console.log('all done');
