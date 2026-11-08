# Portfolio images

Three 1000×750 cards for the L1 audit. Every figure in them was recomputed from the repository, not
copied from the draft report — the draft carried a wrong reservation figure and it is corrected here
and in `docs/audit/REPORT.md`.

| File | What it shows | Source of the content |
|---|---|---|
| `l1-01-cover.png` | The three HIGH findings with the file and test block each one lives in, plus the eight cleared areas | `docs/audit/REPORT.md`, 2026-10-30 |
| `l1-02-exposure.png` | The F3 dollars: $0.000005 reserved against $0.1229 possible, with the pre-fix and post-fix function bodies | `src/middleware/budget.ts` at `977c5d7^` and `977c5d7`; `src/shared/pricing.ts` |
| `l1-03-probes.png` | The twelve probes by family, and the five findings left open with their recommendations | `eval-set.json`; `REPORT.md` D1–D5 |

**How the numbers were derived** (gpt-4o: $5/1M in, $15/1M out; `maxOutputTokens` 4096 in the catalogue):

- A one-token prompt reserved `1 × 0.000005` = **$0.000005** before the fix.
- `max_tokens: 8192` could bill `8192 × 0.000015` = **$0.122880**.
- After the fix the reservation is `0.000005 + min(8192, 4096) × 0.000015` = **$0.061445**.
- Because that is a clamp, not a guarantee, it is recorded as **D5** rather than claimed as a bound.

The code excerpts are verbatim from those commits. Cards were rendered from HTML at 2× and downscaled
to 1000×750 with Lanczos.
