// JLPT Spin forum API (Cloudflare Worker + D1)

const LEVELS = ["N5", "N4", "N3", "N2", "N1", "General"];
const ALLOWED_ORIGINS = ["https://jlptspin.com", "https://www.jlptspin.com", "http://localhost:8765"];
const SESSION_DAYS = 30;
const HIDE_AFTER_REPORTS = 3;

// Kept short on purpose. Catches the obvious stuff, reports catch the rest.
const BAD_WORDS = [
  "fuck", "shit", "bitch", "cunt", "nigger", "faggot", "retard", "whore", "slut",
  "chutiya", "madarchod", "behenchod", "bhenchod", "randi", "gaand", "bhosdi", "lavda", "lauda",
];
// Whole words only, so romaji like "shite", "shitsumon" or "Scunthorpe" isn't blocked.
const BAD_RE = new RegExp("(^|[^a-z])(" + BAD_WORDS.join("|") + ")(s|es|ed|ing|ty|y)?(?![a-z])", "i");
const LINK_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|xyz|ru|cn|top|info|biz|link|site)\b)/i;

const now = () => Math.floor(Date.now() / 1000);

// helpers

function cors(req) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(req, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(req) },
  });
}

const fail = (req, status, error) => json(req, { error }, status);

function b64url(bytes) {
  let s = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function makeSession(env, uid) {
  const payload = b64url(enc.encode(JSON.stringify({ uid, exp: now() + SESSION_DAYS * 86400 })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env.SESSION_SECRET), enc.encode(payload));
  return payload + "." + b64url(sig);
}

async function readSession(env, req) {
  const h = req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(env.SESSION_SECRET), b64urlDecode(m[2]), enc.encode(m[1]));
  if (!ok) return null;
  let data;
  try { data = JSON.parse(dec.decode(b64urlDecode(m[1]))); } catch { return null; }
  if (!data.uid || data.exp < now()) return null;
  const user = await env.DB.prepare("SELECT id, name, is_admin, banned FROM users WHERE id = ?").bind(data.uid).first();
  return user || null;
}

// Google ID token check (signature, issuer, audience, expiry)
let jwksCache = { keys: null, until: 0 };

async function googleKeys() {
  if (jwksCache.keys && jwksCache.until > Date.now()) return jwksCache.keys;
  const res = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!res.ok) throw new Error("certs");
  const body = await res.json();
  const maxAge = Number((res.headers.get("Cache-Control") || "").match(/max-age=(\d+)/)?.[1] || 3600);
  jwksCache = { keys: body.keys, until: Date.now() + maxAge * 1000 };
  return body.keys;
}

async function verifyGoogle(env, idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("format");
  const header = JSON.parse(dec.decode(b64urlDecode(parts[0])));
  const claims = JSON.parse(dec.decode(b64urlDecode(parts[1])));
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk || header.alg !== "RS256") throw new Error("key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("signature");
  if (!["accounts.google.com", "https://accounts.google.com"].includes(claims.iss)) throw new Error("issuer");
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error("audience");
  if (!claims.exp || claims.exp < now()) throw new Error("expired");
  if (!claims.sub) throw new Error("sub");
  return claims;
}

function cleanText(s, max) {
  return String(s || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, max);
}

function checkContent(text, user) {
  if (BAD_RE.test(text)) return "Please keep it friendly. That word isn't allowed here.";
  if (!user.is_admin && LINK_RE.test(text)) return "Links aren't allowed in posts, to keep spam out.";
  return null;
}

async function rateLimited(env, userId) {
  const t = now();
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM threads WHERE user_id = ?1 AND created_at > ?2) AS t_hour,
       (SELECT COUNT(*) FROM replies WHERE user_id = ?1 AND created_at > ?2) AS r_hour,
       (SELECT MAX(created_at) FROM (SELECT created_at FROM threads WHERE user_id = ?1
          UNION ALL SELECT created_at FROM replies WHERE user_id = ?1)) AS last`
  ).bind(userId, t - 3600).first();
  if (row.last && t - row.last < 15) return "You're posting a bit fast. Wait a few seconds and try again.";
  return row;
}

async function bodyJson(req) {
  try { return await req.json(); } catch { return {}; }
}

function firstName(claims) {
  let n = cleanText(claims.given_name || (claims.name || "").split(" ")[0] || "", 30);
  // "ANURAG" or "anurag" -> "Anurag" (only for plain Latin names)
  if (/^[A-Za-z][A-Za-z'-]*$/.test(n) && (n === n.toUpperCase() || n === n.toLowerCase())) {
    n = n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
  }
  return n || "Learner";
}

// handlers

const FORUM_URL = "https://jlptspin.com/forum/";

async function login(env, credential) {
  let claims;
  try { claims = await verifyGoogle(env, credential); } catch { return { error: "Google sign-in failed. Please try again.", status: 401 }; }
  const isAdmin = env.ADMIN_EMAIL && claims.email_verified && String(claims.email).toLowerCase() === String(env.ADMIN_EMAIL).toLowerCase() ? 1 : 0;
  const name = firstName(claims);
  await env.DB.prepare(
    `INSERT INTO users (sub, name, is_admin, created_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(sub) DO UPDATE SET name = excluded.name, is_admin = excluded.is_admin`
  ).bind(claims.sub, name, isAdmin, now()).run();
  const user = await env.DB.prepare("SELECT id, name, is_admin, banned FROM users WHERE sub = ?").bind(claims.sub).first();
  if (user.banned) return { error: "This account can't post on the forum.", status: 403 };
  return { token: await makeSession(env, user.id), user: { id: user.id, name: user.name, isAdmin: !!user.is_admin } };
}

async function authGoogle(req, env) {
  const { credential } = await bodyJson(req);
  const r = await login(env, credential);
  if (r.error) return fail(req, r.status, r.error);
  return json(req, r);
}

// Google redirect mode: Google POSTs a form here, we send the browser back to the forum.
async function authGoogleRedirect(req, env) {
  let credential = "";
  try { credential = (await req.formData()).get("credential") || ""; } catch { /* bad form */ }
  const r = await login(env, credential);
  const back = r.error
    ? FORUM_URL + "#auth_error=" + encodeURIComponent(r.error)
    : FORUM_URL + "#auth=" + encodeURIComponent(r.token);
  return new Response(null, { status: 303, headers: { Location: back, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

async function listThreads(req, env, url, viewer) {
  const level = url.searchParams.get("level");
  const before = Number(url.searchParams.get("before")) || 0;
  const beforeId = Number(url.searchParams.get("beforeId")) || 0;
  const showHidden = viewer && viewer.is_admin ? 1 : 0;
  const where = ["(t.hidden = 0 OR ?1 = 1)"];
  const binds = [showHidden];
  if (LEVELS.includes(level)) { where.push(`t.level = ?${binds.length + 1}`); binds.push(level); }
  if (before) {
    const a = binds.length + 1;
    where.push(`(t.last_at < ?${a} OR (t.last_at = ?${a} AND t.id < ?${a + 1}))`);
    binds.push(before, beforeId || 2147483647);
  }
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.level, t.title, substr(t.body, 1, 180) AS excerpt, t.created_at, t.last_at, t.hidden, u.name,
       (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id AND r.hidden = 0) AS reply_count
     FROM threads t JOIN users u ON u.id = t.user_id
     WHERE ${where.join(" AND ")}
     ORDER BY t.last_at DESC, t.id DESC LIMIT 20`
  ).bind(...binds).all();
  return json(req, { threads: results, more: results.length === 20 });
}

async function getThread(req, env, id, viewer) {
  const showHidden = viewer && viewer.is_admin ? 1 : 0;
  const thread = await env.DB.prepare(
    `SELECT t.id, t.level, t.title, t.body, t.created_at, t.hidden, t.user_id, u.name,
       (SELECT COUNT(*) FROM replies r WHERE r.thread_id = t.id AND r.hidden = 0) AS reply_count
     FROM threads t JOIN users u ON u.id = t.user_id WHERE t.id = ?1 AND (t.hidden = 0 OR ?2 = 1)`
  ).bind(id, showHidden).first();
  if (!thread) return fail(req, 404, "This topic doesn't exist or was removed.");
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.body, r.created_at, r.hidden, r.user_id, u.name
     FROM replies r JOIN users u ON u.id = r.user_id
     WHERE r.thread_id = ?1 AND (r.hidden = 0 OR ?2 = 1) ORDER BY r.created_at ASC LIMIT 500`
  ).bind(id, showHidden).all();
  return json(req, { thread, replies: results });
}

async function createThread(req, env, user) {
  const b = await bodyJson(req);
  const level = LEVELS.includes(b.level) ? b.level : null;
  const title = cleanText(b.title, 120);
  const body = cleanText(b.body, 3000);
  if (!level) return fail(req, 400, "Pick a level.");
  if (title.length < 5) return fail(req, 400, "The title is too short.");
  if (body.length < 2) return fail(req, 400, "Write something first.");
  const bad = checkContent(title + "\n" + body, user);
  if (bad) return fail(req, 400, bad);
  const rl = await rateLimited(env, user.id);
  if (typeof rl === "string") return fail(req, 429, rl);
  if (!user.is_admin && rl.t_hour >= 3) return fail(req, 429, "You can start up to 3 topics an hour.");
  const t = now();
  const r = await env.DB.prepare(
    "INSERT INTO threads (user_id, level, title, body, created_at, last_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)"
  ).bind(user.id, level, title, body, t).run();
  return json(req, { id: r.meta.last_row_id }, 201);
}

async function createReply(req, env, user, threadId) {
  const b = await bodyJson(req);
  const body = cleanText(b.body, 2000);
  if (body.length < 1) return fail(req, 400, "Write something first.");
  const thread = await env.DB.prepare("SELECT id FROM threads WHERE id = ? AND hidden = 0").bind(threadId).first();
  if (!thread) return fail(req, 404, "This topic doesn't exist or was removed.");
  const bad = checkContent(body, user);
  if (bad) return fail(req, 400, bad);
  const rl = await rateLimited(env, user.id);
  if (typeof rl === "string") return fail(req, 429, rl);
  if (!user.is_admin && rl.r_hour >= 20) return fail(req, 429, "You've replied a lot this hour. Take a break and come back later.");
  const t = now();
  const r = await env.DB.prepare("INSERT INTO replies (thread_id, user_id, body, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(threadId, user.id, body, t).run();
  await env.DB.prepare("UPDATE threads SET reply_count = reply_count + 1, last_at = ?2 WHERE id = ?1").bind(threadId, t).run();
  return json(req, { id: r.meta.last_row_id }, 201);
}

async function report(req, env, user) {
  const b = await bodyJson(req);
  const kind = b.kind === "reply" ? "reply" : b.kind === "thread" ? "thread" : null;
  const id = Number(b.id);
  if (!kind || !id) return fail(req, 400, "Bad report.");
  const table = kind === "reply" ? "replies" : "threads";
  const ins = await env.DB.prepare("INSERT OR IGNORE INTO reports (kind, target_id, user_id, created_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(kind, id, user.id, now()).run();
  if (ins.meta.changes) {
    await env.DB.prepare(
      `UPDATE ${table} SET report_count = report_count + 1,
         hidden = CASE WHEN report_count + 1 >= ?2 THEN 1 ELSE hidden END WHERE id = ?1`
    ).bind(id, HIDE_AFTER_REPORTS).run();
  }
  return json(req, { ok: true });
}

async function adminHide(req, env) {
  const b = await bodyJson(req);
  const table = b.kind === "reply" ? "replies" : b.kind === "thread" ? "threads" : null;
  if (!table || !Number(b.id)) return fail(req, 400, "Bad request.");
  await env.DB.prepare(`UPDATE ${table} SET hidden = ?2 WHERE id = ?1`).bind(Number(b.id), b.hidden ? 1 : 0).run();
  if (table === "replies") {
    await env.DB.prepare(
      "UPDATE threads SET reply_count = (SELECT COUNT(*) FROM replies WHERE thread_id = threads.id AND hidden = 0) WHERE id = (SELECT thread_id FROM replies WHERE id = ?1)"
    ).bind(Number(b.id)).run();
  }
  return json(req, { ok: true });
}

async function adminBan(req, env, admin) {
  const b = await bodyJson(req);
  const uid = Number(b.userId);
  if (!uid || uid === admin.id) return fail(req, 400, "Bad request.");
  const ban = b.banned === false ? 0 : 1;
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET banned = ?2 WHERE id = ?1 AND is_admin = 0").bind(uid, ban),
    env.DB.prepare("UPDATE threads SET hidden = ?2 WHERE user_id = ?1").bind(uid, ban),
    env.DB.prepare("UPDATE replies SET hidden = ?2 WHERE user_id = ?1").bind(uid, ban),
  ]);
  return json(req, { ok: true });
}

// router

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/" || path === "/health") return json(req, { ok: true });
      if (path === "/auth/google" && req.method === "POST") return await authGoogle(req, env);
      if (path === "/auth/google/redirect" && req.method === "POST") return await authGoogleRedirect(req, env);

      const viewer = await readSession(env, req);

      if (path === "/me" && req.method === "GET") {
        if (!viewer) return fail(req, 401, "Not signed in.");
        return json(req, { user: { id: viewer.id, name: viewer.name, isAdmin: !!viewer.is_admin, banned: !!viewer.banned } });
      }
      if (path === "/threads" && req.method === "GET") return await listThreads(req, env, url, viewer);
      const tm = path.match(/^\/threads\/(\d+)$/);
      if (tm && req.method === "GET") return await getThread(req, env, Number(tm[1]), viewer);

      // everything below needs a signed-in, non-banned user
      if (!viewer) return fail(req, 401, "Please sign in first.");
      if (viewer.banned) return fail(req, 403, "This account can't post on the forum.");

      if (path === "/threads" && req.method === "POST") return await createThread(req, env, viewer);
      const rm = path.match(/^\/threads\/(\d+)\/replies$/);
      if (rm && req.method === "POST") return await createReply(req, env, viewer, Number(rm[1]));
      if (path === "/report" && req.method === "POST") return await report(req, env, viewer);

      if (path.startsWith("/admin/")) {
        if (!viewer.is_admin) return fail(req, 403, "Not allowed.");
        if (path === "/admin/hide" && req.method === "POST") return await adminHide(req, env);
        if (path === "/admin/ban" && req.method === "POST") return await adminBan(req, env, viewer);
      }
      return fail(req, 404, "Not found.");
    } catch (err) {
      console.error(err);
      return fail(req, 500, "Something went wrong. Please try again.");
    }
  },
};
