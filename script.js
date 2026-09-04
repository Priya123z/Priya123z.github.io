/* Nav, and the three tools in the "Try the tools" section.
 *
 * There is deliberately no scroll-reveal here. An earlier version started every
 * section at opacity 0 and faded it in, which meant anything that stopped this
 * file from running left the page blank, and that did happen on the live site.
 * The markup now renders complete on load and JavaScript only adds behaviour.
 */

import { MODEL, groqBody, userMessage } from "./prompts.js";

/* ---------------------------------------------------------------------- nav */

const navToggle = document.getElementById("navToggle");
const navset = document.getElementById("navset");

document.getElementById("year").textContent = new Date().getFullYear();

navToggle.addEventListener("click", () => {
  const open = navset.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", open);
  navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
});

navset.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => {
    navset.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});

/* -------------------------------------------------------------------- tools *
 *
 * Three ways an answer can arrive. The page tries them in this order and always
 * says which one it used.
 *
 *   1. The visitor pasted their own Groq key. The browser calls Groq directly.
 *      Groq allows cross-origin requests, so nothing of mine is in that path,
 *      there is no shared budget to run out, and the key never leaves the
 *      machine it was typed on.
 *
 *   2. Nobody pasted anything, and the Worker in worker/ is deployed. It holds
 *      my key as a secret and answers on it, inside a daily budget. This is the
 *      normal case: a visitor clicks a button and gets a live answer without
 *      being asked to go and sign up for something first.
 *
 *   3. Neither. A saved answer from a real earlier run, labelled as saved.
 *
 * The third one is not a consolation prize, it is the guarantee: the tools on
 * this page cannot show a broken widget, whatever is down.
 */

const API_BASE = (document.body.dataset.api || "").replace(/\/+$/, "");
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const ENDPOINTS = { review: "/api/review", specs: "/api/specs", heal: "/api/heal" };

const LABELS = {
  review: "Review this code",
  specs: "Write the scenarios",
  heal: "Repair the locator",
};

const RENDERERS = { review: renderReview, specs: renderSpecs, heal: renderHeal };

/* Filled in by probe() a moment after load. Until then the page assumes the
 * backend is not there, which is the safe way round: it would rather say
 * "saved answers" and then be pleasantly wrong than promise live answers and
 * fail to deliver one. */
let backend = { ready: false, remaining: null };

/* What each tool sends. The shape matches what the Worker parses, and the same
 * object is fed to userMessage() on the direct-to-Groq path, so the two paths
 * cannot drift. */
const payloads = {
  review: () => ({ code: field("review").value, filename: "snippet.py" }),
  specs: () => ({ story: field("specs").value }),
  heal: () => ({
    selector: document.getElementById("heal-selector").value,
    html: field("heal").value,
    description: "",
  }),
};

/* The text that has to be non-empty before the button does anything. */
const inputs = {
  review: () => field("review").value,
  specs: () => field("specs").value,
  heal: () => field("heal").value,
};

function field(name) {
  return document.getElementById(`${name}-input`);
}

function panel(name) {
  return document.getElementById(`${name}-output`);
}

function visitorKey() {
  return document.getElementById("demo-key").value.trim();
}

/* ------------------------------------------------------------------ wiring */

document.querySelectorAll(".demo-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.demo;
    document.querySelectorAll(".demo-tab").forEach(t => {
      const on = t === tab;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on);
    });
    document.querySelectorAll(".demo-panel").forEach(p => {
      p.hidden = p.dataset.demo !== name;
    });
  });
});

document.querySelectorAll(".demo-run").forEach(button => {
  button.addEventListener("click", () => run(button.dataset.demo, button));
});

document.getElementById("demo-key").addEventListener("input", showMode);

/* --------------------------------------------------------------- the paths */

async function callGroqDirect(tool, key) {
  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(groqBody(tool, userMessage(tool, payloads[tool]()))),
  });

  const data = await resp.json().catch(() => ({}));

  if (resp.status === 401) {
    throw new Error(
      "Groq rejected that key. Check it at console.groq.com/keys, or clear the field and the tools will run on the shared key instead.",
    );
  }
  if (resp.status === 429) {
    throw new Error(
      "That key has hit its rate limit. The free tier allows 30 requests a minute, so give it about a minute.",
    );
  }
  if (!resp.ok) {
    throw new Error(data?.error?.message || `Groq answered ${resp.status}.`);
  }

  return { result: JSON.parse(data.choices[0].message.content), meta: { source: "live", key: "byok" } };
}

async function callBackend(tool) {
  const resp = await fetch(API_BASE + ENDPOINTS[tool], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payloads[tool]()),
  });

  if (!resp.ok) throw new Error(`the backend answered ${resp.status}`);

  const data = await resp.json();
  return { result: data.result, meta: data.meta || {} };
}

async function savedAnswer(tool) {
  const resp = await fetch(`samples/${tool}.json`);
  if (!resp.ok) throw new Error("Could not load the saved answer. Try reloading the page.");
  return { result: await resp.json(), meta: { source: "saved" } };
}

/* ------------------------------------------------------------------ running */

async function run(tool, button) {
  const out = panel(tool);
  const key = visitorKey();

  if (!inputs[tool]().trim()) {
    out.innerHTML = `<p class="notice notice-warn">Put something in the box first.</p>`;
    return;
  }

  button.disabled = true;
  button.textContent = "Asking the model…";
  out.innerHTML = `<p class="notice">Working…</p>`;

  try {
    let answer;

    if (key) {
      answer = await callGroqDirect(tool, key);
    } else if (backend.ready) {
      /* A backend that was up at page load and is down now should still leave
       * the visitor with something to read. */
      answer = await callBackend(tool).catch(() => savedAnswer(tool));
    } else {
      answer = await savedAnswer(tool);
    }

    out.innerHTML = stamp(answer.meta) + RENDERERS[tool](answer.result);
  } catch (err) {
    out.innerHTML = `<p class="notice notice-warn">${esc(err.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = LABELS[tool];
  }
}

/* The line above every answer saying where it came from. Nothing here is
 * decorative: a saved answer that is not marked as saved is a lie about what
 * this page can do. */
function stamp(meta = {}) {
  if (meta.source === "live" && meta.key === "byok") {
    return `<p class="stamp stamp-live">Live, generated just now by ${esc(meta.model || MODEL)} on your key.</p>`;
  }
  if (meta.source === "live") {
    return `<p class="stamp stamp-live">Live, generated just now by ${esc(meta.model || MODEL)} on my key.</p>`;
  }
  if (meta.source === "cached") {
    return `<p class="stamp stamp-saved">${esc(whyCached(meta.reason))}
      Add your own key below and it runs live straight away.</p>`;
  }
  return `<p class="stamp stamp-saved">A saved answer from a real earlier run, not generated just now.
    Add a free Groq key below and the same input runs live in your browser.</p>`;
}

function whyCached(reason) {
  if (reason === "too_fast") {
    return "A saved answer. That was a lot of requests in a minute, so the shared key is pausing you.";
  }
  if (reason === "visitor_daily") {
    return "A saved answer. You have used today's dozen free runs on my key.";
  }
  if (reason === "daily_budget") {
    return "A saved answer. Today's shared budget is spent; it resets at midnight UTC.";
  }
  if (reason === "provider_busy") {
    return "A saved answer. Groq is rate limiting the shared key at the moment.";
  }
  if (reason === "provider_error") {
    return "A saved answer. The model call failed, so this is the last known good one.";
  }
  return "A saved answer from a real earlier run.";
}

/* ------------------------------------------------------------------ mode */

/* One HEAD-ish call at load, so the label under the tabs is telling the truth
 * before anyone clicks. It is deliberately not awaited by anything: if it never
 * comes back the page stays on saved answers and stays usable. */
async function probe() {
  if (!API_BASE) return;

  try {
    const resp = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return;

    const data = await resp.json();
    backend = { ready: Boolean(data.shared_key), remaining: data.runs_remaining_today ?? null };
  } catch {
    /* Worker asleep, offline, or never deployed. Saved answers, then. */
  } finally {
    showMode();
  }
}

function showMode() {
  const el = document.getElementById("demo-mode");
  if (!el) return;

  if (visitorKey()) {
    el.textContent = "your key, answers live";
  } else if (backend.ready) {
    el.textContent = "shared key, answers live";
  } else {
    el.textContent = "saved answers, add a key to run live";
  }
}

showMode();
probe();

/* ---------------------------------------------------------------- rendering */

function renderReview(r) {
  const findings = (r.findings || []).map(f => `
    <li>
      <span class="sev sev--${esc(f.severity)}">${esc(f.severity)}</span>
      <strong>${esc(f.title)}</strong>${f.line ? ` <span class="dim">line ${f.line}</span>` : ""}
      <p>${esc(f.detail || "")}</p>
      ${f.recommendation ? `<p class="dim">Fix: ${esc(f.recommendation)}</p>` : ""}
    </li>`).join("");

  const tests = (r.suggested_tests || []).map(t => `<li>${esc(t.title)}</li>`).join("");

  return `
    ${r.summary ? `<p class="notice">${esc(r.summary)}</p>` : ""}
    <ul class="findings">${findings || "<li>Nothing flagged.</li>"}</ul>
    ${tests ? `<h4>Tests worth adding</h4><ul class="plain">${tests}</ul>` : ""}`;
}

function renderSpecs(r) {
  const scenarios = (r.scenarios || []).map(s => `
    <li><strong>${esc(s.name)}</strong>
      <pre>${esc((s.steps || []).join("\n"))}</pre>
    </li>`).join("");

  const cases = (r.pytest_cases || [])
    .map(c => `<li><code>${esc(c.function_name)}</code>: ${esc(c.intent || "")}</li>`)
    .join("");

  return `
    <h4>Feature: ${esc(r.feature || "")}</h4>
    <ul class="plain">${scenarios}</ul>
    ${cases ? `<h4>Pytest cases</h4><ul class="plain">${cases}</ul>` : ""}
    ${r.coverage_notes ? `<p class="notice dim">${esc(r.coverage_notes)}</p>` : ""}`;
}

function renderHeal(r) {
  if (!r.found) {
    return `<p class="notice">Nothing in that markup plausibly matches. ${esc(r.reasoning || "")}</p>`;
  }
  return `
    <p class="notice">Strategy <strong>${esc(r.strategy)}</strong>, confidence ${Math.round((r.confidence || 0) * 100)}%.</p>
    <pre>${esc(r.playwright || r.locator || "")}</pre>
    <p class="notice dim">${esc(r.reasoning || "")}</p>`;
}

/* Everything above builds HTML strings from model output, so every value that
 * came out of a model goes through here first. */
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
