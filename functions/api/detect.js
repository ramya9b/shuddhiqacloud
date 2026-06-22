/**
 * functions/api/detect.js — Enterprise Domain & Platform Intelligence Detector
 * v9.61: Enhanced with elite enterprise domain intelligence prompt
 * Uses domain ontology mapping, semantic clue detection, platform-domain correlation
 *
 * POST /api/detect
 * Body: { text: string }
 * Returns: { platform, platformKey, domain, module, confidence, workflow,
 *            evidence, probabilities, compliance, stakeholders,
 *            testingFocus, automationFeasibility, riskLevel }
 */

// detect.js uses origin-aware CORS (built per-request) — not a static wildcard
// The wildcard here is intentional for detect: it's used only server-side by the
// ShuddhiQA proxy; the actual origin check happens in the calling handler.
// Updated to restrict to known origins (v9.101 — security hardening)
function buildDetectCors(origin) {
  const allowed = origin && (
    origin.includes('localhost') ||
    origin.includes('shuddhiqacloud.vercel.app') ||
    origin.includes('shuddhiqacloud.pages.dev') ||
    origin.includes('workers.dev')
  );
  return {
    'Access-Control-Allow-Origin':  allowed ? origin : 'https://shuddhiqacloud.vercel.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}
// Legacy alias — keep existing code working
const CORS_HEADERS = buildDetectCors('');

// Elite enterprise intelligence prompt — extracts platform + domain via
// multi-phase semantic analysis, domain ontology mapping, and hidden clue detection
const ENTERPRISE_DETECT_PROMPT = `You are a world-class Enterprise Domain Intelligence Architect with deep expertise in ERP, CRM, ITSM, Insurance, Banking, Healthcare, HR, Retail, and all major enterprise platforms.

Your mission: Analyse the provided requirement text using multi-phase semantic reasoning to identify the enterprise platform, business domain, module, and QA context.

══════════════════════════════════════════
PHASE 1 — HIDDEN SEMANTIC CLUE DETECTION
══════════════════════════════════════════

Detect these domain signals instantly:

INSURANCE:
"Premium", "Claim", "FNOL", "Deductible", "Underwriting", "Policy", "Endorsement",
"Adjudication", "Reinsurance", "Coinsurance", "Broker", "Coverage exclusion",
"ClaimCenter", "PolicyCenter", "BillingCenter", "Guidewire", "Duck Creek"
→ domain: insurance

BANKING & FINANCE:
"Loan", "Mortgage", "Collateral", "EMI", "KYC", "AML", "SWIFT", "IBAN",
"Account", "Ledger", "Credit score", "Overdraft", "Remittance", "NBFC",
"GL", "AR", "AP", "Journal Entry", "Cost Center", "Trial Balance"
→ domain: banking or erp

HEALTHCARE:
"Patient", "Provider", "Encounter", "Prescription", "EHR", "EMR", "HIPAA",
"ICD", "CPT", "FHIR", "Diagnosis", "Clinical", "Discharge", "Lab result"
→ domain: healthcare

HR & PAYROLL:
"Worker", "Employee", "Compensation", "Absence", "Payroll", "Onboarding",
"Hire-to-Retire", "Talent", "Benefits", "Timesheet", "Org Chart", "Headcount",
"Workday", "SuccessFactors"
→ domain: hr

ERP / SUPPLY CHAIN:
"Purchase Order", "Procurement", "Inventory", "Warehouse", "Shipment",
"Fulfillment", "BOM", "Production Order", "Plant", "Movement Type",
"MIRO", "ME21N", "Transaction Code", "ABAP", "IDOC"
→ domain: erp

RETAIL / E-COMMERCE:
"Product", "Cart", "Checkout", "SKU", "Storefront", "Merchant",
"Discount", "Promotion", "POS", "Marketplace", "Catalog", "Returns"
→ domain: retail

ITSM:
"Incident", "Problem", "Change Request", "CMDB", "SLA", "Catalog Task",
"ServiceNow", "Remedy"
→ domain: itsm

WEB / AUTH:
"OAuth", "JWT", "Registration", "Verification Email", "Password Complexity",
"Protected Route", "Session Token", "2FA", "MFA"
→ domain: web

══════════════════════════════════════════
PHASE 2 — PLATFORM-DOMAIN CORRELATION ENGINE
══════════════════════════════════════════

Use these correlations as strong evidence:

Guidewire (ClaimCenter/PolicyCenter/BillingCenter) → Insurance
Duck Creek → Insurance
Workday / SuccessFactors → HR & Payroll
ServiceNow → ITSM / IT Operations
SAP ECC / S4HANA → Manufacturing, Supply Chain, Finance, ERP
Oracle ERP / Fusion → Finance, Procurement, ERP
Dynamics 365 F&O → ERP, Finance, Operations
Dynamics 365 CRM → CRM, Sales
Salesforce Sales/Service → CRM, Customer Service
Web App / Mobile App → depends on vocabulary

══════════════════════════════════════════
PHASE 3 — WORKFLOW INTELLIGENCE
══════════════════════════════════════════

Map detected signals to enterprise workflows:
- Claims Lifecycle: FNOL → Investigation → Adjudication → Settlement → Closure
- Procure-to-Pay: Requisition → PO → GR → Invoice → Payment
- Order-to-Cash: Quote → Order → Fulfilment → Invoice → Collection
- Hire-to-Retire: Recruit → Onboard → Develop → Offboard
- Incident Management: Log → Triage → Assign → Resolve → Close
- Loan Origination: Apply → Assess → Approve → Disburse → Service

══════════════════════════════════════════
PHASE 4 — COMPLIANCE INTELLIGENCE
══════════════════════════════════════════

Map domain to likely compliance obligations:
Insurance → IRDAI, SOX, GDPR, State Insurance Laws
Banking → Basel III, RBI, FDIC, AML/KYC, SOX
Healthcare → HIPAA, HL7, HITECH, FDA
HR/Payroll → GDPR, Labor Laws, FLSA, POPIA
ERP/Finance → SOX, IFRS, GAAP, VAT/GST
Retail → PCI-DSS, GDPR, Consumer Protection

══════════════════════════════════════════
PLATFORM DETECTION SIGNALS (Quick Reference)
══════════════════════════════════════════

"Incident", "CMDB", "Catalog Task", "Change Request", "SLA" → ServiceNow
"Worker", "Compensation", "Absence", "Pay Group", "Supervisory Org" → Workday
"PolicyCenter", "ClaimCenter", "BillingCenter" → Guidewire
"GL", "AR", "AP", "Journal Entry", "Period Close", "MIRO", "ME21N" → ERP (SAP/D365/Oracle)
"Opportunity", "Lead", "Account", "Case", "SOQL", "Lightning", "SFDC" → Salesforce
"D365", "Finance & Operations", "Business Central", "Dynamics AX" → Microsoft Dynamics 365
"Purchase Org", "Movement Type", "ABAP", "IDOC", "Transaction Code" → SAP
"HireDate", "EmployeeID", "Payroll Run", "SuccessFactors" → HRMS
"OAuth", "JWT", "Registration", "Verification Email", "Password Complexity" → Web Application
"Push Notification", "APNs", "FCM", "App Store", "Biometric" → Mobile Application

RESPOND ONLY WITH THIS EXACT JSON (no markdown, no explanation, no preamble):
{
  "platform": "<exact platform name>",
  "platformKey": "<one of: D365 F&O|D365 CRM|D365 BC|D365+Salesforce|Salesforce Sales|Salesforce Service|Salesforce CPQ|SAP|Oracle ERP|Workday|ServiceNow|Guidewire|Web App|Mobile App>",
  "domain": "<one of: insurance|banking|hr|erp|healthcare|retail|itsm|web|mobile|unknown>",
  "module": "<specific module e.g. Claims Management, Accounts Payable, Payroll Processing>",
  "confidence": <0-100>,
  "workflow": "<e.g. Claims Lifecycle — FNOL → Adjudication → Settlement>",
  "evidence": ["<signal 1>", "<signal 2>", "<signal 3>", "<signal 4>", "<signal 5>"],
  "probabilities": [
    {"platform": "<name>", "pct": <0-100>},
    {"platform": "<name>", "pct": <0-100>},
    {"platform": "<name>", "pct": <0-100>}
  ],
  "compliance": ["<e.g. IRDAI>", "<SOX>", "<GDPR>"],
  "stakeholders": ["<e.g. Claims Adjuster>", "<Finance Manager>"],
  "testingFocus": "<1 sentence: key QA priority for this requirement>",
  "automationFeasibility": "<High|Medium|Low>",
  "riskLevel": "<High|Medium|Low>"
}`;

export async function onRequestPost(context) {
  const { request, env } = context;
  const origin = request.headers.get('origin') || '';
  const CORS = buildDetectCors(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  let body;
  try {
    const raw = await request.text();
    body = raw ? JSON.parse(raw) : {};
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const text = (body.text || '').trim();
  if (!text || text.length < 20) {
    return new Response(JSON.stringify({ error: 'Text too short (min 20 chars)' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const analysisText = text.substring(0, 3000);
  const groqKey = env.GROQ_API_KEY || '';
  if (!groqKey) {
    return new Response(JSON.stringify({ error: 'Detection service not configured' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  try {
    const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + groqKey,
      },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: ENTERPRISE_DETECT_PROMPT },
          { role: 'user',   content: 'Analyse this requirement and return ONLY the JSON:\n\n' + analysisText }
        ],
        max_tokens:  900,
        temperature: 0.1,
        stream:      false,
      }),
    });

    if (!groqResp.ok) {
      const errText = await groqResp.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'Detection failed: ' + groqResp.status, detail: errText.substring(0,200) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    const groqData = await groqResp.json();
    const raw = groqData?.choices?.[0]?.message?.content || '';

    let result;
    try {
      const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      const start = clean.indexOf('{');
      const end   = clean.lastIndexOf('}');
      if (start >= 0 && end > start) {
        result = JSON.parse(clean.substring(start, end + 1));
      } else {
        throw new Error('No JSON found');
      }
    } catch(parseErr) {
      return new Response(JSON.stringify({ error: 'Parse failed', raw: raw.substring(0, 300) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    if (!result.platformKey || !result.platform) {
      return new Response(JSON.stringify({ error: 'Incomplete result', raw: raw.substring(0, 200) }),
        { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(result),
      { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

  } catch(e) {
    return new Response(JSON.stringify({ error: 'Detection error: ' + e.message }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
}
