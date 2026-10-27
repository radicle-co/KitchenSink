# UX Screen Inventory

**Status**: Ready for low-/mid-fidelity mockup planning.

This inventory defines the screens UX must account for before producing high-fidelity design. Screens marked **Core v1** are required for the initial useful product. **Premium v1** screens are required if the subscription scope ships. **Later** screens can be explored but should not block MVP mockups.

## Global and account

| Screen                          | Priority            | Platforms    | Source docs                   | Required mockup notes                                                              |
| ------------------------------- | ------------------- | ------------ | ----------------------------- | ---------------------------------------------------------------------------------- |
| Login / signup                  | Core v1             | Web + mobile | 002 Auth product spec         | Social login, email/password fallback if supported, callback/loading/error states. |
| Auth callback / session restore | Core v1             | Web + mobile | 002 Auth journeys             | Must communicate progress and recover from expired/failed sessions.                |
| Account profile                 | Core v1             | Web + mobile | 002 Auth product spec         | Profile, linked providers, session/device status.                                  |
| Account deletion/export         | Core v1             | Web + mobile | 002 Auth product spec         | Destructive confirmation and recovery guidance.                                    |
| Connected agents                | Premium/advanced v1 | Web + mobile | 005 AI product spec           | OAuth scopes, revoke, read/write separation.                                       |
| Subscription status/manage      | Premium v1          | Web + mobile | 010 Subscription product spec | Web portal/deep-link on mobile; clear current tier and renewal/lapse state.        |

## Home

| Screen                   | Priority | Platforms    | Source docs              | Required mockup notes                                                                                                   |
| ------------------------ | -------- | ------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Signed-in Home dashboard | Core v1  | Web + mobile | 001 product spec + UX IA | Personalized modules: continue, week plan, recent recipes, nutrition snapshot, shopping status, explore, premium nudge. |
| New-user starter Home    | Core v1  | Web + mobile | 001, 002, 010            | Starter checklist and useful empty state; no blank dashboard.                                                           |
| Returning-user Home      | Core v1  | Web + mobile | 001, 006, 007, 008, 009  | Recents and next actions based on actual user objects.                                                                  |

## Recipes

| Screen                        | Priority | Platforms    | Source docs | Required mockup notes                                                                            |
| ----------------------------- | -------- | ------------ | ----------- | ------------------------------------------------------------------------------------------------ |
| Recipe library                | Core v1  | Web + mobile | 001         | Search, filters, collections, public/private badges, empty state.                                |
| Public recipe explore         | Core v1  | Web + mobile | 001, 012    | Discover public recipes, clone/share attribution.                                                |
| Recipe detail/card            | Core v1  | Web + mobile | 001, 003    | Ingredients, steps, nutrition card, source/attribution, actions: cook, plan, shop, share, clone. |
| Create/edit recipe            | Core v1  | Web + mobile | 001         | Structured fields, ingredients with USDA match status, instructions, photos, visibility.         |
| Version/conflict resolution   | Core v1  | Web + mobile | 001         | User-controlled conflict resolution; no silent overwrite.                                        |
| Import recipe                 | Core v1  | Web + mobile | 004         | URL/Instagram/photo entry, attribution, legal/paywall warning states.                            |
| Ingredient/food search picker | Core v1  | Web + mobile | 003         | Branded/generic disambiguation, pending/fetched/not-found/failed states.                         |

## Meal planning

| Screen                   | Priority   | Platforms    | Source docs     | Required mockup notes                                            |
| ------------------------ | ---------- | ------------ | --------------- | ---------------------------------------------------------------- |
| Meal plans list          | Core v1    | Web + mobile | 006             | Start plan, templates, recents.                                  |
| Week planner             | Core v1    | Web + mobile | 006             | Calendar grid, meal slots, drag/drop or mobile equivalent, gaps. |
| Month planner            | Core v1    | Web + mobile | 006             | Higher-level planning view; may be secondary for mobile.         |
| Create/edit meal plan    | Core v1    | Web + mobile | 006             | Date range, slots, household servings, template choice.          |
| Recipe-to-plan add sheet | Core v1    | Web + mobile | 006 + 001       | Add recipe to selected meal/date without leaving recipe context. |
| Grocery handoff review   | Core v1    | Web + mobile | 006 + 007       | Confirm generated list, exclusions, quantities.                  |
| AI meal plan suggestions | Premium v1 | Web + mobile | 005 + 006 + 010 | Premium gate, confidence guard, editable suggestions.            |

## Grocery lists and ordering

| Screen                | Priority   | Platforms                  | Source docs | Required mockup notes                                                                                                   |
| --------------------- | ---------- | -------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| Grocery lists page    | Core v1    | Web + mobile               | 007         | Dedicated management/history/start page.                                                                                |
| Generated-list review | Core v1    | Web + mobile               | 007         | Aggregated/deduped items, pantry exclusions, source meal-plan link.                                                     |
| In-store list         | Core v1    | Mobile primary, web parity | 007         | One-handed check-off, aisle grouping, cached offline-friendly display, sync-pending queued simple edits.                |
| Manual shopping list  | Core v1    | Web + mobile               | 007         | Create list without meal plan.                                                                                          |
| Store connection      | Premium v1 | Web + mobile               | 007 + 010   | Provider-agnostic connected-store setup; Walmart/Instacart appear only as examples or deferred partner-specific labels. |
| Online order review   | Premium v1 | Web + mobile               | 007         | Mapped products, substitutions, unavailable items, final handoff.                                                       |
| Order status          | Premium v1 | Web + mobile               | 007         | Polling-based status, unavailable/outage states.                                                                        |

## Nutrition planning

| Screen                | Priority           | Platforms    | Source docs | Required mockup notes                                              |
| --------------------- | ------------------ | ------------ | ----------- | ------------------------------------------------------------------ |
| Nutrition dashboard   | Core/Premium split | Web + mobile | 009         | Current goals, planned-vs-target, compliance status.               |
| Goal setup            | Core v1            | Web + mobile | 009         | Calories/macros and household/person variation.                    |
| Meal breakdown        | Core v1            | Web + mobile | 009 + 006   | Link meal-plan slots to nutrition impact.                          |
| Weekly nutrition view | Core v1            | Web + mobile | 009         | Trend, gaps, excesses.                                             |
| Deficiency alert      | Premium v1         | Web + mobile | 009         | Explain low micronutrients, suggest actions, avoid medical claims. |
| Trainer/client plan   | Premium/later      | Web + mobile | 009 + 010   | Consent, boundaries, role states.                                  |

## Cooking Mode

| Screen            | Priority                          | Platforms    | Source docs | Required mockup notes                                              |
| ----------------- | --------------------------------- | ------------ | ----------- | ------------------------------------------------------------------ |
| Cooking step      | Core v1                           | Web + mobile | 008         | Large readable active step, ingredients context, progress.         |
| Timer active      | Core v1                           | Web + mobile | 008         | Countdown, audible/visual/vibration, multiple timers if supported. |
| Ingredients panel | Core v1                           | Web + mobile | 008         | Easy access without losing step context.                           |
| Voice control     | Later / accessibility exploration | Web + mobile | 008         | Explore compact voice command affordances.                         |
| Completed cooking | Core v1                           | Web + mobile | 008         | Rate/save notes, return to meal plan/recipe.                       |

## AI and subscriptions

| Screen                             | Priority            | Platforms                     | Source docs | Required mockup notes                                         |
| ---------------------------------- | ------------------- | ----------------------------- | ----------- | ------------------------------------------------------------- |
| AI chat/generate                   | Premium v1          | Web + mobile                  | 005 + 010   | BYOK setup if missing, confidence guard, preview before save. |
| AI recipe preview                  | Premium v1          | Web + mobile                  | 005         | Accept/reject; defaults private.                              |
| AI provider setup                  | Premium v1          | Web + mobile                  | 005         | BYOK provider choice and key handling explanation.            |
| Agent consent                      | Premium/advanced v1 | Web + mobile                  | 005         | Separate `recipes:read` and `recipes:create` consent.         |
| Pricing page                       | Premium v1          | Web primary, mobile deep-link | 010         | $6.99/mo, $59.99/yr, 14-day trial, feature comparison.        |
| Paywall modal/bottom sheet         | Premium v1          | Web + mobile                  | 010         | Contextual feature preview and respectful CTA.                |
| Billing history / restore purchase | Premium v1          | Web + mobile                  | 010         | Web billing portal; mobile deep-link/platform caveat.         |

> **2026-10-26.** The Pricing page row above is out of date. See 010's [plan register](../010-subscriptions/spec.md#plan-register) and its subscription page requirements (`010-FR-042a` to `FR-042k`).
