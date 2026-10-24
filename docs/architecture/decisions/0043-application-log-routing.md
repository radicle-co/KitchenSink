# 0043 — One rule for where a log line goes, and a line never goes nowhere

- **Status:** Accepted
- **Date:** 2026-09-16
- **Relates to:** [ADR-0042](0042-log-drain-coverage.md) — this is the rule that ADR's drain makes necessary.
  [ADR-0027](0027-ingredient-phrase-is-not-personal-data.md) — what may leave a host, which the console path
  had no scrub for.

## Context

ADR-0042 gave every runtime's CloudWatch group a subscription filter into one Sentry project,
`kitchensink-log-drain`. That makes stdout a Sentry destination. A line written to stdout **and** sent through
the SDK is therefore one failure recorded twice, in two different projects, which Sentry's alerting counts
separately. So "does this level go to stdout, to Sentry, or to both" acquired exactly one correct answer per
level — and the repository held two answers, which disagreed.

`recipe-workers/src/common/observability.ts` stated one: _"when Sentry is initialised, `logger.error` goes to
Sentry's logger INSTEAD of stdout. `info` and `warn` stay on stdout, because CloudWatch is the durable record
and neither creates an issue."_ It was written with ADR-0042 in hand. It also had **no caller** — the module
specified the behaviour and the code did not do it, which is the one failure a docstring cannot reveal,
because it reads exactly like a description of working code.

`identity/src/observability/sentryLogging.ts` stated the other: _"nothing is written to stdout."_ Measured
against `@sentry/core`, `Sentry.logger.*` with no client returns before emitting — no stdout, no stderr, no
throw. So that rule did not move lines, it **deleted** them: on every local run, in the whole integration
tier, and on any stage whose SSM parameter is unwritten, the identity service booted in total silence. No
bootstrap line, no route line, no `AuthMiddleware` warning, no `UsersService` error. An operator running
`aws logs tail` on its group saw an empty stream, which is indistinguishable from a task that never started —
and ADR-0042 had just registered a filter on that group, so the coverage that ADR asserts was vacuous for the
one service that serves real users.

Two further facts bounded the design. The org is shedding telemetry to rate limits — 1,680 errors rejected
against 7,302 accepted over thirty days — so any rule that adds log volume for no alerting gain is paid for
in dropped events. And `RecipeServiceStack.ts` set `command: ['node', 'dist/src/main.js']`, which overrides
the image `CMD` and so discarded its `--import ./dist/src/instrument.js`: `Sentry.init` had never run in the
deployed recipe API at all, making U17's `Sentry.captureException` in that service's `ApiExceptionFilter` a
no-op in production and in every sandbox.

## Decision

**The rule is a value, in one place.** `@kitchensink/service-logging` owns a typed decision table:
`error` diverts to `Sentry.logger` when a client exists, and everything else — every other level, and every
level with no client — writes one JSON line to the console, which ADR-0042's drain already carries. The table
is a `Record` over the level union, so adding a level without deciding its destination is a compile error
rather than a silent default. `recipe-workers`' rule is adopted verbatim; identity's is treated as the defect
it was.

**What is shared is the sink, not the interface.** The routing rule has one reason to change, so it has one
home. The four call-site shapes have four reasons to change, so they stay where they are and become adapters
over one seam: identity keeps `createServiceLogger`'s signature, Nest gets `NestRoutedLogger`, food keeps its
`WorkerLogger` port and gains a third adapter behind it, and `recipe-workers` keeps its Powertools surface.
Food's port docstring — _"Kept as a tiny interface (not a Powertools/Sentry dependency) so the consumer is
trivially testable"_ — is about the **interface**, and it still holds literally: the port imports nothing and
`SilentWorkerLogger` is still the test default. Changing which adapter the bootstrap wires is the port
working, not the port being overruled.

**A service is routed by its bootstrap, not by its call sites.** `NestFactory.create(module, { logger })`
calls `Logger.overrideLogger`, and Nest's `Logger` resolves that static at **call** time — so every existing
`new Logger(X.name)` routes through the adapter without being edited, including instances constructed at
module load before the app exists. Measured, with the attributes object arriving intact: Nest appends the
context last and passes everything between the message and it through untouched. The adapter therefore parses
that variadic shape rather than accepting `(message, context?)`, which would have filed every attributes
object as a context string.

**Every `Error` is rendered at the seam.** Measured against the SDK: an `Error` left in a log attribute
arrives in the envelope as the literal two characters `{}`, because the SDK stringifies non-primitive values
and `message`/`stack` are non-enumerable. The console path loses it identically. `scrubUnknown` passes an
`Error` through whole precisely so a downstream renderer can have it, and a sink has no Powertools — so the
sink renders, on both paths, at any depth, with cycles marked and depth bounded so that the logger can never
be what takes out its caller. `renderThrowable` moved here from `@kitchensink/nest-error-envelope`, which is
named for the wire-error envelope and not for how a line is rendered.

**Every string on the console path is scrubbed with `scrubText`, not `scrubAttributes`, and a rendered error
is scrubbed after it is rendered.** `scrubAttributes` judges a string as a whole against an unanchored bearer
pattern, so one token-shaped substring inside a multi-kilobyte render would replace the entire error text; it
also never applies the email or Clerk-`sub` patterns to a nested string. `scrubText` replaces the secret in
place and leaves the error intact.

Pseudonymizing is **idempotent**, and that is what makes scrubbing every string safe. A Clerk `sub` can be
replaced by two different rules — `scrubText` inline wherever it appears in free text, `scrubAttributes` by
key — and a value that meets both was hashed twice, giving a different token. `deletionEnqueue.error.ts`
emits an issue and a log for the same ids in one function, so its `identityId` arrived as one token on the
issue and another in the log: nothing leaked, nothing failed, and the two records silently stopped naming the
same person. `pseudonymizeId` now returns a value that is already in its own output shape unchanged, which no
real identifier can be — the shape is `anon_` plus lowercase hex, a Clerk `sub` is `user_`-prefixed, and a
ULID is uppercase Crockford base32.

The scrubbing patterns are **anchored at their left edge, and the scan restarts after each match**. Every
one of them retried each position inside a long run of matching characters as a fresh start, scanning forward
for a separator that was not there: measured on `'a'.repeat(n) + '@'`, 1,636 ms and 606 ms at 50 KB, and
27,129 ms and 9,919 ms at 200 KB — synchronously, on whichever thread called `beforeSend`. A leading
lookbehind removes the restarts.

The lookbehind alone is **not** equivalent, and shipping it alone leaked. Its argument holds within one
scan — leftmost-match already begins at a run boundary — but not across matches: `replace` resumes
immediately after the previous match, and an email's last character is in the local-part class, so the
lookbehind rejected the very next address. `user@example.com-other@example.org` redacted the first and left
the second in plaintext, and a differential fuzz found 181,274 such divergences in 400,000 address-shaped
inputs. Replacing match-by-match, slicing the string after each one, puts every scan at a fresh boundary:
zero divergences on the same fuzz, at 3.7 ms.

`looksLikeBearerToken` needs no lookbehind at all, because it returns a boolean: splitting on `.` and testing
adjacent segment triples with `^`/`$` anchors is engine-neutral, which matters because that module is
imported by the mobile app. It is equivalent over 500,000 token-shaped inputs at a 20.5% positive rate, and
costs 0.13 ms where the pattern cost 26,713 ms.

Equivalence claims here are discharged by a **differential test that asserts its own positive rate**, never
by examples. The leak above was shipped under eighteen hand-picked parity cases, all of which happened to
hold a single address — a case set structurally incapable of reaching the defect. A parity test over inputs
that never match agrees vacuously and is indistinguishable from a passing one.

Free text is **bounded before it is scrubbed**, at 4 KiB. `scrubText`'s email pattern backtracks
quadratically: `'a'.repeat(n) + '@'` costs 21 ms at 5 KB, 363 ms at 20 KB and 2.24 seconds at 50 KB,
synchronously, on the request or worker thread. That cost applied to error messages before; scrubbing every
string widened it to attribute values, which can carry user-influenced text. The cap is sized against the
largest realistic value rather than guessed — a drizzle-shaped `pg` error wrapped five deep renders to 1,184
characters — and a truncated value says so.

This applies to **every** string the sink handles, not only to text it rendered itself. A caller can hand over
free text that is already a rendered throwable — both `ApiExceptionFilter`s did exactly that — and a rule
applied only to the sink's own output would miss precisely the largest and most sensitive strings it sees. The
line's `message` is scrubbed for the same reason: `renderLogAttributes` structurally cannot reach it, the
Sentry path already scrubs it through `scrubLog`, and leaving it out would make the sink's claim to own
console scrubbing false for the one field every line carries.

**A caller hands the throwable over whole; rendering is the sink's job.** Both exception filters now pass
`{ error: exception }` rather than a pre-rendered string. Rendering at the call site duplicates a rule the
sink owns and separates the render from the scrub that must follow it.

**Scrubbing happens once per path, in different places.** The Sentry path is scrubbed by `beforeSendLog` in
each service's `instrument.ts`; the console path is scrubbed in the sink, because nothing downstream does —
the drain's own sanitiser covers five key names and URL path segments. Scrubbing both in the sink would be
worse than scrubbing neither twice: `scrubAttributes` pseudonymizes person-linked ids, and pseudonymizing an
already-pseudonymized id yields a different token, destroying the cross-service correlation that is the whole
reason ids are pseudonymized rather than redacted.

**The exception is named, not implicit.** `identity/src/observability/authTrace.ts` keeps its own
`Sentry.logger.info` sink: it is a `DEBUG_AUTH`-gated diagnostic whose value is that an operator can filter
one signup's whole flow by `sub` in Sentry, and the shared rule would put it in the drain project mixed with
every other line. The guard exempts that file by name, with the reason.

**Five caught errors became issues, chosen by a stated test rather than mechanically.** A `catch` earns an
issue — grouped, with a stack, alertable — rather than only a log when the failure leaves a durable
consequence and acting on it needs the error's identity: a stranded spend reservation against ADR-0024's
ceiling, a lost verdict that means the gate silently stopped gating, an orphaned S3 object that outlives a
user's delete. Failures with a defined recovery and no residue are deliberately left as logs, which is why
food's lease-release and identity's erasure enqueue are not on the list. `errorReportingRegister.test.ts`
classifies every catch in the deployable services and refuses the last state — a catch that neither rethrows,
reports, logs, converts the error into a returned value, classifies it, nor appears in a register with a
reason. Two of those dispositions exist because the obvious rule was wrong in both directions: a catch that
rethrows on one branch and returns on another is only a rethrow if the returning branch was reached by
testing the error (`classifies`), and referencing the error in a guard before returning a fallback is not
propagation — the error has to be in the returned value. That guard
could not have been written before this decision: until `error` reached a service's own project, "logs the
error" was a guess about whether anybody would see it.

## Consequences

An `error` from any of the four services now becomes an entry in that service's **own** project, grouped, with
attributes, instead of a line in the shared drain project. `info` and `warn` reach CloudWatch as before, so
`aws logs tail` works on every stage and the drain keeps forwarding them. With no client every level falls
back to the console, so a preview with an unwritten DSN parameter degrades to today's behaviour rather than
to silence.

Nothing reads log **content** out of CloudWatch — not CI, not the scripts, not the runbooks, which use only
group-level commands — so diverting errors off stdout breaks no consumer. If that ever changes, or if an
alert is configured on `warn`-level logs in a per-service project, the table is the single line to edit.

Seven guards hold it. Six are new (`serviceLoggingInvariants.test.ts`): the bootstrap passes the adapter; no
adopted service reaches past the sink to `Sentry.logger`; nothing hands the sink text it has already
rendered; a service that calls `NestFactory.create` has adopted the package, because adoption is otherwise
opt-in and a new service could route nowhere while every other guard stayed green; every `instrument.ts`
wires both scrubbers and `enableLogs`; and every workspace declares one `@sentry/nestjs` range — that last because Sentry's carrier is
keyed by SDK version, so two copies in one process make `getClient()` answer `undefined` while a perfectly
good client exists, which under this rule is indistinguishable from "no DSN" and would fall back to the
console forever. The fifth is W6 in `serviceInfraWiringInvariants.test.ts`, covering the `--import` defect for
services that do not exist yet. All five read the AST, because this ADR's own prose names every string a text
gate would search for.

Adoption is discovered from each service's manifest, and the sink's users are discovered from their imports —
`recipe-workers` declares the package for the pure `logAttributes` subpath only, since `logSink.ts` imports
`@sentry/nestjs` and ten esbuild-bundled Lambdas on `@sentry/aws-serverless` must not carry it.

**Residual risk.** That an error line reaches the right project cannot be asserted from CI without a Sentry
read API and a live DSN, so the end-to-end confirmation — a forced error in each runtime appearing in its own
project — remains manual, and is owed. `renderThrowable` inspects a cause chain six levels deep, so a diverted
database error is a larger payload than the `error.message` most call sites hand it today; roughly 38 call
sites across `recipe-workers` and food still pre-flatten with `error instanceof Error ? error.message : …`,
which is now the lossy form and is owed a sweep. That sweep is quality, not safety — a pre-flattened string is
scrubbed like any other — but it throws away the cause chain the renderer exists to keep. And `authTrace.ts` carries its own denylist, matching key
substrings rather than exact names, which is a sixth copy of "what may not leave a host" and owes a merge —
deferred because the two behaviours genuinely differ.
