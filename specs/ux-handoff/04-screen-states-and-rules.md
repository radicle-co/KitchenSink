# Screen States and UX Rules

**Status**: Required for all UX mockups.

Every screen in [02-screen-inventory.md](./02-screen-inventory.md) must include the relevant states below before high-fidelity design is considered complete.

## Universal states

| State              | UX requirement                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty              | Explain why the page is empty and give one primary next action. Never show a dead dashboard.                                                     |
| Loading            | Use skeleton/progress affordance appropriate to content; preserve context and avoid layout jumps.                                                |
| Error              | State what failed, whether user data is safe, and the next recovery action.                                                                      |
| Offline / degraded | Show cached read-only content, queued simple edits, and what will sync or retry later. Required especially for mobile shopping/cooking contexts. |
| Permission denied  | Explain entitlement/auth/ownership issue in plain language.                                                                                      |
| Paywalled          | Show value and feature preview; do not block free-tier core actions.                                                                             |
| Partial data       | Mark pending nutrition/import/AI/store data clearly; do not present estimates as confirmed facts.                                                |
| Conflict           | Let users compare and choose; never silently overwrite recipe or plan changes.                                                                   |

## Feature-specific state rules

### Recipes

- Public/private visibility must be visible on recipe detail and recipe lists.
- Free-tier users cannot create private recipes; the UI must explain this without hiding recipe creation.
- Imported public recipes require attribution visible on cards and detail screens.
- Ingredient nutrition status must be visible when nutrition is pending, failed, ambiguous, or confirmed.

### Meal Planning

- Empty week must show starter templates and recipe suggestions.
- Meal slots must support empty, assigned, orphaned/deleted recipe, nutrition pending, and locked/finalized states.
- Grocery handoff must show whether a list already exists for the plan.

### Grocery Lists

- Generated lists must show aggregation confidence, pantry exclusions, and item source if useful.
- In-store mode must remain usable with poor connectivity: show the cached grocery list, allow queued simple check-offs/manual item edits where supported, mark them as sync pending, and surface conflicts instead of silently overwriting.
- Online ordering must include store-not-connected, provider outage, item unavailable, substitution needed, submitted, processing, ready, complete, and failed states.

### Cooking Mode

- Active step is always the visual priority.
- Timers require visual, audible, and mobile haptic/vibration states where supported.
- Prevent-sleep/wake-lock state must be visible enough to reassure users but not distract.
- Accessibility states must include large text, screen reader labels, keyboard/tap/swipe navigation, and non-color-only indicators.

### Nutrition

- Nutrition Planning must show not configured, configured, linked to meal plan, and compliance unavailable states.
- Dieting/protocol guidance must be visually and verbally distinct from general Nutrition Planning.
- Deficiency and diet guidance must avoid medical claims; use "planning guidance" language and include "This is not medical advice" where advice could be inferred.
- Nutrition values must show pending/estimated/confirmed when USDA data is incomplete.

### AI

- AI output must always show confidence/guard messaging: "AI-generated content may be inaccurate. Verify before use."
- Nutrition-adjacent AI output must also show: "This is not medical advice."
- AI-generated recipes save private by default.
- Agent write access must be separate from read access in consent UI.

### Subscriptions

- Paywall hierarchy: inline teaser → modal/bottom sheet on action → pricing page fallback.
- Pricing: $6.99/month or $59.99/year; 14-day trial; 7-day grace after failed payment. _(Out of date 2026-10-26: see 010's [plan register](../010-subscriptions/spec.md#plan-register).)_
- Existing private recipes remain private/readable after downgrade.
- Mobile billing uses web checkout/customer portal deep-link; native IAP is out of scope for v1.

## Web/mobile parity rules

- Every user-facing screen needs web and mobile mockups or an explicit exception.
- Mobile may change layout and navigation density, but not remove capabilities.
- Paywall, AI guard, consent, and privacy messaging must remain present on mobile even if compact.
- Touch targets, screen reader labels, keyboard equivalents, and non-color cues are required for all core actions.

## Mockup annotation requirements

Each mockup should annotate:

1. Primary persona and job-to-be-done.
2. Source feature and user story/flow reference.
3. Platform: web, mobile, or shared pattern.
4. State represented: default, empty, loading, error, offline, paywall, permission, etc.
5. Data dependencies and known pending decisions.
6. Accessibility notes for labels, focus order, contrast, touch target, and non-color status indicators.
