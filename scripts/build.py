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
from datetime import date, datetime, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
try:
    from guide_content import ARTICLES as GUIDE_ARTICLES
except ImportError:
    GUIDE_ARTICLES = []  # guide content not present — skip guide pages


# ---------------------------------------------------------------- config
SITE_URL = "https://mrjobs.netlify.app"   # no trailing slash
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
    return "jobs/%s-%s.html" % (job.get("id"), job_slug(job))


def parse_date(s):
    try:
        return datetime.strptime(str(s).strip(), "%Y-%m-%d").date()
    except (ValueError, TypeError, AttributeError):
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
    path = os.path.join(ROOT, str(img).lstrip("/"))
    if not os.path.isfile(path):
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
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{og_title}" />
  <meta name="twitter:description" content="{meta_desc}" />
  <meta name="theme-color" content="#2d849e" />
  <link rel="icon" href="../assets/logo-icon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <link rel="stylesheet" href="../assets/style.css?v=3" />
  <script type="application/ld+json">
{json_ld}
  </script>
</head>
<body>
  <nav class="navbar">
    <div class="nav-container">
      <a class="nav-logo" href="../"><img src="../assets/logo.svg" alt="MrJobs logo" /></a>
      <button class="nav-toggle" id="navToggle" aria-label="Open menu">&#9776;</button>
      <ul class="nav-links" id="navLinks">
        <li><a href="../">Home</a></li>
        <li><a href="../all-jobs.html">All Jobs</a></li>
        <li><a href="../guide/">Guide</a></li>
        <li><a href="../blog/">Blog</a></li>
        <li><a href="../about.html">About</a></li>
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
        <a class="ghost-btn" href="../all-jobs.html"><i class="fas fa-arrow-left"></i> Back to all jobs</a>
      </div>
      <p class="job-note">This listing expires automatically {expiry_note}. Always verify details with the employer before applying.</p>
    </article>
  </main>

  <footer>
    <div class="footer-inner">
      <div>
        <h4>MrJobs</h4>
        <p>Connecting medical sales professionals with Pakistan&rsquo;s pharmaceutical industry &mdash; a free job board for Medical Representative, TM &amp; AM openings.</p>
      </div>
      <div>
        <h4>Explore</h4>
        <ul class="footer-links">
          <li><a href="../">Home</a></li>
          <li><a href="../all-jobs.html">All Jobs</a></li>
          <li><a href="../blog/">Blog</a></li>
          <li><a href="../about.html">About</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">&copy; {year} MrJobs &ndash; Connecting Medical Sales Professionals with Pakistan&rsquo;s Pharma Industry</div>
  </footer>
  <script>
    document.getElementById('navToggle').addEventListener('click', function () {{
      document.getElementById('navLinks').classList.toggle('open');
    }});
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

    page_title = "%s — %s, %s | MrJobs" % (title, company, location)
    meta_desc = (desc[:155] + "…") if len(desc) > 157 else desc
    meta_desc = " ".join(meta_desc.split())
    canonical = SITE_URL + "/" + job_url_path(job)

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
                "addressCountry": "PK",
            },
        },
        "directApply": True,
        "url": canonical,
    }
    if posted_iso:
        schema["datePosted"] = posted_iso
    if valid_through:
        schema["validThrough"] = valid_through

    badge = ('<div class="badge new">NEW</div>' if is_new else "")
    data_uri = poster_data_uri(job)
    poster_img = ('<img class="job-poster-lg" src="%s" alt="%s" />'
                  % (esc(data_uri), esc("%s — job poster" % title))) \
        if data_uri else ""

    paras = "\n".join("        <p>%s</p>" % esc(p)
                      for p in desc.split("\n") if p.strip())

    return PAGE_TMPL.format(
        page_title=esc(page_title),
        meta_desc=esc(meta_desc or page_title),
        canonical=esc(canonical),
        og_title=esc("%s at %s (%s)" % (title, company, location)),
        json_ld=json.dumps(schema, ensure_ascii=False, indent=2),
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
        (SITE_URL + "/about.html", None, "monthly", "0.5"),
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
        <li><a href="../guide/" aria-current="page">Guide</a></li>
        <li><a href="../blog/">Blog</a></li>
        <li><a href="../about.html">About</a></li>
      </ul>
    </div>
  </nav>
"""

GUIDE_FOOTER = """
  <footer>
    <div class="footer-inner">
      <div>
        <h4>MrJobs</h4>
        <p>Connecting medical sales professionals with Pakistan&rsquo;s pharmaceutical industry &mdash; a free job board for Medical Representative, TM &amp; AM openings.</p>
      </div>
      <div>
        <h4>Explore</h4>
        <ul class="footer-links">
          <li><a href="../">Home</a></li>
          <li><a href="../all-jobs.html">All Jobs</a></li>
          <li><a href="../guide/">Career Guide</a></li>
          <li><a href="../blog/">Blog</a></li>
          <li><a href="../about.html">About</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">&copy; {year} MrJobs &ndash; Connecting Medical Sales Professionals with Pakistan&rsquo;s Pharma Industry</div>
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
  <link rel="stylesheet" href="../assets/style.css?v=3" />
  <script type="application/ld+json">
{json_ld}
  </script>
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
  <link rel="stylesheet" href="../assets/style.css?v=3" />
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
  </main>
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
        lang=lang,
        dir_attr=' dir="rtl"' if is_ur else "",
        page_title=esc(c["title"] + " | MrJobs Career Guide"),
        meta_desc=esc(c["desc"]),
        canonical=esc(canonical),
        alt_lang=other,
        alt_url=esc(alt_url),
        og_title=esc(c["title"]),
        font_link=font_link,
        json_ld=json.dumps(schema, ensure_ascii=False, indent=2),
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
        site=SITE_URL,
        g_nav=GUIDE_NAV,
        cards="\n".join(cards),
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
    pages.append((SITE_URL + "/guide/", None, "monthly", "0.7"))
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
            with open(os.path.join(ROOT, rel), "w", encoding="utf-8") as f:
                f.write(html_page)
            pages.append((SITE_URL + "/" + rel, None, "monthly", "0.7"))
            n += 1
    print("  guide: wrote index + %d article pages" % n)


# ----------------------------------------------------------------- main
def main():
    try:
        with open(JOBS_JSON, encoding="utf-8") as f:
            jobs = json.load(f)
    except Exception as e:  # noqa: BLE001
        print("ERROR reading jobs.json: %s — writing minimal sitemap" % e,
              file=sys.stderr)
        with open(SITEMAP, "w", encoding="utf-8") as f:
            f.write(minimal_sitemap())
        return 0

    active = [j for j in dedupe(jobs) if not is_expired(j)]
    print("jobs.json: %d entries, %d active" % (len(jobs), len(active)))

    os.makedirs(JOBS_DIR, exist_ok=True)
    pages = [
        (SITE_URL + "/", None, "daily", "1.0"),
        (SITE_URL + "/all-jobs.html", None, "daily", "0.9"),
        (SITE_URL + "/about.html", None, "monthly", "0.5"),
    ]
    for job in active:
        rel = job_url_path(job)
        try:
            page_html = build_job_page(job)
        except Exception as e:  # noqa: BLE001
            print("  warn: skipping %s: %s" % (job.get("id"), e),
                  file=sys.stderr)
            continue
        with open(os.path.join(ROOT, rel), "w", encoding="utf-8") as f:
            f.write(page_html)
        posted = parse_date(job.get("timestamp"))
        pages.append((SITE_URL + "/" + rel,
                      posted.isoformat() if posted else None,
                      "weekly", "0.8"))

    build_guide(pages)

    with open(SITEMAP, "w", encoding="utf-8") as f:
        f.write(build_sitemap(pages))
    print("wrote sitemap.xml with %d urls" % len(pages))
    return 0


if __name__ == "__main__":
    sys.exit(main())
