# Business Case

**Owner**: Director of Product
**Status**: Executive draft
**Last updated**: 2026-05-13

## Decision ask

Approve continued investment in Commise through Beta readiness, with funding gated by measurable artifact burn-down, user validation, and activation/retention evidence.

## Evidence boundary

This business case supports continued validation investment, not scale investment. It is based on the current specs corpus, competitor/market research, and product-leadership frameworks. It does not yet include first-party retention, conversion, CAC, pricing, or cohort data; those must be generated before public launch or paid acquisition approval.

## Executive summary

Commise is a high-upside product hypothesis because it targets a persistent consumer job: deciding what to cook, turning that decision into groceries, cooking successfully, and improving over time. The current product corpus is broader than a recipe app and more defensible than a generic AI assistant if Apron proves repeated household use and trust. It can become Apron's consumer platform for cooking, grocery, nutrition, creators, and education, but that claim requires Beta evidence before it becomes an investment certainty.

The AI market signal raises both urgency and risk. Consumers are already using
general AI systems to discover recipes, modify recipes, plan meals, and create
grocery lists. If Commise does not provide integrated AI assistance, users may
skip the app for ideation and planning, leaving Commise as a lower-frequency
storage utility. If Commise executes AI well, it can define what users should
expect from AI-generated recipes: preview before save, default-private storage,
source and confidence cues, clear nutrition limits, and connection to grocery
and cooking execution.

The business case is strong enough to continue, but not strong enough for
aggressive paid acquisition or public launch yet. The next investment gate
should fund UX discovery, Beta-scope engineering remediation, pricing
validation, instrumentation, and a disciplined AI trust layer that turns AI
intent into retained household workflow.

## Customer problem

Home cooks and households face repeated friction:

- Recipes are scattered across websites, screenshots, social feeds, books, and memory.
- Meal planning is separate from recipe management.
- Grocery lists are disconnected from meal intent, nutrition goals, pantry context, and store availability.
- Nutrition tracking is too clinical for everyday cooking.
- AI tools generate ideas, but users still need a trustworthy place to save,
  adapt, shop, cook, and revisit those ideas.
- Creators publish content but rarely own monetization and utility around that content.

## Proposed solution

Commise provides one connected workflow:

1. Capture or create recipes.
2. Normalize ingredients and nutrition data.
3. Plan meals for a household.
4. Generate and manage grocery lists.
5. Cook with guided mode.
6. Use AI assistance with context, guardrails, and explicit user control.
7. Unlock premium planning, nutrition, creator, education, and commerce experiences.

## AI investment thesis

AI should be treated as a strategic distribution and retention layer, not a
standalone feature. General AI systems can answer "what should I cook?" but
they do not automatically own the user's household recipe graph, pantry
assumptions, grocery behavior, saved preferences, cooking history, creator
relationships, or subscription context.

Commise's opportunity is to become the trusted persistence layer around AI
cooking intent:

1. **Capture**: generate, import, or receive recipe ideas from in-app AI and
   external agents.
2. **Validate**: show confidence indicators, source/provenance cues, nutrition
   caveats, and recovery paths.
3. **Persist**: save generated recipes as private, user-owned recipe objects by
   default.
4. **Execute**: turn recipes into plans, lists, cooking sessions, and follow-up
   improvements.
5. **Learn**: use household context to make future AI assistance more useful
   than generic chat.

This is materially stronger than competing on prompt-to-recipe generation alone.
It also protects the recipe hub: AI output becomes another input into the graph,
not a replacement for the app.

## Why now

- AI has made cooking assistance easy to demo but hard to trust. Trust, context, and workflow integration are the differentiators.
- Consumers are already using AI for recipe discovery, meal planning, recipe
  modification, and grocery-list generation. This creates a near-term
  substitution threat for static recipe apps.
- Grocery, nutrition, creator, and education experiences are converging around food decisions.
- Existing competitors are fragmented by job-to-be-done.
- Food creators need direct monetization as traffic and ad models become less reliable.

## Investment thesis

| Thesis                                                         | Product implication                                                                                                          |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Household cooking is a repeated behavior, not a one-time task. | Optimize for retention and routine formation, not one-off recipe generation.                                                 |
| Recipes are the data graph.                                    | Make recipes the hub for planning, shopping, nutrition, cooking, and creator attribution.                                    |
| AI is table stakes, not the moat.                              | Use AI to reduce friction inside workflows; build defensibility through context and trust.                                   |
| Creators need monetizable utility.                             | Turn creator content into shoppable, cookable, learnable experiences.                                                        |
| AI answers need persistence.                                   | Convert ephemeral AI output into private, editable, attributable recipe objects that power planning, shopping, and cooking.  |
| Trust is the product surface.                                  | Make confidence, disclosures, source clarity, consent, and nutrition caveats visible before users rely on generated content. |

## Success metrics

| Stage          | Primary metric                                       | Supporting metrics                                                                                     |
| -------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Alpha/internal | Task completion through recipe → grocery → cook loop | Crash-free sessions, import success, nutrition match rate, grocery generation completion               |
| Beta           | Weekly activated households                          | D7/D30 retention, recipes created/imported, plans created, lists generated, cooking sessions completed |
| 1.0            | Paid conversion from retained households             | Trial-to-paid, churn, ARPU, premium feature usage, creator attach rate                                 |
| Expansion      | Creator/content supply growth                        | Active creators, published recipes/courses, creator revenue, shoppable interactions                    |

AI-specific validation should be added before 1.0 approval:

| AI outcome       | Input metrics                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- |
| AI activation    | Provider setup completion, first generation success, first generated recipe save                                 |
| AI quality       | Generated preview-to-save rate, low-confidence rate, fallback recovery success                                   |
| AI retention     | Repeat AI-assisted planning, generated recipe cooked, generated recipe reused                                    |
| Agent ecosystem  | External-agent consent grants, scoped read/write usage, revocation success                                       |
| Trust and safety | Disclosure visibility, nutrition caveat display, private-by-default save compliance, user-reported unsafe output |

## Key risks

| Risk                                                             | Severity | Mitigation                                                                                                                                        |
| ---------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product is too broad before PMF.                                 | High     | Stage launch by loops: core recipe loop, planning/grocery/cooking loop, then premium/AI.                                                          |
| Verification blockers delay launch.                              | High     | Treat [`verify-snapshot.md`](../verify-snapshot.md) as a weekly executive metric.                                                                 |
| AI features commoditize.                                         | High     | Anchor differentiation in workflow integration, persistence, consented external-agent access, and trust.                                          |
| General AI captures recipe intent before Commise does.           | High     | Make AI generation/import/save a first-class path into the recipe graph and support external-agent OAuth instead of fighting user behavior.       |
| AI output creates trust, nutrition, allergy, or safety failures. | High     | Enforce confidence indicators, hallucination guard copy, nutrition disclaimers, private default saves, human review, and non-medical positioning. |
| Grocery integrations create partner dependency.                  | Medium   | Design provider-agnostic UX; start with list utility before deep ordering.                                                                        |
| Nutrition creates compliance risk.                               | Medium   | Avoid medical-advice framing; add clear disclaimers and source confidence.                                                                        |
| Creator/cooking school expansion distracts.                      | Medium   | Keep `012`/`013` post-1.0-in-v1 and use as strategic expansion, not Beta blocker.                                                                 |

## Recommendation

Proceed with disciplined staged investment:

1. Fund Beta-scope remediation and UX discovery.
2. Validate willingness-to-pay and household retention before scaling paid acquisition.
3. Advance AI integration as an M5 strategic accelerant only after the core
   recipe, planning, grocery, and cooking loop is reliable.
4. Treat the AI launch as a trust launch: no generic chat surface without
   preview, consent, confidence, fallback, and nutrition guardrails.
5. Keep creator/education as strategic expansion until the core household loop demonstrates retention.
