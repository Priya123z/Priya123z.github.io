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
| Shared key, daily ceiling hit | A saved answer from a real earlier run | `cached`, reason `daily_budget` |
| One visitor has run twelve today | A saved answer | `cached`, reason `visitor_daily` |
| Groq is down or rate limiting | A saved answer | `cached`, reason `provider_busy` / `provider_error` |
| No secret set on the Worker at all | A saved answer | `cached`, reason `no_shared_key` |

Every one of those is a `200` with a `meta.source` the page reads and prints
above the answer. A recruiter who clicks a demo should never be shown a stack
trace, and should never be shown a saved answer dressed up as a live one either.

The ceilings are in `src/index.js` near the top: 400 shared runs a day across
everyone, 12 a day per visitor. Groq's free tier allows 1,000 a day, so there is
deliberate headroom, and the demo degrades before the provider does.

## Deploying it

You need a Cloudflare account. Free, no card.

```bash
cd worker
npm install
npx wrangler login          # opens a browser once
npx wrangler deploy
```

That prints a URL, something like
`https://priya-ai-tools.<your-subdomain>.workers.dev`.

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
<body data-api="https://priya-ai-tools.your-subdomain.workers.dev">
```

Leave it empty and the page falls back to saved answers, which is exactly what it
did before this Worker existed. Nothing on the page depends on the Worker being
up.

### Turning on the counters

Optional, and worth doing before the link goes anywhere public:

```bash
npx wrangler kv namespace create BUDGET
```

Uncomment the `[[kv_namespaces]]` block in `wrangler.toml`, paste in the id it
printed, and deploy again.

Free KV allows 1,000 writes a day. Each budgeted run costs two, and the ceiling
is 400 runs, so the counters cannot themselves run out before the budget does.

## Checking it

```bash
curl https://priya-ai-tools.your-subdomain.workers.dev/api/health
```

```json
{
  "status": "ok",
  "shared_key": true,
  "model": "openai/gpt-oss-120b",
  "runs_remaining_today": 400,
  "runs_per_visitor_per_day": 12
}
```

`shared_key: false` means the secret did not get set, and every visitor is
getting saved answers. That is the one failure worth watching for, because the
page keeps working and so nothing else tells you.

A real call:

```bash
curl -X POST https://priya-ai-tools.your-subdomain.workers.dev/api/review \
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
  wrangler.toml    name, entry point, the commented-out KV binding
  package.json     wrangler, and nothing else
```

The prompts are not in here. They are in `../prompts.js`, imported by both this
Worker and the browser, so that an answer is identical whichever path produced
it. The saved fallbacks are `../samples/*.json`, the same three files the page
fetches directly when there is no backend configured at all.
