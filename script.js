const progress = document.getElementById("scrollProgress");
const menuToggle = document.getElementById("menuToggle");
const navLinks = document.getElementById("navLinks");

document.getElementById("year").textContent = new Date().getFullYear();

window.addEventListener("scroll", () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  progress.style.width = `${max ? (window.scrollY / max) * 100 : 0}%`;
}, { passive: true });

menuToggle.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", open);
});

navLinks.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  });
});

/* Reveal on scroll.

   Sections start at opacity 0, so anything that stops this from running leaves the
   page blank. That happened on the live site. Three guards now: reduced-motion
   skips the animation entirely, a timeout reveals everything if the observer never
   fires, and the class is only applied once JS is known to be running. */
const revealables = document.querySelectorAll(".reveal");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function revealAll() {
  revealables.forEach(el => el.classList.add("visible"));
}

if (prefersReducedMotion || !("IntersectionObserver" in window)) {
  revealAll();
} else {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });

  revealables.forEach(el => observer.observe(el));
  setTimeout(revealAll, 2500);
}

/* ------------------------------------------------------------------ *
   Demos

   Three ways this can answer, in order of preference:

   1. The visitor pasted their own Groq key — the browser calls Groq directly.
      Groq allows cross-origin requests, so no server is involved, there is no
      shared quota to exhaust, and the key never leaves their machine.
   2. A hosted API is configured on <body data-api> — used when one is deployed.
   3. Neither — a saved response is shown, clearly labelled. That means the demo
      always shows real model output rather than an error, which matters more on
      a portfolio than being live.
 * ------------------------------------------------------------------ */

const API_BASE = document.body.dataset.api || "";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const demos = {
  review: {
    input: () => field("review").value,
    direct: input => callGroq(PROMPTS.review.system, PROMPTS.review.user(input)),
    render: renderReview,
  },
  specs: {
    input: () => field("specs").value,
    direct: input => callGroq(PROMPTS.specs.system, PROMPTS.specs.user(input)),
    render: renderSpecs,
  },
  heal: {
    input: () => field("heal").value,
    direct: input => callGroq(
      PROMPTS.heal.system,
      PROMPTS.heal.user(input, document.getElementById("heal-selector").value, ""),
    ),
    render: renderHeal,
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
      t.classList.toggle("active", on);
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

  const data = await resp.json();

  if (resp.status === 401) {
    throw new Error("Groq rejected that key. Check it at console.groq.com/keys, or clear the field to see the saved example.");
  }
  if (resp.status === 429) {
    throw new Error("Your key hit its rate limit. Wait a minute and try again — the free tier allows 30 requests a minute.");
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
  if (!resp.ok) throw new Error("could not load the saved example");
  return { result: await resp.json(), meta: { source: "saved" } };
}

async function run(name, button) {
  const demo = demos[name];
  const out = panel(name);
  const hasKey = !!document.getElementById("demo-key").value.trim();

  if (!demo.input().trim()) {
    out.innerHTML = `<p class="demo-note demo-note--warn">Put something in the box first.</p>`;
    return;
  }

  button.disabled = true;
  button.textContent = hasKey ? "Asking the model…" : "Loading…";
  out.innerHTML = `<p class="demo-note">Working…</p>`;

  try {
    let answer;

    if (hasKey) {
      answer = { result: await demo.direct(demo.input()), meta: { source: "live" } };
    } else if (API_BASE) {
      try {
        answer = await viaApi(name);
      } catch {
        answer = await savedSample(name);
      }
    } else {
      answer = await savedSample(name);
    }

    out.innerHTML = badge(answer.meta) + demo.render(answer.result);
  } catch (err) {
    out.innerHTML = `<p class="demo-note demo-note--warn">${esc(err.message)}</p>`;
  } finally {
    button.disabled = false;
    button.textContent = "Run";
  }
}

function badge(meta = {}) {
  if (meta.source === "live") {
    return `<p class="demo-meta demo-meta--live">Live — generated just now by ${esc(MODEL)} on your key.</p>`;
  }
  if (meta.source === "cache") {
    return `<p class="demo-meta">Served from cache — this exact input has been run before.</p>`;
  }
  if (meta.source === "cached") {
    return `<p class="demo-meta demo-meta--warn">Saved example. The shared key is out of budget for now
      (${esc(meta.reason || "quota")}) — add your own key below to run it live.</p>`;
  }
  return `<p class="demo-meta demo-meta--warn">This is a real model response, saved earlier, not a live run.
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
    ${r.summary ? `<p class="demo-summary">${esc(r.summary)}</p>` : ""}
    <ul class="findings">${findings || "<li>Nothing flagged.</li>"}</ul>
    ${tests ? `<h4>Suggested tests</h4><ul class="plain">${tests}</ul>` : ""}`;
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
    ${r.coverage_notes ? `<p class="dim">${esc(r.coverage_notes)}</p>` : ""}`;
}

function renderHeal(r) {
  if (!r.found) {
    return `<p class="demo-note">No reliable replacement found. ${esc(r.reasoning || "")}</p>`;
  }
  return `
    <p>Strategy: <strong>${esc(r.strategy)}</strong> · confidence ${Math.round((r.confidence || 0) * 100)}%</p>
    <pre>${esc(r.playwright || r.locator || "")}</pre>
    <p class="dim">${esc(r.reasoning || "")}</p>`;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function showMode() {
  const el = document.getElementById("demo-quota");
  if (!el) return;
  const hasKey = !!document.getElementById("demo-key").value.trim();
  el.textContent = hasKey ? "your key · runs live" : "saved examples · add a key to run live";
}

document.getElementById("demo-key").addEventListener("input", showMode);
showMode();
