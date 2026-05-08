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

## License

MIT
