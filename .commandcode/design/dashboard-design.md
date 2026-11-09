# Design record — LLM Gateway dashboard

**Date:** 2026-11-08  
**Scope:** the static dashboard at `dashboard/dist`; 390 and 1440.  
**Register:** Product / gateway console.

## Scores

| Checkup | Smell | Review |
|---|---|---|
| 60/60 | 10/10 | 50/50 |

## What was fixed

- Replaced the glassy cyan/near-black console with the same paper/ink/teal control language as the public L1 audit report.
- Removed backdrop blur and the decorative gradient/glow lane; retained semantic status colors and the live/demo boundary.
- Buttons are 44px; labels are 12px+; the header and telemetry grid stack at mobile width.
- Added focus-visible and reduced-motion rules; mobile form controls are 16px.
- Metric cards are informational, not clickable: removed the pointer cursor and hover translation.

## Evidence

- Axe WCAG 2A/AA: 0 at 390/1440.
- One h1; no horizontal overflow; no small targets or sub-12px text.
- Vitest 41/41; ESLint clean; static build succeeds.

## Module record

`recolor` moved the console to paper/ink; `deslop` removed blur/glass; `typeset`/`interaction` applied the 12px/44px floor; `responsive` stacked the header and two-column telemetry; `a11y` added focus/reduced motion; `finish` ran build/lint/test and the audit.

## Remaining

The public portfolio display remains the site-hosted `llm-gateway-audit/` page; this dashboard is the repo's product surface and is not separately deployed.
