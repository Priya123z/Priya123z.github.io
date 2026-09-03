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
   Live demos
 * ------------------------------------------------------------------ */

const API_BASE = document.body.dataset.api || "";

const demos = {
  review: {
    endpoint: "/api/review",
    body: () => ({ code: field("review").value, filename: "snippet.py" }),
    render: renderReview,
  },
  specs: {
    endpoint: "/api/specs",
    body: () => ({ story: field("specs").value }),
    render: renderSpecs,
  },
  heal: {
    endpoint: "/api/heal",
    body: () => ({
      selector: document.getElementById("heal-selector").value,
      html: field("heal").value,
      description: "",
    }),
    render: renderHeal,
  },
};

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

async function run(name, button) {
  const demo = demos[name];
  const out = panel(name);
  const key = document.getElementById("demo-key").value.trim();

  button.disabled = true;
  button.textContent = "Running…";
  out.innerHTML = `<p class="demo-note">Asking the model…</p>`;

  try {
    const headers = { "Content-Type": "application/json" };
    if (key) headers["X-API-Key"] = key;

    const resp = await fetch(API_BASE + demo.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(demo.body()),
    });

    if (!resp.ok) throw new Error(`the API answered ${resp.status}`);

    const data = await resp.json();
    out.innerHTML = badge(data.meta) + demo.render(data.result);
    refreshQuota();
  } catch (err) {
    // The demo runs on a free tier behind a sleeping container. Say so plainly
    // rather than showing a broken widget.
    out.innerHTML = `
      <p class="demo-note demo-note--warn">
        Could not reach the demo API (${err.message}).
        It sleeps after a couple of days idle and takes about 30 seconds to wake —
        try again shortly, or run it locally from the repository.
      </p>`;
  } finally {
    button.disabled = false;
    button.textContent = "Run";
  }
}

function badge(meta = {}) {
  if (meta.source === "live") {
    return `<p class="demo-meta demo-meta--live">Live · ${esc(meta.provider || "")} · ${esc(meta.model || "")}</p>`;
  }
  if (meta.source === "cache") {
    return `<p class="demo-meta">Served from cache — someone already ran this exact input.</p>`;
  }
  return `<p class="demo-meta demo-meta--warn">
    Saved example, not a live run (${esc(meta.reason || "quota")}). The shared key has a
    daily budget; add your own Groq key above to run it live.</p>`;
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

async function refreshQuota() {
  const el = document.getElementById("demo-quota");
  if (!el) return;
  try {
    const resp = await fetch(API_BASE + "/api/quota");
    if (!resp.ok) return;
    const q = await resp.json();
    el.textContent = `${q.your_runs_remaining_today} runs left for you today · ${q.runs_served_today} served`;
  } catch {
    el.textContent = "";
  }
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

if (API_BASE) refreshQuota();
