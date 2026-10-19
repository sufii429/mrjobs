/* Run with npm run test:browser. Uses a temporary local-only static server.
 * Set CHROMIUM_PATH to a system Chromium, or run npx playwright install chromium.
 */
const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const server = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const url = 'http://127.0.0.1:8766';
const testTime = new Date('2026-10-19T12:00:00Z');
let browser;
async function run() {
  for (let i = 0; i < 50; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, response => { response.resume(); response.on('end', resolve); });
        req.on('error', reject);
      });
      break;
    } catch (_) {}
    await new Promise(r => setTimeout(r, 100));
  }
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  let checks = 0;
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const page = await browser.newPage({ viewport });
    await page.clock.install({ time: testTime });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    // Do not send test visits to existing analytics, CDNs or newsletter services.
    await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    page.on('request', req => requests.push({ url: req.url(), method: req.method() }));
    await page.goto(url);
    const launch = page.getByRole('button', { name: 'Find a job', exact: true });
    await assert.equal(await launch.getAttribute('aria-expanded'), 'false');
    await launch.click();
    const panel = page.getByRole('dialog', { name: 'MrJobs job finder' });
    await panel.waitFor({ state: 'visible' });
    const kenya = page.getByRole('button', { name: 'Jobs in Kenya', exact: true });
    await kenya.waitFor();
    await page.waitForFunction(() => !document.querySelector('.job-chat-send').disabled);
    await kenya.click();
    await page.waitForFunction(() => document.querySelectorAll('.job-chat-result').length === 2);
    assert.equal(await panel.locator('.job-chat-result').count(), 2);
    assert.match(await panel.locator('.job-chat-response').last().innerText(), /Kenya/);
    assert.equal(await panel.locator('a[href="mailto:darshini.devendra@wessexpharma.com"]').count(), 1);
    checks++;
    await panel.getByRole('button', { name: 'Data entry jobs', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.job-chat-response').length === 2);
    assert.match(await panel.locator('.job-chat-response').last().innerText(), /Allied Schools/);
    checks++;
    const input = panel.getByLabel('Ask about jobs', { exact: true });
    await input.fill('how to apply for Hoechst');
    await panel.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.job-chat-response').length === 3);
    assert.equal(await panel.locator('.job-chat-response').last().locator('a[href="mailto:adnanali.maliik@hoechst.com.pk"]').count(), 1);
    await input.fill('apply for me');
    await panel.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.job-chat-response').length === 4);
    assert.match(await panel.locator('.job-chat-response').last().innerText(), /read-only/i);
    assert.equal(await panel.locator('.job-chat-response').last().locator('.job-chat-result').count(), 0);
    checks++;
    await input.fill('<img src=x onerror=alert(1)>');
    await panel.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.job-chat-response').length === 5);
    assert.equal(await panel.locator('.job-chat-user img').count(), 0);
    checks++;
    await panel.getByRole('button', { name: 'Archived jobs', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.job-chat-response').length === 6);
    assert.equal(await panel.getByLabel('Search in', { exact: true }).inputValue(), 'archived');
    checks++;
    const geometry = await panel.evaluate(el => {
      const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y, bottom: r.bottom, w: innerWidth, h: innerHeight };
    });
    assert.ok(geometry.x >= 0 && geometry.right <= geometry.w && geometry.y >= 0 && geometry.bottom <= geometry.h);
    checks++;
    await input.press('Escape');
    assert.equal(await launch.getAttribute('aria-expanded'), 'false');
    assert.equal(await launch.evaluate(el => el === document.activeElement), true);
    await launch.click();
    await panel.getByRole('button', { name: 'Clear chat', exact: true }).click();
    assert.equal(await panel.locator('.job-chat-response').count(), 0);
    assert.equal(await panel.locator('.job-chat-user').count(), 0);
    assert.deepEqual(errors, []);
    assert.equal(requests.some(req => req.method !== 'GET'), false);
    checks++;
    await page.close();
  }
  // Archived fixtures affect network responses only, never jobs.json.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.clock.install({ time: testTime });
  const ago = days => new Date(testTime.getTime() - days * 86400000).toISOString().slice(0, 10);
  const fixture = [29, 90, 91].map(days => ({ id: 'test-' + days, timestamp: ago(days), title: 'Archived Test Role ' + days, company: 'Fixture employer', location: 'Nairobi', country: 'KE', description: 'Published test details', applyLink: 'mailto:fixture@example.org' }));
  await page.route('**/jobs.json', route => route.fulfill({ json: fixture }));
  await page.goto(url + '/expired-jobs.html');
  await page.getByRole('button', { name: 'Find a job', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.job-chat-send').disabled);
  await page.getByRole('button', { name: 'Archived jobs', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.job-chat-result').length === 2);
  assert.equal(await page.locator('.job-chat-result').count(), 2);
  assert.equal(await page.locator('.job-chat-warning').count(), 2);
  assert.match(await page.locator('.job-chat-warning').first().innerText(), /confirm the position is still open/);
  assert.equal(await page.locator('.job-chat-result a[href*="expired-jobs.html#listing-test-"]').count(), 2);
  checks++;
  await page.close();
  // Failure + retry recover without sending form data or touching employers.
  const failed = await browser.newPage();
  await failed.clock.install({ time: testTime });
  await failed.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  let fail = true;
  await failed.route('**/jobs.json', route => fail ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue());
  await failed.goto(url);
  await failed.getByRole('button', { name: 'Find a job', exact: true }).click();
  await failed.getByRole('button', { name: 'Retry loading', exact: true }).waitFor();
  fail = false;
  await failed.getByRole('button', { name: 'Retry loading', exact: true }).click();
  await failed.waitForFunction(() => !document.querySelector('.job-chat-send').disabled);
  await failed.getByRole('button', { name: 'Jobs in Kenya', exact: true }).click();
  await failed.waitForFunction(() => document.querySelectorAll('.job-chat-result').length === 2);
  checks++;
  await failed.close();
  console.log(`Browser regression checks passed: ${checks} (desktop, two mobile sizes, archive fixtures, error/retry).`);
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.kill(); });
