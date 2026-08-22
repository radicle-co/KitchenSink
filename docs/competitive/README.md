# Competitive Analysis

**Primary competitor (owner directive, 2026-08-21): [ReciMe](https://www.recime.app/)** — ReciMe Pty Ltd.

| Document                                                               | Contents                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`01-recime-teardown.md`](./01-recime-teardown.md)                     | Deep teardown: product, import mechanics, UI/UX, user sentiment, business model, company, funding, legal posture, confidence register                                                                |
| [`02-gap-analysis-and-strategy.md`](./02-gap-analysis-and-strategy.md) | Our specs (PR #91 @ `70087eab`) vs ReciMe: feature gap matrix, the four structural problems, our real assets, category disruption vectors, 23 concrete spec deltas, sequencing, open owner decisions |

---

## ⛔ Superseded and CORRUPTED — do not use

- `docs/competitive-analysis.md`
- `docs/competitive-analysis-v2.md`

Commit `a53d09c9` (`chore: rename sous-chef → commise across entire codebase`) blanket-replaced strings in
both files and **rewrote competitors' product names**. They now analyse "Commise® (commise.app)" and "Commise
AI (commiseai.com)" — which are **SousChef®** and **SousChefAI**, not us. The v1 summary table compares
"commise.app" against itself.

Every competitor row in those documents is untrustworthy until re-derived, because a renamed mention is
indistinguishable from a genuine one by reading alone. They also file ReciMe under "🟢 Low threat / Tier 3 —
Niche", which the traction data in `01` contradicts.

`docs/ai-enhancement-plan.md` (June 2026) is **not** corrupted and remains useful — note that its Enhancement 8
(video → recipe extraction) is rated **P2, "v1.1 or v2.0"**. Against this competitor that is the **P0** item.

---

## Evidence standard used

Primary-source first. Load-bearing figures were fetched directly from ReciMe's own surfaces (site, help
centre, gift-cards page, App Store, Play Store, Terms/Privacy/DMCA) or from independent hands-on tests.
Third-party review sites are cited only where no first-party source exists and are labelled as such — at least
one of them (`recipeone.app`) was demonstrably wrong on both pricing and the privacy default, and is treated as
unreliable throughout. Unverifiable claims are marked **UNVERIFIED**; inferences are marked **INFERENCE**.
Each document ends with, or contains, a confidence register.
