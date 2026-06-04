# RESTART HERE — Continuing ShuddhiQA on a new laptop

Quick-start checklist to pick up work on a fresh machine. The code in this repo
is the real source of truth — nothing is lost as long as you can clone it.

Live site: https://shuddhiqacloud.pages.dev · Version: v12.21

---

## 1. Install the tools (one-time)
- **Node.js** (LTS) — for `npx wrangler` (Cloudflare deploy)
- **Python 3** — for `verify_shuddhiqa.py` (the deploy gate)
- **Git** — to clone this repo
- **Claude Code** — run `claude`, sign in (ramya9.b@gmail.com)

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
- **Cloudflare token** — dash.cloudflare.com -> My Profile -> API Tokens ->
  "Edit Cloudflare Workers" template
- **GitHub PAT** — github.com -> Settings -> Developer settings -> Personal
  access tokens -> `repo` scope (account ramya9b)
- **AI keys** — new Claude / Gemini / Groq keys; rotate the **Azure** key in
  Azure Portal -> your OpenAI resource -> Keys -> Regenerate

## 5. Verify (5-minute smoke test)
```powershell
python verify_shuddhiqa.py        # expect: 60/60 passed
```
Open the live site, sign in, run one generation with your NEW Azure key to
confirm end-to-end. The deployed site is already live + correct — no redeploy
needed unless you change code.

## 6. When you next deploy
```powershell
$env:CLOUDFLARE_API_TOKEN="<your new cfut_ token>"
npx wrangler pages deploy . --project-name=shuddhiqacloud --branch=main --commit-dirty=true
git push origin main
```

---

## Where things are
- **App:** `app.html` (single-file PWA, no build step)
- **Backend:** `functions/api/{claude,detect,ado}.js` (Cloudflare Pages Functions)
- **Docs:** `index/privacy/terms/help.html`, `guides/*.html`
- **PWA:** `manifest.json`, `sw.js`
- **Deploy gate:** `verify_shuddhiqa.py` (must pass 60/60 before deploy)

## Current status (as of 2026-06-04)
- 6 AI providers live: Claude, Gemini, OpenAI, Together, Groq, **Azure OpenAI**
  (BYO endpoint/key/deployment; gpt-5-mini needs `max_completion_tokens`,
  api-version `2024-12-01-preview`).
- All docs verified consistent ("6 AI Providers", no stale strings).
- Pending before LinkedIn launch: rotate exposed keys (step 4) + a browser
  click-through of exports / video playback / ADO push.
