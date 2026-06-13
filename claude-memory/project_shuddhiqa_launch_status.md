---
name: project_shuddhiqa_launch_status
description: "ShuddhiQA Cloud launch-readiness snapshot as of 2026-06-04 — Azure 6th provider shipped, docs verified, pending items"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1178dee5-ffb4-40bd-a11b-7729e0898d68
---

Snapshot of ShuddhiQA Cloud (shuddhiqacloud.pages.dev) launch readiness, captured 2026-06-04. The user was preparing a LinkedIn launch. See [[project_shuddhiqa_copilot_mcp_roadmap]] for the next-phase MCP/Copilot plan.

**Architecture:** single-file PWA `app.html` + serverless API proxy. Backend logic lives in `functions/api/*.js` (single source of truth: `claude.js`, `detect.js`, `ado.js`, ...); `api/*.js` are thin Vercel Edge wrappers that import & delegate to them. **Hosting is now Vercel** (switched from Cloudflare Pages as of 2026-06-13) via GitHub auto-deploy — every push to `main` builds & ships; no `wrangler` command. Server-side keys live in Vercel → Project → Settings → Env Vars (`CLAUDE_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `ADO_*`, `JIRA_*`, `GOOGLE_CLIENT_ID`). Single working folder on this machine: `C:\Users\jayak\shuddhiqacloud` (edit AND push from here; the old separate RamyaBIN edit/mirror folders are retired). Version v12.21. Deploy gate `verify_shuddhiqa.py` was reconstructed + committed 2026-06-13 (original was never in the repo) — must hit 37/37.

**DONE (shipped + live + mirrored):**
- Azure OpenAI added as the **6th** AI provider (Claude, Gemini, OpenAI, Together, Groq, Azure). Azure = BYO endpoint/key/deployment/api-version; gpt-5-mini reasoning model needs `max_completion_tokens` (not `max_tokens`), default api-version `2024-12-01-preview`. Tested end-to-end live.
- All earlier bugs fixed: refine (now rebuilds interactive checkbox table), 8 missing handlers, Usage & Cost shows all 6 providers, View-in-Console all 6, selection-scoped ADO push, demo videos.
- Docs all accurate + consistent for launch: privacy/terms/help + guides/*.html all show "6 AI Providers", correct api-version, no stale "5 providers"/"planned v0.2".
- Last fix (2026-06-04): privacy.html section 6 data-residency now says "Azure OpenAI provider (live now)" instead of "planned v0.2". Deployed + pushed to mirror (commit 5ae52ca).

**PENDING / NEXT:**
- **SECURITY — user must rotate** all API keys + tokens pasted in chat (Claude, Gemini, Groq, Azure key, GitHub `ghp_…`); treat as compromised. Cloudflare `cfut_…` is retired (now on Vercel) — just REVOKE the old one, no replacement needed. Set the fresh AI keys in Vercel env vars, not Cloudflare.
- Stale-copy fix shipped 2026-06-13: index.html "Everything new" tagline said "5 AI Providers", corrected to 6 (commit 84764b6, auto-deployed via Vercel).
- Before posting: 2-min browser click-through (exports, video playback, ADO push).
- Available on request: full expanded test-case SYSTEM PROMPT; a complete "BUILD PROMPT" to recreate the ShuddhiQA test-case agent (already drafted in chat — can be saved to `BUILD_PROMPT.md`).
- The LinkedIn post's privacy claim was wrong ("sent directly / no proxy / keys never reach servers") — the tool DOES proxy via `/api/claude` but never stores/logs. Correct wording: "forwarded through a lightweight proxy that never stores or logs them."
