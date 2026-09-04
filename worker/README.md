# worker

The thing that lets somebody click **Review this code** on the portfolio and get
a real answer without signing up for anything first.

## Why it exists

The three tools on the page call a model. A model call needs a key, and the page
is static and public, so a key written into `script.js` is a key anyone can read
in devtools. Free Groq keys get scraped and abused fast enough that this is not a
theoretical objection.

So the key sits here instead, as a Cloudflare Worker secret. The page sends the
input to the Worker, the Worker adds the key and calls Groq, and the answer comes
back. The key is never in anything the browser can see.

Cloudflare's free plan covers this comfortably: 100,000 requests a day, no card
required. The demo will run out of *Groq* budget long before it troubles
Cloudflare.

## What happens when the budget runs out

Nothing breaks, and nothing lies about it.

| Situation | Answer | Labelled as |
|---|---|---|
| Visitor pasted their own key | Live, on their key, budget skipped entirely | `live`, key `byok` |
| Shared key, budget available | Live, on my key | `live`, key `shared` |
| More than six requests in a minute | A saved answer | `cached`, reason `too_fast` |
| One visitor has run twelve today | A saved answer | `cached`, reason `visitor_daily` |
| Shared key, daily ceiling hit | A saved answer from a real earlier run | `cached`, reason `daily_budget` |
| Groq is down or rate limiting | A saved answer | `cached`, reason `provider_busy` / `provider_error` |
| No secret set on the Worker at all | A saved answer | `cached`, reason `no_shared_key` |

Every one of those is a `200` with a `meta.source` the page reads and prints
above the answer. A recruiter who clicks a demo should never be shown a stack
trace, and should never be shown a saved answer dressed up as a live one either.

The ceilings are in `src/index.js` near the top: 400 shared runs a day across
everyone, 12 a day per visitor, and 6 a minute from one address. Groq's free tier
allows 1,000 a day, so there is deliberate headroom and the demo degrades before
the provider does.

### Why there are two mechanisms

The per-minute limit is a rate limiting binding; the daily ones are KV counters.
That is not belt and braces, it is because KV alone does not work for this.

KV reads can be up to 60 seconds stale. During a fast burst every request reads
the same number and all of them pass. Measured against the deployment rather than
assumed: thirteen calls in a row from one address all went straight through a
12-per-day cap. The cap was providing the appearance of protection.

The rate limiting binding is strongly consistent and evaluated immediately, so it
is what actually stops someone hammering the endpoint, and it is checked first.
KV stays as the daily ceiling, where being a minute behind is irrelevant. Under a
20-request concurrent burst the deployment now answers 6 `too_fast`, several
`visitor_daily`, one `provider_busy` from Groq itself, and the rest live, with
every single one returning a readable answer rather than an error.

## Deploying it

You need a Cloudflare account. Free, no card.

```bash
cd worker
npm install
npx wrangler login          # opens a browser once
npx wrangler deploy
```

That prints a URL. Mine is `https://priya-ai-tools.priya123z.workers.dev`, and on a
first deploy wrangler offers to register the `workers.dev` subdomain for you.

Now give it the key. **This is the only place the key goes.** Not in the repo,
not in the page, not in a `.env` file that might get committed:

```bash
npx wrangler secret put GROQ_API_KEY
# paste the key at the prompt; it is not echoed and not written to disk
```

Get a free one at [console.groq.com/keys](https://console.groq.com/keys) if you
do not have it to hand.

Then point the page at it: in `index.html`, the opening `<body>` tag carries the
address.

```html
<body data-api="https://priya-ai-tools.priya123z.workers.dev">
```

Blank that attribute and the page falls back to saved answers, which is exactly
what it did before this Worker existed. Nothing on the page depends on the Worker
being up.

### Recreating the counters on a fresh account

`wrangler.toml` already carries a namespace id. On a different account, make your
own and replace it:

```bash
npx wrangler kv namespace create BUDGET
```

Free KV allows 1,000 writes a day. Each budgeted run costs two, and the ceiling
is 400 runs, so the counters cannot themselves run out before the budget does.

The rate limiting binding needs nothing created; `namespace_id` in
`wrangler.toml` is just an integer you pick to keep one limiter distinct from
another in the same Worker.

## Checking it

```bash
curl https://priya-ai-tools.priya123z.workers.dev/api/health
```

```json
{
  "status": "ok",
  "shared_key": true,
  "model": "openai/gpt-oss-120b",
  "runs_remaining_today": 394,
  "runs_per_visitor_per_day": 12,
  "burst_limited": true
}
```

`runs_remaining_today: null` means no KV namespace is bound and nothing is
counting the daily total. `burst_limited: false` means the rate limiter is not
bound either, which is the one worth noticing, because that is the limit doing
the real work.

`shared_key: false` means the secret did not get set, and every visitor is
getting saved answers. That is the one failure worth watching for, because the
page keeps working and so nothing else tells you.

A real call:

```bash
curl -X POST https://priya-ai-tools.priya123z.workers.dev/api/review \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://priya123z.github.io' \
  -d '{"code":"def mean(xs):\n    return sum(xs) / len(xs)\n"}'
```

The `Origin` header matters. `ALLOWED_ORIGINS` in `src/index.js` lists the pages
allowed to call this, and anything else gets a response with no CORS header,
which a browser will refuse. It is not authentication and is not pretending to
be; it stops the shared budget being spent by somebody else's site.

Watching it live while you poke at the page:

```bash
npx wrangler tail
```

## Running it locally

```bash
npx wrangler dev            # serves on http://localhost:8787
```

`wrangler dev` reads a `.dev.vars` file for secrets. Create one (it is
gitignored) with:

```
GROQ_API_KEY=gsk_your_key_here
```

Then serve the site from the repository root on port 8000, which is already in
`ALLOWED_ORIGINS`, and point the page at the local Worker:

```html
<body data-api="http://localhost:8787">
```

## Layout

```
worker/
  src/index.js     routing, budgeting, the Groq call, the fallbacks
  wrangler.toml    name, entry point, the KV and rate limiter bindings
  package.json     wrangler, and nothing else
```

The prompts are not in here. They are in `../prompts.js`, imported by both this
Worker and the browser, so that an answer is identical whichever path produced
it. The saved fallbacks are `../samples/*.json`: three for the portfolio's own tools
and one for the ai-testcase-generator demo, and they are the same files the pages
fetch directly when there is no backend configured at all.
