# MrJobs read-only job finder

A small chat-style search panel for the existing static website. It reads the same `jobs.json` as the board; no job records are edited. It is a deterministic listing search, not a generative AI service. No API key, server function, chat database or paid model is required.

## What it does

Visitors can search across all published employers, roles, locations, countries and industries. Current listings are the default. Each result includes published details, requirements, salary when provided, and the original application link, including email links. Unknown details are not invented. Clicking an application link is the visitor's choice; the finder never applies or contacts anyone.

Archived listings have the board's notice to check current status with the employer. Using UTC calendar dates, postings remain current through day 28, move to the archive after day 28, and remain searchable through day 90 **after posting**, not 90 days after expiry. Older and future-dated listings are excluded. Missing or invalid dates retain the board's current-listing fallback.

The interface has keyboard labels, Escape-to-close, focus restoration, mobile layouts, result pagination, load-error retry and a clear-chat action. Searches and chat history stay in memory in the visitor's browser and disappear on reload. The existing site's analytics and newsletter remain separate and unchanged; the finder sends no chat queries to them.

## Files and integration

- `assets/job-search.js`: reusable, dependency-free browser/CommonJS search engine.
- `assets/job-chat.js` and `assets/job-chat.css`: local search interface.
- Existing root and blog pages include these assets, as do the job and guide page templates in `scripts/build.py`.
- `assets/app.js` shares the search engine's visibility boundaries and adds listing anchors for source links. Job data and application links remain unchanged.

## Run and test

The existing Netlify build remains `python3 scripts/build.py`. Nothing is published by these test commands.

```sh
npm ci
npm test
# Either install a test browser or use a system Chromium.
npx playwright install chromium
npm run test:browser
# Alternative: CHROMIUM_PATH=/path/to/chromium npm run test:browser
```

The browser suite starts a temporary loopback-only HTTP server. It blocks external requests, checks desktop and two mobile sizes, verifies real Kenya and school/data-entry listings, email links, read-only handling, safe text rendering, keyboard behavior, archive-boundary fixtures, and loading failure/retry. Archive fixtures intercept test responses; they do not alter `jobs.json`.

For manual review, run `python3 scripts/build.py` then `python3 -m http.server 8765 --bind 127.0.0.1` from the project directory and visit `http://127.0.0.1:8765`.

## Limits

This is listing-grounded keyword and intent matching, not an unrestricted conversational model. It does not independently verify vacancies, infer missing salary/eligibility details, monitor employers, parse poster images, accept CVs, apply for jobs or send messages. Published country codes are used when present; omitted country defaults to Pakistan, matching the current board. Existing published descriptions are searchable across industries without an industry allowlist.

## Publishing

This work is local and unpublished. Do not push to the production-connected branch or deploy to Netlify until separately approved.
