/**
 * `@kitchensink/service-logging` — WHERE A LOG LINE GOES, for every service in this repository.
 *
 * ⛔ WHAT THIS PACKAGE OWNS, AND THE LINE THAT KEEPS IT HONEST. It owns exactly one piece of knowledge:
 * given a level and whether a Sentry client exists, where does the line go and what is scrubbed on the way.
 * That rule changes when ADR-0042's drain policy changes — once, for every runtime. It does NOT own traces,
 * metrics, context helpers or `Sentry.init`; an earlier proposal for a `packages/shared/observability`
 * holding all five was refused for having five reasons to change, and the moment someone proposes adding a
 * metric helper here, that refusal is the precedent.
 *
 * ⚠️ THE CALL-SITE SHAPES ARE DELIBERATELY NOT SHARED. identity's `createServiceLogger`, Nest's
 * `LoggerService`, food's `WorkerLogger` port and recipe-workers' Powertools surface are four interfaces
 * that change for four different reasons; merging them would be the wrong abstraction. They are adapters
 * over `emitLogRecord`, which is the one seam.
 *
 * ⚠️ `./logAttributes` is a SEPARATE, PURE ENTRY — no Sentry, no Nest — so an esbuild-bundled Lambda can
 * take the Error-rendering rule without taking the SDK. Same shape, and the same reason, as
 * `@kitchensink/observability-scrubbers/denylist`.
 *
 * ⚠️ THIS SURFACE IS WHAT CONSUMERS ACTUALLY IMPORT, and nothing else. It opened with eleven names — the
 * routing table, the level union, `toAttributes`, `LogDestination`, `ServiceLogger`, `LogExtra` — of which
 * SEVEN had zero consumers anywhere outside this package. CLAUDE.md §4 is explicit that a package export is
 * a contract, and a contract with nobody is a surface that can only drift: it invites a caller to reach past
 * the seam (`routeLogRecord` in particular is the rule this package exists to keep in one place, and an
 * exported copy of the decision is an invitation to re-implement the branch at a call site). They remain
 * exported from their own modules for this package's own tests, which import by path.
 *
 * `renderLogAttributes` and `renderThrowable` are reachable through `./logAttributes` — the entry that
 * exists for them — so the root does not restate them either.
 */
export { emitLogRecord } from './logSink.js';
export { NestRoutedLogger } from './NestRoutedLogger.js';
export { createServiceLogger } from './serviceLogger.js';
