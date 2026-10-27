# Cross-Feature UX Flows

**Status**: Ready for UX flow mapping and low-/mid-fidelity mockups.

These flows are where users experience Commise as one product rather than a set of features. UX should prioritize these before polishing individual screens.

## Flow 1 — New user to useful Home

1. User signs up or logs in.
2. App lands on Home, not a blank recipe list.
3. Home shows a starter path: add/import recipe, explore public recipes, create first meal plan, set nutrition goal.
4. If the user imported or created something during onboarding, Home shows it as the first "continue" object.
5. Premium messaging appears only as contextual value, not as a blocker to core use.

**Mockup requirement**: new-user Home and returning-user Home must be separate mockups for web and mobile.

## Flow 2 — Recipe creation to nutrition-backed recipe card

1. User creates or imports a recipe.
2. Ingredients are matched to USDA/FoodData records where possible.
3. Ingredient match states are visible: pending, fetched, not found, failed, ambiguous.
4. Recipe card shows nutrition summary with confidence/source context.
5. User can edit ingredients or choose a better food match.

**Mockup requirement**: ingredient picker, ambiguous match resolution, and recipe-card nutrition state must be included.

## Flow 3 — Recipe to meal plan

1. User opens a recipe detail/card.
2. User chooses "Add to meal plan".
3. App asks for plan, date, meal slot, servings/household size.
4. User confirms and remains oriented: return to recipe or go to plan.
5. Meal plan updates nutrition summary immediately or shows pending nutrition calculation.

**Mockup requirement**: design as modal/sheet on both platforms; mobile must not require leaving the recipe context.

## Flow 4 — Meal plan to grocery list

1. User completes or partially completes a plan.
2. User chooses "Generate grocery list".
3. App aggregates/dedupes ingredients, applies servings, and shows pantry exclusions.
4. User reviews quantities and edits before saving.
5. Saved grocery list links back to the source meal plan.

**Mockup requirement**: generated-list review must show source meal plan, skipped pantry items, editable quantities, and confidence around unit conversions.

## Flow 5 — Grocery list to online order status

1. User opens a grocery list.
2. Free users can shop in-store; premium online ordering is gated contextually.
3. Premium user connects a supported store, Walmart first.
4. App maps list items to products and asks user to review substitutions/unavailable items.
5. App submits/redirects order through supported API/handoff.
6. Grocery list shows order status via polling and preserves list state if provider is down.

**Mockup requirement**: include store-not-configured, provider outage, unavailable item, and order-status states.

## Flow 6 — Meal plan to nutrition plan

1. User creates nutrition goals.
2. User links goals to meal plan.
3. App shows daily/weekly compliance and gaps.
4. User drills into a meal/recipe causing a gap.
5. App suggests swaps if premium and available; otherwise provides manual adjustment guidance.

**Mockup requirement**: planned-vs-target view must connect back to recipes and meal slots.

## Flow 7 — Cooking from a meal plan

1. User opens today's meal plan.
2. User selects a recipe slot.
3. User enters Cooking Mode.
4. Cooking Mode shows steps, ingredients, timers, and wake-lock behavior.
5. User completes cooking and returns to the meal plan or recipe.

**Mockup requirement**: include entry from both meal-plan slot and recipe detail.

## Flow 8 — AI recipe generation to saved recipe

1. Premium/BYOK-configured user opens AI generation.
2. User enters prompt/constraints or starts from pantry/meal-plan context.
3. AI returns recipe preview with confidence and guard messaging.
4. User accepts or rejects.
5. Accepted recipe saves as private by default.
6. User can later change visibility through normal recipe settings, not through the agent.

**Mockup requirement**: confidence/guard copy must be visible on web and mobile; no screen may omit it for space.

## Flow 9 — External agent consent

1. User connects an external agent.
2. App explains agent identity and requested scopes.
3. `recipes:read` and `recipes:create` are separate consent choices.
4. User can revoke scopes later from Connected Agents.
5. Agent-created recipes save private by default.

**Mockup requirement**: consent must be plain-language and scope-specific; write access cannot be bundled invisibly with read access.

## Flow 10 — Subscription upgrade and lapse

1. User encounters premium feature.
2. Inline teaser explains value.
3. Active invocation opens paywall modal/bottom sheet.
4. Pricing page shows $6.99/month, $59.99/year, 14-day trial, and feature comparison. _(Out of date 2026-10-26: see 010's [plan register](../010-subscriptions/spec.md#plan-register).)_
5. Mobile deep-links to web checkout; native IAP is out of scope for v1.
6. If subscription lapses, existing private recipes remain readable/private, but creating new private recipes is blocked.

**Mockup requirement**: include active, trialing, past_due grace, lapsed, and downgraded states.
