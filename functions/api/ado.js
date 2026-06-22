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
  // ADO returns "success-looking" responses for invalid PATs in three ways
  // that all defeat a naive `r.ok` check:
  //   (a) 302/303 redirect to login.microsoftonline.com — fetch follows by
  //       default and the login page returns 200 OK HTML
  //   (b) 203 Non-Authoritative with an HTML sign-in body (still a 2xx)
  //   (c) 200 OK with the X-VSS-AuthorizationEndpoint header set, asking
  //       the caller to authenticate
  // The cheapest reliable check that covers all three: refuse to follow
  // redirects, then verify the response is JSON whose body has the
  // {value:[...]} shape that `_apis/projects` always returns on real auth.
  if (action === 'test_connection') {
    const org = bodyOrg || '';
    if (!org) return respond({ error: 'Organisation name required' }, 400);
    try {
      const r = await fetch(`https://dev.azure.com/${encodeURIComponent(org)}/_apis/projects?api-version=7.1&$top=1`, {
        headers:  { 'Authorization': authHeader, 'Accept': 'application/json' },
        redirect: 'manual',
      });

      const isRedirect = r.status >= 300 && r.status < 400;
      const wantsAuth  = !!r.headers.get('X-VSS-AuthorizationEndpoint');
      if (r.status === 401 || r.status === 403 || r.status === 203 || isRedirect || wantsAuth) {
        return respond({
          error: 'PAT invalid or expired. Renew in ADO → User Settings → Personal Access Tokens.'
        }, 401);
      }
      if (!r.ok) {
        return respond({ error: 'HTTP ' + r.status }, r.status);
      }

      // 200 OK reached. Now confirm the body actually looks like ADO's project
      // list — a followed redirect to MSA's login page is also "200 OK".
      const ct = r.headers.get('Content-Type') || '';
      if (!/application\/json/i.test(ct)) {
        return respond({
          error: 'PAT invalid (ADO returned non-JSON response — likely a sign-in page).'
        }, 401);
      }
      const data = await r.json().catch(() => null);
      if (!data || !Array.isArray(data.value)) {
        return respond({
          error: 'PAT invalid (ADO response missing the expected project list shape).'
        }, 401);
      }
      return respond({ success: true });
    } catch(e) {
      return respond({ error: 'Network error: ' + e.message }, 500);
    }
  }


  // ── Action: fetch_workitem ────────────────────────────────────
  // Fetches an ADO Work Item by numeric ID and returns structured
  // fields for auto-filling the Business Flow textarea.
  if (action === 'fetch_workitem') {
    const workItemId = body.workItemId;
    if (!workItemId || !/^[0-9]+$/.test(String(workItemId))) {
      return respond({ error: 'Invalid Work Item ID — must be a number (e.g. 1234)' }, 400);
    }
    const org  = body.org  || '';
    const proj = body.proj || '';
    if (!org) return respond({ error: 'ADO organisation URL required' }, 400);

    // Normalise org URL — strip trailing slash
    const orgUrl = org.replace(/\/$/, '');

    // Fields to fetch — covers all standard + common custom fields
    const fields = [
      'System.Id',
      'System.Title',
      'System.Description',
      'System.WorkItemType',
      'System.State',
      'System.IterationPath',
      'System.Tags',
      'Microsoft.VSTS.Common.Priority',
      'Microsoft.VSTS.Common.AcceptanceCriteria',
      'Microsoft.VSTS.Scheduling.StoryPoints',
      'System.AssignedTo',
    ].join(',');

    const apiUrl = `${orgUrl}/_apis/wit/workitems/${workItemId}?fields=${encodeURIComponent(fields)}&api-version=7.1`;

    try {
      const r = await fetch(apiUrl, {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
      });

      if (r.status === 401) return respond({ error: 'PAT invalid or expired. Renew in ADO → User Settings → Personal Access Tokens.' }, 401);
      if (r.status === 404) return respond({ error: `Work Item #${workItemId} not found or no access` }, 404);
      if (!r.ok)            return respond({ error: `ADO API error: HTTP ${r.status}` }, r.status);

      const data   = await r.json();
      const f      = data.fields || {};

      // Strip HTML tags from description and acceptance criteria (ADO uses HTML)
      const stripHtml = (html) => {
        if (!html) return '';
        return html
          .replace(/<\/?(p|br|div|li|h[1-6])[^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      };

      return respond({
        id:                 workItemId,
        title:              f['System.Title']            || '',
        description:        stripHtml(f['System.Description']).substring(0, 2000),
        acceptanceCriteria: stripHtml(f['Microsoft.VSTS.Common.AcceptanceCriteria']).substring(0, 1000),
        type:               f['System.WorkItemType']     || '',
        state:              f['System.State']            || '',
        priority:           f['Microsoft.VSTS.Common.Priority'] ? 'P' + f['Microsoft.VSTS.Common.Priority'] : '',
        iterationPath:      f['System.IterationPath']    || '',
        tags:               f['System.Tags']             || '',
        storyPoints:        f['Microsoft.VSTS.Scheduling.StoryPoints'] || null,
        assignedTo:         f['System.AssignedTo']?.displayName || '',
      });

    } catch(e) {
      return respond({ error: 'Proxy fetch failed: ' + e.message }, 500);
    }
  }


  // ── Action: fetch_workitem ────────────────────────────────────
  // Fetches an ADO Work Item by numeric ID.
  // Returns structured fields for auto-filling the flowDesc textarea.
  if (action === 'fetch_workitem') {
    const workItemId = body.workItemId;
    if (!workItemId || !/^[0-9]+$/.test(String(workItemId))) {
      return respond({ error: 'Invalid Work Item ID \u2014 must be a number (e.g. 1234)' }, 400);
    }
    const org = (body.org || '').replace(/\/$/, '');
    if (!org) return respond({ error: 'ADO organisation URL required' }, 400);

    const fields = [
      'System.Id','System.Title','System.Description',
      'System.WorkItemType','System.State','System.IterationPath',
      'System.Tags','Microsoft.VSTS.Common.Priority',
      'Microsoft.VSTS.Common.AcceptanceCriteria',
      'Microsoft.VSTS.Scheduling.StoryPoints','System.AssignedTo',
    ].join(',');

    const apiUrl = `${org}/_apis/wit/workitems/${workItemId}?fields=${encodeURIComponent(fields)}&api-version=7.1`;

    try {
      const r = await fetch(apiUrl, {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
      });
      if (r.status === 401) return respond({ error: 'PAT invalid or expired. Renew in ADO \u2192 User Settings \u2192 Personal Access Tokens.' }, 401);
      if (r.status === 404) return respond({ error: `Work Item #${workItemId} not found or no access` }, 404);
      if (!r.ok)            return respond({ error: `ADO API error: HTTP ${r.status}` }, r.status);

      const data = await r.json();
      const f    = data.fields || {};

      const stripHtml = (html) => {
        if (!html) return '';
        return html
          .replace(/<\/(p|br|div|li|h[1-6])[^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n')
          .trim();
      };

      return respond({
        id:                 workItemId,
        title:              f['System.Title']                             || '',
        description:        stripHtml(f['System.Description']).substring(0, 2000),
        acceptanceCriteria: stripHtml(f['Microsoft.VSTS.Common.AcceptanceCriteria']).substring(0, 1000),
        type:               f['System.WorkItemType']                      || '',
        state:              f['System.State']                             || '',
        priority:           f['Microsoft.VSTS.Common.Priority'] ? 'P' + f['Microsoft.VSTS.Common.Priority'] : '',
        iterationPath:      f['System.IterationPath']                     || '',
        tags:               f['System.Tags']                              || '',
        storyPoints:        f['Microsoft.VSTS.Scheduling.StoryPoints']    || null,
        assignedTo:         f['System.AssignedTo']?.displayName           || '',
      });
    } catch(e) {
      return respond({ error: 'Proxy fetch failed: ' + e.message }, 500);
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
