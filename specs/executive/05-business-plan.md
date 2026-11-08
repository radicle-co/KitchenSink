# Business Plan

**Owner**: Director of Product
**Status**: Executive draft
**Last updated**: 2026-05-13

## Business model

Commise should use a layered model:

1. **Free household utility**: recipe management, import, manual planning, grocery lists, and cooking mode enough to build trust and retention.
2. **Consumer subscription**: premium AI acceleration, private recipes, advanced nutrition, automation, online-order conveniences, household collaboration, and advanced planning.
3. **Creator monetization**: creator profiles, paid content/courses, affiliate/shoppable recipes, and revenue share.
4. **Commerce upside**: grocery affiliate/partner revenue after user trust and provider reliability are established.

AI changes the business model by increasing both engagement potential and
substitution pressure. Free utility should prove the recipe graph and weekly
household loop. Paid tiers should monetize leverage: faster planning,
context-aware AI, advanced automation, premium nutrition utilities, and
professional or creator workflows. AI should not be used to hollow out the free
product before users trust the system.

## Target customers

| Segment                    | Need                                                                 | Wedge                                                                                | Strategic role                          |
| -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------- |
| Busy household planner     | Reduce weekly meal/grocery burden.                                   | Meal plan → grocery list → cooking loop.                                             | Primary retention segment.              |
| Recipe collector/cook      | Organize, import, cook, and improve recipes.                         | Best-in-class recipe hub, import, and AI cleanup.                                    | Recipe graph growth segment.            |
| Nutrition-conscious cook   | Cook toward goals without clinical logging friction.                 | Recipe-native nutrition planning with clear wellness boundaries.                     | Premium utility segment.                |
| AI-curious power user      | Generate and adapt recipes safely across tools.                      | Context-aware AI, BYOK, external-agent OAuth, and guardrails.                        | Early AI adoption and feedback segment. |
| Busy parents and families  | End dinner debates and support picky eaters, budgets, and schedules. | Household preferences, family-friendly AI planning, grocery lists, and cooking mode. | High-pain acquisition segment.          |
| Budget and waste reducer   | Use what is already available and avoid unnecessary shopping.        | Pantry-aware prompts, substitutions, leftovers, and list discipline.                 | Clear ROI messaging segment.            |
| Food creator               | Monetize useful cooking content.                                     | Creator profiles, shoppable recipes, courses, and attribution.                       | Post-core expansion supply segment.     |
| Cooking educator / learner | Teach or learn skills through recipe-linked lessons.                 | Cooking school tied to the recipe graph.                                             | Post-1.0 marketplace expansion.         |

Do not position Commise as a generic consumer app for everyone who cooks.
Lead with high-frequency, high-pain segments: busy household planners, families,
recipe collectors, nutrition-conscious cooks, budget/waste reducers, and
AI-curious power users. Creator and education segments become expansion loops
after the core household loop proves retention.

## Pricing hypothesis

Final pricing requires validation. Initial test bands:

| Tier    | Hypothesis                            | Rationale                                                                |
| ------- | ------------------------------------- | ------------------------------------------------------------------------ |
| Free    | $0                                    | Maximize recipe graph growth and household activation.                   |
| Plus    | $6.99–$9.99/month                     | Advanced planning, private content, premium cooking/nutrition utilities. |
| Pro/AI  | $12.99–$19.99/month                   | Higher-cost AI, BYOK conveniences, advanced nutrition, automation.       |
| Creator | Revenue share + optional subscription | Aligns platform success with creator earnings.                           |

Do not finalize pricing until Beta tests willingness-to-pay and retention by segment.

> **2026-10-26.** The owner set prices for two paid plans: Pro at $9.99 a month or $99.99 a year, and Pro with AI at
> $19.99 a month or $199.99 a year (`010-FR-041`). The owner also says there are three plans and two levels of AI
> credits. The current table is 010's [plan register](../010-subscriptions/spec.md#plan-register).

AI pricing requires special validation. BYOK can reduce platform inference-cost
exposure and appeal to power users, but it may add setup friction for household
users. Test whether mainstream users understand BYOK, whether they prefer a
platform-managed AI allowance, and which AI features actually improve paid
conversion: generation volume, planning automation, instruction optimization,
external-agent access, or advanced nutrition utilities.

## Go-to-market strategy

### Phase 1 — Validation and Beta

- Recruit households from cooking, meal-prep, nutrition, and productivity communities.
- Focus messaging on weekly cooking burden, not AI novelty.
- Validate recipe import, planning, grocery, and cooking-mode retention.
- Interview every high-retention Beta household.
- Recruit a small AI-curious cohort to test whether generated recipes become
  saved, planned, shopped, cooked, and reused recipes.
- Track whether AI reduces weekly planning time and increases recipe graph
  growth without creating trust regressions.

### Phase 2 — 1.0 launch

- Position as “your cooking operating system,” not “recipe app.”
- Use creator and content partnerships as credibility and acquisition wedges.
- Launch with high-quality example workflows, not a broad unfocused feature blast.
- Prioritize content/SEO and creator-led distribution before heavy paid acquisition.
- Position AI as trusted cooking assistance inside the operating system:
  generate, save privately, adapt, shop, cook, and improve.
- Publish clear AI expectations before launch: generated content can be wrong,
  users stay in control, nutrition is not medical advice, and public sharing is
  deliberate.

### Phase 3 — Expansion

- Add creator profiles, cooking school, and notifications after core loop retention is proven.
- Test affiliate and shoppable recipe revenue once grocery flow quality is high.
- Build marketplace/network loops only after supply and demand behaviors are visible.
- Use creator and educator content to improve AI trust through attribution,
  structured recipes, lessons, and human-reviewed exemplars.

## Operating model

| Function         | Near-term responsibility                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Product          | Strategy, prioritization, discovery cadence, metrics, risk gates.                                 |
| Design           | Low-/mid-fidelity UX using [`ux-handoff/`](../ux-handoff/README.md), then validated design specs. |
| Engineering      | Burn down verification blockers, implement milestone ladder, instrument telemetry.                |
| Data/Analytics   | Tracking plan, activation/retention dashboards, pricing experiment measurement.                   |
| Legal/Compliance | Nutrition disclaimers, AI disclosure, privacy, creator/payment terms.                             |
| Growth/Marketing | Beta recruitment, positioning tests, creator partnership pipeline.                                |

AI adds specific operating responsibilities:

- Product owns the AI trust promise and decides where AI accelerates the loop.
- Design validates disclosure, confidence, fallback, consent, and recovery UX.
- Engineering implements provider abstraction, consent enforcement, private
  defaults, telemetry, and safety checks.
- Data measures generated recipe quality, save/cook/reuse behavior, and trust
  regressions.
- Legal reviews AI disclosure, health/nutrition language, privacy, creator
  attribution, and external-agent consent.

## Financial planning assumptions

Use ranges until validation data exists:

- CAC should remain low during Beta; use community, creator, SEO, waitlist, and referral channels before paid acquisition.
- AI gross margin must be protected through provider routing, quotas, BYOK, caching, and premium gating.
- Paid conversion should be evaluated only among retained, activated households; top-of-funnel conversion alone is not meaningful.
- Creator revenue should be modeled as upside, not required for the first retention proof.
- AI-driven acquisition should be evaluated by retained recipe graph growth, not
  prompt volume. Generations that are not saved, cooked, reused, or shared do
  not create durable business value.

## Board-level milestones

| Milestone | Board question                              | Required evidence                                                              |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| Pre-Beta  | Can users complete the core household loop? | End-to-end demo + `0 CRITICAL, 0 WARNING` for Beta-scope verify reports.       |
| Beta      | Do households return weekly?                | D7/D30 retention, weekly activated households, qualitative interview evidence. |
| 1.0       | Will users pay?                             | Pricing tests, conversion, churn, premium usage, support burden.               |
| Expansion | Can the ecosystem compound?                 | Creator supply, content engagement, shoppable/affiliate performance.           |

| AI gate | Can Commise define trusted AI cooking behavior? | AI activation, generated recipe save/cook/reuse, disclosure comprehension, low unsafe-output reports, consent/revocation success. |

## Executive recommendation

Approve the next phase as a disciplined validation investment, not a scale investment. The product vision is compelling, but the business should earn the right to scale by proving the weekly household loop, paid willingness-to-pay, and trustworthy AI/nutrition behavior.
