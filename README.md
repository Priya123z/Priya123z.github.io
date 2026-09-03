# priya123z.github.io

My portfolio. Plain HTML, CSS and JavaScript — no build step, no framework, no
`node_modules`. Five files, and you can open any of them and read the whole
thing.

Live at **[priya123z.github.io](https://priya123z.github.io/)**.

    index.html    the portfolio
    style.css     the stylesheet
    prompts.js    the prompts the browser-side tools send
    script.js     nav, and the three tool clients
    samples/      saved model answers, shown when there is no key

    Priya_Bhagoriya_Resume.pdf    what the Resume buttons open
    Priya_Bhagoriya_Resume.docx   the same document, for whoever wants it editable

## Running it

Any static server:

    python3 -m http.server 8000

## The resume

Every Resume button on the page opens
[the PDF](https://priya123z.github.io/Priya_Bhagoriya_Resume.pdf) directly, in a
new tab. There is no HTML version any more — there was briefly, and it meant one
more hop between someone wanting to read the resume and reading it. A recruiter
already knows what to do with a PDF.

The `.docx` is the same document for anyone who wants it editable. Both are
generated from the DOCX via `soffice --headless --convert-to pdf`, so after
editing one, diff the extracted text to check the reconversion did not reflow
anything:

    pdftotext old.pdf - | diff - <(pdftotext new.pdf -)

## How the three tools answer

The review / requirements / locator-repair tools on the portfolio each answer
one of three ways, in order of preference:

1. **The visitor pastes their own Groq key** and the browser calls Groq
   directly. Groq allows cross-origin requests, so there is no server in that
   path, no shared quota to run out, and the key never leaves their machine.
2. **A hosted API on `<body data-api="...">`.** That service lives in
   [ai-code-review](https://github.com/Priya123z/ai-code-review) under
   `server/`. Nothing is deployed right now — Hugging Face made Docker Spaces a
   paid feature — so this path is dormant but tested.
3. **A saved answer from `samples/`**, clearly labelled as saved rather than
   passed off as live.

So the page always shows real model output. It can never be a broken widget,
and it costs nothing to keep running.

`prompts.js` mirrors the prompts in ai-code-review's `ai_review/analyzers/`.
That is real duplication — path 1 has no server to fetch them from. If you
change one, change the other.

## Two things this page deliberately does not do

**No entrance animation.** An earlier version started every section at
`opacity: 0` and revealed it with an IntersectionObserver. Anything that stopped
that script — a JS error, an old browser, JavaScript switched off — left the
page blank, and that happened on the live site. The markup now renders complete
and JavaScript only adds behaviour. Turn JS off and you still get 7,800
characters of readable page.

**No logo.** It is a portfolio for one person, so the name is the mark.

## Checking it before pushing

There is a Playwright script in the repo notes that covers the four viewports
that matter (390 / 768 / 1440 / 1920), horizontal overflow, whether the
hamburger appears at the right breakpoint, every internal link and anchor, the
tool tabs, the empty-input and rejected-key paths, and whether the page is
still readable with JavaScript disabled. Worth running after any change to
`style.css`, because the section rules are easy to break on specificity.
