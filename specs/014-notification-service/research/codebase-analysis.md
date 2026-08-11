# Codebase Analysis — Notification Service

**Branch**: `014-notification-service`
**Status**: Refreshed snapshot
**Date**: 2026-05-10 · **refreshed 2026-08-05** · **corrected 2026-08-10**

> The 2026-05-10 snapshot had gone materially false (sync-report DRIFT-007): it
> claimed no implementation folders existed for any cited reference, and that no
> in-app notification UI primitive existed on the client. Both were true in May and
> neither is true now. Corrections are marked **[2026-08-05]**.

---

## Current state of "notifications" across the repo

There is no notification **service**. But the repo is no longer empty around it:

**[2026-08-05]** These workspaces now exist and are shipped:

| Path                                                                          | Relevance to 014                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/services/identity`                                                  | Clerk auth + users/accounts/profiles. **Where the group model lands** (Q-002). Already owns an SQS deletion queue — SQS is idiomatic here. |
| `packages/services/food-service`                                              | Feature 003 — the one launch producer that actually exists                                                                                 |
| `packages/services/recipe-service`, `recipe-workers`                          | Feature 001 surfaces; recipe-workers already consumes SQS                                                                                  |
| `packages/services/identity-webhooks`                                         | Lambda handlers incl. an SQS-triggered deletion worker — a working precedent for the routing consumer                                      |
| `packages/shared/recipe-core`, `identity-core`, `identity-db`, `clerk-verify` | Shared-package conventions to follow (GR-007, NFR-008)                                                                                     |
| `packages/apps/commise/web`, `mobile`                                         | **Both already ship a notifications bell** — see below                                                                                     |

### **[2026-08-05]** The client attachment point already exists

`packages/apps/commise/web/src/components/home/chrome/HomeTopBar.tsx:114` and its
mobile counterpart render a notifications icon button with **no `onClick`, no `href`,
and no badge**. The source comment at `:112` states the reason outright:

> _"No count badge — there is no notifications service in v1, and a fabricated number
> is exactly what this surface refuses to show."_

The accessible name comes from `i18n/messages.ts` (`chrome.notifications`). This is a
shipped, user-visible affordance waiting on precisely this feature. The original
snapshot's claim that _"No existing in-app notification UI primitive on the client"_
is the single most consequential thing that changed — 014's plan had specified a
transport with no client surface to attach to.

### Spec-level references (per `specs/cross-feature-consistency-report.md` §5.3 and WA-004)

| Feature                  | Reference                                                                                                                                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 001 — Commise            | `product-spec/product-spec.md` mentions notifications in vision/principles. No transport defined.                                                                                                         |
| 003 — USDA Food Data     | `plan.md` mentions "email/webhook notifications" for fetch failures. `product-spec/product-spec.md` US-005 (Rev 1) explicitly depends on an in-app notification when a backfilled food becomes available. |
| 005 — AI Integration     | `plan.md` mentions transparency disclosures on AI-generated content. No transport defined.                                                                                                                |
| 008 — Cooking Mode       | `plan.md` mentions timer alerts. No transport defined.                                                                                                                                                    |
| 009 — Nutrition Planning | `plan.md` mentions notifications for compliance gaps. No transport defined.                                                                                                                               |

### Implementation-level references

None. No notification code exists in the repository at the time of bootstrap.

---

## Inferred requirements from existing producers

These are the constraints implied by the consuming features as currently specced:

1. **003 backfill notification (firm)**: When a `pending` food row transitions to `fetched`, the original requester(s) must be notified in-app. Multiple users may have requested the same food (US-005 demand-weighted prioritization), so single-recipient and "fan-out to all requesters" must both be expressible. The "fan-out to all requesters" case is naturally a list of single-user publishes; the service does not need a distinct primitive for it.

2. **008 timer alerts (firm in spirit, soft in spec)**: Cooking mode timers are per-user and time-sensitive. Suggests low-latency in-app delivery is required, not a polling cadence measured in minutes.

3. **Global broadcasts (implied, not yet firm)**: Operations and product-wide announcements are not currently specced anywhere but were flagged in the cross-feature report as a gap. The recipient model includes `global` to allow this without a follow-up spec change.

---

## Existing infrastructure that may be reused

> Names below are repo-wide context; nothing in this folder constrains the implementation choice.

- **Auth (002 — Clerk)**: Provides authenticated identity that subscribers must carry. **[2026-08-05]** Group membership semantics are still absent from 002 — and Q-002 is now resolved by _adding_ them: the group model is built into `packages/services/identity` under this feature, deliberately not mapped onto Clerk Organizations. This original note correctly predicted the gap; the resolution is to close it, not to route around it.
- **AWS account**: Repo already uses AWS (per 001/003 plans for S3, SQS, RDS, CloudFront). SQS + SNS are available for backend-side fan-out without introducing a new dependency. WebSocket termination on AWS API Gateway is also available.
- **[2026-08-10] EventBridge is already in production use, and this feature now depends on it.** The food
  service publishes `FoodFetchCompleted` through `publishFoodFetchCompleted` against a deployed CDK
  `FoodFetchCompletedRule` (`detailType: ['FoodFetchCompleted']`), and uses the bus for its scheduled
  change-refresh producer. FR-024 makes an EventBridge subscription one of this service's two ingresses, so
  the substrate is not novel — but no **shared** bus, resource policy or cross-feature `detailType`
  convention exists yet, and this feature is the first to need one.
- **[2026-08-10] A service-to-service auth pattern DOES exist.** `packages/shared/recipe-core/src/serviceErasureToken.ts`
  mints and verifies an **Ed25519** service-principal JWT, verified networklessly against an SPKI public key
  injected as `FOOD_SERVICE_PRINCIPAL_JWT_KEY` (see `packages/services/food-service/infra/lib/food-service-stack.ts`
  and its erasure-auth tests). FR-032 adopts exactly this scheme. The earlier note below — that the repo had
  no service-to-service pattern to copy — was true of the _identity_ service only, which verifies Clerk
  **user** session tokens, and it caused Q-004 to be recorded as unanswerable for three months.
- **Sentry + Lambda Powertools (per 002)**: Operational visibility primitives already used in the repo; the operational counters story (US-006) can build on these conventions.

---

## Anti-references

The following are explicitly _not_ assumed:

- ~~No existing event bus, pub/sub broker, or message-queue convention is shared across features today. 003 uses SQS for its own backfill queue; that is not a notification bus.~~ **[2026-08-10] Corrected on both counts.** An event bus **is** in use — 003 publishes `FoodFetchCompleted` to EventBridge against a deployed rule — and 003's own fetch queue is **not** SQS: it is a durable Postgres `fetch_queue` table drained with `LISTEN/NOTIFY` by a single Fargate worker, explicitly _no SQS_ (003 A-005, FR-011/FR-014/FR-017). What remains true is the narrower claim: **no shared, cross-feature bus convention exists** — each feature's bus usage is its own. FR-024 makes this feature the first to define one.
- No existing user-preference store. The first revision of this feature deliberately defers preferences (per the product spec "Won't Have").
- ~~No existing in-app notification UI primitive on the client.~~ **[2026-08-05] RETRACTED — the snapshot's most consequential error.** Both clients ship an inert notifications bell in the home chrome (see above). The launch surface is not greenfield: it is an unread count on an existing control plus the feed it opens.

**[2026-08-10]** What actually establishes SQS as the house transport is **identity's SQS deletion queue**
plus `recipe-workers`' SQS consumption, not 003's fetch queue — which is Postgres. The SQS FIFO ordering
decision in `plan.md` is still idiomatic on that basis. Separately, EventBridge is established for
**completion signals and scheduled producers**, which is exactly the role FR-024's second ingress plays.
The two choices are complementary, not competing: the bus is how an envelope arrives, the FIFO queue is how
its order is fixed.

---

## Open follow-ups for research

- ~~Decide whether group membership lives in this feature, in 002, or in a future identity feature (product-spec Q-002).~~ **[2026-08-05] CLOSED** — owner decision: the identity service owns groups and 014 builds them there, not on Clerk Organizations.
- ~~Survey the repo's existing service-to-service auth conventions before answering product-spec Q-004.~~ **[2026-08-10] CLOSED, and the 2026-08-05 answer was wrong.** The pattern existed the whole time: the Ed25519 service-principal token in `packages/shared/recipe-core`, keyed by `FOOD_SERVICE_PRINCIPAL_JWT_KEY`. FR-032 adopts it and requires networkless verification. The earlier note looked only at the identity service, found Clerk _user_ session tokens, and concluded no pattern existed — a survey that stopped one package short and left Q-004 blocking T-003 for three months.
- Confirm whether any client (web Next.js, Expo mobile) already has long-lived connections to the backend; if so, multiplex into them rather than open a new socket. **[2026-08-05] Still open** — bears directly on the realtime path (SSE vs WebSocket) in T-012, now the only research item blocking implementation start.
- **[2026-08-10] New:** establish whether producers can be relied on for a comparable clock. FR-029 makes
  `occurredAt` producer-assigned and the cross-path ordering key; producers do not share a clock, so skew
  between two publishers addressing the same recipient is the failure mode behind HAZ-037.
