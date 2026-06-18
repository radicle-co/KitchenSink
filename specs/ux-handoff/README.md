# Commise UX Handoff Package

**Owner**: Product
**Status**: Ready for UX discovery and low-/mid-fidelity mockups; high-fidelity design remains gated by open decisions listed in [05-open-decisions.md](./05-open-decisions.md).
**Last updated**: 2026-05-10

This package is the portfolio-level UX source of truth for Commise. Feature-level product specs, journeys, and wireframes are distributed across `specs/001-*` through `specs/014-*`; `001`–`010` have split-out journeys and wireframes, while `011`–`014` currently keep journey/mockup context inside their product specs. UX should use this directory as the starting point, then drill into the linked feature specs for detail.

For executive strategy, market, business-case, and readiness framing, use the companion [executive product packet](../executive/README.md).

## What UX can start now

UX can begin:

- App-wide information architecture and navigation models for web and mobile.
- Low-/mid-fidelity mockups for the signed-in Home experience, Recipes, Meal Planning, Grocery Lists, Cooking Mode, Nutrition Planning, Subscription/paywall surfaces, AI generation/agent consent, and account/auth flows.
- User-flow diagrams for cross-feature paths such as recipe → meal plan → grocery list → online order status.
- State modeling for empty, loading, error, offline, permission, paywall, and cross-device parity states.

UX should not treat this as final visual design approval. The V-Model and implementation/test gates remain blocked; this handoff is for product/UX design readiness, not release readiness.

## Handoff documents

| Document                                                           | Purpose                                                                |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| [01-information-architecture.md](./01-information-architecture.md) | App navigation, primary surfaces, web/mobile parity model.             |
| [02-screen-inventory.md](./02-screen-inventory.md)                 | Screen-by-screen mockup inventory and source specs.                    |
| [03-cross-feature-flows.md](./03-cross-feature-flows.md)           | End-to-end flows that span multiple product features.                  |
| [04-screen-states-and-rules.md](./04-screen-states-and-rules.md)   | Required states, paywall behavior, accessibility, offline/error rules. |
| [05-open-decisions.md](./05-open-decisions.md)                     | UX-blocking and UX-watch decisions that must be resolved or validated. |
| [06-mockup-briefs.md](./06-mockup-briefs.md)                       | Concrete mockup briefs for the first UX design sprint.                 |

## Source feature docs

| Feature                             | Product spec                                                             | User journeys                                                      | Wireframes                                                       |
| ----------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| 001 Recipe Management Core          | [product-spec](../001-commise-recipe-app/product-spec/product-spec.md)   | [journeys](../001-commise-recipe-app/product-spec/user-journey.md) | [wireframes](../001-commise-recipe-app/product-spec/wireframes/) |
| 002 Clerk User Authentication       | [product-spec](../002-user-auth/product-spec/product-spec.md)            | [journeys](../002-user-auth/product-spec/user-journey.md)          | [wireframes](../002-user-auth/product-spec/wireframes/)          |
| 003 USDA Food Data                  | [product-spec](../003-usda-food-data/product-spec/product-spec.md)       | [journeys](../003-usda-food-data/product-spec/user-journey.md)     | [wireframes](../003-usda-food-data/product-spec/wireframes/)     |
| 004 Recipe Importing                | [product-spec](../004-recipe-importing/product-spec/product-spec.md)     | [journeys](../004-recipe-importing/product-spec/user-journey.md)   | [wireframes](../004-recipe-importing/product-spec/wireframes/)   |
| 005 AI Integration                  | [product-spec](../005-ai-integration/product-spec/product-spec.md)       | [journeys](../005-ai-integration/product-spec/user-journey.md)     | [wireframes](../005-ai-integration/product-spec/wireframes/)     |
| 006 Meal Planning                   | [product-spec](../006-meal-planning/product-spec/product-spec.md)        | [journeys](../006-meal-planning/product-spec/user-journey.md)      | [wireframes](../006-meal-planning/product-spec/wireframes/)      |
| 007 Grocery Lists & Online Ordering | [product-spec](../007-grocery-lists/product-spec/product-spec.md)        | [journeys](../007-grocery-lists/product-spec/user-journey.md)      | [wireframes](../007-grocery-lists/product-spec/wireframes/)      |
| 008 Cooking Mode                    | [product-spec](../008-cooking-mode/product-spec/product-spec.md)         | [journeys](../008-cooking-mode/product-spec/user-journey.md)       | [wireframes](../008-cooking-mode/product-spec/wireframes/)       |
| 009 Nutrition Planning              | [product-spec](../009-nutrition-planning/product-spec/product-spec.md)   | [journeys](../009-nutrition-planning/product-spec/user-journey.md) | [wireframes](../009-nutrition-planning/product-spec/wireframes/) |
| 010 Subscriptions & Monetization    | [product-spec](../010-subscriptions/product-spec/product-spec.md)        | [journeys](../010-subscriptions/product-spec/user-journey.md)      | [wireframes](../010-subscriptions/product-spec/wireframes/)      |
| 011 Recipe Digitization             | [product-spec](../011-recipe-digitization/product-spec/product-spec.md)  | In product-spec                                                    | Not yet split out                                                |
| 012 Creator Profiles                | [product-spec](../012-creator-profiles/product-spec/product-spec.md)     | In product-spec                                                    | Not yet split out                                                |
| 013 Cooking School                  | [product-spec](../013-cooking-school/product-spec/product-spec.md)       | In product-spec                                                    | Not yet split out                                                |
| 014 Notification Service            | [product-spec](../014-notification-service/product-spec/product-spec.md) | In product-spec                                                    | Not yet split out                                                |

## Product principles for UX

- **Useful free tier**: free users can cook, organize, share, manually plan meals, generate grocery lists, and use Cooking Mode. Premium prompts must be contextual and respectful, not disruptive.
- **Web/mobile lockstep**: every user-facing surface requires equivalent web and mobile treatment unless an explicit exception is documented.
- **Recipes are the hub**: recipe cards connect nutrition, meal planning, grocery lists, cooking mode, AI, sharing/cloning, and public/private visibility.
- **Cross-link everything that users mentally connect**: meal plans link to grocery lists, grocery lists link back to meal plans, recipes link to meal plans and Cooking Mode, nutrition plans link to meal plans and recipe swaps.
- **Trust before automation**: AI, nutrition, importing, and grocery ordering must show source/quality/confidence/status clearly before users commit.
