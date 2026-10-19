/* MrJobs conversational assistant. Credentials stay server-side; chat history is memory-only. */
(function () {
  'use strict';
  var script = document.currentScript;
  var base = new URL('../', script.src);
  var engine = window.MrJobsSearch;
  if (!engine || document.getElementById('jobChatLauncher')) return;
  var jobs = null, guides = [], loading = false, lastQuery = '', history = [], requesting = false, generation = 0, controller = null;
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
  var launcher = button('Ask MrJobs', 'job-chat-launcher', function () { setOpen(panel.hidden); });
  launcher.id = 'jobChatLauncher'; launcher.setAttribute('aria-controls', 'jobChatPanel');
  launcher.setAttribute('aria-expanded', 'false'); launcher.setAttribute('aria-haspopup', 'dialog');
  var panel = node('section', 'job-chat-panel'); panel.id = 'jobChatPanel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-labelledby', 'jobChatTitle');
  var header = node('div', 'job-chat-header');
  var heading = node('div'); heading.append(node('h2', '', 'MrJobs assistant'));
  heading.firstChild.id = 'jobChatTitle'; heading.append(node('p', '', 'Jobs, career advice and your next step.'));
  var close = button('Close', 'job-chat-close', function () { setOpen(false); });
  close.setAttribute('aria-label', 'Close job finder'); header.append(heading, close);
  var intro = node('p', 'job-chat-intro', 'Tell me about your goals, ask about a listing, or get help from our career guides. I cannot apply or contact employers.');
  var controls = node('div', 'job-chat-controls');
  var modeLabel = node('label', '', 'Search in'); modeLabel.htmlFor = 'jobChatMode';
  var mode = node('select'); mode.id = 'jobChatMode';
  [['active', 'Current listings'], ['archived', 'Archived listings'], ['all', 'Current + archived']].forEach(function (pair) {
    var opt = node('option', '', pair[1]); opt.value = pair[0]; mode.append(opt);
  });
  controls.append(modeLabel, mode);
  var suggestions = node('div', 'job-chat-suggestions');
  ['Latest jobs', 'Jobs in Kenya', 'Data entry jobs', 'Archived jobs', 'How should I prepare for an MR interview?'].forEach(function (query) {
    suggestions.append(button(query, 'job-chat-chip', function () {
      mode.value = query === 'Archived jobs' ? 'archived' : 'active';
      input.value = query; submitQuery();
    }));
  });
  var transcript = node('div', 'job-chat-transcript'); transcript.setAttribute('role', 'log');
  transcript.setAttribute('aria-label', 'Job search conversation'); transcript.setAttribute('aria-live', 'polite');
  transcript.setAttribute('aria-relevant', 'additions');
  var welcome = node('div', 'job-chat-message', 'Hi, I’m the MrJobs assistant. Tell me the role or career question you have in mind. For example: “I’m a fresh graduate in Faisalabad. What could suit me?” I’ll use the published listings and career guides, and tell you when a detail is missing.');
  transcript.append(welcome);
  var form = node('form', 'job-chat-form');
  var inputLabel = node('label', 'job-chat-sr', 'Ask about jobs'); inputLabel.htmlFor = 'jobChatInput';
  var input = node('input'); input.id = 'jobChatInput'; input.type = 'text'; input.maxLength = 1200;
  input.autocomplete = 'off'; input.placeholder = 'Ask a question or tell me your goals…';
  var send = node('button', 'job-chat-send', 'Ask'); send.type = 'submit';
  form.append(inputLabel, input, send);
  var privacy = node('div', 'job-chat-privacy');
  var searchOnly = false;
  var searchToggle = button('Use listing search', 'job-chat-search-toggle', function () {
    searchOnly = !searchOnly; searchToggle.textContent = searchOnly ? 'Use AI conversation' : 'Use listing search';
    send.textContent = searchOnly ? 'Search' : 'Ask';
    say(searchOnly ? 'Listing search mode: searches run locally, without sending your question to AI.' : 'Conversation mode: questions and recent chat are sent to the AI provider with published sources.');
    input.focus();
  });
  privacy.append(node('span', '', 'AI mode sends messages to our AI provider. No chat is saved by MrJobs. Avoid sensitive information. '));
  privacy.append(searchToggle, document.createTextNode(' · '));
  privacy.append(button('Clear chat', 'job-chat-clear', function () {
    generation++; if (controller) controller.abort();
    transcript.replaceChildren(welcome); lastQuery = ''; history = []; input.value = ''; input.focus();
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
      jobs = data;
      try {
        var guideResponse = await fetch(new URL('assistant-guides.json', base), { cache: 'no-store', credentials: 'omit' });
        if (guideResponse.ok) { var guideData = await guideResponse.json(); if (Array.isArray(guideData)) guides = guideData; }
      } catch (_) { /* Listing search remains available if guides cannot load. */ }
      pending.remove(); return true;
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
    if (Array.isArray(answer.guideIds) && answer.guideIds.length) {
      var sources = node('div', 'job-chat-sources'); sources.append(node('strong', '', 'Career guide sources'));
      answer.guideIds.forEach(function (id) {
        var guide = guides.find(function (item) { return item.id === id; });
        if (guide && /^\/guide\/[a-z0-9-]+\.html$/.test(guide.url)) sources.append(publishedLink(guide.title, new URL(guide.url, base).href));
      });
      group.append(sources);
    }
    var list = Array.isArray(answer.jobs) ? answer.jobs : [], shown = 0;
    function more() {
      var end = Math.min(shown + 5, list.length);
      for (; shown < end; shown++) group.append(card(list[shown]));
      if (shown < list.length) {
        var next = button('Show 5 more (' + (list.length - shown) + ' remaining)', 'job-chat-more', function () { next.remove(); more(); });
        group.append(next);
      }
    }
    more();
    if (Array.isArray(answer.followUps) && answer.followUps.length) {
      var followUps = node('div', 'job-chat-followups');
      answer.followUps.slice(0, 3).forEach(function (question) {
        followUps.append(button(question, 'job-chat-chip', function () { input.value = question; submitQuery(); }));
      });
      group.append(followUps);
    }
    transcript.append(group);
    transcript.scrollTop += group.getBoundingClientRect().top - transcript.getBoundingClientRect().top - 12;
  }
  async function submitQuery() {
    var query = input.value.trim(); if (!query || loading || requesting) return;
    if (!(await ensureJobs())) return;
    say(query, true); input.value = '';
    var currentGeneration = generation;
    var effectiveQuery = query;
    if (lastQuery && /^(?:what (?:is|are) (?:the )?)?(?:salary|pay|requirements?|qualifications?|experience|how (?:do i |to )?apply|application (?:link|email))\??$/i.test(query)) {
      effectiveQuery = query + ' ' + lastQuery;
    } else lastQuery = query;
    if (searchOnly) {
      var localAnswer = engine.answer(jobs, effectiveQuery, { mode: mode.value });
      if (['active', 'archived', 'all'].indexOf(localAnswer.mode) !== -1) mode.value = localAnswer.mode;
      showResults(localAnswer); input.focus({ preventScroll: true }); return;
    }
    requesting = true; send.disabled = true; send.textContent = 'Thinking…';
    var pending = say('Reading the published listings and career guides…');
    pending.setAttribute('aria-busy', 'true');
    transcript.scrollTop = transcript.scrollHeight;
    controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 40000);
    try {
      var response = await fetch(new URL('.netlify/functions/job-assistant', base), {
        method: 'POST', credentials: 'omit', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, history: history.slice(-6), scope: mode.value }),
        signal: controller.signal
      });
      var answer;
      try { answer = await response.json(); } catch (_) { answer = {}; }
      if (!response.ok || typeof answer.text !== 'string') throw new Error(response.status === 429 ? 'RATE_LIMIT' : answer.code || 'AI_UNAVAILABLE');
      if (generation !== currentGeneration) return;
      pending.remove();
      var chosenMode = ['active', 'archived', 'all'].indexOf(answer.mode) !== -1 ? answer.mode : mode.value;
      mode.value = chosenMode;
      // Never trust model-generated records or links: resolve IDs to the fetched board.
      answer.jobs = (Array.isArray(answer.jobIds) ? answer.jobIds : []).slice(0, 6).map(function (id) {
        return jobs.find(function (job) { return job.id === id; });
      }).filter(function (job) {
        if (!job) return false;
        var state = engine.status(job);
        return chosenMode === 'all' ? state !== 'hidden' : state === chosenMode;
      });
      showResults(answer);
      history.push({ role: 'user', content: query }, { role: 'assistant', content: answer.text.slice(0, 2000) });
      history = history.slice(-6);
    } catch (error) {
      if (generation !== currentGeneration) return;
      pending.remove();
      var failure = say(error.message === 'RATE_LIMIT' ? 'Too many questions at once. Please wait a minute and try again, or use local listing search.' : error.message === 'AI_NOT_CONFIGURED' ? 'AI replies have not been enabled in this preview yet. You can still use local listing search.' : 'AI replies are unavailable right now. Try again or use local listing search.');
      failure.append(button('Search published listings instead', 'job-chat-chip', function () {
        var fallback = engine.answer(jobs, effectiveQuery, { mode: mode.value });
        showResults(fallback);
      }));
    } finally {
      clearTimeout(timeout); requesting = false; send.disabled = false; send.textContent = searchOnly ? 'Search' : 'Ask';
      input.focus({ preventScroll: true });
    }
  }
  form.addEventListener('submit', function (event) { event.preventDefault(); submitQuery(); });
  mode.addEventListener('change', function () {
    // Scope changes are explicit: do not silently repeat an old archive-only query.
    input.focus();
  });
}());
