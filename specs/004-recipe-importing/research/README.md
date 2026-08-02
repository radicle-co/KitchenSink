# Research Index — 004 Recipe Importing

**Regenerated**: 2026-08-02

| Document                                       | Covers                                                    | Status                        |
| ---------------------------------------------- | --------------------------------------------------------- | ----------------------------- |
| [research.md](./research.md)                   | Original RQ-1..RQ-9 investigation                         | Retained (see note below)     |
| [codebase-analysis.md](./codebase-analysis.md) | The shipped codebase as of `main` — **regenerated**       | Current                       |
| [tech-stack.md](./tech-stack.md)               | Registry-verified dependency selections — **regenerated** | Current                       |
| [competitors.md](./competitors.md)             | Comparator set and import-feature comparison              | Current (normalization noted) |
| [ux-patterns.md](./ux-patterns.md)             | Import UX patterns and prior art                          | Current                       |
| [metrics-roi.md](./metrics-roi.md)             | Value case and cost model                                 | Current                       |

## Note on `research.md`

The original research document is **retained as a historical record** of the investigation that preceded the
feature. Two of its conclusions have since been superseded and should not be relied on:

1. **Instagram oEmbed** — RQ-era research assumed a public, unauthenticated oEmbed endpoint. That endpoint was
   withdrawn on 2020-10-24; oEmbed now requires a Meta app credential and App Review. See owner decision D-002.
2. **Comparator set (W-003)** — `research.md` RQ-9 discusses Paprika / Mealime / Whisk / Saffron, while
   `competitors.md` analyses Paprika / Mealie / Tandoor / Plan To Eat. The divergence was flagged as an open
   warning for three months. **Resolved**: `competitors.md` carries the canonical set, because it compares
   products with a genuinely comparable _import_ feature, which is what 004 needed to learn from. `research.md`
   RQ-9 is superseded, not wrong — it was answering a broader question.

Where `research.md` and the regenerated documents disagree, the regenerated documents win.
