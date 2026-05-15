/**
 * vizstack — Anthropic proxy (Cloudflare Worker)
 *
 * WHAT THIS DOES
 * ──────────────
 * Forwards POST requests from chat-template.html to the Anthropic API.
 * Your API key lives in a Worker secret, never in the browser.
 *
 * DEPLOY IN 4 STEPS
 * ─────────────────
 * 1. Install Wrangler: npm install -g wrangler
 *    Log in: wrangler login
 *
 * 2. Create wrangler.toml in this folder:
 *
 *      name = "vizstack-proxy"
 *      main = "worker.js"
 *      compatibility_date = "2025-01-01"
 *
 * 3. Set secrets:
 *      wrangler secret put ANTHROPIC_API_KEY
 *      wrangler secret put PROXY_SECRET       # optional, leave blank to skip
 *
 * 4. Deploy:
 *      wrangler deploy
 *
 *    Then paste the Worker URL into chat-template.html:
 *      const PROXY_ENDPOINT = 'https://vizstack-proxy.YOUR_SUBDOMAIN.workers.dev';
 *    And set ALLOWED_ORIGIN in the Worker env (wrangler.toml [vars] block)
 *    to match the origin serving your HTML file.
 *
 * COST
 * ────
 * Workers free tier: 100,000 requests/day. More than enough for a personal tool.
 */

const ALLOWED_ORIGIN = 'https://yourdomain.com'; // or http://localhost:8080 for local dev

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin':  origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-proxy-secret',
  'Access-Control-Max-Age':       '86400',
});

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(ALLOWED_ORIGIN) });
    }

    // Block unexpected origins
    if (request.method !== 'POST' || origin !== ALLOWED_ORIGIN) {
      return new Response('Forbidden', { status: 403 });
    }

    // Optional shared-secret check
    const secret = env.PROXY_SECRET ?? '';
    if (secret) {
      const token = request.headers.get('x-proxy-secret') ?? '';
      if (token !== secret) {
        return new Response(
          JSON.stringify({ error: { message: 'Unauthorized' } }),
          { status: 401, headers: { 'content-type': 'application/json', ...corsHeaders(ALLOWED_ORIGIN) } }
        );
      }
    }

    try {
      const body = await request.json();

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key':         env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      return new Response(JSON.stringify(data), {
        status: res.status,
        headers: { 'content-type': 'application/json', ...corsHeaders(ALLOWED_ORIGIN) },
      });
    } catch (e) {
      return new Response(
        JSON.stringify({ error: { message: e.message } }),
        { status: 500, headers: { 'content-type': 'application/json', ...corsHeaders(ALLOWED_ORIGIN) } }
      );
    }
  },
};
