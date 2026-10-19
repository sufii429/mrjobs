const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const http = require('node:http');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const url = 'http://127.0.0.1:8767';
const server = spawn('python3', ['-m', 'http.server', '8767', '--bind', '127.0.0.1'], { cwd: path.join(root, 'dist'), stdio: 'ignore' });
let browser;
async function main() {
  for (let i = 0; i < 50; i++) {
    try { await new Promise((resolve, reject) => { const req = http.get(url, response => { response.resume(); response.on('end', resolve); }); req.on('error', reject); }); break; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'], headless: true });
  let checks = 0;
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const page = await browser.newPage({ viewport });
    await page.clock.install({ time: new Date('2026-10-19T12:00:00Z') });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    let failure = false;
    await page.route('**/.netlify/functions/job-assistant', async route => {
      const payload = route.request().postDataJSON(); requests.push(payload);
      if (failure) return route.fulfill({ status: 503, json: { code: 'AI_UNAVAILABLE' } });
      const guideQuestion = /interview/i.test(payload.message);
      return route.fulfill({ json: {
        text: guideQuestion ? 'The published interview guide recommends researching the company, practising a short introduction and preparing questions about training. These are general Pakistan pharma interview tips, not guaranteed employer criteria.' : 'Allied Schools could be worth reviewing because the published listing explicitly encourages fresh graduates. Check the ICS / B.Com requirement in the original listing; I cannot confirm your eligibility without knowing your qualifications.',
        jobIds: guideQuestion ? [] : ['job-91', 'nonexistent-job'],
        guideIds: guideQuestion ? ['mr-interview-questions-tips'] : ['become-medical-representative-pakistan'],
        mode: 'active', followUps: guideQuestion ? [] : ['What are its requirements?']
      } });
    });
    await page.goto(url);
    await page.getByRole('button', { name: 'Ask MrJobs', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'MrJobs assistant' });
    await page.waitForFunction(() => !document.querySelector('.job-chat-send').disabled);
    const input = panel.getByLabel('Ask about jobs', { exact: true });
    await input.fill('I am a fresh graduate in Faisalabad. What could suit me?');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.job-chat-response').length === 1);
    assert.match(await panel.locator('.job-chat-answer').last().innerText(), /explicitly encourages fresh graduates/);
    assert.equal(await panel.locator('.job-chat-result').count(), 1);
    assert.equal(await panel.locator('a[href$="guide/become-medical-representative-pakistan.html"]').count(), 1);
    assert.equal(requests[0].history.length, 0);
    checks++;
    await panel.getByRole('button', { name: 'What are its requirements?', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.job-chat-response').length === 2);
    assert.equal(requests[1].history.length, 2);
    assert.match(requests[1].history[0].content, /fresh graduate/);
    checks++;
    await input.fill('How should I prepare for an MR interview?');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.job-chat-response').length === 3);
    const last = panel.locator('.job-chat-response').last();
    assert.equal(await last.locator('.job-chat-result').count(), 0);
    assert.equal(await last.locator('a[href$="guide/mr-interview-questions-tips.html"]').count(), 1);
    assert.match(await last.innerText(), /general Pakistan pharma/);
    checks++;
    failure = true;
    await input.fill('Jobs in Kenya');
    await panel.getByRole('button', { name: 'Ask', exact: true }).click();
    await panel.getByRole('button', { name: 'Search published listings instead', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.job-chat-response').length === 4);
    assert.equal(await panel.locator('.job-chat-response').last().locator('.job-chat-result').count(), 2);
    assert.match(await panel.innerText(), /AI replies are unavailable/);
    checks++;
    const dimensions = await panel.evaluate(el => { const r = el.getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom, innerWidth, innerHeight]; });
    assert.ok(dimensions[0] >= 0 && dimensions[1] <= dimensions[4] && dimensions[2] >= 0 && dimensions[3] <= dimensions[5]);
    await panel.getByRole('button', { name: 'Clear chat', exact: true }).click();
    assert.equal(await panel.locator('.job-chat-response').count(), 0);
    assert.equal(await page.evaluate(() => Object.keys(localStorage).length), 0);
    assert.deepEqual(errors, []);
    checks++;
    await page.close();
  }
  console.log('Conversation browser checks passed:', checks, '(mocked provider; desktop and two mobile sizes).');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { if (browser) await browser.close(); server.kill(); });
