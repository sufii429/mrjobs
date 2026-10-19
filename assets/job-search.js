/* MrJobs local read-only listing search. Browser UMD + CommonJS, no dependencies.
 * status: UTC calendar age; active through day 28, archived through day 90 from
 * posting, older/future hidden. Invalid dates remain active but are never new.
 * Dedupe uses the board's compound id/company/title/location/applyLink key.
 * No network, persistence, job mutation, inferred salary, or employer contact.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MrJobsSearch = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STOP = new Set(('a an the is are at in on for of to with and or me i my find show give get want looking please job jobs vacancy vacancies position positions latest newest recent new archived archive include all search what which any salary pay how apply applying send contact email message whatsapp employer behalf can you tell do have opportunities opportunity current expired requirements requirement qualifications qualification experience application applications details about only using via').split(' '));
  const SYN = {
    nurse: ['nurse', 'nursing'], nursing: ['nurse', 'nursing'],
    school: ['school', 'schools', 'education'], education: ['school', 'schools', 'education'],
    pharma: ['pharma', 'pharmaceutical', 'pharmaceuticals'],
    graduate: ['graduate', 'graduates', 'graduation'],
    graduates: ['graduate', 'graduates', 'graduation']
  };
  // Recognize country names even when that country currently has no listings.
  // ISO codes from the data remain exact matches, never substrings of job text.
  const regionNames = new Map();
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let first = 65; first <= 90; first++) {
      for (let second = 65; second <= 90; second++) {
        const code = String.fromCharCode(first, second), name = display.of(code);
        if (name && name !== code) regionNames.set(name.toLowerCase(), code.toLowerCase());
      }
    }
  } catch (_) { /* Dataset-provided aliases remain available in older browsers. */ }
  function dateOnly(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
    return date.getUTCFullYear() === +match[1] && date.getUTCMonth() + 1 === +match[2] && date.getUTCDate() === +match[3] ? date : null;
  }
  function age(job, now) {
    const posted = dateOnly(job && job.timestamp);
    const current = now === undefined ? new Date() : new Date(now);
    if (!posted || Number.isNaN(+current)) return null;
    return Math.floor((Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()) - posted.getTime()) / 86400000);
  }
  function status(job, now) {
    const days = age(job, now);
    if (days === null) return 'active';
    if (days < 0 || days > 90) return 'hidden';
    return days <= 28 ? 'active' : 'archived';
  }
  function statusInfo(job, now) {
    const state = status(job, now), days = age(job, now);
    return { state, active: state === 'active', archived: state === 'archived', hidden: state === 'hidden', isNew: state === 'active' && days !== null && days <= 14, days };
  }
  function countryName(job) {
    const code = String(job && job.country || 'PK').trim().toUpperCase();
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; }
    catch (_) { return code; }
  }
  function safeApplyLink(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const source = value.trim();
    try {
      const url = new URL(source);
      if (!['http:', 'https:', 'mailto:'].includes(url.protocol) || url.username || url.password) return null;
      if (/[\u0000-\u001f\u007f]/.test(source)) return null;
      if (url.protocol === 'mailto:' && !url.pathname) return null;
      return source; // Preserve the published link, rather than reconstructing it.
    } catch (_) { return null; }
  }
  function termsFrom(query) {
    return String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[\p{L}\p{N}]+/gu) || [];
  }
  function search(jobs, query, options) {
    options = options || {};
    const raw = termsFrom(query);
    const archiveIntent = raw.some(term => ['archived', 'archive', 'expired'].includes(term));
    const allIntent = archiveIntent && (raw.includes('include') || raw.includes('all') || raw.includes('current'));
    const mode = allIntent ? 'all' : archiveIntent ? 'archived' : raw.includes('current') ? 'active' : options.mode || 'active';
    const normalized = raw.filter(term => !STOP.has(term));
    const emailOnly = /\b(?:email|e-mail|mail)\b/i.test(query || '') && /\b(?:applications?|apply|jobs?|vacancies|opportunities)\b/i.test(query || '');
    const freshIntent = raw.includes('fresh') || raw.includes('fresher') || raw.includes('freshers');
    const graduateIntent = raw.includes('graduate') || raw.includes('graduates');
    const seen = new Set(), unique = [];
    const countryAliases = new Map();
    for (const job of Array.isArray(jobs) ? jobs : []) {
      if (!job || typeof job !== 'object') continue;
      const key = [job.id, job.company, job.title, job.location, job.applyLink].map(value => String(value == null ? '' : value).trim().toLowerCase()).join('|');
      if (seen.has(key)) continue;
      seen.add(key); unique.push(job);
      const code = String(job.country || 'PK').trim().toLowerCase();
      for (const alias of [code, ...termsFrom(countryName(job))]) {
        if (!countryAliases.has(alias)) countryAliases.set(alias, new Set());
        countryAliases.get(alias).add(code);
      }
    }
    let selected = unique.filter(job => {
      const state = status(job, options.now);
      if (!(mode === 'all' ? state !== 'hidden' : state === (mode === 'archived' ? 'archived' : 'active'))) return false;
      if (emailOnly && !/^mailto:/i.test(String(job.applyLink || '').trim())) return false;
      const code = String(job.country || 'PK').trim().toLowerCase();
      const haystack = [job.company, job.title, job.location, job.description, job.salary].filter(Boolean).join(' ').toLowerCase();
      if (freshIntent && !/\bfresh(?:er|ers)?\b/.test(haystack)) return false;
      if (freshIntent && graduateIntent && !/\bgraduat(?:e|es|ion)\b/.test(haystack)) return false;
      return normalized.every(term => {
        if (freshIntent && ['fresh', 'fresher', 'freshers', 'graduate', 'graduates'].includes(term)) return true;
        if (countryAliases.has(term)) return countryAliases.get(term).has(code);
        if (regionNames.has(term)) return regionNames.get(term) === code;
        return (SYN[term] || [term]).some(alternative => haystack.includes(alternative));
      });
    });
    selected.sort((a, b) => {
      // In combined searches, keep current listings easy to find.
      if (mode === 'all' && status(a, options.now) !== status(b, options.now)) return status(a, options.now) === 'active' ? -1 : 1;
      const dateA = dateOnly(a.timestamp), dateB = dateOnly(b.timestamp);
      return (dateB ? dateB.getTime() : -Infinity) - (dateA ? dateA.getTime() : -Infinity);
    });
    return { jobs: selected, total: selected.length, mode, terms: normalized };
  }
  function answer(jobs, query, options) {
    const q = String(query || '');
    const blocked = /\b(?:apply for me|apply on my behalf|send (?:my )?(?:cv|resume)|contact (?:the )?employer|message (?:the )?employer|email (?:the )?employer)\b/i.test(q);
    if (blocked) return { kind: 'blocked', text: 'I’m a read-only job search assistant. I can show published listings and application instructions, but I can’t apply, send messages, or contact employers for you.', jobs: [], total: 0, mode: options && options.mode || 'active', terms: [] };
    const found = search(jobs, q, options);
    const archiveNote = found.mode === 'active' ? '' : ' Archived ads move off the current board after 28 days and remain searchable until 90 days after posting, not after expiry. Contact the employer to check current status.';
    if (!found.total) return { kind: 'no-results', text: 'No matching jobs were found in these published listings. Try a different role, employer, city or country, or change the search scope.' + archiveNote, ...found };
    if (/\b(?:salary|pay|requirements?|qualifications?|how to apply|application|apply)\b/i.test(q)) {
      return { kind: 'details', text: 'Here are the published job details. Open “Published details & requirements” for the full listing. Missing salary or eligibility details are not inferred; confirm current availability with the employer.' + archiveNote, ...found };
    }
    return { kind: 'results', text: `Found ${found.total} matching ${found.total === 1 ? 'job' : 'jobs'} in ${found.mode === 'active' ? 'current' : found.mode === 'all' ? 'current and archived' : 'archived'} listings.` + archiveNote, ...found };
  }
  return { status, statusInfo, search, answer, safeApplyLink, countryName };
}));
