/* MrJobs job finder. Local, read-only, no API key, cookies or chat persistence. */
(function () {
  'use strict';
  var script = document.currentScript;
  var base = new URL('../', script.src);
  var engine = window.MrJobsSearch;
  if (!engine || document.getElementById('jobChatLauncher')) return;
  var jobs = null, loading = false, lastQuery = '';
  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function button(text, cls, fn) {
    var el = node('button', cls, text); el.type = 'button';
    if (fn) el.addEventListener('click', fn);
    return el;
  }
  var launcher = button('Find a job', 'job-chat-launcher', function () { setOpen(panel.hidden); });
  launcher.id = 'jobChatLauncher'; launcher.setAttribute('aria-controls', 'jobChatPanel');
  launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-haspopup', 'dialog');
  var panel = node('section', 'job-chat-panel'); panel.id = 'jobChatPanel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'jobChatTitle');
  var header = node('div', 'job-chat-header');
  var heading = node('div'); heading.append(node('h2', '', 'MrJobs job finder'));
  heading.firstChild.id = 'jobChatTitle'; heading.append(node('p', '', 'Published listings. Clear answers.'));
  var close = button('Close', 'job-chat-close', function () { setOpen(false); });
  close.setAttribute('aria-label', 'Close job finder'); header.append(heading, close);
  var intro = node('p', 'job-chat-intro', 'Search every role, employer and country on this board. Published listings only; I cannot apply or contact employers.');
  var controls = node('div', 'job-chat-controls');
  var modeLabel = node('label', '', 'Search in'); modeLabel.htmlFor = 'jobChatMode';
  var mode = node('select'); mode.id = 'jobChatMode';
  [['active', 'Current listings'], ['archived', 'Archived listings'], ['all', 'Current + archived']].forEach(function (pair) {
    var opt = node('option', '', pair[1]); opt.value = pair[0]; mode.append(opt);
  });
  controls.append(modeLabel, mode);
  var suggestions = node('div', 'job-chat-suggestions');
  ['Latest jobs', 'Jobs in Kenya', 'Data entry jobs', 'Archived jobs'].forEach(function (query) {
    suggestions.append(button(query, 'job-chat-chip', function () {
      mode.value = query === 'Archived jobs' ? 'archived' : 'active';
      input.value = query; submitQuery();
    }));
  });
  var transcript = node('div', 'job-chat-transcript'); transcript.setAttribute('role', 'log');
  transcript.setAttribute('aria-label', 'Job search conversation'); transcript.setAttribute('aria-live', 'polite');
  transcript.setAttribute('aria-relevant', 'additions');
  var welcome = node('div', 'job-chat-message', 'Start with “jobs in Kenya”, “data entry in Sahiwal”, or a company name. Current listings appear first.');
  transcript.append(welcome);
  var form = node('form', 'job-chat-form');
  var inputLabel = node('label', 'job-chat-sr', 'Ask about jobs'); inputLabel.htmlFor = 'jobChatInput';
  var input = node('input'); input.id = 'jobChatInput'; input.type = 'text'; input.maxLength = 400;
  input.autocomplete = 'off'; input.placeholder = 'Role, company, city or country…';
  var send = node('button', 'job-chat-send', 'Search'); send.type = 'submit';
  form.append(inputLabel, input, send);
  var privacy = node('div', 'job-chat-privacy');
  privacy.append(node('span', '', 'Search runs in your browser. No chat is saved. '));
  privacy.append(button('Clear chat', 'job-chat-clear', function () {
    transcript.replaceChildren(welcome); lastQuery = ''; input.value = ''; input.focus();
  }));
  panel.append(header, intro, controls, suggestions, transcript, form, privacy);
  document.body.append(launcher, panel);

  function setOpen(open) {
    panel.hidden = !open; launcher.setAttribute('aria-expanded', String(open));
    if (open) { input.focus(); ensureJobs(); } else launcher.focus();
  }
  panel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
  });
  function say(text, user) {
    var el = node('div', 'job-chat-message' + (user ? ' job-chat-user' : ''), text);
    transcript.append(el); return el;
  }
  async function ensureJobs() {
    if (jobs) return true;
    if (loading) return false;
    loading = true; send.disabled = true; suggestions.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    var pending = say('Loading published listings…');
    try {
      var response = await fetch(new URL('jobs.json', base), { cache: 'no-store', credentials: 'omit' });
      if (!response.ok) throw new Error('Listing request failed');
      var data = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid listing data');
      jobs = data; pending.remove(); return true;
    } catch (error) {
      pending.textContent = 'The listings could not be loaded. Check your connection and retry.';
      pending.append(button('Retry loading', 'job-chat-chip', function () { pending.remove(); ensureJobs(); }));
      return false;
    } finally {
      loading = false; send.disabled = false; suggestions.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
    }
  }
  function publishedLink(label, href) {
    var a = node('a', 'job-chat-link', label); a.href = href;
    a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  function card(job) {
    var article = node('article', 'job-chat-result');
    var state = engine.status(job);
    var archived = state === 'archived';
    article.append(node('span', 'job-chat-badge' + (archived ? ' job-chat-archived' : ''), archived ? 'Archived listing' : 'Current listing'));
    article.append(node('h3', '', job.title || 'Untitled listing'));
    article.append(node('p', 'job-chat-employer', job.company || 'Employer not specified'));
    article.append(node('p', 'job-chat-meta', [job.location, engine.countryName(job)].filter(Boolean).join(' · ')));
    article.append(node('p', 'job-chat-meta', 'Posted: ' + (job.timestamp || 'Not specified')));
    article.append(node('p', 'job-chat-meta', 'Salary: ' + (job.salary || 'See published details; no separate salary field provided.')));
    if (archived) article.append(node('p', 'job-chat-warning', 'This ad has expired — the vacancy may already be filled, but many positions stay open longer. Contact the employer to confirm the position is still open before applying.'));
    var details = node('details'); details.append(node('summary', '', 'Published details & requirements'));
    details.append(node('p', 'job-chat-description', job.description || 'No further details published.'));
    if (job.contact) details.append(node('p', 'job-chat-description', 'Published contact: ' + job.contact));
    article.append(details);
    var links = node('div', 'job-chat-result-links');
    var application = engine.safeApplyLink(job.applyLink);
    if (application) {
      var label = /^mailto:/i.test(application) ? 'Open published email' : /^https?:\/\/(?:wa\.me|(?:api\.)?whatsapp\.com)\//i.test(application) ? 'Open published WhatsApp link' : 'Open published application link';
      links.append(publishedLink(label, application));
    } else links.append(node('span', '', 'No supported application link published.'));
    var source = new URL(archived ? 'expired-jobs.html' : 'all-jobs.html', base);
    source.hash = 'listing-' + String(job.id || '');
    links.append(publishedLink('View on board', source.href));
    article.append(links); return article;
  }
  function showResults(answer) {
    var group = node('div', 'job-chat-response'); group.append(node('p', 'job-chat-answer', answer.text));
    var list = Array.isArray(answer.jobs) ? answer.jobs : [], shown = 0;
    function more() {
      var end = Math.min(shown + 5, list.length);
      for (; shown < end; shown++) group.append(card(list[shown]));
      if (shown < list.length) {
        var next = button('Show 5 more (' + (list.length - shown) + ' remaining)', 'job-chat-more', function () { next.remove(); more(); });
        group.append(next);
      }
    }
    more(); transcript.append(group);
    transcript.scrollTop += group.getBoundingClientRect().top - transcript.getBoundingClientRect().top - 12;
  }
  async function submitQuery() {
    var query = input.value.trim(); if (!query || loading) return;
    if (!(await ensureJobs())) return;
    say(query, true); input.value = '';
    var effectiveQuery = query;
    if (lastQuery && /^(?:what (?:is|are) (?:the )?)?(?:salary|pay|requirements?|qualifications?|experience|how (?:do i |to )?apply|application (?:link|email))\??$/i.test(query)) {
      effectiveQuery = query + ' ' + lastQuery;
    } else lastQuery = query;
    try {
      var answer = engine.answer(jobs, effectiveQuery, { mode: mode.value });
      if (['active', 'archived', 'all'].indexOf(answer.mode) !== -1) mode.value = answer.mode;
      showResults(answer);
    } catch (error) { say('Search could not finish. Try a role, city, country or employer name.'); }
    input.focus({ preventScroll: true });
  }
  form.addEventListener('submit', function (event) { event.preventDefault(); submitQuery(); });
  mode.addEventListener('change', function () {
    // Scope changes are explicit: do not silently repeat an old archive-only query.
    input.focus();
  });
}());
