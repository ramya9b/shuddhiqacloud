---
name: project_shuddhiqa_launch_status
description: "ShuddhiQA Cloud launch-readiness — on Vercel, Google sign-in working, free tier verified; 2026-06-15 launch-prep done, key rotation + browser click-through still pending"
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

**2026-06-15 LAUNCH-PREP SESSION (all shipped + live on Vercel):**
- Live site is **https://shuddhiqacloud.vercel.app** (GitHub auto-deploy on push to `main`).
- Vercel env vars now set: `GROQ_API_KEY` (powers free tier + Domain Intelligence) and `GOOGLE_CLIENT_ID` (`339213488587-ucm9je80...`). Claude/Gemini server keys NOT set (those are BYO). ADO/Jira server config NOT set (BYO tokens in Settings).
- **Sign-in fixed.** (1) Critical bug: the header Sign In button was `display:none` and only revealed by `_updateUI()` which runs *after* Firebase loads — but Firebase is lazy-loaded, so anonymous/first-time users never saw the button. Fixed by `_revealSignInBtn()` on the anonymous IndexedDB-sniff path. (2) CSP `connect-src` was missing `shuddhi-qa.firebaseapp.com`/`apis.google.com`/`www.googleapis.com` → `auth/network-request-failed`; added in vercel.json. **Google sign-in now works end-to-end.**
- Firebase config in app.html synced to current console web-app: appId `...fecba07bcc1a9e8295a64e` + measurementId `G-GF1JWNNL7S` (project `shuddhi-qa`).
- **Microsoft sign-in HIDDEN for launch** (`#fbMsBtn` display:none; tooltip → "Google" only). Re-enable later by setting display:flex. Microsoft was a rabbit hole: needs, all on the ONE app Firebase uses (currently client ID `11539fd9-7720-4128-bd87-a23413bbf657`): secret VALUE (not Secret ID) from THAT app, Supported account types = "Any directory + personal Microsoft accounts", manifest `requestedAccessTokenVersion:2` + `signInAudience:AzureADandPersonalMicrosoftAccount`, redirect URI `https://shuddhi-qa.firebaseapp.com/__/auth/handler`. Earlier stale config used app `bd4e7583-...`.
- **URL sweep:** all ~50 user-facing `shuddhiqacloud.pages.dev` → `shuddhiqacloud.vercel.app` (canonical, OG/Twitter meta, sitemap, robots, PDF footer, privacy/terms, guides, decks). pages.dev is RETIRED. API CORS allow-lists still match bare `pages.dev` (harmless) and `shuddhi-qa-v7.5/` archive untouched.
- **Free tier kept** (decided against BYO-only — it's the LinkedIn funnel's zero-setup hook). Added graceful 429 message pointing users to add their own free Groq key in Settings → AI Provider. Fixed 5 user-facing messages still saying "Cloudflare Pages → Environment Variables".
- **Verified live (automated):** all pages 200, security headers present, `/api/debug` Groq ping OK, `/api/detect` Domain Intelligence sharp (Guidewire/insurance 95%, Epic/healthcare 95%), free-tier `/api/claude` returns a valid ADO-format test case. NOT yet verified (need browser): exports, ADO/Jira push, signed-in 10-free-gen counter.
- LinkedIn post written + saved to `LINKEDIN_POST.md` (polished launch tone, try-it+feedback CTA, accurate proxy privacy wording).

**PENDING / NEXT (before posting):**
- **SECURITY — user must rotate** all API keys + tokens pasted in chat; treat as compromised. Includes a **Claude key `sk-ant-api03-…` pasted 2026-06-15** (revoke at console.anthropic.com), plus Gemini, Groq, Azure key, GitHub `ghp_…`. The Groq + Google keys currently in Vercel env were exposed in chat — set FRESH ones in Vercel → Settings → Env Vars. Cloudflare `cfut_…` retired — revoke only.
- **Browser click-through (only unverified user paths):** sign in with Google → confirm signed-in + 10-free-gen counter; exports (PDF/Excel/Word); ADO push + Jira push (these are BYO-token in Settings, server config not set); refine/edit table; templates load; video playback; PWA install.
- (Optional) finish Microsoft sign-in via the Azure steps above, then un-hide `#fbMsBtn`.
- Available on request: full expanded test-case SYSTEM PROMPT; a complete "BUILD PROMPT" to recreate the ShuddhiQA test-case agent (already drafted in chat — can be saved to `BUILD_PROMPT.md`).
- The LinkedIn post's privacy claim was wrong ("sent directly / no proxy / keys never reach servers") — the tool DOES proxy via `/api/claude` but never stores/logs. Correct wording: "forwarded through a lightweight proxy that never stores or logs them."
