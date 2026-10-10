# Product Plan

**Owner**: Director of Product
**Status**: Executive draft
**Last updated**: 2026-05-13

## Product strategy stack

| Layer            | Commise definition                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Company mission  | Help households cook better, waste less, and feel confident in the kitchen.                                             |
| Company strategy | Build the trusted consumer platform for recipe-centered cooking workflows.                                              |
| Product strategy | Win by connecting recipes, planning, grocery, cooking, nutrition, AI, creators, and education into one loop.            |
| Roadmap          | Follow [`v1-launch-plan.md`](../v1-launch-plan.md): Beta through `M4`, AI in `M5`, 1.0 at `M6`, expansion in `M7`–`M8`. |
| Product goals    | Activation, retention, paid conversion, and creator/content supply after core loop validation.                          |

AI is a strategic accelerant in this stack, not a separate product lane. The
roadmap should treat `005-ai-integration` as the moment Commise starts setting
expectations for AI-generated recipes: user control, preview before save,
default-private generated recipes, explicit consent for external agents,
confidence messaging, and nutrition boundaries.

## Product principles

1. **Recipes are the hub**: every workflow should attach to recipe objects when possible.
2. **Useful before premium**: free users must get real cooking utility before seeing upgrade pressure.
3. **Trust beats novelty**: source confidence, attribution, nutrition caveats, AI guardrails, and user control are mandatory.
4. **Workflow over feature count**: each feature must strengthen the loop from idea → table.
5. **Design for households**: planning, grocery, cooking, and nutrition are multi-person contexts even when one user owns the account.
6. **AI should reduce effort, not own judgment**: users approve generated recipes, substitutions, grocery mappings, and nutrition interpretations.
7. **Meet AI users where they are**: users will ask ChatGPT, Gemini, and other agents for cooking help. Commise should provide consented agent access and durable recipe storage rather than forcing every interaction into the app.
8. **Generated content starts private**: AI-created recipes should enter the graph as private, editable user-owned drafts until the user deliberately shares or publishes them.
9. **No ungrounded nutrition authority**: AI can support wellness-oriented cooking, but the product must avoid medical, diagnostic, or treatment claims.

## Non-goals for v1

- Full marketplace-scale creator economy before core household retention is proven.
- Native App Store / Play Store in-app subscription purchase flow unless scope changes.
- Medical nutrition advice, diagnosis, or treatment recommendations.
- Deep single-retailer dependency in UX or IA.
- Generic AI chat as the primary value proposition.
- Public-by-default AI-generated content.
- AI-generated medical, allergy, or nutrition advice without clear caveats and user verification.
- Enterprise/B2B food-service workflows.

## Launch sequencing

| Stage                  | Product outcome                                              | Primary proof                                               |
| ---------------------- | ------------------------------------------------------------ | ----------------------------------------------------------- |
| `M0`–`M1` Foundation   | Auth, core recipes, USDA data, importing blockers addressed. | Critical blockers cleared; recipe hub works.                |
| `M2`–`M3` Utility loop | Digitization, grocery, cooking mode integrated.              | User can capture/create → plan/shop/cook.                   |
| `M4` Beta              | Meal planning and Beta criteria complete.                    | Beta cohort can use weekly household loop.                  |
| `M5` AI                | AI adds contextual acceleration.                             | AI improves activation/retention without trust regressions. |
| `M6` 1.0               | Subscription monetization ready.                             | Paid conversion and retention gates passed.                 |
| `M7`–`M8` Expansion    | Creators, cooking school, notifications.                     | Creator/content growth loop tested.                         |

## Discovery cadence

Adopt a continuous-discovery operating rhythm:

- Weekly customer interviews during pre-Beta and Beta.
- Product trio review: Product, Design, Engineering.
- Opportunity-solution tree for core loop friction.
- Assumption tests before large builds: pricing, grocery provider expectations, AI trust, nutrition language, creator monetization.
- Monthly executive product review using this packet plus [`verify-snapshot.md`](../verify-snapshot.md).

AI discovery should specifically test:

- Whether AI-generated recipes increase first-week recipe creation, saves, and
  cooking sessions.
- Whether users prefer in-app generation, external-agent flows, or both.
- Whether confidence indicators and guard copy increase trust without adding
  too much friction.
- Whether BYOK setup is understandable outside a power-user segment.
- Which audience segments will pay for AI acceleration versus expect it in the
  free utility tier.

## Growth model

| Growth component | Commise approach                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| Engine           | Retained households create/import recipes, plan meals, generate lists, cook, and share outcomes.                     |
| Fuel             | Recipes, creator content, user household data, AI-assisted imports, and grocery/nutrition integrations.              |
| Lubricants       | Better onboarding, import success, grocery accuracy, cooking-mode confidence, trust copy, faster nutrition matching. |
| Turbo boosts     | Creator partnerships, SEO recipe tools, launch PR, seasonal campaigns, affiliate grocery experiments.                |

Retention is the operating center. If households do not return weekly to plan/shop/cook, acquisition and monetization will not compound.

## Metrics tree

| Outcome                     | Input metrics                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| Weekly activated households | Signup completion, first recipe added/imported, first plan/list/cook session, return within 7 days |
| Recipe graph growth         | Recipes created/imported, successful imports, ingredient match rate, public/clone/share actions    |
| Household utility           | Meal plans created, grocery lists generated, cooking sessions completed, offline/degraded success  |
| Monetization                | Premium impressions, trial starts, paid conversion, subscription retention, premium feature usage  |
| Creator expansion           | Creator profiles activated, public recipes published, course lessons published, creator revenue    |

| AI cooking intent | BYOK setup completion, first generation success, generated preview-to-save rate, generated recipe cooked, external-agent consent grants, consent revocation success |

## Product operating rules

- Weekly burn-down review of `verify-report.md` criticals/warnings.
- No Beta approval with open launch-scope criticals.
- No 1.0 approval without pricing validation and Beta retention evidence.
- No M5 AI approval without confidence messaging, private-by-default generated saves, external-agent consent boundaries, and nutrition caveats implemented and verified.
- No high-fidelity UX approval without validated flows, states, and risks for each design spec.
- No paid acquisition until the activation loop and retention curve are measurable.
