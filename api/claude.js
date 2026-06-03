/**
 * functions/api/claude.js — Multi-Provider AI Proxy (Cloudflare Pages Function)
 *
 * Cloudflare Pages Functions use the onRequest export format.
 * The handler receives a Cloudflare context object { request, env }.
 * env contains the environment variables set in Cloudflare Pages dashboard.
 *
 * Supported providers: Claude, Gemini, Groq, OpenAI, Together AI (v9.52)
 */

// ── Model mapping per provider ──────────────────────────────────
// ── Gemini 2.5 Flash model chain (current stable GA model) ──
// Older 1.x and 2.x models are deprecated for new accounts.
// Preview models still use v1beta API endpoint.
const MODELS = {
  claude:      'claude-sonnet-4-6',
  claudeHaiku: 'claude-haiku-4-5-20251001',  // v9.56: 5× cheaper, good for standard TC gen
  // Gemini model chain (May 2026):
  // PRIMARY:      gemini-2.5-flash (GA, best quality, thinkingBudget:0 required)
  // FALLBACK 1:   gemini-2.0-flash (stable GA, no thinking, widely available)
  // FALLBACK 2:   gemini-1.5-flash (oldest stable, guaranteed available for any key)
  gemini:      'gemini-2.5-flash',    // PRIMARY
  geminiLite:  'gemini-2.0-flash',    // FALLBACK 1: stable, no thinking issues
  geminiFlash: 'gemini-1.5-flash',    // FALLBACK 2: oldest stable, always available
  groq:        'llama-3.3-70b-versatile',
  // ── v9.49: OpenAI ──────────────────────────────────────────────
  openai:      'gpt-4o-mini',         // Best cost/quality for test case generation
  // ── v9.49: Together AI ─────────────────────────────────────────
  together:    'meta-llama/Llama-3.3-70B-Instruct-Turbo',  // Primary
  togetherDS:  'deepseek-ai/DeepSeek-V3',                   // DeepSeek via Together (US-hosted)
};

const GEMINI_API_VERSION = {
  'gemini-2.5-flash': 'v1beta',
  'gemini-2.0-flash': 'v1beta',
  'gemini-1.5-flash': 'v1beta',
};

const GEMINI_MODEL_CHAIN = [
  MODELS.gemini,
  MODELS.geminiLite,
  MODELS.geminiFlash,
];

// ── Resolve which provider + key to use ────────────────────────
// env = Cloudflare Pages env object (context.env) — replaces process.env
function resolveProvider(requestedProvider, env, userKeys) {
  const e  = env || {};
  const uk = userKeys || {};

  // ── Option 2: Groq-only server keys ──────────────────────────
  // Server-side CLAUDE_API_KEY and GEMINI_API_KEY are NOT used for
  // free-tier users to prevent unlimited cost exposure at scale.
  // Only GROQ_API_KEY (free tier) is available as a server fallback.
  // Users who want Claude or Gemini must supply their own API key.
  // This caps server cost at $0 regardless of user count.
  const SERVER_KEYS = {
    groq: e.GROQ_API_KEY,      // free — always available as fallback
    // claude: intentionally omitted — user must supply own key
    // gemini: intentionally omitted — user must supply own key
  };

  const preferred = (requestedProvider || e.AI_PROVIDER || '').toLowerCase();

  // If user supplied their own key for the requested provider — use it (any provider)
  if (preferred && uk[preferred]) {
    return { provider: preferred, key: uk[preferred], userSupplied: true };
  }

  // If user supplied any key — try it (any provider)
  for (const p of ['claude', 'gemini', 'openai', 'together', 'groq']) {
    if (uk[p]) return { provider: p, key: uk[p], userSupplied: true };
  }

  // No user key — fall back to server Groq only (free, safe)
  if (SERVER_KEYS.groq) return { provider: 'groq', key: SERVER_KEYS.groq, userSupplied: false };

  return null;
}

// ── P3 Vision helpers ───────────────────────────────────────────
function _toGeminiParts(content) {
  if (typeof content === 'string') return [{ text: content }];
  if (Array.isArray(content)) {
    return content.map(block => {
      if (block.type === 'image' && block.source?.type === 'base64') {
        return { inlineData: { mimeType: block.source.media_type, data: block.source.data } };
      }
      return { text: block.text || '' };
    });
  }
  return [{ text: String(content || '') }];
}

function _toGroqText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const textParts = content.filter(b => b.type === 'text').map(b => b.text || '');
    if (content.some(b => b.type === 'image')) {
      textParts.push('[Note: A vision image was attached but Groq/Llama does not support image input. Switch to Claude or Gemini for screenshot-based test generation.]');
    }
    return textParts.join('\n');
  }
  return String(content || '');
}

// ── Option B — Output normaliser ────────────────────────────────
function _normaliseProviderOutput(text) {
  if (!text) return text;
  if (/\|\s*Title\s*\|\s*Step Action\s*\|\s*Step Expected Result\s*\|\s*Assigned To\s*\|\s*State\s*\|/i.test(text)) {
    return text.replace(/\bTC(\d{1,2})(?=\s|[–\-]|$)/gm, (_, n) => 'TC' + n.padStart(3, '0'));
  }
  text = text.replace(/\bTC(\d{1,2})(?=\s|[–\-]|$)/gm, (_, n) => 'TC' + n.padStart(3, '0'));
  text = text.replace(
    /\|\s*(?:Test Case(?:\s+(?:Title|ID))?|TC Title|TC ID)\s*\|\s*(?:Test )?Steps?\s*\|\s*Expected(?:\s+(?:Outcomes?|Results?))?\s*\|\s*(?:Owner|Tester|Assigned(?:\s+To)?)\s*\|\s*(?:Status|Phase|State)\s*\|/gi,
    '| Title | Step Action | Step Expected Result | Assigned To | State |'
  );
  text = text.replace(
    /\|\s*(?:Title|Test Case)\s*\|\s*(?:Step )?Actions?\s*\|\s*(?:Step )?Expected(?:\s+Results?)?\s*\|(?!\s*Assigned)/gi,
    '| Title | Step Action | Step Expected Result | Assigned To | State |'
  );
  text = text.replace(/^\|(\s*[-:]+\s*\|){2,4}\s*$/gm, '| --- | --- | --- | --- | --- |');
  return text;
}

// ── Build upstream request per provider ────────────────────────
function buildUpstreamRequest(provider, key, body) {
  const { system, messages, max_tokens = 8192, stream = false } = body;
  const userMessage = messages?.[messages.length - 1]?.content || '';

  if (provider === 'claude') {
    // v9.56: claudeModel field lets frontend request Haiku vs Sonnet
    const claudeModel = body.claudeModel === 'haiku'
      ? MODELS.claudeHaiku   // Haiku: ~5× cheaper, good for standard TC generation
      : MODELS.claude;        // Sonnet: best quality (default)
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: claudeModel, max_tokens: Math.min(max_tokens, 32768), stream, system, messages }),
    };
  }

  if (provider === 'gemini') {
    // Use systemInstruction field (not a user turn) to avoid consecutive-user-turn 400
    // P3: _toGeminiParts handles both plain-string and multi-modal array content
    const contents = [];
    (messages || []).forEach(m => {
      contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: _toGeminiParts(m.content) });
    });

    // ── TDZ FIX: declare geminiModel FIRST — it must be available inside geminiBody below.
    // (Session 1 fix accidentally left geminiModel declared after geminiBody, causing
    //  ReferenceError: Cannot access 'geminiModel' before initialization → HTTP 500)
    const geminiModel = body.geminiModel || MODELS.gemini;
    const apiVersion  = GEMINI_API_VERSION[geminiModel] || 'v1beta';
    const endpoint    = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
    const separator   = stream ? '&' : '?';

    // ── REGRESSION FIX (2025-04): gemini-2.5-flash has thinking enabled by default.
    // Thinking tokens count toward maxOutputTokens, exhausting the 8192 budget before
    // any real test case output is generated → empty or 1-TC responses.
    // Fix: (a) disable thinking via thinkingBudget:0, (b) raise ceiling to 32768.
    const geminiBody = {
      contents,
      generationConfig: {
        maxOutputTokens: Math.min(max_tokens, 32768), // raised from 8192; 2.5-flash supports 65K
        temperature: 0.3,
        // Disable thinking for 2.5 models — thinking tokens eat the output budget.
        // thinkingBudget:0 is valid for gemini-2.5-*; non-thinking models ignore it safely.
        ...(geminiModel.includes('2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      },
    };
    // Add system instruction separately (supported in Gemini 1.5+)
    if (system) geminiBody.systemInstruction = { parts: [{ text: system }] };

    return {
      url: `https://generativelanguage.googleapis.com/${apiVersion}/models/${geminiModel}:${endpoint}${separator}key=${key}`,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody),
    };
  }

  if (provider === 'groq') {
    const _GROQ_FORMAT_PREPEND =
`CRITICAL OUTPUT FORMAT — FOLLOW EXACTLY. NO EXCEPTIONS.
Use this 5-column Markdown table for EVERY test case:
| Title | Step Action | Step Expected Result | Assigned To | State |
|---|---|---|---|---|
| TC001 – Your Test Title | | | QA Engineer | Design |
| | Navigate to the page. | Page loads. Correct columns visible. | | |
| | Enter value in the required field. | Field accepts input. No error shown. | | |
RULE 1: Title row — Title column filled; Step Action and Step Expected Result BLANK.
RULE 2: Step rows — Step Action and Step Expected Result filled; Title, Assigned To, State BLANK.
RULE 3: TC numbers always 3 digits: TC001 TC002 TC010 TC011 — NEVER TC1 TC2 TC10.
RULE 4: Minimum 10 step rows per test case.
`;
    const groqMessages = [];
    groqMessages.push({ role: 'system', content: _GROQ_FORMAT_PREPEND + (system || '') });
    // P3: _toGroqText strips image blocks (llama-3.3-70b-versatile is text-only)
    (messages || []).forEach(m => groqMessages.push({ role: m.role, content: _toGroqText(m.content) }));
    return {
      url: 'https://api.groq.com/openai/v1/chat/completions',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: MODELS.groq,
        messages: groqMessages,
        // TOKEN CAP: llama-3.3-70b-versatile supports 32K output on Groq.
        // Frontend now sends up to 32768 for 'full' format runs.
        // Raise cap to 32768 so a full 18-TC / 7-section run is never truncated.
        max_tokens: Math.min(max_tokens, 32768), // raised from 16384
        temperature: 0.3,
        stream,
      }),
    };
  }

  // ── v9.49: OpenAI ──────────────────────────────────────────────
  if (provider === 'openai') {
    const _OA_FORMAT =
`CRITICAL OUTPUT FORMAT — FOLLOW EXACTLY. NO EXCEPTIONS.
Use this 5-column Markdown table for EVERY test case:
| Title | Step Action | Step Expected Result | Assigned To | State |
|---|---|---|---|---|
| TC001 – Your Test Title | | | QA Engineer | Design |
| | Navigate to the page. | Page loads. Correct columns visible. | | |
RULE 1: Title row — Title column filled; Step Action and Step Expected Result BLANK.
RULE 2: Step rows — Step Action and Step Expected Result filled; Title, Assigned To, State BLANK.
RULE 3: TC numbers always 3 digits: TC001 TC002 TC010 — NEVER TC1 TC2.
RULE 4: Minimum 10 step rows per test case.
`;
    const msgs = [];
    if (body.system) msgs.push({ role: 'system', content: _OA_FORMAT + (body.system || '') });
    (body.messages || []).forEach(m => msgs.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '')
    }));
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify({
        model:       MODELS.openai,
        messages:    msgs,
        // Match Claude/Gemini/Groq: honour the frontend budget (up to 16K for gpt-4o-mini)
        // gpt-4o-mini supports 16,384 output tokens; gpt-4o supports 16,384 too
        max_tokens:  Math.min(body.max_tokens || 16384, 16384),
        temperature: 0.3,
        stream:      stream,  // support streaming so generating panel works
      }),
    };
  }

  // ── v9.49: Together AI (OpenAI-compatible) ─────────────────────
  if (provider === 'together') {
    const _TA_FORMAT =
`CRITICAL OUTPUT FORMAT — FOLLOW EXACTLY. NO EXCEPTIONS.
Use ONE SINGLE 5-column Markdown table containing ALL test cases. Do NOT create a separate table per test case. Do NOT use ### or #### or any heading between test cases.

| Title | Step Action | Step Expected Result | Assigned To | State |
|---|---|---|---|---|
| TC001 – Your First Test Title | | | QA Engineer | Design |
| | Navigate to the page. | Page loads. Correct columns visible. | | |
| | Click Submit. | Confirmation banner appears. | | |
| TC002 – Your Second Test Title | | | QA Engineer | Design |
| | Open the form. | Form is displayed. | | |

RULE 1: Title row — Title column filled with TCxxx – name; Step Action and Step Expected Result BLANK.
RULE 2: Step rows — Step Action and Step Expected Result filled; Title, Assigned To, State BLANK.
RULE 3: TC numbers always 3 digits: TC001 TC002 TC010 — NEVER TC1 TC2.
RULE 4: Minimum 10 step rows per test case.
RULE 5: NO ### or #### markdown headings between test cases. ALL test cases share ONE table with ONE header row at the top.
RULE 6: The first row after the | --- | --- | separator must be a Title row (TCxxx – name). Step rows for that TC follow immediately after.
`;
    const msgs = [];
    if (body.system) msgs.push({ role: 'system', content: _TA_FORMAT + (body.system || '') });
    (body.messages || []).forEach(m => msgs.push({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '')
    }));
    return {
      url: 'https://api.together.xyz/v1/chat/completions',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + key,
      },
      body: JSON.stringify({
        model:       MODELS.togetherDS,
        messages:    msgs,
        // DeepSeek V3 on Together supports 16K output tokens
        // Honour frontend budget up to 16K so full TC sets are generated
        max_tokens:  Math.min(body.max_tokens || 16384, 16384),
        temperature: 0.3,
        stream:      stream,  // support streaming so generating panel works
      }),
    };
  }
}

// ── Extract output text from Gemini response (defensive: skip thought parts) ──
// gemini-2.5-flash with thinking enabled returns parts like:
//   [{thought:true, text:"..."}, {text:"actual output"}]
// parts[0].text would return the thought, not the test cases.
// This helper always returns the first non-thought part's text.
function getGeminiText(json) {
  const parts = json.candidates?.[0]?.content?.parts || [];
  if (!parts.length) return '';
  const outputPart = parts.find(p => !p.thought) || parts[0];
  return outputPart?.text || '';
}

// ── Normalise from parsed JSON (for model chain fallback) ────────
function normalizeFromJson(provider, json, model) {
  if (provider === 'gemini') {
    const text = getGeminiText(json); // REGRESSION FIX: use helper to skip thought parts
    return { content:[{ type:'text', text }], stop_reason:'end_turn', model: model || MODELS.gemini };
  }
  return json;
}

// ── Transform non-streaming response to Anthropic format ───────
async function normalizeResponse(provider, response) {
  const data = await response.json();

  if (provider === 'gemini') {
    const text = getGeminiText(data); // REGRESSION FIX: use helper to skip thought parts
    return { content: [{ type: 'text', text: _normaliseProviderOutput(text) }], stop_reason: 'end_turn', model: MODELS.gemini };
  }
  if (provider === 'groq') {
    const text = data.choices?.[0]?.message?.content || '';
    return { content: [{ type: 'text', text: _normaliseProviderOutput(text) }], stop_reason: 'stop', model: MODELS.groq };
  }
  // OpenAI + Together non-streaming: chat completions format
  if (provider === 'openai' || provider === 'together') {
    const text = data.choices?.[0]?.message?.content || '';
    return { content: [{ type: 'text', text: _normaliseProviderOutput(text) }], stop_reason: 'stop', model: MODELS[provider] || provider };
  }
  return data; // Claude already in correct format
}

// ── Transform streaming response to Anthropic SSE format ───────
function normalizeStream(provider, upstreamBody) {
  if (provider === 'claude') return upstreamBody; // already correct

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const transform = new TransformStream({
    buffer: '',
    transform(chunk, controller) {
      this.buffer += decoder.decode(chunk, { stream: true });
      const lines = this.buffer.split('\n');
      this.buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || line === 'data: [DONE]') continue;

        const dataLine = line.startsWith('data: ') ? line.slice(6) : line;
        try {
          const json = JSON.parse(dataLine);
          let text = '';

          if (provider === 'gemini') {
            // REGRESSION FIX: skip thought parts (thought:true) — only emit actual output text.
            // gemini-2.5-flash with thinking may produce thought chunks before output chunks.
            const parts = json.candidates?.[0]?.content?.parts || [];
            const outputPart = parts.find(p => !p.thought) || parts[0];
            text = outputPart?.text || '';
          } else if (provider === 'groq' || provider === 'openai' || provider === 'together') {
            // Handle both delta.content and direct content
            text = json.choices?.[0]?.delta?.content
                || json.choices?.[0]?.message?.content
                || '';
            // Skip empty deltas (e.g. finish_reason only)
            if (!text && json.choices?.[0]?.finish_reason) continue;
          }

          if (text) {
            // Emit in Anthropic streaming format
            const event = `event: content_block_delta\ndata: ${JSON.stringify({
              type: 'content_block_delta',
              delta: { type: 'text_delta', text }
            })}\n\n`;
            controller.enqueue(encoder.encode(event));
          }

          // Check for finish
          const isFinished = provider === 'gemini'
            ? json.candidates?.[0]?.finishReason
            : json.choices?.[0]?.finish_reason;

          if (isFinished) {
            // v4.0: Extract exact token counts and emit usage event
            let _usage = null;
            if (provider === 'gemini' && json.usageMetadata) {
              _usage = { input: json.usageMetadata.promptTokenCount||0, output: json.usageMetadata.candidatesTokenCount||0, provider: 'gemini' };
            } else if (provider === 'groq' && json.usage) {
              _usage = { input: json.usage.prompt_tokens||0, output: json.usage.completion_tokens||0, provider: 'groq' };
            }
            if (_usage) {
              controller.enqueue(encoder.encode(`event: usage\ndata: ${JSON.stringify(_usage)}\n\n`));
            }
            controller.enqueue(encoder.encode(
              `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`
            ));
          }
        } catch(e) { /* skip malformed lines */ }
      }
    },
    flush(controller) {
      controller.enqueue(encoder.encode(
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`
      ));
    }
  });

  upstreamBody.pipeThrough(transform);
  return transform.readable;
}

// ── Main handler ────────────────────────────────────────────────
export async function onRequest(context) {
  const { request: req, env } = context;
  // env = Cloudflare Pages environment variables (set in Pages dashboard)
  // process.env does NOT work reliably in Cloudflare Workers — use env directly
  const origin = req.headers.get('origin') || '';
  const allowed = origin.includes('localhost') || origin.includes('vercel.app') || origin.includes('pages.dev') || origin.includes('workers.dev') || origin === '';
  const corsHeaders = {
    'Access-Control-Allow-Origin':  allowed ? origin || '*' : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== 'POST')   return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

  // F-04 FIX (raised 5MB→10MB after 413 misdiagnosis bug): enforce 10MB body size cap before parsing.
  // Body size 10MB — protects against abuse while accommodating large enterprise FRDs
  // (100+ page PDFs typically extract to 2-4MB of text).
  // Cloudflare allows up to 100MB by default — this 10MB ceiling is a soft warning and a deliberate
  // safety margin against runaway/malicious payloads.
  // Was: 5_000_000 (too aggressive — rejected legitimate enterprise FRDs).
  const rawBody = await req.text().catch(() => '');
  if (rawBody.length > 10_000_000) {
    return new Response(JSON.stringify({
      error: 'Request body too large',
      detail: 'Body size ' + Math.round(rawBody.length / 1024) + 'KB exceeds 10MB limit'
    }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  let body;
  try { body = rawBody ? JSON.parse(rawBody) : {}; }
  catch(e) { body = {}; }
  const { apiKey: userClaudeKey, geminiApiKey: userGeminiKey, groqApiKey: userGroqKey,
          openaiApiKey: userOpenAIKey, togetherApiKey: userTogetherKey,
          provider: requestedProvider, ...forwardBody } = body;

  const _userKeys = {
    ...(userClaudeKey   ? { claude:   userClaudeKey   } : {}),
    ...(userGeminiKey   ? { gemini:   userGeminiKey   } : {}),
    ...(userGroqKey     ? { groq:     userGroqKey     } : {}),
    ...(userOpenAIKey   ? { openai:   userOpenAIKey   } : {}),
    ...(userTogetherKey ? { together: userTogetherKey } : {}),
  };

  // Resolve provider + key (user keys override server env vars per-provider)
  let resolved = resolveProvider(requestedProvider, env, _userKeys);

  // Legacy fallback: user-supplied Claude key from older clients
  if (!resolved && userClaudeKey) resolved = { provider: 'claude', key: userClaudeKey, userSupplied: true };

  if (!resolved) {
    return new Response(JSON.stringify({
      error: 'No API key found. The free tier uses Groq (server key, always available). For Claude, Gemini, OpenAI, or Together AI, add your own key in Settings → AI Provider → Use Your Own Key.'
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { provider, key } = resolved;
  const upstream = buildUpstreamRequest(provider, key, forwardBody);

  try {
    let response = await fetch(upstream.url, {
      method: 'POST',
      headers: upstream.headers,
      body: upstream.body,
    });

    // ── v9.53: Together AI per-model fallback ────────────────────────
    // Together's DeepSeek V3 is the default Together model but periodically
    // 5xx's during model-level outages. If the upstream returned 502/503/504,
    // transparently retry once with Llama 3.3 70B Turbo (same key, same
    // endpoint, different model). Users see a successful generation instead
    // of a service-unavailable error.
    if (provider === 'together' && [502, 503, 504].includes(response.status)) {
      console.warn('[Together] DeepSeek V3 returned ' + response.status + ' — falling back to Llama 3.3 70B');
      try {
        const fallbackBody = JSON.parse(upstream.body);
        fallbackBody.model = 'meta-llama/Llama-3.3-70B-Instruct-Turbo';
        response = await fetch(upstream.url, {
          method: 'POST',
          headers: upstream.headers,
          body: JSON.stringify(fallbackBody),
        });
        if (response.ok) {
          console.info('[Together] Fallback to Llama 3.3 70B succeeded');
        }
      } catch (fbErr) {
        console.error('[Together] Fallback retry failed:', fbErr.message);
      }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let errJson = {};
      try { errJson = JSON.parse(errText); } catch(e) {}
      const detail = errJson?.error?.message || errJson?.message || errText.substring(0, 200);

      // Gemini model chain fallback — try each model in order on 404/quota errors
      // ── GEMINI ERROR HANDLER with full diagnostics ─────────────────
      // Logs actual status + error body so we can diagnose the real cause
      // Tries every model in GEMINI_MODEL_CHAIN before switching to Groq

      if (provider === 'gemini') {
        console.error('[Gemini Debug] Status:', response.status,
          '| Model:', upstream.url.match(/models\/([^:]+)/)?.[1] || MODELS.gemini,
          '| Error:', detail.substring(0, 200),
          '| URL:', upstream.url.replace(/key=[^&?]+/, 'key=REDACTED')
        );

        // BUG FIX 1: 403 / API_NOT_ENABLED — detect BEFORE model chain.
        if (response.status === 403) {
          const isApiNotEnabled = detail && (
            detail.includes('API_NOT_ENABLED') ||
            detail.includes('not been used') ||
            detail.includes('disabled') ||
            detail.includes('SERVICE_DISABLED')
          );
          if (isApiNotEnabled) {
            return new Response(JSON.stringify({
              error: 'Gemini API not enabled on this key\'s Google Cloud project. '
                + 'Fix: go to console.cloud.google.com → APIs → Enable "Generative Language API". '
                + 'OR get a fresh key from aistudio.google.com.',
              switchProvider: true,
              provider: 'gemini',
            }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
          return new Response(JSON.stringify({
            error: 'Gemini API key does not have permission (403). Check the key is valid and not restricted.',
            switchProvider: true,
            provider: 'gemini',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // BUG FIX 3: 401 — distinguish user-supplied vs server key.
        if (response.status === 401) {
          const isUserKey = !!(body.geminiApiKey);
          return new Response(JSON.stringify({
            error: isUserKey
              ? 'Your Gemini API key is invalid. Remove it in Settings → Use Your Own Key and get a fresh key from aistudio.google.com.'
              : 'Gemini API key invalid or expired — please verify your key at aistudio.google.com/apikey and try again.',
            switchProvider: true,
            provider: 'gemini',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // True rate limit — do NOT try model chain.
        const isTrueRateLimit = response.status === 429
          || (response.status === 400 && (detail.includes('quota') || detail.includes('RESOURCE_EXHAUSTED') || detail.includes('rate')));
        if (isTrueRateLimit) {
          const retryAfter = response.headers.get('retry-after') || '60';
          const waitSecs   = parseInt(retryAfter) || 60;
          console.warn('[Gemini] Rate limit / quota hit. Retry in ~' + waitSecs + 's');
          return new Response(JSON.stringify({
            error: 'Gemini free-tier rate limit reached (resets in ~' + waitSecs + 's) — switching to next provider',
            waitSecs,
            switchProvider: true,
            provider: 'gemini',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Model-not-found / server errors — try model chain.
        const shouldTryChain = response.status === 404
          || (response.status === 400 && !detail.includes('quota'))
          || response.status === 500;

        if (shouldTryChain) {
          for (const fallbackModel of GEMINI_MODEL_CHAIN.slice(1)) {
            const apiVer = GEMINI_API_VERSION[fallbackModel] || 'v1beta';
            const ep     = forwardBody.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
            const sep    = forwardBody.stream ? '&' : '?';
            const altUrl = `https://generativelanguage.googleapis.com/${apiVer}/models/${fallbackModel}:${ep}${sep}key=${key}`;

            let chainBody = upstream.body;
            if (!fallbackModel.includes('2.5')) {
              try {
                const parsed = JSON.parse(upstream.body);
                if (parsed.generationConfig?.thinkingConfig) {
                  delete parsed.generationConfig.thinkingConfig;
                }
                chainBody = JSON.stringify(parsed);
              } catch(e) {}
            }

            console.log('[Gemini] Chain trying:', fallbackModel, '(' + apiVer + ')');
            const altResp = await fetch(altUrl, { method: 'POST', headers: upstream.headers, body: chainBody });
            const altText = await altResp.text().catch(() => '');
            console.log('[Gemini] Chain result:', fallbackModel, '\u2192 HTTP', altResp.status, altText.substring(0, 150));
            if (altResp.ok) {
              if (forwardBody.stream !== true) {
                let altJson = {};
                try { altJson = JSON.parse(altText); } catch(e) {}
                const text = getGeminiText(altJson);
                return new Response(JSON.stringify({
                  content: [{ type: 'text', text }],
                  stop_reason: 'end_turn',
                  model: fallbackModel,
                  _provider: fallbackModel
                }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
              }
              // BUG FIX 2: Use chainBody (not upstream.body) for streaming re-fetch.
              const streamResp = await fetch(altUrl, { method: 'POST', headers: upstream.headers, body: chainBody });
              return new Response(normalizeStream(provider, streamResp.body), {
                status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
              });
            }
          }
          // BUG FIX 4: Actionable error when all models fail.
          console.warn('[Gemini] All models exhausted. Switching to next provider.');
          const _geminiKeyType = body.geminiApiKey ? 'your personal key' : 'the deployment key';
          return new Response(JSON.stringify({
            error: 'Gemini: all available models failed using ' + _geminiKeyType + '. '
              + 'Causes: (1) GEMINI_API_KEY not set in Cloudflare Pages env vars. '
              + '(2) Generative Language API not enabled — console.cloud.google.com → APIs. '
              + '(3) All free-tier quotas exhausted — get a fresh key from aistudio.google.com.',
            detail: detail.substring(0, 200),
            switchProvider: true,
            provider: 'gemini',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Other non-retryable Gemini error
        return new Response(JSON.stringify({
          error: `Gemini error ${response.status}: ${detail.substring(0, 150)}`,
          switchProvider: true,
          provider: 'gemini',
        }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ── v9.52: OpenAI error handler ──────────────────────────────
      if (provider === 'openai') {
        console.error('[OpenAI] Status:', response.status, '| Error:', detail.substring(0,150));
        if (response.status === 401) {
          return new Response(JSON.stringify({
            error: 'Your OpenAI API key is invalid or expired. Check it at platform.openai.com/api-keys and update in Settings → AI Provider.',
            switchProvider: true, provider: 'openai',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (response.status === 403) {
          return new Response(JSON.stringify({
            error: 'OpenAI key does not have permission (403). Ensure your key has chat completions access and sufficient billing credit.',
            switchProvider: true, provider: 'openai',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after') || '60';
          const waitSecs   = parseInt(retryAfter) || 60;
          const isQuota = detail.includes('quota') || detail.includes('billing') || detail.includes('limit');
          return new Response(JSON.stringify({
            error: isQuota
              ? 'OpenAI quota exceeded — check your billing at platform.openai.com/usage. Switching provider.'
              : 'OpenAI rate limit hit — switching to next provider (retry in ' + waitSecs + 's).',
            waitSecs, switchProvider: true, provider: 'openai',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (response.status === 400) {
          return new Response(JSON.stringify({
            error: 'OpenAI bad request (400): ' + detail.substring(0,150) + '. Check your API key and model access.',
            switchProvider: true, provider: 'openai',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          error: 'OpenAI error ' + response.status + ': ' + detail.substring(0,150),
          switchProvider: true, provider: 'openai',
        }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ── v9.52: Together AI error handler ─────────────────────────
      if (provider === 'together') {
        console.error('[Together] Status:', response.status, '| Error:', detail.substring(0,150));
        if (response.status === 401) {
          return new Response(JSON.stringify({
            error: 'Your Together AI key is invalid or expired. Get a new key at api.together.xyz and update in Settings → AI Provider.',
            switchProvider: true, provider: 'together',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after') || '30';
          const waitSecs   = parseInt(retryAfter) || 30;
          return new Response(JSON.stringify({
            error: 'Together AI rate limit hit — switching to next provider (retry in ' + waitSecs + 's).',
            waitSecs, switchProvider: true, provider: 'together',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (response.status === 402) {
          return new Response(JSON.stringify({
            error: 'Together AI: Insufficient credits. Top up at api.together.xyz/settings/billing or switch to Groq (free).',
            switchProvider: true, provider: 'together',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        if (response.status === 400) {
          return new Response(JSON.stringify({
            error: 'Together AI bad request (400): ' + detail.substring(0,150) + '. The model may be unavailable.',
            switchProvider: true, provider: 'together',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          error: 'Together AI error ' + response.status + ': ' + detail.substring(0,150),
          switchProvider: true, provider: 'together',
        }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      let msg = `${provider} API error ${response.status}: ${detail || 'Unknown error'}`;
      if (response.status === 400) {
        // Detect Anthropic account usage cap — treat as switchable rate limit
        const isUsageCap = detail && (
          detail.includes('usage limits') ||
          detail.includes('regain access') ||
          detail.includes('API usage limits')
        );
        if (isUsageCap) {
          // Return 429 so the frontend auto-switches provider
          return new Response(JSON.stringify({
            error: 'claude limit reached until May 1 - auto-switching to Groq/Gemini',
            detail,
            switchProvider: true
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        msg = `${provider} 400 Bad Request: ${detail || 'Invalid payload'}`;
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') || response.headers.get('x-ratelimit-reset-requests');
        const waitSecs   = retryAfter ? parseInt(retryAfter) : 60;
        const isDailyLimit = !retryAfter && (
          detail.includes('exceeded') || detail.includes('daily') ||
          detail.includes('tokens per day') || detail.includes('quota')
        );
        if (isDailyLimit) {
          return new Response(JSON.stringify({
            error: provider + ' daily quota exhausted. The free-tier daily limit resets at midnight UTC. '
              + 'To continue now: add a GEMINI_API_KEY (free, aistudio.google.com) in Cloudflare Pages → Settings → Environment Variables.',
            waitSecs: 3600,
            dailyLimit: true,
            switchProvider: true
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({
          error: provider + ' rate limited — resets in ~' + waitSecs + 's',
          waitSecs,
          switchProvider: true
        }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (response.status === 413) {
        // Request too large - document exceeds the provider's context window.
        // If client requested a different provider but no key existed, resolveProvider()
        // fell back to Groq. Surfaces the mismatch in requestedProvider field.
        const _reqProv = requestedProvider || '';
        const _provMismatch = _reqProv && _reqProv !== provider
          ? ' (Note: requested ' + _reqProv + ' but no ' + _reqProv + ' key configured - server routed to ' + provider + ')'
          : '';
        console.warn('[' + provider + '] 413 Request too large' + _provMismatch);
        return new Response(JSON.stringify({
          error: provider + ' token limit exceeded (document too large).' + _provMismatch,
          switchProvider: true,
          provider,
          requestedProvider: _reqProv || provider
        }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (response.status === 401) msg = provider + ' API key invalid or expired - please verify your key at the provider\'s console and try again.';
      if (response.status === 404) {
        // Non-Gemini 404 (Gemini handled above in model chain)
        msg = `${provider} endpoint not found (404). Check model name and API version.`;
      }
      if (response.status === 403) {
        const isApiNotEnabled = detail && (detail.includes('API_NOT_ENABLED') || detail.includes('not been used') || detail.includes('disabled'));
        if (isApiNotEnabled) {
          // Treat as switchable — key exists but wrong Google Cloud project
          return new Response(JSON.stringify({
            error: `gemini API not enabled on this key's Google Cloud project. Go to console.cloud.google.com → APIs → Enable "Generative Language API". OR get a fresh key from aistudio.google.com.`,
            switchProvider: true
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        msg = `${provider} API key does not have permission (403): ${detail}`;
      }
      return new Response(JSON.stringify({ error: msg, detail }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const isStream = forwardBody.stream === true;

    if (isStream) {
      const streamBody = normalizeStream(provider, response.body);
      return new Response(streamBody, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
      });
    } else {
      const normalized = await normalizeResponse(provider, response);
      return new Response(JSON.stringify({ ...normalized, _provider: provider }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch(err) {
    return new Response(JSON.stringify({ error: 'Proxy error: ' + err.message + ' - Check Cloudflare Pages logs (Workers & Pages > shuddhiqacloud > Observability)' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}
