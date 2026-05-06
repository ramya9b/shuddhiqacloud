/**
 * api/claude.js — Multi-Provider AI Proxy (Serverless Function)
 *
 * Supported providers (in order of priority):
 *   1. Claude   (Anthropic)  — CLAUDE_API_KEY
 *   2. Gemini   (Google)     — GEMINI_API_KEY
 *   3. Groq     (Meta/Llama) — GROQ_API_KEY
 *
 * Active provider is selected by AI_PROVIDER env var
 * (claude | gemini | groq). Falls back to whichever key exists.
 *
 * Frontend sends standard Anthropic message format.
 * This proxy translates to the target provider's format.
 *
 * RUNTIME: Node.js Serverless (NOT Edge).
 * Edge runtime has a hard 15s/30s wall-clock limit that cuts AI streams
 * after the Test Summary but before TC tables are generated.
 * Node.js runtime supports maxDuration:300 (set in vercel.json).
 * All Web APIs used (fetch, Response, TransformStream) work in Node.js 18+.
 */

// export const config = { runtime: 'edge' };  ← REMOVED: hard 15-30s timeout killed TC streams

// ── Model mapping per provider ──────────────────────────────────
// ── Gemini 2.5 Flash model chain (current stable GA model) ──
// Older 1.x and 2.x models are deprecated for new accounts.
// Preview models still use v1beta API endpoint.
const MODELS = {
  claude:      'claude-sonnet-4-6',
  // Gemini model chain (May 2026):
  // PRIMARY:      gemini-2.5-flash (GA, best quality, thinkingBudget:0 required)
  // FALLBACK 1:   gemini-2.0-flash (stable GA, no thinking, widely available)
  // FALLBACK 2:   gemini-1.5-flash (oldest stable, guaranteed available for any key)
  gemini:      'gemini-2.5-flash',    // PRIMARY
  geminiLite:  'gemini-2.0-flash',    // FALLBACK 1: stable, no thinking issues
  geminiFlash: 'gemini-1.5-flash',    // FALLBACK 2: oldest stable, always available
  groq:        'llama-3.3-70b-versatile',
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
// userKeys = { claude, gemini, groq } — keys supplied by the user from their browser.
// User keys take priority over server env vars for their respective provider,
// giving users unlimited generations against their own account limits.
function resolveProvider(requestedProvider, userKeys) {
  const uk = userKeys || {};
  const preferred = (requestedProvider || process.env.AI_PROVIDER || '').toLowerCase();
  const candidates = preferred
    // Option A: cost-optimised default — Groq (free) → Gemini (cheap) → Claude (paid last)
    ? [preferred, ...['groq', 'gemini', 'claude'].filter(p => p !== preferred)]
    : ['groq', 'gemini', 'claude'];

  for (const p of candidates) {
    // User-supplied key takes priority over the server env var for this provider
    const key = uk[p] || {
      claude: process.env.CLAUDE_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      groq:   process.env.GROQ_API_KEY,
    }[p];
    if (key) return { provider: p, key, userSupplied: !!uk[p] };
  }
  return null;
}

// ── P3 Vision helpers ───────────────────────────────────────────
// Convert an Anthropic-format content value (string OR array with image/text
// blocks) into the parts array that Gemini expects.
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

// Convert an Anthropic-format content value to a plain string for Groq.
// llama-3.3-70b-versatile does not support vision — strip image blocks and
// add a note so the user knows to switch provider for image analysis.
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
// Groq (llama-3.3-70b) and Gemini sometimes drift from the 5-column
// schema despite explicit prompt instructions. This normaliser fixes
// the most common drift patterns on non-streaming responses.
// Safe: returns text unchanged if it already looks correct.
function _normaliseProviderOutput(text) {
  if (!text) return text;

  // Already correct if canonical header is present — fast exit
  if (/\|\s*Title\s*\|\s*Step Action\s*\|\s*Step Expected Result\s*\|\s*Assigned To\s*\|\s*State\s*\|/i.test(text)) {
    // Still apply TC numbering fix (TC1 → TC001) even on otherwise-correct output
    return text.replace(/\bTC(\d{1,2})(?=\s|[–\-–]|$)/gm, (_, n) => 'TC' + n.padStart(3, '0'));
  }

  // Fix 1: TC number padding
  text = text.replace(/\bTC(\d{1,2})(?=\s|[–\-]|$)/gm, (_, n) => 'TC' + n.padStart(3, '0'));

  // Fix 2: Normalise wrong column header names → canonical 5-column
  text = text.replace(
    /\|\s*(?:Test Case(?:\s+(?:Title|ID))?|TC Title|TC ID)\s*\|\s*(?:Test )?Steps?\s*\|\s*Expected(?:\s+(?:Outcomes?|Results?))?\s*\|\s*(?:Owner|Tester|Assigned(?:\s+To)?)\s*\|\s*(?:Status|Phase|State)\s*\|/gi,
    '| Title | Step Action | Step Expected Result | Assigned To | State |'
  );

  // Fix 3: 3-column shorthand (Title|Steps|Expected) → 5-column
  text = text.replace(
    /\|\s*(?:Title|Test Case)\s*\|\s*(?:Step )?Actions?\s*\|\s*(?:Step )?Expected(?:\s+Results?)?\s*\|(?!\s*Assigned)/gi,
    '| Title | Step Action | Step Expected Result | Assigned To | State |'
  );

  // Fix 4: Separator rows with wrong cell count → 5-cell separator
  text = text.replace(
    /^\|(\s*[-:]+\s*\|){2,4}\s*$/gm,
    '| --- | --- | --- | --- | --- |'
  );

  return text;
}

// ── Build upstream request per provider ────────────────────────
function buildUpstreamRequest(provider, key, body) {
  const { system, messages, max_tokens = 8192, stream = false } = body;
  const userMessage = messages?.[messages.length - 1]?.content || '';

  if (provider === 'claude') {
    return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
      },
      // REGRESSION FIX: was Math.min(max_tokens, 8192) — this cap was never raised in earlier
      // sessions even though Groq and Gemini were. claude-sonnet-4-6 supports 64K output tokens.
      // 8192 tokens is only enough for the gap analysis + test summary + first table header row,
      // causing the "18 TCs in summary but empty E2E section" truncation shown in screenshot.
      body: JSON.stringify({ model: MODELS.claude, max_tokens: Math.min(max_tokens, 32768), stream, system, messages }),
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
    // ── Option B: prepend a compact, imperative format schema ─────────────
    // llama-3.3-70b drifts on complex table format despite system prompt instructions.
    // Prepending a SHORT, direct schema block (imperative language, concrete example)
    // at the very start of the system message significantly improves adherence.
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
    // Option B: apply normaliser to fix common Gemini column-header drift
    return { content: [{ type: 'text', text: _normaliseProviderOutput(text) }], stop_reason: 'end_turn', model: MODELS.gemini };
  }
  if (provider === 'groq') {
    const text = data.choices?.[0]?.message?.content || '';
    // Option B: apply normaliser to fix common Groq table-structure drift
    return { content: [{ type: 'text', text: _normaliseProviderOutput(text) }], stop_reason: 'stop', model: MODELS.groq };
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
          } else if (provider === 'groq') {
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
            // v3.7: Extract exact token counts from final chunk → emit usage event to frontend
            let _usage = null;
            if (provider === 'gemini' && json.usageMetadata) {
              _usage = { input: json.usageMetadata.promptTokenCount||0, output: json.usageMetadata.candidatesTokenCount||0, provider:'gemini' };
            } else if (provider === 'groq' && json.usage) {
              _usage = { input: json.usage.prompt_tokens||0, output: json.usage.completion_tokens||0, provider:'groq' };
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
export default async function handler(req) {
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
  // Cloudflare allows up to 100MB by default; Vercel caps at 4.5MB on serverless functions,
  // so this 10MB ceiling is a soft warning for Cloudflare and a hard limit on Vercel.
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
          provider: requestedProvider, ...forwardBody } = body;

  // Build user-supplied key map — non-empty strings only
  const _userKeys = {
    ...(userClaudeKey ? { claude: userClaudeKey } : {}),
    ...(userGeminiKey ? { gemini: userGeminiKey } : {}),
    ...(userGroqKey   ? { groq:   userGroqKey   } : {}),
  };

  // Resolve provider + key (user keys override server env vars per-provider)
  let resolved = resolveProvider(requestedProvider, _userKeys);

  // Legacy fallback: user-supplied Claude key from older clients (apiKey only)
  if (!resolved && userClaudeKey) resolved = { provider: 'claude', key: userClaudeKey, userSupplied: true };

  if (!resolved) {
    return new Response(JSON.stringify({
      error: 'No AI provider configured. Add CLAUDE_API_KEY, GEMINI_API_KEY, or GROQ_API_KEY to Vercel Environment Variables.'
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { provider, key } = resolved;
  const upstream = buildUpstreamRequest(provider, key, forwardBody);

  try {
    const response = await fetch(upstream.url, {
      method: 'POST',
      headers: upstream.headers,
      body: upstream.body,
    });

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

        // BUG FIX 1: API_NOT_ENABLED — detect BEFORE model chain.
        // Previously this check was outside the Gemini block so a 403 wasted
        // 2 chain attempts then returned vague "all models unavailable".
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
                + 'OR get a fresh key from aistudio.google.com (API enabled by default).',
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

        // BUG FIX 3: 401 — distinguish user-supplied vs server key for clarity.
        if (response.status === 401) {
          const isUserKey = !!(body.geminiApiKey);
          return new Response(JSON.stringify({
            error: isUserKey
              ? 'Your Gemini API key is invalid. Remove it in Settings → Use Your Own Key and get a fresh key from aistudio.google.com.'
              : 'Gemini API key invalid or expired — check GEMINI_API_KEY in Cloudflare Pages → Settings → Environment Variables.',
            switchProvider: true,
            provider: 'gemini',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // True rate limit or quota — do NOT try the model chain (waste quota).
        const isTrueRateLimit = response.status === 429
          || (response.status === 400 && (detail.includes('quota') || detail.includes('RESOURCE_EXHAUSTED') || detail.includes('rate')));
        if (isTrueRateLimit) {
          const retryAfter = response.headers.get('retry-after') || '60';
          const waitSecs   = parseInt(retryAfter) || 60;
          console.warn('[Gemini] Rate limit / quota hit — switching to next provider. Retry in ~' + waitSecs + 's');
          return new Response(JSON.stringify({
            error: 'Gemini free-tier rate limit reached (resets in ~' + waitSecs + 's) — switching to next provider',
            waitSecs,
            switchProvider: true,
            provider: 'gemini',
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Model-not-found / server errors — try the model chain
        const shouldTryChain = response.status === 404
          || (response.status === 400 && !detail.includes('quota'))
          || response.status === 500;

        if (shouldTryChain) {
          for (const fallbackModel of GEMINI_MODEL_CHAIN.slice(1)) {
            const apiVer = GEMINI_API_VERSION[fallbackModel] || 'v1beta';
            const ep     = forwardBody.stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
            const sep    = forwardBody.stream ? '&' : '?';
            const altUrl = `https://generativelanguage.googleapis.com/${apiVer}/models/${fallbackModel}:${ep}${sep}key=${key}`;

            // Always strip thinkingConfig for non-2.5 models (causes 400 on 2.0/1.5)
            let chainBody = upstream.body;
            if (!fallbackModel.includes('2.5')) {
              try {
                const parsed = JSON.parse(upstream.body);
                if (parsed.generationConfig?.thinkingConfig) {
                  delete parsed.generationConfig.thinkingConfig;
                }
                chainBody = JSON.stringify(parsed);
              } catch(e) { /* use original body if parse fails */ }
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
              // BUG FIX 2: Streaming re-fetch MUST use chainBody (thinkingConfig stripped),
              // NOT upstream.body — upstream.body causes 400 on gemini-2.0/1.5-flash.
              const streamResp = await fetch(altUrl, { method: 'POST', headers: upstream.headers, body: chainBody });
              return new Response(normalizeStream(provider, streamResp.body), {
                status: 200, headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
              });
            }
          }
          // BUG FIX 4: All models exhausted — actionable error message
          console.warn('[Gemini] All models exhausted. Switching to next provider.');
          const _geminiKeyType = body.geminiApiKey ? 'your personal key' : 'the deployment key';
          return new Response(JSON.stringify({
            error: 'Gemini: all available models failed using ' + _geminiKeyType + '. '
              + 'Causes: (1) GEMINI_API_KEY not set in Cloudflare Pages env vars. '
              + '(2) Generative Language API not enabled — console.cloud.google.com → APIs → Enable it. '
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
            error: `claude limit reached until May 1 — auto-switching to Groq/Gemini`,
            detail,
            switchProvider: true
          }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }
        msg = `${provider} 400 Bad Request: ${detail || 'Invalid payload'}`;
      }
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after') || response.headers.get('x-ratelimit-reset-requests');
        const waitSecs   = retryAfter ? parseInt(retryAfter) : 60;
        // Detect daily quota exhaustion (no retry-after + error mentions daily/quota/tokens)
        const isDailyLimit = !retryAfter && (
          detail.includes('exceeded') || detail.includes('daily') ||
          detail.includes('tokens per day') || detail.includes('quota')
        );
        if (isDailyLimit) {
          return new Response(JSON.stringify({
            error: provider + ' daily quota exhausted. The free-tier daily limit resets at midnight UTC. '
              + 'To continue now: add a GEMINI_API_KEY (free, aistudio.google.com) in Cloudflare Pages → Settings → Environment Variables.',
            waitSecs: 3600, // 1 hour placeholder — actual reset is midnight UTC
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
        // Request too large — Groq 12k TPM limit hit. Switch to Gemini or Claude.
        console.warn('[' + provider + '] 413 Request too large — switching to next provider');
        return new Response(JSON.stringify({
          error: provider + ' token limit exceeded (document too large). Switching to next provider.',
          switchProvider: true,
          provider
        }), { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (response.status === 401) msg = `${provider} API key invalid or expired — check ${provider.toUpperCase()}_API_KEY in Vercel.`;
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
    return new Response(JSON.stringify({ error: `Proxy error: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
}
