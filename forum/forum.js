(() => {
  "use strict";

  const CFG = window.SPIN_CONFIG || {};
  const API = String(CFG.forumApi || "").replace(/\/+$/, "");
  const CLIENT_ID = String(CFG.googleClientId || "").trim();
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const store = {
    get(k) { try { return localStorage.getItem("ss:" + k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem("ss:" + k) : localStorage.setItem("ss:" + k, v); } catch { /* ignore */ } },
  };

  let token = store.get("forumToken");
  let me = null;
  let filter = "";
  let cursor = 0;
  let cursorId = 0;
  let currentTopic = null;

  // small helpers
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }

  function track(name, params) {
    try { if (typeof window.gtag === "function") window.gtag("event", name, params || {}); } catch { /* ignore */ }
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }

  function ago(ts) {
    const s = Math.max(1, Math.floor(Date.now() / 1000) - ts);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
    return new Date(ts * 1000).toLocaleDateString();
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch(API + path, { method: opts.method || "GET", headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) { setUser(null, null); }
    if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
  }

  // sign in
  function setUser(user, newToken) {
    if (newToken !== undefined) { token = newToken; store.set("forumToken", newToken); }
    me = user;
    $("#me").hidden = !me;
    $("#signOut").hidden = !me;
    $("#gBtn").hidden = !!me;
    if (me) $("#me").textContent = `Hi, ${me.name}` + (me.isAdmin ? " (admin)" : "");
    $("#replyForm").hidden = !me;
    $("#replyHint").hidden = !!me;
  }

  function initGoogle(tries = 0) {
    if (!CLIENT_ID) {
      $("#gBtn").append(el("span", { class: "f-note", text: "Sign-in is being set up" }));
      return;
    }
    if (!(window.google && google.accounts && google.accounts.id)) {
      if (tries < 50) setTimeout(() => initGoogle(tries + 1), 150);
      return;
    }
    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      ux_mode: "redirect",
      login_uri: API + "/auth/google/redirect",
      auto_select: false,
    });
    google.accounts.id.renderButton($("#gBtn"), { theme: "filled_black", size: "medium", shape: "pill", text: "signin_with" });
  }

  $("#signOut").addEventListener("click", () => {
    setUser(null, null);
    try { google.accounts.id.disableAutoSelect(); } catch { /* ignore */ }
    toast("Signed out");
    route();
  });

  function needLogin() {
    if (me) return false;
    toast("Please sign in with Google first (top right).");
    $("#userBox").scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  // list view
  async function loadList(reset) {
    if (reset) { cursor = 0; cursorId = 0; $("#threadList").innerHTML = ""; }
    $("#moreBtn").hidden = true;
    try {
      const q = new URLSearchParams();
      if (filter) q.set("level", filter);
      if (cursor) { q.set("before", cursor); q.set("beforeId", cursorId); }
      const data = await api("/threads?" + q.toString());
      const list = $("#threadList");
      for (const t of data.threads) {
        list.append(el("li", { class: "card f-item" + (t.hidden ? " is-hidden" : "") },
          el("a", { href: `?t=${t.id}`, class: "f-item-link", onclick: (e) => { e.preventDefault(); go(t.id); } },
            el("span", { class: "f-tag", text: t.level }),
            el("span", { class: "f-title", text: t.title }),
            el("span", { class: "f-excerpt", text: t.excerpt.length >= 180 ? t.excerpt + "..." : t.excerpt }),
            el("span", { class: "f-meta", text: `${t.name} · ${ago(t.created_at)} · ${t.reply_count} ${t.reply_count === 1 ? "reply" : "replies"}${t.hidden ? " · hidden" : ""}` }))));
        cursor = t.last_at;
        cursorId = t.id;
      }
      $("#listEmpty").hidden = list.children.length > 0;
      $("#moreBtn").hidden = !data.more;
    } catch (e) {
      $("#listEmpty").hidden = false;
      $("#listEmpty").textContent = "Couldn't load the forum right now. Please try again later.";
    }
  }

  $$(".f-filter button").forEach((b) => b.addEventListener("click", () => {
    filter = b.dataset.f;
    $$(".f-filter button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    loadList(true);
  }));
  $("#moreBtn").addEventListener("click", () => loadList(false));

  // new topic
  let newLevel = "General";
  $$("#nLevel button").forEach((b) => b.addEventListener("click", () => {
    newLevel = b.dataset.level;
    $$("#nLevel button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
  }));
  $("#newBtn").addEventListener("click", () => {
    if (needLogin()) return;
    $("#newForm").hidden = false;
    $("#nTitle").focus();
  });
  $("#nCancel").addEventListener("click", () => { $("#newForm").hidden = true; });
  $("#newForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (needLogin()) return;
    const msg = $("#nMsg"), btn = $("#nSubmit");
    btn.disabled = true; msg.textContent = ""; msg.className = "form-msg";
    try {
      const data = await api("/threads", { method: "POST", body: { level: newLevel, title: $("#nTitle").value, body: $("#nBody").value } });
      $("#newForm").reset();
      $("#newForm").hidden = true;
      track("forum_topic", { level: newLevel });
      go(data.id);
    } catch (err) {
      msg.textContent = err.message; msg.className = "form-msg err";
    } finally { btn.disabled = false; }
  });

  // topic view
  function postBlock(kind, item, isTopic) {
    const actions = el("div", { class: "f-acts" });
    if (me && me.id !== item.user_id) {
      actions.append(el("button", { type: "button", class: "f-link", text: "Report", onclick: () => doReport(kind, item.id) }));
    }
    if (me && me.isAdmin) {
      actions.append(el("button", { type: "button", class: "f-link", text: item.hidden ? "Unhide" : "Hide", onclick: () => adminHide(kind, item.id, !item.hidden) }));
      if (me.id !== item.user_id) actions.append(el("button", { type: "button", class: "f-link danger", text: "Ban user", onclick: () => adminBan(item.user_id, item.name) }));
    }
    return el(isTopic ? "div" : "li", { class: (isTopic ? "" : "card f-reply") + (item.hidden ? " is-hidden" : "") },
      isTopic ? el("span", { class: "f-tag", text: item.level }) : null,
      isTopic ? el("h1", { class: "f-ttitle", text: item.title }) : null,
      el("p", { class: "f-meta", text: `${item.name} · ${ago(item.created_at)}${item.hidden ? " · hidden" : ""}` }),
      el("div", { class: "f-body", text: item.body }),
      actions);
  }

  async function loadTopic(id) {
    try {
      const data = await api(`/threads/${id}`);
      currentTopic = data.thread;
      document.title = `${data.thread.title} | JLPT Spin forum`;
      const topic = $("#topic");
      topic.innerHTML = "";
      topic.append(el("a", { href: "./", class: "f-back", text: "All topics", onclick: (e) => { e.preventDefault(); go(null); } }));
      topic.append(postBlock("thread", data.thread, true));
      const rl = $("#replies");
      rl.innerHTML = "";
      data.replies.forEach((r) => rl.append(postBlock("reply", r, false)));
    } catch (e) {
      $("#topic").innerHTML = "";
      $("#topic").append(el("p", { text: e.message }), el("a", { href: "./", class: "f-back", text: "Back to all topics" }));
      $("#replies").innerHTML = "";
      $("#replyForm").hidden = true;
    }
  }

  $("#replyForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (needLogin() || !currentTopic) return;
    const msg = $("#rMsg"), btn = $("#rSubmit");
    btn.disabled = true; msg.textContent = ""; msg.className = "form-msg";
    try {
      await api(`/threads/${currentTopic.id}/replies`, { method: "POST", body: { body: $("#rBody").value } });
      $("#rBody").value = "";
      track("forum_reply");
      await loadTopic(currentTopic.id);
    } catch (err) {
      msg.textContent = err.message; msg.className = "form-msg err";
    } finally { btn.disabled = false; }
  });

  async function doReport(kind, id) {
    if (needLogin()) return;
    if (!confirm("Report this post to the moderator?")) return;
    try { await api("/report", { method: "POST", body: { kind, id } }); toast("Thanks, it's been reported."); }
    catch (e) { toast(e.message); }
  }

  async function adminHide(kind, id, hidden) {
    try { await api("/admin/hide", { method: "POST", body: { kind, id, hidden } }); toast(hidden ? "Hidden" : "Visible again"); route(); }
    catch (e) { toast(e.message); }
  }

  async function adminBan(userId, name) {
    if (!confirm(`Ban ${name}? All their posts will be hidden.`)) return;
    try { await api("/admin/ban", { method: "POST", body: { userId } }); toast(`${name} banned`); route(); }
    catch (e) { toast(e.message); }
  }

  // routing (?t=123 opens a topic)
  function go(id) {
    const u = new URL(location.href);
    if (id) u.searchParams.set("t", id); else u.searchParams.delete("t");
    history.pushState(null, "", u);
    route();
    window.scrollTo(0, 0);
  }

  function route() {
    rememberPlace();
    const id = Number(new URLSearchParams(location.search).get("t")) || 0;
    $("#listView").hidden = !!id;
    $("#topicView").hidden = !id;
    if (id) {
      $("#replyForm").hidden = !me;
      $("#replyHint").hidden = !!me;
      loadTopic(id);
    } else {
      currentTopic = null;
      document.title = "Forum | JLPT Spin";
      loadList(true);
    }
  }
  window.addEventListener("popstate", route);

  // Coming back from Google: #auth=<token> or #auth_error=<message>
  function readAuthHash() {
    const h = new URLSearchParams(location.hash.slice(1));
    const t = h.get("auth"), err = h.get("auth_error");
    if (!t && !err) return null;
    const back = (() => { try { return sessionStorage.getItem("ss:forumReturn"); } catch { return null; } })();
    // Signed in from the main page (to save a streak): store the session and go back there.
    if (back && back.startsWith(location.origin + "/") && !back.startsWith(location.origin + "/forum/")) {
      try { sessionStorage.removeItem("ss:forumReturn"); } catch { /* ignore */ }
      if (t) store.set("forumToken", t);
      const dest = new URL(back);
      if (err) dest.searchParams.set("signin", "failed");
      location.replace(dest.href);
      return "leaving";
    }
    const u = new URL(back && back.startsWith(location.origin + "/forum/") ? back : location.href);
    u.hash = "";
    history.replaceState(null, "", u);
    if (err) { toast(err); return null; }
    token = t;
    store.set("forumToken", t);
    return t;
  }

  function rememberPlace() {
    try { sessionStorage.setItem("ss:forumReturn", location.href.split("#")[0]); } catch { /* ignore */ }
  }

  // start
  async function init() {
    if (!API) { $("#listEmpty").hidden = false; $("#listEmpty").textContent = "The forum isn't set up yet."; return; }
    const fresh = readAuthHash();
    if (fresh === "leaving") return;
    if (token) {
      try {
        const d = await api("/me");
        setUser(d.user);
        if (fresh) { toast(`Signed in as ${d.user.name}`); track("login", { method: "Google" }); }
      } catch { setUser(null, null); }
    } else {
      setUser(null);
    }
    initGoogle();
    route();
  }
  init();
})();
