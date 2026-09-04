"""Run this before pushing.

The page has no build step and no test framework, which is mostly a good thing
and does mean nothing catches a CSS rule that only breaks at 768px, or a link
that quietly 404s, or a JavaScript change that takes the tools offline. This is
the thing that catches those.

    python3 -m http.server 8000 &
    python3 check.py

It checks, at four viewports:

  - no horizontal overflow, which is the failure this layout is most prone to
  - the hamburger appears below 780px and not above it
  - every internal anchor resolves to an element that exists
  - every local file the page links to is actually served
  - the three tools each produce an answer, and label where it came from
  - the empty-input path says so instead of calling anything
  - every backend outcome is labelled honestly: live on the shared key, live on
    the visitor's own, out of budget, and the backend going down mid-session
  - the page is still readable with JavaScript switched off

It never spends the Worker's budget. The deployed Worker is in `data-api` and
localhost:8000 is in its CORS allowlist, so a naive run would fire a dozen real
model calls every time. Every group here rewrites `data-api` in the served HTML:
to nothing where it is checking the page's plumbing, and to a host that does not
exist where it is checking how the page labels each backend answer. The only
outbound call is the deliberate bad-key one, which Groq rejects for free.

Exit code is non-zero if anything failed, so it works in CI as well as by hand.
"""
from __future__ import annotations

import pathlib
import re
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000"

# 390 is an iPhone, 768 is the awkward one just below the nav breakpoint,
# 1440 is a laptop, 1920 is the monitor most of these get opened on.
VIEWPORTS = [(390, 844), (768, 1024), (1440, 900), (1920, 1080)]

HAMBURGER_BREAKPOINT = 780

failures: list[str] = []
checks = 0


def check(ok: bool, label: str) -> None:
    global checks
    checks += 1
    if not ok:
        failures.append(label)
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}")


def check_layout(page, width: int, height: int) -> None:
    print(f"\n{width}x{height}")
    page.set_viewport_size({"width": width, "height": height})
    serve_with_api(page, "")
    page.goto(BASE, wait_until="networkidle")

    scroll_w = page.evaluate("document.documentElement.scrollWidth")
    client_w = page.evaluate("document.documentElement.clientWidth")
    check(scroll_w <= client_w + 1, f"no horizontal overflow ({scroll_w} <= {client_w})")

    if scroll_w > client_w + 1:
        culprits = page.evaluate(
            """() => [...document.querySelectorAll('body *')]
                 .filter(el => el.getBoundingClientRect().right >
                               document.documentElement.clientWidth + 1)
                 .slice(0, 5)
                 .map(el => el.tagName.toLowerCase() + '.' + el.className)"""
        )
        print(f"        widest elements: {culprits}")

    hamburger_shown = page.locator("#navToggle").is_visible()
    expected = width < HAMBURGER_BREAKPOINT
    check(hamburger_shown == expected,
          f"hamburger {'shown' if expected else 'hidden'}")

    if expected:
        page.locator("#navToggle").click()
        check(page.locator("#navset").is_visible(), "menu opens on tap")
        check(page.locator("#navToggle").get_attribute("aria-expanded") == "true",
              "aria-expanded tracks the menu")
        page.locator("#navToggle").click()

    # Sections must never collapse to nothing: a CSS mistake that hides one is
    # invisible in a screenshot of the top of the page.
    for section in ("work", "demos", "architecture", "experience"):
        box = page.locator(f"#{section}").bounding_box()
        check(bool(box) and box["height"] > 200, f"#{section} has height")


def check_links(page) -> None:
    print("\nlinks")
    page.set_viewport_size({"width": 1440, "height": 900})
    serve_with_api(page, "")
    page.goto(BASE, wait_until="networkidle")

    anchors = page.eval_on_selector_all(
        "a[href^='#']", "els => els.map(e => e.getAttribute('href'))"
    )
    for href in sorted(set(anchors)):
        target = href.lstrip("#")
        found = page.evaluate("id => !!document.getElementById(id)", target)
        check(found, f"anchor {href} resolves")

    local = page.eval_on_selector_all(
        "a[href]:not([href^='#']):not([href^='http']):not([href^='mailto'])",
        "els => els.map(e => e.getAttribute('href'))",
    )
    for href in sorted(set(local)):
        resp = page.request.get(f"{BASE}/{href.lstrip('/')}")
        check(resp.ok, f"{href} is served ({resp.status})")

    # Off-site links are not fetched (their servers are not this repo's problem),
    # but a typo in a hostname is, and that is visible without a request.
    external = page.eval_on_selector_all(
        "a[href^='http']", "els => els.map(e => e.getAttribute('href'))"
    )
    for href in sorted(set(external)):
        host = urlparse(href).netloc
        check(bool(host) and "." in host, f"external link parses: {href}")


def serve_with_api(page, value: str) -> None:
    """Serve index.html with data-api rewritten to `value`.

    Patching the attribute in the served HTML rather than with an init script,
    because script.js is a module and would otherwise race whatever set it.
    """
    def handler(route):
        body = pathlib.Path("index.html").read_text()
        body = re.sub(r'<body data-api="[^"]*">', f'<body data-api="{value}">', body, count=1)
        route.fulfill(status=200, content_type="text/html; charset=utf-8", body=body)

    # Registering twice on one page would stack handlers, so clear first.
    page.unroute(f"{BASE}/")
    page.route(f"{BASE}/", handler)


def check_tools(page) -> None:
    print("\ntools")
    page.set_viewport_size({"width": 1440, "height": 900})

    # Force the saved-answer path. The deployed Worker is in data-api, and
    # localhost:8000 is in its CORS allowlist, so without this every run of this
    # file would spend a dozen real model calls out of the shared daily budget
    # and take a minute doing it. What this group is checking is the page's
    # plumbing, which does not need a live model. The live and out-of-budget
    # labels are checked separately, against a stub, in check_backend_paths.
    serve_with_api(page, "")
    page.goto(BASE, wait_until="networkidle")

    for tool, label in (
        ("review", "Review this code"),
        ("specs", "Write the scenarios"),
        ("heal", "Repair the locator"),
    ):
        page.locator(f".demo-tab[data-demo='{tool}']").click()
        panel = page.locator(f".demo-panel[data-demo='{tool}']")
        check(panel.is_visible(), f"{tool} panel shows when its tab is clicked")

        page.locator(f".demo-run[data-demo='{tool}']").click()
        out = page.locator(f"#{tool}-output")
        out.locator(".stamp, .notice-warn").first.wait_for(timeout=15_000)

        check(out.locator(".stamp").count() == 1,
              f"{tool} labels where the answer came from")
        check(page.locator(f".demo-run[data-demo='{tool}']").inner_text() == label,
              f"{tool} button text is restored after the run")

    # Empty input must not reach a network call at all.
    page.locator(".demo-tab[data-demo='specs']").click()
    page.locator("#specs-input").fill("")
    page.locator(".demo-run[data-demo='specs']").click()
    check("Put something in the box" in page.locator("#specs-output").inner_text(),
          "empty input is refused before any call")

    # A key that Groq will reject must produce a readable message, not a silent
    # failure and not a saved answer passed off as live.
    page.locator("#specs-input").fill("A user resets their password by email.")
    page.locator("details.keyrow").evaluate("el => el.open = true")
    page.locator("#demo-key").fill("gsk_definitely_not_a_real_key")
    check(page.locator("#demo-mode").inner_text() == "your key, answers live",
          "mode line reacts to a key being typed")

    page.locator(".demo-run[data-demo='specs']").click()
    warn = page.locator("#specs-output .notice-warn")
    warn.wait_for(timeout=20_000)
    check("Groq" in warn.inner_text(), "a rejected key explains itself")


def check_backend_paths(browser) -> None:
    """The Worker is not deployed from here, so it is stood in for.

    What is being checked is the page's half of the contract: that whatever
    `meta.source` comes back, the visitor is told the truth about it. A saved
    answer presented as live would be the single worst bug this page could have,
    and it is the one no amount of clicking around would reveal.
    """
    print("\nbackend paths")
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    import json as _json
    sample = _json.loads(pathlib.Path("samples/specs.json").read_text())

    def health(shared_key: bool):
        return lambda route: route.fulfill(
            status=200, content_type="application/json",
            body=_json.dumps({"status": "ok", "shared_key": shared_key,
                              "model": "openai/gpt-oss-120b",
                              "runs_remaining_today": 400,
                              "runs_per_visitor_per_day": 12}),
        )

    def specs(meta):
        return lambda route: route.fulfill(
            status=200, content_type="application/json",
            body=_json.dumps({"result": sample, "meta": meta}),
        )

    page.route("**/api/health", health(True))
    page.route("**/api/specs", specs({"source": "live", "key": "shared",
                                      "model": "openai/gpt-oss-120b"}))

    # Point the page at a host that does not exist, so every backend call is
    # answered by the stubs below rather than by the deployed Worker.
    serve_with_api(page, "https://worker.test")
    page.goto(BASE, wait_until="networkidle")

    check(page.locator("#demo-mode").inner_text() == "shared key, answers live",
          "mode line reports the shared key once the backend answers")

    page.locator(".demo-tab[data-demo='specs']").click()
    page.locator(".demo-run[data-demo='specs']").click()
    page.locator("#specs-output .stamp").wait_for(timeout=15_000)
    stamp = page.locator("#specs-output .stamp")
    check("on my key" in stamp.inner_text(), "a shared-key answer says it ran on my key")
    check("stamp-live" in (stamp.get_attribute("class") or ""),
          "a live answer is styled as live")

    page.route("**/api/specs", specs({"source": "cached", "reason": "daily_budget"}))
    page.locator(".demo-run[data-demo='specs']").click()
    page.wait_for_timeout(1200)
    stamp = page.locator("#specs-output .stamp")
    check("budget is spent" in stamp.inner_text(),
          "an out-of-budget answer says why it is saved")
    check("stamp-saved" in (stamp.get_attribute("class") or ""),
          "a saved answer is never styled as live")

    page.unroute("**/api/specs")
    page.route("**/api/specs", lambda route: route.abort())
    page.locator(".demo-run[data-demo='specs']").click()
    page.wait_for_timeout(1500)
    check("saved answer" in page.locator("#specs-output .stamp").inner_text().lower(),
          "a backend that dies mid-session falls back to a saved answer")

    context.close()


def check_no_js(browser) -> None:
    print("\njavascript disabled")
    context = browser.new_context(java_script_enabled=False)
    page = context.new_page()
    page.goto(BASE, wait_until="load")

    text = page.locator("main").inner_text()
    check(len(text) > 5000, f"page still readable without JS ({len(text)} chars)")
    for section in ("work", "demos", "architecture", "experience"):
        check(page.locator(f"#{section}").is_visible(), f"#{section} visible without JS")
    context.close()


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        for width, height in VIEWPORTS:
            check_layout(page, width, height)

        check_links(page)
        check_tools(page)
        check_backend_paths(browser)

        print("\nconsole")
        check(not errors, f"no uncaught JavaScript errors ({errors[:2]})")

        check_no_js(browser)
        browser.close()

    print(f"\n{checks - len(failures)}/{checks} passed")
    if failures:
        print("\nfailed:")
        for f in failures:
            print(f"  {f}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
