/**
 * api/billing.js — Google Cloud Billing API Proxy
 *
 * Accepts a short-lived Google OAuth2 access token from the browser
 * (obtained via Google Identity Services on the client) and proxies
 * calls to the Cloud Billing API — keeping the token server-side
 * during the request so it is never logged or persisted.
 *
 * Actions:
 *   list_accounts   — list billing accounts the token can see
 *   get_account     — get details for a specific billing account
 *   list_projects   — list projects linked to a billing account
 *   get_budgets     — list budgets for a billing account
 *
 * The Google OAuth Client ID used on the frontend is read from the
 * GOOGLE_CLIENT_ID environment variable and exposed via /api/status.
 *
 * RUNTIME: Node.js Serverless — consistent with api/claude.js.
 */

const BILLING_BASE  = 'https://cloudbilling.googleapis.com/v1';
const BILLING_V1B   = 'https://cloudbilling.googleapis.com/v1beta';
const BUDGET_BASE   = 'https://billingbudgets.googleapis.com/v1';

export default async function handler(req) {
  const origin  = req.headers.get('origin') || '';
  const allowed = origin.includes('localhost') || origin.includes('vercel.app') ||
                  origin.includes('pages.dev') || origin.includes('workers.dev') || origin === '';

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

  // Validate access token — must be a non-empty string
  if (!accessToken || typeof accessToken !== 'string' || accessToken.length < 10) {
    return respond({
      error: 'Missing or invalid access token. Re-connect your Google account in Settings → Usage & Cost.'
    }, 401);
  }

  const authHeaders = {
    'Authorization': `Bearer ${accessToken}`,
    'Accept':        'application/json',
    'Content-Type':  'application/json',
  };

  // ── Helper: proxy a GET to the Google API ────────────────────
  async function gcpGet(url) {
    try {
      const r    = await fetch(url, { headers: authHeaders });
      const text = await r.text().catch(() => '{}');
      let   data = {};
      try { data = JSON.parse(text); } catch(e) { data = { raw: text }; }

      if (r.status === 401) {
        return { _error: true, status: 401, message: 'Google token expired. Click "Reconnect" to refresh.' };
      }
      if (r.status === 403) {
        return {
          _error: true, status: 403,
          message: 'Billing access denied. Ensure your Google account has Billing Account Viewer role in Google Cloud Console.',
        };
      }
      if (!r.ok) {
        return { _error: true, status: r.status, message: data?.error?.message || `HTTP ${r.status}` };
      }
      return data;
    } catch(e) {
      return { _error: true, status: 500, message: `Network error: ${e.message}` };
    }
  }

  // ── Action: list_accounts ─────────────────────────────────────
  if (action === 'list_accounts') {
    const data = await gcpGet(`${BILLING_BASE}/billingAccounts?pageSize=20`);
    if (data._error) return respond({ error: data.message }, data.status);
    return respond({
      accounts: (data.billingAccounts || []).map(a => ({
        id:          a.name?.replace('billingAccounts/', '') || '',
        displayName: a.displayName || 'Unnamed Account',
        open:        a.open ?? true,
        masterBillingAccount: a.masterBillingAccount || null,
      }))
    });
  }

  // ── Action: get_account ───────────────────────────────────────
  if (action === 'get_account') {
    if (!billingAccountId) return respond({ error: 'billingAccountId required' }, 400);
    const safe = billingAccountId.replace(/[^A-Z0-9\-]/gi, '');
    const data = await gcpGet(`${BILLING_BASE}/billingAccounts/${safe}`);
    if (data._error) return respond({ error: data.message }, data.status);
    return respond({
      id:          data.name?.replace('billingAccounts/', '') || safe,
      displayName: data.displayName || 'Unnamed Account',
      open:        data.open ?? true,
    });
  }

  // ── Action: list_projects ─────────────────────────────────────
  if (action === 'list_projects') {
    if (!billingAccountId) return respond({ error: 'billingAccountId required' }, 400);
    const safe = billingAccountId.replace(/[^A-Z0-9\-]/gi, '');
    const data = await gcpGet(`${BILLING_BASE}/billingAccounts/${safe}/projects?pageSize=10`);
    if (data._error) return respond({ error: data.message }, data.status);
    return respond({
      projects: (data.projectBillingInfo || []).map(p => ({
        projectId:         p.projectId || '',
        displayName:       p.name?.replace(/^projects\/[^/]+\/billingInfo$/, '') || p.projectId || '',
        billingEnabled:    p.billingEnabled ?? false,
        billingAccountId:  p.billingAccountName?.replace('billingAccounts/', '') || safe,
      }))
    });
  }

  // ── Action: get_budgets ───────────────────────────────────────
  if (action === 'get_budgets') {
    if (!billingAccountId) return respond({ error: 'billingAccountId required' }, 400);
    const safe = billingAccountId.replace(/[^A-Z0-9\-]/gi, '');
    const data = await gcpGet(`${BUDGET_BASE}/billingAccounts/${safe}/budgets?pageSize=10`);
    if (data._error) {
      // Budgets API may not be enabled — return empty array gracefully, not an error
      return respond({ budgets: [], note: data.message });
    }
    return respond({
      budgets: (data.budgets || []).map(b => ({
        name:         b.displayName || b.name || 'Budget',
        amount:       b.amount?.specifiedAmount?.units
                      ? parseFloat(b.amount.specifiedAmount.units) + (b.amount.specifiedAmount.nanos || 0) / 1e9
                      : null,
        currency:     b.amount?.specifiedAmount?.currencyCode || 'USD',
        thresholds:   (b.thresholdRules || []).map(t => t.thresholdPercent),
        spendBasis:   b.budgetFilter?.spendBasis || 'CURRENT_SPEND',
      }))
    });
  }

  // ── Action: get_spending ──────────────────────────────────────
  // Calls the v1beta spending information endpoint.
  // Returns all 4 cost fields shown in Google Cloud Console:
  //   cost (gross), savings, totalCost (net), forecasted.
  if (action === 'get_spending') {
    if (!billingAccountId) return respond({ error: 'billingAccountId required' }, 400);
    const safe = billingAccountId.replace(/[^A-Z0-9\-]/gi, '');
    const data  = await gcpGet(`${BILLING_V1B}/billingAccounts/${safe}:getSpendingInformation`);
    if (data._error) return respond({ spending: null, note: data.message });

    // Helper: extract numeric INR/USD value from a Google Money object
    // Handles multiple field naming conventions across v1beta versions
    function extractMoney(obj) {
      if (!obj) return null;
      const money = obj.spendingAmount || obj.amount || obj.cost || obj.totalSpend || null;
      if (!money) return null;
      return parseFloat(money.units || '0') + (money.nanos || 0) / 1e9;
    }

    // Root of spend data — try all known wrapper names Google may use
    const root = data.spendingInfo || data.currentMonthSpending || data;

    const currency = (
      root.spendingAmount?.currencyCode ||
      root.amount?.currencyCode         ||
      root.cost?.currencyCode           ||
      'INR'
    );
    const symbol = currency === 'INR' ? '\u20b9' : (currency === 'USD' ? '$' : currency + ' ');

    // Extract all 4 values — null if field absent in this API version
    const cost      = extractMoney(root);
    const savings   = extractMoney(root.savings || root.discount || null);
    const totalCost = extractMoney(
      root.totalSpend || root.totalCost || root.netCost || root.netSpend || null
    ) ?? (cost !== null && savings !== null ? cost - savings : cost);
    const forecasted = extractMoney(
      root.forecastedSpend || root.forecastedCost || root.forecastedTotal || null
    );

    return respond({
      spending: {
        cost,        // gross spend before savings/discounts
        savings,     // discounts / credits applied (null if none)
        totalCost,   // net amount actually charged  (cost - savings)
        forecasted,  // predicted spend for rest of month (null if unavailable)
        currency,
        symbol,
      },
      raw: data,     // raw response for debugging unknown API structures
    });
  }

  return respond({ error: `Unknown action: ${action}` }, 400);
}
