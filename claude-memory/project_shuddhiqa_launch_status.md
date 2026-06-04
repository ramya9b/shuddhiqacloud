---
name: project_shuddhiqa_launch_status
description: "ShuddhiQA Cloud launch-readiness snapshot as of 2026-06-04 — Azure 6th provider shipped, docs verified, pending items"
metadata: 
  node_type: memory
  type: project
  originSessionId: 1178dee5-ffb4-40bd-a11b-7729e0898d68
---

Snapshot of ShuddhiQA Cloud (shuddhiqacloud.pages.dev) launch readiness, captured 2026-06-04. The user was preparing a LinkedIn launch. See [[project_shuddhiqa_copilot_mcp_roadmap]] for the next-phase MCP/Copilot plan.

**Architecture:** single-file PWA `app.html` + Cloudflare Pages Functions proxy (`functions/api/claude.js`, `/api/detect`, `/api/ado`). Local edit/deploy source is `C:\Users\RamyaBIN\ShuddhiQA-v10.2` (NOT itself a git repo). GitHub mirror is a SEPARATE clone at `C:\Users\RamyaBIN\shuddhiqacloud` → `github.com/ramya9b/shuddhiqacloud`. Deploy: `npx wrangler pages deploy . --project-name=shuddhiqacloud --branch=main --commit-dirty=true` (needs `CLOUDFLARE_API_TOKEN`). Version v12.21. Deploy gate: `python verify_shuddhiqa.py` must hit 60/60.

**DONE (shipped + live + mirrored):**
- Azure OpenAI added as the **6th** AI provider (Claude, Gemini, OpenAI, Together, Groq, Azure). Azure = BYO endpoint/key/deployment/api-version; gpt-5-mini reasoning model needs `max_completion_tokens` (not `max_tokens`), default api-version `2024-12-01-preview`. Tested end-to-end live.
- All earlier bugs fixed: refine (now rebuilds interactive checkbox table), 8 missing handlers, Usage & Cost shows all 6 providers, View-in-Console all 6, selection-scoped ADO push, demo videos.
- Docs all accurate + consistent for launch: privacy/terms/help + guides/*.html all show "6 AI Providers", correct api-version, no stale "5 providers"/"planned v0.2".
- Last fix (2026-06-04): privacy.html section 6 data-residency now says "Azure OpenAI provider (live now)" instead of "planned v0.2". Deployed + pushed to mirror (commit 5ae52ca).

**PENDING / NEXT:**
- **SECURITY — user must rotate** all API keys + tokens pasted in chat (Claude, Gemini, Groq, Azure key, Cloudflare `cfut_…`, GitHub `ghp_…`); treat as compromised.
- Before posting: 2-min browser click-through (exports, video playback, ADO push).
- Available on request: full expanded test-case SYSTEM PROMPT; a complete "BUILD PROMPT" to recreate the ShuddhiQA test-case agent (already drafted in chat — can be saved to `BUILD_PROMPT.md`).
- The LinkedIn post's privacy claim was wrong ("sent directly / no proxy / keys never reach servers") — the tool DOES proxy via `/api/claude` but never stores/logs. Correct wording: "forwarded through a lightweight proxy that never stores or logs them."
