/* The backend behind the browser tools on priya123z.github.io.
 *
 * Four of them: review, specs and heal on the portfolio itself, and generate
 * for the ai-testcase-generator demo, which is a project page on the same
 * origin and so shares this deployment, this key and this budget.
 *
 * It exists for one reason: a visitor should be able to click "Review this
 * code" and get a real answer without going and signing up for anything. A
 * Groq key cannot go in the page, because the page is public and the key would
 * be scraped inside a week. So the key lives here as a Worker secret, and the
 * page calls this instead of calling Groq.
 *
 * That buys the live answer and creates the problem of paying for it, which is
 * most of what this file is about:
 *
 *   - the shared key has a daily ceiling, and one visitor cannot spend all of it
 *   - when the ceiling is reached the answer is a saved one, returned with a
 *     200 and labelled `cached`, because a recruiter who clicks a demo and gets
 *     a 503 learns nothing about whether I can build things
 *   - a visitor who pastes their own key skips all of the budgeting, and their
 *     key is used for that one request and never written anywhere
 *
 * Deploy notes are in ../README.md.
 */

import { groqBody, userMessage, MODEL, MAX_INPUT_CHARS } from "../../prompts.js";

import reviewSample from "../../samples/review.json";
import specsSample from "../../samples/specs.json";
import healSample from "../../samples/heal.json";
import generateSample from "../../samples/generate.json";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const SAMPLES = {
  review: reviewSample,
  specs: specsSample,
  heal: healSample,
  generate: generateSample,
};

/* Only these pages may call the Worker. Anything else gets no CORS header, so
 * the browser refuses the response. It is not authentication and is not
 * pretending to be; it stops the shared budget being spent by somebody else's
 * site.
 *
 * Two pages call this, the portfolio and the ai-testcase-generator demo, but
 * the second is a GitHub project page and so sits on the same origin as the
 * first. One entry covers both. */
const ALLOWED_ORIGINS = [
  "https://priya123z.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

/* Groq's free tier gives 30 requests a minute and 1,000 a day. These sit well
 * under both, so the demo runs out of budget before the provider does and the
 * page can say so in plain words instead of surfacing a 429. */
const SHARED_RUNS_PER_DAY = 400;
const RUNS_PER_VISITOR_PER_DAY = 12;

/* Long enough to keep yesterday's counters readable while the clock rolls over
 * in whatever timezone the visitor is in, short enough that KV cleans itself. */
const COUNTER_TTL_SECONDS = 2 * 24 * 60 * 60;

const TOOLS = {
  review: {
    parse: body => ({ code: str(body.code), filename: str(body.filename) || "snippet.py" }),
    text: payload => payload.code,
  },
  specs: {
    parse: body => ({ story: str(body.story) }),
    text: payload => payload.story,
  },
  heal: {
    parse: body => ({
      selector: str(body.selector),
      html: str(body.html),
      description: str(body.description),
    }),
    text: payload => payload.selector + payload.html,
  },
  /* Serves the ai-testcase-generator demo, which is a different page on the
   * same origin, so it needs no CORS change and shares this one budget. */
  generate: {
    parse: body => ({ story: str(body.story) }),
    text: payload => payload.story,
  },
};

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

    if (path === "/api/health") {
      return json(await health(env), 200, cors);
    }

    const tool = path.startsWith("/api/") ? path.slice(5) : "";
    if (!TOOLS[tool]) {
      return json({ error: "No such endpoint." }, 404, cors);
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST." }, 405, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Body must be JSON." }, 400, cors);
    }

    const payload = TOOLS[tool].parse(body || {});
    const text = TOOLS[tool].text(payload);
    if (!text.trim()) {
      return json({ error: "Nothing to work on." }, 400, cors);
    }

    return handle(tool, payload, request, env, ctx, cors);
  },
};

async function handle(tool, payload, request, env, ctx, cors) {
  const visitorKey = (request.headers.get("X-API-Key") || "").trim();

  /* Somebody else's key: no budgeting, no counting, and we never keep it. */
  if (visitorKey) {
    return callAndReply(tool, payload, visitorKey, "byok", cors);
  }

  if (!env.GROQ_API_KEY) {
    return saved(tool, "no_shared_key", cors);
  }

  const budget = await spend(env, request, ctx);
  if (!budget.allowed) {
    return saved(tool, budget.reason, cors);
  }

  return callAndReply(tool, payload, env.GROQ_API_KEY, "shared", cors);
}

async function callAndReply(tool, payload, key, keySource, cors) {
  let answer;
  try {
    answer = await callGroq(tool, payload, key);
  } catch (err) {
    /* A visitor's own key failing is their problem to see and fix, so that one
     * comes back as an error they can read. The shared key failing is mine, and
     * a saved answer is a better outcome for them than my outage. */
    if (keySource === "byok") {
      return json({ error: err.message }, err.status || 502, cors);
    }
    return saved(tool, err.status === 429 ? "provider_busy" : "provider_error", cors);
  }

  return json({ result: answer, meta: { source: "live", key: keySource, model: MODEL } }, 200, cors);
}

async function callGroq(tool, payload, key) {
  const clipped = clip(payload);

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(groqBody(tool, userMessage(tool, clipped))),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    throw withStatus(
      data?.error?.message || `Groq answered ${resp.status}.`,
      resp.status,
    );
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw withStatus("Groq returned no message content.", 502);
  }

  /* response_format json_object means this should always parse. Should is not
   * the same as does, and a JSON.parse throwing inside the handler would be a
   * 500 with no explanation, so it is caught and named here. */
  try {
    return JSON.parse(content);
  } catch {
    throw withStatus("The model answered with something that was not JSON.", 502);
  }
}

/* ---------------------------------------------------------------- budgeting */

/* Two mechanisms, because one of them is not enough on its own.
 *
 * The rate limiter (env.BURST) is strongly consistent and evaluated on the
 * spot, so it is what actually stops someone hammering the endpoint. It is
 * checked first and it is the limit a person hits in practice.
 *
 * The KV counters are the daily ceiling. KV reads can be up to 60 seconds
 * stale, so during a fast burst every request reads the same number and all of
 * them pass. That was measured rather than assumed: thirteen calls in a row
 * from one address all went through a 12-per-day cap, which is why the rate
 * limiter exists. At day granularity being a minute behind does not matter, so
 * KV is the right tool for the ceiling and the wrong one for the burst.
 *
 * With neither binding present the demo still answers; it just stops counting.
 * That is the right way round for a portfolio: a missing binding should not
 * take the page's tools offline. */
async function spend(env, request, ctx) {
  const visitor = await visitorId(request);

  /* Strongly consistent, so this one is real. Checked before KV because it is
   * the cheap call and the one that will actually be tripped. */
  if (env.BURST) {
    const { success } = await env.BURST.limit({ key: visitor });
    if (!success) return { allowed: false, reason: "too_fast" };
  }

  if (!env.BUDGET) return { allowed: true };

  const day = new Date().toISOString().slice(0, 10);
  const sharedKey = `day:${day}`;
  const visitorCounterKey = `ip:${day}:${visitor}`;

  const [sharedRaw, visitorRaw] = await Promise.all([
    env.BUDGET.get(sharedKey),
    env.BUDGET.get(visitorCounterKey),
  ]);

  const sharedUsed = Number(sharedRaw) || 0;
  const visitorUsed = Number(visitorRaw) || 0;

  if (visitorUsed >= RUNS_PER_VISITOR_PER_DAY) {
    return { allowed: false, reason: "visitor_daily" };
  }
  if (sharedUsed >= SHARED_RUNS_PER_DAY) {
    return { allowed: false, reason: "daily_budget" };
  }

  /* Counted before the call rather than after it, so a visitor cannot get past
   * the cap by making requests that fail. The cost is that if Groq is down, a
   * visitor spends their twelve on saved answers. Counting afterwards would
   * make the cap unenforceable, which is the worse of the two.
   *
   * The writes are not awaited on the response path. They have to happen, but
   * nobody should wait on ~50ms of KV before the model call even starts. */
  const write = Promise.all([
    env.BUDGET.put(sharedKey, String(sharedUsed + 1), { expirationTtl: COUNTER_TTL_SECONDS }),
    env.BUDGET.put(visitorCounterKey, String(visitorUsed + 1), { expirationTtl: COUNTER_TTL_SECONDS }),
  ]);
  ctx.waitUntil(write);

  return { allowed: true };
}

/* Cloudflare puts the real client address in CF-Connecting-IP. It is hashed
 * before it becomes a KV key, so what the namespace ends up holding is a set of
 * counters rather than a list of who visited and when. Sixteen hex characters
 * is far more than enough to keep a few hundred visitors a day apart. */
async function visitorId(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ------------------------------------------------------------------ replies */

function saved(tool, reason, cors) {
  return json(
    { result: SAMPLES[tool], meta: { source: "cached", reason } },
    200,
    cors,
  );
}

async function health(env) {
  const day = new Date().toISOString().slice(0, 10);
  const used = env.BUDGET ? Number(await env.BUDGET.get(`day:${day}`)) || 0 : null;

  return {
    status: "ok",
    shared_key: Boolean(env.GROQ_API_KEY),
    model: MODEL,
    runs_remaining_today: used === null ? null : Math.max(0, SHARED_RUNS_PER_DAY - used),
    runs_per_visitor_per_day: RUNS_PER_VISITOR_PER_DAY,
    burst_limited: Boolean(env.BURST),
  };
}

function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  if (ALLOWED_ORIGINS.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-API-Key";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

/* --------------------------------------------------------------- small bits */

function str(value) {
  return typeof value === "string" ? value : "";
}

function clip(payload) {
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    out[k] = typeof v === "string" ? v.slice(0, MAX_INPUT_CHARS) : v;
  }
  return out;
}

function withStatus(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}
