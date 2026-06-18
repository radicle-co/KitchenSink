# Cross-Feature Functional Requirement Index

**Version**: 0.1.0
**Generated**: 2026-05-13
**Authority**: [GR-003 — FR Identifier Namespace](./governance-rules.md#gr-003-fr-identifier-namespace)
**Status**: Active registry; update whenever a cross-feature FR reference is added, removed, or renumbered.

---

## Purpose

Feature-local FR IDs are intentionally reused across specs (`FR-001` means different things in different feature folders). This registry records cross-feature FR references in the qualified `{feature}-FR-{NNN}` namespace required by GR-003 so reviewers can validate that downstream artifacts point at the intended owner feature.

---

## Registry

| Source artifact                                                                            | Target feature                                               | Qualified FR              | Reference text / relationship                                                | Status |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------- | ------ |
| [`002-user-auth/spec.md`](./002-user-auth/spec.md)                                         | [`001-commise-recipe-app`](./001-commise-recipe-app/spec.md) | `001-FR-045`              | Clerk provides the authentication dependency required by the recipe app.     | Active |
| [`002-user-auth/spec.md`](./002-user-auth/spec.md)                                         | [`003-usda-food-data`](./003-usda-food-data/spec.md)         | `003-FR-035`              | Clerk provides the shared session-token verification used by USDA food data. | Active |
| [`002-user-auth/spec.md`](./002-user-auth/spec.md)                                         | [`005-ai-integration`](./005-ai-integration/spec.md)         | `005-FR-018`              | External agent OAuth builds on the authentication layer.                     | Active |
| [`002-user-auth/spec.md`](./002-user-auth/spec.md)                                         | [`010-subscriptions`](./010-subscriptions/spec.md)           | `010-FR-040`–`010-FR-043` | Account stores subscription tier/state consumed by Clerk account context.    | Active |
| [`010-subscriptions/v-model/requirements.md`](./010-subscriptions/v-model/requirements.md) | [`005-ai-integration`](./005-ai-integration/spec.md)         | `005-FR-016`              | Premium entitlement gates AI recipe generation.                              | Active |
| [`010-subscriptions/v-model/requirements.md`](./010-subscriptions/v-model/requirements.md) | [`006-meal-planning`](./006-meal-planning/spec.md)           | `006-FR-025`              | Premium entitlement gates AI meal suggestions.                               | Active |
| [`010-subscriptions/v-model/requirements.md`](./010-subscriptions/v-model/requirements.md) | [`006-meal-planning`](./006-meal-planning/spec.md)           | `006-FR-026`              | Premium entitlement gates auto-generated meal plans.                         | Active |
| [`010-subscriptions/v-model/requirements.md`](./010-subscriptions/v-model/requirements.md) | [`006-meal-planning`](./006-meal-planning/spec.md)           | `006-FR-027`              | Premium entitlement gates food-waste optimization.                           | Active |
| [`010-subscriptions/v-model/requirements.md`](./010-subscriptions/v-model/requirements.md) | [`005-ai-integration`](./005-ai-integration/spec.md)         | `005-FR-019`              | Premium entitlement gates AI instruction optimization.                       | Active |
| [`010-subscriptions/v-model/requirements.md`](./010-subscriptions/v-model/requirements.md) | [`007-grocery-lists`](./007-grocery-lists/spec.md)           | `007-FR-031`              | Premium entitlement gates online grocery ordering.                           | Active |
| [`010-subscriptions/v-model/requirements.md`](./010-subscriptions/v-model/requirements.md) | [`009-nutrition-planning`](./009-nutrition-planning/spec.md) | `009-FR-038`              | Premium entitlement gates trainer nutrition planning.                        | Active |
| [`010-subscriptions/v-model/requirements.md`](./010-subscriptions/v-model/requirements.md) | [`004-recipe-importing`](./004-recipe-importing/spec.md)     | `004-FR-011`              | Premium entitlement gates clone-to-private behavior for imported recipes.    | Active |

---

## Review Rules

1. Cross-feature references in prose may use natural wording, but this registry must store the normalized `{feature}-FR-{NNN}` value.
2. When a source spec renumbers or removes an FR, every row targeting that FR must be reviewed before the dependent feature enters implementation.
3. If a downstream artifact references another feature by capability without a concrete FR ID, do not invent one here; update the owner spec first or mark the dependency as capability-level in the downstream document.
4. During `/speckit.product-forge.revalidate`, reviewers must compare new cross-feature references against this registry and update it in the same change set.
