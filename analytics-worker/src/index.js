/* ============================================================================
 * Modulus first-party analytics ingest (Cloudflare Worker).
 * collect.modulustech.ai
 *
 * Trust rule: every input from an anonymous browser is hostile.
 *  - Honor Sec-GPC / DNT FIRST, before reading any IP/UA (Antigravity #3/#4).
 *  - Strict allowlist payload validation; reject unknown keys; cap sizes.
 *  - Bot filter (UA list / empty / headless), flag not drop, for honest counts.
 *  - Hash the visitor at the edge: HMAC-SHA256(daily_salt, domain|ip|ua); the
 *    raw IP/UA are used transiently and NEVER logged or sent onward.
 *  - Send only the anonymized row to Supabase via the locked record_event RPC,
 *    authenticated with the service key (a Worker secret, never in the browser).
 *  - Never log the raw error/headers from the Supabase call (Antigravity rev2 #4).
 *
 * Salt lives in Cloudflare KV, rotated by the scheduled() cron at 23:00 UTC with
 * a 1-hour propagation head start and a 2-day rolling window so old hashes are
 * unrecoverable but in-flight/late events still resolve (Antigravity rev2 #1).
 *
 * Rate limiting is a Cloudflare Rate Limiting RULE on this route, NOT a KV
 * counter (KV caps at ~1 write/sec/key) (Antigravity rev2 #3).
 * ========================================================================== */

const ALLOWED_DOMAINS = new Set(["modulustech.ai", "www.modulustech.ai"]);
const ALLOWED_ORIGINS = new Set(["https://modulustech.ai", "https://www.modulustech.ai"]);
const MAX_BODY = 4096;
const BOT_RE = /bot|crawl|spider|slurp|headless|phantom|puppeteer|playwright|curl|wget|python-requests|axios|gptbot|claudebot|perplexitybot|ccbot|bytespider/i;
const SCREEN_RE = /^\d{1,5}x\d{1,5}$/;
const CONTROL_RE = /[\x00-\x1f\x7f]/g;

function corsFor(origin) {
  const o = ALLOWED_ORIGINS.has(origin) ? origin : "https://modulustech.ai";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}
function noContent(origin) {
  return new Response(null, { status: 204, headers: corsFor(origin) });
}

// Keep only the host of a referrer; drop full URLs/paths/query.
function referrerDomain(ref) {
  if (!ref || typeof ref !== "string") return null;
  try {
    const h = new URL(ref).hostname.toLowerCase();
    return h ? h.slice(0, 255) : null;
  } catch (_e) {
    return null;
  }
}
function str(v, max) {
  if (typeof v !== "string") return null;
  const s = v.replace(CONTROL_RE, "").trim();
  return s ? s.slice(0, max) : null;
}

async function hmacVisitor(saltB64, domain, ip, ua) {
  const enc = new TextEncoder();
  const raw = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${domain}|${ip}|${ua}`));
  const bytes = new Uint8Array(sig);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

function utcDayKey(d) {
  return "salt:" + d.toISOString().slice(0, 10);
}
function freshSaltB64() {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  let bin = "";
  for (let i = 0; i < salt.length; i++) bin += String.fromCharCode(salt[i]);
  return btoa(bin);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") return noContent(origin);
    if (request.method !== "POST") return noContent(origin);

    // Size guard before reading the body.
    const clen = Number(request.headers.get("Content-Length") || "0");
    if (clen > MAX_BODY) return noContent(origin);

    // (1) Honor privacy signals FIRST: never read IP/UA, never hash, never store.
    if (request.headers.get("Sec-GPC") === "1" || request.headers.get("DNT") === "1") {
      return noContent(origin);
    }

    // (1b) Per-IP rate limit (AFTER the privacy check, so GPC/DNT visitors never
    // have their IP read). Caps the flood / denial-of-wallet path into the
    // service-key Supabase write. Over-limit beacons are dropped silently
    // (204, best-effort). Fails OPEN if the limiter is unavailable.
    try {
      const rlIp = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
      const { success } = await env.RATE_LIMITER.limit({ key: rlIp });
      if (!success) return noContent(origin);
    } catch (_e) { /* limiter unavailable -> keep ingesting */ }

    // (2) Parse + hard-cap the body.
    let body;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY) return noContent(origin);
      body = JSON.parse(text);
    } catch (_e) {
      return noContent(origin);
    }
    if (!body || typeof body !== "object") return noContent(origin);

    // (3) Strict allowlist validation. Reject unknown keys; never spread input.
    const ALLOWED_KEYS = new Set(["domain", "path", "referrer", "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "screen"]);
    for (const k of Object.keys(body)) {
      if (!ALLOWED_KEYS.has(k)) return noContent(origin); // injected key -> drop
    }
    const domain = str(body.domain, 255);
    if (!domain || !ALLOWED_DOMAINS.has(domain)) return noContent(origin); // spoofed/foreign domain

    // (4) Origin/Referer allowlist as a SPAM filter (NOT auth: sendBeacon is a
    // no-preflight simple request, so this can't stop scripted curl POSTs; real
    // protection is the rate-limit rule + the domain allowlist + the hashing).
    if (origin && !ALLOWED_ORIGINS.has(origin)) return noContent(origin);

    const path = str(body.path, 2048);
    const refDomain = referrerDomain(body.referrer);
    const screen = str(body.screen, 16);
    const screenBucket = screen && SCREEN_RE.test(screen) ? screen : null;
    const utm_source = str(body.utm_source, 255);
    const utm_medium = str(body.utm_medium, 255);
    const utm_campaign = str(body.utm_campaign, 255);
    const utm_term = str(body.utm_term, 255);
    const utm_content = str(body.utm_content, 255);

    // (5) Read IP/UA transiently for bot detection + hashing only.
    const ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";
    const ua = (request.headers.get("User-Agent") || "").slice(0, 512);
    let isBot = false;
    let botReason = null;
    if (!ua) { isBot = true; botReason = "empty_ua"; }
    else if (BOT_RE.test(ua)) { isBot = true; botReason = "ua_match"; }

    // (6) Hash the visitor with TODAY's daily salt. If today's salt is missing
    // (fresh deploy before the first 23:00 rotation, or a skipped cron), mint it on
    // demand and persist it. We deliberately do NOT fall back to yesterday's salt:
    // hashing today's visitors under the prior day's key would make them linkable
    // across two UTC days, a privacy regression (Antigravity audit #4). A day-specific
    // salt keeps daily rotation intact and still never drops an event; the only cost
    // is a rare same-day hash split if two PoPs mint before KV converges (the cron's
    // 1-hour head start makes that path essentially cold-start only). Never empty.
    const now = new Date();
    let saltB64 = await env.SALT_KV.get(utcDayKey(now));
    if (!saltB64) {
      saltB64 = freshSaltB64();
      try { await env.SALT_KV.put(utcDayKey(now), saltB64, { expirationTtl: 3 * 24 * 3600 }); } catch (_e) { /* best effort */ }
    }
    let visitorId;
    try {
      visitorId = await hmacVisitor(saltB64, domain, ip, ua);
    } catch (_e) {
      return noContent(origin);
    }
    // raw ip/ua go out of scope here; never logged, never sent onward.

    // (7) Insert via the locked record_event RPC using the service key (a Worker
    // secret). Never log the raw error or request config (Antigravity rev2 #4).
    ctx.waitUntil((async () => {
      try {
        const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/record_event`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": env.SUPABASE_SERVICE_KEY,
            "Authorization": `Bearer ${env.SUPABASE_SERVICE_KEY}`,
          },
          body: JSON.stringify({
            p_domain: domain, p_path: path, p_referrer_domain: refDomain,
            p_utm_source: utm_source, p_utm_medium: utm_medium, p_utm_campaign: utm_campaign,
            p_utm_term: utm_term, p_utm_content: utm_content,
            p_screen_bucket: screenBucket, p_visitor_id: visitorId,
            p_is_bot: isBot, p_bot_reason: botReason,
          }),
        });
        if (!res.ok) console.log(`record_event non-2xx: ${res.status}`); // status only, never headers/body
      } catch (_e) {
        console.log("record_event request failed"); // generic; never the error object
      }
    })());

    return noContent(origin);
  },

  // Daily salt rotation. Runs 23:00 UTC: pre-generate TOMORROW's salt (head start
  // for global KV propagation) and prune anything older than the 2-day window.
  async scheduled(event, env, ctx) {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 3600 * 1000);

    const tkey = utcDayKey(tomorrow);
    if (!(await env.SALT_KV.get(tkey))) {
      await env.SALT_KV.put(tkey, freshSaltB64(), { expirationTtl: 3 * 24 * 3600 });
    }
    const todayKey = utcDayKey(now);
    if (!(await env.SALT_KV.get(todayKey))) {
      await env.SALT_KV.put(todayKey, freshSaltB64(), { expirationTtl: 3 * 24 * 3600 });
    }
    // Explicit delete beyond the 2-day window (belt-and-suspenders with the TTL)
    // so old salts can never recompute old hashes.
    await env.SALT_KV.delete(utcDayKey(twoDaysAgo));
  },
};
