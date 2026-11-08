# UX Mockup Briefs — First Design Sprint

**Status**: Ready for UX to begin low-/mid-fidelity mockups.

These briefs translate the portfolio requirements into concrete design assignments. UX should create web and mobile variants for every **Core v1** brief unless noted otherwise.

## Brief 1 — Signed-in Home

**Goal**: Make the first post-login screen useful and non-generic.

**Primary users**: all personas; optimize initial layout for P1 Casey, P3 Riley, P8 Alex.

**Must show**:

- Continue/resume card: active cooking session, draft recipe, unfinished meal plan, active grocery list, or import in progress.
- This week: meal-plan preview with gaps and upcoming meals.
- Recent recipes: viewed/edited/cooked recipes.
- Shopping status: active grocery list or online order state.
- Nutrition snapshot: goal/compliance summary if configured.
- Explore: public recipes or starter suggestions.
- Pro nudge: contextual and dismissible for the session; never blocks free-tier core tasks.
- Personalization controls: let users reorder or hide non-critical modules after onboarding while preserving pinned continuation/sync/safety alerts.

**States to mock**: new user empty, returning active user, no meal plan, active cooking session, customized module order, Pro prompt, degraded/offline summary.

**Source**: [01-information-architecture.md](./01-information-architecture.md), [001 product spec](../001-commise-recipe-app/product-spec/product-spec.md).

## Brief 2 — Recipe Library and Recipe Card

**Goal**: Make recipes the hub for creation, planning, nutrition, cooking, sharing, and shopping.

**Must show**:

- Library with search/filter, collections, public/private badges, source/attribution badges.
- Recipe card/detail with title, image, metadata, ingredients, steps, nutrition summary, visibility, version/source notes.
- Primary actions: Cook, Add to meal plan, Add ingredients to list, Share, Clone, Edit.
- Ingredient nutrition status: pending, fetched, ambiguous, not found, failed.

**States to mock**: empty library, search no results, recipe with pending nutrition, imported attributed recipe, free-user public-only recipe, Pro private recipe.

**Source**: [001 product spec](../001-commise-recipe-app/product-spec/product-spec.md), [003 product spec](../003-usda-food-data/product-spec/product-spec.md), [004 product spec](../004-recipe-importing/product-spec/product-spec.md).

## Brief 3 — Create/Edit Recipe and Import

**Goal**: Reduce friction for adding recipes while preserving attribution, nutrition, and versioning.

**Must show**:

- Structured create/edit form: title, description, servings, time, ingredients, steps, tags, photos.
- Ingredient matching picker with branded/generic disambiguation.
- Import entry points: URL, Instagram caption, photo/OCR/physical copy where in scope.
- Attribution and legal/source warning states for imported recipes.
- Version/conflict resolution affordance for stale edits.

**States to mock**: validation errors, photo upload failure but metadata saved, ambiguous ingredient, import failed, paywalled/paid-source warning, edit conflict.

**Source**: [001 product spec](../001-commise-recipe-app/product-spec/product-spec.md), [004 product spec](../004-recipe-importing/product-spec/product-spec.md).

## Brief 4 — Meal Planner

**Goal**: Let households create a practical weekly plan and carry it through to shopping and nutrition.

**Must show**:

- Week calendar with meal slots and gaps.
- Create plan flow with date range, household servings, template selection.
- Add recipe to slot from planner and from recipe card.
- Nutrition summary visible without leaving planner.
- Generate grocery list handoff.

**States to mock**: empty week, partially planned week, locked/finalized plan, orphaned/deleted recipe slot, nutrition pending, Pro with AI suggestion teaser.

**Source**: [006 product spec](../006-meal-planning/product-spec/product-spec.md), [009 product spec](../009-nutrition-planning/product-spec/product-spec.md), [007 product spec](../007-grocery-lists/product-spec/product-spec.md).

## Brief 5 — Grocery Lists and Ordering

**Goal**: Support both in-store shopping and Pro online ordering without making basic lists feel second-class.

**Must show**:

- Dedicated Grocery Lists page with history, active lists, create list, generate from meal plan.
- Generated-list review with deduped quantities, pantry exclusions, source meal-plan link.
- In-store shopping mode with aisle grouping and one-handed check-off.
- Store connection and order review for Pro users.
- Order status card on the list.

**States to mock**: standalone manual list, generated list, offline list view, store not connected, provider outage, item unavailable/substitution needed, order processing/complete/failed.

**Source**: [007 product spec](../007-grocery-lists/product-spec/product-spec.md), [010 product spec](../010-subscriptions/product-spec/product-spec.md).

## Brief 6 — Cooking Mode

**Goal**: Provide a focused cooking interface that works with wet hands, distance, timers, and accessibility needs.

**Must show**:

- One active step with large type and progress.
- Ingredients panel available without losing step context.
- Timer controls and active timer display.
- Next/back navigation by tap/swipe/keyboard where appropriate.
- Completion state with notes/rating and return to meal plan/recipe.

**States to mock**: timer running, timer completed, multiple timers, screen wake-lock active, offline/no cached recipe, voice-control hint, completed cooking.

**Source**: [008 product spec](../008-cooking-mode/product-spec/product-spec.md).

## Brief 7 — Nutrition Planning

**Goal**: Connect nutrition goals to meal plans and recipe decisions without becoming a medical product.

**Must show**:

- Nutrition dashboard with current goals and planned-vs-target status.
- Goal setup/edit flow.
- Meal-plan linked weekly compliance view.
- Meal/recipe breakdown with macro and key micronutrient signals.
- Deficiency/gap alert with safe language and suggested actions.

**States to mock**: no goal configured, no linked meal plan, pending USDA data, compliance gap, Pro with AI recipe-swap suggestion, trainer/client consent if explored.

**Source**: [009 product spec](../009-nutrition-planning/product-spec/product-spec.md), [003 product spec](../003-usda-food-data/product-spec/product-spec.md).

## Brief 8 — AI Generation and Agent Consent

**Goal**: Make AI powerful but transparent, private by default, and safe for external-agent access.

**Must show**:

- AI generation prompt/constraint surface.
- BYOK provider setup if no provider exists.
- AI recipe preview with confidence indicator and mandatory guard copy.
- Save/reject flow; saved recipes default private.
- Connected Agents page and OAuth consent with separate `recipes:read` and `recipes:create` choices.

**States to mock**: provider missing, provider error, low confidence, nutrition-adjacent medical disclaimer, write-scope consent, scope revoked, agent-created recipe saved private.

**Source**: [005 product spec](../005-ai-integration/product-spec/product-spec.md), [010 product spec](../010-subscriptions/product-spec/product-spec.md).

## Brief 9 — Subscription and Paywall System

**Goal**: Monetize high-value workflows while preserving a useful free product.

**Must show**:

- Inline Pro teaser at feature entry point.
- Modal/bottom-sheet paywall on active invocation.
- Pricing page: $6.99/month, $59.99/year, 14-day trial. _(Out of date 2026-10-26: see 010's [plan register](../010-subscriptions/spec.md#plan-register).)_
- Account subscription status and billing portal/deep-link.
- Lapse/downgrade messaging preserving existing private recipes.

**States to mock**: free, trialing, active Pro, past_due within 7-day grace, lapsed/downgraded, mobile web-checkout handoff.

**Source**: [010 product spec](../010-subscriptions/product-spec/product-spec.md).

## Brief 10 — Auth and Account Lifecycle

**Goal**: Make secure account access feel fast, recoverable, and understandable.

**Must show**:

- Signup/login with social provider emphasis.
- Callback/session restore.
- Profile and linked providers.
- MFA/session/device management where in scope.
- Account deletion/export and suspension/revocation messaging.

**States to mock**: login error, callback failure, expired session, revoked session, duplicate provider/linking conflict, destructive confirmation.

**Source**: [002 product spec](../002-user-auth/product-spec/product-spec.md).
