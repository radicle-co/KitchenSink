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
**Scale/Scope**: pre-launch, US at v1 (C-016-001). Low notice volume, human adjudication. _(amended 2026-11-03,
ADR-0082)_ "US at v1" is not a defence by itself: an app listed in EU or UK stores serves them, so the store
territories are restricted and recorded, or the UK's light duties are met from day one (spec `FR-048c`).
**105 functional requirements across 8 user stories, delivered in 7 slices** (2026-11-03: the earlier 85 was stale. `FR-015k` makes 105.)

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
├── spec.md              # 105 FRs, 7 NFRs, 17 SCs, 8 user stories, READY
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

# added 2026-11-03 (ADR-0082). Recipe-service owns these records. staff-architect confirms at PLANNING
packages/services/recipe-service/src/recipes/domain/
├── publicDomainGate.ts          # pure: does a record pass FR-015k today?
├── licenceChoicePolicy.ts       # pure: can this recipe take cc-by-4.0?
└── sourceCapPolicy.ts           # pure: is this source past its cap?
packages/services/recipe-service/src/database/migrations/00NN_*.sql   # data-model §10, §11, §12, §15 (expand-first)

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

Seven independently shippable slices, P1 first (slice 7 added 2026-11-03, ADR-0082). Each is a vertical: schema → service → contract → surfaces →
every test tier.

| Slice | Stories       | Delivers                                                                                                                                                                                                                                                                                                | Depends on                          |
| ----- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **1** | US1 (P1)      | Versioned documents, acceptance records, re-acceptance on material revision, licence gating                                                                                                                                                                                                             | —                                   |
| **2** | US2 (P1)      | Public intake, decisions, **two-channel statements of reasons incl. SES**, counter-notices, strikes, termination                                                                                                                                                                                        | Slice 1                             |
| **3** | US8 (P2)      | **Reviewer dashboard** — queue sorted by time-to-deadline, decision authoring, account view, read-only evidence                                                                                                                                                                                         | Slice 2                             |
| **4** | US3, US4 (P2) | Legal surfaces both platforms; consent + withdrawal; DSAR export; **retention sweep + legal holds**                                                                                                                                                                                                     | Slice 1                             |
| **5** | US5 (P2)      | Reproduction controls — no persisted third-party media, channel classification, transient-extraction guardrails                                                                                                                                                                                         | `004` import channels               |
| **6** | US6, US7 (P3) | Renewal disclosure + in-app cancellation; AI interaction disclosure + marking                                                                                                                                                                                                                           | `010`; `005`/`GR-010`               |
| **7** | US1, US2, US5 | _(added 2026-11-03, ADR-0082)_ The open library: the public-domain gate and record, the CC BY choice, the five statement kinds, the cap over time, fetch signals and their log, statements of reasons for restrictions, the per-market extraction basis and URL-import switch, the market preconditions | Slices 1 and 2, `004`, `020`, `021` |

**Out of this plan's control, and stated rather than assumed:**

- **Slice 5 cannot fully land until `004`'s import channels exist.**
- **Slice 6's AI marking is `GR-010`/`005`'s to implement**; this feature contributes the requirement and the
  marking shape.
- **Two prerequisites are not software**: the registered designated agent (`FR-025`) and counsel-drafted
  documents. Slice 1 ships the machinery with placeholder content, and the machinery is testable without the
  words.
- **`002` needs an amendment before slice 3 ships** (A-11): its Out of Scope excludes an admin UI, and slice 3
  builds one.

## Tasks owed (ADR-0082)

_(added 2026-11-03, owner ruling, ADR-0082)_ This feature has no `tasks.md` yet. These are the tasks the 2026-11-03
rulings add. When `/speckit-tasks` runs, each row becomes a task, written test-first in every tier listed. IDs here
are `L082-NN` so they cannot collide with the generated `T` numbers.

| ID      | Task                                                                                                                                      | Serves                                | Owner package                  | Test tiers                                                                       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| L082-01 | `public_domain_records` and `public_domain_creators` tables, migration, and the curator's entry path                                      | `FR-015k`, data-model §10             | recipe-service                 | unit, integration, LOCAL e2e (migration)                                         |
| L082-02 | `publicDomainGate` pure function, with the rolling year rule and all six tests                                                            | `FR-015k`                             | recipe-service                 | unit (boundary years, each test failing alone), integration                      |
| L082-03 | Rights-label Policy reads the record, and label 7 shows its basis                                                                         | `FR-015d`, `FR-015g`                  | recipe-service, web, mobile    | unit, integration, component, Playwright, Maestro                                |
| L082-04 | Licence columns and `recipe_licence_grants`, migration, and the read contract fields                                                      | `FR-010`, data-model §11              | recipe-service, schema-recipe  | unit, integration, LOCAL e2e, contract                                           |
| L082-05 | `licenceChoicePolicy`: CC BY only on a checked label 1 recipe, from an adult                                                              | `FR-010`, `FR-008`                    | recipe-service                 | unit, integration                                                                |
| L082-06 | The CC BY choice at publish, with the photo choice and the plain words, on web and mobile                                                 | `FR-010`                              | features-recipes, web, mobile  | component (every state), Playwright, Maestro                                     |
| L082-07 | schema.org `license`, CC0 on Commise text, and the Public Domain Mark on public pages                                                     | `FR-033`, `FR-015k`                   | web                            | component, Playwright                                                            |
| L082-08 | Five statement kinds, expand-first migration widening `0059_recipe_imports.sql`, and `magazine`                                           | data-model §15                        | recipe-service                 | unit, integration, LOCAL e2e (migration)                                         |
| L082-09 | The family statement's web permission and optional giver credit, on web and mobile                                                        | `FR-015g` row 5                       | features-recipes, web, mobile  | component, Playwright, Maestro                                                   |
| L082-10 | `source_card_events` ledger and `sourceCapPolicy` with a per-source lock, aggregators (deny, no card, O6), books, paid sites, bulk import | `FR-030a`, data-model §12             | recipe-service                 | unit, integration, LOCAL e2e, k6 (lock contention)                               |
| L082-11 | The fetcher reads robots.txt per RFC 9309, TDMRep, `noai`, AI-crawler blocks, `ai-input`, pirate hosts                                    | `FR-024a`                             | the fetching service (004)     | unit, integration                                                                |
| L082-12 | `fetch_signal_records` log, with "none found" as a value                                                                                  | `FR-024a`, data-model §13             | the fetching service (004)     | unit, integration, LOCAL e2e                                                     |
| L082-13 | `restriction_statements`, the internal call from recipe-service, two-channel delivery, the challenge path                                 | `FR-018`, `FR-019`, data-model §14    | identity, recipe-service       | unit, integration, LOCAL e2e, Playwright, Maestro                                |
| L082-14 | Per-market URL-import switch, closed by default, and the per-market extraction basis                                                      | `FR-027f`, `FR-048`                   | recipe-service, market posture | unit, integration                                                                |
| L082-15 | Delete an uploaded page image after extraction unless the cook keeps it                                                                   | `FR-027h`                             | recipe-workers                 | unit, integration                                                                |
| L082-16 | Anti-extraction terms carve-out, and rate limits plus bot management on public reads                                                      | `FR-030`                              | web edge, recipe-service       | unit, integration, k6                                                            |
| L082-17 | Market preconditions as a checked list on the market posture, and the store-territory record                                              | `FR-048c`                             | identity (market posture)      | unit, integration                                                                |
| L082-18 | GDPR Art. 17(2) deletion signal for a CC BY recipe whose cook erases                                                                      | `FR-010`                              | recipe-service                 | unit, integration                                                                |
| L082-19 | Founder action: register the DMCA agent in the company's legal name. Not software                                                         | `FR-025`                              | founder                        | none (alarmed calendar item, `SC-009`)                                           |
| L082-20 | Counsel review of every item `FR-050` gained on 2026-11-03                                                                                | `FR-050`                              | founder, counsel               | none                                                                             |
| L082-21 | A scheduled purge of `fetch_signal_records` past the `FR-052a` period, in the fetching service                                            | `FR-024a`, `FR-052a`                  | the fetching service (004)     | unit, integration                                                                |
| L082-22 | The internal restriction intake and the cook's challenge route (contracts §C, §B)                                                         | `FR-018`, `FR-019`                    | identity, schema-identity      | unit, integration, contract, k6                                                  |
| L082-23 | Notice form with every §512(c)(3) and DSA Art. 16(2) element, and the contact step for a partial notice                                   | `FR-058`                              | identity, web                  | unit (each missing element), integration, component, Playwright                  |
| L082-24 | The designated agent page, linked from every footer, held equal to the filed details                                                      | `FR-059`                              | web                            | component, Playwright, a guard that the page and the record match                |
| L082-25 | Removal reaches every public surface, clones and facts cards included, with an alert on a surface still serving                           | `FR-060`                              | recipe-service, web            | integration, deployed e2e (a takedown, then every surface answers not-available) |
| L082-26 | Counter-notice form, copy to the notifier, and the 10 to 14 business-day restore sweep                                                    | `FR-061`                              | identity, recipe-service       | unit (business-day arithmetic over holidays), integration, LOCAL e2e             |
| L082-27 | Strike counting per decision, the termination appeal, and no re-registration after termination                                            | `FR-062`                              | identity                       | unit (the rolling window at its edges), integration                              |
| L082-28 | The size record on the market posture, and the Art. 20 and Art. 21 switch at the end of small size                                        | `FR-063`                              | identity (market posture)      | unit, integration                                                                |
| L082-29 | UK OSA reporting and complaints procedures on the one notice form                                                                         | `FR-064`                              | identity, web, mobile          | unit, integration, component, Playwright, Maestro                                |
| L082-30 | The publisher fast lane: apply, verify, queue priority, revoke                                                                            | `FR-065`                              | identity                       | unit, integration                                                                |
| L082-31 | Misuse warnings, suspension of processing, and the §512(f) words on both forms                                                            | `FR-066`                              | identity, web                  | unit (a compliant notice is still received while suspended), integration         |
| L082-32 | Counsel review of the items `FR-050` gained for `FR-058` to `FR-066`                                                                      | `FR-050`                              | founder, counsel               | none                                                                             |
| L082-33 | The store-territory setting is US storefronts only at launch, and a test compares it with the market switch _(added 2026-11-03, O9)_      | `FR-048c`, `025-FR-005`, `025-FR-088` | release ops, 025               | unit (the store-versus-switch comparison), readiness record                      |
| L082-34 | The DMCA agent renewal as a recurring task in the operations doc, owned by the founder, with an alarm _(added 2026-11-03, O13)_           | `FR-025`, `FR-059`                    | founder                        | none (alarmed calendar item, `SC-009`)                                           |
| L082-35 | Guard: no signed-out bulk route or public API of the library, and the cook's export stays signed in _(added 2026-11-03, O12)_             | `FR-033`, `FR-034`                    | repoGuards, recipe-service     | unit, integration                                                                |
| L082-36 | Takedown ends a buyer's access at once with no download, and creator erasure ends it with a 30-day download of the last approved version that still works after the account is gone. The notice form counts a sold recipe as a public surface _(rewritten 2026-11-03, owner ruling, ADR-0082 §9, to prove the purchase and subscription model. Was: takedown and creator erasure end a buyer's live view on the server at once)_ | `FR-060`, `018-FR-029e`, `018-FR-029i`, `018-FR-029j` | recipe-service, identity | unit (takedown maps to no download and creator erasure maps to the 30-day download, and a swap of the two fails), integration (a read and a download after a notice are both refused, and a download after creator erasure succeeds inside the window), deployed e2e |
| L082-37 | Acceptance of the terms version that carries the removed-download clause is recorded per user, and a material revision prompts re-acceptance _(added 2026-11-03, owner ruling, ADR-0082 §9)_ | `FR-070`, `FR-002`, `FR-005` | identity | unit (no acceptance record means the clause is not accepted), integration (a revision that adds the clause prompts every existing account at next sign-in) |
| L082-38 | The privacy notice lists the linked social account, the commerce record and the 30-day owed files, each with purpose, basis and retention, and the record of processing lists all three _(added 2026-11-03, owner ruling, ADR-0082 §9)_ | `FR-071`, `FR-039` | identity, web, mobile | unit (a guard fails when a data category in the commerce record or the link table has no notice entry), component (notice page on web and mobile) |
| L082-39 | Linking, unlinking, revocation and erasure of a social account, identity side: tokens stored encrypted, revoked at unlink, the link re-checked on each import and on a token revocation, and erasure deletes the link and its tokens _(added 2026-11-03, owner ruling, ADR-0082 §9)_ | `FR-069`, `FR-071`, `026-FR-061` | identity | unit (an unlinked or revoked account clears no new import), integration (unlink revokes the token with the platform stub, and erasure leaves no link row and no token), erasure-coverage test lists the link table, Playwright and Maestro (link, import an own post, unlink) |
| L082-40 | Strike counting: a reword of a 020-flagged recipe before any takedown adds no strike, and an upheld takedown, a claim removal included, adds one that a reworded restore does not erase _(added 2026-11-03, owner ruling, ADR-0082 §9)_ | `FR-062`, `FR-067`, `FR-020a` | identity | unit (table over flag-then-reword, takedown-then-reword-restore, takedown-then-counter-notice, and a counter that counts the reword fails), integration |
| L082-41 | Label rule: a recipe holding an accepted rewording suggestion derives label 2, never label 1, and is refused CC BY _(added 2026-11-03, owner ruling, ADR-0082 §9)_ | `FR-015c`, `FR-015d`, `FR-015i`, `021-FR-040a` | recipe-service | unit (the label Policy over statement `authored` plus one accepted suggestion returns label 2, and a Policy that returns label 1 fails), integration (the CC BY switch is refused on that recipe and allowed on the same recipe without the suggestion) |
| L082-42 | Counsel review of the items `FR-050` gained for `FR-070`, `FR-071` and the paid-content rules _(added 2026-11-03, owner ruling, ADR-0082 §9)_ | `FR-050` | founder, counsel, accountant | none |

### Next batch (FINAL, owner ruling 2026-11-03)

FINAL, owner ruling 2026-11-03. Tasks for `FR-067` and `FR-068`. They are test-first. Counsel
review is owed before launch (`FR-050`).

| ID      | Task                                                                                                                 | FR              | Owner                      | Tests (test-first)                                                                                     |
| ------- | -------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------- | ------------------------------------------------------------------------------------------------------ |
| L083-01 | Site-owner claim form: the `FR-058` elements plus the claimed-page field, on the one notice intake                   | `FR-067`        | identity, web              | unit (each missing element), integration, component, Playwright                                         |
| L083-02 | Live-site proof on a claim (ADR-0078), as a speed-up and never a requirement for a valid notice                      | `FR-067`        | identity, recipe-service   | unit (a valid notice with no proof is still received and acted on), integration                        |
| L083-03 | Reword-to-restore: a new version that passes `020`, then restore, with notice to the owner                           | `FR-067`        | recipe-service, identity   | unit, integration (old text cannot return), deployed e2e (claim, removal, reword, green, restore)      |
| L083-04 | The strike stays after a reworded restore _(rewritten 2026-11-03, owner ruling, ADR-0082 §9. Was: pending the founder's answer)_ | `FR-067`, `FR-062` | identity | unit (strike count unchanged after restore), integration |
| L083-05 | Launch gate check: a readiness record that each `FR-068` item is green before the public switch                      | `FR-068`        | release ops                | unit (switch refuses with any item missing), readiness record                                           |
| L083-06 | Counsel review of the items `FR-067` and `FR-068` add                                                                | `FR-050`        | founder, counsel           | none                                                                                                    |
| L083-07 | Statement 1a stores `authored` with its own origin, and the label Policy gives label 1 without reading any claim _(added 2026-11-03, owner ruling O16, ADR-0082)_ | `FR-015c`, `FR-015d`, `FR-069`, data-model §15 | recipe-service | unit (label 1 with and without a live claim, and a failed claim leaves the label unchanged), integration, LOCAL e2e (migration adds the own-origin column expand-first) |
| L083-08 | A verified owner files the site-owner claim from their account with the claim attached, and the flow can target only public content _(added 2026-11-03, owner ruling O16, ADR-0082)_ | `FR-067`, `FR-069` | identity, recipe-service, web, mobile | unit (the §512(c)(3) elements are still required with a claim attached), integration (a target that is another cook's private recipe is refused with the same answer as a missing one), component, Playwright, Maestro |
| L083-09 | The reviewer sees the cook's live claim and statement on a notice and on a counter-notice, and a valid notice is still actioned on time _(added 2026-11-03, owner ruling O16, ADR-0082)_ | `FR-060`, `FR-061`, `FR-069` | identity, recipe-service | unit (a notice against a verified owner's recipe is not skipped), integration (removal within the target, the claim shown as evidence) |
| L083-10 | Erasure deletes the cook's site claims, and every decision record that cited one keeps the opaque id, method and check time, never the domain _(added 2026-11-03, owner ruling O16, ADR-0082)_ | `FR-037`, `FR-052a`, `FR-069` | recipe-service, identity | unit, integration, LOCAL e2e (erase a cook with a claim and a cleared recipe), erasure-coverage test lists the claim table |
| L083-11 | Counsel review of the items `FR-069` adds _(added 2026-11-03, owner ruling O16, ADR-0082)_ | `FR-050` | founder, counsel | none |

## Complexity Tracking

| Violation                                                           | Why Needed                                                                                                                                                                                | Simpler Alternative Rejected Because                                                                                                                                                                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principle VIII** — unauthenticated notice form is web-only        | `FR-016` requires reachability **without an account**. Mobile's signed-out state is the sign-in screen and nothing else (no-welcome-screen ADR), so there is no signed-out mobile surface | A signed-out mobile route would reverse a recorded owner decision to serve an audience — rightsholders, regulators — who arrive by web. Mobile still ships the entry point in its legal section                                       |
| **Principle VIII** — reviewer dashboard is web-only                 | The parity rule governs **user-facing** features; this is operator tooling, with two operators at launch: the founder and a paid backup (spec `FR-053h`, added 2026-10-27)                | Building a mobile adjudication surface would double the cost of the largest item in the feature to serve nobody. Recorded so it is not "fixed" later                                                                                  |
| **A second public, unauthenticated ingress** (notice intake Lambda) | `NFR-006`: an outage of the app must not be an outage of the ability to receive notices. Safe harbour depends on receiving and acting on them                                             | Hosting it on the identity service shares the failure domain **and** widens the unauthenticated attack surface of the service that performs authentication                                                                            |
| **An admin UI, which `002` excludes** (A-11)                        | Owner decision (clarify Q2). Every record safe harbour depends on is authored here, and decisions written through a raw API under time pressure are where incomplete grounds come from    | API-only was cheaper and was considered; the owner chose the dashboard. `002`'s exclusion was written about **user management**, so the amendment may be a narrowing rather than a reversal — but it is `002`'s call, not this plan's |

**Costs this plan incurs and pays explicitly:**

- **Two new VPC-attached Lambdas** (`noticeIntake`, `legalRetentionSweep`) join ADR-0004's NAT consumer list.
  `packages/tools/repoGuards/__tests__/natEgressConsumers.test.ts` asserts that list **in both directions**,
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
  _(2026-11-03, ADR-0082)_ `restriction_statements` makes ten identity tables. The recipe-service records of
  data-model §10 to §13 and §15 are declared once, in recipe-service's own schema.
- **Principle IV** — the dashboard is the highest-risk new surface for coverage theatre, so its component
  tests are specified per **state** (empty queue, overdue, decision-in-progress, undelivered email, account at
  threshold, refused without scope), not per page.
