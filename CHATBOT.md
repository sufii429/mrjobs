# MrJobs conversational assistant — preview v2

The review preview now has a real conversational path in addition to the original local listing search. It is designed to answer natural-language questions, use recent conversation context, explain relevant recommendations, and cite published career guides and listing records. It cannot apply, message employers, upload CVs, or change any jobs.

## Sources and grounding

The server loads `jobs.json` and the generated `assistant-guides.json` from its own immutable Netlify deployment URL, with a short source cache. These are the same records and guides served by that deploy. Each AI call gets all listings allowed by the current/archive scope, published details, the career guides, and a bounded recent chat history. Source text is treated as untrusted data, never as instructions.

The model must distinguish general Pakistan-pharma career advice from job-specific criteria, other countries and other industries. Missing salary, eligibility, deadlines and vacancy status must not be invented. Model source IDs are validated against the permitted published records. The browser builds cards and links only from its fetched listing and guide records, never from model-created job objects or application URLs. AI can still make mistakes; the interface says to confirm details with the employer.

Date rules use UTC calendar days: current through day 28, archived after day 28 through day 90 **from posting**, and hidden after day 90. Future dates are excluded. Missing/invalid dates keep the board's existing current-listing fallback. Archived results retain the employer-status notice.

## Credentials and privacy

A dedicated `MRJOBS_OPENAI_API_KEY` is required. Configure it as a secret, with **Functions** scope and **deploy-preview** context only. Use only a provider credential explicitly authorized for MrJobs. An existing credential may be reused only with explicit user approval for this preview; never copy a development sandbox credential. `MRJOBS_OPENAI_MODEL` can optionally select a supported OpenAI model; the default is `gpt-4.1-mini`.

The endpoint explicitly refuses production context, reads only the MrJobs-specific key, and calls the official OpenAI API server-side. No key is placed in source, static assets or browser requests. The credential must be configured before deploying/redeploying the function; Node functions read the scoped runtime environment, and published source URLs are derived from trusted deployment context; a missing key produces an explicit `AI_NOT_CONFIGURED` response, not a pretend AI answer.

In conversation mode, questions and the last few chat messages are sent to the server and OpenAI with the published context. MrJobs does not persist chat history or log prompts/provider responses in this implementation. Provider processing is separate. The UI discloses this and asks visitors not to share sensitive information. Clear chat removes in-memory context and cancels an outstanding request.

Local listing-search mode sends no query to AI. If AI is unavailable, the UI explains the failure and offers an explicit local-search fallback; it never silently presents search results as an AI answer.

## Server boundaries

- Preview-only handler: `netlify/functions/job-assistant.mjs`.
- Conversation logic: `server/assistant-core.mjs`.
- POST JSON only; strict message, history, scope and total-body limits.
- Cross-origin requests rejected; no CORS permission is granted.
- Provider timeout and generic failures; no secrets or provider errors returned.
- Netlify per-IP/domain rate limiting: eight requests per minute.
- No action tools, external browsing, arbitrary source fetching, employer messaging or database writes.

Per-IP throttling is not a global spending cap. Before any separately approved production rollout, review provider limits, abuse protection and whether authentication or stronger controls are needed.

## Build and test

```sh
npm ci
npm test
python3 scripts/build.py
python3 scripts/package_site.py
npm run test:browser
```

The Netlify build now publishes only `dist/`. The public packaging script copies an allowlist of website files and generates citation-ready English/Urdu guide data. Server/function source, tests, dependencies, Git metadata and environment files are excluded from the public CDN directory.

The unit suites cover source scope, archived boundaries, source-ID checks, read-only boundaries, structured responses, request validation, preview-only operation, credential absence and provider failures. Browser tests cover desktop and two mobile sizes, original search behavior, conversation-history transport, citations, follow-ups, safe source rendering and explicit fallback. Browser AI responses are mocked; they do not establish real-provider semantic quality. Real-provider end-to-end evaluation must be completed after a project-authorized credential is supplied.

## Deployment boundary

Continue only on `feature/read-only-job-chatbot` and pull request #1's Netlify deploy preview. Do not merge, publish production, enable a production credential, or replace the live site without separate approval.
