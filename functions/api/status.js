/**
 * functions/api/status.js — Environment key configuration check (Cloudflare Pages)
 * Uses context.env directly — process.env not available in Cloudflare Workers
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
    googleClientId: env.GOOGLE_CLIENT_ID || '',
  }), {
    status: 200,
    headers: {
      'Content-Type':                'application/json',
      'Cache-Control':               'no-store',
      'Vary':                        'Origin',
      'Access-Control-Allow-Origin':  allowed ? (origin || 'https://shuddhiqacloud.vercel.app') : 'https://shuddhiqacloud.vercel.app',
    },
  });
}
