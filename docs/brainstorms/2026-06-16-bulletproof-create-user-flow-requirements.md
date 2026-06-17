# Bulletproof create-user flow — requirements

**Date:** 2026-06-16
**Status:** Ready for planning
**Tier:** Deep (feature)
**Builds on:** `docs/brainstorms/2026-06-13-reliable-create-user-flow-requirements.md` (shipped in PR #39)

## Outcome

After Clerk sign-up, a user **always** ends up with a complete `user + account + profile` record — no matter which path provisioned them — and **no read ever exposes a half-provisioned user**. A failure to provision is loud, not silent.

## Problem & context

The `06-13` brainstorm established the right architecture and PR #39 shipped it: the identity service verifies the Clerk session token itself and **read-through-creates** the user on first authenticated request (`packages/services/identity/src/auth/middleware/auth.middleware.ts` → `UsersService.resolveOrCreateFromClaims`), with the `user.created` webhook demoted to a background backstop and a nightly reconciliation as last-resort drift repair.

What that doc did not anticipate is the failure mode we hit in production on 2026-06-16: **the invariant was never owned in one place.** Three independent create paths each re-implement "a complete user," and they disagreed:

| Path                                                 | Wrote `users` | Wrote `accounts` + `profiles`                                                             |
| ---------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| Read-through (`resolveOrCreateFromClaims`)           | yes           | yes                                                                                       |
| Webhook (`identityWebhook.ts` → `handleUserCreated`) | yes           | yes — but **after** an external Clerk call (`setExternalId`) that could abort the handler |
| Reconciliation (`reconciliation.ts`)                 | yes           | **no**                                                                                    |

Concrete incident: Clerk user `user_3FDecfrXyGol4pl6K8RcO0yw7Va` (webb.c.brandon@gmail.com). The webhook failed repeatedly (email-reuse unique violation, then `setExternalId` AccessDenied), so **reconciliation** picked up the drift and wrote a bare `users` row — with no `accounts`/`profiles`. `getUserMe` dereferences `account.id`, so `/profile` returned a 500. The user existed but was unusable, and nothing alerted.

Partial fixes already landed (commit `2b052d3`): a shared `packages/services/identity-webhooks/src/common/provisioning.ts#ensureProfileAndAccount` now called by both the webhook and reconciliation, and `setExternalId` made best-effort. This brainstorm generalizes those point-fixes into a single owned invariant so the _next_ new path can't reintroduce the bug.

## Requirements

- **R1 — One provisioning routine owns "complete user."** A single idempotent routine creates `user + account + profile` as a unit. Every create path — read-through, webhook, reconciliation, and any future one — provisions through it. No path may write a bare `users` row. "Complete" is defined in exactly one place.
- **R2 — Reads never expose a half-user (heal-on-read).** The authenticated read path guarantees completeness before returning. A user found missing an account/profile (legacy row, crash mid-write) is healed in place, not surfaced as a 500. `getUserMe` must not hard-fail on an incomplete record.
- **R3 — Idempotent and race-safe, without a write-time transaction.** Concurrent webhook + read-through (or reconciliation) provisioning produces exactly one complete user. Idempotency is anchored on the Clerk identity id (`upsertByIdentityId`) and per-user uniqueness on the auxiliary rows (`onConflictDoNothing`). A wrapping transaction is explicitly **not** used — it deadlocked the webhook-vs-read-through race (removed in `d59e11c`); the guarantee comes from idempotency (R1) + heal-on-read (R2).
- **R4 — External side effects are best-effort and never gate provisioning.** Backfilling Clerk's `external_id` (`setExternalId`) and any other external call must run **after** the local unit is complete and must not abort it on failure. Failures are logged and left for reconciliation; the sync marker (`externalIdSyncedAt`) is stamped only on success. _(Already implemented in `2b052d3`; codified here so it can't regress.)_
- **R5 — Genuine provisioning failure is loud.** A real failure (a DB/constraint error that leaves a user incomplete) raises a distinct, filterable signal that pages — distinguished from **expected** outcomes that must not page (the email-collision placeholder fallback in `resolveOrCreateFromClaims`, an idempotent no-op). Today these failures produced zero alerts.
- **R6 — Service-side guarantee, both platforms.** The invariant lives in the identity service / sync paths, not in any client. Web and mobile both inherit it; no client-specific creation or healing logic.

## Success criteria

- Every provisioning path produces a complete `user + account + profile` or nothing — a bare `users` row is unreachable. Verified by exercising read-through, webhook, and reconciliation in isolation.
- A pre-existing bare `users` row (e.g. the current webb.c.brandon record) is healed to complete on the next authenticated read; `/profile` renders on first load.
- Concurrent `user.created` webhook + first read-through resolve to exactly one complete user, with no deadlock, under test.
- A `setExternalId` (or other external-call) failure still yields a complete, usable local user.
- A genuine provisioning failure raises an alarm; the expected email-collision fallback does not.

## Scope boundaries

**In scope**

- Consolidating the three create paths onto one idempotent provisioning routine (R1) and shared location for it.
- Heal-on-read so a half-provisioned user is never user-visible (R2).
- Codifying best-effort external side effects (R4) and the create-flow failure alarm (R5).

**Deferred for later**

- A general observability/alerting platform beyond the single create-flow alarm (its own brainstorm).
- Evolving what an `account` is (teams, billing tiers) — this brainstorm keeps the current 1:1 `account` shape.
- One-time cleanup tooling for historically-incomplete users beyond what heal-on-read and a reconciliation run cover.

**Outside this change**

- The **azp / raw-Vercel-host silent-skip**, where the _primary_ read-through path is bypassed entirely (token rejected before provisioning runs). That is a _bypass_ problem, not an _incompleteness_ problem — separate "preview auth" brainstorm.
- Re-adding a write-time transaction around provisioning (rejected: deadlock, see R3).
- An app-wide blocking loading state (already rejected in `06-13`).

## Dependencies & assumptions

- **Dependency:** the `06-13` architecture shipped in PR #39 (service-side Clerk JWT verification, read-through creation, webhook backstop, nightly reconciliation) is the substrate this hardens.
- **Dependency:** partial fixes in `2b052d3` (shared `ensureProfileAndAccount`, reconciliation completeness, best-effort `setExternalId`) — R1 generalizes them; R4 codifies them.
- **Assumption:** identity-id-keyed upsert + per-user `onConflictDoNothing` is sufficient idempotency; no transaction needed (R3).
- **Assumption:** the heal-on-read cost (a few idempotent upserts on first read / for legacy users) is acceptable on the hot auth path.

## Open questions (for planning)

- **Where does the one provisioning routine live?** It must be callable from both the identity service (NestJS, `UsersService`) and the `identity-webhooks` Lambda package. Today there are two copies (`UsersService.ensureAccountAndProfile` and `common/provisioning.ts#ensureProfileAndAccount`). Shared package vs. one package importing the other.
- **Where does heal-on-read live** so it isn't done twice per request? `resolveOrCreateFromClaims` (AuthMiddleware) already heals an existing user with no account; decide whether `getUserMe`/`resolveUser` also needs a guard or can assume the middleware ran.
- **Exact "genuine failure vs expected fallback" classification** for the R5 alarm (email-collision placeholder = expected/no-op; DB/constraint error = page).
- **Backfilling the current broken user(s):** heal-on-read on next login vs. an explicit reconciliation run — and whether reconciliation should now report users it had to complete.

## Notes

- Grounding incident and full root-cause trace are captured in memory `sandbox-user-create-failure-jun15.md`.
- Related: `docs/brainstorms/2026-06-15-auth-flow-tracing-and-reliable-user-create-requirements.md` (the debug:auth tracing that made this diagnosable), `docs/architecture/decisions/0001-sandbox-front-end-addressing.md` (the azp/preview boundary deferred above).
