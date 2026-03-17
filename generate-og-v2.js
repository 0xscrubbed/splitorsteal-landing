const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const heroPath = path.join(__dirname, 'public/hero-cinematic.png');
const heroBase64 = fs.readFileSync(heroPath).toString('base64');
const heroBg = `data:image/png;base64,${heroBase64}`;

const variants = [
  {
    file: 'og-image-va.png',
    headline: 'Your dinner group<br>has a freeloader.',
    sub: 'This proves it.',
  },
  {
    file: 'og-image-vb.png',
    headline: 'Would you steal<br>from your friends?',
    sub: 'Find out March 22.',
  },
  {
    file: 'og-image-vc.png',
    headline: 'Someone at your<br>dinner is stealing.',
    sub: 'Now there\'s a game that proves it.',
  },
];

function buildHtml(v) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800;900&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    font-family: 'Inter', -apple-system, 'Helvetica Neue', sans-serif;
    overflow: hidden;
    position: relative;
    background: #050505;
  }
  .hero {
    position: absolute;
    inset: 0;
    background-image: url('${heroBg}');
    background-size: cover;
    background-position: center 40%;
  }
  /* Dark overlay — left heavy, feathered right */
  .overlay {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to right,
      rgba(5,5,5,0.92) 0%,
      rgba(5,5,5,0.75) 45%,
      rgba(5,5,5,0.35) 100%
    );
  }
  /* Bottom vignette */
  .vignette-bottom {
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to top,
      rgba(5,5,5,0.7) 0%,
      transparent 40%
    );
  }
  /* Content */
  .content {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 72px;
  }
  .label {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.28em;
    color: #c9a44a;
    text-transform: uppercase;
    margin-bottom: 28px;
    opacity: 0.9;
  }
  .headline {
    font-size: 68px;
    font-weight: 800;
    color: #f5f5f5;
    line-height: 1.05;
    letter-spacing: -0.03em;
    max-width: 620px;
  }
  .sub {
    font-size: 22px;
    font-weight: 400;
    color: #c9a44a;
    margin-top: 20px;
    letter-spacing: -0.01em;
  }
  /* Bottom bar */
  .bottom {
    position: absolute;
    bottom: 44px;
    left: 72px;
    right: 72px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.2em;
    color: rgba(255,255,255,0.35);
    text-transform: uppercase;
  }
  .url {
    font-size: 14px;
    font-weight: 600;
    color: rgba(201,164,74,0.6);
    letter-spacing: 0.04em;
  }
  /* Frame */
  .frame {
    position: absolute;
    inset: 0;
    border: 1px solid rgba(201,164,74,0.08);
    pointer-events: none;
  }
</style>
</head>
<body>
  <div class="hero"></div>
  <div class="overlay"></div>
  <div class="vignette-bottom"></div>
  <div class="frame"></div>
  <div class="content">
    <div class="label">Split or Steal</div>
    <div class="headline">${v.headline}</div>
    <div class="sub">${v.sub}</div>
  </div>
  <div class="bottom">
    <div class="brand">The Dinner Bill Game</div>
    <div class="url">splitsteal.app</div>
  </div>
</body>
</html>`;
}

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  for (const v of variants) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
    await page.setContent(buildHtml(v), { waitUntil: 'networkidle0' });
    // Wait for font load
    await new Promise(r => setTimeout(r, 800));
    const outPath = path.join(__dirname, 'public', v.file);
    await page.screenshot({ path: outPath, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 630 } });
    await page.close();
    console.log(`Generated ${v.file}`);
  }

  await browser.close();
  console.log('All OG images generated.');
})();
