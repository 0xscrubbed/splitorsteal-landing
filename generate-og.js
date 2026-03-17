const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px;
    height: 630px;
    background: #0a0a0a;
    font-family: -apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif;
    overflow: hidden;
    position: relative;
  }

  /* Subtle radial glow in center */
  .bg-glow {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 900px;
    height: 500px;
    background: radial-gradient(ellipse at center, rgba(201,168,76,0.08) 0%, transparent 70%);
    pointer-events: none;
  }

  /* Top label */
  .top-label {
    position: absolute;
    top: 44px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.25em;
    color: #C9A84C;
    text-transform: uppercase;
    opacity: 0.85;
  }

  /* Main layout */
  .main {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    gap: 40px;
  }

  /* Card */
  .card {
    width: 220px;
    height: 300px;
    border-radius: 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    position: relative;
    border: 1.5px solid rgba(255,255,255,0.06);
  }

  .card-split {
    background: linear-gradient(145deg, #0f1f0f 0%, #0d1a0d 100%);
    box-shadow: 0 0 60px rgba(74,222,128,0.12), inset 0 1px 0 rgba(255,255,255,0.05);
    border-color: rgba(74,222,128,0.2);
  }

  .card-steal {
    background: linear-gradient(145deg, #1f0d0d 0%, #1a0d0d 100%);
    box-shadow: 0 0 60px rgba(248,113,113,0.12), inset 0 1px 0 rgba(255,255,255,0.05);
    border-color: rgba(248,113,113,0.2);
  }

  .card-icon {
    font-size: 52px;
    line-height: 1;
  }

  .card-label {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .card-split .card-label { color: #4ade80; }
  .card-steal .card-label { color: #f87171; }

  .card-desc {
    font-size: 12px;
    font-weight: 400;
    letter-spacing: 0.05em;
    text-align: center;
    padding: 0 20px;
    line-height: 1.5;
  }
  .card-split .card-desc { color: rgba(74,222,128,0.6); }
  .card-steal .card-desc { color: rgba(248,113,113,0.6); }

  /* VS divider */
  .vs {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .vs-line {
    width: 1px;
    height: 80px;
    background: linear-gradient(to bottom, transparent, rgba(201,168,76,0.4), transparent);
  }

  .vs-text {
    font-size: 18px;
    font-weight: 800;
    color: #C9A84C;
    letter-spacing: 0.05em;
  }

  /* Bottom section */
  .bottom {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 0 60px 44px;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
  }

  .tagline {
    font-size: 28px;
    font-weight: 700;
    color: #ffffff;
    line-height: 1.3;
    max-width: 520px;
    letter-spacing: -0.01em;
  }

  .tagline em {
    font-style: normal;
    color: #C9A84C;
  }

  .brand {
    text-align: right;
  }

  .brand-name {
    font-size: 16px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: #C9A84C;
    text-transform: uppercase;
  }

  .brand-url {
    font-size: 12px;
    color: rgba(255,255,255,0.3);
    letter-spacing: 0.05em;
    margin-top: 2px;
  }

  /* Subtle border frame */
  .frame {
    position: absolute;
    inset: 0;
    border: 1px solid rgba(201,168,76,0.06);
    pointer-events: none;
  }
</style>
</head>
<body>
  <div class="bg-glow"></div>
  <div class="frame"></div>

  <div class="top-label">Split or Steal</div>

  <div class="main">
    <div class="card card-split">
      <div class="card-icon">🤝</div>
      <div class="card-label">Split</div>
      <div class="card-desc">Everyone pays<br>their fair share</div>
    </div>

    <div class="vs">
      <div class="vs-line"></div>
      <div class="vs-text">VS</div>
      <div class="vs-line"></div>
    </div>

    <div class="card card-steal">
      <div class="card-icon">🃏</div>
      <div class="card-label">Steal</div>
      <div class="card-desc">They pay.<br>You walk free.</div>
    </div>
  </div>

  <div class="bottom">
    <div class="tagline">Your dinner group<br>has a <em>freeloader.</em><br>This proves it.</div>
    <div class="brand">
      <div class="brand-name">Split or Steal</div>
      <div class="brand-url">splitsteal.app</div>
    </div>
  </div>
</body>
</html>`;

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.screenshot({
    path: path.join(__dirname, 'public/og-image.png'),
    type: 'png',
    clip: { x: 0, y: 0, width: 1200, height: 630 }
  });
  await browser.close();
  console.log('OG image generated.');
})();
