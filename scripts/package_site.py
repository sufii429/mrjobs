#!/usr/bin/env python3
"""Build public-only assets in dist; keep functions, tests and source out of CDN."""
import json
import shutil
from pathlib import Path
from guide_content import ARTICLES

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'dist'


def main():
    if DEST.exists():
        shutil.rmtree(DEST)
    DEST.mkdir()
    for name in ['index.html', 'all-jobs.html', 'expired-jobs.html', 'about.html',
                 'jobs.json', 'logo.png', 'robots.txt', 'sitemap.xml']:
        source = ROOT / name
        if source.is_file():
            shutil.copy2(source, DEST / name)
    for name in ['assets', 'posters', 'jobs', 'guide', 'blog']:
        source = ROOT / name
        if source.is_dir():
            shutil.copytree(source, DEST / name)
    guides = []
    for article in ARTICLES:
        for language in ['en', 'ur']:
            content = article.get(language)
            if not content:
                continue
            slug = article['slug'] + ('-urdu' if language == 'ur' else '')
            guides.append({
                'id': slug,
                'title': content['title'],
                'url': '/guide/' + slug + '.html',
                'language': language,
                'intro': content.get('intro', ''),
                'scope': 'General Pakistan pharmaceutical/medical-sales career guidance; not an employer-specific job requirement or verified current salary.',
                'sections': [{'heading': heading, 'paragraphs': paragraphs}
                             for heading, paragraphs in content.get('sections', [])],
            })
    (DEST / 'assistant-guides.json').write_text(json.dumps(guides, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for forbidden in ['server', 'netlify', 'tests', '.git', 'node_modules', '.env']:
        assert not (DEST / forbidden).exists(), 'Private source must not be published: ' + forbidden
    print('Packaged public website and %d career guides in dist/' % len(guides))


if __name__ == '__main__':
    main()
