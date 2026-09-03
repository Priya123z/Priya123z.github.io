# priya123z.github.io

My portfolio. Plain HTML, CSS and JavaScript — no build step, no framework.

    index.html   markup
    style.css    styles
    prompts.js   the prompts the browser-side demos send
    script.js    nav, scroll reveal, and the demo clients
    samples/     saved model responses, shown when there is no key

## Running it

Any static server works:

    python3 -m http.server 8000

## The demo section

The three AI demos answer one of three ways, in order of preference:

1. If a visitor pastes their own Groq key, the browser calls Groq directly. Groq
   allows cross-origin requests, so there is no server in that path, no shared
   quota to run out, and the key never leaves their machine.
2. If a hosted API is configured on `<body data-api="...">`, it is used. That
   service lives in [ai-code-review](https://github.com/Priya123z/ai-code-review)
   under `server/`. Nothing is deployed right now — Hugging Face made Docker
   Spaces a paid feature — so this path is dormant.
3. Otherwise, a saved response from `samples/` is shown, clearly labelled as
   saved rather than passed off as live.

Which means the demo always shows real model output. It never shows a broken
widget, and it costs nothing to keep up.

`prompts.js` mirrors the prompts in ai-code-review's analyzers. They are
duplicated because path 1 has no server to fetch them from.

## A note on the reveal animation

Sections start at `opacity: 0` and are revealed by an IntersectionObserver. An
earlier version had no fallback, so anything that stopped that script left the
page blank. There are three guards now: reduced-motion skips the animation,
a missing IntersectionObserver reveals everything immediately, and a timeout
reveals everything if the observer never fires.
