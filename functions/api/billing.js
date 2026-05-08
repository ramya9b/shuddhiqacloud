/**
 * functions/api/billing.js — Google Cloud Billing API Proxy (Cloudflare Pages)
 *
 * Cloudflare Pages onRequest adapter wrapping the same billing logic
 * as api/billing.js (Vercel). Keeps all behaviour identical.
 */

const BILLING_BASE = 'https://cloudbilling.googleapis.com/v1';
const BILLING_V1B  = 'https://cloudbilling.googleapis.com/v1beta';
const BUDGET_BASE  = 'https://billingbudgets.googleapis.com/v1';
const BUDGET_V1B1  = 'https://billingbudgets.googleapis.com/v1beta1';

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

  // ── Action: get_spending ──────────────────────────────────────────
  // Tries 4 endpoints using only cloud-billing.readonly scope (no warning).
  if (action === 'get_spending') {
    if (!billingAccountId) return respond({ error: 'billingAccountId required' }, 400);
    const safe = billingAccountId.replace(/[^A-Z0-9\-]/gi, '');

    function extractMoney(obj) {
      if (obj === null || obj === undefined) return null;
      if (typeof obj === 'number') return obj;
      if (typeof obj === 'string') { const n = parseFloat(obj); return isNaN(n) ? null : n; }
      const units = obj.units !== undefined ? parseFloat(obj.units || '0') : null;
      if (units !== null) return units + (obj.nanos || 0) / 1e9;
      return null;
    }

    function unwrapSpend(node) {
      if (!node) return null;
      const moneyField = node.spendingAmount || node.currentSpend || node.amount ||
                         node.cost || node.totalSpend || null;
      if (!moneyField) return null;
      const val = extractMoney(moneyField);
      return val !== null ? { val, currency: moneyField.currencyCode || 'INR' } : null;
    }

    let found = null; let savings = null; let total = null; let forecast = null;
    const diag = [];

    // Attempt 1: v1beta getSpendingInformation
    const a1 = await gcpGet(`${BILLING_V1B}/billingAccounts/${safe}:getSpendingInformation`);
    diag.push({ a: 1, ok: !a1._error, keys: a1._error ? a1.message : Object.keys(a1).join(',') });
    if (!a1._error) {
      const root = a1.spendingInfo || a1.currentMonthSpending || a1;
      found    = unwrapSpend(root) || null;
      savings  = extractMoney(root.savings   || root.discount    || null);
      total    = extractMoney(root.totalSpend || root.totalCost  || null);
      forecast = extractMoney(root.forecastedSpend || root.forecastedCost || null);
    }

    // Attempt 2: Budget API v1 currentSpend
    if (!found) {
      const a2 = await gcpGet(`${BUDGET_BASE}/billingAccounts/${safe}/budgets?pageSize=20`);
      diag.push({ a: 2, ok: !a2._error, count: a2.budgets?.length || 0,
                  sample: a2.budgets?.[0] ? Object.keys(a2.budgets[0]).join(',') : null });
      if (!a2._error && a2.budgets) {
        for (const b of a2.budgets) {
          const cs = b.currentSpend || b.spendingAmount || b.usedAmount || null;
          if (cs) { const v = unwrapSpend({ spendingAmount: cs }); if (v) { found = v; break; } }
        }
      }
    }

    // Attempt 3: Budget API v1beta1
    if (!found) {
      const a3 = await gcpGet(`${BUDGET_V1B1}/billingAccounts/${safe}/budgets?pageSize=20`);
      diag.push({ a: 3, ok: !a3._error, count: a3.budgets?.length || 0,
                  sample: a3.budgets?.[0] ? Object.keys(a3.budgets[0]).join(',') : null });
      if (!a3._error && a3.budgets) {
        for (const b of a3.budgets) {
          const cs = b.currentSpend || b.spendingAmount || b.usedAmount || b.currentPeriodSpend || null;
          if (cs) { const v = unwrapSpend({ spendingAmount: cs }); if (v) { found = v; break; } }
        }
      }
    }

    // Attempt 4: v1beta billingAccount details
    if (!found) {
      const a4 = await gcpGet(`${BILLING_V1B}/billingAccounts/${safe}`);
      diag.push({ a: 4, ok: !a4._error, keys: a4._error ? a4.message : Object.keys(a4).join(',') });
      if (!a4._error) {
        const root = a4.spendingInfo || a4.currentMonthSpending || null;
        if (root) found = unwrapSpend(root);
      }
    }

    if (!found) return respond({ spending: null, diagnostics: diag,
      note: 'Spending data not returned by any billing API endpoint for this account.' });

    const currency  = found.currency || 'INR';
    const symbol    = currency === 'INR' ? '\u20b9' : (currency === 'USD' ? '$' : currency + ' ');
    const totalCost = total ?? (found.val !== null && savings !== null ? found.val - savings : found.val);

    return respond({
      spending: { cost: found.val, savings, totalCost, forecasted: forecast, currency, symbol },
      diagnostics: diag,
    });
  }

  return respond({ error: `Unknown action: ${action}` }, 400);
}
