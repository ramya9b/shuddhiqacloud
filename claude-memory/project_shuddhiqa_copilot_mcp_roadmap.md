---
name: shuddhiqa-copilot-mcp-roadmap
description: "Three-phase plan for adding Microsoft Copilot integration to Shuddhi QA via an MCP server, with licensing/cost per phase. Built on 2026-06-01 in response to manager's enterprise-Copilot push."
metadata: 
  node_type: memory
  type: project
  originSessionId: 3cc79017-38b2-4636-a20c-f8440679f22a
---

Manager (asked 2026-06-01) pushed for Microsoft Copilot integration in Shuddhi QA for two reinforcing reasons:

1. **Access:** At most large enterprises the AI deployed is M365 Copilot — personal-key providers (OpenAI/Claude/Groq) are blocked by enterprise InfoSec, so without Copilot support the tool cannot reach enterprise users.
2. **Trust (manager's stronger framing):** Companies don't believe in the current 5 APIs *as brands*. Microsoft Copilot carries pre-built enterprise trust that's automatic — *"it's a Microsoft tool"* clears procurement, InfoSec, and IT in days instead of the 30–90 day review purgatory other vendors get. Without Copilot integration, actual user adoption stays low even where the tool is technically allowed.

After evaluating four paths (GitHub Models, Microsoft Graph Copilot API via OAuth, Copilot Studio Agent, MCP server), the MCP server path was chosen: 1–2 weeks engineering, distributed via Microsoft AppSource, users invoke Shuddhi QA from inside their Copilot in Word/Excel/Teams instead of leaving for Shuddhi QA's site.

**Why:** Enterprise unlock requires Copilot, both for technical access AND brand-trust adoption. MCP path is the fastest credible answer (vs OAuth-heavy Graph API at 2–3 weeks, Copilot Studio Agent at 3–4 weeks + cert). Pre-announcing on v12.20 launch turns Copilot-skeptical enterprise leads into a warm DM pipeline. Best enterprise pitch after v12.21: "Available inside your Microsoft Copilot — no new tool, no new account, no new InfoSec review."

**How to apply:** When the user asks about Microsoft Copilot, MCP, AppSource, enterprise sales, v12.21 roadmap, or which licenses/registrations are needed for the Copilot work — recall this 3-phase plan and answer from it.

---

## Phase 1 — Build the MCP server (Day 3 → Day 21 post-launch; ~3 Jun → 24 Jun 2026)

- MCP protocol: free (MIT-licensed by Anthropic) — no license to implement an MCP server
- Hosting: Cloudflare Workers free tier (extends current Cloudflare Pages setup)
- Backend: thin protocol adapter — proxies to existing `/api/claude`, `/api/jira`, `/api/ado`, `/api/detect` endpoints; zero duplication of generation logic
- Worker name: `shuddhiqa-mcp` → URL `https://shuddhiqa-mcp.<account>.workers.dev/mcp`
- Custom domain: NOT in v0.1 — stick with `*.workers.dev` (decision 2026-06-01)
- Testing tenant: **Microsoft 365 Developer Program** (FREE sandbox; sign up at developer.microsoft.com/microsoft-365/dev-program)
- Auth model in v0.1: anonymous + Cloudflare's built-in DDoS protection
- Scaffold location: `C:/Users/RamyaBIN/ShuddhiQA-MCP-v0.1/` (sibling to Pages project; built 2026-06-01)
- **Tool surface (v0.1) — 5 tools to expose full Shuddhi QA workflow (NOT just generation — that's the differentiator):**
  1. `generateTestCases(requirement, platform, format, provider, apiKey)` — proxies `/api/claude`
  2. `fetchJiraIssue(ticketId, baseUrl, email, apiToken)` — proxies `/api/jira`
  3. `pushToADO(testCases, organization, project, testPlanId, suiteId, pat)` — proxies `/api/ado`, creates Test Case work items + adds to suite
  4. `listTemplates(platform, domain)` — curated 28-template subset of 110-template library (full library on website)
  5. `detectPlatform(text)` — proxies `/api/detect` for platform/domain/confidence/evidence
- **Total cost: ₹0**
- **Ship timeline updated:** v0.1 ship pushed from ~15 Jun to ~22 Jun 2026 due to expanded 5-tool surface (was 1 tool). Decision made 2026-06-01 based on insight that full workflow IS the moat — single `generateTestCases` tool would commoditize Shuddhi QA as a thin Copilot wrapper.

## Phase 2 — AppSource submission (artifacts built 2026-06-01)

- **Microsoft Partner Center** account: FREE for individuals
- AppSource listing submission: FREE (Microsoft reviews at no charge; review takes 2–4 weeks)
- Revenue share: 0% if billing customers directly (B2B model); 3% if productized SaaS billed via Microsoft
- Required assets (all already exist): privacy.html, terms.html, support email (ramya9.b@gmail.com)
- **Recommended:** Shuddhi QA India trademark filing — ~₹9,000 one-time (₹4,500 filing + ₹4,500 lawyer fee). Strongly advised before AppSource listing goes live globally, otherwise anyone can register the mark first and force a rebrand.
- **Total cost: ₹0 mandatory, ~₹9,000 (~$110) recommended**

### Phase 2 artifacts on disk (`C:/Users/RamyaBIN/ShuddhiQA-MCP-v0.1/appsource/`)

All built 2026-06-01 — ready for Partner Center paste-in. User just needs to: sign up for Partner Center + M365 Dev Program, build the Copilot Studio agent against the MCP server URL, paste the marketing copy, upload assets, and Submit.

- `SUBMISSION_GUIDE.md` — master end-to-end guide (Stages A–E with time estimates)
- `PRELAUNCH_CHECKLIST.md` — 60-min verify pass before Submit
- `manifests/declarative-agent.json` — Copilot Studio Declarative Agent v1.4 schema
- `manifests/plugin-manifest.json` — M365 Copilot API plugin v2.2 schema
- `manifests/openapi.json` — OpenAPI 3.0 spec of the MCP server
- `marketing/{title-summary, long-description, features, use-cases, faqs, changelog}.md`
- `legal/privacy-supplement.md` — MCP-specific disclosures to append to existing privacy.html (pre-answers Microsoft validation team's typical Q&A)
- `support/{user-guide, troubleshooting}.md`
- `assets/REQUIRED.md` — image specs (small/medium/large logos + 3-5 screenshots at 1280×720) + video script

### Phase 2 — user's external actions (cannot be done from code)

1. Sign up Microsoft Partner Center (~15 min): https://partner.microsoft.com
2. Sign up Microsoft 365 Developer Program (~15 min): https://developer.microsoft.com/microsoft-365/dev-program
3. Build Copilot Studio agent against MCP URL `https://shuddhiqa-mcp.ramya9-b.workers.dev/mcp` (~2 hours)
4. Produce logos + 3-5 screenshots (~1-2 hours; quick option: scale existing favicon + Copilot mockups)
5. Append `legal/privacy-supplement.md` content to `https://shuddhiqacloud.pages.dev/privacy`
6. Host `support/user-guide.md` at `https://shuddhiqacloud.pages.dev/guides/copilot` (or similar)
7. Click Submit in Partner Center after PRELAUNCH_CHECKLIST passes

## Phase 3 — Enterprise contracts (deferred until first real enterprise deal)

- Business entity: LLP (~₹10–15k) or Pvt Ltd (~₹15–20k) one-time registration
- GST registration: FREE; required if annual revenue > ₹20 lakhs or selling across Indian states
- Current account + payment processor: FREE
- DPA (Data Processing Agreement) template: free templates exist; ~₹15k for legal review
- International trademark via Madrid Protocol: ~$650/jurisdiction; needed when enterprise customers outside India materialize
- SOC 2 Type 1: ~$15k–$30k; defer 12+ months until Fortune-500 demands it
- Cyber liability insurance: ~₹50k–₹1L/yr; defer
- **Total cost: deferrable — none required to ship v12.21 or list on AppSource**

---

## Key dates (REVISED 2026-06-01 — launch postponed for completeness)

- **2026-06-01:** Launch decision changed — user explicitly chose to postpone the 2 Jun launch and complete everything fully (privacy supplement, FAQ, full master-docs chapter, MCP-prominent homepage section) before posting. New strategy: "Available now via MCP" framing, NOT "coming v12.21." MCP server is already live + tested.
- v12.20 + MCP launch: **TBD by user** — earliest realistic window mid-June 2026 once Partner Center signup is confirmed and Copilot Studio agent is tested in M365 Dev tenant
- AppSource listing live: **~mid-July 2026** (4 weeks after user submits to Microsoft review)

## Status as of 2026-06-01

### ✅ Fully done (on disk + live where applicable)

- Phase 1 MCP server: deployed at `https://shuddhiqa-mcp.ramya9-b.workers.dev/mcp`, 5 tools live + smoke-tested
- Phase 2 AppSource artifacts: all marketing copy, manifests, support docs, privacy supplement on disk at `C:/Users/RamyaBIN/ShuddhiQA-MCP-v0.1/appsource/`
- Homepage MCP announcement section with copy-URL button + 4 client cards
- Help page MCP setup section + TOC link
- Privacy policy with full MCP integration section (live on shuddhiqacloud.pages.dev/privacy)
- Homepage FAQ: 3 new Copilot/MCP Q&A entries
- Master documentation Chapter 22 — Microsoft Copilot & MCP Integration (11 steps, 250+ lines)

### ⏳ User actions blocking launch

1. Sign up for Microsoft Partner Center (15 min user action + 24-72h Microsoft verification)
2. Sign up for Microsoft 365 Developer Program (15 min user action — free sandbox)
3. Test the MCP server end-to-end in Claude Desktop (5 min — proves the integration works)
4. Build the Copilot Studio Declarative Agent in M365 Dev sandbox tenant (~2 hours)
5. Produce 3-5 screenshots + logos for AppSource (~1-2 hours)
6. Append privacy supplement to live privacy.html (DONE 2026-06-01)
7. Update LinkedIn launch post + article with "Available now via MCP" framing
8. Click Submit in Partner Center

### Recommended launch sequence post-completeness

- Day +1 to +3: User completes Partner Center + M365 Dev signups
- Day +3: Verification clears; user tests in Claude Desktop + Copilot Studio
- Day +4: Update LinkedIn launch draft to "Available now via MCP" framing
- Day +5: LinkedIn launch (Tue/Wed/Thu, 10am IST)
- Day +6 to +14: AppSource submission preparation (assets, listing copy paste-in)
- Day +14: Submit to Partner Center for Microsoft review
- Day +14 to +45: Microsoft validation review
- Day +45: AppSource listing goes live → second LinkedIn announcement

## ⚠️ Lessons learned 2026-06-01 — Microsoft personal-testing path is closed

User attempted Microsoft Copilot Studio personal testing through multiple paths over several hours. All hit walls. Conclusions:

1. **Microsoft 365 Business Basic (~₹145/mo)** does NOT include Copilot Studio. Confirmed via marketplace flow. Only includes email/Teams/Office web.
2. **Microsoft Copilot Studio trial** is "free for 30 days" BUT auto-converts to ₹23,562/month paid subscription. Refund window only 7 days. Cancel-before-end is required.
3. **Microsoft 365 Developer Program** rejected user for eligibility (algorithmic; no override).
4. **Power Apps Developer Plan** requires work email — personal Microsoft account on Gmail blocked.
5. **Corporate tenant (Alpha Variance Solutions)** had self-service signups DISABLED by IT policy — `viral-signup/create/status` endpoint returned 404. This is common in Indian IT corporate tenants.
6. **Claude Desktop MCP integration** worked at the server level (mcp-remote bridge confirmed) but Claude Desktop's single-instance behavior prevented the new config from loading despite multiple restart attempts.

**Decision made 2026-06-01:** User activated the 30-day Copilot Studio free trial on her Sri Varalakshmi Balaji Enterprises tenant. Critical follow-up: trial auto-converts to ₹23,562/month paid on **Jul 2, 2026** unless cancelled. Cancel via admin.microsoft.com → Billing → Your products → Microsoft Copilot Studio (Trial) → Cancel subscription. Refund window only 7 days from activation.

**🎉 SUCCESS 2026-06-01 ~22:30 IST:** Microsoft Copilot Studio integration is LIVE END-TO-END inside real Copilot Studio. User successfully created Shuddhi QA agent, added MCP server connector (https://shuddhiqa-mcp.ramya9-b.workers.dev/mcp), authorized the connection in Power Platform Connections, and verified generateTestCases tool returns real D365 test cases when invoked from the agent's test chat. Path that worked: M365 Business Basic (₹145/mo) → activate Microsoft Copilot Studio free trial → m365.cloud.microsoft → New agent → Agent Builder created agent "Shuddhi QA" → typed in chat to "add MCP server" → Agent Builder redirected to full Copilot Studio → System Administrator role assigned in Power Platform Admin Center → Tools tab in Copilot Studio → Add MCP server form → connection authorized in make.powerapps.com/connections → Retry in test chat → test cases streamed. Total time: ~3 hours of debugging Microsoft permission/license walls.

**How to apply this lesson next time:** When user asks about Microsoft Copilot testing, DON'T recommend any free trial path (they all dead-end). The only paths that actually work: (a) borrowed access to a real corporate M365 Copilot tenant, (b) paid M365 Business Standard + Copilot add-on (₹2,500+/user/mo), or (c) accept that personal testing isn't required since the integration works for end users with proper licensing.
