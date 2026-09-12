# Product Spec: User Authentication

**Branch**: `002-user-auth`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Index

This directory contains the Product Forge v1.3.0 product specification artifacts for the User Authentication feature.

| Artifact      | File                                      | Description                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md)      | Vision, personas, epics, MoSCoW story map with FR traceability, and out-of-scope list. The single source of truth for what is and is not in v1.                                                                                                                   |
| User Journeys | [user-journey.md](./user-journey.md)      | End-to-end flows for three personas (New User, Returning User, Support/Admin Operator) covering P1/P2/P3 stories plus cross-persona edge cases (session expiry, async deletion retry, suspension denial). Includes Mermaid sequence diagrams and coverage matrix. |
| Wireframes    | [wireframes/](./wireframes/README.md)     | ASCII wireframes for **app-rendered** screens only (mobile profile). Login, signup, MFA, session-expired, and OAuth callback are rendered by **Clerk's hosted UI** and intentionally have no wireframes here.                                                     |
| Mockups       | [`docs/mockups/`](../../../docs/mockups/) | Pixel mockups and extracted design system (color tokens, typography, spacing). HTML artifacts of the Figma Make export. Authoritative visual reference for all app-rendered screens.                                                                              |
| Metrics       | [metrics.md](./metrics.md)                | Per-story measurable outcomes for Must Have stories. Distinguish from `research/metrics-roi.md` which covers portfolio-level ROI; this file covers story-level product-team signals.                                                                              |

---

## Quick Links

- [product-spec.md](./product-spec.md) — start here for scope decisions
- [user-journey.md](./user-journey.md) — end-to-end flows for each persona
- [wireframes/](./wireframes/README.md) — app-rendered screen wireframes (profile only; auth flows are Clerk-hosted)
- [`docs/mockups/`](../../../docs/mockups/) — pixel mockups + design system tokens (color, typography, spacing)
- [metrics.md](./metrics.md) — how we measure success per story
- [../spec.md](../spec.md) — canonical FR ID reference (all stories traceable back to FR-001..FR-044)
- [../plan.md](../plan.md) — implementation plan with technical architecture
- [../v-model/requirements.md](../v-model/requirements.md) — REQ-NNN atomic requirements derived from spec.md

---

## Artifact Cross-Reference

```
product-spec.md
    |
    +-- MoSCoW stories (US-001..US-012)
    |       Each story references FR-XXX from spec.md
    |
    +-- Personas (New User / Returning User / Support-Admin Operator)
    |
    v
user-journey.md
    |
    +-- Three persona journeys (Mermaid sequence diagrams)
    |       Each step annotates the FR it exercises
    |
    +-- Cross-persona flows (session-expired, async-deletion, suspension)
    |
    v
wireframes/                  (app-rendered screens only)
    |
    +-- mobile-profile.md     (FR-013, FR-014, FR-018, FR-019, FR-020)
    |
    +-- Note: login, signup, MFA, session-expired, OAuth callback
        are rendered by Clerk's hosted UI — no wireframe needed.
    |
    v
docs/mockups/                 (pixel mockups + design system)
    |
    +-- screens/screen-profile.html
    +-- screens/screen-auth.html  (post-auth shell)
    +-- README.md                 (color / typography / spacing tokens)
    |
    v
metrics.md
    |
    +-- Story-level metrics tied to Must Have stories
```

---

## Scope Boundary Reminder

Out-of-scope items inherited from `spec.md` remain unchanged:

- Email change flow (IdP-managed; separate feature)
- Admin dashboard for user management

Any additional capability ideas discovered during synthesis are documented as WARNING items in [../verify-report.md](../verify-report.md), not promoted to requirements.
