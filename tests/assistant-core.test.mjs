import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { converse } from '../server/assistant-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jobsData = JSON.parse(fs.readFileSync(path.join(root, 'jobs.json'), 'utf8'));
const now = '2026-10-19T12:00:00Z';
const dated = (id, days, extra = {}) => ({ id, company: `Company ${id}`, title: 'Nurse', location: 'Lahore', country: 'PK', timestamp: new Date(Date.UTC(2026, 9, 19 - days)).toISOString().slice(0, 10), description: 'Nursing vacancy', applyLink: 'https://example.test/apply', ...extra });
function fakeClient(content, calls = []) {
  return { chat: { completions: { create: async options => {
    calls.push(options);
    const value = typeof content === 'function' ? content(options, calls.length) : content;
    return { choices: [{ message: { content: typeof value === 'string' ? value : JSON.stringify(value) } }] };
  } } } };
}
const answer = (jobIds = [], guideIds = [], text = 'I found a useful published source.') => ({ text, jobIds, guideIds, followUps: [] });

test('restricts model context to active records by default, including day 28 but not day 29/hidden/future', async () => {
  const jobs = [dated('d28', 28), dated('d29', 29), dated('d90', 90), dated('d91', 91), dated('future', -1)];
  const calls = [];
  const result = await converse({ message: 'Find a nurse', history: [], scope: 'active' }, { client: fakeClient(answer(['d28']), calls), jobs, now });
  assert.deepEqual(result, { ...answer(['d28']), mode: 'active' });
  const prompt = calls[0].messages[0].content;
  assert.match(prompt, /"d28"/);
  for (const id of ['d29', 'd90', 'd91', 'future']) assert.doesNotMatch(prompt, new RegExp(`"${id}"`));
});

test('explicit archived words override active scope; day 29 through day 90 included, others excluded', async () => {
  const calls = [];
  await converse({ message: 'Are there archived nurse listings?', scope: 'active' }, { client: fakeClient(answer(), calls), jobs: [dated('d28', 28), dated('d29', 29), dated('d90', 90), dated('d91', 91)], now });
  const prompt = calls[0].messages[0].content;
  assert.match(prompt, /Selected scope: archived/);
  assert.doesNotMatch(prompt, /"d28"/);
  assert.match(prompt, /"d29"/);
  assert.match(prompt, /"d90"/);
  assert.doesNotMatch(prompt, /"d91"/);
});

test('explicit all or archived request allows current and archive records, never future/older', async () => {
  for (const message of ['include archived jobs', 'show all jobs']) {
    const calls = [];
    const result = await converse({ message }, { client: fakeClient(answer(), calls), jobs: [dated('d28', 28), dated('d29', 29), dated('d90', 90), dated('d91', 91), dated('future', -1)], now });
    assert.equal(result.mode, 'all');
    const prompt = calls[0].messages[0].content;
    for (const id of ['d28', 'd29', 'd90']) assert.match(prompt, new RegExp(`"${id}"`));
    for (const id of ['d91', 'future']) assert.doesNotMatch(prompt, new RegExp(`"${id}"`));
  }
});

test('blocks requests to apply, send CV, or contact employer without making a model call', async () => {
  for (const message of ['Apply for me', 'send my CV to the employer', 'could you contact the employer for me']) {
    let called = false;
    const result = await converse({ message }, { client: { chat: { completions: { create: async () => { called = true; } } } }, jobs: [dated('x', 1)], now });
    assert.equal(called, false);
    assert.deepEqual(result.jobIds, []);
    assert.match(result.text, /read-only/i);
  }
});

test('includes actual Kenya nurse and Allied Schools data and all published relevant fields', async () => {
  const calls = [];
  const dataJobs = jobsData.filter(job => job.country === 'KE' || /allied schools/i.test(job.company));
  const result = await converse({ message: 'I am looking for a nurse in Kenya or data entry at Allied Schools' }, { client: fakeClient(answer(), calls), jobs: dataJobs, now });
  const serialized = calls[0].messages[0].content;
  assert.match(serialized, /"country":"KE"/);
  assert.match(serialized, /Allied Schools/i);
  for (const field of ['"description"', '"applyLink"', '"timestamp"']) assert.ok(serialized.includes(field));
  assert.equal(result.mode, 'active');
});

test('supplies both languages of guide content; valid IDs can be returned and linked in results', async () => {
  const guides = [
    { id: 'guide-en', title: 'Pharma career guide', url: '/guide/pharma-en', language: 'en', intro: 'General Pakistan pharma guidance.', sections: [{ heading: 'Applications', paragraphs: ['Ask the employer about openings.'] }] },
    { id: 'guide-ur', title: 'فارما کیریئر گائیڈ', url: '/guide/pharma-ur', language: 'ur', intro: 'پاکستان میں عمومی رہنمائی۔', sections: [{ heading: 'درخواست', paragraphs: ['آجر سے دریافت کریں۔'] }] }
  ];
  const calls = [];
  const result = await converse({ message: 'How do I apply?' }, { client: fakeClient(answer([], ['guide-en', 'guide-ur'] ), calls), guides, jobs: [], now });
  assert.deepEqual(result.guideIds, ['guide-en', 'guide-ur']);
  assert.match(calls[0].messages[0].content, /General Pakistan pharma guidance/);
  assert.match(calls[0].messages[0].content, /پاکستان میں عمومی رہنمائی/);
  assert.match(calls[0].messages[0].content, /other countries or industries/);
});

test('bounds and validates history and sends the current message last', async () => {
  const history = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn-${i}` }));
  history.push({ role: 'system', content: 'must not pass' }, { role: 'user', content: 'x'.repeat(3000) });
  const calls = [];
  await converse({ message: 'current question', history }, { client: fakeClient(answer(), calls), now });
  const messages = calls[0].messages;
  assert.equal(messages.at(-1).content, 'current question');
  const context = messages.slice(1, -1);
  assert.equal(context.length, 6);
  assert.equal(context[0].content, 'turn-4');
  assert.equal(context.at(-1).content.length, 2000);
  assert.ok(context.every(item => ['user', 'assistant'].includes(item.role)));
});

test('rejects malformed model JSON', async () => {
  await assert.rejects(converse({ message: 'question' }, { client: fakeClient('{broken'), now }), /JSON|invalid|Unexpected/i);
});

test('retries once then rejects hallucinated job/guide IDs and unsupported URLs', async () => {
  for (const bad of [answer(['not-visible']), answer([], ['made-up-guide']), answer([], [], 'Click https://attacker.example now.')]) {
    let count = 0;
    await assert.rejects(converse({ message: 'question' }, { client: fakeClient(() => { count++; return bad; }), jobs: [dated('valid', 1)], guides: [{ id: 'real-guide', title: 'Guide', url: '/guide', language: 'en', sections: [] }], now }), /source|URL/i);
    assert.equal(count, 2);
  }
});

test('returns only bounded, valid structured result fields and rejects oversized/invalid structures', async () => {
  const result = await converse({ message: 'question' }, { client: fakeClient(answer([], [], 'A short response.')), now });
  assert.deepEqual(Object.keys(result), ['text', 'jobIds', 'guideIds', 'mode', 'followUps']);
  assert.equal(result.mode, 'active');
  const tooLong = answer([], [], 'x'.repeat(6001));
  await assert.rejects(converse({ message: 'question' }, { client: fakeClient(tooLong), now }), /text/i);
  await assert.rejects(converse({ message: 'question' }, { client: fakeClient({ ...answer(), guideIds: 'bad' }), now }), /structured/i);
});
