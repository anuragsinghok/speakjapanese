(() => {
  "use strict";

  const CFG = Object.assign(
    { instagram: "", youtube: "", hashtag: "JLPTSpin", emailEndpoint: "", googleAnalytics: "" },
    window.SPIN_CONFIG || {}
  );
  const LEVELS = ["N5", "N4", "N3", "N2"];
  const LEVEL_HINTS = {
    N5: "Beginner, everyday words",
    N4: "Elementary, talking about your life",
    N3: "Intermediate, opinions and feelings",
    N2: "Upper intermediate, society and ideas",
  };
  const SPIN_MS = 1500;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const store = {
    get(k, d) { try { const v = localStorage.getItem("ss:" + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("ss:" + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // State
  const byLevel = { N5: [], N4: [], N3: [], N2: [] };
  const bags = {};
  let level = "N5";
  let current = null;
  let spinning = false;
  let spinToken = 0;
  let loaded = false;

  // Handles / links
  const igHandle = String(CFG.instagram || "").replace(/^@/, "").trim();
  const ytHandle = String(CFG.youtube || "").replace(/^@/, "").trim();
  const tag = String(CFG.hashtag || "JLPTSpin").replace(/^#/, "").trim();
  const igUrl = igHandle ? `https://www.instagram.com/${encodeURIComponent(igHandle)}/` : "https://www.instagram.com/";
  const ytUrl = ytHandle ? `https://www.youtube.com/@${encodeURIComponent(ytHandle)}/videos` : "https://www.youtube.com/";

  function applyHandles() {
    $$("a.js-ig").forEach((a) => (a.href = igUrl));
    $$("a.js-yt").forEach((a) => (a.href = ytUrl));
    const li = String(CFG.linkedin || "").trim();
    const liOk = /^https:\/\/(www\.)?linkedin\.com\//.test(li);
    $$("a.js-li").forEach((a) => { if (liOk) a.href = li; else a.hidden = true; });
    $$(".js-ig-text").forEach((el) => (el.textContent = igHandle ? "@" + igHandle : "Instagram"));
    $$(".js-tag").forEach((el) => (el.textContent = "#" + tag));
  }

  // Toast
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  // Analytics (optional)
  // Google Analytics 4 (only loads when a G- ID is set in config.js)
  function track(name, params) {
    try {
      if (typeof window.gtag === "function") window.gtag("event", name, Object.assign({ level }, params || {}));
    } catch { /* ignore */ }
  }
  function loadAnalytics() {
    const id = String(CFG.googleAnalytics || "").trim();
    if (!/^G-[A-Z0-9]{4,}$/i.test(id)) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", id, { anonymize_ip: true });
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    document.head.appendChild(s);
  }

  // Words
  function isValidWord(w) {
    return w && LEVELS.includes(w.level) && typeof w.kanji === "string" && w.kanji.trim() &&
      typeof w.en === "string" && Array.isArray(w.starters);
  }

  async function loadWords() {
    const res = await fetch("words.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    data.filter(isValidWord).forEach((w) => byLevel[w.level].push(w));
    loaded = true;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Shuffle-bag: every word in a level appears once before any repeats.
  function nextWord(lv) {
    const list = byLevel[lv];
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    if (!bags[lv] || !bags[lv].length) {
      // Leave out the word on screen (word of the day / shared / last of previous bag)
      bags[lv] = shuffle(list.filter((w) => w !== current));
    }
    return bags[lv].pop();
  }

  function dailyWord(lv) {
    const list = byLevel[lv];
    if (!list.length) return null;
    const d = new Date();
    const seed = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
    return list[(seed * 2654435761 >>> 0) % list.length];
  }

  // Rendering
  function sizeKanji(text) {
    const len = [...text].length;
    const vw = Math.min(20, 86 / Math.max(len, 1));
    const max = len <= 2 ? 6.4 : len <= 3 ? 5.4 : len <= 4 ? 4.4 : 3.4;
    $("#kanji").style.fontSize = `clamp(2.2rem, ${vw.toFixed(1)}vw, ${max}rem)`;
  }

  function renderHeadword(w) {
    const showKana = w.kana && w.kana !== w.kanji;
    $("#kana").textContent = showKana ? w.kana : "";
    $("#kanji").textContent = w.kanji;
    sizeKanji(w.kanji);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderWord(w) {
    current = w;
    renderHeadword(w);
    $("#en").textContent = w.en;
    $("#hi").textContent = w.hi || "";
    $("#meaning .sep").style.display = w.hi ? "" : "none";
    $("#meaning").classList.toggle("stack", (w.en + (w.hi || "")).length > 24);
    const ul = $("#starters");
    ul.innerHTML = "";
    w.starters.slice(0, 3).forEach((s) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.lang = "ja";
      b.setAttribute("aria-label", "Listen: " + s);
      b.innerHTML = '<span class="phrase">' + escapeHtml(s).replace(/〜/g, '<span class="blank">〜</span>') + "</span>";
      b.addEventListener("click", () => speak(s.replace(/〜/g, "、"), b));
      li.appendChild(b);
      ul.appendChild(li);
    });
    $("#startersCard").hidden = w.starters.length === 0;
    if (timer.running) $("#timerMsg").textContent = `Talk about「${w.kanji}」, keep going`;
    $("#announce").textContent = `${w.kanji}${w.kana && w.kana !== w.kanji ? ", " + w.kana : ""}: ${w.en}${w.hi ? ", " + w.hi : ""}`;
    updateUrl();
  }

  function setStatus(text) { $("#status").textContent = text; }

  function updateUrl() {
    if (!current) return;
    try {
      const u = new URL(location.href);
      u.searchParams.set("level", level);
      u.searchParams.set("w", current.kanji);
      history.replaceState(null, "", u);
    } catch { /* file:// etc. */ }
  }

  // Spin
  async function spin() {
    if (spinning) return;
    if (!loaded) return toast("Loading words...");
    const target = nextWord(level);
    if (!target) return toast("No words for this level yet");
    const pool = byLevel[level];
    stopSpeaking();
    spinning = true;
    const token = ++spinToken;
    const stage = document.body;
    const wordEl = $("#word");
    stage.classList.add("is-spinning");
    $("#spin .btn-label").textContent = "Spinning...";
    $("#spin").setAttribute("aria-busy", "true");
    setStatus("Spinning...");
    if (soundOn) ensureAudio();

    if (!reduceMotion() && pool.length > 1) {
      let elapsed = 0, delay = 45, prev = null;
      wordEl.classList.remove("landed");
      while (elapsed < SPIN_MS - 120) {
        let w;
        do { w = pool[Math.floor(Math.random() * pool.length)]; } while ((w === prev || w === target) && pool.length > 2);
        prev = w;
        wordEl.classList.remove("ticking");
        void wordEl.offsetWidth; // restart tick animation
        wordEl.classList.add("ticking");
        renderHeadword(w);
        clickSound(delay);
        await sleep(delay);
        if (token !== spinToken) return;
        elapsed += delay;
        delay = Math.min(delay * 1.14, 230);
      }
    }

    wordEl.classList.remove("ticking");
    renderWord(target);
    void wordEl.offsetWidth;
    wordEl.classList.add("landed");
    ding();
    document.body.classList.remove("is-spinning");
    $("#spin .btn-label").textContent = "Spin again";
    $("#spin").removeAttribute("aria-busy");
    setStatus(`Your word (${level})`);
    spinning = false;
    track("spin", { word: target.kanji });
  }

  function cancelSpin() {
    spinToken++;
    spinning = false;
    document.body.classList.remove("is-spinning");
    $("#word").classList.remove("ticking");
    $("#spin").removeAttribute("aria-busy");
  }

  // Level
  function setLevel(lv, { pick = true, persist = true } = {}) {
    if (!LEVELS.includes(lv)) lv = "N5";
    level = lv;
    if (persist) store.set("level", lv);
    $$(".levels button").forEach((b) => {
      const on = b.dataset.level === lv;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    $("#levelHint").textContent = LEVEL_HINTS[lv];
    if (pick) {
      if (spinning) cancelSpin();
      stopSpeaking();
      const w = nextWord(lv);
      if (w) {
        renderWord(w);
        $("#word").classList.remove("landed");
        void $("#word").offsetWidth;
        $("#word").classList.add("landed");
      }
      setStatus(`${lv}: tap Spin for a new word`);
      $("#spin .btn-label").textContent = "Spin";
    }
  }

  // Arrow-key navigation for radio-style pill groups
  function radioKeys(group, onPick) {
    group.addEventListener("keydown", (e) => {
      const btns = Array.from(group.querySelectorAll("button"));
      const i = btns.indexOf(document.activeElement);
      if (i < 0) return;
      let n = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % btns.length;
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + btns.length) % btns.length;
      if (n === null) return;
      e.preventDefault();
      btns[n].focus();
      onPick(btns[n]);
    });
  }

  // Speech
  const synth = "speechSynthesis" in window ? window.speechSynthesis : null;
  let jaVoice = null;
  let speakingBtn = null;
  let speakTimer = 0;
  let currentUtter = null;

  function pickVoice() {
    if (!synth) return;
    const voices = synth.getVoices();
    const ja = voices.filter((v) => /^ja(-|_|$)/i.test(v.lang));
    jaVoice =
      ja.find((v) => /Kyoko|O-ren|Otoya|Google|Nanami|Haruka/i.test(v.name)) ||
      ja.find((v) => v.localService) || ja[0] || null;
  }
  if (synth) {
    pickVoice();
    if (typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", pickVoice);
    else synth.onvoiceschanged = pickVoice;
  }

  function markPlaying(btn, on) {
    if (btn) btn.classList.toggle("playing", on);
  }

  function stopSpeaking() {
    clearTimeout(speakTimer);
    currentUtter = null;
    if (synth) synth.cancel();
    markPlaying(speakingBtn, false);
    speakingBtn = null;
  }

  function speak(text, btn) {
    if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
      return toast("Audio isn't supported in this browser");
    }
    if (!jaVoice) pickVoice();
    const busy = synth.speaking || synth.pending;
    stopSpeaking();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    if (jaVoice) u.voice = jaVoice;
    u.rate = 0.85;
    speakingBtn = btn || null;
    markPlaying(speakingBtn, true);
    currentUtter = u;
    const done = () => { if (currentUtter === u) { markPlaying(btn, false); speakingBtn = null; currentUtter = null; } };
    u.onend = done;
    u.onerror = done;
    // Speak inside the tap (iOS needs that). Only when something was playing
    // do we wait a tick, because Chrome can drop speak() right after cancel().
    if (busy) speakTimer = setTimeout(() => { if (currentUtter === u) synth.speak(u); }, 40);
    else synth.speak(u);
    if (!jaVoice && synth.getVoices().length) {
      toast("No Japanese voice on this device. You can add one in your language settings.");
    }
    track("listen", { word: current ? current.kanji : "" });
  }

  // Timer
  const timer = { total: 60, remaining: 60, endAt: 0, id: 0, running: false };
  let audioCtx = null;
  let wakeLock = null;

  function fmt(sec) {
    const s = Math.max(0, Math.ceil(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  function renderTimer() {
    $("#digits").textContent = fmt(timer.remaining);
    $("#barFill").style.transform = `scaleX(${Math.max(0, timer.remaining / timer.total)})`;
    $("#timerCard").classList.toggle("low", timer.running && timer.remaining <= 10);
    $("#timerStart").textContent = timer.running ? "Pause" : timer.remaining < timer.total && timer.remaining > 0 ? "Resume" : "Start";
    $("#timerToggle").textContent = timer.running ? "Pause timer" : timer.remaining < timer.total && timer.remaining > 0 ? "Resume timer" : `Start ${label(timer.total)} timer`;
  }

  function label(sec) { return sec < 60 ? `${sec}s` : `${sec / 60} min`; }

  function ensureAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state !== "running") audioCtx.resume();
      // iOS unlock: play a silent blip inside the user gesture
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      g.gain.value = 0;
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.01);
    } catch { /* no audio */ }
  }

  function beep() {
    if (!audioCtx) return;
    try {
      if (audioCtx.state !== "running") audioCtx.resume();
      const t0 = audioCtx.currentTime + 0.05;
      [0, 0.28, 0.56].forEach((off, i) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = i === 2 ? 1175 : 880;
        g.gain.setValueAtTime(0.0001, t0 + off);
        g.gain.exponentialRampToValueAtTime(0.35, t0 + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + off + (i === 2 ? 0.5 : 0.2));
        o.connect(g).connect(audioCtx.destination);
        o.start(t0 + off);
        o.stop(t0 + off + 0.55);
      });
    } catch { /* ignore */ }
  }

  // Spin sounds: a soft click per word flip, a small chime when it lands
  let soundOn = store.get("sound", true);

  function tone(type, freq, start, len, vol) {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, start + len);
    o.connect(g).connect(audioCtx.destination);
    o.start(start);
    o.stop(start + len + 0.02);
  }

  function clickSound(delay) {
    if (!soundOn || !audioCtx || audioCtx.state !== "running") return;
    try {
      // clicks get a little lower and softer as the wheel slows down
      const slow = Math.min(1, (delay - 45) / 185);
      tone("triangle", 1900 - slow * 500 + Math.random() * 120, audioCtx.currentTime, 0.035, 0.14 - slow * 0.04);
    } catch { /* ignore */ }
  }

  function ding() {
    if (!soundOn || !audioCtx) return;
    try {
      const t0 = audioCtx.currentTime + 0.02;
      tone("sine", 784, t0, 0.25, 0.18);
      tone("sine", 1175, t0 + 0.09, 0.45, 0.16);
    } catch { /* ignore */ }
  }

  function renderSoundToggle() {
    const b = $("#soundToggle");
    if (!b) return;
    b.textContent = soundOn ? "Sound: on" : "Sound: off";
    b.setAttribute("aria-pressed", String(soundOn));
  }

  let wakeWanted = false;
  async function lockScreen(on) {
    wakeWanted = on;
    try {
      if (!on) {
        const l = wakeLock; wakeLock = null;
        if (l) await l.release();
        return;
      }
      if (wakeLock && !wakeLock.released) return;
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      const l = await navigator.wakeLock.request("screen");
      if (!wakeWanted) { l.release(); return; } // paused while we waited
      if (wakeLock && wakeLock !== l) wakeLock.release();
      wakeLock = l;
    } catch { /* not allowed */ }
  }

  function tick() {
    timer.remaining = Math.max(0, (timer.endAt - Date.now()) / 1000);
    if (timer.remaining <= 0) return finishTimer();
    renderTimer();
  }

  function startTimer() {
    if (timer.running) return;
    ensureAudio();
    stopSpeaking();
    if (timer.remaining <= 0) timer.remaining = timer.total;
    const card = $("#timerCard");
    card.classList.remove("done", "flash");
    timer.endAt = Date.now() + timer.remaining * 1000;
    timer.running = true;
    clearInterval(timer.id);
    timer.id = setInterval(tick, 200);
    $("#timerMsg").textContent = current ? `Talk about「${current.kanji}」, keep going` : "Keep going";
    lockScreen(true);
    renderTimer();
    track("timer_start", { seconds: timer.total });
  }

  function pauseTimer() {
    if (!timer.running) return;
    timer.remaining = Math.max(0, (timer.endAt - Date.now()) / 1000);
    timer.running = false;
    clearInterval(timer.id);
    $("#timerMsg").textContent = "Paused.";
    lockScreen(false);
    renderTimer();
  }

  function resetTimer() {
    timer.running = false;
    clearInterval(timer.id);
    timer.remaining = timer.total;
    $("#timerCard").classList.remove("done", "flash", "low");
    $("#timerMsg").textContent = "Keep talking until it beeps. Don't worry about grammar.";
    lockScreen(false);
    renderTimer();
  }

  function finishTimer() {
    timer.running = false;
    timer.remaining = 0;
    clearInterval(timer.id);
    renderTimer();
    const card = $("#timerCard");
    card.classList.remove("low");
    card.classList.add("done");
    void card.offsetWidth;
    card.classList.add("flash");
    $("#timerMsg").textContent = "おつかれさま！ Time's up, nice work.";
    $("#timerStart").textContent = "Again";
    $("#timerToggle").textContent = "Restart timer";
    beep();
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
    lockScreen(false);
    track("timer_complete", { seconds: timer.total });
  }

  function setDuration(sec, force = false) {
    sec = [30, 60, 180, 300].includes(sec) ? sec : 60;
    if (sec === timer.total && !force) return;
    timer.total = sec;
    store.set("duration", sec);
    $$(".durations button").forEach((b) => {
      const on = Number(b.dataset.sec) === sec;
      b.setAttribute("aria-checked", String(on));
      b.tabIndex = on ? 0 : -1;
    });
    resetTimer();
  }

  function toggleTimer() { timer.running ? pauseTimer() : startTimer(); }

  // Re-sync after the tab was hidden (intervals are throttled in background)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (timer.running) { tick(); if (timer.running) lockScreen(true); }
    }
  });

  // Share
  function shareUrl() {
    const u = new URL(location.href);
    u.hash = "";
    if (current) { u.searchParams.set("level", level); u.searchParams.set("w", current.kanji); }
    return u.toString();
  }

  function caption() {
    if (!current) return "";
    const reading = current.kana && current.kana !== current.kanji ? `（${current.kana}）` : "";
    return [
      `今日のことば: ${current.kanji}${reading}`,
      `${current.en}${current.hi ? " / " + current.hi : ""}`,
      "",
      `Spun a word and talked for ${label(timer.total)}${igHandle ? " @" + igHandle : ""}`,
      "Try it at jlptspin.com",
      "",
      `#${tag} #LearnJapanese #JLPT${level} #日本語 #JapaneseInHindi`,
    ].join("\n");
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch { /* fall through */ }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    ta.remove();
    return ok;
  }

  // Email
  const EMAIL_RE = /^[^\s@]+@([^\s@.]+\.)+[^\s@.]{2,}$/;

  function setupEmail() {
    const form = $("#emailForm"), input = $("#email"), msg = $("#formMsg"), btn = $("#emailBtn");
    const done = $("#emailDone");
    const endpoint = String(CFG.emailEndpoint || "").trim();
    const say = (text, cls) => { msg.textContent = text; msg.className = "form-msg " + (cls || ""); };
    const showDownload = () => { if (done) done.hidden = false; };

    if (store.get("subscribed", false)) {
      say("You're already signed up.", "ok");
      showDownload();
    }

    input.addEventListener("input", () => input.removeAttribute("aria-invalid"));

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = input.value.trim();
      if (!EMAIL_RE.test(email)) {
        input.setAttribute("aria-invalid", "true");
        say("Please enter a valid email address.", "err");
        input.focus();
        return;
      }
      if (form.querySelector(".hp").value) return; // bot
      if (!endpoint) {
        say(`Signups open very soon! Follow ${igHandle ? "@" + igHandle : "us"} on Instagram to get it first.`, "");
        return;
      }
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = "Sending...";
      try {
        const body = new FormData();
        body.append("fields[email]", email);
        if (/mailerlite\.com/i.test(endpoint)) {
          body.append("ml-submit", "1");
          body.append("anticsrf", "true");
        } else {
          body.append("email", email);
        }
        const res = await fetch(endpoint, { method: "POST", body, headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const data = await res.json().catch(() => ({}));
        if (data && data.success === false) throw new Error("rejected");
        store.set("subscribed", true);
        form.reset();
        say("Done! You can download it below.", "ok");
        showDownload();
        track("sign_up", { method: "email" });
      } catch {
        say("That didn't work. Check your email and try again.", "err");
      } finally {
        btn.disabled = false;
        btn.textContent = old;
      }
    });
  }

  // Wire up
  function bind() {
    $("#spin").addEventListener("click", spin);
    renderSoundToggle();
    $("#soundToggle")?.addEventListener("click", () => {
      soundOn = !soundOn;
      store.set("sound", soundOn);
      renderSoundToggle();
      if (soundOn) { ensureAudio(); ding(); }
    });
    $("#listen").addEventListener("click", () => current && speak(current.kana || current.kanji, $("#listen")));

    $$(".levels button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.level !== level) setLevel(b.dataset.level);
    }));
    radioKeys($(".levels"), (b) => b.dataset.level !== level && setLevel(b.dataset.level));

    $$(".durations button").forEach((b) => b.addEventListener("click", () => setDuration(Number(b.dataset.sec))));
    radioKeys($(".durations"), (b) => setDuration(Number(b.dataset.sec)));

    $("#timerStart").addEventListener("click", toggleTimer);
    $("#timerReset").addEventListener("click", resetTimer);
    $("#timerToggle").addEventListener("click", () => {
      const wasRunning = timer.running;
      toggleTimer();
      if (!wasRunning) {
        $("#timerCard").scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "center" });
      }
    });

    $("#copyCaption").addEventListener("click", async () => {
      if (!current) return;
      toast((await copyText(caption())) ? "Caption copied" : "Couldn't copy. Try long-pressing instead.");
      track("copy_caption");
    });

    $("#shareLink").addEventListener("click", async () => {
      if (!current) return;
      const url = shareUrl();
      if (navigator.share) {
        try {
          await navigator.share({ title: "JLPT Spin", text: `Can you speak about「${current.kanji}」for ${label(timer.total)}?`, url });
          track("share", { method: "link" });
          return;
        } catch (err) {
          if (err && err.name === "AbortError") return;
        }
      }
      toast((await copyText(url)) ? "Link copied!" : url);
      track("share", { method: "link" });
    });

    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (typing) return;
      const onControl = t && (t.tagName === "BUTTON" || t.tagName === "A");
      if ((e.code === "Space" || e.key === " ") && !onControl) {
        e.preventDefault();
        if (e.repeat || $("#spin").disabled) return;
        spin();
      }
    });
  }

  async function init() {
    applyHandles();
    bind();
    setupEmail();
    setDuration(Number(store.get("duration", 60)), true);
    loadAnalytics();

    const params = new URLSearchParams(location.search);
    const urlLevel = (params.get("level") || "").toUpperCase();
    const startLevel = LEVELS.includes(urlLevel) ? urlLevel : store.get("level", "N5");
    setLevel(startLevel, { pick: false, persist: !LEVELS.includes(urlLevel) });

    try {
      await loadWords();
    } catch {
      $("#kanji").textContent = "ごめん";
      $("#en").textContent = "Couldn't load the words. Please refresh.";
      $("#meaning .sep").style.display = "none";
      $("#startersCard").hidden = true;
      $("#spin").disabled = true;
      setStatus("Offline?");
      return;
    }

    const wanted = params.get("w");
    let shared = wanted && byLevel[level].find((w) => w.kanji === wanted);
    if (wanted && !shared) {
      shared = LEVELS.map((lv) => byLevel[lv].find((w) => w.kanji === wanted)).find(Boolean);
      if (shared) setLevel(shared.level, { pick: false, persist: false });
    }
    if (shared) {
      renderWord(shared);
      setStatus(`Shared word (${level})`);
    } else {
      const w = dailyWord(level);
      if (w) renderWord(w);
      setStatus("今日のことば");
    }
  }

  init();
})();
