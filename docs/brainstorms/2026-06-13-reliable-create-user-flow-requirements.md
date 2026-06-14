# Reliable create-user flow — requirements

**Date:** 2026-06-13
**Status:** Ready for planning
**Tier:** Standard (feature)

## Outcome

A brand-new user, immediately after Clerk sign-up, can use the app — including the post-sign-up `/profile` screen — with **no app-wide loading state** and **no dependence on `user.created` webhook timing**. The identity service authenticates the user from their Clerk session and creates their records on first use; the webhook becomes background sync.

## Problem & context

The original question was whether to block the entire app behind a loading state until `user.created` lands in the database. The answer is **no** — and investigating it surfaced that the flow is currently broken in two ways a loading state could not fix.

Today's flow:
1. `packages/apps/commise/web/src/app/sign-up/[[...sign-up]]/page.tsx` renders Clerk `<SignUp>`; Clerk creates the user **in Clerk** and redirects to `/profile`.
2. `packages/apps/commise/web/src/app/profile/page.tsx` (server component) calls `GET /v1/users/me` on the identity service (ALB → ECS).
3. The `user.created` webhook (`packages/services/identity-webhooks/src/handlers/identityWebhook.ts` → `handleUserCreated`) is what writes the user/profile rows to RDS — **asynchronously** (svix delivery, eventually consistent; retries span seconds to minutes).

Two verified gaps:
- **Auth gap.** `packages/services/identity/src/auth/middleware/auth.middleware.ts` resolves the user *only* from an `x-authorizer-context` header produced by an API Gateway authorizer. That authorizer is not wired in front of the ALB (the dead copy was removed in the identity prod-hardening PR), so `/v1/users/me` throws `Missing authorizer context` (401) today regardless of webhook timing.
- **Race gap.** Even with auth, `getUserMe` → `resolveUser` (`packages/services/identity/src/users/resolveUser.ts`) reads the user by id and the `/profile` screen reads `status` (user) and `subscriptionTier` (account) — both DB-only. If the webhook hasn't landed, those rows don't exist yet.

Clerk's own guidance matches the conclusion: webhooks are eventually-consistent and should not gate a synchronous flow like just-signed-up onboarding; read the user's own data from the session token / Backend API, and use webhooks to sync *other* data in the background.

## Requirements

- **R1 — Service-side session auth.** The identity service authenticates protected requests by verifying the Clerk session JWT itself (via the JWKS/issuer it already references through SSM), populating the request user from the verified token. This replaces the hard dependency on an upstream `x-authorizer-context` producer.
- **R2 — Read-through user creation.** On the first authenticated request for a user not yet in RDS, the service creates the required rows (user **and** account, since `/profile` reads `subscriptionTier`) before responding. The response must not depend on the `user.created` webhook having arrived.
- **R3 — Webhook demoted to background sync.** `user.created/updated/deleted` continue to sync RDS and act as a backstop, but are no longer the gate for a user's own session. Creation via webhook and via read-through must be idempotent (no duplicate users/accounts) — `upsertByIdentityId` keying on the Clerk identity id is the intended idempotency anchor.
- **R4 — No app-wide blocking.** The client renders the immediate post-sign-up UI from the Clerk session (which carries identity/email/name); DB-backed fields resolve from the now-reliable `/v1/users/me`. No whole-app loading gate; at most a per-widget "finishing setup" state if any field is briefly unavailable.
- **R5 — Both platforms.** Web and mobile both consume `/v1/users/me`; the fix applies to both (no client-specific creation logic).

## Success criteria

- A newly-signed-up user loads `/profile` and sees their data on the **first** attempt, with the `user.created` webhook delivery suppressed/delayed in test.
- Concurrent `user.created` webhook + first read-through request produce exactly **one** user and one account (idempotent).
- A failed or delayed webhook does not break the user's session or `/profile`.
- No code path blocks the whole app on database/webhook state.

## Scope boundaries

**In scope**
- Service-side Clerk JWT verification and read-through creation of user + account on first request.
- Demoting the webhook to idempotent background sync.
- Client rendering the immediate experience from the session (no blocking).

**Deferred for later**
- Broader API-gateway / edge-auth architecture (an edge authorizer was explicitly *not* chosen here — see Open Questions if revisited).
- Enriching profile data beyond what's needed to render `/profile` on first load.

**Outside this change**
- Adding an app-wide blocking loading state (rejected: Clerk anti-pattern; doesn't address the auth gap; fragile under webhook delay/failure).
- Re-adding the gateway authorizer Lambda removed in the prod-hardening PR.

## Dependencies & assumptions

- **Assumption:** the create-user flow is pre-production / not yet working end-to-end (the auth gap means `/v1/users/me` currently 401s), so this is completing the flow correctly rather than patching a live regression. _Confirm if a live path exists._
- **Assumption:** `upsertByIdentityId` (keyed on Clerk identity id) is safe to call from both the webhook and the read-through path concurrently without creating duplicates.
- **Dependency:** the Clerk JWKS/issuer values already in SSM (`/kitchensink/{stage}/clerk/{jwks-url,issuer}`) are the trust anchor for R1.

## Open questions (for planning)

- **Email/name source for read-through (R2):** are `email`/`name` present in the Clerk session JWT (custom JWT template), or must the service call the Clerk Backend API on first request to obtain them? This affects first-request latency and whether a Backend API dependency is added.
- **AuthMiddleware migration (R1):** replace header-decode entirely with JWT verification, or keep `x-authorizer-context` support as a fallback for a future edge gateway? Affects whether `AuthorizerContext`/the decorator change shape.
- **Account creation (R2):** confirm what a default `account` row looks like on first creation (e.g. default `subscriptionTier`) and whether the webhook path also creates the account today.
- **Idempotency proof (R3):** validate the concurrent webhook + read-through path under test, not just by inspection.

## Notes

- Related: the identity prod-hardening PR (#37) removed the unwired gateway authorizer and left a documented note in `CLAUDE.md` that no gateway currently produces `x-authorizer-context`; R1 closes that gap from the service side.
