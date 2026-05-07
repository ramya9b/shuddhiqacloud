/**
 * functions/api/ado.js — Azure DevOps Proxy (Cloudflare Pages Function)
 *
 * Supports two PAT sources:
 *   1. Cloudflare env vars: DEVOPS_PAT or ADO_PAT (server-side, never exposed)
 *   2. Browser-supplied PAT in request body (from Settings → Azure DevOps)
 *
 * Actions proxied to ADO REST API:
 *   - GET/POST to dev.azure.com (test plans, work items, projects)
 *   - test_connection: verify org + PAT work
 */

export async function onRequest(context) {
  const { request: req, env } = context;

  const origin  = req.headers.get('origin') || '';
  const allowed = origin.includes('localhost') || origin.includes('pages.dev') ||
                  origin.includes('workers.dev') || origin === '';

  const corsHeaders = {
    'Access-Control-Allow-Origin':  allowed ? (origin || '*') : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  const respond = (data, status = 200) => new Response(
    JSON.stringify(data),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST')   return respond({ error: 'Method not allowed' }, 405);

  let body = {};
  try { body = await req.json(); } catch(e) { body = {}; }

  const { action, url, method: rawMethod = 'GET', body: reqBody,
          pat: bodyPAT, org: bodyOrg } = body;

  // Resolve PAT: env var first, then body (from localStorage)
  const pat = env.DEVOPS_PAT || env.ADO_PAT || bodyPAT || '';
  if (!pat) {
    return respond({
      error: 'ADO PAT not configured. Go to Settings → Azure DevOps and enter your PAT.'
    }, 400);
  }

  const authHeader = 'Basic ' + btoa(':' + pat);

  // ── test_connection action ────────────────────────────────────
  if (action === 'test_connection') {
    const org = bodyOrg || '';
    if (!org) return respond({ error: 'Organisation name required' }, 400);
    try {
      const r = await fetch(`https://dev.azure.com/${encodeURIComponent(org)}/_apis/projects?api-version=7.1&$top=1`, {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
      });
      if (r.ok) return respond({ success: true });
      if (r.status === 401) return respond({ error: 'PAT invalid or expired. Renew in ADO → User Settings → Personal Access Tokens.' }, 401);
      return respond({ error: 'HTTP ' + r.status }, r.status);
    } catch(e) {
      return respond({ error: 'Network error: ' + e.message }, 500);
    }
  }

  // ── Standard proxy ────────────────────────────────────────────
  const method = rawMethod || (reqBody != null ? 'POST' : 'GET');

  const ALLOWED = ['https://dev.azure.com/', 'https://vsrm.visualstudio.com/'];
  if (!url || !ALLOWED.some(d => url.startsWith(d))) {
    return respond({ error: 'URL not permitted. Only dev.azure.com is allowed.' }, 403);
  }

  const isWorkItemCreate = method === 'POST' && url.includes('/wit/workitems');
  const contentType = isWorkItemCreate ? 'application/json-patch+json' : 'application/json';

  try {
    const r = await fetch(url, {
      method,
      headers: {
        'Content-Type':  contentType,
        'Authorization': authHeader,
        'Accept':        'application/json',
      },
      body: reqBody != null ? JSON.stringify(reqBody) : undefined
    });

    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { data = { raw: text }; }

    if (r.status === 401) return respond({
      error: 'PAT invalid or expired. Renew in ADO → User Settings → Personal Access Tokens.'
    }, 401);
    if (!r.ok) return respond(
      { error: data?.message || data?.error || `HTTP ${r.status}`, ...data },
      r.status
    );

    return respond(data, r.status);
  } catch(e) {
    return respond({ error: 'Proxy fetch failed: ' + e.message }, 500);
  }
}
