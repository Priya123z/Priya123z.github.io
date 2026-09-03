# priya123z.github.io

My portfolio. Plain HTML, CSS and JavaScript — no build step, no framework.

    index.html   markup
    style.css    styles, light and dark
    script.js    nav, scroll reveal, and the demo clients

## Running it

Any static server works:

    python3 -m http.server 8000

## The demo section

The three AI demos post to a small FastAPI service, set on `<body data-api="...">`.
Source for that service is in
[ai-code-review](https://github.com/Priya123z/ai-code-review) under `server/`.

If the API is unreachable the page says so rather than showing a broken widget.
When the API itself is out of budget it answers with a saved example, labelled as
saved rather than passed off as a live run.

## A note on the reveal animation

Sections start at `opacity: 0` and are revealed by an IntersectionObserver. An
earlier version had no fallback, so anything that stopped that script left the
page blank. There are three guards now: reduced-motion skips the animation,
a missing IntersectionObserver reveals everything immediately, and a timeout
reveals everything if the observer never fires.
