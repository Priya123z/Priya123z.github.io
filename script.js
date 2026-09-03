/* Nav, and the three browser-side tools.

   There is deliberately no scroll-reveal here. An earlier version started every
   section at opacity 0 and faded it in, which meant anything that stopped this
   file from running left the page blank — and that happened on the live site.
   The markup now renders complete on load and JavaScript only adds behaviour. */

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

/* ------------------------------------------------------------------ *
   The tools

   Three ways an answer can arrive, in order of preference:

   1. The visitor pasted their own Groq key — the browser calls Groq directly.
      Groq allows cross-origin requests, so no server is involved, there is no
      shared quota to run out, and the key never leaves their machine.
   2. A hosted API is configured on <body data-api> — used when one is deployed.
   3. Neither — a saved answer from a real run, clearly labelled. That way the
      page always shows real model output rather than an error, which matters
      more here than being live.
 * ------------------------------------------------------------------ */

const API_BASE = document.body.dataset.api || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const tools = {
  review: {
    input: () => field("review").value,
    direct: input => callGroq(PROMPTS.review.system, PROMPTS.review.user(input)),
    render: renderReview,
    label: "Review this code",
  },
  specs: {
    input: () => field("specs").value,
    direct: input => callGroq(PROMPTS.specs.system, PROMPTS.specs.user(input)),
    render: renderSpecs,
    label: "Write the scenarios",
  },
  heal: {
    input: () => field("heal").value,
    direct: input => callGroq(
      PROMPTS.heal.system,
      PROMPTS.heal.user(input, document.getElementById("heal-selector").value, ""),
    ),
    render: renderHeal,
    label: "Repair the locator",
  },
};

const payloads = {
  review: () => ({ code: field("review").value, filename: "snippet.py" }),
  specs: () => ({ story: field("specs").value }),
  heal: () => ({
    selector: document.getElementById("heal-selector").value,
    html: field("heal").value,
    description: "",
  }),
};

const endpoints = { review: "/api/review", specs: "/api/specs", heal: "/api/heal" };

function field(name) {
  return document.getElementById(`${name}-input`);
}

function panel(name) {
  return document.getElementById(`${name}-output`);
}

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

async function callGroq(system, user) {
  const key = document.getElementById("demo-key").value.trim();

  const resp = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 3000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const data = await resp.json().catch(() => ({}));

  if (resp.status === 401) {
    throw new Error("Groq rejected that key. Check it at console.groq.com/keys, or clear the field to see the saved answer.");
  }
  if (resp.status === 429) {
    throw new Error("That key hit its rate limit. Wait a minute — the free tier allows 30 requests per minute.");
  }
  if (!resp.ok) {
    throw new Error(data?.error?.message || `Groq answered ${resp.status}.`);
  }

  return JSON.parse(data.choices[0].message.content);
}

async function viaApi(name) {
  const resp = await fetch(API_BASE + endpoints[name], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payloads[name]()),
  });

  if (!resp.ok) throw new Error(`the API answered ${resp.status}`);

  const data = await resp.json();
  return { result: data.result, meta: data.meta };
}

async function savedSample(name) {
  const resp = await fetch(`samples/${name}.json`);
  if (!resp.ok) throw new Error("Could not load the saved answer. Try reloading the page.");
  return { result: await resp.json(), meta: { source: "saved" } };
}

async function run(name, button) {
  const tool = tools[name];
  const out = panel(name);
  const hasKey = !!document.getElementById("demo-key").value.trim();

  if (!tool.input().trim()) {
    out.innerHTML = `<p class="notice notice-warn">Put something in the box first.</p>`;
    return;
  }

  button.disabled = true;
  button.textContent = hasKey ? "Asking the model…" : "Loading…";
  out.innerHTML = `<p class="notice">Working…</p>`;

  try {
    let answer;

    if (hasKey) {
      answer = { result: await tool.direct(tool.input()), meta: { source: "live" } };
    } else if (API_BASE) {
      try {
        answer = await viaApi(name);
      } catch {
        answer = await savedSample(name);
      }
    } else {
      answer = await savedSample(name);
    }

    out.innerHTML = stamp(answer.meta) + tool.render(answer.result);
  } catch (err) {
    out.innerHTML = `<p class="notice notice-warn">${esc(err.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = tool.label;
  }
}

function stamp(meta = {}) {
  if (meta.source === "live") {
    return `<p class="stamp stamp-live">Live — generated just now by ${esc(MODEL)} on your key.</p>`;
  }
  if (meta.source === "cache") {
    return `<p class="stamp">Served from cache — this exact input has been run before.</p>`;
  }
  if (meta.source === "cached") {
    return `<p class="stamp stamp-saved">Saved answer. The shared key is out of budget for now
      (${esc(meta.reason || "quota")}) — add your own key below to run it live.</p>`;
  }
  return `<p class="stamp stamp-saved">Saved answer from a real run, not generated just now.
    Add a free Groq key below and the same input runs live in your browser.</p>`;
}

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

  const cases = (r.pytest_cases || []).map(c => `<li><code>${esc(c.function_name)}</code> — ${esc(c.intent || "")}</li>`).join("");

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

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function showMode() {
  const el = document.getElementById("demo-mode");
  if (!el) return;
  const hasKey = !!document.getElementById("demo-key").value.trim();
  el.textContent = hasKey ? "your key — answers live" : "saved answers — add a key to run live";
}

document.getElementById("demo-key").addEventListener("input", showMode);
showMode();
