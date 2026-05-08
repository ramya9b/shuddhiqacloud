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
const BUDGET_V1B1   = 'https://billingbudgets.googleapis.com/v1beta1';

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

  // ── Action: get_spending ──────────────────────────────────────────
  // Tries 4 endpoints using only cloud-billing.readonly scope (no warning).
  // billing.accounts.getSpendingInformation IS included in cloud-billing.readonly
  // for the user's own accounts. Budget v1beta1 may also expose currentSpend.
  if (action === 'get_spending') {
    if (!billingAccountId) return respond({ error: 'billingAccountId required' }, 400);
    const safe = billingAccountId.replace(/[^A-Z0-9\-]/gi, '');

    // ── Helpers ────────────────────────────────────────────────────
    // Parse any Google Money proto or plain number into a JS float
    function extractMoney(obj) {
      if (obj === null || obj === undefined) return null;
      if (typeof obj === 'number') return obj;
      if (typeof obj === 'string') { const n = parseFloat(obj); return isNaN(n) ? null : n; }
      // Google Money proto: { units, nanos, currencyCode }
      const units = obj.units !== undefined ? parseFloat(obj.units || '0') : null;
      if (units !== null) return units + (obj.nanos || 0) / 1e9;
      return null;
    }

    // Unwrap a spending node — tries all known field names Google may use
    function unwrapSpend(node) {
      if (!node) return null;
      const moneyField =
        node.spendingAmount   ||   // primary v1beta field
        node.currentSpend     ||   // budget API field
        node.amount           ||   // generic
        node.cost             ||   // generic
        node.totalSpend       ||   // alternate
        null;
      if (!moneyField) return null;
      const val = extractMoney(moneyField);
      return val !== null ? { val, currency: moneyField.currencyCode || 'INR' } : null;
    }

    let found   = null;   // { val, currency }
    let savings = null;
    let total   = null;
    let forecast= null;
    const diag  = [];     // diagnostic trail returned for debugging

    // ── Attempt 1: v1beta getSpendingInformation ───────────────────
    // billing.accounts.getSpendingInformation is included in
    // cloud-billing.readonly for the user's own billing account.
    const a1 = await gcpGet(
      `${BILLING_V1B}/billingAccounts/${safe}:getSpendingInformation`
    );
    diag.push({ a: 1, url: 'v1beta/getSpendingInformation',
                ok: !a1._error, keys: a1._error ? a1.message : Object.keys(a1).join(',') });
    if (!a1._error) {
      const root = a1.spendingInfo || a1.currentMonthSpending || a1;
      found    = unwrapSpend(root)     || unwrapSpend(root.spendingAmount ? { spendingAmount: root.spendingAmount } : null);
      savings  = unwrapSpend({ spendingAmount: root.savings  || root.discount      || null })?.val ?? null;
      total    = unwrapSpend({ spendingAmount: root.totalSpend || root.totalCost   || null })?.val ?? null;
      forecast = unwrapSpend({ spendingAmount: root.forecastedSpend || root.forecastedCost || null })?.val ?? null;
    }

    // ── Attempt 2: Budget API v1 — check budgets for currentSpend ──
    // Some account types include currentSpend in the budget object.
    if (!found) {
      const a2 = await gcpGet(`${BUDGET_BASE}/billingAccounts/${safe}/budgets?pageSize=20`);
      diag.push({ a: 2, url: 'budgets/v1', ok: !a2._error,
                  count: a2.budgets?.length || 0,
                  sample: a2.budgets?.[0] ? Object.keys(a2.budgets[0]).join(',') : null });
      if (!a2._error && a2.budgets) {
        for (const b of a2.budgets) {
          // Try direct currentSpend field
          const cs = b.currentSpend || b.spendingAmount || b.usedAmount || null;
          if (cs) {
            const v = unwrapSpend({ spendingAmount: cs });
            if (v) { found = v; break; }
          }
          // Try budget filter spent amount
          if (b.amount?.specifiedAmount && b.thresholdRules?.length) {
            // Cannot derive exact spend from threshold % without knowing actual spend
          }
        }
      }
    }

    // ── Attempt 3: Budget API v1beta1 — may have richer spend fields ──
    if (!found) {
      const a3 = await gcpGet(`${BUDGET_V1B1}/billingAccounts/${safe}/budgets?pageSize=20`);
      diag.push({ a: 3, url: 'budgets/v1beta1', ok: !a3._error,
                  count: a3.budgets?.length || 0,
                  sample: a3.budgets?.[0] ? Object.keys(a3.budgets[0]).join(',') : null });
      if (!a3._error && a3.budgets) {
        for (const b of a3.budgets) {
          const cs = b.currentSpend || b.spendingAmount || b.usedAmount
                  || b.currentPeriodSpend || null;
          if (cs) {
            const v = unwrapSpend({ spendingAmount: cs });
            if (v) { found = v; break; }
          }
        }
      }
    }

    // ── Attempt 4: v1beta billingAccount details ────────────────────
    if (!found) {
      const a4 = await gcpGet(`${BILLING_V1B}/billingAccounts/${safe}`);
      diag.push({ a: 4, url: 'v1beta/billingAccount', ok: !a4._error,
                  keys: a4._error ? a4.message : Object.keys(a4).join(',') });
      if (!a4._error) {
        const root = a4.spendingInfo || a4.currentMonthSpending || null;
        if (root) found = unwrapSpend(root);
      }
    }

    if (!found) {
      return respond({ spending: null, diagnostics: diag,
        note: 'Spending data not returned by any billing API endpoint for this account.' });
    }

    const currency = found.currency || 'INR';
    const symbol   = currency === 'INR' ? '\u20b9' : (currency === 'USD' ? '$' : currency + ' ');
    const totalCost = total ?? (found.val !== null && savings !== null ? found.val - savings : found.val);

    return respond({
      spending: {
        cost:       found.val,   // gross spend before savings
        savings:    savings,      // discounts / credits
        totalCost:  totalCost,    // net charged (cost − savings)
        forecasted: forecast,     // rest-of-month forecast
        currency,
        symbol,
      },
      diagnostics: diag,
    });
  }

  return respond({ error: `Unknown action: ${action}` }, 400);
}
