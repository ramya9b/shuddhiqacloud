/**
 * functions/api/status.js — Environment key configuration check (Cloudflare Pages)
 * Uses context.env directly — process.env not available in Cloudflare Workers
 */

export async function onRequest(context) {
  const { request: req, env } = context;

  const origin  = req.headers.get('origin') || '';
  const allowed = origin.includes('localhost') || origin.includes('vercel.app')
                || origin.includes('pages.dev') || origin.includes('workers.dev')
                || origin === '';

  const preferred  = (env.AI_PROVIDER || '').toLowerCase();
  const hasGemini  = !!env.GEMINI_API_KEY;
  const hasGroq    = !!env.GROQ_API_KEY;
  const hasClaude  = !!env.CLAUDE_API_KEY;
  const activeProvider = preferred ||
    (hasClaude ? 'claude' : hasGemini ? 'gemini' : hasGroq ? 'groq' : 'none');

  return new Response(JSON.stringify({
    claudeKey:      hasClaude,
    geminiKey:      hasGemini,
    groqKey:        hasGroq,
    aiProvider:     activeProvider,
    jiraConfigured: !!(env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN),
    adoKey:         !!(env.DEVOPS_PAT || env.ADO_PAT),
    adoOrg:         env.DEVOPS_ORG  || env.ADO_ORG  || '',
    adoProject:     env.DEVOPS_PROJECT || env.ADO_PROJECT || '',
  }), {
    status: 200,
    headers: {
      'Content-Type':                'application/json',
      'Cache-Control':               'no-store',
      'Access-Control-Allow-Origin': allowed ? origin || '*' : '',
    },
  });
}
