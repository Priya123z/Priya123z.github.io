# A deep read of the portfolio

The README covers what this is and how to run it. This is the longer version: why
a portfolio has a backend at all, how the tools decide what to answer with, what
`check.py` is really guarding against, and the handful of decisions that would
otherwise look arbitrary.

- [1. What it is](#1-what-it-is)
- [2. Every file, and its job](#2-every-file-and-its-job)
- [3. The three answer paths](#3-the-three-answer-paths)
- [4. Why there is a Worker](#4-why-there-is-a-worker)
- [5. Budgeting a free tier](#5-budgeting-a-free-tier)
- [6. One prompts module, two runtimes](#6-one-prompts-module-two-runtimes)
- [7. The page itself](#7-the-page-itself)
- [8. check.py](#8-checkpy)
- [9. Deploying](#9-deploying)
- [10. Decisions worth explaining](#10-decisions-worth-explaining)
- [11. What it does not do](#11-what-it-does-not-do)
- [12. FAQ](#12-faq)

---

## 1. What it is

A static page: HTML, CSS and JavaScript, no build step, no framework, no
`node_modules` in the deployed output. You can open any file in the repository
and read the whole thing.

The part that is not static is the "Try the tools" section, which runs three
things live in the browser: a code reviewer, a requirement-to-tests generator,
and a Playwright locator repairer. Those are the same prompts that run in CI in
[ai-code-review](https://github.com/Priya123z/ai-code-review), wired to the page.

The interesting constraint is that they have to work for someone who has just
clicked a link from a CV and is not going to sign up for an API key to look at
your portfolio. That constraint is where most of this document goes.

---

## 2. Every file, and its job

```
index.html      the page
style.css       the stylesheet
prompts.js      the prompts, imported by the page AND by the Worker
script.js       nav, and the three tool clients
samples/        saved model answers, the last-resort fallback
check.py        71 Playwright checks, run before pushing
worker/
  src/index.js  routing, budgeting, the Groq call, the fallbacks
  wrangler.toml name, entry point, the commented-out KV binding
  README.md     deploy notes
```

Seven things, and the largest is the page.

`samples/` holds four JSON files: three for the portfolio's own tools, and
`generate.json` for the ai-testcase-generator demo the Worker also serves. They
are real answers from real runs, not fabricated examples, which matters because
they are what a visitor sees when everything else is unavailable.

---

## 3. The three answer paths

Every tool answers one of three ways. The page tries them in this order and
always says which one it used.

**1. The visitor pasted their own Groq key.** The browser calls Groq directly.
Groq allows cross-origin requests, so nothing of mine is in that path, there is
no shared budget to run out, and the key never leaves the machine it was typed
on. It lives in one password input, is never written to storage, and is gone when
the tab closes.

**2. Nobody pasted anything, and the Worker is deployed.** This is the normal
case, and it is the whole reason the page can say "no key needed" and mean it.

**3. Neither.** A saved answer from `samples/`, labelled as saved.

```javascript
if (key) {
  answer = await callGroqDirect(tool, key);
} else if (backend.ready) {
  answer = await callBackend(tool).catch(() => savedAnswer(tool));
} else {
  answer = await savedAnswer(tool);
}
```

The `.catch()` on the backend call is not defensive padding. `backend.ready` was
determined by a health probe at page load; the Worker can be up then and asleep,
rate limited or redeploying by the time somebody presses the button. A visitor
should be left with something to read either way.

### Path three is the guarantee, not the consolation prize

This is the design decision the whole section rests on. **The tools on this page
cannot show a broken widget, whatever is down.** There is no state in which
pressing the button produces a stack trace, a spinner that never resolves, or an
empty box.

And the corollary, which matters just as much: **they cannot show a saved answer
dressed up as a live one either.** Every answer carries a stamp saying where it
came from, and the reason if it is saved:

| Situation | What the stamp says |
|---|---|
| Their key | "Live, generated just now by … on your key." |
| Shared key | "Live, generated just now by … on my key." |
| Budget spent | "A saved answer. Today's shared budget is spent; it resets at midnight UTC." |
| Their dozen used | "A saved answer. You have used today's dozen free runs on my key." |
| Groq rate limiting | "A saved answer. Groq is rate limiting the shared key at the moment." |
| Nothing deployed | "A saved answer from a real earlier run, not generated just now." |

A saved answer presented as live would be the single worst bug this page could
have. It is also the one that would never be caught by clicking around, because
it looks exactly like success. That is why `check.py` asserts on it
([section 8](#8-checkpy)).

### The mode line

Under the tabs there is a line saying which path is currently in play. It is set
by a health probe fired at load:

```javascript
let backend = { ready: false, remaining: null };
```

It starts `false` on purpose. The page would rather say "saved answers" and then
be pleasantly wrong when the probe comes back, than promise live answers and fail
to deliver one. The probe is never awaited by anything; if it does not come back,
the page stays usable on saved answers.

---

## 4. Why there is a Worker

Because the page is public.

The three tools need a model. A model call needs a key. A key written into
`script.js` is a key anyone can read in devtools in about four seconds, and free
Groq keys that end up in public repositories get scraped and drained. This is not
a theoretical objection.

So the options were:

1. **Ask every visitor for a key.** What the page did before. It works, and
   almost nobody does it, so almost everybody only ever saw the saved path. The
   demo was technically live and practically a screenshot.
2. **Put the key in the page.** Not an option.
3. **Put the key somewhere the browser cannot read it.** A Worker.

Cloudflare Workers are free: 100,000 requests a day, no card. The key goes in as
a secret:

```bash
npx wrangler secret put GROQ_API_KEY
```

which is the only place it exists. Not in the repository, not in the page, not in
a `.env` that might get committed. `.dev.vars` for local development is
gitignored, and the gitignore says why.

The page is wired to it by one attribute:

```html
<body data-api="https://priya-ai-tools.your-subdomain.workers.dev">
```

Empty means not deployed, and everything falls back to saved answers without
complaining. **Nothing on the page depends on the Worker being up**, which is
what makes deploying it a nice-to-have rather than a liability.

### It serves two pages

The Worker also answers for the demo on
[ai-testcase-generator](https://github.com/Priya123z/ai-testcase-generator).
That is a GitHub project page, so it is served from `priya123z.github.io` too:
the same origin, no CORS change, one deployment, one secret, one budget.

Four endpoints: `review`, `specs`, `heal` for this page, and `generate` for that
one. `generate` uses a fuller schema and a larger token budget, matching what the
generator's own Python client sends, so a hosted answer and a local run agree.

---

## 5. Budgeting a free tier

Groq's free tier allows 30 requests a minute and 1,000 a day. The Worker sits
well under both:

```javascript
const SHARED_RUNS_PER_DAY = 400;
const RUNS_PER_VISITOR_PER_DAY = 12;
```

Deliberately, so that **the demo degrades before the provider does**. Running out
of my budget produces a saved answer and a sentence explaining it. Running out of
Groq's produces a 429 and an error, which teaches a visitor nothing.

The per-visitor cap is the one that actually matters. Without it, one person with
a loop drains the day for everyone else in about a minute.

### The counters

Cloudflare KV, one key for the day's total and one per visitor:

```javascript
const sharedKey = `day:${day}`;
const visitorCounterKey = `ip:${day}:${await visitorId(request)}`;
```

Three things are worth saying about them.

**They are approximate, and that is fine.** KV is eventually consistent: two
requests landing in two datacentres in the same second can both read the same
number and both write `count + 1`. The ceiling is therefore soft, which is
exactly why it sits far enough below Groq's real limits that being off by a
handful cannot matter. The strongly consistent alternative is a Durable Object,
which is not on the free plan.

**The IP is hashed before it becomes a key.**

```javascript
const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
```

So what the namespace holds is a set of counters, not a list of who visited and
when. Sixteen hex characters is more than enough to keep a few hundred visitors
a day apart, and the keys expire after 48 hours.

**A missing KV binding does not take the tools offline.**

```javascript
if (!env.BUDGET) return { allowed: true };
```

The Worker answers either way; without the binding it simply stops counting. That
is the right way round for a portfolio, and it is why `wrangler.toml` ships with
the KV block commented out: `wrangler deploy` works on a clean account with
nothing set up, and turning the counters on is a second, optional step.

### Counted before the call, not after

```javascript
/* Counted before the call rather than after it, so a visitor cannot get past
 * the cap by making requests that fail. */
```

The cost is that if Groq is down, a visitor spends their twelve on saved answers.
Counting afterwards would make the cap unenforceable, which is worse. It is a
real trade and the comment says so rather than pretending there is no downside.

### What happens when a call fails

```javascript
if (keySource === "byok") {
  return json({ error: err.message }, err.status || 502, cors);
}
return saved(tool, err.status === 429 ? "provider_busy" : "provider_error", cors);
```

A visitor's own key failing is their problem to see and fix, so they get the real
error: "Groq rejected that key" is actionable. The shared key failing is my
problem, and a saved answer is a better outcome for them than my outage.

### CORS is not authentication

```javascript
const ALLOWED_ORIGINS = ["https://priya123z.github.io", "http://localhost:8000", ...];
```

Anything else gets a response with no CORS header, which a browser refuses. It
does nothing about `curl`, and it is not meant to. It stops the shared budget
being spent by somebody else's site, and the comment in the file says so rather
than implying it is a security boundary.

---

## 6. One prompts module, two runtimes

`prompts.js` is an ES module imported by both `script.js` (in the browser) and
`worker/src/index.js` (in Cloudflare's runtime). Wrangler's bundler resolves the
`../../` import at build time.

The point is that **an answer is identical whichever path produced it**. Same
system prompt, same temperature, same `response_format`. If the prompts were
written out twice they would drift, and a visitor's experience would depend on
whether they happened to paste a key.

That is not a hypothetical worry. The exact same duplication in
`ai-testcase-generator` had already drifted: its browser copy of the system
prompt had lost a whole clause, so the same requirement produced measurably
different output on the two paths, and nothing had noticed. That repository now
has a test comparing the two character for character.

Here the problem is avoided rather than tested, by there only being one copy.

`groqBody()` and `userMessage()` live in the same module for the same reason: the
request body and the argument order are exactly the sort of thing that drifts
between two implementations.

The duplication that remains is real and is not solved: `prompts.js` mirrors the
prompts in `ai-code-review`'s `ai_review/analyzers/`. Change one and you have to
change the other. I have not found a way around it that does not involve this
page depending on a Python package at runtime, and the README says so.

---

## 7. The page itself

### No entrance animation

An earlier version started every section at `opacity: 0` and revealed it with an
`IntersectionObserver`. Anything that stopped that script (a JS error, an old
browser, JavaScript switched off) left the page **blank**, and that happened on
the live site.

The markup now renders complete on load and JavaScript only adds behaviour. Turn
JS off and you still get about 12,000 characters of readable page, which
`check.py` asserts on so it stays true.

The general rule, which I would apply anywhere: **content should not depend on
script.** Script is for behaviour. If your reveal animation can produce a blank
page, it is not an animation, it is a single point of failure with an easing
curve.

### The architecture section

The largest piece of writing on the page, and it is structured as an argument
rather than a diagram: state the rule, trace one real test down through four
layers with the actual code at each level, restate it as what each layer must
*never* contain, then give a symptom-to-layer lookup table.

The code in it is copied from the framework repository rather than written for
the page, which is the only reason it is worth reading.

### `<details>` for the key input

The key input is inside a closed `<details>` labelled "Optional: run it on your
own key instead". Closed, because the whole point of the Worker is that you do
not need it, and an open key field is an instruction. Present, because sometimes
you do.

---

## 8. check.py

No build step means no test framework, which is mostly good and does mean nothing
catches a CSS rule that only breaks at 768px. `check.py` is that.

```bash
python3 -m http.server 8000 &
python3 check.py
```

71 checks, non-zero exit on failure. Four viewports (390, 768, 1440, 1920),
every anchor, every local file, the three tools, the no-JS path, and the backend
paths.

It has already earned its keep twice.

**On its first run** it found a horizontal overflow at 390px: a file path in the
architecture section was longer than a phone is wide, and flex items refuse to
shrink below their content by default. Two CSS lines. Invisible on a laptop, and
the kind of thing you find out about from someone else's screenshot.

**When the backend was added**, it caught nothing, which was the point of adding
`check_backend_paths`. That group stands in for the Worker with
`page.route(...)` and asserts the page tells the truth about every `meta.source`
it can receive:

```python
check("on my key" in stamp.inner_text(), "a shared-key answer says it ran on my key")
check("stamp-live" in stamp.get_attribute("class"), "a live answer is styled as live")
check("budget is spent" in stamp.inner_text(), "an out-of-budget answer says why")
check("stamp-saved" in stamp.get_attribute("class"), "a saved answer is never styled as live")
```

Those four are the ones I would keep if I had to delete the rest. Everything else
in the file catches bugs you would eventually notice. Those catch the bug you
would never notice, because a saved answer presented as live looks exactly like
the thing working.

One implementation detail worth explaining, because the obvious approach does not
work. Setting `data-api` with `page.add_init_script` races the module load:
`script.js` is `type="module"` and reads the attribute at roughly the same moment.
So the check rewrites the HTML in flight instead, which is deterministic:

```python
def with_api(route):
    body = pathlib.Path("index.html").read_text().replace(
        '<body data-api="">', '<body data-api="https://worker.test">', 1)
    route.fulfill(status=200, content_type="text/html; charset=utf-8", body=body)
```

---

## 9. Deploying

The page deploys itself: GitHub Pages serves `main`. There is no build.

The Worker is separate and optional:

```bash
cd worker
npm install
npx wrangler login
npx wrangler deploy
npx wrangler secret put GROQ_API_KEY
```

Then paste the printed URL into `data-api` in `index.html`.

Check it took:

```bash
curl https://priya-ai-tools.your-subdomain.workers.dev/api/health
```

```json
{"status": "ok", "shared_key": true, "model": "openai/gpt-oss-120b",
 "runs_remaining_today": 400, "runs_per_visitor_per_day": 12}
```

`shared_key: false` is the one failure worth watching for. It means the secret did
not get set and every visitor is quietly getting saved answers. The page keeps
working, so nothing else tells you: that is exactly the kind of silent degradation
this whole codebase is built to surface, and `/api/health` is where it surfaces.

Optional counters:

```bash
npx wrangler kv namespace create BUDGET
```

then uncomment the three lines in `wrangler.toml` and redeploy.

---

## 10. Decisions worth explaining

**No framework.** A portfolio is a document. React would add a build step, a
`node_modules`, and a deployed bundle nobody can read, in exchange for component
reuse on a page with no repeated components.

**IBM Plex.** Drawn for technical products, holds up at the larger sizes this
page uses, which Inter did not.

**The resume is a PDF and nothing else.** There was an HTML version briefly, and
it put one more click between someone wanting to read the resume and reading it.
A recruiter knows what to do with a PDF.

**No logo.** One person, so the name is the mark.

**`localStorage` is not used for the key.** Deliberately. A password field that
survives a reload is a nicer experience and a worse promise. "It is gone when you
close the tab" is only true if it is actually true.

---

## 11. What it does not do

**No analytics.** No idea how many people press the buttons. The Worker's logs
would say, if it is deployed, and that is enough.

**The Worker has no automated tests.** Its behaviour was verified by hand against
`wrangler dev`, including every fallback path and the per-visitor cap. That is
weaker than `check.py`, and the honest reason is that it is about 300 lines with
one branch that matters, which `check.py` covers from the client side anyway.

**The budget resets at midnight UTC**, not in the visitor's timezone. Simpler,
and the counters key on a UTC date string.

**No streaming.** Answers arrive whole, after a few seconds.

**The prompts are duplicated from ai-code-review.** Documented, not solved.
[Section 6](#6-one-prompts-module-two-runtimes).

---

## 12. FAQ

**Why not just put the key in the page and rotate it when it gets abused?**
Because "when" is measured in days, the rotation is manual, and the failure mode
is a dead demo on the page you sent to a recruiter last week.

**Why Cloudflare and not Vercel or a Hugging Face Space?**
Free with no card, no cold start worth mentioning, and KV in the same free plan.
The Space route was tried first, in `ai-code-review`'s `server/`; Hugging Face
made Docker Spaces paid partway through.

**Why keep the saved answers now that there is a Worker?**
Because the Worker can be down, out of budget, or never deployed, and because a
fork of this repository has no Worker at all. Path three is what makes the tools
unconditional.

**Why does the visitor's own key not go through the Worker?**
It could, and it would be one code path instead of two. But then their key passes
through my infrastructure, and the page promises it does not. Two paths is the
price of that promise being true.

**How do I know the saved answers are real?**
They came from real runs. In `ai-testcase-generator` there is a test that
validates its saved answer against the same Pydantic model the live path
produces, so it cannot drift into a shape the page cannot render.

**Is `check.py` really 71 assertions for one page?**
The page has four viewports, three tools, a no-JS path and six backend states.
Seventy-one is roughly one per thing that can independently break, and it runs in
under a minute.

**What breaks most often?**
CSS at one viewport. The section rules are easy to break on specificity and the
damage shows up at 390px only, which is why `check.py` runs there first.
