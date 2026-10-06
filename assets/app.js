/* MrJobs — job board logic.
   Jobs live in ./jobs.json (edited in the repo).
   Optional per-job fields: image (path under posters/), salary, featured. */

(function () {
  "use strict";

  var JOB_DATA_URL = "./jobs.json";
  var NEW_WITHIN_DAYS = 21;          // "NEW" badge for recent postings
  var SCHEMA_VALID_DAYS = 60;        // JobPosting validThrough window

  // Newsletter backend (existing Google Apps Script)
  var SUB_URL = "https://script.google.com/macros/s/AKfycbxY2IazrKrBHjEco8nKbZeNQMZuNikMTLQijhlaBe77UohHD0N3MrhvLS-DZeSCIw3k5w/exec";

  function $(id) { return document.getElementById(id); }

  var grid = $("jobListings");
  var countEl = $("jobCount");
  var searchInput = $("searchInput");
  var locationFilter = $("locationFilter");
  var allJobs = [];

  /* Escape text before injecting into HTML (job data is hand-edited). */
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function daysSince(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return Infinity;
    return (Date.now() - t) / 864e5;
  }

  function fmtDate(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return "";
    return new Date(t).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
  }

  function showLoading() {
    grid.innerHTML = '<div class="state"><i class="fas fa-spinner fa-spin"></i><p>Loading jobs&hellip;</p></div>';
  }

  function showError() {
    grid.innerHTML =
      '<div class="state"><i class="fas fa-exclamation-triangle"></i>' +
      '<h3>Couldn\'t load jobs</h3><p>Please check back in a bit.</p>' +
      '<button class="apply-btn" id="retryBtn"><i class="fas fa-sync-alt"></i> Retry</button></div>';
    countEl.textContent = "";
    $("retryBtn").addEventListener("click", loadJobs);
  }

  async function loadJobs() {
    showLoading();
    try {
      var res = await fetch(JOB_DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      allJobs = Array.isArray(data) ? data : [];
      buildFilter(allJobs);
      buildTicker(allJobs);
      renderJobs(allJobs);
    } catch (e) {
      console.error(e);
      showError();
    }
  }

  function buildFilter(jobs) {
    locationFilter.innerHTML = '<option value="">All Locations</option>';
    var locs = {};
    jobs.forEach(function (j) { if (j.location) locs[j.location] = true; });
    Object.keys(locs).sort().forEach(function (loc) {
      locationFilter.appendChild(new Option(loc, loc));
    });
  }

  /* Ticker is generated from the job data — no iframe needed. */
  function buildTicker(jobs) {
    var ticker = $("ticker");
    if (!ticker) return;
    if (!jobs.length) { ticker.hidden = true; return; }
    var locs = {};
    jobs.forEach(function (j) { if (j.location) locs[j.location] = true; });
    var top = Object.keys(locs).sort().slice(0, 6).join(" &middot; ");
    var msg =
      '<span>&#128138; ' + jobs.length + ' open positions</span>' +
      '<span>&#128205; ' + top + '</span>' +
      '<span>Apply via WhatsApp instantly!</span>';
    $("tickerTrack").innerHTML = msg + msg; // duplicated for a seamless loop
    ticker.hidden = false;
  }

  function cardHtml(job, i) {
    var isNew = daysSince(job.timestamp) <= NEW_WITHIN_DAYS;
    var posted = fmtDate(job.timestamp);
    var badge = "";
    if (job.featured) {
      badge = '<div class="badge featured"><i class="fas fa-star"></i> Featured</div>';
    } else if (isNew) {
      badge = '<div class="badge new">NEW</div>';
    }
    return '' +
      '<article class="job-card">' + badge +
      (job.image
        ? '<img class="job-poster" src="' + escapeHtml(job.image) + '" alt="' +
          escapeHtml(job.title) + ' &mdash; job poster" loading="lazy">'
        : '') +
      '<h3>' + escapeHtml(job.title) + '</h3>' +
      '<div class="job-meta"><i class="fas fa-building"></i><span>' + escapeHtml(job.company) + '</span></div>' +
      '<div class="job-meta"><i class="fas fa-map-marker-alt"></i><span>' + escapeHtml(job.location) + '</span></div>' +
      '<div class="job-meta"><i class="fas fa-money-bill-wave"></i><span>' +
        escapeHtml(job.salary || "Competitive Salary + Incentives") + '</span></div>' +
      (posted
        ? '<div class="job-meta"><i class="far fa-calendar-alt"></i><span>Posted ' + escapeHtml(posted) + '</span></div>'
        : '') +
      '<p class="job-desc">' + escapeHtml(job.description) + '</p>' +
      '<a class="apply-btn" href="' + escapeHtml(job.applyLink) + '" target="_blank" rel="noopener">' +
      '<i class="fab fa-whatsapp"></i> Apply Now</a>' +
      '</article>';
  }

  function renderJobs(jobs) {
    if (!jobs.length) {
      grid.innerHTML = '<div class="state"><i class="fas fa-search"></i><p>No matching jobs found.</p></div>';
      countEl.textContent = "0 jobs";
      return;
    }
    grid.innerHTML = jobs.map(cardHtml).join("");
    countEl.textContent = jobs.length + " job" + (jobs.length > 1 ? "s" : "") + " found";
    injectSchema(jobs);
  }

  function injectSchema(jobs) {
    var old = $("jobs-schema");
    if (old) old.remove();
    var validThrough = new Date(Date.now() + SCHEMA_VALID_DAYS * 864e5).toISOString().split("T")[0];
    var arr = jobs.map(function (job, i) {
      return {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": job.title,
        "description": job.description,
        "datePosted": job.timestamp || new Date().toISOString().split("T")[0],
        "validThrough": validThrough,
        "employmentType": "FULL_TIME",
        "hiringOrganization": { "@type": "Organization", "name": job.company },
        "jobLocation": {
          "@type": "Place",
          "address": { "@type": "PostalAddress", "addressLocality": job.location, "addressCountry": "PK" }
        },
        "identifier": { "@type": "PropertyValue", "name": "MrJobs", "value": job.id || ("MRJ-" + (1000 + i)) }
      };
    });
    var s = document.createElement("script");
    s.id = "jobs-schema";
    s.type = "application/ld+json";
    s.text = JSON.stringify(arr.length === 1 ? arr[0] : arr);
    document.head.appendChild(s);
  }

  function applyFilters() {
    var q = searchInput.value.trim().toLowerCase();
    var loc = locationFilter.value;
    renderJobs(allJobs.filter(function (j) {
      var hay = ((j.title || "") + " " + (j.company || "") + " " + (j.description || "")).toLowerCase();
      return hay.indexOf(q) !== -1 && (!loc || j.location === loc);
    }));
  }

  function initNewsletter() {
    var form = $("subscribeForm");
    if (!form) return;
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      ["subOK", "subDup", "subErr"].forEach(function (id) { $(id).style.display = "none"; });
      try {
        var res = await fetch(SUB_URL, { method: "POST", body: new FormData(form) });
        var txt = (await res.text()).trim();
        if (txt === "OK") { form.reset(); $("subOK").style.display = "block"; }
        else if (txt === "DUPLICATE") { $("subDup").style.display = "block"; }
        else { $("subErr").style.display = "block"; }
      } catch (err) {
        console.error(err);
        $("subErr").style.display = "block";
      }
    });
  }

  function initNav() {
    var toggle = $("navToggle");
    var links = $("navLinks");
    if (toggle && links) {
      toggle.addEventListener("click", function () { links.classList.toggle("open"); });
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    initNav();
    initNewsletter();
    var year = $("year");
    if (year) year.textContent = new Date().getFullYear();
    if (grid && searchInput && locationFilter) {
      searchInput.addEventListener("input", applyFilters);
      locationFilter.addEventListener("change", applyFilters);
      loadJobs();
    }
  });
})();
