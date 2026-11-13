# JLPT Spin

Japanese speaking practice. You spin a word, look at the starter phrases and talk about it until the timer beeps. Words go from N5 to N1 and have English and Hindi meanings.

Live at https://jlptspin.com

## Settings

Handles, hashtag, the MailerLite signup form and the Google Analytics ID are all in `config.js`.

## Adding or fixing words

Words are in `words.json`, one per line:

```json
{"level":"N5","kanji":"家族","kana":"かぞく","en":"family","hi":"परिवार","starters":["わたしの家族は〜人です","家族と〜をします"]}
```

For katakana words put the same text in `kanji` and `kana`. Each word should have 2 or 3 starters, with 〜 where the learner fills in their own words.

## Links

`?level=N4&w=旅行` opens a specific word. The "Share this word" button makes this link for you.

## Running it locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765. It needs a local server because the browser won't load `words.json` from a file.

Plain HTML, CSS and JavaScript. No build step. Hosted on GitHub Pages.
