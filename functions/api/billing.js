/**
 * functions/api/billing.js — Google Cloud Billing API Proxy (Cloudflare Pages)
 *
 * Cloudflare Pages onRequest adapter wrapping the same billing logic
 * as api/billing.js (Vercel). Keeps all behaviour identical.
 */

const BILLING_BASE = 'https://cloudbilling.googleapis.com/v1';
const BUDGET_BASE  = 'https://billingbudgets.googleapis.com/v1';

export async function onRequest(context) {
  const { request: req } = context;

  const origin  = req.headers.get('origin') || '';
  const allowed = origin.includes('localhost') || origin.includes('pages.dev') ||
                  origin.includes('workers.dev') || origin === '';

  const corsHeaders = {
    'Access-Control-Allow-Origin':  allowed ? origin || '*' : '',
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

  const { action, accessToken, billingAccountId } = body;

  if (!accessToken || typeof accessToken !== 'string' || accessToken.length < 10) {
    return respond({ error: 'Missing or invalid access token.' }, 401);
  }

  const authHeaders = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept':        'application/json',
    'Content-Type':  'application/json',
  };

  async function gcpGet(url) {
    try {
      const r    = await fetch(url, { headers: authHeaders });
      const text = await r.text().catch(() => '{}');
      let   data = {};
      try { data = JSON.parse(text); } catch(e) { data = { raw: text }; }
      if (r.status === 401) return { _error: true, status: 401, message: 'Google token expired. Click "Reconnect" to refresh.' };
      if (r.status === 403) return { _error: true, status: 403, message: 'Billing access denied. Ensure Billing Account Viewer role.' };
      if (!r.ok)            return { _error: true, status: r.status, message: data?.error?.message || `HTTP ${r.status}` };
      return data;
    } catch(e) {
      return { _error: true, status: 500, message: `Network error: ${e.message}` };
    }
  }

  if (action === 'list_accounts') {
    const data = await gcpGet(`${BILLING_BASE}/billingAccounts?pageSize=20`);
    if (data._error) return respond({ error: data.message }, data.status);
    return respond({
      accounts: (data.billingAccounts || []).map(a => ({
        id:          a.name?.replace('billingAccounts/', '') || '',
        displayName: a.displayName || 'Unnamed Account',
        open:        a.open ?? true,
      }))
    });
  }

  if (action === 'get_account') {
    if (!billingAccountId) return respond({ error: 'billingAccountId required' }, 400);
    const safe = billingAccountId.replace(/[^A-Z0-9\-]/gi, '');
    const data = await gcpGet(`${BILLING_BASE}/billingAccounts/${safe}`);
    if (data._error) return respond({ error: data.message }, data.status);
    return respond({ id: data.name?.replace('billingAccounts/', '') || safe, displayName: data.displayName || '', open: data.open ?? true });
  }

  if (action === 'list_projects') {
    if (!billingAccountId) return respond({ error: 'billingAccountId required' }, 400);
    const safe = billingAccountId.replace(/[^A-Z0-9\-]/gi, '');
    const data = await gcpGet(`${BILLING_BASE}/billingAccounts/${safe}/projects?pageSize=10`);
    if (data._error) return respond({ error: data.message }, data.status);
    return respond({ projects: (data.projectBillingInfo || []).map(p => ({ projectId: p.projectId || '', billingEnabled: p.billingEnabled ?? false })) });
  }

  if (action === 'get_budgets') {
    if (!billingAccountId) return respond({ error: 'billingAccountId required' }, 400);
    const safe = billingAccountId.replace(/[^A-Z0-9\-]/gi, '');
    const data = await gcpGet(`${BUDGET_BASE}/billingAccounts/${safe}/budgets?pageSize=10`);
    if (data._error) return respond({ budgets: [], note: data.message });
    return respond({
      budgets: (data.budgets || []).map(b => ({
        name:     b.displayName || 'Budget',
        amount:   b.amount?.specifiedAmount?.units ? parseFloat(b.amount.specifiedAmount.units) : null,
        currency: b.amount?.specifiedAmount?.currencyCode || 'USD',
      }))
    });
  }

  return respond({ error: `Unknown action: ${action}` }, 400);
}
