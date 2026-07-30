# Metrics: Commise Recipe Management Core — Story-Level

**Branch**: `001-commise-recipe-app`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md)
**Distinction from research/metrics-roi.md**: That file covers portfolio-level ROI and business outcomes. This file is story-level — per-user-story measurable outcomes for product teams.

---

## Metric Notation

Each metric is tied to a Must Have user story. "Measurable" means a queryable signal (API telemetry, DB query, or UX event) with a defined target and measurement window.

---

## Story-Level Metrics

### US-000: Post-Login Home (Widget Surface)

**Story**: As an authenticated user, after logging in I see a personalized Home screen — a widget surface that shows the recent-recipes widget from day one and lights up further widgets as their backing services (005–009) ship — so that I can immediately act on what matters most.

**FRs**: [FR-044](../spec.md#fr-044), [FR-045](../spec.md#fr-045), [FR-046](../spec.md#fr-046)

| Metric ID    | Metric                                                                | Target                                        | Source   | Signal                                                        |
| ------------ | --------------------------------------------------------------------- | --------------------------------------------- | -------- | ------------------------------------------------------------- |
| MET-US000-01 | Home screen load time from login redirect                             | p95 <= 2s (AC-1)                              | UX event | "home_rendered" timer from login redirect                     |
| MET-US000-02 | Recent-recipes widget first-render success rate                       | >= 99% of Home loads                          | UX event | "widget_rendered" (recent-recipes) / Home loads               |
| MET-US000-03 | Capability gating correctness (undeployed-service widgets are absent) | 100% (no dead/empty tile for absent services) | E2E test | Home DOM contains no widget whose backing service is not live |
| MET-US000-04 | Web/mobile parity — no live widget absent on either platform          | 100% parity                                   | E2E test | Live-widget id set identical across web and mobile Home       |
| MET-US000-05 | Subscription nudge frequency on premium-gated entry points            | <= 1 per session                              | UX event | "subscription_nudge_shown" count per session                  |

---

### US-001: Create Recipe

**Story**: As an authenticated user, I can create a recipe with all fields so that I can build my personal collection.

**FRs**: [FR-001](../spec.md#fr-001), [FR-001a](../spec.md#fr-001a), [FR-007](../spec.md#fr-007), [FR-007a](../spec.md#fr-007a), [FR-044](../spec.md#fr-044), [FR-045](../spec.md#fr-045)

| Metric ID    | Metric                                                             | Target                             | Source         | Signal                                                      |
| ------------ | ------------------------------------------------------------------ | ---------------------------------- | -------------- | ----------------------------------------------------------- |
| MET-US001-01 | Recipe creation completion rate (all fields submitted)             | >= 85% within 7 days of signup     | API telemetry  | POST /recipes 201 rate / signup rate                        |
| MET-US001-02 | Time to first complete recipe                                      | <= 5 minutes (SC-001 from spec.md) | UX event timer | "first_recipe_complete" event                               |
| MET-US001-03 | Nutrition data覆盖率 (recipes with >= 1 ingredient backed by USDA) | >= 90% of created recipes          | DB query       | COUNT(recipes_with_usda_ingredient) / COUNT(all_recipes)    |
| MET-US001-04 | Photo upload success rate (all photos on a recipe)                 | >= 95% per-recipe photo set        | API telemetry  | S3 upload success / total photo requests                    |
| MET-US001-05 | Feature parity — mobile vs web recipe creation completion          | Delta <= 5%                        | API telemetry  | Mobile POST /recipes 201 rate vs Web POST /recipes 201 rate |

---

### US-002: Edit Recipe / Version History

**Story**: As a recipe owner, I can edit and save my recipe, creating a version, so that I can track changes.

**FRs**: [FR-007b](../spec.md#fr-007b), [FR-007c](../spec.md#fr-007c), [FR-002](../spec.md#fr-002)

| Metric ID    | Metric                                                     | Target                            | Source        | Signal                                       |
| ------------ | ---------------------------------------------------------- | --------------------------------- | ------------- | -------------------------------------------- |
| MET-US002-01 | Recipe edit save success rate                              | >= 99% of edit attempts           | API telemetry | PUT /recipes/{id} 200 rate                   |
| MET-US002-02 | Version counter increment on every successful save         | 100% of saves create new version  | DB query      | COUNT(recipe_versions) per recipe save event |
| MET-US002-03 | Version history access rate (owners who view version list) | >= 60% of recipe owners           | UX event      | "version_history_opened" event               |
| MET-US002-04 | Version restore rate (restore action taken)                | >= 10% of owners who view history | UX event      | "version_restored" event                     |

---

### US-003: Delete Recipe (Soft Delete)

**Story**: As a recipe owner, I can delete my recipe (soft delete / tombstone) so that it is immediately removed from all listings.

**FRs**: [FR-002](../spec.md#fr-002), [C-007](../spec.md#c-007)

| Metric ID    | Metric                                                   | Target                 | Source          | Signal                                          |
| ------------ | -------------------------------------------------------- | ---------------------- | --------------- | ----------------------------------------------- |
| MET-US003-01 | Deleted recipe disappears from list API within 1 second  | 100% of delete actions | DB + API test   | deleted_at set; GET /recipes filtered within 1s |
| MET-US003-02 | Deleted recipe excluded from search results              | 100% exclusion         | Search API test | Deleted recipe not in search results            |
| MET-US003-03 | Deleted recipe excluded from collection membership       | 100% exclusion         | API test        | Deleted recipe not in collection recipes list   |
| MET-US003-04 | GDPR erasure job completion rate (for users who request) | >= 99% within 30 days  | DB job status   | erasure_jobs.status = 'completed' / total jobs  |

---

### US-004: Visibility Control

**Story**: As a premium user, I can set my original recipes to private; free users' recipes are always public.

**FRs**: [FR-003](../spec.md#fr-003), [C-004](../spec.md#c-004)

| Metric ID    | Metric                                                   | Target                                              | Source          | Signal                                                |
| ------------ | -------------------------------------------------------- | --------------------------------------------------- | --------------- | ----------------------------------------------------- |
| MET-US004-01 | Free-tier recipe visibility — 0% private recipes created | 0% private recipes for free users                   | DB query        | COUNT(private recipes WHERE owner.tier='free') = 0    |
| MET-US004-02 | Premium user private toggle availability                 | 100% of premium users see private option            | UX event        | "visibility_toggle_private_visible" event             |
| MET-US004-03 | Private recipe exclusion from public search              | 100% of private recipes excluded from public search | Search API test | Private recipe not returned in GET /recipes (unowned) |

---

### US-005: Conflict Resolution UI

**Story**: As an authenticated user, I can resolve a concurrent edit conflict via a side-by-side UI so that I never lose edits silently.

**FRs**: [FR-007c](../spec.md#fr-007c)

| Metric ID    | Metric                                                                   | Target                | Source        | Signal                                             |
| ------------ | ------------------------------------------------------------------------ | --------------------- | ------------- | -------------------------------------------------- |
| MET-US005-01 | 409 conflict rate (conflicts / total recipe saves)                       | <= 5% of saves        | API telemetry | HTTP 409 rate / total PUT /recipes/{id}            |
| MET-US005-02 | Conflict resolution completion rate (user resolves rather than abandons) | >= 80% of 409 events  | UX event      | "conflict_resolved" event / 409 events             |
| MET-US005-03 | Resolution option distribution                                           | Monitored (no target) | UX event      | Count per option (keep server / overwrite / merge) |
| MET-US005-04 | Conflict resolution re-conflict rate (next save also 409)                | <= 10% of resolutions | API telemetry | Second 409 within 5 minutes of resolution          |

---

### US-006: Search and Discovery

**Story**: As an authenticated user, I can search and filter public recipes so that I can discover recipes to clone.

**FRs**: [FR-006](../spec.md#fr-006), [FR-004](../spec.md#fr-004)

| Metric ID    | Metric                                         | Target                                                       | Source          | Signal                               |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------ | --------------- | ------------------------------------ |
| MET-US006-01 | Search API p95 response time                   | <= 500ms (SC-009 from spec.md)                               | API telemetry   | p95 latency /recipes/search          |
| MET-US006-02 | Search result relevance score                  | >= 70% click-through on top result                           | UX event        | "recipe_clicked" from search results |
| MET-US006-03 | Filter adoption rate (which filters used most) | Monitored (no target)                                        | API telemetry   | Filter parameter frequency           |
| MET-US006-04 | Clone rate from search results                 | >= 15% of search users clone at least 1 result within 7 days | UX event        | "recipe_cloned" from search context  |
| MET-US006-05 | Only public recipes returned in search         | 100% exclusion of private/unowned recipes                    | Search API test | Private recipes never in results     |

---

## Summary Coverage Table

| Story                       | FRs                                              | Metric count | Primary metric                                 |
| --------------------------- | ------------------------------------------------ | ------------ | ---------------------------------------------- |
| US-000: Post-Login Home     | FR-044, FR-045, FR-046                           | 5            | Home screen load time p95 <= 2s                |
| US-001: Create Recipe       | FR-001, FR-001a, FR-007, FR-007a, FR-044, FR-045 | 5            | Recipe creation completion rate >= 85%         |
| US-002: Edit / Version      | FR-007b, FR-007c, FR-002                         | 4            | Version counter increment on every save = 100% |
| US-003: Delete (Soft)       | FR-002, C-007                                    | 4            | Deleted recipe exclusion from all APIs = 100%  |
| US-004: Visibility          | FR-003, C-004                                    | 3            | Free-tier private recipes = 0                  |
| US-005: Conflict Resolution | FR-007c                                          | 4            | Conflict resolution completion >= 80%          |
| US-006: Search & Discovery  | FR-006, FR-004                                   | 5            | Search p95 latency <= 500ms                    |

**Total**: 7 Must Have stories, 30 story-level metrics, 100% story-to-FR traceability.

---

## Signalfreeze

Metrics are measured via a combination of:

- **API telemetry**: CloudWatch / Datadog on NestJS API endpoints
- **DB queries**: Scheduled nightly queries against `recipe_versions`, `recipes`, `users` tables
- **UX events**: Analytics events emitted by web and mobile clients (Segment / Posthog)
- **E2E smoke tests**: Playwright tests that validate metric invariants on every PR (e.g., deleted recipe not in search results)

| Signal type               | Tooling                               |
| ------------------------- | ------------------------------------- |
| API latency / error rates | CloudWatch Metrics + Alerts           |
| DB metric queries         | pgDash / CloudWatch Database Insights |
| UX events                 | Segment / Posthog                     |
| E2E smoke assertions      | Playwright `*.spec.ts`                |
