# Feature Specification: AI Integration

**Feature Branch**: `005-ai-integration`
**Created**: 2026-04-14
**Last updated**: 2026-08-02
**Status**: Product decisions approved — plan/V-Model/test artifacts remain Draft; release audit ❌ BLOCKED
**Input**: Split from `001-commise-recipe-app` — AI-powered recipe generation (BYOK in-app + external agent platforms via OAuth).

## Dependencies

| Spec                                                        | Relationship                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required** — AI-generated recipes are stored as Recipe entities defined in 001                 |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — all AI features require authentication; external agent OAuth builds on auth layer |
| [010-subscriptions](../010-subscriptions/spec.md)           | **Referenced** — AI generation and instruction optimization are premium features                 |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - AI-Powered Recipe Generation and Assistance (Priority: P2)

A user can interact with AI for recipe generation in two ways. **In-app (BYOK)**: The user configures their preferred AI provider (OpenAI, Gemini, Anthropic, etc.) by storing their own API credentials in Commise. When they request a recipe in the app, Commise calls the user's configured provider and returns the result. **Via external agent platforms**: The user interacts with a Commise custom agent inside platforms like ChatGPT or Gemini. The agent can read the user's recipe collection ("What chicken recipes do I have?") and save new recipes to their Commise account — all after the user has authorized the agent via an OAuth consent flow.

**Why this priority**: AI integration is identified as critical for long-term product differentiation and value. The two-direction model (Commise as AI client + Commise as agent tool) maximizes reach — users get AI where they already are, and the app becomes a platform.

**Independent Test**: In-app: configure an AI provider key, request "low-carb Italian dinner for 4," verify recipe is returned and saveable. External agent: authorize a test agent via OAuth, have it read the user's collection and save a new recipe, verify both operations succeed.

**Acceptance Scenarios**:

1. **Given** a user provides criteria (ingredients, dietary needs, cuisine), **When** they request an AI-generated recipe in-app, **Then** the system calls their configured AI provider and returns a complete recipe within 15 seconds.
2. **Given** an AI-generated recipe is displayed, **When** the user chooses to save it, **Then** it is added to their collection as a private recipe they own.
3. **Given** an AI-generated recipe is displayed, **When** the user declines to save, **Then** no recipe is stored.
4. **Given** a user has not configured any AI provider credentials, **When** they attempt to generate a recipe in-app, **Then** the system guides them through provider setup.
5. **Given** a user has authorized a Commise agent on an external platform (e.g., ChatGPT), **When** the agent requests to read the user's recipes, **Then** the system returns the user's collection in a structured format.
6. **Given** a user has authorized a Commise agent on an external platform, **When** the agent creates a recipe on their behalf, **Then** the recipe is saved to the user's collection as a private, owned recipe.
7. **Given** a user has NOT authorized an external agent, **When** the agent attempts to access their account, **Then** the system rejects the request and returns an authorization error.
8. **Given** a user owns a recipe, **When** they request AI optimization of the instructions (simplify or streamline), **Then** the system returns improved instructions that the user can accept or reject. _(Premium feature)_

---

### Edge Cases

**What happens when AI recipe generation fails?** _(Resolved 2026-08-02)_ Each failure mode has a distinct,
tested response: provider error → `502` with a sanitized message and nothing persisted; provider timeout
past the 15 s budget → `504`; circuit open → `503` with `Retry-After`; no provider configured → `422` with
setup guidance (FR-015 scenario 4). No partial data is ever persisted on a failed generation.

**What happens when generation succeeds but returns a LOW-QUALITY result?** _(Resolved 2026-08-02 — owner
decision)_ This is the harder case: the call succeeded and the recipe is well-formed, but wrong — implausible
quantities, unsafe temperatures, steps referencing ingredients that were never listed. The system does **two**
things, and deliberately not a third:

1. **Sanity validation (FR-023)** — deterministic, bounded checks run on every generated recipe before it is
   shown. Failures surface as **warnings on the preview**.
2. **Regenerate (FR-024)** — the user can discard and retry from the preview without re-entering criteria.
3. **It does NOT auto-discard or block the save.** The checks are heuristics; a heuristic must not silently
   delete a result the user may want. The user always decides.

**Accepted limitation**: sanity validation catches implausible _values_, not bad _cooking_. A recipe that is
technically valid and simply unappetising will pass. FR-022's guard message remains the mitigation for that
class, and it is not claimed to be more.

## Requirements _(mandatory)_

### Functional Requirements

**AI Integration**

- **FR-015**: System MUST allow users to configure their preferred AI provider (e.g., OpenAI, Gemini, Anthropic) by securely storing their own API credentials (BYOK model).
- **FR-016**: System MUST call the user's configured AI provider to generate recipes based on criteria (ingredients, dietary restrictions, cuisine, calorie targets) and return results within the app.
- **FR-017**: System MUST allow users to preview AI-generated recipes before optionally saving them to their collection.
- **FR-018**: System MUST expose an OAuth 2.1-protected API that allows authorized external agents (e.g., ChatGPT GPT Actions, Gemini Extensions) to read the user's recipe collection and create recipes on their behalf. Users MUST explicitly grant consent before any agent can access their account. Read access (`recipes:read`) and write access (`recipes:create`) are separate grants requiring separate, clearly labeled consent steps; users may grant read without granting write, and the two MUST be presented as two distinct checkboxes, never a bundled grant. **The consent surface is Commise's own UI, and the grant is stored in Commise's own record — it is NOT the identity provider's consent screen.** Identity is proven by the provider's OAuth flow; authorization (which scopes an agent holds) is owned and enforced by Commise. _(Decision D-001, 2026-05-10; mechanism revised 2026-08-02 — see ADR-0012)_

    > **Why the mechanism changed.** The original wording implied the identity provider would render the two consent checkboxes. It cannot: Clerk supports only a fixed scope set (`profile`, `email`, `public_metadata`, `private_metadata`, `openid`, `user:org:read`) and custom OAuth scopes are not available, so `recipes:read` / `recipes:create` cannot exist as provider scopes. The requirement's **intent is unchanged** — separate, independently grantable, revocable consent — only the surface that renders it and the store that holds it. This also makes revocation immediate (a record update checked per call) rather than bounded by token refresh.

- **FR-019**: System MUST allow recipe owners to request AI-powered optimization of recipe instructions (simplify language or streamline cooking steps). _(Premium)_
- **FR-020**: AI-generated recipes saved by users (whether via in-app generation or external agent) MUST be treated as private, user-owned recipes. Default visibility is always `private`. External agents MUST NOT set visibility to any value other than `private` on initial save; the `recipe_save` MCP tool must reject non-private visibility payloads with `400`. Users may change visibility through the standard recipe settings flow after saving. _(Decision D-004, 2026-05-10)_
- **FR-021**: System MUST allow users to revoke external agent authorizations at any time from their account settings.
- **FR-022**: System MUST display a confidence indicator and guard message on every AI-generated output surface (web and mobile). The standard guard message is: "AI-generated content may be inaccurate. Verify before use." Nutrition-adjacent outputs additionally display: "This is not medical advice. Consult a qualified professional." The guard message is not dismissible on first view; after 3 views it may collapse to an icon with tooltip but cannot be disabled. This requirement is not user-configurable. **The confidence indicator's basis is the FR-023 sanity-validation result plus the generating provider/model identity — it is NOT a model-reported quality score, which we have no reliable way to obtain.** _(Decision D-003, 2026-05-10; resolves W-003 from verify-report.md)_

- **FR-023**: System MUST run deterministic sanity validation on every AI-generated recipe before presenting
  it, and MUST surface any failed check as a **non-blocking warning** on the preview surface (web and mobile).
  Validation covers at minimum: ingredient quantities within plausible ranges for the stated servings; cooking
  temperatures and times within safe bounds; every step referencing only ingredients present in the ingredient
  list; and all required Recipe fields present. The system MUST NOT auto-discard, auto-correct, or block saving
  on a failed check — these are heuristics and the user decides. _(Resolves the low-quality Edge Case,
  2026-08-02)_
- **FR-024**: System MUST allow a user to regenerate from the preview surface without re-entering their
  criteria. Regeneration issues a new generation request against the user's configured provider and is
  therefore **billable to the user's own BYOK account**; the system MUST make that cost implication evident and
  MUST apply the same per-user concurrency and rate limits as an initial generation. _(Resolves the low-quality
  Edge Case, 2026-08-02)_

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Key Entities

- **AI Provider Config**: Stores a user's BYOK credentials for their chosen AI provider (e.g., OpenAI API key). Encrypted at rest via AWS Secrets Manager (ARN stored in Postgres; raw key never in DB). One active key per provider; up to all three providers (OpenAI, Anthropic, Gemini) may be configured simultaneously. Storing a new key for a provider replaces the existing one. _(Decision D-005, 2026-05-10)_
- **Agent Authorization**: Represents a user's OAuth grant to an external agent platform. Tracks which platform, granted scopes (`recipes:read`, `recipes:create`), grant date, and revocation status. Read and write scopes are granted separately. Users can revoke at any time.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-003**: AI-generated recipes are returned to the user within 15 seconds of the request.

## Assumptions

- AI integration operates in two directions: (1) **BYOK in-app** — users store their own AI provider API keys (OpenAI, Gemini, Anthropic, etc.) and Commise calls the provider on their behalf; (2) **External agent platform** — Commise exposes an OAuth 2.0 API that custom agents on platforms like ChatGPT and Gemini use to read/write recipes on behalf of authorized users.
- External agent platform integrations (ChatGPT GPT Actions, Gemini Extensions, etc.) will conform to each platform's required auth flow, which is typically OAuth 2.0 authorization code.

## Clarifications

- **C-002 (AI Integration Model)**: AI integration operates as two distinct patterns: **(1) BYOK in-app** — users configure their preferred AI provider (OpenAI, Gemini, Anthropic) by storing their own API credentials; Commise calls the provider to generate recipes within the app. **(2) External agent platform** — Commise exposes an OAuth 2.1 API so custom agents on ChatGPT, Gemini, etc. can read the user's recipe collection and create recipes on their behalf. Users must explicitly authorize agents via OAuth consent and can revoke access at any time. Read (`recipes:read`) and write (`recipes:create`) scopes require separate consent steps. Both directions produce private, user-owned recipes. _(D-001, D-004)_
