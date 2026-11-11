"""Builds the vocabulary list pages (n5/ ... n2/) and sitemap.xml from words.json.
Run from the repo root:  python3 tools/build_pages.py
"""
import json, html, os
from datetime import date

SITE = "https://jlptspin.com"
V = "13"
words = json.load(open("words.json", encoding="utf-8"))
LEVELS = ["N5", "N4", "N3", "N2"]
INFO = {
    "N5": ("beginner", "Everyday words you'll use from your first week: family, food, weather, school, hobbies."),
    "N4": ("elementary", "Words for talking about your own life: work, travel, plans, habits and experiences."),
    "N3": ("intermediate", "Words for opinions and feelings: goals, stress, relationships, society and work life."),
    "N2": ("upper intermediate", "Words for discussing bigger topics: career, technology, education and social issues."),
}
esc = html.escape

def page(lv):
    items = [w for w in words if w["level"] == lv]
    lvl_name, blurb = INFO[lv]
    low = lv.lower()
    rows = []
    for w in items:
        reading = w["kana"] if w["kana"] != w["kanji"] else ""
        practice = f"../?level={lv}&amp;w={esc(w['kanji'])}"
        starters = "<br>".join(esc(s) for s in w["starters"][:2])
        rows.append(f"""        <tr>
          <td class="jp w"><b>{esc(w['kanji'])}</b>{f'<span class="r">{esc(reading)}</span>' if reading else ''}</td>
          <td>{esc(w['en'])}</td>
          <td lang="hi" class="hi">{esc(w.get('hi',''))}</td>
          <td class="jp s">{starters}</td>
          <td><a class="go" href="{practice}">Practise</a></td>
        </tr>""")
    others = " ".join(
        f'<a href="../{l.lower()}/"{" aria-current=\"page\"" if l == lv else ""}>{l}</a>' for l in LEVELS)
    title = f"JLPT {lv} vocabulary list with Hindi and English meanings | JLPT Spin"
    desc = (f"{len(items)} JLPT {lv} words with reading, English meaning, Hindi meaning (हिंदी अर्थ) "
            f"and sentence starters for speaking practice. Free.")
    faq = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": f"JLPT {lv} vocabulary with Hindi meanings",
        "numberOfItems": len(items),
        "itemListElement": [
            {"@type": "ListItem", "position": i + 1,
             "item": {"@type": "DefinedTerm", "name": w["kanji"],
                      "description": f"{w['kana']}: {w['en']} / {w.get('hi','')}",
                      "inDefinedTermSet": f"{SITE}/{low}/"}}
            for i, w in enumerate(items)],
    }
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{esc(title)}</title>
  <meta name="description" content="{esc(desc)}">
  <meta name="theme-color" content="#14110f">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://www.googletagmanager.com; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:; base-uri 'none'; object-src 'none'">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <link rel="canonical" href="{SITE}/{low}/">
  <meta property="og:title" content="JLPT {lv} vocabulary with Hindi and English meanings">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="{SITE}/{low}/">
  <meta property="og:image" content="{SITE}/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🎡</text></svg>">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Outfit:wght@400;500;600&family=Shippori+Mincho:wght@500;700&family=Noto+Sans+Devanagari:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../styles.css?v={V}">
  <script type="application/ld+json">{json.dumps(faq, ensure_ascii=False)}</script>
</head>
<body>
  <div class="glow" aria-hidden="true"></div>
  <header class="top">
    <a href="../" class="brand-link"><p class="brand">JLPT <span class="amp">Spin</span></p></a>
  </header>
  <main class="wrap legal vocab">
    <nav class="lvnav" aria-label="Levels">{others}</nav>
    <h1>JLPT {lv} vocabulary with Hindi and English meanings</h1>
    <p>{esc(blurb)} Each word has its reading, the meaning in English and Hindi, and two sentence starters so you can actually say something with it. Tap <b>Practise</b> to open the word on JLPT Spin and talk about it for a minute.</p>
    <p class="note">This is a {lvl_name} list of {len(items)} words I picked because they're easy to talk about. It isn't the full official {lv} list.</p>
    <div class="tablewrap">
      <table class="vt">
        <thead><tr><th>Word</th><th>English</th><th>Hindi</th><th>Starters</th><th></th></tr></thead>
        <tbody>
{chr(10).join(rows)}
        </tbody>
      </table>
    </div>
    <p class="cta"><a class="btn primary small" href="../?level={lv}">Practise {lv} words now</a></p>
    <p class="back"><a href="../">Back to JLPT Spin</a> | <a href="../privacy.html">Privacy policy</a></p>
  </main>
  <script src="../config.js?v={V}"></script>
  <script src="../ga.js?v={V}"></script>
</body>
</html>
"""

for lv in LEVELS:
    os.makedirs(lv.lower(), exist_ok=True)
    open(f"{lv.lower()}/index.html", "w", encoding="utf-8").write(page(lv))

today = date.today().isoformat()
urls = [("/", "1.0"), ("/forum/", "0.6"), ("/n5/", "0.8"), ("/n4/", "0.8"), ("/n3/", "0.8"), ("/n2/", "0.8"), ("/privacy.html", "0.2")]
sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for u, p in urls:
    sm.append(f"  <url><loc>{SITE}{u}</loc><lastmod>{today}</lastmod><priority>{p}</priority></url>")
sm.append("</urlset>")
open("sitemap.xml", "w").write("\n".join(sm) + "\n")
print("built", LEVELS, "and sitemap.xml")
