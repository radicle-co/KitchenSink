# Product Specification: Commise - Recipe Management Core

**Branch**: `001-commise-recipe-app`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Vision

Commise is a recipe management platform that treats cooking as a craft worth organizing, sharing, and preserving. It combines the permanence of a personal cookbook with the discoverability of a social platform. Every recipe is versioned, attributable, and nutritiously annotated. The experience feels like a professional chef's digital notebook — structured, trustworthy, and personal.

**Tagline**: "Your recipes, versioned and verified."

**Core principles**:

- Recipes are first-class citizens with full version history and nutritional backing.
- Sharing is opt-in and attribution-preserving.
- Privacy is tier-gated (free = public-only; premium = private recipes).
- Concurrency conflicts are surfaced transparently — the user decides, not the system.

---

## Personas

### Persona 1 (Primary): P8 Alex — Commise Power User

**Archetype**: Commise Power User
**Core motivation**: Multi-feature daily power use, integrations, automation

**Profile**: Alex cooks seriously and often. They use Commise as a daily kitchen brain — capturing recipes from multiple sources, versioning every tweak, and pulling up instructions hands-free mid-cook. They expect the app to keep up with them, not slow them down.

**Feature-specific goals**:

- Capture and version recipes rapidly, with full edit history preserved so no iteration is ever lost.
- Scale servings on the fly and trust that nutritional data recalculates correctly.
- Search by ingredient across their entire library ("what can I make with chicken and lemon right now?").
- Resolve concurrent-edit conflicts themselves rather than having the system silently overwrite.
- Integrate with external tools (shopping lists, meal planners) via a stable API.

**Feature-specific pains**:

- Conflict resolution on other platforms is opaque — the last writer wins with no warning.
- Photo uploads are slow and break the flow of a rapid recipe-capture session.

---

### Persona 2 (Secondary): P3 Riley — Family Meal Planner

**Archetype**: Family Meal Planner
**Core motivation**: Quick, kid-friendly, weekly rotation, household scale

**Profile**: Riley plans the week's meals on Sunday and needs everything in one place. They build themed collections (Weekly Rotation, Kid-Friendly, Quick Weeknights), clone recipes from the community, and share collections with a partner. Nutrition at a glance matters, but deep macro tracking doesn't.

**Feature-specific goals**:

- Build and maintain themed collections that the whole household can browse.
- Clone community recipes into a private collection and pull updates from the source when the original author improves them.
- Get a high-level nutrition summary across a collection without manual calculation.
- Share a collection with a partner without making every recipe public.

**Feature-specific pains**:

- Copying recipes manually between apps wastes Sunday planning time.
- No pull-from-source after cloning means divergence is invisible until something tastes wrong.

---

### Persona 3 (Tertiary): P5 Morgan — Discovery Seeker

**Archetype**: Discovery Seeker
**Core motivation**: New cuisines, inspiration, expanding repertoire

**Profile**: Morgan browses public recipes for inspiration, tries cuisines they've never cooked before, and occasionally publishes their own originals. Attribution matters to them — they want credit when someone clones their work, and they give credit when they adapt someone else's.

**Feature-specific goals**:

- Discover public recipes by cuisine, dietary tag, and ingredient without needing an account.
- Publish original recipes publicly with confidence that attribution is preserved through clones.
- Track how many times a recipe has been cloned as a lightweight signal of quality.
- Use version history to see how a recipe evolved before deciding to clone it.

**Feature-specific pains**:

- On other platforms, edits to cloned recipes are invisible to the original author.
- Photo-heavy recipe uploads are cumbersome and interrupt the creative flow.

---

## Internal Stakeholders

### Support Operator

**Role**: Internal customer-support and moderation staff who access the admin console to handle user reports, resolve account issues, and moderate public recipe content. Support Operators are NOT end users of the recipe features; they interact with the platform through back-office tooling. Their needs (audit logs, moderation queues, user-lookup APIs) are tracked separately from user-facing requirements.

---

## Web/Mobile Parity Policy

Every user-facing feature in Commise ships on **both** web and mobile in the same release. This is a hard product constraint, not a best-effort goal.

**Rule**: Any task that implements a user-facing screen, flow, or interaction MUST have a corresponding task for the other platform, OR carry an explicit documented exception in the task itself explaining why parity is deferred and which future spec will close the gap.

**Enforcement**: The Phase 6 parity audit task (T060) is not sufficient on its own. Parity is enforced at task-creation time: every frontend implementation task is either a paired web+mobile task or two separate tasks (one web, one mobile) that are explicitly linked. A single task covering only one platform without a documented exception is a blocking defect.

**Exceptions that are pre-approved** (no separate task needed):

- Platform-specific auth SDK integration (`@clerk/nextjs` on web vs. `@clerk/expo` on mobile) — covered by spec 002.
- Expo/React Native device APIs with no web equivalent (camera, haptics, push notifications) — must be noted in the task.
- Maestro vs. Playwright E2E tooling — different tools for the same flow are expected and correct.

---

## Epics

### Epic 0: Post-Login Home (P1)

The first screen a user sees after logging in is the Home screen. It is not a generic dashboard or a bare recipe list. It is a personalized, context-aware **widget surface**: a curated, ordered set of widget cards, each contributed by a feature and rendered only when its backing service is live. Widgets are discovered by explicit startup registration, composed by a `curateHomeWidgets` pass that gates by **capability** (is the backing service deployed) and **subscription tier** and orders by the user's **personalization**, and rendered via `React.lazy` + Suspense with a per-widget error boundary; unknown widget ids are skipped. Design authority: [`research/home-widget-architecture.md`](../research/home-widget-architecture.md) (the `## DECISION (2026-07-06)` section).

In **Home v1 the recipe (recent-recipes) widget is the only registered widget** — it shows the user's up-to-4 most recently viewed or edited recipes, with an empty state ("Create your first recipe") for new users. The meal-plan, nutrition, shopping-list, AI-suggestion, and resume-cooking widgets (backed by services **005–009**) are **NOT registered in v1** — their feature packages don't exist yet and a literal `import()` loader for an unbuilt package would fail the build — so they are **absent** from Home. Each is registered (with its loader) when its feature package ships; **capability gating then shows it once its backing service is live**, at which point it auto-appears with no client change. A widget whose backing service is absent **MUST NOT** render (absent, not a dead or empty tile); the per-widget empty state applies only to **live** widgets:

- **Recent recipes** (live in v1): the user's 4 most recently viewed or edited recipes, with a quick-add button.
- **Resume cooking** (backed by cooking mode, 008): when live, if the user has an active cooking-mode session, a prominent "Resume" card appears at the top of the screen.
- **This week's meal plan** (backed by meal planning, 006): when live, a compact summary of today's and tomorrow's planned meals.
- **Nutrition snapshot** (backed by nutrition, 009): when live, today's planned macro totals vs. the user's nutrition goal.
- **Shopping list** (backed by grocery lists, 007): when live, the count of unchecked items on the active shopping list, with a "View list" shortcut.
- **AI suggestion** (backed by AI integration, 005): when live, one AI-generated recipe suggestion based on the user's recent cooking history.
- **Subscription prompt**: for free-tier users, a contextual upgrade nudge appears when they interact with a premium-gated entry point (private recipes, advanced nutrition). The nudge is non-intrusive and appears at most once per session.

The Home screen is present on both web and mobile with identical entry points; every **live** widget is present on both platforms (per-platform `.native.tsx` implementations behind one widget id). Layout adapts to screen size (responsive grid on web, vertical scroll on mobile). Per-user layout (order, hidden) persists across devices via `PATCH /v1/profiles/me`, owned by the identity service (002) and consumed here.

**User stories**: US-011

**FR coverage**: FR-044, FR-045, FR-046

---

### Epic 1: Recipe Lifecycle (P1)

The recipe is the central entity. Authenticated users create, read, update, and soft-delete recipes they own. Every save creates a version. Concurrent edits trigger a visible conflict flow.

**User stories**: US-001, US-002, US-003, US-004, US-005

**FR coverage**: FR-001, FR-001a, FR-002, FR-003, FR-007, FR-007a, FR-007b, FR-007b-i, FR-007c, FR-044, FR-045

---

### Epic 2: Search and Discovery (P2)

All authenticated users can search public recipes. Search is full-text with GIN indexes, filtered by keyword, tags, cuisine, dietary category, ingredient, and prep/cook time.

**User stories**: US-006

**FR coverage**: FR-006

---

### Epic 3: Sharing and Cloning (P3)

Public recipes are discoverable and cloneable. Cloning creates a private copy owned by the cloner. Collections can be cloned as snapshots with opt-in pull-from-source.

**User stories**: US-007, US-008

**FR coverage**: FR-004, FR-005, FR-011

---

### Epic 4: Collections (P3)

Users organize recipes into named collections. Collections can be public or private, owned by the user, and support add/remove of recipes.

**User stories**: US-009

**FR coverage**: FR-008, FR-009, FR-010, FR-012

---

## Stories (MoSCoW)

### Must Have

| ID     | Story                                                                                                                                                                                                                                                                                                                                                            | FR mapping                                                                                                                                                                       | Acceptance Criteria                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| US-011 | As an authenticated user, after logging in I see a personalized Home screen — a widget surface that shows the recent-recipes widget from day one and lights up the meal-plan, nutrition, shopping-list, AI-suggestion, and resume-cooking widgets as their backing services (005–009) ship — so that I can immediately act on what matters most without navigating menus. | [FR-046](../spec.md#fr-046), [FR-044](../spec.md#fr-044), [FR-045](../spec.md#fr-045)                                                                                            | 1. Home screen loads within 2 seconds of login redirect. 2. The recipe (recent-recipes) widget renders on first render; any widget whose backing service is not yet deployed is absent (not shown with an empty state). 3. Free-tier users see a subscription nudge when tapping a premium-gated entry point, at most once per session. 4. Home screen is functionally identical on web and mobile; layout adapts but no live widget is absent on either platform. 5. Each live widget's entry point navigates to the correct feature screen. |
| US-001 | As an authenticated user, I can create a recipe with title, description, ingredients (with nutrition), step-by-step instructions, prep/cook time, servings, tags, and photos so that I can build my personal recipe collection.                                                                                                                                  | [FR-001](../spec.md#fr-001), [FR-001a](../spec.md#fr-001a), [FR-007](../spec.md#fr-007), [FR-007a](../spec.md#fr-007a), [FR-044](../spec.md#fr-044), [FR-045](../spec.md#fr-045) | 1. User submits complete recipe form. 2. Recipe appears in their collection within 2 seconds. 3. Nutrition data is shown per ingredient.                                                                                                                                                                                                                                                                                                                                                  |
| US-002 | As a recipe owner, I can edit any field of my recipe and save it, creating a new version, so that I can track changes over time.                                                                                                                                                                                                                                 | [FR-007b](../spec.md#fr-007b), [FR-007c](../spec.md#fr-007c), [FR-002](../spec.md#fr-002)                                                                                        | 1. Edit a field and save. 2. New version appears in version history. 3. Last 10 versions accessible in DB.                                                                                                                                                                                                                                                                                                                                                                                |
| US-003 | As a recipe owner, I can delete my recipe (soft delete / tombstone) so that it is removed from all listings and searches immediately while retaining my data for GDPR purposes.                                                                                                                                                                                  | [FR-002](../spec.md#fr-002), [C-007](../spec.md#c-007)                                                                                                                           | 1. Delete action removes recipe from listings within 1 second. 2. DB rows and S3 archives are retained indefinitely by default.                                                                                                                                                                                                                                                                                                                                                           |
| US-004 | As a recipe owner (premium), I can set my original recipes to private; free users' recipes are always public.                                                                                                                                                                                                                                                    | [FR-003](../spec.md#fr-003), [C-004](../spec.md#c-004)                                                                                                                           | 1. Premium user toggles visibility to private. 2. Recipe disappears from public search. 3. Free user sees no private option.                                                                                                                                                                                                                                                                                                                                                              |
| US-005 | As an authenticated user, I can view a side-by-side conflict resolution UI when my save is rejected due to a stale version, and choose to keep server version, overwrite, or merge field-by-field.                                                                                                                                                               | [FR-007c](../spec.md#fr-007c)                                                                                                                                                    | 1. Save with stale version returns HTTP 409. 2. UI shows server and local versions side-by-side. 3. User selects resolution and re-submits.                                                                                                                                                                                                                                                                                                                                               |
| US-006 | As an authenticated user, I can search and filter public recipes by keyword, tags, cuisine, dietary category, ingredient, and prep/cook time so that I can discover recipes to clone.                                                                                                                                                                            | [FR-006](../spec.md#fr-006), [FR-004](../spec.md#fr-004)                                                                                                                         | 1. Search returns results within 500ms. 2. Each filter reduces results appropriately. 3. Only public recipes are returned.                                                                                                                                                                                                                                                                                                                                                                |

**Traceability**: 7 Must Have stories / 7 mapped to FRs = 100% coverage

---

### Should Have

| ID     | Story                                                                                                                                                                                           | FR mapping                                                                            | Acceptance Criteria                                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| US-007 | As an authenticated user, I can clone any public recipe into my own collection so that I have a private copy I can edit independently of the original.                                          | [FR-005](../spec.md#fr-005)                                                           | 1. Clone action creates a new recipe in caller's collection. 2. Clone is owned by caller. 3. Source attribution is preserved.                    |
| US-008 | As a premium user, after making a substantive edit (ingredients or instructions) to a clone of an imported recipe, I can set my clone to private so that it is no longer publicly discoverable. | [FR-005](../spec.md#fr-005), [C-004](../spec.md#c-004)                                | 1. Substantive edit made. 2. Private visibility option becomes available. 3. Toggle to private succeeds.                                         |
| US-009 | As an authenticated user, I can create, rename, and delete recipe collections, and add or remove recipes from them, so that I can organize my collection thematically.                          | [FR-008](../spec.md#fr-008), [FR-009](../spec.md#fr-009), [FR-010](../spec.md#fr-010) | 1. Create collection with name. 2. Add 3 recipes to collection. 3. Remove 1 recipe. 4. Rename collection. 5. Delete collection (recipes remain). |

---

### Could Have

| ID     | Story                                                                                                                                                                                                                            | FR mapping                    | Acceptance Criteria                                                                                                                                    |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| US-010 | As an authenticated user who has cloned a public collection, I can invoke a "Pull updates from source" action that reconciles my clone with the source's current public membership without overwriting recipes I added directly. | [FR-011](../spec.md#fr-011)   | 1. Pull action shows preview of additions/removals. 2. Confirm adds new public recipes. 3. Directly-added recipes are unchanged.                       |
| US-011 | As a recipe owner, I can view a version history timeline showing the last 10 saved versions of my recipe so that I can compare changes over time.                                                                                | [FR-007b](../spec.md#fr-007b) | 1. Version list shows date, version number, and changed fields. 2. Clicking a version previews its content. 3. Restore action re-saves as new version. |

---

### Won't Have (v1)

| ID     | Story                                                             | Reason                                                                                                                                    |
| ------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| US-012 | Per-user recipe sharing (sharing with specific named users)       | Deferred to future spec. Public/private is sufficient for v1.                                                                             |
| US-013 | Bulk recipe import from external sources (website URL, Instagram) | Covered by [004-recipe-importing](../../004-recipe-importing/spec.md). Separate spec.                                                     |
| US-014 | AI-generated recipe suggestions or ingredient substitution        | Covered by [005-ai-integration](../../005-ai-integration/spec.md). Separate spec.                                                         |
| US-015 | Meal planning and grocery list generation                         | Covered by [006-meal-planning](../../006-meal-planning/spec.md) and [007-grocery-lists](../../007-grocery-lists/spec.md). Separate specs. |

---

## Out of Scope

The following are explicitly out of scope for the v1 product as specified in spec.md and related specs:

- Unauthenticated access (FR-045: all features require Clerk authentication)
- Hard delete of individual recipes (default) — only soft delete; hard purge via explicit GDPR "Erase my data"
- Paid-source recipe import (legal review required — see [004-recipe-importing](../../004-recipe-importing/spec.md) FR-014a)
- Per-user sharing of individual recipes (covered by future spec)
- Meal planning, grocery lists, cooking mode, nutrition planning (separate specs)
- AI recipe generation (separate spec)
- Mobile notifications / push
- Offline-first mode (future iteration)
