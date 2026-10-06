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
  <link rel="stylesheet" href="../assets/style.css" />
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

    with open(SITEMAP, "w", encoding="utf-8") as f:
        f.write(build_sitemap(pages))
    print("wrote %d job pages + sitemap.xml" % (len(pages) - 3))
    return 0


if __name__ == "__main__":
    sys.exit(main())
