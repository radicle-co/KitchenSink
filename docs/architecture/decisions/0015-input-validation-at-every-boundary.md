# 0015 — Input is parsed once at the boundary against the service's own zod; the database schema is the floor; response validation is deferred

- **Status**: Accepted
- **Date**: 2026-08-12
- **Drivers**: owner directive 2026-08-12 — _"all services and specs must be updated to require input
  validation"_, clarified as _"the database schema is the minimum level of validation we should use for all
  input"_ — recorded normatively in `docs/CODING_STANDARDS.md` **§15.4** and propagated portfolio-wide as
  `specs/governance-rules.md` **GR-016**
- **Relates to**: [ADR-0014](0014-service-owned-api-contracts.md) — ADR-0014 decides **who authors** the wire
  contract and where it is published; this ADR decides **where that contract is enforced at runtime**. A
  service can satisfy every word of ADR-0014 and still accept anything, so the two are separate decisions
  and neither implies the other.

## Context

Measured 2026-08-11, across the three deployed HTTP services:

| Service                         | `ZodValidationPipe` | `createZodDto` | State                                                               |
| ------------------------------- | ------------------- | -------------- | ------------------------------------------------------------------- |
| `@kitchensink/recipe-service`   | 18                  | 26             | furthest along — but **19 files are still on `class-validator`**    |
| `@kitchensink/food-service`     | **0**               | **0**          | **no validation pipe at all**                                       |
| `@kitchensink/identity-service` | 3                   | 4              | smallest surface; one `createZodDto` route under the **wrong** pipe |

So input validation is **three different mechanisms**, and the service holding the ingredient catalog has
none. Four concrete failures follow from that state, and each one is a different kind of wrong:

⚠️ The table is the measurement that MOTIVATED this decision, not a description of the code today. All
three services now run the one mechanism decided below.

1. **The error contract collapses.** `food-service` takes `@Body() body: unknown` and hand-writes a
   `safeParse` per method. A **wrong-typed field**, a **missing field** and an **unknown key** therefore all
   report `{ error: 'Empty name' }`. Three distinct client mistakes, one answer that fixes none of them.
2. **A validation gap surfaced as a `500` that owed a `400`.** Five int-backed recipe wire fields —
   `servings`, `prepTimeMinutes`, `cookTimeMinutes`, `totalTimeMinutes`, `timerSeconds` — carried **no upper
   bound** while writing `integer` (`int4`) columns capped at **2,147,483,647**. `servings: 9999999999`
   passed validation and failed at the `INSERT`. The input was rejected by the **storage engine**, in a layer
   whose error text is not a contract, on a plain user-supplied number.
3. **A route can look validated and validate nothing.** A `createZodDto` DTO served by Nest's **own**
   built-in `ValidationPipe` — rather than `nestjs-zod`'s — performs no validation while every visible
   signal says it does. This already happened on identity's **`PATCH /users/me`**, a route that writes user
   data. It is invisible in review by construction.
4. **The surfaces a pipe cannot reach were never in the conversation.** A NestJS pipe covers HTTP.
   `recipe-workers`' handlers, food's change-refresh / SQS consumers, and `identity-webhooks`' handlers take
   bodies chosen by a producer or a third party. `identityWebhook.ts` verifies a **svix signature** — which
   proves **origin**, not **shape** — and then writes the payload's fields to the identity database.

Injection was measured at the same time and is, unusually, **not currently a live defect**: only three
`sql.raw()` sites take a non-literal argument (recipe's search DAL, and recipe-workers'
`erasureSweeper.ts` / `erasureOrphanSweeper.ts`) and all three receive a config value or a module
constant. `sql.raw` bypasses parameterisation **by design**, so that is a state to hold deliberately rather
than a box already ticked.

⚠️ **That state is now held by a LINT BAN rather than by review.** The shared ESLint config carries an
unscoped `no-restricted-syntax` rule banning `sql.raw()` outright (`packages/tools/eslint/index.js`, covered
by `packages/tools/eslint/__tests__/rawSqlBan.test.js`), and no non-test source under `packages/` calls it.

## Decision

**Every input a service accepts is parsed at the boundary against the service's own authored zod — the same
`*.schema.ts` ADR-0014 already requires — before any branch, any write, and any outbound call.**

1. **One mechanism per service: `createZodDto` + `nestjs-zod`'s `ZodValidationPipe`,** covering bodies, path
   params, query params, and any header a handler reads. No second DTO framework alongside it, and no
   per-method `safeParse`. **Validation failure has one path per service** — a `400` naming the offending
   field(s).
2. **`@Body() body: unknown` is banned.** It relocates the parse into the method body, where it is optional
   by construction and gets skipped by the next endpoint.
3. **Non-HTTP ingress is in scope**: queue and event consumers parse their payload against an authored zod
   before it becomes a job; webhooks verify the signature **and then** validate the schema. Both, in that
   order.
4. **Nothing reaches a database or another service unvalidated.** On a service-to-service edge — recipe →
   food, and identity's erasure fan-out
   (`packages/services/identity-webhooks/src/common/erasureFanout.ts`) →
   `POST /api/v1/internal/account/erasure` on recipe and food — the **outbound body is validated against the
   callee's schema-package zod before the call**, and the **inbound response is validated on receipt**.
5. **The database schema is the FLOOR.** Every input field writing a bounded column is validated at least as
   strictly as that column can store — numeric range, string length, precision/scale, enum domain,
   nullability. A value the column cannot hold is a `400` at the boundary, never a failed `INSERT`.
6. **The floor is an ASSERTION between two independently authored artifacts, not a derivation.** Zod is never
   generated from drizzle; a wire type never imports a storage type. The two agree in **one direction only**:
   the wire bound is at least as tight as the column.
7. **A request-derived value never reaches `sql.raw()`.** Where a request selects an identifier, the
   validated enum maps to a **closed allowlist of literals in code**; the request supplies the key, never the
   fragment.
8. **`z.object` vs `z.strictObject` is chosen explicitly per request surface** — `z.object()` strips unknown
   keys silently, `z.strictObject()` rejects them, and a rule that says only "validate the input" permits
   silent data loss.
9. **Response validation is DEFERRED** — see the rejected alternatives below. This decision is about
   **input**.

### Why the floor is a floor and not a schema generator

The tempting reading of _"the database schema is the minimum level of validation"_ is "derive the wire
schema from the storage schema". That is the wrong mechanism for a right requirement, in three ways:

- It **reinstates the coupling ADR-0014 removed**. `RecipeSearchResponse.facets` took its wire type from
  `../dal/search.dal.js`; that leak is the reason the `*.schema.ts` import constraint exists. A generator
  from drizzle to zod is that leak with a build step in front of it.
- It **gives almost nothing where it matters**. Recipe's text columns are `text()` — unbounded in PostgreSQL
  — so the fields users actually type into (title, steps, notes) have **no storage floor to derive from**.
  Their limits are product decisions. A derivation would produce a confident schema that is silent on exactly
  the inputs most worth bounding.
- It **inverts authority**. Derived bounds mean a migration that widens a column silently loosens the public
  contract, and one that narrows a column silently breaks clients — with no diff in the contract artifact.
  As an assertion, the same migration produces a **failure**, which is what we want.

## Alternatives rejected

### 1. Also validate responses on the service side (the "finish the job" option) — DEFERRED, deliberately

Every service already has the zod. Parsing outbound bodies with it would catch a handler that returns a shape
its own contract forbids, and it would close the `oasdiff` blind spot ADR-0014 records (`@nestjs/swagger`
emits no response schema for a handler returning an `interface`).

**Deferred by the owner: TypeScript at the boundary plus client-side validation on receipt (decision 4) was
judged sufficient for now.** The reasoning is that a response is produced by code we control and already
type-check, whereas a request is produced by a party we do not control — so the two directions do not carry
equal risk, and the runtime cost and the double-failure mode (a `500` because our own response failed our own
schema, on a request that otherwise succeeded) buy less here than the same effort spent on inputs.

**This is recorded as a deferral, not as a permanent rejection, and it is written down precisely because a
contributor will otherwise "complete" it.** Adding server-side response validation while this stands undoes a
decision. Reversing it requires its own proposal under the governance amendment process; the two facts that
should be in that proposal are already known — the zod exists, and the drift gate that would otherwise cover
responses is blind.

### 2. Derive the wire zod from the drizzle schema (or the drizzle schema from the zod)

**Rejected** for the three reasons in _Why the floor is a floor_: it reinstates the storage-into-wire
coupling ADR-0014 exists to remove, it yields nothing for `text()` columns (which is most user-typed input),
and it lets a migration silently rewrite the public contract in either direction.

### 3. Keep the hand-written per-method `safeParse`

It is explicit at the call site, adds no framework, and food-service already works this way.

**Rejected — it is optional by construction and its error contract does not survive.** The measured proof is
in this ADR's _Context_: three different failures reporting `{ error: 'Empty name' }`. A parse that each new
method must remember to perform is a parse that eventually is not performed, and there is no single place to
fix the message, the status, or the field-level detail.

### 4. Let the database reject bad input

The column constraint is already there, it is authoritative, and it cannot be bypassed.

**Rejected — it converts a client error into a server error.** A rejected `INSERT` is a `500` with no
field-level message, at the far end of a request that has already done work (and possibly opened a
transaction, taken a lock, or written a sibling row). It also makes the storage engine's error text into a
de-facto API contract. This is not theoretical: it is exactly what `servings: 9999999999` did.

### 5. Register Nest's built-in global `ValidationPipe` and call the problem solved

The obvious one-line fix for "food-service has no pipe".

**Rejected — it is the trap, not the fix.** Nest's own `ValidationPipe` does not run a `createZodDto`
schema, so it produces routes that look validated and validate nothing. Identity's `PATCH /users/me` is the
live instance. The registered pipe must be `nestjs-zod`'s, and a test that posts a known-bad body to a real
route is the only thing that can see the difference.

### 6. Validate at the HTTP edge only

Pipes are where frameworks put validation, and the HTTP surface is where untrusted input arrives.

**Rejected — it exempts the paths with the weakest supervision.** A queue consumer and a webhook handler run
with no user waiting on the response, write to the database, and take a body chosen by a producer or a third
party. A signed webhook is the sharpest case: the signature proves who sent it, which is often mistaken for
proof of what they sent.

## Consequences

**Accepted costs.**

- **A bound is expressed twice** — once in the wire zod, once in the column — and the two are kept in step by
  an assertion rather than by construction. That is the deliberate price of not coupling wire types to
  storage types; the alternative was rejected above.
- **The unknown-key decision must be made per surface** rather than inherited from a framework default, which
  is more thinking per endpoint.
- **Response shape remains weakly gated** while alternative 1 stands. Stated, not hidden.

**Still owed.**

- No service validates responses (decision 9 / alternative 1) — that is the intended state, not a gap.
- **A root `CLAUDE.md` pointer is owed.** Per this directory's README, an ADR that governs code needs an
  always-in-context tripwire, and no "looks wrong, isn't" bullet cites this one. The co-located guards are
  paid: the `sql.raw()` call sites no longer exist (a lint ban replaced them), every service's pipe
  registration carries a comment stating that Nest's own `ValidationPipe` would pass every body straight
  through — validating nothing while looking like it validates — and the response-validation note is carried
  normatively by `docs/CODING_STANDARDS.md` §15 and `specs/governance-rules.md` GR-016 §16-g.

**Questions this ADR left open — both since ruled on elsewhere.**

- 🟠 **OPEN-GR-016-A — what mechanically enforces the storage floor?** A per-service parity test that
  enumerates bounded columns and asserts each writing wire field rejects an out-of-range value is the only
  option that survives a later migration — but it must not be built by importing drizzle types into the wire
  schemas, which decision 6 forbids, so the shape of a conforming test is part of the question. The
  alternative is a review-checklist item, which rots.
- 🟠 **OPEN-GR-016-B — is `z.strictObject()` the portfolio default for mutating request bodies,** with plain
  `z.object` permitted only where a forward-compatibility reason is documented at the schema? Decision 8
  requires the choice to be explicit; it does not pick one.
