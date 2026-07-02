/**
 * Automatically generates favicon screenshots for each public page.
 * Run: node scripts/gen-favicons.js
 * Requires the server to be running on localhost:3000.
 */

const puppeteer = require('puppeteer');
const path = require('path');

const BASE   = 'http://localhost:3000';
const OUTDIR = path.join(__dirname, '..', 'public');

// Each entry: which page to visit, output filename, and vertical scroll offset
// to capture the most visually distinctive section of that page.
// All screenshots are cropped to a centered 900×900 square from a 1280×900 viewport.
const PAGES = [
  { file: 'sponsors.html',           out: 'favicon-sponsors.png',    scrollY: 0   },
  { file: 'privacy.html',            out: 'favicon-privacy.png',     scrollY: 0   },
  { file: 'terms.html',              out: 'favicon-terms.png',       scrollY: 0   },
  { file: 'contestant-profile.html?id=b9513094-d831-4248-9131-d9d30ab9f376', out: 'favicon-profile.png', scrollY: 0 },
  { file: 'gallery.html',            out: 'favicon-gallery.png',     scrollY: 0   },
  { file: 'leaderboard.html',        out: 'favicon-leaderboard.png', scrollY: 0   },
  { file: 'vote.html',               out: 'favicon-vote.png',        scrollY: 0   },
];

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Centered crop: x offset to get a 900×900 square from 1280px wide
  const cropX = Math.floor((1280 - 900) / 2); // 190

  for (const p of PAGES) {
    process.stdout.write(`Capturing ${p.file} → ${p.out} ...`);
    try {
      await page.goto(`${BASE}/${p.file}`, {
        waitUntil: 'networkidle2',
        timeout: 20000,
      });

      if (p.scrollY) {
        await page.evaluate((y) => window.scrollTo(0, y), p.scrollY);
        await new Promise((r) => setTimeout(r, 400));
      }

      // Short pause for any CSS transitions / lazy-loaded images
      await new Promise((r) => setTimeout(r, 1000));

      await page.screenshot({
        path: path.join(OUTDIR, p.out),
        clip: { x: cropX, y: 0, width: 900, height: 900 },
      });

      console.log(' done');
    } catch (err) {
      console.log(` FAILED: ${err.message}`);
    }
  }

  await browser.close();
  console.log('\nAll favicons generated in public/');
}

run().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
