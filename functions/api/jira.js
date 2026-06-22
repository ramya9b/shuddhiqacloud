/**
 * functions/api/jira.js — Jira REST API Proxy (Cloudflare Pages Function)
 *
 * Uses Cloudflare Pages onRequest format (NOT Vercel handler).
 * env = context.env — Cloudflare Pages environment variables.
 *
 * Supports two modes:
 *   1. Server-side credentials: set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
 *      in Cloudflare Pages → Settings → Environment Variables
 *   2. Browser-supplied credentials: sent in POST body (from Settings → Jira tab)
 *
 * Actions:
 *   fetch_ticket     — fetch a Jira ticket by ID
 *   test_connection  — verify credentials work
 */

export async function onRequest(context) {
  const { request: req, env } = context;

  const origin  = req.headers.get('origin') || '';
  const ALLOWED_ORIGINS = [
    'http://localhost', 'http://127.0.0.1',
    'https://shuddhiqacloud.vercel.app',
    'https://shuddhiqacloud.pages.dev',
  ];
  const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || origin.includes('localhost');

  const corsHeaders = {
    'Access-Control-Allow-Origin':  allowed ? (origin || 'https://shuddhiqacloud.vercel.app') : 'https://shuddhiqacloud.vercel.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST')   return new Response(
    JSON.stringify({ error: 'Method not allowed' }),
    { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

  let body = {};
  try { body = await req.json(); } catch(e) { body = {}; }

  const { action, ticketId, baseUrl: bodyBaseUrl, email: bodyEmail, token: bodyToken } = body;

  // Resolve credentials: body > env vars
  const jiraBaseUrl = (bodyBaseUrl || env.JIRA_BASE_URL || '').replace(/\/$/, '');
  const jiraEmail   = bodyEmail || env.JIRA_EMAIL   || '';
  const jiraToken   = bodyToken || env.JIRA_API_TOKEN || '';

  const respond = (data, status = 200) => new Response(
    JSON.stringify(data),
    { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );

  if (!jiraBaseUrl || !jiraEmail || !jiraToken) {
    return respond({
      error: 'Jira not configured. Enter credentials in Settings → Jira tab, or add JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in Cloudflare Pages → Settings → Environment Variables.'
    }, 400);
  }

  const auth    = btoa(`${jiraEmail}:${jiraToken}`);
  const headers = { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' };

  // ── Action: test_connection ────────────────────────────────────
  if (action === 'test_connection') {
    try {
      const resp = await fetch(`${jiraBaseUrl}/rest/api/3/myself`, { headers });
      if (resp.ok) {
        const data = await resp.json();
        return respond({ success: true, displayName: data.displayName || jiraEmail });
      }
      if (resp.status === 401) return respond({ error: 'Authentication failed — check email and API token' }, 401);
      return respond({ error: 'Jira API returned HTTP ' + resp.status }, resp.status);
    } catch(e) {
      return respond({ error: 'Network error: ' + e.message }, 500);
    }
  }

  // ── Action: fetch_ticket ───────────────────────────────────────
  if (!ticketId || !/^[A-Z][A-Z0-9]+-\d+$/.test(ticketId)) {
    return respond({ error: 'Invalid Jira ticket ID format (expected e.g. PROJ-1234)' }, 400);
  }

  try {
    const url  = `${jiraBaseUrl}/rest/api/3/issue/${encodeURIComponent(ticketId)}?fields=summary,description,issuetype,priority,labels,status,customfield_10016,customfield_10014`;
    const resp = await fetch(url, { headers });

    if (resp.status === 401) return respond({ error: 'Authentication failed — check email and API token' }, 401);
    if (resp.status === 404) return respond({ error: `Ticket ${ticketId} not found or no access` }, 404);
    if (!resp.ok)            return respond({ error: `Jira API error: HTTP ${resp.status}` }, resp.status);

    const data   = await resp.json();
    const fields = data.fields || {};

    const extractText = (node) => {
      if (!node) return '';
      if (typeof node === 'string') return node;
      if (node.type === 'text') return node.text || '';
      if (node.content) return node.content.map(extractText).join(node.type === 'paragraph' ? '\n' : ' ');
      return '';
    };

    let description = extractText(fields.description).trim();
    let acceptanceCriteria = '';
    const acMatch = description.match(/acceptance criteria[\s\S]*/i);
    if (acMatch) {
      acceptanceCriteria = acMatch[0].replace(/^acceptance criteria:?\s*/i, '').trim();
      description = description.replace(/acceptance criteria[\s\S]*/i, '').trim();
    }

    const sprintField = fields.customfield_10016;
    const sprintName  = Array.isArray(sprintField) && sprintField[0]?.name ? sprintField[0].name : null;

    return respond({
      id:                 data.key,
      summary:            fields.summary || '',
      description:        description.substring(0, 2000),
      acceptanceCriteria: acceptanceCriteria.substring(0, 1000),
      type:               fields.issuetype?.name || 'Story',
      priority:           fields.priority?.name  || 'Medium',
      status:             fields.status?.name    || '',
      labels:             fields.labels          || [],
      sprint:             sprintName             || '',
    });

  } catch(e) {
    return respond({ error: 'Proxy fetch failed: ' + e.message }, 500);
  }
}
