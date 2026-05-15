# vizstack

Point it at a Remix or Next.js app. Get a single HTML file showing your routes, database, AI providers, and external APIs as an interactive dependency map.

```bash
node parse.js ./your-app viz.html
open viz.html
```

No install. No server. No dependencies. Double-click the output in Finder or open it in any browser.

---

## What it detects

- **Routes** — every file-based route with loader / action / UI badges, auth gates, and trigger type (⚡ user, 📨 webhook, ↺ polled, ⏰ scheduled)
- **Database** — Prisma schema tables with field types and relations; raw SQL collapses to a single node
- **AI providers** — OpenAI, Anthropic, Google AI, Vercel AI SDK
- **External services** — Stripe, Shopify, Resend, Slack, and any other named SDK import
- **Shared services** — utility modules imported by 3+ routes, separated from one-off components

Hover any node to highlight its connections and open a detail panel. Edges are colour-coded: reads (blue), writes (orange), AI calls (green), triggers (yellow), external (grey).

## Frameworks

- Remix
- Next.js App Router

## Limitations

- Prisma gives full table schemas with field types. Raw SQL drivers (pg, mysql2, better-sqlite3) collapse to a single DB node.
- Monorepos: point it at the app subdirectory, not the root (`apps/web`, not `.`)
- Trigger detection is heuristic — `/api/cron/*` → scheduled, `/webhook*` → inbound event, `/api/*status*` → polled

## Examples

| App | Routes | DB tables | AI | External |
|---|---|---|---|---|
| [Epic Stack](https://github.com/epicweb-dev/epic-stack) | 23 | 3 | 0 | 0 |
| [Taxonomy](https://github.com/shadcn-ui/taxonomy) | 28 | 2 | 0 | 1 |
| [Inbox Zero](https://github.com/elie222/inbox-zero) | 253 | 49 | 4 | 6 |

## Architecture chat (optional add-on)

`chat-template.html` is a standalone example showing how to wire your graph data directly into an LLM chat panel — so you can ask questions about your own architecture and get answers that are grounded in the actual dependency map, not generic knowledge.

**How it works:** `NODE_DATA` and `EDGES` are already in the page as JS objects. When a message is sent, those objects are serialised into a Claude system prompt. The model has the full graph as context before it sees your first question. Pin a node to inject its connections as focused context.

**To use it:**
1. Replace the example `NODE_DATA` and `EDGES` in `chat-template.html` with your own architecture.
2. Deploy one of the proxies in `proxy-example/` — your API key lives there, never in the browser.
3. Set `PROXY_ENDPOINT` at the top of the file to your deployed URL.
4. Open it in a browser.

Two proxy options are included:
- `proxy-example/lambda.mjs` — AWS Lambda + API Gateway. ~$0 at personal-tool scale.
- `proxy-example/worker.js` — Cloudflare Worker. Free tier covers 100k requests/day.

Both check the request origin server-side and support an optional shared secret (`x-proxy-secret`) to block scripted callers.

## License

MIT
