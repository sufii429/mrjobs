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
- **Auto-expire:** listings disappear from the site 28 days after `timestamp`.
- Nothing is ever deleted from `jobs.json` by the site — expiry only hides.

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
