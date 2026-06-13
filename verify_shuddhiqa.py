#!/usr/bin/env python3
"""
verify_shuddhiqa.py — ShuddhiQA Cloud deploy gate.

Self-contained pre-deploy smoke test. No third-party deps (stdlib only).
Run from the repo root:  python verify_shuddhiqa.py

Exit code 0 = all checks passed (safe to deploy).
Exit code 1 = one or more checks failed (DO NOT deploy until green).

NOTE: This script was reconstructed from the repo's documented invariants
(RESTART_HERE.md + claude-memory) after the original was found missing from
the GitHub mirror. It asserts the launch-readiness facts the project relies on:
the 6 AI providers, Azure specifics, current version marker, required files,
and that user-facing copy is not stale ("6 AI Providers", not "5").
Keep it committed so a fresh clone is genuinely verifiable.
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

# The 6 live AI providers (memory: Azure shipped as the 6th).
PROVIDERS = ["claude", "gemini", "openai", "together", "groq", "azure"]

# Files that must exist for the app + backend + docs + PWA to function.
REQUIRED_FILES = [
    "app.html", "index.html", "help.html", "privacy.html", "terms.html",
    "templates.html", "manifest.json", "sw.js",
    "functions/api/claude.js", "functions/api/detect.js", "functions/api/ado.js",
]

# Docs/pages whose user-facing copy must advertise SIX providers, not five.
SIX_PROVIDER_PAGES = [
    "index.html", "help.html", "app.html",
    "guides/features.html", "guides/index.html", "guides/documentation.html",
]

CURRENT_VERSION = "v12.21"
AZURE_API_VERSION = "2024-12-01-preview"

results = []  # list of (passed: bool, label: str, detail: str)


def check(label, condition, detail=""):
    results.append((bool(condition), label, detail))


def read(path):
    full = os.path.join(ROOT, path)
    with open(full, "r", encoding="utf-8", errors="replace") as fh:
        return fh.read()


def exists(path):
    return os.path.isfile(os.path.join(ROOT, path))


# ── 1. Required files present ────────────────────────────────────────────
for f in REQUIRED_FILES:
    check(f"file exists: {f}", exists(f), "missing from repo")

# ── 2. Backend wires up all 6 providers ──────────────────────────────────
claude_js = read("functions/api/claude.js") if exists("functions/api/claude.js") else ""
claude_js_l = claude_js.lower()
for p in PROVIDERS:
    check(f"backend references provider: {p}", p in claude_js_l,
          "not found in functions/api/claude.js")

# ── 3. Azure-specific invariants (the 6th provider's gotchas) ─────────────
check("azure api-version present in backend",
      AZURE_API_VERSION in claude_js,
      f"expected {AZURE_API_VERSION} in claude.js")
check("azure reasoning model uses max_completion_tokens",
      "max_completion_tokens" in claude_js,
      "gpt-5-mini needs max_completion_tokens, not max_tokens")

# ── 4. Current version marker ─────────────────────────────────────────────
app_html = read("app.html") if exists("app.html") else ""
check(f"current version marker {CURRENT_VERSION} present in app.html",
      CURRENT_VERSION in app_html,
      f"expected {CURRENT_VERSION}")

# ── 5. User-facing copy advertises 6 providers, not a stale 5 ─────────────
# Context-aware on TWO axes so we don't flag legitimate text:
#   * "the other 5 providers" (the 5 non-Azure ones)        -> legitimate
#   * an in-app changelog recalling a past 5-provider state -> legitimate
# We only flag a STALE MARKETING CLAIM: a feature-list tagline that enumerates
# the live provider count, e.g. "... 100 Templates, 5 AI Providers and more."
STALE_MARKETING = re.compile(r"\b5\s+AI\s+Providers\s+and\s+more\b", re.IGNORECASE)
for page in SIX_PROVIDER_PAGES:
    if not exists(page):
        check(f"page advertises 6 providers: {page}", False, "file missing")
        continue
    txt = read(page)
    check(f"page mentions '6 AI Providers': {page}",
          re.search(r"6\s+AI\s+Provider", txt, re.IGNORECASE) is not None,
          "expected '6 AI Providers' in copy")
    m = STALE_MARKETING.search(txt)
    check(f"no stale '5 providers' marketing tagline: {page}",
          m is None,
          f"found stale tagline: {m.group(0)!r}" if m else "")

# ── 6. Privacy page reflects Azure as live (not 'planned') ────────────────
if exists("privacy.html"):
    priv = read("privacy.html").lower()
    check("privacy.html: no 'planned v0.2' Azure stub",
          "planned v0.2" not in priv,
          "Azure is live; remove 'planned v0.2'")

# ── 7. PWA manifest is valid + complete ───────────────────────────────────
if exists("manifest.json"):
    try:
        man = json.loads(read("manifest.json"))
        check("manifest.json is valid JSON", True)
        check("manifest has a name", bool(man.get("name") or man.get("short_name")))
        check("manifest declares icons", bool(man.get("icons")))
    except json.JSONDecodeError as e:
        check("manifest.json is valid JSON", False, str(e))
        check("manifest has a name", False, "unparseable")
        check("manifest declares icons", False, "unparseable")

# ── 8. Service worker present + non-trivial ───────────────────────────────
if exists("sw.js"):
    check("service worker is non-trivial", len(read("sw.js")) > 200,
          "sw.js looks empty")

# ── Report ────────────────────────────────────────────────────────────────
passed = sum(1 for ok, _, _ in results if ok)
total = len(results)

print()
print("ShuddhiQA Cloud — deploy gate")
print("=" * 60)
for ok, label, detail in results:
    mark = "PASS" if ok else "FAIL"
    line = f"  [{mark}] {label}"
    if not ok and detail:
        line += f"  -> {detail}"
    print(line)
print("=" * 60)
print(f"{passed}/{total} passed")

if passed != total:
    print(f"\n{total - passed} check(s) FAILED — fix before deploying.")
    sys.exit(1)
print("\nAll checks passed — safe to deploy.")
sys.exit(0)
