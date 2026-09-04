# priya123z.github.io

My portfolio. Plain HTML, CSS and JavaScript, no build step and no framework.
You can open any file in the repository and read the whole thing.

Live at **[priya123z.github.io](https://priya123z.github.io/)**.

```
index.html    the page
style.css     the stylesheet
prompts.js    the three prompts, imported by the page and by the Worker
script.js     nav, and the three tool clients
samples/      saved model answers, shown when nothing live is reachable
check.py      the pre-push check, run with Playwright
worker/       the Cloudflare Worker that holds the Groq key

Priya_Bhagoriya_Resume.pdf     what the Resume buttons open
Priya_Bhagoriya_Resume.docx    the same document, for anyone who wants it editable
```

## Running it

```bash
python3 -m http.server 8000
```

Port 8000 specifically, because `localhost:8000` is in the Worker's CORS
allowlist and other ports are not.

`script.js` is an ES module, so opening `index.html` with a `file://` URL will
not work. That is the only reason a server is needed.

## Before pushing

```bash
python3 check.py
```

It drives the page with Playwright at 390, 768, 1440 and 1920 and checks the
things that are easy to break and quiet about it: horizontal overflow, whether
the hamburger appears at the right breakpoint, that every anchor resolves and
every local file is served, that each tool produces a labelled answer, that
empty input is refused before anything is called, that a bad key produces a
readable message, and that the page still reads with JavaScript switched off.

It also stands in for the Worker and checks the part that matters most: that
every backend outcome is labelled honestly, including a loop over every reason
the Worker can send, so a new one cannot be added without a branch that explains
it in words. A saved answer presented as a live one is the worst bug this page
could have, and it is the one you would never find by clicking around, because it
looks exactly like success.

It never spends the Worker's budget. `data-api` carries a real address and
`localhost:8000` is in the Worker's CORS allowlist, so every group rewrites that
attribute in the served HTML: to nothing where it is checking the page's
plumbing, and to a host that does not resolve where it is checking the labels.

Seventy-six checks, and a non-zero exit if any of them fail. Worth running after
any change to `style.css` in particular, because the section rules are easy to
break on specificity and the damage shows up at one viewport only.

## How the three tools answer

The review, requirements and locator-repair tools each answer one of three ways,
tried in this order. Whichever one ran, the page says so above the answer.

1. **The visitor pasted their own Groq key.** The browser calls Groq directly.
   Groq allows cross-origin requests, so nothing of mine is in that path, there
   is no budget to run out, and the key never leaves the machine it was typed on.

2. **Nobody pasted anything, and the Worker is deployed.** `worker/` holds my
   Groq key as a Cloudflare secret and answers on it, inside a daily budget of
   400 runs across everyone and 12 per visitor. This is the normal case, and it
   is the reason the page can say "no key needed" and mean it.

   The same Worker also serves the demo on
   [ai-testcase-generator](https://github.com/Priya123z/ai-testcase-generator),
   which is a GitHub project page and therefore the same origin. One deployment,
   one secret, one budget, two pages.

3. **Neither.** A saved answer from `samples/`, labelled as saved.

The third one is not a consolation prize, it is the guarantee. Whatever is down,
these tools cannot show a broken widget, and they cannot show a saved answer
dressed up as a live one either.

The Worker is wired in through one attribute:

```html
<body data-api="https://priya-ai-tools.your-subdomain.workers.dev">
```

Empty means not deployed, and the page falls back to saved answers without
complaining. Deploy notes are in [worker/README.md](worker/README.md).

### Why the key is not in the page

Because the page is public. A Groq key in `script.js` is a Groq key in
devtools, and free keys that end up in public repositories get found and drained
quickly. The Worker exists purely so that the key can be somewhere the browser
cannot read, which is what makes "click the button, no signup" possible at all.

### Where the prompts live

`prompts.js` is imported by both `script.js` and the Worker, so the two paths
send byte-identical prompts and an answer looks the same whichever produced it.

It is still a copy of the prompts in
[ai-code-review](https://github.com/Priya123z/ai-code-review) under
`ai_review/analyzers/`. Change one and you have to change the other. That
duplication is real and I have not found a way around it that does not involve
this page depending on a Python package at runtime.

## The resume

Every Resume button opens the PDF directly in a new tab. There was an HTML
version briefly and it added one more click between someone wanting to read the
resume and reading it; a recruiter already knows what to do with a PDF.

The `.docx` is the same document. Both come from the DOCX via
`soffice --headless --convert-to pdf`, so after editing, check the reconversion
did not reflow anything:

```bash
pdftotext old.pdf - | diff - <(pdftotext new.pdf -)
```

## Two things this page deliberately does not do

**No entrance animation.** An earlier version started every section at
`opacity: 0` and revealed it with an IntersectionObserver. Anything that stopped
that script (a JS error, an old browser, JavaScript switched off) left the page
blank, and that happened on the live site. The markup now renders complete and
JavaScript only adds behaviour. Turn JS off and you still get about 12,000
characters of readable page, which `check.py` asserts on.

**No logo.** It is a portfolio for one person, so the name is the mark.

