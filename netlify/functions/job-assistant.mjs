import OpenAI from 'openai';
import { converse } from '../../server/assistant-core.mjs';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' };
const MAX_BYTES = 16000;
let contentCache;
function env(name) { return globalThis.Netlify?.env?.get(name); }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: HEADERS }); }

export async function handle(request, context = {}, dependencies = {}) {
  if (request.method !== 'POST') return json({ error: 'Use POST to ask a question.' }, 405);
  // Preview approval does not authorize enabling AI on the production site.
  if (!dependencies.allowLocal && context.deploy?.context !== 'deploy-preview') return json({ error: 'The conversational assistant is available in the review preview only.' }, 403);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'Send a JSON question.' }, 415);
  if (Number(request.headers.get('content-length')) > MAX_BYTES) return json({ error: 'This conversation is too long. Clear the chat and try again.' }, 413);
  let payload;
  try {
    // Read incrementally so an absent or dishonest Content-Length cannot bypass the cap.
    const reader = request.body?.getReader(); let size = 0, chunks = [];
    if (!reader) return json({ error: 'A question is required.' }, 400);
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return json({ error: 'This conversation is too long. Clear the chat and try again.' }, 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch (_) { return json({ error: 'The question could not be read. Please try again.' }, 400); }
  if (!payload || typeof payload.message !== 'string' || !payload.message.trim() || payload.message.length > 1200) return json({ error: 'Ask a question of up to 1,200 characters.' }, 400);
  if (payload.history !== undefined && (!Array.isArray(payload.history) || payload.history.length > 8 || payload.history.some(item => !item || !['user', 'assistant'].includes(item.role) || typeof item.content !== 'string' || item.content.length > 2000))) return json({ error: 'Conversation history is invalid. Clear the chat and try again.' }, 400);
  if (payload.scope !== undefined && !['active', 'archived', 'all'].includes(payload.scope)) return json({ error: 'Choose current or archived listings.' }, 400);

  const apiKey = env('MRJOBS_OPENAI_API_KEY');
  if (!dependencies.client && !apiKey) return json({ error: 'AI replies are not enabled in this preview yet. Published listing search is still available.', code: 'AI_NOT_CONFIGURED' }, 503);
  try {
    let content = dependencies.content;
    if (!content) {
      const deployUrl = env('DEPLOY_URL');
      if (!deployUrl || !/^https:\/\/[a-z0-9-]+\.netlify\.app$/i.test(deployUrl)) throw new Error('Invalid deployment origin');
      if (!contentCache || contentCache.origin !== deployUrl || Date.now() - contentCache.at > 30000) {
        const fetcher = dependencies.fetch || fetch;
        const responses = await Promise.all(['jobs.json', 'assistant-guides.json'].map(path => fetcher(`${deployUrl}/${path}`, { signal: AbortSignal.timeout(6000) })));
        if (responses.some(response => !response.ok)) throw new Error('Published sources unavailable');
        const [jobs, guides] = await Promise.all(responses.map(response => response.json()));
        if (!Array.isArray(jobs) || !Array.isArray(guides)) throw new Error('Invalid published sources');
        contentCache = { origin: deployUrl, at: Date.now(), jobs, guides };
      }
      content = contentCache;
    }
    const client = dependencies.client || new OpenAI({ apiKey, baseURL: 'https://api.openai.com/v1', timeout: 24000, maxRetries: 0 });
    const result = await converse(payload, { client, jobs: content.jobs, guides: content.guides, model: env('MRJOBS_OPENAI_MODEL') || 'gpt-4.1-mini', now: dependencies.now });
    return json({ ...result, engine: 'ai', disclaimer: 'AI answers use published sources and can make mistakes. Confirm vacancy details with the employer.' });
  } catch (_) {
    // No prompt, history, provider error, credential, or response body is logged/exposed.
    return json({ error: 'AI replies are temporarily unavailable. Try again, or use published listing search.', code: 'AI_UNAVAILABLE' }, 503);
  }
}

export default (request, context) => handle(request, context);
export const config = {
  path: '/.netlify/functions/job-assistant',
  rateLimit: { action: 'rate_limit', aggregateBy: ['domain', 'ip'], windowSize: 60, windowLimit: 8 }
};
