# Engineering Excellence — The Quality Bar

> **STATUS: NORMATIVE, MANDATORY, LOAD-BEARING.** This document defines what _engineered_, production-grade software means in this repository — across correctness, design, frontend, backend, and testing. It is not aspirational reading. It is the bar every change is measured against.
>
> **You MUST read the section(s) relevant to your change BEFORE writing a single line of code, and again before you claim a change is "done."** "I didn't read it" is never an acceptable reason for a defect this document would have prevented. Where this document and a narrower repo doc (`docs/CODING_STANDARDS.md`, an ADR) both apply, follow the stricter rule.

## What "quality software" actually is

"It works on the happy path" is not quality — it is a demo. Engineered software is **correct** (it does the right thing for every input and state, not just the obvious one), **robust** (it behaves sanely under bad input, concurrency, and dependency failure), **secure** (it authorizes every action and trusts nothing it did not verify), **observable** (you can tell what it's doing in production), **performant enough** (it meets its latency/throughput targets under real load), **tested** (its guarantees are proven by tests that fail when the guarantees break), and **changeable** (the next engineer can modify it safely). Miss any one of these and the code is a liability, no matter how fast it shipped.

The recurring failure this document exists to prevent is **the illusion of quality**: clean-looking code that only handles the sunny path, and a green test suite that would stay green even if the code were broken. Both pass casual review. Both cause incidents. Hold the line here.

## How to use this document (progressive disclosure)

- **Touching backend/service code?** Read _Backend Engineering Excellence_ + _Design Patterns, Principles & Code Quality_.
- **Touching UI (web or mobile)?** Read _Frontend Engineering Excellence_ + _Design Patterns, Principles & Code Quality_.
- **Writing or reviewing ANY test?** Read _Quality Systems Engineering & Test Excellence_ — every time. This is the section that makes coverage-theater impossible to pass off as testing.
- **Reviewing a PR?** Read the relevant sections and hold the author to them. A review that lets a violation through owns the defect too.

The single most important heuristic in this entire document: **"Would this still be true / would this test still pass if the code were subtly broken?"** If yes, you haven't proven anything yet.

---

## Quality Systems Engineering & Test Excellence

> This section is the bar against which every test in this repo is judged. **A test that would still pass if the production code were broken is not a test — it is coverage theater.** The rules below are written to make that impossible to pass off as real testing. See also the ABSOLUTE test-first mandate in `docs/CODING_STANDARDS.md §7.1` and the root `CLAUDE.md` — this section is the _how-to-do-it-well_ companion to that _you-must-do-it_ mandate.

### 1. Philosophy — build quality in, don't inspect it in

- **Build quality in; you cannot test it in afterward.** Inspection at the end finds defects but does not create quality — quality comes from the process that produces the code, so shift defect-detection as early as possible.
- **Obey the cost-of-defect curve.** A defect caught at authoring costs minutes; the same defect in production costs orders of magnitude more — write the test that catches it now, not the incident review that catches it later.
- **Treat tests as executable specification.** A test states "given this state, when this action, then this result" — it is the one form of documentation that cannot silently go stale, because it fails when it lies.
- **Optimize for confidence, not coverage.** Coverage measures which lines _ran_; confidence measures which _behaviors are proven_. Ask "do I have confidence that everything the spec promises actually works?" — not "what's my line %?"
- **Every failing test must buy information.** If a test can fail without teaching a human something actionable, it is a tax, not an asset.

### 2. Test design — structure that survives refactoring

- **Test behaviors, not methods.** Organize tests around a guarantee the system makes ("Given/When/Then"), not around the shape of the code — one method hosts many behaviors, one behavior spans many methods.
- **Follow red-green-refactor.** Write a failing test first (prove it _can_ fail), make it pass minimally, refactor under green. A test you never saw fail is an untrusted test.
- **Structure every test Arrange-Act-Assert.** One setup, one exercise, one assertion block — mixing them hides what is being proven.
- **Assert one behavior per test.** If the name needs "and," split it — one reason to fail means a failure names its own cause.
- **Prefer DAMP over DRY in tests.** A little duplication is fine if it makes the scenario readable in-place; apply DRY to helper mechanics, DAMP to the steps a reader must see. Tests have no tests — readability outranks deduplication.
- **Name the test after the behavior and outcome.** `returns_401_when_bearer_token_expired` beats `testAuth3` — reading the suite's names alone should enumerate the system's guarantees.
- **Choose pyramid proportions by cost and speed, but win the real argument first.** Many fast unit tests, fewer integration, fewest E2E — yet the shape debate is a distraction until your tests "establish clear boundaries, run quickly & reliably, and only fail for useful reasons." Get _that_ right first.

### 3. Meaningful tests vs. coverage theater — the crux

- **Assert a real outcome, never merely execute a line.** The assertion-free test — calls the code, checks nothing — is the canonical fraud. Ban it.
- **100% coverage ≠ correct.** Coverage tracks execution, not verification; a mutation that flips `>` to `>=` survives a fully-covering suite that never asserted the boundary.
- **Test the contract, not the implementation.** Depend on the public API / observable behavior. A test that asserts private state or internal call order breaks under harmless refactors and passes through real breakage — that brittleness is a defect _in the test_.
- **Kill the happy-path-only suite.** A behavior is not covered until its **error paths, empty inputs, boundary values, and unauthorized cases** are asserted. "It works when everything is perfect" is the weakest possible claim.
- **Do not over-mock.** Mock roles, not objects. Mocking every collaborator produces a test that asserts your mocks were called as you wrote them — a tautology that stays green when the real integration is broken.
- **Assert outcomes, not calls.** "The mock was invoked with X" is weak; "the persisted row now equals Y / the response body is Z / this specific error was thrown" is strong. Prefer the latter always; use call-assertions only for genuinely fire-and-forget side effects.
- **THE ACID TEST for every test: "Would this still pass if the code were broken?"** If yes, it is theater — rewrite it until a plausible bug makes it fail.

### 4. Rigor techniques — prove the suite actually catches bugs

- **Run mutation testing as the audit of the audit.** A mutation tool injects small faults (flip a condition, swap an operator, drop a statement); a surviving mutant is a bug your suite cannot see. **Mutation score is a truer quality signal than line coverage** — prioritize it on core domain logic and anything AI-generated.
- **Do the delete-a-line / mutate-a-condition thought experiment in review.** Before approving a test, mentally break the code it guards. If the test would stay green, it isn't testing that code.
- **Analyze boundaries and equivalence partitions explicitly.** For every input dimension test the edges (0, 1, max, max+1, empty, null) and one representative per class — defects live at edges.
- **Write negative and error-path tests.** Assert the _exact_ failure: which error type, message, status, rollback. Unasserted failure modes are where incidents come from.
- **Inject failures deliberately.** Simulate timeouts, dropped connections, dependency 5xx, malformed payloads, partial writes — a system is only as correct as its behavior when a dependency misbehaves.
- **Test concurrency and races where they exist.** Exercise interleavings, contention, and idempotency of retried operations — a dedup/reconciliation path needs a test that reproduces the _race_, not just the sunny sequence.
- **Prefer properties over examples for invariant-bearing code.** State the rule that must hold for _all_ inputs ("encode∘decode is identity," "output is always sorted," "no constructed SQL contains unescaped input") and let a generator attack it; shrinking hands you the minimal counterexample.
- **Fuzz parsers, deserializers, and untrusted-input boundaries.** Malformed/random bytes surface faults no example suite enumerates.
- **Use contract tests between services.** Consumer-driven contracts force a provider change that breaks a real consumer to fail a test, not production.
- **Pin legacy behavior with golden/characterization tests before changing it.** Capture current output as the oracle so a refactor of untested code is provably behavior-preserving.

### 5. Test quality attributes — the FIRST properties

- **Fast** — unit tests in milliseconds, or they get skipped. **Isolated** — no test depends on another's order or leftover state. **Repeatable/deterministic** — root-cause flakiness, _never_ retry it; a retry annotation hides a real race/clock/ordering bug and, past ~1% flake, the suite loses all value. **Self-validating** — an assertion decides pass/fail, not a human reading logs. **Timely** — written with the code, while the edges are fresh.
- **One reason to fail** per test, and **readable as prose** — a test is documentation first, verification second.

**Test smells to reject in review (Meszaros):** _Assertion Roulette_ (many bare assertions, no messages) · _Mystery Guest_ (depends on unseen external data/fixtures) · _Eager Test_ (many behaviors in one) · _Fragile/shared fixture_ (over-broad setup coupling unrelated tests) · _Over-mocking_ (proves only that mocks were configured) · _Test-induced design damage_ (production indirection existing solely to be testable).

### 6. Integration & E2E rigor — test against real dependencies

- **At the integration layer, test against REAL dependencies, not mocks.** Mocks encode your _assumptions_ about a dependency; real containers (Testcontainers / Docker Postgres / LocalStack) test the dependency itself — SQL, constraints, isolation, S3 semantics. This repo's harness already boots the real Nest app against Docker Postgres + LocalStack — follow it.
- **Cover the real user journeys end-to-end** — at least one test per critical path drives the system exactly as a client would; unit correctness does not imply the wiring works.
- **Keep E2E scarce, deterministic, and hermetic**; each test seeds and cleans its own data (transaction rollback or explicit teardown) so runs are order-independent — leaked state is the #1 cause of "passes locally, fails in CI."
- **Enforce the repo's selector/timing rules:** `getByRole`/`getByLabel` only; `data-testid` and `page.waitForTimeout()` are banned — wait on real conditions, not wall-clock guesses.

### 7. Requirements & completeness — prove the spec is met

- **Trace every acceptance criterion to at least one test** — an untraced criterion is an unverified promise.
- **"Tests for every path and state" is part of Definition of Done.** For each behavior enumerate its states (valid, invalid, empty, unauthorized, boundary, failure) and show a test per state.
- **Verify the specification is _fully_ satisfied**, not merely that code executes — "does every guarantee the spec makes hold?"
- **Enforce cross-platform parity in tests** — a user-facing behavior tested on only one of web/mobile is half-done.

### 8. Reviewing test quality — how to spot a weak test

- Ask **"would this still pass if the production code were broken?"** — if a plausible bug leaves it green, send it back.
- Run the **mutate-a-condition** experiment on the diff: flip a boundary, negate a guard, delete an early return — if no test turns red, the branch is unprotected regardless of coverage.
- Confirm assertions verify **outcomes, not calls**, and bind to the **public contract, not internals**.
- **Reject:** any test without a meaningful assertion; any suite whose coverage rose without its behavior set rising; any green that a retry made green. These are the three tells of coverage theater.

### Sources

Titus Winters et al., _Software Engineering at Google_ [Ch. 11–12](https://abseil.io/resources/swe-book/html/ch12.html) · Gerard Meszaros, _xUnit Test Patterns_ / [testsmells.org](https://testsmells.org/pages/testsmells.html) · Freeman & Pryce, _Growing Object-Oriented Software, Guided by Tests_ · Kent Beck, _TDD by Example_ · Martin Fowler, [Test Shapes](https://martinfowler.com/articles/2021-test-shapes.html) / [Is TDD Dead?](https://martinfowler.com/articles/is-tdd-dead/) · Kent C. Dodds, [Testing Trophy](https://kentcdodds.com/blog/the-testing-trophy-and-testing-classifications) · [Trail of Bits — mutation testing](https://blog.trailofbits.com/2025/09/18/use-mutation-testing-to-find-the-bugs-your-tests-dont-catch/) · [Hypothesis — property-based testing](https://hypothesis.works/articles/what-is-property-based-testing/) · [Docker — Testcontainers](https://www.docker.com/blog/testcontainers-testing-with-real-dependencies/) · [Google Testing Blog — flaky tests](https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html).

---

## Backend Engineering Excellence

A load-bearing reference for engineering — not merely coding — backend systems. Read before writing any backend code.

### 1. API design (REST / HTTP semantics)

- **Design contract-first: write the OpenAPI spec before the handler.** The spec is the source of truth clients, mocks, and tests derive from — code-first drifts and lies.
- **Use HTTP status codes for their defined meaning.** `200/201/204` success · `400` malformed · `401` unauthenticated · `403` authenticated-but-forbidden · `404` absent/hidden · `409` conflict · `422` semantically-invalid · `429` rate-limited · `5xx` server fault. Clients and proxies act on the class; misuse breaks retries and caching.
- **Make writes idempotent; require an `Idempotency-Key` on non-idempotent POSTs** and cache the first response keyed by (key, endpoint, principal). Networks retry; without keys a retry double-acts.
- **Honor verb idempotency contracts:** GET/PUT/DELETE idempotent, POST not. A `DELETE` of an already-deleted resource returns success-shaped (`204`/`200`), not `500`.
- **Paginate every unbounded collection; prefer cursor (keyset) over offset.** Offset drifts and degrades O(n) on deep pages; an endpoint that can return "all rows" is an outage waiting for data growth.
- **Return a single, consistent error envelope** (this repo: `{ code, message, details? }` via one exception filter; align with RFC 9457 semantics). One machine-readable shape beats N bespoke ones.
- **Version additively; bundle breaking changes into a new version.** New resources / optional params / new response fields are backward-compatible; renames and type/semantic shifts are breaking.
- **Validate at the boundary and reject early — parse, don't just check.** Coerce untrusted input into typed domain values (Zod) at the controller edge so the interior only ever sees valid data.
- **Never expose internal IDs, stack traces, or SQL in responses;** prefer random/UUID resource IDs over sequential (sequential enables enumeration).

### 2. Domain modeling & architecture

- **Layer strictly: controller → service/use-case → domain → DAL; dependencies point inward only.** The domain must not import the framework, the ORM, or HTTP.
- **Define ports (interfaces) in the domain; implement adapters at the edge** (hexagonal / ports-and-adapters). The domain declares needs; infrastructure satisfies them, so infra is swappable and the core is testable without a DB.
- **Keep domain logic pure: no I/O, no clock, no randomness inside entities/value objects** — inject those as ports. Pure cores are deterministic and trivially unit-testable.
- **Put behavior on the model — reject the anemic domain model** (bags of getters/setters with rules smeared across services). Data + the rules guarding it belong together.
- **Guard invariants inside aggregate boundaries; mutate an aggregate only through its root; one transaction modifies one aggregate.** The aggregate is the consistency unit.
- **Avoid the god object too — split when a class owns unrelated invariants.**

### 3. Data & integrity

- **Wrap every multi-statement invariant in one transaction; keep transactions short.** Atomicity is the only guarantee a partial failure can't corrupt state; long transactions hold locks and starve the pool.
- **Choose isolation deliberately:** default Read Committed; use Serializable (Postgres SSI) for money/inventory/cross-row invariants and retry serialization failures. Read Committed permits write skew.
- **Prefer optimistic concurrency (version column, `WHERE version = ?`) for low contention; pessimistic locks (`SELECT … FOR UPDATE`) for hot contended rows.**
- **Enforce invariants in the DB with constraints (NOT NULL, UNIQUE, FK, CHECK), not just app code.** A unique constraint is the _only_ reliable dedup under concurrent inserts — `exists?`-then-`insert` races.
- **Make migrations expand/contract (parallel change) for zero downtime;** never do a destructive migration (drop/rename/NOT NULL) in the same deploy as the code that stops using it.
- **Kill N+1 access patterns** — batch, join, or dataloader instead of per-row queries in a loop.
- **Index for your actual predicates and verify with `EXPLAIN`; index FKs and sort/filter columns.** An unindexed WHERE on a growing table is a latent full-scan outage.
- **Pool connections; size the pool small and deliberate; never a connection per request.**

### 4. Reliability & resilience (Release It! + AWS Builders' Library)

- **Set an explicit timeout on every remote call** (connection + request) — a thread blocked forever on a hung dependency exhausts the pool and spreads the failure.
- **Retry only idempotent, retryable failures (5xx/timeouts), never 4xx; cap attempts; exponential backoff with full jitter.** Synchronized retries DDoS your own dependency.
- **Wrap flaky dependencies in a circuit breaker:** trip on threshold, fail fast while open, probe half-open — fast-fail frees threads during an outage.
- **Partition resources with bulkheads** (separate pools/queues per dependency) so one saturated dependency drains only its compartment.
- **Degrade gracefully:** return cached/partial/default results when a non-critical dependency is down — serving something beats a 500.
- **Make every message consumer idempotent — assume at-least-once, dedup by message ID (inbox pattern).** Exactly-once end-to-end is unattainable; design for duplicates.
- **Use the transactional outbox for the dual-write problem:** write business row + event in one transaction, relay asynchronously — eliminates "committed the row, lost the event."
- **Route poison messages to a DLQ with a retry cap; alert on DLQ depth.** Infinite redelivery is a silent self-inflicted outage.
- **Apply backpressure — bound queues and shed load (`429`/`503`) rather than accept work you can't complete.** Unbounded intake turns overload into an OOM crash.

### 5. Error handling

- **Define typed domain errors** (extend `Error`, set the prototype, ship an `is*` guard) so callers branch on failure kind, not string-matched messages.
- **Fail fast on programmer errors/invariant violations; fail safe (degrade) on expected operational failures.**
- **Never swallow an error** — handle, wrap-and-rethrow, or propagate; `catch {}` into silence is a bug that reappears later as corrupt state with no trace. (A deliberately-swallowed error must carry a comment explaining why it is safe.)
- **Map domain errors to HTTP at one boundary layer;** the domain throws typed errors, the edge translates — keeps HTTP out of the core and the mapping consistent.
- **Log errors as structured events with a correlation/request ID propagated across service and queue hops;** log the cause once, at the boundary where it's handled, not at every catch on the way up.

### 6. Security

- **Separate authentication (who you are) from authorization (what you may do); verify both on every request.** A valid token is not permission.
- **Enforce object-level authorization on every ID-bearing endpoint** — check the caller owns/may-act-on _this specific object_. BOLA/IDOR is OWASP API #1. Route auth ("is a user") without object auth ("is _this_ user's object") is the most common critical API flaw.
- **Enforce property-level authorization:** never mass-assign; never return fields the caller may not see. Whitelist writable and readable fields.
- **Grant least privilege everywhere** (DB roles, IAM, tokens scoped to the minimum) to shrink blast radius when — not if — a credential leaks.
- **Never trust a client-suppliable header, hidden field, or claim you didn't cryptographically verify.** Anything the client can set, an attacker can forge.
- **Validate and bound all input (type, length, range, format) server-side, independent of client validation** — client validation is UX; server validation is security.
- **Keep secrets in a manager (env-injected/Secrets Manager/SSM), never in code, logs, or responses; rotate them.**
- **Layer defenses (defense in depth) and work the OWASP API Top 10 (2023) as a checklist.**

### 7. Observability

- **Emit all three pillars — structured logs, metrics, traces — correlated by request ID.** Each answers a different question; you need all three to debug prod without a repro.
- **Define SLIs from the user's perspective (latency, availability, error rate) and commit to SLOs;** run an error budget (1 − SLO) that governs release policy.
- **Alert on symptoms (SLO burn rate), not causes; make every alert actionable** — if a human can't act on it, it's a dashboard, not an alert.
- **Expose a real health check that verifies critical dependencies; separate liveness from readiness.** A "200 OK" that doesn't check its DB routes traffic into a broken instance.

### 8. Performance & scalability

- **Keep services stateless; push session/state to a shared store** — the precondition for horizontal scaling and painless restarts.
- **Scale horizontally by default; treat instances as cattle, not pets.**
- **Cache cache-aside by default; set TTLs with jitter and design invalidation up front; prevent stampedes** (jitter, single-flight, serve-stale-while-revalidate).
- **Push slow/spiky/non-user-facing work to async queues; return `202 Accepted`.**
- **Think in capacity** — know per-instance throughput, headroom, and the next bottleneck before traffic finds it; **load- and soak-test to failure (k6), not just to target.**

### 9. Testing (backend)

- **Many fast unit tests on the pure domain (no I/O); fewer integration tests against real deps (ephemeral Postgres + LocalStack); fewest E2E.**
- **Use consumer-driven contract tests at service boundaries** so provider changes can't silently break consumers.
- **Test the hard parts explicitly: transaction rollback, concurrent updates (lost-update / optimistic conflict), and injected failures** (timeouts, dropped/duplicate messages) — exactly the paths that break in prod and that coverage never exercises.
- **Verify idempotency with a test that calls the endpoint twice with the same key and asserts one effect.**

### Sources

[OWASP API Security Top 10 (2023)](https://owasp.org/www-project-api-security/) · [RFC 9457 Problem Details](https://www.rfc-editor.org/info/rfc9457/) · [Stripe — idempotency](https://stripe.com/blog/idempotency) & [API versioning](https://stripe.com/blog/api-versioning) · Nygard, _Release It!_ · [AWS Builders' Library — timeouts/retries/backoff](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/) · [Cockburn — Hexagonal Architecture](https://alistair.cockburn.us/hexagonal-architecture) · Fowler, [Practical Test Pyramid](https://martinfowler.com/articles/practical-test-pyramid.html) & [Anemic Domain Model](https://martinfowler.com/bliki/AnemicDomainModel.html) · [microservices.io — Transactional Outbox](https://microservices.io/patterns/data/transactional-outbox.html) · [PlanetScale — backward-compatible schema changes](https://planetscale.com/blog/backward-compatible-databases-changes) · [PostgreSQL — Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) · [Google SRE — Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/) · Kleppmann, _Designing Data-Intensive Applications_ · Evans, _Domain-Driven Design_.

---

## Frontend Engineering Excellence

For building UIs that are correct, fast, accessible, and maintainable. Read before writing any frontend code.

### 1. Architecture & component design

- **Prefer composition over configuration/inheritance.** Pass children and slots rather than growing a prop list with booleans — `<Card><Card.Header/>…</Card>` scales; `<Card showHeader hideFooter variant=…>` is a god-component smell.
- **Separate "how it looks" from "how it works" via headless UI** — behavior, state, and a11y in a hook/unstyled primitive (Radix, React Aria, TanStack), markup and styles owned by the app.
- **Keep components either presentational or container, not both** — isolate data/effects at the edges; keep leaf components pure functions of props.
- **Structure by feature domain, not file type;** co-locate a feature's components, hooks, tests, types (matches this repo's folder rule; `helpers/` dumping grounds are banned).
- **Enforce a one-directional dependency graph: shared → feature → app, never the reverse;** features must not import each other's internals.
- **Fix prop-drilling with composition first, context second, a state library last;** never put frequently-changing values in a single Context (every consumer re-renders on any change).
- **Design the public API (prop contract) of a component before its internals** — small, orthogonal, hard-to-misuse; discriminated variants over free booleans.

### 2. State management

- **Classify every piece of state — server, URL, local, or global — and store it in exactly one place.** Most bugs are two copies of "the same" state disagreeing.
- **Treat server data as a cached snapshot you don't own — manage it with React Query/SWR, not `useState`+`useEffect`.** Never copy server state into Redux/Zustand/Context; the query cache is the source, invalidation lives there.
- **Derive, don't store.** Anything computable from existing state (filtered lists, totals, `isValid`) is computed during render, not held in its own state and synced by an effect — redundant state drifts.
- **Tune `staleTime` per domain instead of disabling refetch;** normalize relational/entity data by id rather than nesting duplicated records; colocate state as low as possible.

### 3. Rendering & performance

- **Give lists stable, identity-based `key`s — never the array index** (index keys corrupt state/inputs/animations on reorder).
- **Memoize only in response to a measured problem;** profile first. Prefer restructuring (lift children out, pass as `children`, move state down) over `useMemo` band-aids. **Memoization is a performance tool, never a correctness tool** — if a re-render causes a visual bug, fix the component.
- **Virtualize any list that can exceed ~100 rows.**
- **Code-split at route/heavy-widget boundaries with `lazy`+`Suspense`; enforce a bundle budget in CI.**
- **Own Core Web Vitals as hard targets at p75: LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1** — treat a regression like a failing test. Reserve space for async/media (aspect-ratio/skeletons) to keep CLS ~0; break up long tasks and yield to protect INP.
- **Server-first component tree (RSC) with minimal, intentional client boundaries;** stream with `Suspense` around slow subtrees.

### 4. Correctness & robustness

- **Model every async view as loading / empty / error / success — first-class states, not afterthoughts.** The empty and error states are features.
- **Represent request state as a discriminated union, not a bag of booleans** — makes "loading with data and error simultaneously" unrepresentable.
- **For optimistic updates: cancel in-flight refetches first, snapshot, apply, roll back on failure.**
- **Guard every async result against races (request id / `AbortController`); commit only the latest.**
- **Make inputs controlled xor uncontrolled and never flip; make mutations idempotent/de-duplicated (disable-on-submit, idempotency keys).**
- **Validate at the boundary and render trusted, typed data inward** — parse the API response once at the edge.

### 5. Accessibility (WCAG 2.2 AA) — a correctness concern

- **Use the native HTML element before any ARIA** (First Rule of ARIA) — bad ARIA is worse than none.
- **Never add a role without also implementing its keyboard interaction and state** — ARIA changes only the accessibility tree; it adds no behavior.
- **Query and build UI by role and accessible name** — if `getByRole('button',{name})` can't find it, neither can a screen reader.
- **Manage focus explicitly across route changes, dialogs, async content** (move in, trap, restore); ensure full keyboard operability with a visible focus indicator and no traps.
- **Meet contrast minimums (4.5:1 text, 3:1 large/UI) and WCAG 2.2's new AA criteria** (focus not obscured, target size ≥ 24px, dragging alternatives); **never convey meaning by color/position/shape alone.**

### 6. Type safety & contracts

- **Run TypeScript `strict` with zero `any`, and never suppress with `@ts-ignore`/`@ts-expect-error`** (repo standard).
- **Model domain state with discriminated unions; enforce exhaustiveness with a `never` default** so the compiler fails the build on an unhandled variant.
- **Parse external data at the boundary with a schema (Zod), don't cast it** — `as ApiResponse` is a lie the compiler believes.
- **Type the API client end-to-end from a single contract** (OpenAPI / shared zod) — hand-written response interfaces silently diverge.

### 7. Design systems & cross-platform UX

- **Drive all visual decisions through design tokens as the single source of truth,** structured primitive → semantic → component, referenced by intent not value (`color-text-primary` → `blue-600`).
- **Ship every user-facing feature to web and mobile in the same release; share logic, branch only presentation** (`.native.tsx` for platform-specific rendering — repo cross-platform rule).
- **Design responsively/adaptively from mobile up; respect `prefers-reduced-motion`.**

### 8. Testing (frontend)

- **Test behavior the user observes, never implementation details** — "the more your tests resemble the way your software is used, the more confidence they give you."
- **Query by role/label/text (in that priority); `data-testid` is a last resort** (repo bans it in Playwright). **Drive interactions with `userEvent`, not `fireEvent`.**
- **Write fewer, longer, higher-level tests that exercise real user flows;** reserve E2E (Playwright) for critical journeys, kept thin.
- **Judge a frontend test by whether it can fail for a real reason** — over-mocked / asserting-on-mocks / snapshot-everything tests are coverage theater.

### 9. Security (frontend)

- **Never store auth tokens in `localStorage`/`sessionStorage`** (any XSS reads them) — access token in memory, refresh token in an `HttpOnly; Secure; SameSite` cookie.
- **Avoid `dangerouslySetInnerHTML`; if unavoidable, sanitize with DOMPurify.** Enforce a strict CSP + the security-header set.
- **Keep secrets out of the client bundle** — treat `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*` as world-readable; never build `href`/`src` from unsanitized input.

### Sources

[React docs — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) · Kent C. Dodds — [Testing Implementation Details](https://kentcdodds.com/blog/testing-implementation-details) & [Write fewer, longer tests](https://kentcdodds.com/blog/write-fewer-longer-tests) · [Testing Library — query priority](https://testing-library.com/docs/queries/about/#priority) · TkDodo — [React Query as a State Manager](https://tkdodo.eu/blog/react-query-as-a-state-manager) · [TanStack Query — Optimistic Updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) · Josh W. Comeau — [useMemo/useCallback](https://www.joshwcomeau.com/react/usememo-and-usecallback/) · [web.dev — Web Vitals](https://web.dev/articles/vitals) · [W3C WAI — What's New in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/) · [MDN — ARIA](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA) · [Deque — Rules of ARIA](https://www.deque.com/blog/top-5-rules-of-aria/) · ["Parse, Don't Validate"](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/) · [OWASP — token storage / DOM XSS prevention](https://cheatsheetseries.owasp.org/cheatsheets/DOM_based_XSS_Prevention_Cheat_Sheet.html).

---

## Design Patterns, Principles & Code Quality

> Principles are heuristics, not laws — each has a failure mode when over-applied, noted inline. When two rules conflict, favor the one that reduces the _reader's_ cognitive load. The goal is not clever code; it is code the next engineer can change without fear.

### 1. Foundational principles

- **SRP — Single Responsibility.** A module has one reason to change; group what changes together, separate what changes for different reasons. _Over-applies_ when read as "one method per class" — a swarm of one-line classes with logic smeared across files. Prefer "things that change together stay together."
- **OCP — Open/Closed.** Extensible at known variation points without editing the core, so adding a case doesn't risk the tested cases. _Over-applies_ as speculative plugin frameworks — add the seam when the second case is real, not before.
- **LSP — Liskov Substitution.** A subtype is usable anywhere its supertype is, honoring the contract (no strengthened preconditions, weakened postconditions, or new exceptions). The `Square extends Rectangle` trap is the canonical breach — prefer composition when "is-a" doesn't preserve behavior.
- **ISP — Interface Segregation.** No client depends on methods it doesn't use; split fat interfaces into role-specific ones to reduce the ripple radius of change.
- **DIP — Dependency Inversion.** High-level policy doesn't depend on low-level detail; both depend on an abstraction owned by the high-level side. _Over-applies_ as an interface with exactly one forever-implementation — that's indirection tax. Introduce it for a real second implementation or a genuine test seam.
- **DRY — Don't Repeat Yourself.** Every piece of _knowledge_ has one authoritative representation. DRY governs knowledge, not keystrokes — two fragments that look alike but change for different reasons are _not_ duplication.
- **DAMP over DRY where it aids reading — especially tests.** "Duplication is far cheaper than the wrong abstraction" (Metz). Inline the duplication until the third occurrence and the shared reason-to-change is proven, _then_ extract.
- **YAGNI / KISS.** Build for today's known requirements with the simplest design that fully solves the problem — speculative generality and cleverness are loans against future comprehension.
- **Separation of Concerns & Composition over Inheritance.** One concern per module; assemble behavior from small collaborators (has-a) rather than deep hierarchies (is-a) — inheritance specializes along one axis, so multi-axis variation explodes into a subclass tree. Reserve inheritance for genuine substitutable subtypes.
- **Law of Demeter (Least Knowledge).** Talk only to yourself, your parameters, objects you create, and your direct fields — `a.getB().getC().doThing()` hard-codes three classes' internals into one call site. Tell, don't ask. (Fluent builders/streams are a deliberate exception.)
- **Fail Fast & Least Astonishment.** Detect invalid state at the earliest boundary and stop loudly with a precise error; make behavior match what a competent reader predicts from the name and signature — consistency _is_ a feature.

### 2. Deep design (Ousterhout, _A Philosophy of Software Design_)

- **Complexity is the enemy; it accumulates from dependencies and obscurity.** Recognize it by three symptoms: _change amplification_ (one change edits many places), _cognitive load_, and _unknown-unknowns_ (you can't tell what you'd need to know) — the last is the worst, and obscurity breeds it.
- **Build deep modules: simple interface, powerful implementation.** Net benefit = functionality hidden − interface complexity exposed. **Delete shallow modules** (thin pass-throughs, getter/setter-only classes) — they add interface cost without hiding anything.
- **Make information hiding the default; hunt information leakage** — a duplicated design decision (file format, encoding) across modules is shotgun surgery waiting to happen.
- **Define errors out of existence.** Design APIs so the exceptional case can't occur (unset of an absent key is a no-op; a substring clamps) rather than proliferating handlers — the best error handling is none needed.
- **Program strategically, not tactically.** Invest ~10–20% ongoing in design; the tactical patch ships fast and leaves a wake others maintain.
- **Comments capture what code cannot** (the _why_, invariants, units, cross-module contracts); write the interface comment _first_ — if it's hard to describe briefly, the design is wrong. **Different layer, different abstraction** — collapse pass-through methods. **Pull complexity downward** (one implementer suffers so every caller benefits). **Design it twice** before committing.

### 3. Coupling & cohesion

- **Maximize cohesion** (if you describe a module with "and," split it) and **minimize coupling — drive toward the bottom of the ladder:** content (reaching into internals) → common/global (shared mutable state) → external → control (a flag that steers the callee) → stamp (whole record for one field) → **data** (exactly the primitives needed).
- **Prefer connascence that is weak, local, and low-degree** (strength × distance = cost of change) — a positional dependency across module boundaries is a landmine; the same inside one function is fine.
- **Depend in the direction of stability** (volatile modules depend on stable abstractions, never the reverse), **invert dependencies at architectural seams** (domain defines the port, infra implements it), and **draw boundaries where change rates differ**.

### 4. Design patterns that matter (apply to a named problem — never cargo-cult)

- **Reach for a pattern only when you feel the specific pain it names** — applied speculatively it's just indirection.
- **Factory** (non-trivial/branching construction) · **Builder** (many optional params, "valid only when built") · **Adapter** (fit a third-party interface you don't own) · **Facade** (one entry point over a complex subsystem — don't let it grow logic) · **Decorator** (stackable orthogonal behaviors: logging/caching/retry) · **Composite** (part-whole trees) · **Strategy** (swap an algorithm behind an interface — the go-to alternative to a sprawling flag/switch) · **Observer** (event fan-out — beware update storms/ordering) · **Template Method** (stable skeleton, varying steps — prefer Strategy if you don't need inheritance) · **State** (behavior changes with a lifecycle and conditionals are multiplying) · **Repository** (domain-defined persistence port — don't let it leak ORM types) · **DTO** (flat, behavior-free boundary struct — never leak into the domain) · **Dependency Injection** (the mechanism; DIP is the goal) · **Hexagonal / Ports & Adapters** (domain owns ports, adapters implement, dependencies point inward).

### 5. Anti-patterns & code smells (name it, then refactor it)

- **God Object** (knows/does everything — split by responsibility) · **Anemic Domain Model** (getters/setters + logic in services = procedural code in OO clothing; put invariants on the objects that own the data) · **Primitive Obsession** (money/dates/IDs/emails as bare string/number — introduce value types) · **Feature Envy** (a method uses another object's data more than its own — move it) · **Shotgun Surgery** (one change forces edits across many classes — consolidate the leaked decision) · **Long Parameter List** (>~3, especially same-typed — parameter object/builder) · **Boolean/Flag Argument** (`book(martin, false)` — split into `regularBook`/`premiumBook`; n booleans = 2ⁿ hidden paths) · **Deep Nesting / Arrow Code** (flatten with guard clauses) · **Magic Numbers/Strings** (name them) · **Dead Code** (delete it — VCS remembers) · **Premature Abstraction / Speculative Generality** and **Premature Optimization** (measure first — Knuth) · **Data Clumps** (fields traveling together are a missing object).

### 6. Readability & maintainability

- **Name to reveal intent** (`elapsedDays` beats `d`) — naming is the highest-leverage readability lever. **Keep functions small and at one level of abstraction** — a function orchestrates _or_ does detail, never both. **Prefer guard clauses to nesting** — keep the happy path flat and last.
- **Enforce symmetry and consistency** (do the same kind of thing the same way every time) and **cap complexity** (cyclomatic ≤ ~10 per function). **Write self-documenting code; comment the _why_, not the _what_** — a comment that restates code is deleted or replaced by a rename. **Treat error handling as a first-class path**, designed deliberately (define errors out of existence, or fail fast with a precise, actionable message and preserved cause).

### 7. Style rigor (non-negotiables — fragile code violates these)

- **Always brace control-flow blocks** — never brace-less `if`/`for`/`while`, even one-liners (the "goto fail" class of bug). **No implicit fallthrough** — every `case` terminates or is annotated; always handle the default/exhaustive case (`never` default).
- **Immutable by default** (`const`/`readonly`, construct-don't-mutate) removes whole categories of aliasing/race bugs. **Prefer pure functions** — isolate I/O/mutation at the edges; mark impure with `@sideEffect`. **Ban `any` and escape hatches** — one `any` silently disables checking across everything it touches.
- **Choose explicit over clever** (code is read far more than written). **Format mechanically** (defer to Prettier/linter — zero-diff formatting keeps reviews about substance). **Validate at the boundary; trust within** ("parse, don't validate").

### 8. What "production-grade" actually means

Shipping the happy path is "it works." Engineering is meeting _all_ of these: **Correct** (provably right for edge cases and boundaries, not "it ran once") · **Robust** (degrades sanely under bad input, partial failure, timeouts, concurrency — no silent corruption) · **Secure** (validated input, least privilege, safe defaults — a design property, not a later scan) · **Observable** (structured logs/metrics/traces + actionable errors) · **Performant-enough** (meets its real budget, verified by measurement) · **Tested** (meaningful behavior + failure-mode tests that read as documentation and don't couple to internals) · **Readable & changeable** (the next engineer modifies it without archaeology). Changeability is the whole game; every principle above serves it.

### Sources

Ousterhout, _A Philosophy of Software Design_ ([complexity & deep modules](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=complexity), [strategic vs tactical](https://benmccormick.org/2019/02/18/strategic-coding/)) · Fowler — [Flag Argument](https://martinfowler.com/bliki/FlagArgument.html), [smells catalog](https://luzkan.github.io/smells/) · SOLID defense/critique — [NDepend](https://blog.ndepend.com/defense-solid-principles/), [Uncle Bob "Solid Relevance"](https://blog.cleancoder.com/uncle-bob/2020/10/18/Solid-Relevance.html) · Sandi Metz — [wrong-abstraction](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) · Connascence — [Wikipedia](https://en.wikipedia.org/wiki/Connascence), [Stemmler](https://khalilstemmler.com/wiki/coupling-cohesion-connascence/) · [Composition over Inheritance (GoF)](https://python-patterns.guide/gang-of-four/composition-over-inheritance/) · [Cockburn — Hexagonal](https://alistair.cockburn.us/hexagonal-architecture) · GoF, _Design Patterns_; Beck, _Implementation Patterns_.

---

_This document is maintained as the repository's engineering quality bar. When you learn something that should be here — a failure mode a rule would have prevented, a stronger technique — add it. It gets better only if the people held to it improve it._
