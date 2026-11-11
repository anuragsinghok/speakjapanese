# JLPT Spin 🎡

*Spin a word · speak for 1 minute.*

Japanese speaking practice: spin a word, get starter phrases, speak until the beep.
JLPT N5–N2, with English and **Hindi** meanings.

**Live:** https://jlptspin.com

## Edit your settings
Everything personal lives in [`config.js`](config.js):

| Setting | What it does |
|---|---|
| `instagram`, `youtube` | Your handles, without the `@`. Shown at the top, in the share box and in the footer |
| `hashtag` | Defaults to `JLPTSpin` |
| `emailEndpoint` | Where email signups are sent. Leave it empty and the box says "signups open soon" |
| `goatcounter` | Optional free analytics code. It counts spins, listens, timers, shares and signups |

### Turn on email signups (about 2 minutes)
1. Make a free form at https://formspree.io and copy its URL (`https://formspree.io/f/xxxx`).
2. Paste it into `emailEndpoint` and push.
3. In Formspree, set an auto-reply that sends the schedule PDF or Notion link.

MailerLite or Brevo embedded-form action URLs work too.

## Add or fix words
Edit [`words.json`](words.json). Each line is one word:
```json
{"level":"N5","kanji":"家族","kana":"かぞく","en":"family","hi":"परिवार","starters":["わたしの家族は〜人です","家族と〜をします"]}
```
- `kana` is the reading. For katakana words, use the same text as `kanji`.
- Give 2–3 `starters`, with `〜` as the blank the learner fills in.

## Handy for reels
- `?level=N4&w=旅行` opens a specific word. The **Share this word** button builds this link for you.
- **Copy caption** copies the word, meaning and hashtags ready to paste.
- Press <kbd>Space</kbd> to spin on a laptop.
- The first word on each level is a fixed **word of the day**.

## Run locally
```bash
python3 -m http.server 8765
```
Then open http://localhost:8765. It has to be served over HTTP, because `fetch` won't load `words.json` from `file://`.

Plain HTML/CSS/JS, with no build step. Hosted on GitHub Pages from `main`.
