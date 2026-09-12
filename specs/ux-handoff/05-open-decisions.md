# UX Open Decisions and Watch Items

**Status**: UX can start low-/mid-fidelity work now. The decisions below are resolved directions for first-pass mockups; UX should annotate any validation concerns before high-fidelity approval.

## Resolved directions for high-fidelity mockups

| ID      | Decision                                          | Why it matters                                                                                               | Current direction                                                                                                                                                                                                                              | Owner                      |
| ------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| UX-D001 | Offline strategy for meal plans and grocery lists | Mobile shoppers and cooks will expect continuity in poor connectivity.                                       | Mock cached read-only meal plans/grocery lists after first load, queued simple check-offs/manual item edits where supported, visible sync-pending status, retry, and conflict-resolution states.                                               | Product + Engineering      |
| UX-D002 | Final app shell pattern                           | Web and mobile IA must stay understandable without bloating primary navigation.                              | Web: persistent left rail for Home/Recipes/Meal Planning/Grocery Lists/Nutrition/AI plus avatar/account menu. Mobile: bottom tabs Home/Recipes/Plan/Grocery/AI plus header/avatar account access; Cooking Mode is a full-screen focused shell. | UX                         |
| UX-D003 | Home personalization ranking                      | Home modules are defined; ranking logic affects layout and empty states.                                     | Start with deterministic priority: continue, this week, recent recipes, shopping status, nutrition, explore, premium nudge. Allow users to reorder/hide non-critical modules after onboarding.                                                 | Product                    |
| UX-D004 | Store-provider UX constraints                     | Provider API details and sandbox behavior are not fully verified, and UX should not overfit to one retailer. | Mock a provider-agnostic connected-store pattern: connect store, choose provider/location, review substitutions, submit order, track status. Keep Walmart/Instacart as examples only where copy needs examples, not as the default IA.         | Product + Engineering      |
| UX-D005 | Nutrition compliance language                     | Nutrition planning must avoid medical-advice framing.                                                        | Separate Nutrition Planning from Dieting/protocol guidance. Use planning/compliance language, avoid diagnosis/treatment wording, and add "This is not medical advice" where advice could be inferred.                                          | Product + Legal/Compliance |

## UX-watch items

| ID      | Item                                | Guidance                                                                                                                                       |
| ------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-W001 | Native mobile billing/IAP           | Out of scope for v1; mobile deep-links to web checkout/customer portal. Do not design App Store/Play Store purchase flow unless scope changes. |
| UX-W002 | Instacart integration               | Deferred behind partner agreement. Do not make Instacart the default store connection in v1 mockups.                                           |
| UX-W003 | Trainer/client nutrition workflows  | Premium workflow exists, but can be lower fidelity unless v1 scope confirms trainer role launch.                                               |
| UX-W004 | Creator profiles and cooking school | Specs 012/013 exist but are not part of the core handoff package unless leadership pulls them into v1.                                         |
| UX-W005 | AI provider setup                   | BYOK is the documented direction; keep provider setup transparent and avoid implying Commise pays for provider usage unless product changes.   |

## Ready-for-UX checklist

Before UX marks a flow high-fidelity ready:

- [ ] Screen appears in [02-screen-inventory.md](./02-screen-inventory.md).
- [ ] Flow appears in [03-cross-feature-flows.md](./03-cross-feature-flows.md) or a linked feature journey.
- [ ] Empty/loading/error/offline/permission/paywall states are accounted for where applicable.
- [ ] Web and mobile variants exist or a parity exception is documented.
- [ ] Premium/free behavior is explicit.
- [ ] Source feature docs are linked in the design file.
- [ ] Any validation concern affecting the screen is annotated with the relevant `UX-D` or `UX-W` ID.
