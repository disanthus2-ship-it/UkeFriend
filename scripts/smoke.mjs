/**
 * Browser smoke test: drives the built app in Chromium with a synthesized
 * ukulele strum injected as the microphone, exercising the AudioWorklet, the
 * clock and the detector in a real browser rather than in Node.
 */
import { chromium } from 'playwright';
import path from 'node:path';

const SCRATCH = process.argv[2];
const WAV = process.argv[3];
const BASE = process.argv[4] ?? 'http://localhost:4173';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${WAV}`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-sandbox',
  ],
});

// Basic Auth for testing a password-protected deployment:
//   SMOKE_AUTH=user:password npm run smoke -- ...
const auth = process.env.SMOKE_AUTH;
const [authUser, authPass] = auth ? auth.split(':') : [];

const context = await browser.newContext({
  permissions: ['microphone'],
  viewport: { width: 1180, height: 900 },
  ...(auth ? { httpCredentials: { username: authUser, password: authPass } } : {}),
  // A TLS-terminating proxy sits in front of the real deployment; this makes
  // the .htaccess HTTPS redirect behave as it would there.
  ...(process.env.SMOKE_FORWARDED_HTTPS === '1'
    ? { extraHTTPHeaders: { 'X-Forwarded-Proto': 'https' } }
    : {}),
});
const page = await context.newPage();

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

await page.goto(BASE, { waitUntil: 'networkidle' });

// --- Browse view -----------------------------------------------------------
await page.waitForSelector('.chord-views svg');
const diagramLabel = await page.getAttribute('.chord-views svg', 'aria-label');
check('chord diagram renders with an accessible label', !!diagramLabel, diagramLabel ?? '');
check(
  'default chord C is described correctly',
  diagramLabel?.includes('C:') && diagramLabel?.includes('A string fret 3'),
  diagramLabel ?? '',
);

const svgCount = await page.locator('.chord-views svg').count();
check('both diagram and tab render', svgCount >= 2, `${svgCount} svgs`);

// Note names toggle
await page.getByLabel('Show notes').check();
await page.waitForTimeout(150);
const tealText = await page.locator('.chord-views svg text[fill="var(--teal)"]').count();
check('note-name overlay appears when toggled', tealText > 0, `${tealText} note labels`);
await page.screenshot({ path: path.join(SCRATCH, '01-chords.png'), fullPage: true });

// --- Harmony suggestions ---------------------------------------------------
const keyRows = await page.locator('.key-row .key-name').allTextContents();
check('infers a key from the default selection', keyRows.length > 0, keyRows.join(', '));
check('top key for C/F/G/Am is C major', keyRows[0]?.trim() === 'C major', keyRows[0] ?? '');

const progNames = await page.locator('.progression h3').allTextContents();
check('suggests progressions', progNames.length > 0, progNames.join(' | '));

const nextItems = await page.locator('.next-item .name').allTextContents();
check('suggests what comes next', nextItems.length > 0, nextItems.join(', '));

// --- Practice with fake microphone ----------------------------------------
// Narrow the practice set to the one chord the fixture actually plays, before
// touching the microphone: Chromium plays the fake capture file once and then
// feeds silence, so none of it should be spent navigating.
await page.getByRole('button', { name: 'Clear' }).click();
await page.locator('.chord-chip').filter({ has: page.locator('.id', { hasText: /^C$/ }) }).first().click();
const selectedCount = await page.locator('.chord-chip[aria-pressed="true"]').count();
check('practice set narrowed to one chord', selectedCount === 1, `${selectedCount} selected`);

await page.getByRole('tab', { name: 'Practice' }).click();
await page.getByRole('button', { name: 'Enable microphone' }).click();
await page.waitForSelector('button:has-text("Start practising")', { timeout: 15000 });
check('microphone starts and the engine runs', true);
await page.screenshot({ path: path.join(SCRATCH, '02-practice-ready.png'), fullPage: true });

await page.getByRole('button', { name: 'Start practising' }).click();

// Wait for the detector to hear the injected strum and register a hit.
let hit = null;
try {
  await page.waitForFunction(
    () => document.querySelector('.headline.hit')?.textContent?.includes('ms'),
    { timeout: 20000 },
  );
  hit = await page.locator('.headline.hit').first().textContent();
} catch {
  hit = null;
}
check('detects the injected chord through the real audio pipeline', !!hit, hit ?? 'no hit within 20s');

if (hit) {
  const breakdown = await page.locator('.breakdown .value').allTextContents();
  check('reports reaction, settle and total', breakdown.length === 3, breakdown.join(' / '));
}
await page.screenshot({ path: path.join(SCRATCH, '03-practice-result.png'), fullPage: true });

// --- Progress view ---------------------------------------------------------
await page.getByRole('tab', { name: 'Progress' }).click();
await page.waitForSelector('table.stats');
const statRows = await page.locator('table.stats tbody tr').count();
check('progress table records the attempt', statRows > 0, `${statRows} rows`);
await page.screenshot({ path: path.join(SCRATCH, '04-progress.png'), fullPage: true });

// --- Mobile layout ---------------------------------------------------------
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole('tab', { name: 'Chords' }).click();
await page.waitForTimeout(300);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
check('no horizontal overflow at phone width', overflow <= 0, `${overflow}px overflow`);
await page.screenshot({ path: path.join(SCRATCH, '05-mobile.png'), fullPage: true });

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
