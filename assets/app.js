/* MrJobs — job board logic.
   Jobs live in ./jobs.json (edited in the repo).
   Optional per-job fields: image (path under posters/), salary, featured.
   timestamp drives the NEW badge (first 14 days) and auto-expiry (after 28 days). */

(function () {
  "use strict";

  var JOB_DATA_URL = "./jobs.json";
  var NEW_WITHIN_DAYS = 14;          // "NEW" badge for recent postings
  var EXPIRE_AFTER_DAYS = 28;        // listings auto-expire this many days after posting
  var ARCHIVE_MAX_DAYS = 90;         // expired listings stay on the archive page this long
  var ARCHIVE_MODE = !!(document.body && document.body.getAttribute("data-mode") === "expired");

  /* Top-20 pharma companies of Pakistan — matched loosely against job.company
     (case-insensitive substring), powering the homepage "Recommended" shelf. */
  var TOP20_KEYS = ["getz", "glaxosmithkline", "gsk", "abbott", "sami",
    "searle", "martin dow", "hilton", "high-q", "ferozsons", "highnoon",
    "ccl", "agp", "bosch", "obs pakistan", "obs pharma", "barrett", "atco", "indus pharma",
    "pharmevo", "macter", "nabiqasim"];
  function isTop20(job) {
    var c = String(job.company || "").toLowerCase();
    return TOP20_KEYS.some(function (k) { return c.indexOf(k) !== -1; });
  }
  var SCHEMA_VALID_DAYS = 60;        // JobPosting validThrough window
  var SITE_URL = "https://mrjobs.top";  // no trailing slash

  // Newsletter backend: FormSubmit (no signup; first submission needs email confirmation)

  function $(id) { return document.getElementById(id); }

  var grid = $("jobListings");
  var countEl = $("jobCount");
  var searchInput = $("searchInput");
  var locationFilter = $("locationFilter");
  var pagerEl = $("boardPager");
  var allJobs = [];

  /* Mobile pagination (owner request, 2026-10-25): on narrow screens the
     board renders PAGE_SIZE cards at a time with a "Show more" button —
     the full list felt like infinite scrolling. Desktop is unchanged
     (PAGE_SIZE Infinity renders everything, the pager never appears). */
  var PAGE_SIZE = (window.matchMedia && window.matchMedia("(max-width: 820px)").matches) ? 20 : Infinity;
  var visibleCount = PAGE_SIZE;

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

  /* A listing expires EXPIRE_AFTER_DAYS after its timestamp (missing date = stays). */
  function isExpired(job) {
    var t = Date.parse(job.timestamp);
    return !isNaN(t) && (Date.now() - t) / 864e5 > EXPIRE_AFTER_DAYS;
  }

  /* Defensive dedupe: same id, or same company+title+location+contact → keep first. */
  function dedupeJobs(jobs) {
    var seen = {}, out = [];
    jobs.forEach(function (j) {
      var key = [j.id, j.company, j.title, j.location, j.applyLink]
        .map(function (v) { return String(v == null ? "" : v).trim().toLowerCase(); })
        .join("|");
      if (!seen[key]) { seen[key] = true; out.push(j); }
    });
    return out;
  }

  /* Posters are source material for the text listings only (owner
     decision 2026-10-24, extended to cards 2026-10-25): the board never
     fetches or displays them — cards are clean text, pages stay light. */

  function fmtDate(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return "";
    return new Date(t).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
  }

  function showLoading() {
    grid.innerHTML = '<div class="state"><i class="fas fa-spinner fa-spin"></i><p>Loading jobs&hellip;</p><p class="state-urdu" lang="ur">نوکریوں کے اشتہار لوڈ ہو رہے ہیں۔</p></div>';
  }

  function showError() {
    grid.innerHTML =
      '<div class="state"><i class="fas fa-exclamation-triangle"></i>' +
      '<h3>Couldn\'t load jobs</h3><p>Please check back in a bit.</p>' +
      '<button class="apply-btn" id="retryBtn"><i class="fas fa-sync-alt"></i> Retry</button></div>';
    countEl.textContent = "";
    $("retryBtn").addEventListener("click", loadJobs);
  }

  function showEmptyBoard() {
    grid.innerHTML =
      '<div class="state"><i class="fas fa-briefcase"></i>' +
      '<h3>No open positions right now</h3>' +
      '<p>New medical-rep jobs are added regularly &mdash; check back soon or subscribe below for weekly alerts.</p></div>';
    countEl.textContent = "0 jobs";
  }

  function showEmptyArchive() {
    grid.innerHTML =
      '<div class="state"><i class="fas fa-history"></i>' +
      '<h3>No expired listings right now</h3>' +
      '<p>Jobs move here 28 days after posting and stay for 90 days &mdash; nothing has aged out at the moment.</p></div>';
    countEl.textContent = "0 jobs";
  }

  async function loadJobs() {
    showLoading();
    try {
      var res = await fetch(JOB_DATA_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      var rawJobs = Array.isArray(data) ? data : [];
      allJobs = dedupeJobs(rawJobs.filter(function (j) {
        if (ARCHIVE_MODE) return isExpired(j) && daysSince(j.timestamp) <= ARCHIVE_MAX_DAYS;
        return !isExpired(j);
      }));
      allJobs.sort(function (a, b) { return Date.parse(b.timestamp) - Date.parse(a.timestamp); });
      allJobs.forEach(function (j) { j._top20 = isTop20(j); });
      buildFilter(allJobs);
      buildTicker(allJobs);
      if (!allJobs.length) { if (ARCHIVE_MODE) { showEmptyArchive(); } else { showEmptyBoard(); } return; }
      visibleCount = PAGE_SIZE;
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
    var top = Object.keys(locs).sort().slice(0, 6).map(escapeHtml).join(" &middot; ");
    var msg =
      '<span>&#128138; ' + jobs.length + ' open positions</span>' +
      '<span>&#128205; ' + top + '</span>' +
      '<span>Apply via WhatsApp instantly!</span>';
    $("tickerTrack").innerHTML = msg + msg; // duplicated for a seamless loop
    ticker.hidden = false;
  }

  /* Detail-page slug + URL — MUST stay identical to slugify()/job_url_path()
     in scripts/build.py, which generates jobs/<id>-<slug>.html at deploy. */
  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "");
  }
  function jobPageUrl(job) {
    var slug = slugify((job.title || "") + "-" + (job.company || "") + "-" +
                       (job.location || "")) || job.id;
    return "jobs/" + job.id + "-" + slug + ".html";
  }

  function titleCaseCity(s) {
    return String(s || "").split(/\s+/).map(function (w) {
      return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w;
    }).join(" ");
  }

  /* WhatsApp apply links carry a pre-filled Roman-Urdu message naming the
     company/title and linking back to the job's MrJobs page (owner-approved
     template, 2026-10-20). Mirrors apply_with_text() in scripts/build.py.
     mailto: and already-parametrised links pass through untouched. */
  function applyHref(job) {
    var link = String(job.applyLink || "");
    // Only web/mail destinations may reach the Apply button (security
    // audit 2026-10-21) - anything else renders as a dead link.
    if (!/^(https:\/\/|mailto:)/i.test(link)) return "#";
    if (link.indexOf("https://wa.me/") !== 0 || link.indexOf("?") !== -1) return link;
    var msg = "Assalam-o-Alaikum! Mein ne MrJobs par *" + (job.company || "") +
      "* ki *" + (job.title || "") + "* wali vacancy (" + titleCaseCity(job.location) +
      ") dekhi hai aur apply karna chahta hoon: " + SITE_URL + "/" + jobPageUrl(job) + ". Shukriya.";
    return link + "?text=" + encodeURIComponent(msg);
  }

  function cardHtml(job, i) {
    var isNew = daysSince(job.timestamp) <= NEW_WITHIN_DAYS;
    var posted = fmtDate(job.timestamp);
    var badge = "";
    if (ARCHIVE_MODE) {
      badge = '<div class="badge expired"><i class="fas fa-clock"></i> EXPIRED</div>';
    } else if (job.featured) {
      badge = '<div class="badge featured"><i class="fas fa-star"></i> Featured</div>';
    } else if (isNew) {
      badge = '<div class="badge new">NEW</div>';
    }
    return '' +
      '<article class="job-card">' + badge +
      '<h3>' + escapeHtml(job.title) + '</h3>' +
      '<div class="job-meta"><i class="fas fa-building"></i><span>' + escapeHtml(job.company) + '</span></div>' +
      (job._top20 ? '<div class="job-meta topco"><i class="fas fa-award"></i><span>Top 20 Pharma Company</span></div>' : '') +
      '<div class="job-meta"><i class="fas fa-map-marker-alt"></i><span>' + escapeHtml(job.location) + '</span></div>' +
      '<div class="job-meta"><i class="fas fa-money-bill-wave"></i><span>' +
        escapeHtml(job.salary || "Competitive Salary + Incentives") + '</span></div>' +
      (posted
        ? '<div class="job-meta"><i class="far fa-calendar-alt"></i><span>Posted ' + escapeHtml(posted) +
          (ARCHIVE_MODE ? ' &middot; ' + Math.floor(daysSince(job.timestamp)) + ' days ago' : '') + '</span></div>'
        : '') +
      '<p class="job-desc">' + escapeHtml(job.description) + '</p>' +
      (ARCHIVE_MODE
        ? '<p class="job-note"><i class="fas fa-info-circle"></i> This ad has expired &mdash; the vacancy may already be filled, but many positions stay open longer. It is worth contacting the employer to confirm the position is still open before applying.</p>'
        : '') +
      '<a class="apply-btn" href="' + escapeHtml(applyHref(job)) + '" target="_blank" rel="noopener">' +
      '<i class="fab fa-whatsapp"></i> Apply Now</a>' +
      (ARCHIVE_MODE
        ? ''
        : '<a class="details-link" href="' + escapeHtml(jobPageUrl(job)) + '">' +
          'View details <i class="fas fa-arrow-right"></i></a>' +
          '<button class="share-btn" data-idx="' + i + '"><i class="fas fa-share-alt"></i> Share</button>') +
      '</article>';
  }

  function renderJobs(jobs) {
    lastJobs = jobs;
    if (!jobs.length) {
      grid.innerHTML = '<div class="state"><i class="fas fa-search"></i><p>No matching jobs found.</p></div>';
      countEl.textContent = "0 jobs";
      if (pagerEl) pagerEl.innerHTML = "";
      return;
    }
    grid.innerHTML = jobs.slice(0, visibleCount).map(cardHtml).join("");
    countEl.textContent = jobs.length + " job" + (jobs.length > 1 ? "s" : "") + " found";
    renderPager(jobs.length);
    if (!ARCHIVE_MODE) injectSchema(jobs);
  }

  /* "Show more" pager under the grid. Renders only while more cards
     remain hidden, so desktop (PAGE_SIZE Infinity) never sees it. The
     slice starts at 0, so card indices still match the full filtered
     list and share buttons keep their data-idx. */
  function renderPager(total) {
    if (!pagerEl) return;
    if (total <= visibleCount) { pagerEl.innerHTML = ""; return; }
    pagerEl.innerHTML =
      '<p style="margin:0 0 10px;color:#5b6b73;font-size:.92rem">Showing ' +
      Math.min(visibleCount, total) + ' of ' + total + ' jobs</p>' +
      '<button type="button" class="apply-btn" id="showMoreBtn">' +
      'Show more jobs <i class="fas fa-chevron-down"></i></button>';
    $("showMoreBtn").addEventListener("click", function () {
      visibleCount += PAGE_SIZE;
      renderJobs(lastJobs);
    });
  }

  /* Share-card button → MrJobsShareCard (assets/share-card.js). */
  var lastJobs = [];
  function initShare() {
    if (!grid) return;
    grid.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest(".share-btn") : null;
      if (!b || !window.MrJobsShareCard) return;
      var job = lastJobs[parseInt(b.getAttribute("data-idx"), 10)];
      if (!job) return;
      window.MrJobsShareCard.shareJob({
        id: job.id,
        title: job.title,
        company: job.company,
        location: job.location,
        experience: job.experience || "",
        top20: !!job._top20,
        isNew: daysSince(job.timestamp) <= NEW_WITHIN_DAYS
      });
    });
  }

  function injectSchema(jobs) {
    var old = $("jobs-schema");
    if (old) old.remove();
    var validThrough = new Date(Date.now() + SCHEMA_VALID_DAYS * 864e5).toISOString().split("T")[0];
    var arr = jobs.map(function (job, i) {
      var addr = { "@type": "PostalAddress", "addressLocality": job.location, "addressCountry": job.country || "PK" };
      if ((job.country || "PK") === "PK") addr.addressRegion = "Punjab"; // every PK listing is in Punjab (verified 2026-10-19)
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
          "address": addr
        },
        "identifier": { "@type": "PropertyValue", "name": "MrJobs", "value": job.id || ("MRJ-" + (1000 + i)) },
        "url": location.origin + "/" + jobPageUrl(job)
      };
    });
    var s = document.createElement("script");
    s.id = "jobs-schema";
    s.type = "application/ld+json";
    s.text = JSON.stringify(arr.length === 1 ? arr[0] : arr);
    document.head.appendChild(s);
  }

  function applyFilters() {
    visibleCount = PAGE_SIZE;
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
        var fd = new FormData(form);
        var res = await fetch("https://formsubmit.co/ajax/sufyanbarret@gmail.com", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({
            name: fd.get("name"), email: fd.get("email"), area: fd.get("area") || "-",
            _subject: "New MrJobs Weekly subscriber", _template: "table"
          })
        });
        if (res.ok) { form.reset(); $("subOK").style.display = "block"; }
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
    initShare();
    var year = $("year");
    if (year) year.textContent = new Date().getFullYear();
    if (grid && searchInput && locationFilter) {
      searchInput.addEventListener("input", applyFilters);
      locationFilter.addEventListener("change", applyFilters);
      loadJobs();
    }
  });
})();
