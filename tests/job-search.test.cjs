const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { status, search, answer, safeApplyLink, countryName } = require('../assets/job-search.js');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../jobs.json'), 'utf8'));
const now = '2026-10-19T12:00:00Z';

test('UTC age boundaries, invalid and future dates', () => {
  for (const [day, state] of [[28, 'active'], [29, 'archived'], [90, 'archived'], [91, 'hidden']]) {
    const date = new Date(Date.UTC(2026, 9, 19 - day)).toISOString().slice(0, 10);
    assert.equal(status({ timestamp: date }, now), state);
  }
  assert.equal(status({ timestamp: 'broken' }, now), 'active');
  assert.equal(require('../assets/job-search.js').statusInfo({ timestamp: 'broken' }, now).isNew, false);
  assert.equal(status({ timestamp: '2026-10-20' }, now), 'hidden');
});

test('default active, explicit archive/all and duplicate defense', () => {
  const job = { id: 'x', timestamp: '2026-09-01', company: 'A', title: 'B', location: 'C' };
  assert.equal(search([job, job], '', { now }).total, 0);
  assert.equal(search([job, job], 'archived', { now }).total, 1);
  assert.equal(search([job, job], '', { now, mode: 'all' }).total, 1);
});

test('published field search, country codes, Pakistan disambiguation and conversational phrasing', () => {
  assert.ok(search(data, 'jobs in Kenya', { now }).jobs.some(job => job.country === 'KE'));
  assert.ok(search(data, 'KE', { now }).jobs.every(job => job.country === 'KE'));
  assert.ok(search(data, 'data entry in Sahiwal', { now }).jobs.some(job => job.company === 'Allied Schools'));
  assert.ok(search(data, 'salary at Getz', { now }).jobs.some(job => /getz/i.test(job.company)));
  assert.ok(search(data, 'can you tell me do you have current opportunities in Pakistan', { now }).jobs.every(job => !job.country || job.country === 'PK'));
  assert.equal(search([{ country: 'KE', title: 'Medical job', description: 'Salary package in Pakistan', timestamp: '2026-10-01' }], 'Pakistan', { now }).total, 0);
  assert.equal(search([{ country: 'KE', title: 'A job', description: 'x', timestamp: '2026-10-01' }], 'KE', { now }).total, 1);
  assert.equal(search([{ country: 'KE', title: 'A job', description: 'x', timestamp: '2026-10-01' }], 'PK', { now }).total, 0);
  assert.equal(countryName(data.find(job => job.country === 'KE')), 'Kenya');
});

test('fresh graduate means a published fresh/fresher graduate phrase, not any degree graduate', () => {
  const jobs = [
    { title: 'Degree graduate role', description: 'Minimum requirement is graduation degree', timestamp: '2026-10-01' },
    { title: 'Fresh candidate', description: 'Graduation degree; fresh candidate can apply', timestamp: '2026-10-02' },
    { title: 'Fresher graduates', description: 'Open to fresher graduates', timestamp: '2026-10-03' }
  ];
  assert.equal(search(jobs, 'fresh graduate', { now }).total, 2);
  assert.equal(search(jobs, 'graduate', { now }).total, 3);
});

test('email application queries strictly return mailto listings', () => {
  const result = search(data, 'jobs with email applications', { now });
  assert.ok(result.total > 0);
  assert.ok(result.jobs.every(job => /^mailto:/i.test(job.applyLink || '')));
});

test('published nurse and how-to-apply details', () => {
  assert.ok(search(data, 'nurse', { now }).jobs.some(job => job.country === 'KE'));
  const details = answer(data, 'how to apply for Hoechst', { now });
  assert.ok(details.jobs.some(job => /hoechst/i.test(job.company)));
  assert.match(details.text, /published job details/i);
  assert.equal(search(data, 'apply jobs', { now }).total, search(data, '', { now }).total);
});

test('safe links preserve exact trimmed published URL while validating protocols', () => {
  assert.equal(safeApplyLink('javascript:alert(1)'), null);
  assert.equal(safeApplyLink('data:text/html,x'), null);
  assert.equal(safeApplyLink('https://user:pw@example.org'), null);
  assert.equal(safeApplyLink(' https://example.org '), 'https://example.org');
  assert.equal(safeApplyLink('mailto:a@example.org'), 'mailto:a@example.org');
  assert.equal(safeApplyLink('http://[bad'), null);
});

test('unsupported constraints do not recommend unrelated results; no mutation; block applying without results', () => {
  const copy = JSON.stringify(data);
  assert.equal(search(data, 'underwater basket weaving', { now }).total, 0);
  assert.equal(JSON.stringify(data), copy);
  const blocked = answer(data, 'apply for me', { now });
  assert.equal(blocked.kind, 'blocked');
  assert.equal(blocked.total, 0);
  assert.deepEqual(blocked.jobs, []);
  assert.notEqual(answer(data, 'how to apply for Hoechst', { now }).kind, 'blocked');
});
