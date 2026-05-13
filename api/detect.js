/**
 * functions/api/detect.js — Enterprise Platform Intelligence Detector
 * v9.58: Uses Groq (free server key) to run expert enterprise analysis
 * on requirement text and return structured platform/module detection.
 *
 * POST /api/detect
 * Body: { text: string }
 * Returns: { platform, module, confidence, workflow, evidence, probabilities }
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Expert enterprise intelligence system prompt — compressed for JSON output
const ENTERPRISE_DETECT_PROMPT = `You are a world-class Enterprise Solution Architect and AI QA Strategist with deep expertise in Salesforce, SAP ECC/S4HANA, Oracle ERP/EBS/HCM, Microsoft Dynamics 365, Business Central, ServiceNow, Guidewire, Workday, SuccessFactors, and all major enterprise/web/mobile platforms.

Your task: Analyse the provided requirement text and identify the enterprise platform, module, workflow, and testing context.

PLATFORM DETECTION SIGNALS:
- "Incident", "CMDB", "Catalog Task", "Change Request", "SLA" → ServiceNow
- "Worker", "Compensation", "Absence", "Pay Group", "Supervisory Org" → Workday
- "PolicyCenter", "ClaimCenter", "BillingCenter" → Guidewire
- "GL", "AR", "AP", "Ledger", "Journal Entry", "Period Close", "MIRO", "ME21N" → ERP (SAP/D365/Oracle)
- "Opportunity", "Lead", "Account", "Case", "SOQL", "Lightning", "SFDC" → Salesforce
- "D365", "Finance & Operations", "Business Central", "Dynamics AX" → Microsoft Dynamics 365
- "Purchase Org", "Movement Type", "ABAP", "IDOC", "Transaction Code" → SAP
- "HireDate", "EmployeeID", "Payroll Run", "SuccessFactors" → HRMS
- "OAuth", "JWT", "Registration", "Verification Email", "Password Complexity" → Web Application
- "Push Notification", "APNs", "FCM", "App Store", "Biometric" → Mobile Application

RESPOND ONLY WITH THIS EXACT JSON (no markdown, no explanation):
{
  "platform": "<exact platform name>",
  "platformKey": "<one of: D365 F&O|D365 CRM|D365 BC|Salesforce Sales|Salesforce Service|SAP|ServiceNow|Workday|Guidewire|Oracle ERP|Web App|Mobile App|Enterprise ERP|Insurance|Healthcare|Banking & Finance|HR & Payroll|Retail / eCommerce>",
  "module": "<specific module name>",
  "confidence": <0-100>,
  "workflow": "<business workflow name e.g. Procure-to-Pay, Order-to-Cash, Hire-to-Retire>",
  "evidence": ["<key signal 1>", "<key signal 2>", "<key signal 3>"],
  "probabilities": [
    {"platform": "<name>", "pct": <0-100>},
    {"platform": "<name>", "pct": <0-100>},
    {"platform": "<name>", "pct": <0-100>}
  ],
  "testingFocus": "<1-sentence testing priority>",
  "automationFeasibility": "<High|Medium|Low>"
}`;

export async function onRequestPost(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  let body;
  try {
    const raw = await request.text();
    body = raw ? JSON.parse(raw) : {};
  } catch(e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  const text = (body.text || '').trim();
  if (!text || text.length < 20) {
    return new Response(JSON.stringify({ error: 'Text too short for analysis (min 20 chars)' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  // Truncate to 3000 chars to keep Groq cost minimal
  const analysisText = text.substring(0, 3000);

  const groqKey = env.GROQ_API_KEY || '';
  if (!groqKey) {
    return new Response(JSON.stringify({ error: 'Detection service not configured (GROQ_API_KEY missing)' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
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
          { role: 'user',   content: 'Analyse this requirement:\n\n' + analysisText }
        ],
        max_tokens:  600,
        temperature: 0.1,  // low temp for deterministic detection
        stream:      false,
      }),
    });

    if (!groqResp.ok) {
      const errText = await groqResp.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'Groq detection failed: ' + groqResp.status, detail: errText.substring(0,200) }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const groqData = await groqResp.json();
    const raw = groqData?.choices?.[0]?.message?.content || '';

    // Parse JSON from Groq response (strip any accidental markdown fences)
    let result;
    try {
      const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      // Find the JSON object
      const start = clean.indexOf('{');
      const end   = clean.lastIndexOf('}');
      if (start >= 0 && end > start) {
        result = JSON.parse(clean.substring(start, end + 1));
      } else {
        throw new Error('No JSON object found in response');
      }
    } catch(parseErr) {
      return new Response(JSON.stringify({
        error: 'Could not parse detection result',
        raw: raw.substring(0, 300),
      }), { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    // Validate required fields
    if (!result.platformKey || !result.platform) {
      return new Response(JSON.stringify({ error: 'Incomplete detection result', raw: raw.substring(0, 200) }),
        { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(result),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

  } catch(e) {
    return new Response(JSON.stringify({ error: 'Detection error: ' + e.message }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
}
