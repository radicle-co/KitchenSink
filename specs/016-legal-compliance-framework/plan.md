# Implementation Plan: Legal Compliance Framework

**Branch**: `chore/code-quality-enforcement-phase-1-2` (no new branch — standing owner directive) | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-legal-compliance-framework/spec.md`

> **Revision 2 (2026-08-22)** — regenerated after `/speckit-clarify`. Five answers landed after revision 1 was
> written, and three of them added scope: a transactional **email sender**, a **reviewer dashboard**, and a
> **retention sweep**. Revision 1 is superseded, not amended — its five slices contained none of them.

## Summary

The portfolio has no legal layer: no content licence, no notice-and-action mechanism for the main recipe
corpus, no terms acceptance, no consent record, no age floor, no renewal disclosure. This feature adds them as
**records and surfaces over existing services — still no new deployable.**

The approach: **account-scoped legal records live in the identity service's database; the public notice intake
is a new handler in the existing `identity-webhooks` Lambda package (an independent failure domain, which
`NFR-006` requires); content actions go through the proven internal fan-out that account erasure already uses;
legal documents are versioned in-repo content, not database rows; statements of reasons are delivered over
two channels, with email as the one that discharges the obligation; and a reviewer dashboard in the existing
web app is where every decision is authored.**

Delivery is sequenced so the two P1 stories ship first and independently: the licence must exist before any
public-corpus feature is lawful, and notice-and-action is the item whose absence disqualifies us from safe
harbour.

## Technical Context

**Language/Version**: TypeScript 5.x, `strict: true`, Node.js 24
**Primary Dependencies**: NestJS 11 + Drizzle ORM (identity service); AWS Lambda + `pg` (identity-webhooks);
**Amazon SES** (new — transactional email, `FR-018a`); Next.js 15 / React 19 (web, including the reviewer
dashboard); Expo 57 / React Native 0.86 (mobile); zod at every boundary (`GR-016`);
`@kitchensink/schema-identity` for wire types (`GR-015`); Clerk for identity
**Storage**: RDS PostgreSQL 18, existing `kitchensink_identity` database. **No new datastore**; per ADR-0006
each `pr-{N}` gets its own logical database
**Testing**: vitest (unit + `*.integration.test.ts` against a real Postgres), Playwright (web e2e, including
the dashboard), Maestro (mobile flows), k6 (notice intake load). Every tier the change touches
**Target Platform**: ECS Fargate (identity service), Lambda behind API Gateway (notice intake), scheduled
Lambda (retention sweep), Vercel (web + dashboard), iOS + Android (mobile)
**Project Type**: Web + mobile + backend service
**Performance Goals**: notice acknowledged within 3 min of arrival (`SC-002`); **95% of `copyright` and
`illegal_content` notices decided within 24h, all others within 7 days** (`SC-015`); compliance history as one
record in under 5 s (`SC-004`); export within one month (`FR-034`)
**Constraints**: the notice mechanism must survive degradation of the authenticated app (`NFR-006`) — the
constraint that drives the deployable decision; every legal string localized (`FR-049`); no third-party media
bytes persisted (`FR-027`, `SC-005`); **records purged at 3 years unless under a recorded legal hold**
(`FR-052a`–`FR-052c`)
**Scale/Scope**: pre-launch, US-only at v1 (C-016-001). Low notice volume, human adjudication.
**85 functional requirements across 8 user stories, delivered in 6 slices**

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| #    | Principle                           | Status                              | Notes                                                                                                                                                                                                                   |
| ---- | ----------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I    | **Correctness & Type Safety**       | ☑ Pass                              | Purposes, notice states, grounds, decision actions and retention states are **closed unions** — illegal states unrepresentable. ISO 8601 at interfaces. Custom errors with `Object.setPrototypeOf` + `is*` guards       |
| II   | **Readability & JSDoc**             | ☑ Pass                              | JSDoc on every export; each pure policy module names the pattern it implements                                                                                                                                          |
| III  | **Code Organization & Imports**     | ☑ Pass                              | Domain-grouped (`legal/`, `consent/`, `notices/`, `dsar/`), no `helpers/`, aliased imports with `.js` under NodeNext                                                                                                    |
| IV   | **Testing Discipline**              | ☑ Pass                              | Unit + integration for services and policies; component tests for **every dashboard state**, not just the queue; Playwright per story; Maestro per mobile flow; k6 on the intake; migration-asserting integration tests |
| V    | **Monorepo & Workspace Governance** | ☑ Pass                              | **Still no new workspace.** The dashboard is routes in `@commise/web`, not a separate admin app                                                                                                                         |
| VI   | **Formatting & Tooling**            | ☑ Pass                              | Shared configs; no new tooling                                                                                                                                                                                          |
| VII  | **Accessibility & UX Consistency**  | ☑ Pass                              | `NFR-003`/`NFR-007`. The dashboard is held to the same bar — it is a real surface, not an internal exemption                                                                                                            |
| VIII | **Cross-Platform Parity**           | ⚠ Pass with two recorded deviations | The unauthenticated notice form and the reviewer dashboard are both web-only — see Complexity Tracking                                                                                                                  |

**Governance rules in force**: `GR-003`, `GR-010`, `GR-014`, `GR-015`, `GR-016`, `GR-017`, `GR-018`, `GR-019`,
`GR-021`.

## Project Structure

### Documentation (this feature)

```text
specs/016-legal-compliance-framework/
├── spec.md              # 85 FRs, 7 NFRs, 17 SCs, 8 user stories — READY
├── plan.md              # This file (revision 2)
├── research.md          # Phase 0 — twelve decisions
├── data-model.md        # Phase 1 — entities, tables, state machines, retention
├── quickstart.md        # Phase 1 — how to prove each slice
├── contracts/           # Phase 1 — public, authenticated, reviewer and internal contracts
└── checklists/requirements.md   # 16/16, six validation iterations
```

### Source Code (repository root)

```text
packages/services/identity/src/
├── legal/                      # NEW — documents, versions, acceptance
│   ├── domain/acceptancePolicy.ts      # pure: is this account current on terms?
│   ├── domain/licenceGrant.ts          # pure: may this content be displayed / cloned?
│   └── documents/                      # versioned content + manifest
├── consent/                    # NEW — one record per (account, purpose)
│   └── domain/consentPolicy.ts         # pure: closed purposes, withdrawal effects
├── notices/                    # NEW — notices, decisions, counter-notices, strikes
│   ├── domain/noticeStateMachine.ts    # pure: State pattern over the lifecycle
│   ├── domain/repeatInfringerPolicy.ts # pure: 3 live strikes / rolling 12 months
│   └── domain/decisionDeadline.ts      # pure: grounds → 24h or 7d, from acknowledgement
├── notifications/              # NEW — SES send + per-channel delivery record
│   └── domain/deliveryPolicy.ts        # pure: what counts as delivered, what retries
├── dsar/                       # NEW — export + the erasure-record surface
├── admin/                      # EXTENDED — reviewer endpoints behind a new review scope
└── database/
    ├── schema/legal.ts                 # drizzle tables (GR-021: one declarer)
    └── migrations/00NN_legal_*.sql

packages/services/identity-webhooks/src/handlers/
├── noticeIntake.ts             # NEW — PUBLIC, unauthenticated notice intake
└── legalRetentionSweep.ts      # NEW — scheduled purge at 3 years, skips legal holds

packages/schemas/identity/       # generated COPY of the authored zod + CONTRACT_HASH

packages/apps/commise/features/account/src/
├── legal/                      # shared orchestration: acceptance, consent, export
└── notices/                    # report content, counter-notice

packages/apps/commise/web/src/app/[locale]/
├── legal/                      # terms, privacy, community rules, licence
├── report/                     # PUBLIC unauthenticated notice form (canonical)
├── account/                    # consent, export, erasure
└── admin/notices/              # NEW — the reviewer dashboard (review scope)

packages/apps/commise/mobile/src/screens/legal/   # same user surfaces natively

packages/services/identity/infra/lib/             # SES identity + IAM; migration Trigger (ADR-0022)
packages/services/identity-webhooks/infra/lib/    # intake route + sweep schedule
docs/architecture/decisions/0004-minimize-nat-egress.md   # +2 nat-consumers entries
```

**Structure Decision**: Web + mobile + service, extending existing workspaces only. Identity owns every
account-scoped legal record because the strike tally, the acceptance record and the termination it drives are
all account lifecycle — which identity already owns, including the erasure fan-out this feature reuses.
`identity-webhooks` hosts the public intake (`NFR-006`) and the scheduled retention sweep, both of which fit
patterns already in that package. The reviewer dashboard is routes in the existing web app rather than a
separate admin application, so Principle V holds.

## Phase sequencing

Six independently shippable slices, P1 first. Each is a vertical: schema → service → contract → surfaces →
every test tier.

| Slice | Stories       | Delivers                                                                                                         | Depends on            |
| ----- | ------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------- |
| **1** | US1 (P1)      | Versioned documents, acceptance records, re-acceptance on material revision, licence gating                      | —                     |
| **2** | US2 (P1)      | Public intake, decisions, **two-channel statements of reasons incl. SES**, counter-notices, strikes, termination | Slice 1               |
| **3** | US8 (P2)      | **Reviewer dashboard** — queue sorted by time-to-deadline, decision authoring, account view, read-only evidence  | Slice 2               |
| **4** | US3, US4 (P2) | Legal surfaces both platforms; consent + withdrawal; DSAR export; **retention sweep + legal holds**              | Slice 1               |
| **5** | US5 (P2)      | Reproduction controls — no persisted third-party media, channel classification, transient-extraction guardrails  | `004` import channels |
| **6** | US6, US7 (P3) | Renewal disclosure + in-app cancellation; AI interaction disclosure + marking                                    | `010`; `005`/`GR-010` |

**Out of this plan's control, and stated rather than assumed:**

- **Slice 5 cannot fully land until `004`'s import channels exist.**
- **Slice 6's AI marking is `GR-010`/`005`'s to implement**; this feature contributes the requirement and the
  marking shape.
- **Two prerequisites are not software**: the registered designated agent (`FR-025`) and counsel-drafted
  documents. Slice 1 ships the machinery with placeholder content, and the machinery is testable without the
  words.
- **`002` needs an amendment before slice 3 ships** (A-11): its Out of Scope excludes an admin UI, and slice 3
  builds one.

## Complexity Tracking

| Violation                                                           | Why Needed                                                                                                                                                                                | Simpler Alternative Rejected Because                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principle VIII** — unauthenticated notice form is web-only        | `FR-016` requires reachability **without an account**. Mobile's signed-out state is the sign-in screen and nothing else (no-welcome-screen ADR), so there is no signed-out mobile surface | A signed-out mobile route would reverse a recorded owner decision to serve an audience — rightsholders, regulators — who arrive by web. Mobile still ships the entry point in its legal section                                       |
| **Principle VIII** — reviewer dashboard is web-only                 | The parity rule governs **user-facing** features; this is operator tooling with one operator                                                                                              | Building a mobile adjudication surface would double the cost of the largest item in the feature to serve nobody. Recorded so it is not "fixed" later                                                                                  |
| **A second public, unauthenticated ingress** (notice intake Lambda) | `NFR-006`: an outage of the app must not be an outage of the ability to receive notices. Safe harbour depends on receiving and acting on them                                             | Hosting it on the identity service shares the failure domain **and** widens the unauthenticated attack surface of the service that performs authentication                                                                            |
| **An admin UI, which `002` excludes** (A-11)                        | Owner decision (clarify Q2). Every record safe harbour depends on is authored here, and decisions written through a raw API under time pressure are where incomplete grounds come from    | API-only was cheaper and was considered; the owner chose the dashboard. `002`'s exclusion was written about **user management**, so the amendment may be a narrowing rather than a reversal — but it is `002`'s call, not this plan's |

**Costs this plan incurs and pays explicitly:**

- **Two new VPC-attached Lambdas** (`noticeIntake`, `legalRetentionSweep`) join ADR-0004's NAT consumer list.
  `packages/infra/global/__tests__/natEgressConsumers.test.ts` asserts that list **in both directions**,
  discovery-based, against the entries between ADR-0004's `<!-- nat-consumers:start -->` /
  `<!-- nat-consumers:end -->` markers. Adding either without updating the ADR fails the gate, and so does the
  reverse. Two tasks, not a footnote.
- **A new outbound channel with a deliverability surface.** SES needs a domain identity, DKIM and SPF records,
  and a bounce/complaint path. Email that silently fails is worse than no email, because `FR-018b` makes an
  undelivered statement an open compliance item rather than a dropped notification.

## Phase 0 → Phase 1 outputs

- **Phase 0**: [`research.md`](./research.md) — twelve decisions, each with what was rejected
- **Phase 1**: [`data-model.md`](./data-model.md), [`contracts/`](./contracts/legal-api.md),
  [`quickstart.md`](./quickstart.md)

## Post-design Constitution re-check

Re-evaluated with the revised data model and contracts in hand: **all principles still pass, with the two
recorded Principle VIII deviations.** Phase 1 introduced no new workspace, no new datastore and no new
deployable. The three choices that could have broken a gate were checked specifically:

- **Principle I** — every enumerated field is a closed union shared through `@kitchensink/schema-identity`, so
  a new consent purpose, notice state, decision action or retention state is a compile error everywhere it is
  unhandled rather than a runtime string mismatch.
- **Principle V + GR-021** — the nine tables are declared once in
  `packages/services/identity/src/database/schema/legal.ts`, and no name collides with a shipped table.
- **Principle IV** — the dashboard is the highest-risk new surface for coverage theatre, so its component
  tests are specified per **state** (empty queue, overdue, decision-in-progress, undelivered email, account at
  threshold, refused without scope), not per page.
