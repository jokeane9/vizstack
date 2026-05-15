/**
 * vizstack — Anthropic proxy (AWS Lambda + API Gateway HTTP API)
 *
 * WHAT THIS DOES
 * ──────────────
 * Forwards POST requests from chat-template.html to the Anthropic API.
 * Your API key lives here in a Lambda environment variable, never in
 * the browser.
 *
 * DEPLOY IN 5 STEPS
 * ─────────────────
 * 1. Create a Lambda function (Node 20.x, arm64 is cheapest).
 *    Runtime: Node.js. Handler: index.handler.
 *
 * 2. Zip this file as index.mjs and upload it (or paste inline).
 *
 * 3. Set environment variables on the Lambda:
 *      ANTHROPIC_API_KEY   your Anthropic API key
 *      ALLOWED_ORIGIN      the origin serving chat-template.html
 *                          e.g. https://yourdomain.com or http://localhost:8080
 *      PROXY_SECRET        optional shared secret — set the same value as
 *                          PROXY_SECRET in chat-template.html to block
 *                          casual scripted callers. Leave blank to skip.
 *
 * 4. Add an API Gateway HTTP API trigger:
 *      Route: POST /chat
 *      Also allow OPTIONS (CORS preflight) — API Gateway can handle this
 *      automatically if you enable CORS in the API settings.
 *
 * 5. Paste the invoke URL into chat-template.html:
 *      const PROXY_ENDPOINT = 'https://XXXX.execute-api.REGION.amazonaws.com/chat';
 *
 * COST
 * ────
 * Lambda: ~$0.0000002 per request (basically free at personal-tool scale).
 * API Gateway HTTP API: $1 per million requests.
 */

const cors = (origin) => ({
  'Access-Control-Allow-Origin':  origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-proxy-secret',
  'Access-Control-Max-Age':       '86400',
});

export const handler = async (event) => {
  const method = event.requestContext?.http?.method ?? 'POST';
  const origin = event.headers?.origin ?? '';

  const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '';
  const PROXY_SECRET   = process.env.PROXY_SECRET   ?? '';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: cors(ALLOWED_ORIGIN), body: '' };
  }

  // Block requests from unexpected origins
  if (origin !== ALLOWED_ORIGIN) {
    return {
      statusCode: 403,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: { message: 'Forbidden' } }),
    };
  }

  // Optional shared-secret check
  if (PROXY_SECRET) {
    const token = event.headers?.['x-proxy-secret'] ?? '';
    if (token !== PROXY_SECRET) {
      return {
        statusCode: 401,
        headers: { 'content-type': 'application/json', ...cors(ALLOWED_ORIGIN) },
        body: JSON.stringify({ error: { message: 'Unauthorized' } }),
      };
    }
  }

  try {
    const body = JSON.parse(event.body ?? '{}');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return {
      statusCode: res.status,
      headers: { 'content-type': 'application/json', ...cors(ALLOWED_ORIGIN) },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json', ...cors(ALLOWED_ORIGIN) },
      body: JSON.stringify({ error: { message: e.message } }),
    };
  }
};
