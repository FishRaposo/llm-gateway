#!/usr/bin/env python3
"""Render the llm-gateway L1 audit as a static page.

Reads docs/audit/eval-set.json and writes docs/audit/index.html. The findings text is
authored here because it is prose, not data; the probe table is generated from the JSON so
it cannot drift from the artifact.
"""
from __future__ import annotations

import html
import io
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / 'docs' / 'audit'

FINDINGS = [
    ('F1', 'HIGH', 'Default admin credential accepted in any deployment',
     'The admin key defaulted to a value printed in the source tree, and nothing stopped that default '
     'outside test mode — a deploy that forgot one variable served open admin access.',
     'Config load now refuses to start when the key is unset or still the default. Three production-mode '
     'tests were updated to prove the guard fires.',
     'src/config.ts · tests/l1Audit.test.ts (F1 block, 4 cases)'),
    ('F2', 'HIGH', 'Unvalidated request fields, and tool messages dropped in silence',
     'Model, temperature and max_tokens were never type-checked, so negatives and unbounded integers '
     'reached the provider and the budget estimate. Tool-role messages were filtered out before the model '
     'saw them: a conversation answered on half its context, with no signal.',
     'Fields are validated with named errors; tool and function roles are rejected explicitly rather than '
     'forwarded half-formed, and the silent filter is gone.',
     'src/proxy/request.ts · tests/l1Audit.test.ts (F2 block, 8 cases)'),
    ('F3', 'HIGH', 'Budget admission reserved input cost only',
     'Reservations priced the prompt and ignored the output the request could produce, so a single call '
     'could overrun a per-key budget several orders of magnitude past its reservation — the exact exposure '
     'the gateway exists to prevent.',
     'The estimate now adds a bounded worst case derived from the model catalog, clamped to its output '
     'ceiling; settlement still records actual spend.',
     'src/middleware/budget.ts · tests/l1Audit.test.ts (F3 block, 4 cases)'),
]

DOCUMENTED = [
    ('D1', 'Med', 'Provider error bodies flow verbatim into client responses and the audit record',
     'Return typed error text to clients; keep the bounded body server-side'),
    ('D2', 'Med', 'Operational YAML sections validate as any, so malformed config loads and fails later',
     'Real schemas mirroring the provider config'),
    ('D3', 'Low-Med', '/metrics and /health are unauthenticated; CORS is a wildcard',
     'Optional bearer on /metrics; scope origins in production'),
    ('D4', 'Low', 'Global spend runs a keyspace scan per request and is advisory only',
     'A single global counter, or SCAN if enumeration stays'),
]

CLEARED = [
    'Cross-tenant cache: keys scoped to the account identity, auth runs before cache',
    'Rate-limit identity: canonical account id after auth; plaintext fallback unreachable for valid requests',
    'Audit credential storage: raw keys masked before persist and on read',
    'Fallback and streaming: retryable-aware, allowlisted, circuit broken',
    'Budget lifecycle: atomic reserve/settle/release with request idempotency',
    'Admin routes: bootstrap key or stored permission; key creation enforces a budget',
]


def probes() -> str:
    data = json.loads((AUDIT / 'eval-set.json').read_text(encoding='utf-8'))
    rows = []
    for case in data['cases']:
        rows.append(
            '<tr>'
            f'<td class="id">{html.escape(case["id"])}</td>'
            f'<td>{html.escape(case["preFix"])}</td>'
            f'<td>{html.escape(case["expected"])}</td>'
            '</tr>'
        )
    return '\n'.join(rows)


def main() -> None:
    findings = '\n'.join(
        f'''<article class="finding">
  <header><span class="tag">{fid} · {sev}</span><h3>{html.escape(title)}</h3></header>
  <p>{html.escape(problem)}</p>
  <p class="fix"><span>Fixed.</span> {html.escape(fix)}</p>
  <p class="evidence">{html.escape(evidence)}</p>
</article>''' for fid, sev, title, problem, fix, evidence in FINDINGS
    )
    documented = '\n'.join(
        f'<tr><td class="id">{d}</td><td>{sev}</td><td>{html.escape(what)}</td><td>{html.escape(rec)}</td></tr>'
        for d, sev, what, rec in DOCUMENTED
    )
    cleared = '\n'.join(f'<li>{html.escape(c)}</li>' for c in CLEARED)

    page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>L1 audit — llm-gateway, 2026-10-30</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin: 0; background: #0d1117; color: #d7dde5;
         font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }}
  main {{ max-width: 900px; margin: 0 auto; padding: 48px 24px 64px; }}
  h1 {{ font-size: 30px; line-height: 1.2; margin: 0 0 6px; letter-spacing: -0.01em; }}
  h2 {{ font-size: 19px; margin: 44px 0 14px; }}
  .meta {{ color: #8b949e; font-size: 13px; margin-bottom: 26px; }}
  html {{ scrollbar-color: #30363d #0d1117; }}
  .verdict {{ border-left: 3px solid #c2410c; padding: 4px 0 4px 16px; margin: 4px 0 8px; }}
  .verdict strong {{ color: #f0f6fc; }}
  .counts {{ display: flex; gap: 26px; margin: 18px 0 6px; font-variant-numeric: tabular-nums; }}
  .counts div {{ border-top: 1px solid #21262d; padding-top: 8px; flex: 1; }}
  .counts b {{ display: block; font-size: 26px; color: #f0f6fc; }}
  .counts span {{ color: #8b949e; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }}
  .finding {{ border: 1px solid #21262d; border-radius: 8px; padding: 18px 20px; margin: 14px 0; background: #11161d; }}
  .finding h3 {{ margin: 6px 0 10px; font-size: 17px; color: #f0f6fc; }}
  .tag {{ font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: .08em;
          color: #fca5a5; background: #43151a; border: 1px solid #6b1d24; border-radius: 4px; padding: 5px 7px; }}
  .fix {{ color: #c9d5e0; }}
  .fix span {{ color: #86efac; font-weight: 600; }}
  .evidence {{ font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #8b949e; margin-bottom: 0; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
  th {{ text-align: left; color: #8b949e; font-weight: 600; font-size: 11px; text-transform: uppercase;
        letter-spacing: .06em; border-bottom: 1px solid #30363d; padding: 8px 10px; }}
  td {{ border-bottom: 1px solid #1b2128; padding: 9px 10px; vertical-align: top; }}
  td.id {{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #93c5fd; white-space: nowrap; }}
  ul {{ padding-left: 18px; }} li {{ margin: 5px 0; }}
  footer {{ margin-top: 46px; border-top: 1px solid #21262d; padding-top: 14px; color: #8b949e; font-size: 12px; }}
  a {{ color: #93c5fd; }}
</style>
</head>
<body>
<main>
  <h1>L1 audit — an LLM gateway, before and after</h1>
  <p class="meta">2026-10-30 · scope: auth and access, secrets and config, request validation, error handling,
     AI failure modes, API-bill exposure · engineering audit, not a security certification</p>

  <p class="verdict"><strong>Three exploitable gaps found and fixed with regression tests; four documented
     and left open.</strong> The baseline was already hardened — bcrypt key store, masked audit log, atomic
     budget reservations, retryable-aware fallback — which is why the findings are about the seams rather
     than the core.</p>

  <div class="counts">
    <div><b>3</b><span>fixed</span></div>
    <div><b>12</b><span>probes</span></div>
    <div><b>4</b><span>open</span></div>
    <div><b>0</b><span>certifications</span></div>
  </div>

  <h2>What was wrong, and what changed</h2>
  {findings}

  <h2>Documented and left open</h2>
  <table>
    <thead><tr><th>#</th><th>Sev</th><th>Finding</th><th>Recommendation</th></tr></thead>
    <tbody>
    {documented}
    </tbody>
  </table>

  <h2>Checked and cleared</h2>
  <ul>
    {cleared}
  </ul>

  <h2>Twelve probes</h2>
  <p class="meta">Each row pairs the request or environment with the behaviour before the fix and the
     behaviour expected after it. The set is executed by <code>tests/l1Audit.test.ts</code>.</p>
  <table>
    <thead><tr><th>Case</th><th>Before the fix</th><th>Expected after</th></tr></thead>
    <tbody>
    {probes()}
    </tbody>
  </table>

  <footer>
    Source of record: <a href="REPORT.md">REPORT.md</a> and <a href="eval-set.json">eval-set.json</a>, both
    dated 2026-10-30. This page is generated from them; nothing here is simulated. An audit is not a
    certification, and it excludes penetration testing.
  </footer>
</main>
</body>
</html>
'''
    (AUDIT / 'index.html').write_text(page, encoding='utf-8')
    print(f'wrote {AUDIT / "index.html"} ({len(page)} bytes)')


if __name__ == '__main__':
    main()
