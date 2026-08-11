# Codebase Analysis — Notification Service

**Branch**: `014-notification-service`
**Status**: Refreshed snapshot
**Date**: 2026-05-10 · **refreshed 2026-08-05**

> The 2026-05-10 snapshot had gone materially false (sync-report DRIFT-007): it
> claimed no implementation folders existed for any cited reference, and that no
> in-app notification UI primitive existed on the client. Both were true in May and
> neither is true now. Corrections are marked **[2026-08-05]**.

---

## Current state of "notifications" across the repo

There is no notification **service**. But the repo is no longer empty around it:

**[2026-08-05]** These workspaces now exist and are shipped:

| Path                                     | Relevance to 014                                                    |
| ---------------------------------------- | ------------------------------------------------------------------- |
| `packages/services/identity`             | Clerk auth + users/accounts/profiles. **Where the group model lands** (Q-002). Already owns an SQS deletion queue — SQS is idiomatic here. |
| `packages/services/food-service`         | Feature 003 — the one launch producer that actually exists           |
| `packages/services/recipe-service`, `recipe-workers` | Feature 001 surfaces; recipe-workers already consumes SQS  |
| `packages/services/identity-webhooks`    | Lambda handlers incl. an SQS-triggered deletion worker — a working precedent for the routing consumer |
| `packages/shared/recipe-core`, `identity-core`, `identity-db`, `clerk-verify` | Shared-package conventions to follow (GR-007, NFR-008) |
| `packages/apps/commise/web`, `mobile`    | **Both already ship a notifications bell** — see below               |

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

- **Auth (002 — Clerk)**: Provides authenticated identity that subscribers must carry. **[2026-08-05]** Group membership semantics are still absent from 002 — and Q-002 is now resolved by *adding* them: the group model is built into `packages/services/identity` under this feature, deliberately not mapped onto Clerk Organizations. This original note correctly predicted the gap; the resolution is to close it, not to route around it.
- **AWS account**: Repo already uses AWS (per 001/003 plans for S3, SQS, RDS, CloudFront). SQS + SNS are available for backend-side fan-out without introducing a new dependency. WebSocket termination on AWS API Gateway is also available. None of these are mandated by this spec.
- **Sentry + Lambda Powertools (per 002)**: Operational visibility primitives already used in the repo; the operational counters story (US-007) can build on these conventions.

---

## Anti-references

The following are explicitly _not_ assumed:

- No existing event bus, pub/sub broker, or message-queue convention is shared across features today. 003 uses SQS for its own backfill queue; that is not a notification bus.
- No existing user-preference store. The first revision of this feature deliberately defers preferences (per the product spec "Won't Have").
- ~~No existing in-app notification UI primitive on the client.~~ **[2026-08-05] RETRACTED — the snapshot's most consequential error.** Both clients ship an inert notifications bell in the home chrome (see above). The launch surface is not greenfield: it is an unread count on an existing control plus the feed it opens.

**[2026-08-05]** Still accurate: no shared event bus or pub/sub convention exists. 003's
SQS backfill queue and identity's SQS deletion queue are per-feature queues, not a bus
— but they do establish SQS as the house transport, which is what makes the SQS FIFO
ordering decision in `plan.md` idiomatic rather than novel.

---

## Open follow-ups for research

- ~~Decide whether group membership lives in this feature, in 002, or in a future identity feature (product-spec Q-002).~~ **[2026-08-05] CLOSED** — owner decision: the identity service owns groups and 014 builds them there, not on Clerk Organizations.
- Survey the repo's existing service-to-service auth conventions before answering product-spec Q-004. **[2026-08-05] Still open** — and now the highest-value remaining research item, since FR-002 (producer authentication) has no decided mechanism in any artifact. The identity service verifies Clerk *user* session tokens; there is no established *service-to-service* pattern in the repo to copy.
- Confirm whether any client (web Next.js, Expo mobile) already has long-lived connections to the backend; if so, multiplex into them rather than open a new socket. **[2026-08-05] Still open** — bears directly on the realtime path (SSE vs WebSocket) in T-012.
