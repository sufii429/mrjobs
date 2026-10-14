# MrJobs — job posting rules

How listings get on the site, and the duplicate rule. Muse follows this every
time Mazeen forwards a job ad on WhatsApp.

## Adding a job

Jobs live in `jobs.json` (newest first is not required — any order works).
Each entry:

| field       | required | notes                                                     |
|-------------|----------|-----------------------------------------------------------|
| id          | yes      | `job-N`, N = max existing + 1                             |
| timestamp   | yes      | `YYYY-MM-DD` — posting date. Drives NEW badge + expiry    |
| company     | yes      | as written in the ad                                      |
| title       | yes      | post/role, e.g. `SPO`, `TM / STM — GYN GROUP`             |
| location    | yes      | city, UPPER CASE, e.g. `FAISALABAD`                       |
| description | yes      | areas, offers, requirements, contact person               |
| contact     | yes      | digits only, e.g. `923001234567`                          |
| applyLink   | yes      | `https://wa.me/923001234567`                              |
| featured    | yes      | `false` unless Mazeen says otherwise                      |
| image       | no       | poster path, e.g. `posters/2026-10-06-libra-pharma.jpg.b64`|

Poster images go in `posters/` as `<date>-<company>-<short>.jpg.b64`
(base64 text — the GitHub uploader cannot carry raw binary, the site decodes
it in the browser). Keep one poster per job; reuse the same file for
multi-city splits.

## Lifespan (automatic)

- **NEW badge:** first 14 days after `timestamp`.
- **Auto-expire:** listings leave the main board 28 days after `timestamp`.
- **Archive:** expired listings move to `expired-jobs.html` (app.js archive mode),
  where they stay visible for up to 90 days after `timestamp` with an EXPIRED
  badge, a "days ago" count and a note that the vacancy may already be filled.
  Archive cards keep the apply button but have no detail page / JobPosting schema.
- Nothing is ever deleted from `jobs.json` by the site — expiry only hides.

## Locations

- `location` is the base city in UPPERCASE (FAISALABAD, JHANG, ...). The site's
  location filter is built from whatever values appear in `jobs.json`.
- If an ad/poster names **no city**, use `OTHER` (Mazeen's rule, 2026-10-14) —
  e.g. the Xenrise training-program poster (job-76).
- International listings (Kenya expected via Mazeen's connection, 2026-10-14)
  go under their own city name; when the first one lands, add country support
  to the JobPosting schema (addressCountry is currently hardcoded PK in
  assets/app.js and scripts/build.py).

## Duplicate rule

A newly sent ad is a **DUPLICATE → discard it** when an existing listing has
the SAME (case-insensitive):

- company **AND**
- title **AND**
- location **AND**
- contact / applyLink

**Not duplicates — keep both:**

- Same company + title in a **different location** (separate territory) → keep.
- Same role reposted with a **different contact** → keep (new vacancy round).
- Same poster sent twice → discard the re-send.

When unsure, keep the listing and flag it to Mazeen instead of discarding.

The site also dedupes defensively at render time (first occurrence wins), so a
duplicate that slips into `jobs.json` can never show twice.

## SEO build (automatic on every deploy)

`scripts/build.py` runs as the Netlify build command (see `netlify.toml`):

- Generates one static page per **active** listing: `jobs/<id>-<slug>.html`
  (same 28-day expiry + defensive dedupe rules as the site, so expired jobs
  get no page and vanish from the sitemap automatically).
- Each page carries **JobPosting JSON-LD** (Google for Jobs eligibility),
  canonical URL, and Open Graph tags; poster images are inlined as data
  URIs so the pages need no JavaScript.
- Regenerates `sitemap.xml`: home + `all-jobs.html` + `about.html` + every
  job page with `lastmod`.
- Job cards link to their detail page via `slugify()`/`jobPageUrl()` in
  `assets/app.js` — these MUST stay identical to the Python versions in
  `scripts/build.py`, or card links will 404.

`jobs/*.html` is git-ignored: pages are build artifacts, regenerated from
`jobs.json` on every deploy. Nothing extra to do when posting a job.
