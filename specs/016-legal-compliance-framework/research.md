# Phase 0 Research — Legal Compliance Framework

**Feature**: [016-legal-compliance-framework](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-08-22

The spec carries **zero** `NEEDS CLARIFICATION` markers — the three that existed were resolved by the owner as
C-016-001…C-016-003. What Phase 0 resolves instead is the set of technical unknowns the spec deliberately left
open, because a specification states _what_ and this states _how_.

Twelve decisions. Each names what was rejected, because the rejected option is usually the obvious one.

> **R10–R12 were added in revision 2**, after `/speckit-clarify` introduced email delivery, a reviewer
> dashboard and a retention period.

---

## R1 — No new deployable. Identity owns the records; identity-webhooks hosts the intake

**Decision.** Account-scoped legal state lives in `@kitchensink/identity-service` against the existing
`kitchensink_identity` database. The public notice intake is a **new handler in the existing
`@kitchensink/identity-webhooks` Lambda package**, not a new service and not a route on the identity ECS
service.

**Rationale.**

- Every record this feature adds is **account lifecycle**: which terms an account accepted, which purposes it
  consented to, how it met the age floor, how many actioned notices it carries, and whether that tally
  terminates it. Identity already owns account lifecycle, including the erasure fan-out this feature reuses.
- `NFR-006` requires the notice mechanism to remain reachable when the authenticated application is degraded.
  Safe harbour depends on _receiving and acting on_ notices; a mechanism that shares a failure domain with the
  app is not a mechanism. A Lambda behind API Gateway is a genuinely independent domain.
- `identity-webhooks` already has everything the intake needs and nothing it does not: a public API Gateway
  route (the Clerk webhook is unauthenticated by design and verified inside the Lambda), a VPC attachment to
  the same RDS, a hardened handler pipeline (`common/handlerPipeline.ts`), an error envelope, and a migration
  runner. Six handlers already live there.

**Rejected — a new `legal-service` deployable.** ADR-0017 set the precedent for 006/007/009/010: no new
deployable. A service whose entire job is a handful of account-scoped tables and one public form would cost an
ECS task, an ALB listener rule and priority, a stack, a migration runner and a NAT consumer per stage per open
PR — to own state that belongs to the account.

**Rejected — the intake as a route on the identity ECS service.** Two independent reasons, either sufficient:
it shares a failure domain with the app, defeating `NFR-006`; and it widens the unauthenticated attack surface
of the service that performs authentication, whose `AuthMiddleware` currently protects everything except
`/health`.

**Cost this incurs, to be paid explicitly.** The intake is a VPC-attached Lambda, so it joins ADR-0004's NAT
consumer list. `packages/infra/global/__tests__/natEgressConsumers.test.ts` asserts that list **in both
directions** against the entries between ADR-0004's `<!-- nat-consumers:start -->` /
`<!-- nat-consumers:end -->` markers — discovery-based, not a hardcoded array. Adding the Lambda without
updating the ADR fails the gate; the reverse fails too.

---

## R2 — Notices live in the identity database, and content actions go out through the existing fan-out

**Decision.** `notice`, `decision`, `counter_notice` and `infringement_strike` are identity tables. A notice
references its target as an opaque `(content_type, content_id)` pair. When a decision requires content to be
removed, de-listed or de-identified, identity calls the owning service through the **same internal
service-to-service path account erasure already uses** — `common/erasureFanout.ts` plus
`common/serviceErasureToken.ts`.

**Rationale.**

- The repeat-infringer tally is **per account**, and `FR-020` requires one threshold applied to every account
  without exception. Keeping notices beside the account makes that a local join rather than a cross-service
  aggregation that can disagree with itself.
- The content types will multiply — recipes today; creator profiles (`012`) and lessons (`013`) later. An
  opaque `(content_type, content_id)` reference absorbs that; a foreign key to `recipes` would have to be
  redesigned the first time a notice targets a profile.
- The fan-out pattern is **proven in this codebase for exactly this shape**: identity deciding something about
  an account and instructing content-owning services to act. Reusing it adds no new failure mode, no new auth
  mechanism, and no new operational surface.

**Rejected — notices in `recipe-service`.** It splits the strike tally from the account it belongs to,
guarantees a second implementation when the second content type arrives, and puts an account-termination
decision in a service that does not own accounts.

---

## R3 — Legal documents are versioned in-repo content, not database rows

**Decision.** Terms, privacy notice, community rules and the repeat-infringer policy are **content files in
the identity service package**, addressed by a version identifier, with a manifest recording each version's
effective date, materiality classification and locale set. Acceptance records store the version identifier.
Rendering goes through the existing localization path.

**Rationale.**

- `FR-003` requires the system to render _any version a given user accepted_. Git already versions text
  immutably and for free; a database table would need its own history, its own migration story, and its own
  guarantee that a row is never edited in place — which is the exact guarantee a commit already gives.
- There is no editing audience. Counsel delivers text; an engineer commits it. A CMS would be capability built
  for a presumed future need — the definition of a YAGNI violation.

**Rejected — documents as database rows.** Adds an editing surface nobody asked for, makes "render the version
this user accepted" a data-retention problem, and creates a path where a document can be silently mutated
after acceptance, which destroys the evidentiary value of the acceptance record.

**Consequence accepted.** Publishing a document revision requires a deploy. At our cadence and volume that is
correct, not a limitation.

---

## R4 — The age floor is an attestation captured at first authenticated request, and we store the basis, not the birth date

**Decision.** Clerk does not collect a date of birth. The age check is a first-run attestation captured at the
point where `UsersService.resolveOrCreateFromClaims` already read-through-creates the user. We record **the
basis on which the account was determined to meet the floor** and the timestamp — not the date of birth.

**Rationale.**

- `FR-008` asks for a recorded basis, not a birth date. A birth date is personal data with no other use in
  this product, and collecting it would create a retention, minimisation and special-handling obligation to
  serve a boolean.
- First authenticated request is already the moment the account materialises in our database, so the check
  costs no new lifecycle hook, and `FR-009` (no publication surface below the floor) is enforceable from the
  same record.

**Rejected — collecting date of birth.** More data, more obligation, no more capability.
**Rejected — a Clerk custom field.** Puts a compliance-critical record in a system we do not control the
retention of, and makes the basis unavailable to a service-side authorization decision without a network call.

---

## R5 — Consent is one row per (account, purpose), over a closed purpose union

**Decision.** A `consent` row per account per purpose, each independently granted and withdrawn, with the
purpose set expressed as a **closed union** in the authored zod and shared through
`@kitchensink/schema-identity`. Terms acceptance is a separate record and is never treated as consent.

**Rationale.** `FR-007` requires independent withdrawal per purpose; `FR-035` requires dependent features to
degrade rather than fail. A closed union makes an unhandled purpose a compile error at every consumer instead
of a runtime string mismatch — Principle I's "make illegal states unrepresentable", and the same shape
`sourceType` already uses successfully.

**Rejected — a JSON blob of flags on the account.** Not independently auditable, no per-purpose timestamps,
and no way to prove _when_ a consent was withdrawn, which is the thing a regulator asks for.

---

## R6 — The notice lifecycle is a state machine, expressed as a pure module

**Decision.** Notice states and their legal transitions live in a pure `noticeStateMachine.ts`, with the
service layer calling it and persisting the result. Same for `repeatInfringerPolicy.ts` (strike tally →
terminate or not) and `acceptancePolicy.ts` (is this account current on terms).

**Rationale.** This is the State pattern and the codebase already uses its sibling well — `evaluateVisibility`
is a pure policy the service calls, reused unchanged by four call sites and trivially testable. The same
properties are wanted here: every transition testable without a database, one authoritative representation of
the rule, and adversarial tests that would fail if the logic were subtly broken.

**Rejected — transitions inline in the service.** Untestable without a database, and it guarantees the rule
gets restated at the second call site.

---

## R7 — Data export is asynchronous, delivered by an expiring link

**Decision.** An export request enqueues a job; the artefact lands in S3; the user receives a time-limited
link. The deadline is bounded at one month (`FR-034`) but the target is minutes.

**Rationale.** An export is unbounded in size and cannot be a synchronous response. SQS + S3 with a DLQ is the
pattern the recipe version archive already uses (`001-FR-007b-i`), including its pending-record-and-retry
discipline, so this reuses a shape the codebase has already got right rather than inventing a second one.

**Rejected — synchronous download.** Times out for any account with real content, and puts an unbounded
memory allocation in a request handler.

---

## R8 — Abuse resistance on the notice intake never becomes refusal to receive

**Decision.** Rate limiting is per source with a **recorded decline reason** (`FR-024`), never a silent drop
and never a hard refusal of the mechanism.

**Rationale.** The failure mode regulators look for is silence. A notice we declined to process must be
recorded _as declined, with a reason_, so the record shows a decision rather than an absence. This also
protects the other direction — `FR-024` exists because the mechanism can be aimed at a creator as a
denial-of-service.

**Rejected — a CAPTCHA or account requirement.** `FR-016` requires reachability without an account, and a
rightsholder's counsel is exactly the user a friction gate turns away.

---

## R9 — Contracts are authored in the service, copied to the schema package, and validated at both ends

**Decision.** Every new endpoint's zod is authored at
`packages/services/identity/src/**/*.schema.ts`, beside the controller it serves; the committed copy in
`packages/schemas/identity` carries the `z.infer` types and the `CONTRACT_HASH`; the web and mobile clients
declare **no** wire types; the intake Lambda validates with the same zod.

**Rationale.** GR-015 and GR-017 mandate it, and GR-017 §17-e.12 records that "client work as its own
deliverable" is the portfolio's **most common violation** — measured, not asserted: not one of the fourteen
`tasks.md` files carried a schema-package, `CONTRACT_HASH` or receipt-validation task. Naming it here is the
only reason it will not be skipped again.

**Rejected — deriving types from an OpenAPI document.** ADR-0014: `openapi.yaml` is derived output, never a
codegen input; going through JSON Schema loses `readonly`, branded and template-literal types and flattens
discriminated unions.

---

## R10 — Email is sent inline from the identity service via SES, with a retry sweep — not a new queue and worker

**Decision.** `FR-018a`'s email channel is **Amazon SES**, invoked from the identity service at the moment the
decision is recorded. The attempt is persisted; failures are retried by a sweep and alerted on (`FR-018b`).

**Rationale.**

- Identity already runs in the VPC with an IAM task role, so SES needs no new secret, no new vendor, and no
  new processor to disclose under `FR-039`. `commise.app` is already in Route 53, so DKIM and SPF are records,
  not a procurement exercise.
- **Persist-then-retry-then-alert is a shape this codebase already got right**: `001-FR-007b-i`'s S3 version
  archive persists a pending record on failure, retries it, and alarms on backlog age. Reusing it adds no new
  failure mode and no new operational vocabulary.

**Rejected — SQS plus a delivery-worker Lambda.** The reflexive answer, and it costs a queue, a DLQ, a
**third** VPC Lambda and therefore a third NAT consumer entry — to decouple a send that happens a handful of
times a week from a request already asynchronous from the user's point of view.

**Rejected — a third-party ESP.** New vendor, new secret, new DPA, and a processor to name in the privacy
notice, in exchange for deliverability we do not need at this volume.

**Rejected — waiting for `014-notification-service`.** Specified, unbuilt, unscheduled. Shipping US2 without
the channel that discharges `FR-018` would put a known hole in the obligation US2 exists to serve.

⚠️ **The residual risk is deliverability, and it is real.** A statement of reasons that silently bounces is
worse than one never sent, because `SC-003` counts it as delivered. Bounce and complaint handling is part of
slice 2, not a follow-up.

---

## R11 — The reviewer dashboard is routes in the existing web app, behind a dedicated review scope

**Decision.** `/[locale]/admin/notices` in `@commise/web`, guarded server-side by the existing `ScopesGuard` /
`@RequireScopes` machinery with a **new, dedicated review scope** — not a general admin scope.

**Rationale.**

- Principle V and the plan both commit to no new workspace. A separate admin application needs its own
  deployment, Clerk wiring, design-system import and CI lane, to serve one operator.
- A dedicated scope means reviewing notices confers exactly that (`FR-053g`). Reusing a broad admin scope
  would make review a side effect of unrelated privilege.
- Attribution is a legal requirement: `FR-017` records **who** decided, so the surface must be reachable only
  by an individually authenticated operator (`FR-053f`).

**Rejected — API-only.** Cheaper, and consistent with `002`'s exclusion. The owner considered it and chose the
dashboard, on the ground that decisions authored through a raw API under time pressure are where incomplete
grounds and missing facts come from.

**Rejected — a separate admin app.** New workspace, new deploy, new auth surface; nothing it buys is needed.

⚠️ **This needs `002` amended** (A-11). Its Out of Scope excludes an admin UI — but read closely, the exclusion
is about **user management**: "viewing, searching, editing, or bulk-managing users". Narrowing it may be more
accurate than reversing it. Either way it is `002`'s decision and it must land before slice 3.

---

## R12 — Retention is a scheduled sweep in `identity-webhooks`, and a legal hold is a recorded row, not a remembered flag

**Decision.** A new scheduled handler, `legalRetentionSweep.ts`, purges records **3 years after the decision
they evidence** (`FR-052a`) and pseudonymises reporter contact details once a notice's counter-notice window
closes (`FR-052b`). A record under an explicit, recorded legal hold is skipped (`FR-052c`).

**Rationale.**

- `identity-webhooks` already hosts three scheduled Lambdas — `reconciliation`, `erasureReconciliation`,
  `tombstoneSweep` — with schedule, VPC attachment and alerting solved. This is a fourth of the same kind, not
  a new pattern.
- **The hold is a row with a reason and an owner, never a boolean.** A record kept past its period without a
  recorded reason is a retention defect; an explicit hold is what makes "why is this still here" answerable a
  year later.

**Rejected — extending `tombstoneSweep`.** One job, one thing. Two unrelated retention policies in one handler
means a change to either can break the other, and the alarm would not say which.

**Rejected — no sweep, purge on access.** Storage limitation is not satisfied by data nobody happened to open.

⚠️ **This is the second new VPC Lambda**, so with `noticeIntake` it is **two** additions to ADR-0004's
`nat-consumers` list, which the gate asserts in both directions.

⚠️ **`FR-052b` depends on a term this feature never defined**: "once the counter-notice window has closed."
§512(g)(2)(C) uses 10–14 business days. It was the sixth clarification question and the quota cut it off. The
sweep cannot be implemented until it is a number.

---

## Open items carried into implementation

These are recorded rather than resolved, because they are not this plan's to resolve.

| #   | Item                                                                                                                                   | Owner              | Blocks                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| 1   | `001-FR-005b` is unrepresentable while `001-FR-003` says free-tier recipes are always public — needs D4a or an unpublished-draft state | `001` / owner      | `GR-014` AC-014-g implementation, not this feature's slices                                       |
| 2   | `001-FR-003a`'s PRO-badge derivation infers premium from privacy and must be fixed in the same change                                  | `001`              | as above                                                                                          |
| 3   | ~~Repeat-infringer threshold value and window~~ **RESOLVED** — 3 live strikes / rolling 12 months                                      | Owner (clarify Q3) | Nothing                                                                                           |
| 4   | Registered designated agent (`FR-025`) and counsel-drafted documents                                                                   | Outside software   | Slice 1 ships the machinery with placeholder content; the machinery is testable without the words |
| 5   | Whether recipe extraction is TDM for the EU reservation — now load-bearing for video, not just URL import                              | Counsel (`FR-050`) | Slice 5's guardrails are correct either way; the _basis_ is what is unconfirmed                   |
| 6   | **The counter-notice window is undefined** — `FR-052b` keys reporter pseudonymisation off it. §512(g)(2)(C) uses 10–14 business days   | Owner / counsel    | **Blocks the retention sweep in slice 4.** Ask this first next clarify pass                       |
| 7   | `002`'s admin-UI exclusion must be amended or narrowed (A-11)                                                                          | `002` / owner      | **Blocks slice 3**                                                                                |
