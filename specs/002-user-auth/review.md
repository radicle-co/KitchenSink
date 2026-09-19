# Product Forge Revalidation Log: Feature 002

**Branch**: `002-user-auth`
**Created**: 2026-05-09
**Status**: Approved with blocking corrections pending (Revision 2 — Governance Correction 2026-05-10)
**Mode**: Retroactive bootstrap
**Milestone**: `M0` Shire
**Public Launch**: Beta (end of `M4`)
**Launch Plan**: [`v1-launch-plan.md`](../v1-launch-plan.md)

---

## Purpose

This file records the iterative revalidation cycle for the Product Forge layer of feature 002. Each revision captures user feedback, the corrections applied, and an explicit approval marker.

This feature was **retroactively bootstrapped** — the SpecKit + V-Model artifacts already existed before Product Forge was layered on. Revalidation here therefore focuses on:

1. Whether the synthesized `research/` and `product-spec/` artifacts faithfully reflect the existing `spec.md`, `plan.md`, `v-model/`, and `data-model.md`.
2. Whether the new artifacts surface any gaps, contradictions, or stale assumptions in the upstream artifacts.
3. Whether the Must Have / Should Have / Could Have decomposition in `product-spec/product-spec.md` matches the user's true product priorities.

---

## Revision Log

### Revision 0 — Initial Bootstrap (2026-05-09)

**Author**: Sisyphus (Product Forge bootstrap)
**Trigger**: User-requested retroactive bootstrap of feature 002.

**Artifacts produced**:

- [research/competitors.md](./research/competitors.md)
- [research/ux-patterns.md](./research/ux-patterns.md)
- [research/codebase-analysis.md](./research/codebase-analysis.md)
- [research/tech-stack.md](./research/tech-stack.md)
- [research/metrics-roi.md](./research/metrics-roi.md)
- [research/README.md](./research/README.md)
- [product-spec/product-spec.md](./product-spec/product-spec.md)
- [product-spec/user-journey.md](./product-spec/user-journey.md)
- [product-spec/wireframes/](./product-spec/wireframes/)
- [product-spec/metrics.md](./product-spec/metrics.md)
- [product-spec/README.md](./product-spec/README.md)

**Synthesis sources**:

| Bootstrapped File    | Primary Source(s)                                              |
| -------------------- | -------------------------------------------------------------- |
| competitors.md       | `research.md`, `plan.md`, `spec.md`                            |
| ux-patterns.md       | `spec.md` user stories + FR definitions                        |
| codebase-analysis.md | `plan.md`, `data-model.md`, `AGENTS.md`, root `package.json`   |
| tech-stack.md        | `plan.md`, `research.md`                                       |
| metrics-roi.md       | `spec.md` NFR/SC section, `plan.md`, `v-model/requirements.md` |
| product-spec.md      | `spec.md` user stories + FR-001..FR-044                        |
| user-journey.md      | `spec.md` user scenarios + FR set                              |
| wireframes/          | `spec.md` FRs and platform-specific flow requirements          |
| metrics.md           | `spec.md` SCs + FR mapping in `product-spec.md`                |

**Traceability policy applied**:

- Every user story in `product-spec/product-spec.md` includes explicit FR references to `spec.md`.
- No net-new FR IDs were introduced in bootstrap artifacts.
- Ambiguities and source inconsistencies are recorded in [verify-report.md](./verify-report.md) as WARNING findings, not converted into new requirements.

**Human review checklist for Revalidation**:

1. Confirm personas and story map reflect intended product priorities.
2. Confirm wireframe set is sufficient for auth UX implementation kickoff.
3. Confirm warning findings in `verify-report.md` are acceptable or require spec updates.
4. Mark status as approved/revision-needed in next revision entry.

---

## Approval State

- **Current**: ✅ Approved (with corrections, 2026-05-09)
- **Approved revision**: 1
- See Revision 1 below.

---

## Revision 1 — Sequential Revalidation (2026-05-09)

**Author**: Sisyphus
**Trigger**: User sequential revalidation pass.
**Approval mode**: Approve-with-corrections (user feedback applied inline; no further iteration requested).

### User Decisions

| Question                          | Decision                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Personas (Avery / Riley / Jordan) | ✅ Confirmed                                                                                   |
| Admin dashboard                   | ✅ Confirmed out-of-scope (no use case)                                                        |
| MFA                               | ✅ Delegated to user-configurable; **not** a Commise product story — demote/remove from MoSCoW |
| Suspension/impersonation scope    | ✅ Backend/admin APIs only                                                                     |
| WA-001 (Node version)             | ✅ Align to **Node 24.x** (Lambda 24.x is available); waiver rejected                          |
| CR-001 (API prefix)               | ✅ Adopt portfolio standard `{protocol}://{host}:{port}/api/:version/*` (e.g. `/api/v1/...`)   |

### Portfolio-Wide Standards (recorded for ALL features 001–010)

These are mandatory standards announced during 002 revalidation; they retroactively apply to every feature in the repo:

1. **API URL pattern** (REQUIRED): `{protocol}://{host}:{port}/api/:version/*`
    - Both `/api` AND `/v{N}` segments are required.
    - Example: `/api/v1/recipes`, `/api/v1/auth/callback`.
2. **Package naming** (REQUIRED): `@kitchensink/{group}-{name}`
    - Examples: `@kitchensink/data-usda`, `@kitchensink/shared-recipe-core`, `@kitchensink/auth-client`.
3. **Node runtime** (REQUIRED): **24.x everywhere**, including AWS Lambda.

See [`../cross-feature-consistency-report.md`](../cross-feature-consistency-report.md) §Portfolio Standards for the canonical record.

### Corrections Required in 002 Artifacts

These are **deferred follow-up tasks**, not bootstrap blockers (revalidation approved; corrections tracked):

- [ ] `spec.md`, `plan.md`, `contracts/*` — replace any `/v1/*` URLs with `/api/v1/*`.
- [ ] `plan.md`, `tech-stack.md` — change Node `22.x` → `24.x` for Lambda runtime.
- [ ] `product-spec/product-spec.md` — demote MFA stories (was P3) to **out-of-scope (delegated to )**.
- [ ] `product-spec/product-spec.md`, traceability — confirm package names match `@kitchensink/{group}-{name}` (e.g. auth client/server libs).

### Approval Marker

> **APPROVED** by user on 2026-05-09 (approve-with-corrections, sequential revalidation).
> Revision: 1
> Notes: Personas/admin/MFA/suspension confirmed. Node 24.x and `/api/:version/*` adopted as portfolio standards. Corrections tracked as deferred follow-ups, not bootstrap blockers.

---

## Revision 2 — Governance Correction (2026-05-10)

**Author**: Sisyphus (governance alignment pass)
**Trigger**: Director review rejection — release audits contradicted their own data; governance enforcement was inconsistent across features.

### Governance Cross-References

This feature's artifacts are now subject to the following canonical governance documents:

| Rule   | Document                                              | Requirement                                                                                                                                                                              |
| ------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GR-001 | [`specs/governance-rules.md`](../governance-rules.md) | Release Readiness Gate — `RELEASE READY` is invalid unless all requirements have mapped Test Case IDs, all scenarios are executed or waived with justification, and `waivers.md` exists. |
| GR-002 | [`specs/governance-rules.md`](../governance-rules.md) | API prefix — all endpoints must use `/api/v{N}/*` (both segments required).                                                                                                              |
| GR-003 | [`specs/governance-rules.md`](../governance-rules.md) | Package naming — `@kitchensink/{group}-{name}`.                                                                                                                                          |
| GR-004 | [`specs/governance-rules.md`](../governance-rules.md) | Node runtime — 24.x everywhere including Lambda.                                                                                                                                         |

See also: [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) §Release Readiness Gate (Non-Negotiable) — version 1.3.0.

### Status of Deferred Corrections (from Revision 1)

The corrections listed in Revision 1 remain **open blocking corrections** for engineering handoff. They are not bootstrap blockers but must be resolved before implementation begins:

- [ ] `spec.md`, `plan.md`, `contracts/*` — replace any `/v1/*` URLs with `/api/v1/*` (GR-002).
- [ ] `plan.md`, `tech-stack.md` — change Node `22.x` → `24.x` for Lambda runtime (GR-004).
- [ ] `product-spec/product-spec.md` — demote MFA stories to **out-of-scope (delegated to )**.
- [ ] `product-spec/product-spec.md`, traceability — confirm package names match `@kitchensink/{group}-{name}` (GR-003).

### Release Audit Status

`v-model/release-audit-report.md` is currently **❌ BLOCKED**:

- 556 untested scenarios with no executed test results or waivers.
- `RELEASE READY` cannot be asserted until GR-001 conditions are met.
- See [`v-model/release-audit-report.md`](./v-model/release-audit-report.md) for the canonical blocked notice.

### Approval Marker

> **Status**: Approved with blocking corrections pending.
> Revision: 2
> Notes: Governance rules applied retroactively. Deferred corrections from Revision 1 remain open. Release audit is blocked pending test execution or formal waivers. No implementation may be marked complete until GR-001 is satisfied.
