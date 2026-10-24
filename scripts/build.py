#!/usr/bin/env python3
"""MrJobs static build — per-job detail pages + sitemap.

Runs on every Netlify deploy (see netlify.toml) and whenever jobs.json changes.
Reads jobs.json, applies the same visibility rules as assets/app.js
(28-day auto-expiry, defensive dedupe), then writes:

  jobs/<id>-<slug>.html   one static page per active listing, with
                          JobPosting JSON-LD (Google for Jobs eligible)
  sitemap.xml             homepage + section pages + every job page

NEVER fails the deploy: any unexpected error still leaves a minimal
sitemap.xml behind and exits 0.
"""

import base64
import html
import json
import os
import re
import sys
import urllib.parse
from datetime import date, datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from guide_content import ARTICLES as GUIDE_ARTICLES
except ImportError:
    GUIDE_ARTICLES = []  # guide content not present — skip guide pages


# ---------------------------------------------------------------- config
SITE_URL = "https://mrjobs.top"   # no trailing slash
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JOBS_JSON = os.path.join(ROOT, "jobs.json")
POSTERS_DIR = os.path.join(ROOT, "posters")
JOBS_DIR = os.path.join(ROOT, "jobs")
SITEMAP = os.path.join(ROOT, "sitemap.xml")

EXPIRE_AFTER_DAYS = 28   # must match assets/app.js
NEW_WITHIN_DAYS = 14     # must match assets/app.js


# ------------------------------------------------------------- helpers
def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def safe_json_ld(obj):
    """json.dumps made safe for an HTML <script> block: escape <, >, &
    as unicode escapes so job text can never break out of the JSON-LD
    block (security audit 2026-10-21, finding 1)."""
    return (json.dumps(obj, ensure_ascii=False, indent=2)
            .replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e"))


def write_page(rel, content):
    """Write a generated page, refusing any destination outside ROOT
    (security audit 2026-10-21, finding 3)."""
    dest = os.path.realpath(os.path.join(ROOT, rel))
    if os.path.commonpath([dest, ROOT]) != ROOT:
        raise ValueError("refusing to write outside site root: %s" % rel)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write(content)


TOP20_KEYS = ["getz", "glaxosmithkline", "gsk", "abbott", "sami", "searle",
              "martin dow", "hilton", "high-q", "ferozsons", "highnoon", "ccl",
              "agp", "bosch", "obs pakistan", "obs pharma", "barrett", "atco", "indus pharma",
              "pharmevo", "macter", "nabiqasim"]
"""Mirrors isTop20() in assets/app.js (case-insensitive substring)."""


def is_top20(job):
    c = str(job.get("company", "")).lower()
    return any(k in c for k in TOP20_KEYS)


def slugify(s):
    """Must stay identical to slugify() in assets/app.js."""
    s = re.sub(r"[^a-z0-9]+", "-", str(s).lower())
    s = s.strip("-")
    return s[:80].rstrip("-")


def job_slug(job):
    return slugify("%s-%s-%s" % (job.get("title", ""),
                                 job.get("company", ""),
                                 job.get("location", ""))) or job.get("id", "job")


def job_url_path(job):
    jid = str(job.get("id", ""))
    if not re.fullmatch(r"[A-Za-z0-9_-]+", jid):
        raise ValueError("unsafe job id: %r" % jid)
    return "jobs/%s-%s.html" % (jid, job_slug(job))


def parse_date(s):
    if s is None:
        return None
    s = str(s).strip()
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def is_expired(job):
    d = parse_date(job.get("timestamp"))
    if d is None:
        return False                      # missing/invalid timestamp = stays
    return (date.today() - d).days > EXPIRE_AFTER_DAYS


def dedupe(jobs):
    seen, out = set(), []
    for j in jobs:
        key = "|".join(str(j.get(k, "") or "").strip().lower()
                       for k in ("id", "company", "title", "location", "applyLink"))
        if key not in seen:
            seen.add(key)
            out.append(j)
    return out


def title_case_city(s):
    return " ".join(w.capitalize() for w in str(s).split())


def poster_data_uri(job):
    """Inline the .b64 poster as a data URI so the page needs no JS."""
    img = job.get("image")
    if not img or not str(img).lower().endswith(".b64"):
        return None
    path = os.path.realpath(os.path.join(ROOT, str(img).lstrip("/")))
    if os.path.commonpath([path, ROOT]) != ROOT:
        path = None  # poster path escapes the site root - ignore it
    if not path or not os.path.isfile(path):
        # also try relative to posters dir by basename
        alt = os.path.join(POSTERS_DIR, os.path.basename(str(img)))
        path = alt if os.path.isfile(alt) else None
    if not path:
        print("  warn: poster file missing for %s: %s" % (job.get("id"), img),
              file=sys.stderr)
        return None
    try:
        with open(path, "rb") as f:
            raw_b64 = f.read().decode("ascii").strip()
        base64.b64decode(raw_b64)  # validate
        return "data:image/jpeg;base64," + raw_b64
    except Exception as e:  # noqa: BLE001
        print("  warn: bad poster %s for %s: %s" % (img, job.get("id"), e),
              file=sys.stderr)
        return None


# Google Analytics 4 (owner property, added 2026-10-21)
GA_SNIPPET = (
    '  <script async src="https://www.googletagmanager.com/gtag/js?id=G-QPQCFWE9EP"></script>\n'
    '  <script>\n'
    '    window.dataLayer = window.dataLayer || [];\n'
    '    function gtag() { dataLayer.push(arguments); }\n'
    "    gtag('js', new Date());\n"
    "    gtag('config', 'G-QPQCFWE9EP');\n"
    '  </script>\n'
)

# ------------------------------------------------------------ templates
PAGE_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{page_title}</title>
  <meta name="description" content="{meta_desc}" />
  <link rel="canonical" href="{canonical}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="{og_title}" />
  <meta property="og:description" content="{meta_desc}" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:site_name" content="MrJobs" />
  <meta property="og:image" content="https://mrjobs.top/logo.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{og_title}" />
  <meta name="twitter:description" content="{meta_desc}" />
  <meta name="twitter:image" content="https://mrjobs.top/logo.png" />
  <meta name="theme-color" content="#2d849e" />
  <link rel="icon" href="../assets/logo-icon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="../assets/style.css?v=7" />
  <script type="application/ld+json">
{json_ld}
  </script>
{ga_snippet}
</head>
<body>
  <nav class="navbar">
    <div class="nav-container">
      <a class="nav-logo" href="../"><img src="../assets/logo.svg" alt="MrJobs logo" /></a>
      <button class="nav-toggle" id="navToggle" aria-label="Open menu">&#9776;</button>
      <ul class="nav-links" id="navLinks">
        <li><a href="../">Home</a></li>
        <li><a href="../all-jobs.html">All Jobs</a></li>
          <li><a href="../expired-jobs.html">Expired Jobs</a></li>
        <li><a href="../guide/">Guide</a></li>
        <li><a href="../blog/">Blog</a></li>
        <li><a href="../about.html">About</a></li>
        <li><a href="../contact.html">Contact</a></li>
      </ul>
    </div>
  </nav>

  <main class="wrap">
    <p class="crumbs"><a href="../">Home</a> &rsaquo; <a href="../all-jobs.html">All Jobs</a> &rsaquo; {crumb}</p>
    <article class="job-detail">
      {badge}
      {poster_img}
      <h1>{h1}</h1>
      <div class="job-meta"><i class="fas fa-building"></i><span>{company}</span></div>
      <div class="job-meta"><i class="fas fa-map-marker-alt"></i><span>{location}</span></div>
      <div class="job-meta"><i class="far fa-calendar-alt"></i><span>Posted {posted}</span></div>
      <div class="job-desc-full">
{desc_paras}
      </div>
      <div class="job-cta">
        <a class="apply-btn" href="{apply}" target="_blank" rel="noopener"><i class="fab fa-whatsapp"></i> Apply Now on WhatsApp</a>
        <button class="share-btn" id="shareBtn" data-id="{job_id}" data-title="{title_attr}" data-company="{company_attr}" data-location="{location_attr}" data-top20="{top20_attr}" data-isnew="{isnew_attr}"><i class="fas fa-share-alt"></i> Share</button>
        <a class="ghost-btn" href="../all-jobs.html"><i class="fas fa-arrow-left"></i> Back to all jobs</a>
      </div>
      <p class="job-note">This listing expires automatically {expiry_note}. Always verify details with the employer before applying.</p>
    </article>
  </main>

  <footer>
    <div class="footer-inner">
      <div>
        <h4>MrJobs</h4>
        <p>Connecting job seekers with employers across Pakistan &mdash; a free job board, all jobs welcome, with priority for pharmaceutical sales: Medical Representative, TM &amp; AM openings.</p>
      </div>
      <div>
        <h4>Explore</h4>
        <ul class="footer-links">
          <li><a href="../">Home</a></li>
          <li><a href="../all-jobs.html">All Jobs</a></li>
          <li><a href="../cities/faisalabad.html">Pharma Jobs in Faisalabad</a></li>
          <li><a href="../cities/jhang.html">Pharma Jobs in Jhang</a></li>
          <li><a href="../expired-jobs.html">Expired Jobs</a></li>
          <li><a href="../blog/">Blog</a></li>
          <li><a href="../about.html">About</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">&copy; {year} MrJobs &ndash; Connecting Job Seekers with Pakistan&rsquo;s Pharma Industry<br />Built with ❤️ by <a href="https://sufyanaura.netlify.app/" target="_blank" rel="noopener">Sufyan Aura</a> &middot; <a href="../privacy.html">Privacy</a> &middot; <a href="../contact.html">Contact</a></div>
  </footer>
  <script src="../assets/share-card.js?v=1"></script>
  <script>
    (function () {{
      var navToggle = document.getElementById('navToggle');
      if (navToggle) navToggle.addEventListener('click', function () {{
        document.getElementById('navLinks').classList.toggle('open');
      }});
      var btn = document.getElementById('shareBtn');
      if (btn && btn.addEventListener) {{
        btn.addEventListener('click', function () {{
          if (window.MrJobsShareCard) window.MrJobsShareCard.shareJob({{
            id: btn.getAttribute('data-id'),
            title: btn.getAttribute('data-title'),
            company: btn.getAttribute('data-company'),
            location: btn.getAttribute('data-location'),
            experience: '',
            top20: btn.getAttribute('data-top20') === '1',
            isNew: btn.getAttribute('data-isnew') === '1'
          }});
        }});
      }}
    }})();
  </script>
</body>
</html>
"""


def build_job_page(job):
    posted = parse_date(job.get("timestamp"))
    posted_iso = posted.isoformat() if posted else None
    valid_through = (posted + timedelta(days=EXPIRE_AFTER_DAYS)).isoformat() \
        if posted else None
    is_new = posted is not None and (date.today() - posted).days <= NEW_WITHIN_DAYS

    company = str(job.get("company", "")).strip()
    title = str(job.get("title", "")).strip()
    location = title_case_city(job.get("location", ""))
    desc = str(job.get("description", "")).strip()
    apply = str(job.get("applyLink", "")).strip() or "#"
    # Only web/mail apply destinations are allowed (security audit
    # 2026-10-21, finding 2) - javascript:/data:/etc. become "#".
    if apply != "#" and not apply.lower().startswith(("https://", "mailto:")):
        apply = "#"

    page_title = "%s — %s, %s | MrJobs" % (title, company, location)
    if len(page_title) > 75:
        short_company = company
        for suf in (" (Pvt.) Ltd", " (Pvt) Ltd", " Pvt. Ltd",
                    " (Private) Limited", " Limited", " Ltd"):
            if short_company.endswith(suf):
                short_company = short_company[: -len(suf)]
                break
        page_title = "%s — %s, %s | MrJobs" % (title, short_company, location)
    if len(page_title) > 75:
        page_title = "%s — %s | MrJobs" % (title, short_company)
    if len(page_title) > 78:
        page_title = page_title[:76].rstrip() + "…"
    desc_snippet = " ".join(desc.split())
    meta_desc = "%s at %s in %s — %s" % (title, company, location, desc_snippet)
    if len(meta_desc) > 157:
        meta_desc = meta_desc[:155].rstrip() + "…"
    canonical = SITE_URL + "/" + job_url_path(job)

    # WhatsApp apply links carry a pre-filled Roman-Urdu message naming the
    # company/title and linking back to this page (owner-approved template,
    # 2026-10-20). Mirrors applyHref() in assets/app.js.
    if apply.startswith("https://wa.me/") and "?" not in apply:
        wa_msg = ("Assalam-o-Alaikum! Mein ne MrJobs par *%s* ki *%s* wali vacancy (%s) "
                  "dekhi hai aur apply karna chahta hoon: %s. Shukriya."
                  % (company, title, location, canonical))
        apply = apply + "?text=" + urllib.parse.quote(wa_msg, safe="")

    schema = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": title,
        "description": desc,
        "employmentType": "FULL_TIME",
        "hiringOrganization": {
            "@type": "Organization",
            "name": company,
        },
        "jobLocation": {
            "@type": "Place",
            "address": {
                "@type": "PostalAddress",
                "addressLocality": location,
                "addressCountry": job.get("country") or "PK",
            },
        },
        "directApply": True,
        "url": canonical,
    }
    if posted_iso:
        schema["datePosted"] = posted_iso
    if valid_through:
        schema["validThrough"] = valid_through
    if (job.get("country") or "PK") == "PK":
        # every Pakistan listing on the board is in a Punjab city (verified
        # 2026-10-19) — quiets the Rich Results Test "addressRegion" warning
        schema["jobLocation"]["address"]["addressRegion"] = "Punjab"

    badge = ('<div class="badge new">NEW</div>' if is_new else "")
    data_uri = poster_data_uri(job)
    poster_img = ('<img class="job-poster-lg" src="%s" alt="%s" />'
                  % (esc(data_uri), esc("%s — job poster" % title))) \
        if data_uri else ""

    paras = "\n".join("        <p>%s</p>" % esc(p)
                      for p in desc.split("\n") if p.strip())

    return PAGE_TMPL.format(
        ga_snippet=GA_SNIPPET,
        page_title=esc(page_title),
        meta_desc=esc(meta_desc or page_title),
        canonical=esc(canonical),
        og_title=esc("%s at %s (%s)" % (title, company, location)),
        json_ld=safe_json_ld(schema),
        crumb=esc(title),
        badge=badge,
        poster_img=poster_img,
        h1=esc(title),
        company=esc(company),
        location=esc(location),
        posted=esc(posted.strftime("%d %b %Y") if posted else "recently"),
        desc_paras=paras,
        apply=esc(apply),
        expiry_note=esc("on " + (posted + timedelta(days=EXPIRE_AFTER_DAYS))
                        .strftime("%d %b %Y") if posted
                        else "28 days after posting"),
        year=date.today().year,
        job_id=esc(job.get("id", "")),
        title_attr=esc(title),
        company_attr=esc(company),
        location_attr=esc(location),
        top20_attr="1" if is_top20(job) else "0",
        isnew_attr="1" if is_new else "0",
    )


def build_sitemap(pages):
    urls = []
    for loc, lastmod, changefreq, priority in pages:
        lm = "\n    <lastmod>%s</lastmod>" % lastmod if lastmod else ""
        urls.append(
            "  <url>\n    <loc>%s</loc>%s\n    <changefreq>%s</changefreq>"
            "\n    <priority>%s</priority>\n  </url>"
            % (esc(loc), lm, changefreq, priority))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "\n".join(urls) + "\n</urlset>\n")


def minimal_sitemap():
    return build_sitemap([
        (SITE_URL + "/", None, "daily", "1.0"),
        (SITE_URL + "/all-jobs.html", None, "daily", "0.9"),
        (SITE_URL + "/cities/faisalabad.html", None, "daily", "0.9"),
        (SITE_URL + "/cities/jhang.html", None, "daily", "0.9"),
        (SITE_URL + "/expired-jobs.html", None, "weekly", "0.4"),
        (SITE_URL + "/about.html", None, "monthly", "0.5"),
        (SITE_URL + "/privacy.html", None, "monthly", "0.3"),
        (SITE_URL + "/contact.html", None, "monthly", "0.3"),
    ])



# ------------------------------------------------------ career guide
GUIDE_DIR = os.path.join(ROOT, "guide")

GUIDE_NAV = """
  <nav class="navbar">
    <div class="nav-container">
      <a class="nav-logo" href="../"><img src="../assets/logo.svg" alt="MrJobs logo" /></a>
      <button class="nav-toggle" id="navToggle" aria-label="Open menu">&#9776;</button>
      <ul class="nav-links" id="navLinks">
        <li><a href="../">Home</a></li>
        <li><a href="../all-jobs.html">All Jobs</a></li>
          <li><a href="../expired-jobs.html">Expired Jobs</a></li>
        <li><a href="../guide/" aria-current="page">Guide</a></li>
        <li><a href="../blog/">Blog</a></li>
        <li><a href="../about.html">About</a></li>
        <li><a href="../contact.html">Contact</a></li>
      </ul>
    </div>
  </nav>
"""

GUIDE_FOOTER = """
  <footer>
    <div class="footer-inner">
      <div>
        <h4>MrJobs</h4>
        <p>Connecting job seekers with employers across Pakistan &mdash; a free job board, all jobs welcome, with priority for pharmaceutical sales: Medical Representative, TM &amp; AM openings.</p>
      </div>
      <div>
        <h4>Explore</h4>
        <ul class="footer-links">
          <li><a href="../">Home</a></li>
          <li><a href="../all-jobs.html">All Jobs</a></li>
          <li><a href="../cities/faisalabad.html">Pharma Jobs in Faisalabad</a></li>
          <li><a href="../cities/jhang.html">Pharma Jobs in Jhang</a></li>
          <li><a href="../expired-jobs.html">Expired Jobs</a></li>
          <li><a href="../guide/">Career Guide</a></li>
          <li><a href="../blog/">Blog</a></li>
          <li><a href="../about.html">About</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">&copy; {year} MrJobs &ndash; Connecting Job Seekers with Pakistan&rsquo;s Pharma Industry<br />Built with ❤️ by <a href="https://sufyanaura.netlify.app/" target="_blank" rel="noopener">Sufyan Aura</a> &middot; <a href="../privacy.html">Privacy</a> &middot; <a href="../contact.html">Contact</a></div>
  </footer>
  <script>
    document.getElementById('navToggle').addEventListener('click', function () {{
      document.getElementById('navLinks').classList.toggle('open');
    }});
  </script>
"""

ARTICLE_TMPL = """<!DOCTYPE html>
<html lang="{lang}"{dir_attr}>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{page_title}</title>
  <meta name="description" content="{meta_desc}" />
  <link rel="canonical" href="{canonical}" />
  <link rel="alternate" hreflang="{alt_lang}" href="{alt_url}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="{og_title}" />
  <meta property="og:description" content="{meta_desc}" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:site_name" content="MrJobs" />
  <meta name="theme-color" content="#2d849e" />
  <link rel="icon" href="../assets/logo-icon.svg" type="image/svg+xml" />
{font_link}  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="../assets/style.css?v=7" />
  <script type="application/ld+json">
{json_ld}
  </script>
{ga_snippet}
</head>
<body>
{g_nav}
  <main class="wrap">
    <p class="crumbs"><a href="../">Home</a> &rsaquo; <a href="../guide/">{crumb_guide}</a> &rsaquo; {crumb}</p>
    <article class="article">
      <a class="lang-toggle" href="{alt_page}"><i class="fas fa-language"></i> {toggle_label}</a>
      <h1>{h1}</h1>
      <p class="article-meta">{meta_line}</p>
      <p class="article-intro">{intro}</p>
{sections}
      <div class="cta-box">
        <p>{cta_text}</p>
        <a class="apply-btn" href="../all-jobs.html"><i class="fas fa-briefcase"></i> {cta_btn}</a>
      </div>
    </article>
  </main>
{g_footer}
</body>
</html>
"""

GUIDE_INDEX_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Career Guide for Medical Representatives in Pakistan | MrJobs</title>
  <meta name="description" content="Free career guide for Medical Representatives in Pakistan — how to become an MR, interview questions, salary & incentives, CV tips. English and Urdu." />
  <link rel="canonical" href="{site}/guide/" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Career Guide for Medical Representatives | MrJobs" />
  <meta property="og:description" content="How to become an MR in Pakistan, interview tips, salary guide and CV advice — in English and Urdu." />
  <meta property="og:url" content="{site}/guide/" />
  <meta property="og:site_name" content="MrJobs" />
  <meta name="theme-color" content="#2d849e" />
  <link rel="icon" href="../assets/logo-icon.svg" type="image/svg+xml" />
  <link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="../assets/style.css?v=7" />
{ga_snippet}
</head>
<body>
{g_nav}
  <main class="wrap">
    <p class="crumbs"><a href="../">Home</a> &rsaquo; Career Guide</p>
    <div class="guide-hero">
      <h1>Career Guide for Medical Representatives</h1>
      <p>To-the-point guides for fresh candidates entering pharma sales in Pakistan — in English and اردو.</p>
    </div>
    <div class="guide-grid">
{cards}
    </div>
{recommended}  </main>
{g_footer}
</body>
</html>
"""


def guide_url(slug, lang):
    return "guide/%s%s.html" % (slug, "-urdu" if lang == "ur" else "")


def build_article_page(art, lang):
    other = "ur" if lang == "en" else "en"
    c = art[lang]
    slug = art["slug"]
    canonical = SITE_URL + "/" + guide_url(slug, lang)
    alt_url = SITE_URL + "/" + guide_url(slug, other)
    is_ur = lang == "ur"

    schema = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": c["title"],
        "description": c["desc"],
        "inLanguage": lang,
        "author": {"@type": "Organization", "name": "MrJobs",
                   "url": SITE_URL + "/"},
        "publisher": {"@type": "Organization", "name": "MrJobs",
                      "url": SITE_URL + "/"},
        "mainEntityOfPage": canonical,
    }

    secs = []
    for heading, bullets in c["sections"]:
        lis = "\n".join("          <li>%s</li>" % esc(b) for b in bullets)
        secs.append("      <h2>%s</h2>\n      <ul>\n%s\n      </ul>"
                    % (esc(heading), lis))
    font_link = ('  <link rel="preconnect" href="https://fonts.googleapis.com" />\n'
                 '  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />\n'
                 '  <link href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu:wght@400;600;700&display=swap" rel="stylesheet" />\n') if is_ur else ""

    return ARTICLE_TMPL.format(
        ga_snippet=GA_SNIPPET,
        lang=lang,
        dir_attr=' dir="rtl"' if is_ur else "",
        page_title=esc(c["title"] + " | MrJobs Career Guide"),
        meta_desc=esc(c["desc"]),
        canonical=esc(canonical),
        alt_lang=other,
        alt_url=esc(alt_url),
        og_title=esc(c["title"]),
        font_link=font_link,
        json_ld=safe_json_ld(schema),
        g_nav=GUIDE_NAV,
        crumb_guide=esc("Career Guide" if lang == "en" else "کیریئر گائیڈ"),
        crumb=esc(c["title"]),
        alt_page=esc(guide_url(slug, other)),
        toggle_label=esc("اردو میں پڑھیں" if lang == "en" else "Read in English"),
        h1=esc(c["title"]),
        meta_line=esc("MrJobs Career Guide" if lang == "en" else "MrJobs کیریئر گائیڈ"),
        intro=esc(c["intro"]),
        sections="\n".join(secs),
        cta_text=esc("Looking for openings? Browse the latest Medical Representative jobs."
                     if lang == "en" else "نوکریاں تلاش کر رہے ہیں؟ تازہ ترین میڈیکل ریپریزنٹیٹو آسامیاں دیکھیں۔"),
        cta_btn=esc("View all jobs" if lang == "en" else "تمام نوکریاں دیکھیں"),
        g_footer=GUIDE_FOOTER.format(year=date.today().year),
    )



TOP20_COMPANIES = [
    "Getz Pharma",
    "GlaxoSmithKline Pakistan (GSK)",
    "Abbott Laboratories Pakistan",
    "SAMI Pharmaceuticals",
    "The Searle Company",
    "Martin Dow Ltd.",
    "Hilton Pharma",
    "High-Q International",
    "Ferozsons Laboratories",
    "Highnoon Laboratories",
    "CCL Pharmaceuticals",
    "AGP Limited",
    "Bosch Pharmaceuticals",
    "OBS Pakistan",
    "Barrett Hodgson Pakistan",
    "Atco Laboratories",
    "Indus Pharma",
    "PharmEvo Private Limited",
    "Macter International",
    "Nabiqasim Group",
]


def build_top20_list_html():
    """Static ranked list of the top-20 pharma companies for the guide page."""
    items = []
    for i, name in enumerate(TOP20_COMPANIES, 1):
        items.append(
            '      <li><span class="top20-num">%d</span>'
            '<i class="fas fa-award"></i><span>%s</span></li>'
            % (i, esc(name)))
    return (
        '    <section class="recommended-section" '
        'aria-label="Top 20 pharmaceutical companies of Pakistan">\n'
        '      <div class="rec-head">\n'
        '        <h2><i class="fas fa-star"></i> Top 20 Pharma Companies '
        'of Pakistan</h2>\n'
        '        <p class="rec-msg">Fresh science graduate? Apply to these '
        'top 20 pharmaceutical companies of Pakistan on '
        '<strong>priority</strong> — they offer the best training, salary '
        'packages, and long-term career growth.</p>\n'
        '      </div>\n'
        '      <ol class="top20-list">\n' + "\n".join(items) +
        '\n      </ol>\n'
        '    </section>\n')


def build_guide_index():
    cards = []
    for art in GUIDE_ARTICLES:
        en, ur = art["en"], art["ur"]
        cards.append(
            '      <div class="guide-card">\n'
            '        <h3>%s</h3>\n'
            '        <p class="ur-title" dir="rtl" lang="ur">%s</p>\n'
            '        <p>%s</p>\n'
            '        <div class="guide-links">\n'
            '          <a href="%s">Read in English</a>\n'
            '          <a href="%s" lang="ur">اردو میں پڑھیں</a>\n'
            '        </div>\n'
            '      </div>'
            % (esc(en["title"]), esc(ur["title"]), esc(en["desc"]),
               esc(art["slug"] + ".html"), esc(art["slug"] + "-urdu.html")))
    return GUIDE_INDEX_TMPL.format(
        ga_snippet=GA_SNIPPET,
        site=SITE_URL,
        g_nav=GUIDE_NAV,
        cards="\n".join(cards),
        recommended=build_top20_list_html(),
        g_footer=GUIDE_FOOTER.format(year=date.today().year),
    )


def build_guide(pages):
    """Render guide pages; append their URLs to the sitemap page list."""
    if not GUIDE_ARTICLES:
        print("  guide: no articles, skipping")
        return
    os.makedirs(GUIDE_DIR, exist_ok=True)
    with open(os.path.join(GUIDE_DIR, "index.html"), "w", encoding="utf-8") as f:
        f.write(build_guide_index())
    pages.append((SITE_URL + "/guide/", date.today().isoformat(),
                  "monthly", "0.7"))
    n = 0
    for art in GUIDE_ARTICLES:
        for lang in ("en", "ur"):
            rel = guide_url(art["slug"], lang)
            try:
                html_page = build_article_page(art, lang)
            except Exception as e:  # noqa: BLE001
                print("  warn: guide page failed %s/%s: %s" % (art["slug"], lang, e),
                      file=sys.stderr)
                continue
            write_page(rel, html_page)
            pages.append((SITE_URL + "/" + rel, date.today().isoformat(),
                          "monthly", "0.7"))
            n += 1
    print("  guide: wrote index + %d article pages" % n)


# ------------------------------------------------------ city landing pages
# Pharmajobs.pk-style city hubs, generated from jobs.json.
CITIES = [("Faisalabad", "faisalabad"), ("Jhang", "jhang")]

CITY_NAV = """
  <nav class="navbar">
    <div class="nav-container">
      <a class="nav-logo" href="../"><img src="../assets/logo.svg" alt="MrJobs logo" /></a>
      <button class="nav-toggle" id="navToggle" aria-label="Open menu">&#9776;</button>
      <ul class="nav-links" id="navLinks">
        <li><a href="../">Home</a></li>
        <li><a href="../all-jobs.html">All Jobs</a></li>
        <li><a href="../expired-jobs.html">Expired Jobs</a></li>
        <li><a href="../guide/">Guide</a></li>
        <li><a href="../blog/">Blog</a></li>
        <li><a href="../about.html">About</a></li>
        <li><a href="../contact.html">Contact</a></li>
      </ul>
    </div>
  </nav>
"""

CITY_FOOTER = """
  <footer>
    <div class="footer-inner">
      <div>
        <h4>MrJobs</h4>
        <p>Connecting job seekers with employers across Pakistan &mdash; a free job board, all jobs welcome, with priority for pharmaceutical sales: Medical Representative, TM &amp; AM openings.</p>
      </div>
      <div>
        <h4>Explore</h4>
        <ul class="footer-links">
          <li><a href="../">Home</a></li>
          <li><a href="../all-jobs.html">All Jobs</a></li>
{cities_links}          <li><a href="../expired-jobs.html">Expired Jobs</a></li>
          <li><a href="../guide/">Career Guide</a></li>
          <li><a href="../blog/">Blog</a></li>
          <li><a href="../about.html">About</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">&copy; {year} MrJobs &ndash; Connecting Job Seekers with Pakistan&rsquo;s Pharma Industry<br />Built with ❤️ by <a href="https://sufyanaura.netlify.app/" target="_blank" rel="noopener">Sufyan Aura</a> &middot; <a href="../privacy.html">Privacy</a> &middot; <a href="../contact.html">Contact</a></div>
  </footer>
  <script>
    document.getElementById('navToggle').addEventListener('click', function () {{
      document.getElementById('navLinks').classList.toggle('open');
    }});
  </script>
"""

CITY_PAGE_TMPL = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{page_title}</title>
  <meta name="description" content="{meta_desc}" />
  <link rel="canonical" href="{canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="{og_title}" />
  <meta property="og:description" content="{meta_desc}" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:site_name" content="MrJobs" />
  <meta property="og:image" content="https://mrjobs.top/logo.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{og_title}" />
  <meta name="twitter:description" content="{meta_desc}" />
  <meta name="twitter:image" content="https://mrjobs.top/logo.png" />
  <meta name="theme-color" content="#2d849e" />
  <link rel="icon" href="../assets/logo-icon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="../assets/style.css?v=7" />
  <script type="application/ld+json">
{json_ld}
  </script>
{ga_snippet}
</head>
<body>
{c_nav}
  <main class="wrap">
    <p class="crumbs"><a href="../">Home</a> &rsaquo; {h1}</p>
    <h1>{h1}</h1>
    <p class="city-intro">{intro}</p>
    <div class="city-jobs">
{job_rows}
    </div>
    <p class="city-more">Looking beyond {city}? <a href="../all-jobs.html">Browse all jobs across Pakistan</a>{other_city_link}.</p>
  </main>
{c_footer}
</body>
</html>
"""


def build_city_page(city, slug, city_jobs_list):
    canonical = SITE_URL + "/cities/%s.html" % slug
    og_title = "Pharma Jobs in %s – MrJobs" % city
    meta_desc = ("Latest pharma jobs in %s: Medical Representative, TM, AM "
                 "& more at Pakistan's top pharma companies. Apply via "
                 "WhatsApp on MrJobs." % city)
    today = date.today()

    rows = []
    for job in city_jobs_list:
        posted = parse_date(job.get("timestamp"))
        is_new = posted is not None and (today - posted).days <= NEW_WITHIN_DAYS
        rows.append(
            '      <div class="city-job">'
            + ('<span class="badge new">NEW</span>' if is_new else "")
            + '<h3><a href="../%s">%s</a></h3>' % (esc(job_url_path(job)),
                                                  esc(job.get("title", "")))
            + '<div class="job-meta"><i class="fas fa-building"></i><span>%s</span></div>'
              % esc(job.get("company", ""))
            + '<div class="job-meta"><i class="fas fa-map-marker-alt"></i><span>%s</span></div>'
              % esc(title_case_city(job.get("location", "")))
            + ('<div class="job-meta"><i class="far fa-calendar-alt"></i><span>Posted %s</span></div>'
               % esc(posted.strftime("%d %b %Y")) if posted else "")
            + "</div>")
    if not rows:
        rows.append('      <div class="state"><p>No open positions in %s right now — check back soon.</p></div>' % esc(city))

    # ItemList entries are plain name+url ListItems on purpose: typing them as
    # JobPosting made Google validate each as a full job posting and flag
    # missing description/validThrough etc. (Search Console, 2026-10-20).
    # The canonical JobPosting lives on each job's own page.
    items = []
    for i, job in enumerate(city_jobs_list, 1):
        items.append({
            "@type": "ListItem",
            "position": i,
            "name": "%s — %s" % (str(job.get("title", "")),
                                 str(job.get("company", ""))),
            "url": SITE_URL + "/" + job_url_path(job),
        })
    json_ld = safe_json_ld({
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": og_title,
        "url": canonical,
        "itemListElement": items,
    })

    other = [c for c in CITIES if c[0] != city]
    other_link = (' or see <a href="%s.html">pharma jobs in %s</a>'
                  % (other[0][1], other[0][0])) if other else ""

    return CITY_PAGE_TMPL.format(
        ga_snippet=GA_SNIPPET,
        page_title=esc(og_title),
        meta_desc=esc(meta_desc),
        canonical=esc(canonical),
        og_title=esc(og_title),
        json_ld=json_ld,
        c_nav=CITY_NAV,
        h1=esc("Pharma Jobs in %s" % city),
        intro=esc("All open pharma jobs in %s — Medical Representative, TM, "
                 "AM and more, newest first. Apply directly with a single "
                 "WhatsApp click, free for job seekers." % city),
        city=esc(city),
        other_city_link=other_link,
        job_rows="\n".join(rows),
        c_footer=CITY_FOOTER.format(
            year=today.year,
            cities_links="\n".join(
                '          <li><a href="../cities/%s.html">Pharma Jobs in %s</a></li>'
                % (s, c) for c, s in CITIES)),
    )


def build_cities(active_jobs, pages):
    """Write cities/<slug>.html for each city; append URLs to the sitemap."""
    out = os.path.join(ROOT, "cities")
    os.makedirs(out, exist_ok=True)
    for city, slug in CITIES:
        matched = [j for j in active_jobs
                   if city.lower() in str(j.get("location", "")).lower()]
        matched.sort(key=lambda j: str(j.get("timestamp", "")), reverse=True)
        try:
            page_html = build_city_page(city, slug, matched)
        except Exception as e:  # noqa: BLE001
            print("  warn: city page failed %s: %s" % (city, e), file=sys.stderr)
            continue
        write_page("cities/" + slug + ".html", page_html)
        pages.append((SITE_URL + "/cities/%s.html" % slug,
                      date.today().isoformat(), "daily", "0.9"))
        print("  city: %s — %d jobs" % (slug, len(matched)))



# ----------------------------------------------------------------- main
def main():
    try:
        with open(JOBS_JSON, encoding="utf-8") as f:
            jobs = json.load(f)
    except Exception as e:  # noqa: BLE001
        print("ERROR reading jobs.json: %s - failing the build so a broken "
              "dataset can never publish a gutted site" % e,
              file=sys.stderr)
        return 1

    active = [j for j in dedupe(jobs) if not is_expired(j)]
    print("jobs.json: %d entries, %d active" % (len(jobs), len(active)))

    os.makedirs(JOBS_DIR, exist_ok=True)
    today_iso = date.today().isoformat()
    pages = [
        (SITE_URL + "/", today_iso, "daily", "1.0"),
        (SITE_URL + "/all-jobs.html", today_iso, "daily", "0.9"),
        (SITE_URL + "/expired-jobs.html", today_iso, "weekly", "0.4"),
        (SITE_URL + "/about.html", today_iso, "monthly", "0.5"),
        (SITE_URL + "/privacy.html", today_iso, "monthly", "0.3"),
        (SITE_URL + "/contact.html", today_iso, "monthly", "0.3"),
        (SITE_URL + "/blog/", today_iso, "weekly", "0.6"),
    ]
    blog_dir = os.path.join(ROOT, "blog")
    if os.path.isdir(blog_dir):
        for fn in sorted(os.listdir(blog_dir)):
            if fn.endswith(".html") and fn != "index.html":
                pages.append((SITE_URL + "/blog/" + fn[:-5],
                              today_iso, "monthly", "0.6"))
    for job in active:
        rel = job_url_path(job)
        try:
            page_html = build_job_page(job)
        except Exception as e:  # noqa: BLE001
            print("  warn: skipping %s: %s" % (job.get("id"), e),
                  file=sys.stderr)
            continue
        write_page(rel, page_html)
        posted = parse_date(job.get("timestamp"))
        pages.append((SITE_URL + "/" + rel,
                      posted.isoformat() if posted else None,
                      "weekly", "0.8"))

    build_guide(pages)

    build_cities(active, pages)

    with open(SITEMAP, "w", encoding="utf-8") as f:
        f.write(build_sitemap(pages))
    print("wrote sitemap.xml with %d urls" % len(pages))
    return 0


if __name__ == "__main__":
    sys.exit(main())
