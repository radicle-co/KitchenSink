# Feature Specification: Cooking Mode

**Feature Branch**: `008-cooking-mode`
**Created**: 2026-04-14
**Status**: Draft
**Input**: Split from `001-commise-recipe-app` — step-by-step hands-free cooking interface with timers and screen wake lock.

## Dependencies

| Spec                                                        | Relationship                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required** — cooking mode renders Recipe instructions from 001 |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — all features require authentication               |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Cooking Mode (Priority: P2)

A user selects a recipe and enters "Cooking Mode," which presents a step-by-step, hands-free-friendly interface optimized for use while actively cooking. Instructions are displayed one step at a time in large, readable text. The user advances through steps with simple gestures, taps, or voice commands. Timers are integrated for steps that require waiting.

**Why this priority**: Cooking mode is a high-engagement feature that makes the app genuinely useful in the kitchen, differentiating it from static recipe viewers.

**Independent Test**: Can be tested by entering cooking mode for a recipe with 8+ steps and timers, advancing through all steps, and verifying timers work correctly.

**Acceptance Scenarios**:

1. **Given** a user selects a recipe, **When** they enter Cooking Mode, **Then** the first instruction step is displayed in large, readable text optimized for kitchen use.
2. **Given** a user is in Cooking Mode, **When** they advance to the next step, **Then** the display transitions smoothly to show the next instruction.
3. **Given** a step includes a time duration (e.g., "bake for 25 minutes"), **When** the user starts the timer, **Then** a countdown is displayed and an alert sounds when complete.
4. **Given** a user is in Cooking Mode, **When** they want to go back to review a previous step, **Then** they can navigate backward without losing their place.
5. **Given** a user is cooking, **When** the device screen would normally turn off, **Then** Cooking Mode keeps the screen active.

---

### Edge Cases

- What happens during Cooking Mode if the device loses internet connectivity?

## Requirements _(mandatory)_

### Functional Requirements

**Cooking Mode**

- **FR-032**: System MUST provide a Cooking Mode that displays recipe instructions one step at a time in large, readable formatting.
- **FR-033**: System MUST allow users to navigate forward and backward through recipe steps in Cooking Mode.
- **FR-034**: System MUST provide integrated countdown timers for recipe steps that include time durations.
- **FR-035**: System MUST keep the device screen active while Cooking Mode is engaged.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Key Entities

None specific — Cooking Mode consumes the Recipe entity defined in [001-commise-recipe-app](../001-commise-recipe-app/spec.md).

## API Contract & Input Validation (GR-015 / GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15 / §15.4 / §15.5](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app).
Full bindings: [`plan.md` §3.0](./plan.md#30-contract-ownership-and-drift-gr-015) and
[`plan.md` §3.0a](./plan.md#30a-input-validation-gr-016). **This section applies existing portfolio rules and
mints NO new FR** (GR-003).

⚠️ **008 OWNS NO SERVICE**, so this section is the **client half almost in full.** 008 owns
`packages/shared/cooking` (the shared core logic its plan §1 names — ⚠️ **it does not exist yet**) plus the
cooking-mode UI components on both platforms, and it **CONSUMES** 001's recipe service via
`@kitchensink/recipe-service-client` → `@kitchensink/schema-recipe`. There is no 008 schema package and there must
not be one: a schema package is per **SERVICE**.

- **No recipe wire shape is declared anywhere in 008** — including **type-only** declarations, and including
  `packages/shared/cooking`, `@commise/web` and `@commise/mobile` (GR-015 §15-b.4 binds shared and app packages
  identically to `packages/clients/*`). Both the **type and the runtime zod** come from `@kitchensink/schema-recipe`,
  whose `openapi.yaml` is **DERIVED output** for `oasdiff`/docs and is **never a codegen input**.
- ⛔ **`packages/shared/cooking` is the HIGHEST-RISK re-declaration site in this feature.** A hand-written "cooking
  step" interface there would be a second representation of 001's step contract, imported by **both** platforms, and
  it would drift silently while `typecheck` reported agreement between two things that were never compared. The
  cooking-mode step model is a **DERIVATION** via `Pick` / `Omit` / `Partial` (cooking mode needs the step text,
  duration and ordering — not the whole recipe). Reference:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **Responses are validated ON RECEIPT** with that zod (GR-016 §16-c.3) — a released mobile binary talking to a
  newer recipe service is exactly where a shape assumption fails silently. ⛔ Server-side **response** validation is
  **DEFERRED by owner decision** (GR-016 §16-g) and **MUST NOT be "completed"**; the two are different obligations.
- **⛔ The storage floor reaches 008 through `timerSeconds`** — an `int4`-backed field (ceiling **2,147,483,647**)
  that was measured with **no upper bound**, one of the recipe service's five live defects of this class. Wherever a
  timer value crosses the wire it is bounded at least as tightly as the column, and **in practice far tighter,
  because a cooking timer has a sane maximum no storage constraint will ever tell us** — a floor is not a target.
  **Asserted, never derived**: no zod from the storage schema, no storage type in a wire schema.
- **If 008 ever adds a server surface** (a persisted cooking session, step sync), the service half applies in full
  at once: zod authored in the owning service beside its controller, **one** mechanism (`createZodDto` +
  **`nestjs-zod`'s** `ZodValidationPipe` — under Nest's **own** pipe a `createZodDto` DTO validates **nothing while
  looking correctly wired**), **`z.strictObject()` on every mutating body** (GR-017 §17-c), the schema package,
  and the `CONTRACT_HASH` boot assertion. **Client work is its own deliverable with its own tasks**
  (GR-017 §17-e.12); "the shared package will add the type" is a contract fork, not a task.
- **Non-HTTP ingress**: 008 has **none today**. Local session state — timer state, wake-lock state, step position
  held on-device — is genuinely client-side and is not a wire boundary.
- 🟠 **OPEN (carried forward, NOT resolved here) — is `CookingSessionEvent` a wire contract, and if so whose?**
  Two things are undetermined: **(a)** which service would own a cooking-session/WebSocket surface, and **(b)**
  whether GR-015's HTTP-shaped rule extends to a **WebSocket event envelope** at all — GR-016 §16-b enumerates
  **queue, event and webhook** ingress and is **silent on a WebSocket envelope**, and that gap is genuine, not an
  oversight in this spec. **Questions for the owner.** Until answered, `CookingSessionEvent` stays illustrative and
  **MUST NOT** be copied into a shared package as an authored type. What is already settled either way: whatever
  receives such an envelope parses it **before** dispatching on its `type`.
- ⚠️ **Third-party APIs (GR-015 §15-d) — forward-looking.** 008 consumes none today. If a voice or
  speech-recognition provider is added for hands-free navigation, that client is the **OPPOSITE** case: it
  **validates the raw upstream shape at the boundary with its own zod**, **MAY declare its own types**, and gets
  **NO** OpenAPI document. `packages/clients/usda` is the reference and must never be "converged".

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-007**: Cooking Mode steps are readable from 3 feet away on standard mobile devices.

## Assumptions

- Users have internet connectivity for core features; Cooking Mode should function with limited connectivity once the recipe is loaded.
