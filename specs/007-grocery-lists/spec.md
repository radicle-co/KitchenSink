# Feature Specification: Grocery Lists & Online Ordering

**Feature Branch**: `007-grocery-lists`
**Created**: 2026-04-14
**Last Updated**: 2026-05-10
**Status**: Pre-handoff (open questions resolved — see revision log in review.md)
**Input**: Split from `001-commise-recipe-app` — grocery list generation from meal plans with ingredient aggregation, deduplication, and online ordering integration.

## Dependencies

| Spec                                                            | Relationship                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| [006-meal-planning](../006-meal-planning/spec.md)               | **Required** — grocery lists are generated from meal plans |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required** — ingredient data comes from Recipe entities  |
| [003-usda-food-data](../003-usda-food-data/spec.md)             | **Required** — ingredient identity and unit normalization  |
| [002-user-auth](../002-user-auth/spec.md)           | **Required** — all grocery features require authentication |
| [010-subscriptions](../010-subscriptions/spec.md)               | **Referenced** — online ordering is a premium feature      |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Grocery List Generation and Online Ordering (Priority: P2)

From a meal plan, a user generates a consolidated grocery list. The list aggregates all ingredients across the planned recipes, combines duplicates (e.g., two recipes needing onions), adjusts quantities, and accounts for items the user already has. The user can then order the groceries online through a supported grocery store — if and when a store integration is available and configured.

**Why this priority**: Grocery list generation is a natural extension of meal planning that delivers tangible time savings. Online ordering integration is a key premium feature that drives subscription value.

**Independent Test**: Can be tested by generating a grocery list from a 3-day meal plan and verifying ingredient aggregation and quantity calculations are correct.

**Acceptance Scenarios**:

1. **Given** a completed meal plan, **When** the user generates a grocery list, **Then** all ingredients are aggregated with combined quantities.
2. **Given** a grocery list, **When** duplicate ingredients exist across recipes, **Then** quantities are summed and displayed as a single line item.
3. **Given** a grocery list, **When** the user marks items as "already have," **Then** those items are excluded from the shopping list.
4. **Given** a grocery list and a configured grocery store integration, **When** the user initiates online ordering, **Then** the system maps ingredients to store products and returns a checkout handoff URL. _(Premium feature — requires store integration to be available and configured; see FR-030 and FR-031.)_
5. **Given** a user has not configured a grocery store, **When** the user attempts to order, **Then** the app guides them through store setup before proceeding.
6. **Given** a user on the dedicated Shopping Lists page, **When** the user creates a new list, **Then** they can start from scratch or link an existing meal plan.
7. **Given** a grocery list linked to a meal plan, **When** the user views the list, **Then** a link back to the originating meal plan is visible and navigable.
8. **Given** a meal plan, **When** the user views the meal plan, **Then** any grocery lists generated from it are listed and navigable from the meal plan view.

---

### Edge Cases

- **Empty meal plan**: Generating a grocery list from a meal plan with no recipes returns an empty list with `totalItems: 0`. The user is shown a prompt to add recipes before generating.
- **Store API outage during ordering**: If the store API is unreachable or returns an error, the grocery list is preserved in its current state. The user sees a clear error message ("Store unavailable — your list is saved. Try again later.") and is not left in a broken state. The order is not marked as placed.
- **Standalone list (no meal plan)**: A list created from the dedicated Shopping Lists page with no meal plan linked behaves identically to a generated list for all in-store and pantry features. Online ordering is available if a store is configured.
- **Meal plan deleted after list generation**: The grocery list persists. The meal plan link is shown as "Meal plan no longer available" rather than a broken link.onfigured any grocery store, **When** they attempt to order online, **Then** the system guides them through store setup and connection.

---

### Edge Cases

- What happens when a user tries to generate a grocery list from an empty meal plan?
- How does the system handle grocery store API outages during online ordering?

## Requirements _(mandatory)_

### Functional Requirements

**Grocery List & Ordering**

- **FR-028**: System MUST generate a consolidated grocery list from a meal plan, aggregating and deduplicating ingredients with summed quantities.
- **FR-029**: System MUST allow users to mark grocery items as "already have" to exclude them from the list.
- **FR-030**: System MUST allow users to configure supported grocery store integrations for online ordering. _(Store integrations are implemented as adapters; availability depends on partner API access — see Assumptions.)_
- **FR-031**: System MUST map grocery list ingredients to store products and provide a checkout handoff URL when a store integration is active. _(Premium — requires FR-030 store to be configured and reachable.)_
- **FR-032**: System MUST provide a dedicated Shopping Lists page where users can view all their lists, create a new standalone list, or generate a list from a meal plan — independent of navigating through the meal plan view.
- **FR-033**: System MUST display a link from a grocery list back to its originating meal plan (when one exists), and display a list of associated grocery lists from within the meal plan view.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Key Entities

- **Grocery List**: An aggregated, deduplicated list of ingredients. May be generated from a meal plan or created standalone. Items can be marked as "already have" or mapped to store products for online ordering. A list retains a nullable reference to its originating meal plan.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-004**: Grocery lists generated from a 7-day meal plan accurately aggregate all ingredients within 5 seconds.
- **SC-008**: Users can complete a full meal-plan-to-grocery-list workflow in under 10 minutes for a 7-day plan.
- **SC-009**: Users can reach the Shopping Lists page directly from the main navigation and create a list without first visiting a meal plan.

## Assumptions

- Grocery store integrations are implemented as adapters against third-party APIs (e.g., Walmart Affiliate API, Instacart Connect). **No partner API access is confirmed at spec time.** Walmart is the first adapter to build because its API is publicly documented and key-based; Instacart requires OAuth and a partner agreement. Both adapters are built behind a feature flag and the ordering UI degrades gracefully when no integration is active.
- Store availability varies by user location. The app does not guarantee any specific store is available to any specific user.
- Order status is retrieved by polling `GET /api/v1/grocery-lists/:id/order-status` on a client-driven interval (every 30 seconds). Webhooks are not used in MVP because neither confirmed partner API guarantees webhook delivery; polling is simpler to implement and test without a live integration. This decision is revisited when a partner agreement is in place.
