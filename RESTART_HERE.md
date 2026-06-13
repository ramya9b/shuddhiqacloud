# RESTART HERE — Continuing ShuddhiQA on a new laptop

Quick-start checklist to pick up work on a fresh machine. The code in this repo
is the real source of truth — nothing is lost as long as you can clone it.

Live site: your Vercel deployment (`*.vercel.app` or your custom domain) · Version: v12.21
Hosting: **Vercel** (GitHub auto-deploy — every push to `main` builds & ships).

---

## 1. Install the tools (one-time)
- **Git** — to clone this repo
- **Python 3** — for `verify_shuddhiqa.py` (the deploy gate)
- **Claude Code** — run `claude`, sign in (ramya9.b@gmail.com)
- **Node.js** (LTS) — optional; only needed if you want the `vercel` CLI for
  local/manual deploys. Normal deploys happen automatically on `git push`.

## 2. Get the code
```powershell
cd C:\Users\<YourUser>
git clone https://github.com/ramya9b/shuddhiqacloud
cd shuddhiqacloud
```
Use this single folder for editing AND pushing — no separate edit/mirror folders.

## 3. Bring over Claude's memory (optional — for chat continuity)
Copy the `memory\` folder from the old laptop:
```
From: C:\Users\RamyaBIN\.claude\projects\c--Users-RamyaBIN-UIAPIAutomation\memory\
To:   C:\Users\<YourUser>\.claude\projects\<new-project-folder>\memory\
```
Then start `claude` from inside this repo — it auto-loads MEMORY.md and knows
the project status. (Skip this and you only lose conversational context, not code.)

## 4. Create FRESH tokens & keys — DO NOT reuse old ones
Any key/token pasted into a past chat is compromised. Generate new + revoke old:
- **AI keys** — new Claude / Gemini / Groq keys; rotate the **Azure** key in
  Azure Portal -> your OpenAI resource -> Keys -> Regenerate
- **GitHub PAT** — github.com -> Settings -> Developer settings -> Personal
  access tokens -> `repo` scope (account ramya9b). Only needed for git pushes
  over HTTPS; Vercel's GitHub integration uses its own connection.
- **Cloudflare token** — no longer used (we deploy on Vercel now). Just
  **revoke** any old `cfut_…` token at dash.cloudflare.com; don't make a new one.

Server-side keys live in **Vercel -> Project -> Settings -> Environment
Variables** (the `api/*.js` Edge wrappers read `process.env`). Set as needed:
`CLAUDE_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `ADO_PAT`/`ADO_ORG`/
`ADO_PROJECT`, `JIRA_EMAIL`/`JIRA_API_TOKEN`/`JIRA_BASE_URL`, `GOOGLE_CLIENT_ID`.
(OpenAI, Together, Azure OpenAI are BYO from the browser — no server var.)
After changing env vars in Vercel, redeploy for them to take effect.

## 5. Verify (smoke test)
```powershell
python verify_shuddhiqa.py        # expect: 37/37 passed
```
Open the live site, sign in, run one generation with your NEW Azure key to
confirm end-to-end. The deployed site is already live + correct — no redeploy
needed unless you change code.

## 6. When you next deploy
Deploys are automatic — just push:
```powershell
git push origin main      # Vercel builds & ships main on every push
```
Watch the build at vercel.com/<your-account>/shuddhiqacloud (Deployments tab).
For a manual/preview deploy without pushing, use the CLI: `vercel` (preview) or
`vercel --prod` (production). Run `python verify_shuddhiqa.py` before pushing.

---

## Where things are
- **App:** `app.html` (single-file PWA, no build step)
- **Backend logic (source of truth):** `functions/api/{claude,detect,ado,...}.js`
- **Vercel adapters:** `api/*.js` — thin Edge wrappers that import & delegate to
  `functions/api/*` (single source of truth; don't duplicate logic here)
- **Hosting config:** `vercel.json` (static root + `/api/*` functions, headers/CSP)
- **Docs:** `index/privacy/terms/help.html`, `guides/*.html`
- **PWA:** `manifest.json`, `sw.js`
- **Deploy gate:** `verify_shuddhiqa.py` (must pass 37/37 before deploy)

## Current status (as of 2026-06-04)
- 6 AI providers live: Claude, Gemini, OpenAI, Together, Groq, **Azure OpenAI**
  (BYO endpoint/key/deployment; gpt-5-mini needs `max_completion_tokens`,
  api-version `2024-12-01-preview`).
- All docs verified consistent ("6 AI Providers", no stale strings).
- Pending before LinkedIn launch: rotate exposed keys (step 4) + a browser
  click-through of exports / video playback / ADO push.
