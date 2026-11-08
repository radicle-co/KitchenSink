# 0081 - Account suspension is enforced from a signed token mark

- **Status**: Accepted
- **Date**: 2026-11-02
- **Drivers**: Only identity blocked a suspended account. It did so method by method, from its database. Recipe and
  food never ask identity for a user's status. A suspended person can still read and write recipes, collections and
  foods with a token that was still valid. The owner chose a flag in the signed token over a status call between
  services.
- **Relates to**:
  [ADR-0009](0009-clerk-signout-load-gate.md) and the erasure rulings in `CLAUDE.md`: a suspended person keeps their
  data rights.
  [ADR-0040](0040-test-principals-containment-and-purge.md): the same `public_metadata` carries the test-pool marker.
  [ADR-0047](0047-shared-cors-policy.md): the other rule every adopter takes from `@kitchensink/clerk-verify`.
  [ADR-0011](0011-api-version-prefix.md): the bare `/v1` alias is still live, so route matching covers it.

## Context

Identity records a suspension as `users.status = 'suspended'`. Its own methods read that row and refuse
(`resolveUser`, `deleteUserMe`, `patchUserMe`). Nothing else does. The other services have no `users` table. A call
from recipe or food to identity on every request adds a dependency and a new failure mode to every read.

Every service already verifies the same signed Clerk session token with `verifyClerkToken`. That token carries the
user's `public_metadata`. The admin `scopes`, the `permissions`, the `roles` and the test-pool marker all come from
it. The session-token template is set once for each Clerk instance, not once for each platform. Web and native
tokens on one instance carry the same `public_metadata`.

## Decision

### 1. The mark is `public_metadata.suspended`

Identity's status is the authority. The mark is a copy of it that travels in the token.

- It is written as `true`. It is cleared by writing `null`, which Clerk's deep merge reads as "remove the key".
- `isSuspendedMark` reads it. Absent, `null` and `false` mean not suspended. Any other value means suspended. The mark
  takes access away, so an odd value fails toward the safe side. This is the opposite of `testPrincipal`, which grants
  something and so reads only a strict `true`.
- It is read from the signed `public_metadata` only. It is never read from a top-level claim or from
  `unsafe_metadata`, for the reason `scopes` is not. A test pins it to the same object as `scopes`.
- It depends on the instance-wide session-token template mapping `public_metadata`. That mapping already carries the
  admin scopes. If the template stops carrying `public_metadata`, the scopes and the mark go together.

### 2. The shared verifier refuses it once

`verifyClerkToken` throws `ClerkAccountSuspendedError` for a signature-verified token that carries the mark. The check
runs after the signature, `act` and `azp` checks. So a `403` tells a caller nothing about a token it cannot
sign. The error is not a `ClerkVerificationError`. The token is genuine, so adopters answer `403
ACCOUNT_SUSPENDED`, where a bad token is `401`.

Each adopter holds one short catch arm that maps the error to HTTP, because the verifier knows no web framework.
`suspendedGateAdopters.test.ts` finds every caller of `verifyClerkToken`. It fails if one has no such arm.

### 3. A suspended person keeps their data rights

The verifier takes the request (method and path). It exempts a short allow-list, written once in
`accountSuspension.ts`:

| Route                           | Reason                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| `POST /api/v1/users/me/erasure` | Erasure (GDPR Art. 17), identity's half                                                |
| `POST /api/v1/account/erasure`  | Erasure, recipe's half                                                                 |
| `GET /api/v1/account/export`    | Access and portability (GDPR Art. 15 and 20)                                           |
| `GET /api/v1/recipes`           | The owner's own recipe list, which the erase screen reads to build the donate election |

The bare `/v1` spelling is covered. Food exempts nothing. Its erasure is service-to-service and never carries a user
token. The erase flow does not read `GET /api/v1/users/me`. When that read fails, the profile page still shows its danger zone.
So that route stays refused.

Identity's own database gates stay. They apply at once, with no token lag.

The edge verifier sets `allowSuspended`. It takes no authorization decision. It passes the token on, and the origin
answers `403` or lets erasure through. If the edge refused, the erasure route in front of identity
answers `401`. A repo guard holds that option to the edge file.

### 4. Identity writes the mark through the deletion worker

Identity holds no Clerk secret. `suspendUser` and `unsuspendUser` now advance `status_version` in the same statement
as the status, and send the deletion worker a trigger. The worker's convergence already reads the stored status. It
settles `status_applied_version`, and only while the intent has not moved. It now also writes the mark: `true` for
`suspended`, cleared for any other status. A new module, `accountStandingClient.ts`, does the write. The mark is
written before the settle. So a suspend and an unsuspend that race are caught by the same compare-and-set that
protects the ban. The stale worker's settle fails, it throws, and the redelivery applies the newer status.

**This reverses an earlier rule.** `suspendUser` did not bump `status_version`. The reason was simple. Nothing settled an
advanced intent, so the queue check reported a lost trigger for ever. The worker now settles it. So the
bump is required, and the old reason no longer holds.

**A lost trigger is sent again.** A status change commits, then sends one message. If SQS is down at that moment the
message is gone and the intent stays unapplied. For an unsuspend that leaves the person marked suspended, and recipe
and food answer `403` until someone notices. The queue check only reads and escalates, and its role holds no send
permission, so it cannot repair this. The nightly erasure-reconciliation run already holds that permission. It now also
selects every non-erased account whose `status_applied_version` differs from `status_version` and which has been owed for
at least 15 minutes, and sends the trigger again, oldest first, up to 200 each run. The worker reads the stored status, so
a repeat, a late repeat and a repeat that overlaps the original are all harmless. The worst case for a lost unsuspend is
therefore one day, not for ever. A tighter cadence needs its own scheduled Lambda, which joins the NAT consumer list
(ADR-0004), and is not built here.

**The ship order holds in one change.** The trigger reuses the existing `reactivation` event. There is no new event
name for the worker to reject, so no message goes to the dead-letter queue whichever service deploys first. The name is
historical. The worker treats each of these events as "converge this user's provider state".

**The first deploy has one gap.** An older worker, given a trigger for a suspended user, unbans them (a no-op) and
settles the intent without writing the mark. If identity deploys first, a suspension made before the new worker is live is
marked applied while the token carries no mark, and nothing sends it again. Deploy the worker first. If a suspension was
made in the gap, suspend that account again once both are live.

### 5. A third `public_metadata` writer

`metadataSingleWriter.test.ts` admitted two writers. `accountStandingClient.ts` is the third. It meets the second's
three conditions: it merges, it writes only its own key, and it is the only metadata write in its module. It uses
`updateUserMetadata`. It never uses `updateUser({ publicMetadata })`, which replaces the whole object and erases the
roles, the scopes and the test-pool marker.

## Consequences

- Recipe, food and identity refuse a suspended account's token with `403 ACCOUNT_SUSPENDED` from one rule. A new
  adopter that calls `verifyClerkToken` gets the rule by default, and a guard holds it to the catch arm.
- Clients can now receive `403 ACCOUNT_SUSPENDED` from recipe and food, not only from identity. How each app shows it
  is a design question outside this record.
- Every convergence now makes one more Clerk API call, the mark write. That includes closure and reactivation.

### Residual risks

These are accepted, not solved.

1. **A token issued before the suspension stays valid until it refreshes.** Only tokens minted after the worker wrote
   the mark carry it. Add the queue delay to the session-token lifetime. Identity's database gates apply at once.
   Recipe and food have no database gate, so they lag.
2. **A dashboard edit can drop the mark.** An edit of a user's metadata in the Clerk dashboard can replace the whole
   object. Reconciliation compares versions, not Clerk's state, so nothing notices the loss. A later convergence
   trigger writes the mark again. Nothing schedules one.
3. **The CDN can serve a suspended person's cached responses.** The edge serves per-principal cached recipe responses
   without reaching the origin, until their TTL ends. The edge does not check the mark.

4. **Nothing rate-limits a suspended person.** Food has no limiter for them, and this record adds none. Each refused call
   costs one signature check, and Clerk keeps issuing tokens to a suspended person, so they can keep calling. The cost
   is bounded by the per-source `401` cap not counting them and by the verification pool's own concurrency limit.

There is a fifth, smaller risk. The instance-wide template is set in the Clerk dashboard, outside this repository.
Nothing here can check it. The integration tests prove the verifier reads the mark from the signed token. They cannot
prove the template puts it there.
