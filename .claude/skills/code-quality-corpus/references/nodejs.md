# Node.js — code smells, anti-patterns, red flags (reference corpus for `staff-code-quality`)

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID      | Smell                                                                                      | Section                                  | Detected by | Default severity | Architecture |
| ------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------- | ---------------- | ------------ |
| NODE-01 | Floating promise / fire-and-forget without an error sink                                   | Async & promise pitfalls                 | partial     | major            | yes          |
| NODE-02 | `process.on('unhandledRejection' / 'uncaughtException', log)` that keeps the process alive | Async & promise pitfalls                 | judgement   | major            | yes          |
| NODE-03 | `async` callbacks where the caller ignores the promise (`forEach`, emitters, timers, `Arr… | Async & promise pitfalls                 | partial     | major            | no           |
| NODE-04 | Accidental sequential awaits (latency) — and accidental parallelism (correctness)          | Async & promise pitfalls                 | tool        | minor            | no           |
| NODE-05 | Unbounded fan-out (`Promise.all(items.map(...))` over input-sized collections)             | Async & promise pitfalls                 | judgement   | major            | yes          |
| NODE-06 | Outbound I/O without a deadline / cancellation (`fetch`, SDK calls, DB queries)            | Async & promise pitfalls                 | judgement   | major            | yes          |
| NODE-07 | Retries without backoff, jitter, cap, or idempotency                                       | Async & promise pitfalls                 | judgement   | major            | yes          |
| NODE-08 | Mixing callbacks and promises / resolving twice                                            | Async & promise pitfalls                 | partial     | minor            | no           |
| NODE-09 | Synchronous I/O and CPU-heavy core APIs on the request path                                | Event-loop blocking                      | partial     | major            | yes          |
| NODE-10 | Large `JSON.parse`/`JSON.stringify`, unbounded bodies, deep traversal                      | Event-loop blocking                      | partial     | major            | yes          |
| NODE-11 | ReDoS-prone and dynamically-built regular expressions                                      | Event-loop blocking                      | tool        | major            | no           |
| NODE-12 | Worker-pool starvation by variable-cost tasks                                              | Event-loop blocking                      | judgement   | minor            | no           |
| NODE-13 | Swallowed errors / empty or log-only catch that continues                                  | Error handling                           | partial     | major            | no           |
| NODE-14 | Lost error context: no `cause`, stringified errors, non-Error rejects                      | Error handling                           | tool        | major            | no           |
| NODE-15 | Log-and-rethrow at every layer (duplicate error logs)                                      | Error handling                           | judgement   | minor            | no           |
| NODE-16 | Missing `'error'` listeners on emitters and sockets; `pipe()` without error handling       | Error handling                           | tool        | major            | no           |
| NODE-17 | Ignoring backpressure                                                                      | Error handling                           | judgement   | major            | no           |
| NODE-18 | Listener, timer and interval leaks                                                         | Resource leaks & memory                  | judgement   | major            | no           |
| NODE-19 | Unbounded in-memory caches / module-level Maps                                             | Resource leaks & memory                  | tool        | major            | yes          |
| NODE-20 | Unclosed pools/handles; per-request client construction                                    | Resource leaks & memory                  | judgement   | major            | yes          |
| NODE-21 | `AsyncLocalStorage.enterWith` and context loss                                             | Resource leaks & memory                  | judgement   | major            | yes          |
| NODE-22 | `process.env` read deep in code; no startup validation                                     | Config, env, module-level side effects   | partial     | major            | yes          |
| NODE-23 | Secrets and PII in logs / error responses                                                  | Config, env, module-level side effects   | partial     | blocker          | yes          |
| NODE-24 | Module-level side effects and hidden singletons                                            | Config, env, module-level side effects   | tool        | major            | yes          |
| NODE-25 | No or broken graceful shutdown (SIGTERM)                                                   | Process lifecycle                        | tool        | major            | yes          |
| NODE-26 | HTTP server timeouts misaligned with the load balancer                                     | Process lifecycle                        | judgement   | major            | yes          |
| NODE-27 | Memory limits not aligned with container limits                                            | Process lifecycle                        | judgement   | minor            | no           |
| NODE-28 | `child_process.exec` / `shell: true` with interpolated strings                             | Injection-shaped Node APIs (quality fla… | tool        | blocker          | no           |
| NODE-29 | Path traversal via `path.join`/`resolve` on user input; archive extraction                 | Injection-shaped Node APIs (quality fla… | tool        | blocker          | no           |
| NODE-30 | Prototype pollution via dynamic keys / deep merge                                          | Injection-shaped Node APIs (quality fla… | tool        | blocker          | no           |
| NODE-31 | Type confusion on query parameters (`req.query.x` assumed string)                          | Injection-shaped Node APIs (quality fla… | tool        | major            | no           |
| NODE-32 | SSRF — outbound URL built from input                                                       | Injection-shaped Node APIs (quality fla… | tool        | blocker          | yes          |
| NODE-33 | Dependency hygiene: unpinned, extraneous, or deprecated APIs/deps                          | Injection-shaped Node APIs (quality fla… | tool        | major            | no           |

<!-- END GENERATED INDEX -->

## Scope & sources consulted

| Source                                                                                                                 | Version / date read                                                                                                    | URL                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Node.js guide "Don't Block the Event Loop (or the Worker Pool)"                                                        | nodejs.org/learn (read 2026-09-13)                                                                                     | https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop                                |
| Node.js API docs (`cli`, `process`, `events`, `stream`, `async_context`, `child_process`, `http`, `globals`, `timers`) | `nodejs/node` `main` branch markdown (Node v26.x docs; web page reports v26.8.2), plus `v24.x` branch for LTS defaults | https://nodejs.org/api/ ; https://github.com/nodejs/node/tree/main/doc/api                             |
| undici `Client` options (Node's `fetch` implementation)                                                                | `nodejs/undici` main                                                                                                   | https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md                                     |
| goldbergyoni/nodebestpractices README                                                                                  | last commit 2026-06-15                                                                                                 | https://github.com/goldbergyoni/nodebestpractices                                                      |
| CodeQL query help — JavaScript/TypeScript (per-query pages: ID, kind, severity, precision, tags, suites)               | read 2026-09-13                                                                                                        | https://codeql.github.com/codeql-query-help/javascript/                                                |
| eslint-plugin-n README                                                                                                 | 18.3.0 (npm)                                                                                                           | https://www.npmjs.com/package/eslint-plugin-n                                                          |
| eslint-plugin-promise README                                                                                           | 7.3.0 (npm)                                                                                                            | https://www.npmjs.com/package/eslint-plugin-promise                                                    |
| eslint-plugin-security README + `docs/rules`                                                                           | 4.0.1 (npm)                                                                                                            | https://www.npmjs.com/package/eslint-plugin-security                                                   |
| Semgrep registry rule YAML (ids + CWE metadata)                                                                        | `semgrep/semgrep-rules` `develop` (2026-09-13)                                                                         | https://github.com/semgrep/semgrep-rules                                                               |
| p-limit README                                                                                                         | 7.3.2                                                                                                                  | https://github.com/sindresorhus/p-limit                                                                |
| lru-cache README                                                                                                       | 11.5.2                                                                                                                 | https://github.com/isaacs/node-lru-cache                                                               |
| AWS ALB attributes (idle timeout)                                                                                      | AWS docs (read 2026-09-13)                                                                                             | https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html |
| typescript-eslint rules (cross-ref, see typescript.md)                                                                 | 8.70.0                                                                                                                 | https://typescript-eslint.io/rules/                                                                    |

### CodeQL suite membership matters (non-obvious)

The default GitHub code-scanning suite (`javascript-code-scanning.qls`) does **not** include every Node-relevant query. From each query page:

- `js/unhandled-error-in-stream-pipeline` — tags `quality, reliability, error-handling`; suite **only** `javascript-code-quality.qls`.
- `js/missing-await`, `js/use-of-returnless-function`, `js/unused-local-variable`, `js/unneeded-defensive-code` — `javascript-code-quality.qls` / `security-and-quality` only.
- `js/log-injection` (precision medium), `js/remote-property-injection` (medium), `js/user-controlled-bypass` (medium), `js/file-system-race` (medium), `js/insecure-temporary-file`, `js/hardcoded-data-interpreted-as-code` — `security-extended` / `security-and-quality` only.

A repo running only default CodeQL gets **none** of the quality queries. An agent should not read "CodeQL is green" as coverage of these entries.

---

## Async & promise pitfalls

### NODE-01 Floating promise / fire-and-forget without an error sink

- **Signal:** Promise-returning call as an expression statement; `void somethingAsync()` with no `.catch`; `setImmediate(() => doAsync())`; background work kicked off in a request handler after the response is sent.
- **Tool coverage:** `typescript-eslint:no-floating-promises` (recommended-type-checked; `ignoreVoid: true` by default — so `void p` passes); `promise:catch-or-return` (eslint-plugin-promise 7.3.0 recommended); `codeql:js/missing-await` (quality suite only). partial: `void p` with no rejection handler, and whether the work must outlive the request, are judgement.
- **Why it hurts:** Node CLI docs: `--unhandled-rejections` default mode is `throw` (since v15.0.0): "Emit `unhandledRejection`. If this hook is not set, raise the unhandled rejection as an uncaught exception." One rejected background promise terminates the process and every in-flight request. Reliability/operability.
- **Severity:** major; blocker when inside a request path or transaction.
- **Remediation:** `await`; or an explicit fire-and-forget helper that attaches `.catch(logAndCount)`; for work that must survive, a durable queue (Outbox / job queue) rather than an in-process promise. — Trap: see NODE-02 — a global `unhandledRejection` listener is not a fix.
- **Not a finding when:** `void p.catch(handler)` documented as intentionally detached; test code awaited by the runner.
- **Architecture:** yes when detached work implies missing durable async processing — escalate (queue/outbox boundary).
- **Sources:** https://nodejs.org/api/cli.html#--unhandled-rejectionsmode ; https://typescript-eslint.io/rules/no-floating-promises/ ; https://codeql.github.com/codeql-query-help/javascript/js-missing-await/

### NODE-02 `process.on('unhandledRejection' | 'uncaughtException', log)` that keeps the process alive

- **Signal:** a global handler that logs and returns (no `process.exit`/graceful shutdown), especially copied from older advice; `process.on('uncaughtException', …)` used as `try/catch` for the app; `--unhandled-rejections=warn|none` in start scripts.
- **Tool coverage:** none — judgement. (`n:no-process-exit` in eslint-plugin-n recommended pushes authors _away_ from the correct exit, so expect a disable.)
- **Why it hurts:** In the default `throw` mode, merely _registering_ an `unhandledRejection` listener suppresses the crash (the throw only happens "If this hook is not set"). Node `process` docs: "`'uncaughtException'` is a crude mechanism… Unhandled exceptions inherently mean that an application is in an undefined state… **It is not safe to resume normal operation after `'uncaughtException'`.**" nodebestpractices 2.6: exit gracefully "when a stranger comes to town" — a zombie process with a dead DB emitter keeps passing health checks. Note nodebestpractices 2.10's TL;DR ("Any exception thrown within a promise will get swallowed") predates the v15 default change and is the likely origin of these log-only handlers.
- **Severity:** major (blocker when the handler swallows and continues in a server).
- **Remediation:** Handler logs synchronously, flushes telemetry, triggers graceful shutdown with a hard timeout, exits non-zero; let the orchestrator restart. Distinguish operational vs programmer errors (nodebestpractices 2.3). — Trap: async work inside `'exit'` listeners — "Listener functions **must** only perform **synchronous** operations."
- **Not a finding when:** CLI tools that print and `process.exitCode = 1`.
- **Architecture:** yes — process lifecycle/restart policy is an operability contract (SRE/architect).
- **Sources:** https://nodejs.org/api/process.html ; https://nodejs.org/api/cli.html#--unhandled-rejectionsmode ; https://github.com/goldbergyoni/nodebestpractices

### NODE-03 `async` callbacks where the caller ignores the promise (`forEach`, emitters, timers, `Array.prototype.*`)

- **Signal:** `arr.forEach(async …)`, `emitter.on('evt', async …)`, `stream.on('data', async …)`, `setInterval(async …)`, `arr.reduce(async (acc, x) => …)` without awaiting `acc`, `arr.filter(async …)` (always truthy).
- **Tool coverage:** `typescript-eslint:no-misused-promises` (`checksVoidReturn`, `checksConditionals` — catches `filter(async)` returning Promise in boolean position only if typed); `promise:no-promise-in-callback`, `promise:no-callback-in-promise` (warn in recommended). partial: `reduce(async)` sequencing bugs and `filter(async)` semantics need judgement.
- **Why it hurts:** Node `events` docs: "Using `async` functions with event handlers is problematic, because it can lead to an unhandled rejection". Emitter-based `data` handlers also lose backpressure (NODE-17).
- **Severity:** major.
- **Remediation:** `for…of` + `await`; `await Promise.all(arr.map(fn))` with a concurrency limit (NODE-05); for emitters, `new EventEmitter({ captureRejections: true })` routes rejections to `'error'` / `Symbol.for('nodejs.rejection')`; for streams use `for await (const chunk of stream)`. — Trap: docs: "the recommendation is to **not use `async` functions as `'error'` event handlers**" (no catch handler exists for those).
- **Not a finding when:** the API documents that it awaits callbacks (e.g., some frameworks' hooks).
- **Architecture:** no.
- **Sources:** https://nodejs.org/api/events.html#capture-rejections-of-promises ; https://typescript-eslint.io/rules/no-misused-promises/

### NODE-04 Accidental sequential awaits (latency) — and accidental parallelism (correctness)

- **Signal (sequential):** `for (const id of ids) { results.push(await fetchOne(id)); }` or consecutive independent `const a = await x(); const b = await y();` in a latency-sensitive path. **Signal (parallel):** `Promise.all` over operations that share a transaction/connection, need ordering, or mutate the same row.
- **Tool coverage:** ESLint core `no-await-in-loop` (UNVERIFIED — page not opened); none for the parallel-correctness side — judgement.
- **Why it hurts:** N sequential round-trips multiply p99; conversely, parallel queries on one pg client/transaction are serialized or error, and parallel writes race.
- **Severity:** minor for latency (major on hot request paths with N unbounded); major for unsafe parallelism.
- **Remediation:** batch API (`WHERE id = ANY($1)`) — best; else bounded `Promise.all`; for ordered/transactional work keep sequential and say why in a comment. — Trap: `Promise.all` does not cancel siblings on first rejection; they keep running and their rejections are handled by `all` but side effects still happen — use `AbortController` or `allSettled` + compensation.
- **Not a finding when:** the loop is deliberately sequential for rate limits, ordering, or a shared transaction.
- **Architecture:** no (yes when N+1 across a service boundary implies a missing batch endpoint).
- **Sources:** https://github.com/sindresorhus/p-limit (concurrency primitive)

### NODE-05 Unbounded fan-out (`Promise.all(items.map(...))` over input-sized collections)

- **Signal:** `Promise.all(list.map(async …))` where `list` comes from a request, DB page, file, or queue batch with no cap; recursive fan-out; spawning one outbound call per element.
- **Tool coverage:** none — judgement (no linter knows collection cardinality). Related: `codeql:js/resource-exhaustion` (CWE-400/770; attacker-controlled sizes/lifetimes), `codeql:js/loop-bound-injection` (CWE-834: `{length: 1e100}` as loop bound).
- **Why it hurts:** Exhausts DB pool (queued waiters time out), socket limits, downstream rate limits; memory spikes; a 10k-element request becomes a self-DoS.
- **Severity:** major (blocker when size is user-controlled).
- **Remediation:** Concurrency limiter — `p-limit` ("Run multiple promise-returning & async functions with limited concurrency") or `p-map` with `concurrency`; batch endpoints; validate max collection size at the boundary (schema `max`). — Trap: a limiter created _per call_ inside a recursive function does not bound total concurrency; share one limiter per resource.
- **Not a finding when:** collection is a small, fixed, code-defined set (e.g., 3 config lookups).
- **Architecture:** yes when it hits a shared downstream (bulkhead / rate-limit contract) — escalate.
- **Sources:** https://github.com/sindresorhus/p-limit ; https://codeql.github.com/codeql-query-help/javascript/js-resource-exhaustion/ ; https://codeql.github.com/codeql-query-help/javascript/js-loop-bound-injection/

### NODE-06 Outbound I/O without a deadline / cancellation (`fetch`, SDK calls, DB queries)

- **Signal:** `fetch(url)` / `fetch(url, { method })` with no `signal`; axios/got clients without `timeout`; AWS SDK clients without `requestHandler` timeouts; DB queries without `statement_timeout`/query timeout; no `AbortSignal` threaded from the inbound request to outbound calls.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Node's `fetch` is undici; undici `Client` defaults: `headersTimeout` `300e3` ms, `bodyTimeout` `300e3` ms and it "Monitors the time between consecutive body chunks", `connectTimeout` `10e3`. There is no overall deadline: a server that trickles one byte every 299 s holds the request open indefinitely. Requests pile up behind a slow dependency, pool/socket exhaustion, cascading failure (Release It! "Integration Points").
- **Severity:** major (blocker on user-facing paths calling third parties).
- **Remediation:** `fetch(url, { signal: AbortSignal.timeout(ms) })` (added v17.3.0/v16.14.0: "Returns a new `AbortSignal` which will be aborted in `delay` milliseconds"); combine with the request's signal via `AbortSignal.any([...])` (added v20.3.0/v18.17.0); timeouts < upstream LB idle timeout; circuit breaker + bounded retries with jittered backoff (library: e.g. `cockatiel`/`p-retry` — UNVERIFIED, not opened). — Trap: `Promise.race([call, sleep(ms)])` "timeouts" that leave the call running (socket still held) — abort, don't race.
- **Not a finding when:** a shared HTTP client wrapper already enforces timeouts (verify it).
- **Architecture:** yes — timeout budget across a call chain is a system property; escalate to architect/SRE.
- **Sources:** https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md ; https://nodejs.org/api/globals.html#static-method-abortsignaltimeoutdelay ; https://nodejs.org/api/globals.html#static-method-abortsignalanysignals

### NODE-07 Retries without backoff, jitter, cap, or idempotency

- **Signal:** `while (attempts < n) { try { … } catch { attempts++ } }` with no delay; fixed `setTimeout(1000)` delay; retries on non-idempotent POST; retry on 4xx; nested retries (client retries × SDK retries × queue redelivery).
- **Tool coverage:** none — judgement. Library-first gate: hand-rolled retry loops are a finding by themselves.
- **Why it hurts:** Retry storms amplify an outage; duplicate side effects on non-idempotent operations; multiplicative retry layers.
- **Severity:** major (blocker on payments/writes without idempotency keys).
- **Remediation:** a maintained retry library with exponential backoff + full jitter + max elapsed + retryable-error predicate; idempotency keys for writes; one retry layer. — Trap: retrying inside a DB transaction (retry the whole transaction, not the statement).
- **Not a finding when:** the SDK's built-in retry is configured and not duplicated.
- **Architecture:** yes — retry policy per dependency is a resilience contract.
- **Sources:** UNVERIFIED — no retry-policy primary source opened this session (see Open questions).

### NODE-08 Mixing callbacks and promises / resolving twice

- **Signal:** `new Promise((resolve, reject) => cbApi(…, (err, v) => { if (err) reject(err); resolve(v); }))` (missing `return`); functions that both take a callback and return a promise; `async` functions calling a `callback` in `then`; manual `new Promise` around an API that already has a promise form (`fs/promises`, `stream/promises`, `timers/promises`, `events.once`).
- **Tool coverage:** `promise:avoid-new` (not recommended), `promise:no-multiple-resolved` (none), `promise:no-callback-in-promise`, `promise:no-promise-in-callback`, `promise:param-names` (recommended), `n:prefer-promises/fs`, `n:prefer-promises/dns`, `n:handle-callback-err`, `n:callback-return`. partial.
- **Why it hurts:** Double-resolve is silently ignored → logic runs twice; errors thrown in callbacks escape the promise chain.
- **Severity:** minor; major when it loses errors.
- **Remediation:** `util.promisify`, `node:fs/promises`, `node:stream/promises` `pipeline`, `node:events` `once`, `node:timers/promises` `setTimeout`. — Trap: promisifying functions with non-standard callback signatures (use `util.promisify.custom`).
- **Not a finding when:** a small adapter at a legacy boundary, tested.
- **Architecture:** no.
- **Sources:** https://www.npmjs.com/package/eslint-plugin-promise ; https://www.npmjs.com/package/eslint-plugin-n

---

## Event-loop blocking

### NODE-09 Synchronous I/O and CPU-heavy core APIs on the request path

- **Signal:** `fs.*Sync`, `child_process.execSync/spawnSync/execFileSync`, `zlib.*Sync`, `crypto.pbkdf2Sync`/`scryptSync`/`randomFillSync`/`generateKeyPairSync`, `bcrypt.hashSync`, in any function reachable from a request/message handler.
- **Tool coverage:** `n:no-sync` (eslint-plugin-n, not in recommended); partial: reachability (startup vs request path) is judgement.
- **Why it hurts:** Node guide: "Never use these synchronous APIs in servers" (lists `crypto.randomBytes` sync, `randomFillSync`, `pbkdf2Sync`, `zlib.inflateSync`/`deflateSync`, all sync fs, `spawnSync`/`execSync`/`execFileSync`), "especially dangerous on distributed filesystems like NFS". One slow call stalls every concurrent request (latency cliff, health-check failures, cascading restarts).
- **Severity:** major on request paths; not a finding at startup.
- **Remediation:** async variants; move CPU work to `worker_threads` (e.g., a pool library such as Piscina — UNVERIFIED, not opened) or a separate service/Lambda. — Trap: moving sync work into `setImmediate` does not unblock anything unless it is partitioned.
- **Not a finding when:** module init / CLI scripts / build tooling / reading config once at boot.
- **Architecture:** yes when CPU-bound work belongs in a separate worker/deployable — escalate.
- **Sources:** https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop

### NODE-10 Large `JSON.parse`/`JSON.stringify`, unbounded bodies, deep traversal

- **Signal:** `JSON.parse(await readWholeBody())` without a size limit; `JSON.stringify(bigObject)` for logs/cache; body-parser/`express.json()` with a raised `limit`; recursive deep-clone/merge of request objects; ajv `allErrors: true` on untrusted input.
- **Tool coverage:** `codeql:js/resource-exhaustion-from-deep-object-traversal` (CWE-400; flags ajv `allErrors: true`); `codeql:js/resource-exhaustion`. partial: size/limit configuration is judgement.
- **Why it hurts:** Node guide: `JSON.parse()`/`stringify` are O(n); their 50 MB example: `JSON.stringify` 0.7 s, `JSON.parse` 1.3 s on the event loop. nodebestpractices 6.14: large payloads let attackers "bring servers to their knees without tremendous amount of requests". CodeQL: ajv `allErrors: true` has "no limit to how many error objects will be allocated".
- **Severity:** major (blocker when attacker-controlled size).
- **Remediation:** enforce body size limits at the edge and framework; stream-parse large payloads; paginate; log summaries not whole objects; ajv without `allErrors` on untrusted input. — Trap: raising the body limit to fix a 413 without asking why the payload is large.
- **Not a finding when:** bounded, internal, small payloads.
- **Architecture:** yes when the API design requires huge single payloads (pagination/streaming contract).
- **Sources:** https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop ; https://codeql.github.com/codeql-query-help/javascript/js-resource-exhaustion-from-deep-object-traversal/ ; https://github.com/goldbergyoni/nodebestpractices

### NODE-11 ReDoS-prone and dynamically-built regular expressions

- **Signal:** nested quantifiers `(a+)*`, overlapping alternation `(a|a)*`, backreferences `(a.*)\1` (Node guide's three patterns); `new RegExp(userInput)`; validation regexes on emails/URLs/paths applied to unbounded input.
- **Tool coverage:** `codeql:js/redos` (CWE-1333/730/400, problem, error), `codeql:js/polynomial-redos` (path; polynomial on uncontrolled data), `codeql:js/regex-injection`; `sonarjs/slow-regex` S5852, `sonarjs/super-linear-regex` S8786, `sonarjs/regex-complexity` S5843 (recommended); `security/detect-unsafe-regex`, `security/detect-non-literal-regexp` (eslint-plugin-security 4.0.1); `semgrep:javascript.lang.security.audit.detect-redos.detect-redos` (CWE-1333), `javascript.lang.security.audit.detect-non-literal-regexp.*`. Good coverage; polynomial cases often missed by pattern-only tools.
- **Why it hurts:** Single-threaded runtime: one crafted string pins the CPU for all users (security + availability).
- **Severity:** major; blocker on unauthenticated input.
- **Remediation:** Node guide: "Use `indexOf` for simple string matching"; tools safe-regex / node-re2 ("not 100% V8 compatible"); cap input length before matching; use a vetted validator library (e.g., URL via `new URL()`); `RegExp.escape` for literal user fragments (TS 6.0 lists it in ES2025 lib — runtime availability UNVERIFIED). — Trap: anchoring alone does not remove catastrophic backtracking.
- **Not a finding when:** regex runs only on developer-controlled constants.
- **Architecture:** no.
- **Sources:** https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop ; https://codeql.github.com/codeql-query-help/javascript/js-redos/ ; https://codeql.github.com/codeql-query-help/javascript/js-polynomial-redos/

### NODE-12 Worker-pool starvation by variable-cost tasks

- **Signal:** many concurrent `crypto.pbkdf2`/`scrypt`/`zlib` (async) or `fs.readFile` of large files per request; `dns.lookup` heavy traffic (UNVERIFIED that it uses the pool — not opened); default `UV_THREADPOOL_SIZE` untouched while doing all of the above.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Node guide: a long task "ties up one Worker, reducing throughput"; "Minimize Task Time Variation"; stream large files (`fs.createReadStream`) rather than one large task.
- **Severity:** minor; major for auth endpoints hashing passwords at high concurrency.
- **Remediation:** partition tasks; streams; rate-limit expensive endpoints; dedicated worker threads. — Trap: raising `UV_THREADPOOL_SIZE` without measuring (CPU contention).
- **Not a finding when:** low, bounded concurrency.
- **Architecture:** no.
- **Sources:** https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop

---

## Error handling

### NODE-13 Swallowed errors / empty or log-only catch that continues

- **Signal:** `catch {}`, `catch (e) { }`, `catch (e) { console.log(e) }` then normal return; `.catch(() => {})`; `.catch(() => null)` where null is later treated as "not found"; `try { … } catch { return defaultValue; }` around parsing of critical config.
- **Tool coverage:** ESLint core `no-empty` (UNVERIFIED options, not opened), `sonarjs/no-ignored-exceptions` S2486 (recommended), `sonarjs/no-useless-catch` S2737; `typescript-eslint:no-empty-function` (stylistic) for `() => {}`. partial: log-and-continue with a manufactured default is judgement.
- **Why it hurts:** Hides outages (success metrics stay green), converts failures into wrong data (a failed lookup becomes "user has no permissions"/"price 0").
- **Severity:** major; blocker in auth/billing/data-integrity paths.
- **Remediation:** Handle specific expected errors, rethrow the rest; Result/Either return type for expected failures; if intentionally ignored, comment why and emit a metric. — Trap: `catch (e) { throw e; }` (S2737) or rethrow that drops context.
- **Not a finding when:** best-effort cleanup in `finally`-like paths (e.g., closing an already-closed handle) with a comment.
- **Architecture:** no.
- **Sources:** eslint-plugin-sonarjs 4.2.0 README (see typescript.md)

### NODE-14 Lost error context: no `cause`, stringified errors, non-Error rejects

- **Signal:** `throw new Error('failed to load user')` inside `catch (e)` with no `{ cause: e }`; `throw new Error(e.message)`; `reject('timeout')`; `throw { status: 400 }`; `logger.error('failed: ' + err)`; custom errors not extending `Error`.
- **Tool coverage:** ESLint `preserve-caught-error` (v9.35.0; in `@eslint/js` recommended as of v10.10.0 docs); `typescript-eslint:only-throw-error`, `prefer-promise-reject-errors` (recommended-type-checked). Full for shapes.
- **Why it hurts:** Root cause disappears from logs and APM; stack points at the wrapper.
- **Severity:** major.
- **Remediation:** `new DomainError(msg, { cause: err })`; structured logger with `err` serializer (nodebestpractices 2.7 "Use a mature logger"). nodebestpractices 2.12: `return await` for full async stack traces (typescript-eslint `return-await` `always` if adopted).
- **Not a finding when:** deliberately redacting a sensitive upstream error before crossing a trust boundary (keep it in logs).
- **Architecture:** no.
- **Sources:** https://eslint.org/docs/latest/rules/preserve-caught-error ; https://github.com/goldbergyoni/nodebestpractices

### NODE-15 Log-and-rethrow at every layer (duplicate error logs)

- **Signal:** `catch (e) { logger.error(e); throw e; }` repeated in repository, service, and controller; the same stack appearing 3× in logs for one failure.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Alert noise, inflated error counts, log cost; obscures which layer handled it. nodebestpractices 2.4: "Handle errors centrally, not within a middleware".
- **Severity:** minor (major when it drives paging noise).
- **Remediation:** Either handle (and log) or propagate (with `cause`) — log once at the boundary (central error handler / exception filter). — Trap: removing logs from a layer that is actually the boundary for background jobs (no central handler there).
- **Not a finding when:** adding context-specific fields via a wrapper error without logging.
- **Architecture:** no.
- **Sources:** https://github.com/goldbergyoni/nodebestpractices

### NODE-16 Missing `'error'` listeners on emitters and sockets; `pipe()` without error handling

- **Signal:** `new EventEmitter()` / client objects (DB pool, Redis, Kafka, WebSocket) with no `.on('error', …)`; `readable.pipe(transform).pipe(writable)`; `stream.on('data')` handlers without `'error'`.
- **Tool coverage:** `codeql:js/unhandled-error-in-stream-pipeline` (quality suite **only** — high precision) catches `pipe()` chains; none for arbitrary emitters.
- **Why it hurts:** Node events docs: with no `'error'` listener, "the error is thrown, a stack trace is printed, and the Node.js process exits." Stream docs: "if the `Readable` stream emits an error during processing, the `Writable` destination _is not closed_ automatically… necessary to _manually_ close each stream in order to prevent memory leaks." nodebestpractices 2.13: a DB/queue emitter error either crashes or leaves "a zombie while a key functionality is turned off".
- **Severity:** major.
- **Remediation:** `import { pipeline } from 'node:stream/promises'` ("forwarding errors and properly cleaning up"); `'error'` listeners on long-lived clients wired to reconnect/health state; `events.once(emitter, 'x')` for one-shot waits. — Trap: `stream.finished()` "leaves dangling event listeners… after the returned promise is resolved" unless `{ cleanup: true }`.
- **Not a finding when:** the library documents it handles and surfaces errors via promises only.
- **Architecture:** no.
- **Sources:** https://nodejs.org/api/events.html#error-events ; https://nodejs.org/api/stream.html ; https://codeql.github.com/codeql-query-help/javascript/js-unhandled-error-in-stream-pipeline/

### NODE-17 Ignoring backpressure

- **Signal:** `writable.write(chunk)` in a loop ignoring its boolean return; `readable.on('data', chunk => socket.write(chunk))`; reading a whole large file/response into memory to forward it; producer loops pushing to an unbounded in-memory array consumed async.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Stream docs: `write()` returns `false` when the buffer exceeds `highWaterMark`; "further attempts to write data to the stream should stop until the `'drain'` event is emitted." Otherwise the process buffers unboundedly → OOM under slow consumers.
- **Severity:** major for proxies/exports/uploads.
- **Remediation:** `pipeline()`; `for await` consumption; `once(writable, 'drain')` when writing manually; bounded queues. — Trap: `Readable.from(array)` of a huge pre-materialized array still holds it all in memory.
- **Not a finding when:** small bounded payloads.
- **Architecture:** no.
- **Sources:** https://nodejs.org/api/stream.html

---

## Resource leaks & memory

### NODE-18 Listener, timer and interval leaks

- **Signal:** `emitter.on(...)` inside a per-request function without `off`/`once`; `setInterval` with no stored handle/`clearInterval`; `signal.addEventListener('abort', …)` on a long-lived shared `AbortSignal` per request; `MaxListenersExceededWarning` suppressed via `setMaxListeners(0)` / raised `events.defaultMaxListeners`.
- **Tool coverage:** none — judgement. Runtime: `MaxListenersExceededWarning`.
- **Why it hurts:** Events docs: default max `10` per event; "This is not a hard limit… will output a trace warning… 'possible EventEmitter memory leak'". Non-obvious: "`defaultMaxListeners` has no effect on `AbortSignal` instances… per default `AbortSignal` instances will not warn" — a shutdown/app-lifetime signal accumulating per-request abort listeners leaks silently. Intervals keep the process alive and block clean shutdown.
- **Severity:** major (memory grows until OOM restart).
- **Remediation:** `once`, `{ signal }` option on `addEventListener`/`events.on` to auto-remove, `AbortSignal.any` per-request derivation (added v20.3.0/v18.17.0), clear timers in shutdown hooks, `timeout.unref()` for non-essential timers (docs: "will not require the Node.js event loop to remain active"). — Trap: raising max listeners to silence the warning.
- **Not a finding when:** a known fan-out (e.g., 20 subscribers registered once at boot) with `setMaxListeners(n)` sized explicitly.
- **Architecture:** no.
- **Sources:** https://nodejs.org/api/events.html#eventsdefaultmaxlisteners ; https://nodejs.org/api/timers.html

### NODE-19 Unbounded in-memory caches / module-level Maps

- **Signal:** `const cache = new Map()` at module scope with `set` and no eviction; memoization keyed by request data; `lodash.memoize` over multi-arg functions; per-tenant/per-user objects accumulated in a singleton.
- **Tool coverage:** `sonarjs/memoize-cache-key` S8932 (recommended, 4.2.0) for lodash/underscore multi-param memoize; otherwise none — judgement.
- **Why it hurts:** Memory grows with key cardinality → OOM, GC pauses; stale data served forever; per-instance caches diverge across replicas.
- **Severity:** major when keys derive from user input; minor for bounded code-defined keys.
- **Remediation:** `lru-cache` — its README: "At least one of 'max', 'ttl', or 'maxSize' is required, to prevent unsafe unbounded storage"; TTL for staleness; shared cache (Redis) when consistency across replicas matters. — Trap: `lru-cache` with only `ttl` and no `ttlAutopurge` "will potentially grow unbounded" (README).
- **Not a finding when:** keys are a fixed enum/config set.
- **Architecture:** yes if cache consistency across instances is assumed — escalate.
- **Sources:** https://github.com/isaacs/node-lru-cache ; eslint-plugin-sonarjs 4.2.0 README

### NODE-20 Unclosed pools/handles; per-request client construction

- **Signal:** `new Pool()` / `new PrismaClient()` / `new S3Client()` / `createClient()` inside a handler or per call; pools never `.end()`ed on shutdown; `client = await pool.connect()` without `release()` in `finally`; file handles from `fs.promises.open` not `close()`d.
- **Tool coverage:** none — judgement (TS 5.2 `using`/`await using` + `Symbol.asyncDispose` enables compile-visible scoping — UNVERIFIED, release notes not opened).
- **Why it hurts:** Connection exhaustion at the DB (max_connections), socket/TLS handshake cost per request, leaked clients hold processes open at shutdown.
- **Severity:** major (blocker for DB pools per request).
- **Remediation:** one client/pool per process created at composition root (DI container), injected; `try { … } finally { client.release() }` or `pool.query` helpers; close in graceful shutdown. — Trap: in Lambda, create clients outside the handler (reuse across invocations) but don't assume the pool survives freeze/thaw.
- **Not a finding when:** short-lived scripts that exit.
- **Architecture:** yes — resource lifetime ownership (composition root).
- **Sources:** UNVERIFIED for DB-driver specifics (pg/Prisma docs not opened)

### NODE-21 `AsyncLocalStorage.enterWith` and context loss

- **Signal:** `als.enterWith(store)` in middleware/event handlers; context read via `getStore()` returning `undefined` in callbacks from custom thenables/older callback libs; mutating a shared store object across requests.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Docs: `enterWith` is "Stability: 1 - Experimental"; it "will continue for the _entire_ synchronous execution… subsequent event handlers will also run within that context… That is why `run()` should be preferred over `enterWith()`". Leaks request A's tenant/user into request B → wrong-tenant data (security + correctness). Context loss section: callback APIs/custom thenables may drop the store.
- **Severity:** major (blocker when the store carries identity/tenant used for authorization).
- **Remediation:** `als.run(store, () => next())`; `util.promisify` or `AsyncResource` for callback APIs (docs); immutable per-request store. — Trap: using ALS as an implicit parameter for business data (hidden coupling) — pass explicit arguments for domain inputs; keep ALS for cross-cutting (trace ids, logging).
- **Not a finding when:** `run()` used and store is per-request.
- **Architecture:** yes when identity/tenant flows via ALS into data access — escalate (implicit authorization context).
- **Sources:** https://nodejs.org/api/async_context.html

---

## Config, env, module-level side effects

### NODE-22 `process.env` read deep in code; no startup validation

- **Signal:** `process.env['X']` (or `.X`) in services/handlers/utilities rather than one config module; `process.env.X!`; `Number(process.env.PORT)` with no NaN check; `process.env.FLAG === 'true'` scattered; defaults like `?? 'localhost'` in production code.
- **Tool coverage:** `n:no-process-env` (eslint-plugin-n, not recommended) — enable with an override allowing only the config module. partial: validation completeness is judgement.
- **Why it hurts:** nodebestpractices 1.4: a missing mandatory variable lets "The app starts successfully and serve requests, some information is already persisted to DB. Then… the request can't complete, leaving the app in a dirty state". Untestable (global mutable state), silent defaults ship dev values to prod. Node also deprecated implicit non-string conversion on assignment to `process.env` (process docs change note).
- **Severity:** major.
- **Remediation:** One config module parsing `process.env` once at startup with a schema (zod/valibot/env-var/convict — nodebestpractices names convict, env-var, zod), fail fast, export a typed frozen object injected via DI. Node ≥20.12/21.7 has `process.loadEnvFile()` and `--env-file` (no longer experimental as of v24.10.0/v22.21.0) — no need for `dotenv` in modern Node. — Trap: validating lazily on first access (still fails mid-request).
- **Not a finding when:** the config module itself; build scripts.
- **Architecture:** yes — configuration contract; escalate for cross-service naming.
- **Sources:** https://github.com/goldbergyoni/nodebestpractices ; https://nodejs.org/api/process.html ; https://nodejs.org/api/cli.html

### NODE-23 Secrets and PII in logs / error responses

- **Signal:** `logger.info({ req })`, `console.log(config)`, logging `headers` (Authorization/Cookie), logging full DB rows/users, `err.stack` or upstream error body returned in HTTP responses.
- **Tool coverage:** `codeql:js/clear-text-logging` (CWE-312/359/532, default suite), `codeql:js/stack-trace-exposure` (CWE-209/497, precision very-high), `codeql:js/log-injection` (CWE-117, extended suite only). partial: custom sensitive fields (tokens under non-obvious names) need judgement.
- **Why it hurts:** Credential leakage through log pipelines/3rd-party APM; stack traces help attackers (nodebestpractices 6.20 "Hide error details from clients").
- **Severity:** blocker for secrets; major for PII.
- **Remediation:** logger redaction config (e.g., pino `redact` — UNVERIFIED API, not opened); allowlist serializers; generic client error bodies with correlation IDs. — Trap: redaction by key name only misses nested/renamed fields.
- **Not a finding when:** local debugging code not reachable in prod builds (still prefer removal).
- **Architecture:** yes — data classification / logging policy; escalate to security.
- **Sources:** https://codeql.github.com/codeql-query-help/javascript/js-clear-text-logging/ ; https://codeql.github.com/codeql-query-help/javascript/js-stack-trace-exposure/ ; https://github.com/goldbergyoni/nodebestpractices

### NODE-24 Module-level side effects and hidden singletons

- **Signal:** top-level `await db.connect()`, `const client = new Client(process.env[...])` at import time, `setInterval` at module scope, `app.listen()` in the module other code imports, monkey-patching globals on import.
- **Tool coverage:** `n:no-top-level-await` (for published modules only); otherwise none — judgement.
- **Why it hurts:** nodebestpractices 3.13: such code "will be executed immediately when another file requires the file… might get executed when the underlying system is not ready yet… mocking these DB/network calls for testing is harder". Import order becomes load-bearing; tests open real connections; cold starts pay for unused modules.
- **Severity:** major (minor for pure constant setup).
- **Remediation:** Factory functions called from a composition root; DI container; explicit `start()`/`stop()` lifecycle. — Trap: Lambda cold-start optimisation legitimately initialises clients outside the handler — do it in the handler module, not in shared libraries.
- **Not a finding when:** entrypoint files (`main.ts`, Lambda handler module) whose job is composition.
- **Architecture:** yes — composition root / lifecycle ownership.
- **Sources:** https://github.com/goldbergyoni/nodebestpractices

---

## Process lifecycle

### NODE-25 No or broken graceful shutdown (SIGTERM)

- **Signal:** no `SIGTERM` handler in a server; handler that calls `process.exit()` immediately; handler that closes nothing; `server.close()` without closing DB pools/consumers; no hard-deadline timer; container started via `npm start` (signal forwarding); installing a `SIGTERM` listener that never exits.
- **Tool coverage:** `n:no-process-exit` / `n:process-exit-as-throw` (eslint-plugin-n recommended) touch the exit call only; lifecycle correctness is judgement.
- **Why it hurts:** Node process docs: `'SIGTERM'`/`'SIGINT'` default handlers exit with `128 + signal number`; "If one of these signals has a listener installed, its default behavior will be removed" — a listener that doesn't finish shutdown hangs until SIGKILL. `process.exit()` "will force the process to exit as quickly as possible even if there are still asynchronous operations pending… including I/O operations to `process.stdout`" — lost logs/in-flight requests. nodebestpractices 8.6 ("Shutdown smartly and gracefully"), 8.2 (start with `node`, not `npm start`).
- **Severity:** major.
- **Remediation:** On SIGTERM: fail readiness → `server.close()` (since v19, `close()` also closes idle keep-alive connections; `closeAllConnections()` after `close()` for stragglers) → drain consumers → close pools → set `process.exitCode` and let the loop empty, with an `unref()`ed hard-kill timer. Frameworks: use their shutdown hooks (see NestJS file). — Trap: calling `closeAllConnections()` _before_ `close()` (docs recommend after, to avoid races).
- **Not a finding when:** Lambda handlers (platform-managed lifecycle) — though extensions/SIGTERM exist, out of scope.
- **Architecture:** yes — deploy/rollout contract with LB/orchestrator (SRE).
- **Sources:** https://nodejs.org/api/process.html ; https://nodejs.org/api/http.html ; https://github.com/goldbergyoni/nodebestpractices

### NODE-26 HTTP server timeouts misaligned with the load balancer

- **Signal:** Node HTTP server behind an ALB/NGINX with default `keepAliveTimeout`; `server.requestTimeout = 0`/`headersTimeout = 0`; intermittent 502s at low traffic.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Node 24.x docs: `server.keepAliveTimeout` **Default `5000`**; AWS ALB idle timeout default "60 seconds", and AWS "recommend[s] that you configure the idle timeout of your application to be larger than the idle timeout configured for the load balancer. Otherwise… the load balancer sends an HTTP 502 Bad Gateway". Node main-branch docs show the default changing to `65000` in an unreleased version ("REPLACEME") — do not assume it on current LTS. `requestTimeout` default `300000`, `headersTimeout` min(requestTimeout, 60000); docs: "must be set to a non-zero value… to protect against potential Denial-of-Service attacks in case the server is deployed without a reverse proxy".
- **Severity:** major (sporadic 502s are hard to diagnose).
- **Remediation:** set `keepAliveTimeout` > LB idle timeout (and `headersTimeout` > `keepAliveTimeout` per common guidance — UNVERIFIED relation, not in opened docs); keep request/header timeouts non-zero. — Trap: raising the LB idle timeout instead, which shifts the race rather than fixing ordering.
- **Not a finding when:** serverless/Lambda behind API Gateway (no persistent Node server sockets).
- **Architecture:** yes — infra/app timeout contract; escalate to SRE.
- **Sources:** https://raw.githubusercontent.com/nodejs/node/v24.x/doc/api/http.md ; https://nodejs.org/api/http.html ; https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html

### NODE-27 Memory limits not aligned with container limits

- **Signal:** container memory limit set, no `--max-old-space-size` (or vice versa); OOMKilled restarts without heap-exhaustion logs.
- **Tool coverage:** none — judgement.
- **Why it hurts:** nodebestpractices 8.7: set both; "set the v8's old space memory to be a just bit less than the container limit". Otherwise kernel OOM kill (no stack, no graceful shutdown) or under-utilisation.
- **Severity:** minor (major for memory-heavy services).
- **Remediation:** explicit heap flag from container limit; memory metrics + heap snapshots on threshold.
- **Not a finding when:** Node's container-aware defaults are verified adequate for the workload (UNVERIFIED: current V8 heap sizing heuristics in containers not opened).
- **Architecture:** no (SRE).
- **Sources:** https://github.com/goldbergyoni/nodebestpractices

---

## Injection-shaped Node APIs (quality flags that escalate)

### NODE-28 `child_process.exec` / `shell: true` with interpolated strings

- **Signal:** `exec(\`cmd ${x}\`)`, `execSync('git ' + branch)`, `spawn(cmd, args, { shell: true })`, commands built from env/file paths.
- **Tool coverage:** `codeql:js/command-line-injection` (CWE-78/88), `codeql:js/shell-command-injection-from-environment`, `codeql:js/shell-command-constructed-from-input`, `codeql:js/second-order-command-line-injection`, `codeql:js/indirect-command-line-injection`; `sonarjs/os-command` S4721, `sonarjs/no-os-command-from-path` S4036; `security/detect-child-process`; `semgrep:javascript.lang.security.detect-child-process.detect-child-process`, `semgrep:javascript.lang.security.audit.spawn-shell-true.spawn-shell-true` (CWE-78). Strong.
- **Why it hurts:** Node docs (exec): "**Never pass unsanitized user input to this function. Any input containing shell metacharacters may be used to trigger arbitrary command execution.**" Also blocks the loop if `*Sync`.
- **Severity:** blocker when any part is externally influenced; major otherwise (portability, quoting bugs with spaces).
- **Remediation:** `execFile`/`spawn` with an argument array and no shell (CodeQL: "use APIs that don't run shell commands and that accept command arguments as an array"); prefer a library/SDK over shelling out. — Trap: escaping functions written by hand.
- **Not a finding when:** constant command strings in build scripts.
- **Architecture:** no — escalate to security.
- **Sources:** https://nodejs.org/api/child_process.html ; https://codeql.github.com/codeql-query-help/javascript/js-command-line-injection/

### NODE-29 Path traversal via `path.join`/`resolve` on user input; archive extraction

- **Signal:** `path.join(baseDir, req.params.file)`, `res.sendFile(userPath)`, `fs.readFile(\`${dir}/${name}\`)`, `require(variable)`/`import(variable)`, unzip entries written without normalising.
- **Tool coverage:** `codeql:js/path-injection` (CWE-22/23/36/73/99, error), `codeql:js/zipslip` (CWE-22); `security/detect-non-literal-fs-filename`, `security/detect-non-literal-require`; `n:no-path-concat`; `semgrep:javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal` (CWE-22). nodebestpractices 6.17.
- **Why it hurts:** `path.join('/data', '../../etc/passwd')` escapes base dir; arbitrary file read/write.
- **Severity:** blocker on request input.
- **Remediation:** resolve then verify `resolved.startsWith(base + path.sep)`; map IDs to paths server-side instead of accepting paths; object storage keys instead of filesystem. — Trap: `startsWith(base)` without separator (`/data-evil`), and checking before `realpath` (symlinks).
- **Not a finding when:** constant paths.
- **Architecture:** no — escalate to security.
- **Sources:** https://codeql.github.com/codeql-query-help/javascript/js-path-injection/ ; https://codeql.github.com/codeql-query-help/javascript/js-zipslip/

### NODE-30 Prototype pollution via dynamic keys / deep merge

- **Signal:** `obj[key] = value` with `key` from input; hand-rolled `deepMerge`/`set(obj, 'a.b.c', v)`; `Object.assign({}, JSON.parse(body))` fed into config; `for (const k in src) target[k] = src[k]` recursively.
- **Tool coverage:** `codeql:js/prototype-polluting-assignment`, `codeql:js/prototype-pollution-utility`, `codeql:js/prototype-pollution` (merge call; CWE-915/471/94/78/79/400), `codeql:js/remote-property-injection` (extended), `codeql:js/unvalidated-dynamic-method-call` (CWE-754); `security/detect-object-injection` (warn; README: "finds a lot of false positives which need triage by a human"); `semgrep:javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop` (CWE-915); `typescript-eslint:no-dynamic-delete`.
- **Why it hurts:** CodeQL: modifying `Object.prototype` lets an attacker "tamper with the application logic, and often escalate to remote code execution".
- **Severity:** blocker on input-derived keys; minor for `detect-object-injection` hits on typed literal-union keys.
- **Remediation:** `Map` for dynamic keys; `Object.create(null)`; reject `__proto__`/`constructor`/`prototype`; schema-parse input (strips unknown keys); maintained merge libs with pollution guards. — Trap: treating every `obj[i]` flagged by `detect-object-injection` as a vuln — array indexes and closed-union keys are not.
- **Not a finding when:** key type is a closed literal union validated at the boundary.
- **Architecture:** no — escalate to security.
- **Sources:** https://codeql.github.com/codeql-query-help/javascript/js-prototype-polluting-assignment/ ; https://www.npmjs.com/package/eslint-plugin-security

### NODE-31 Type confusion on query parameters (`req.query.x` assumed string)

- **Signal:** `req.query.name.includes('..')`, `if (req.query.id.length > 10)`, sanitising query params with string methods; `?a[]=1&a[]=2` or `?a[b]=1` producing arrays/objects.
- **Tool coverage:** `codeql:js/type-confusion-through-parameter-tampering` (CWE-843, error, default suite); `codeql:js/loop-bound-injection`.
- **Why it hurts:** CodeQL: "sanitizing request parameters assuming they have type String… is susceptible" — arrays bypass `indexOf` checks; `.length` of an object is attacker-chosen.
- **Severity:** major (blocker when it guards a security check).
- **Remediation:** parse query with a schema (coerce/validate types) at the boundary (see typescript.md TS-17). — Trap: TypeScript types on `req.query` (`Request<{}, {}, {}, { id: string }>`) are unchecked assertions.
- **Not a finding when:** a validation pipe/schema already typed the value.
- **Architecture:** no.
- **Sources:** https://codeql.github.com/codeql-query-help/javascript/js-type-confusion-through-parameter-tampering/

### NODE-32 SSRF — outbound URL built from input

- **Signal:** `fetch(req.body.url)`, `axios.get(\`${base}/${req.params.path}\`)`, webhooks/image-proxy/"import from URL" features without allowlist.
- **Tool coverage:** `codeql:js/request-forgery` (CWE-918, default suite); `semgrep:javascript.express.security.audit.express-ssrf.*` (ID suffix UNVERIFIED).
- **Why it hurts:** CodeQL: "can give an attacker the means to bypass the network boundary and make requests against internal services" (cloud metadata endpoints, internal admin APIs).
- **Severity:** blocker for user-supplied full URLs.
- **Remediation:** allowlist hosts; resolve DNS and block private ranges (and re-check on redirect); egress proxy. — Trap: string-prefix checks on URLs (`startsWith('https://good.com')` accepts `https://good.com.evil.com`) — `codeql:js/incomplete-url-substring-sanitization`.
- **Not a finding when:** URL fully constant or selected from a server-side map.
- **Architecture:** yes — egress boundary; escalate to security/architect.
- **Sources:** https://codeql.github.com/codeql-query-help/javascript/js-request-forgery/

### NODE-33 Dependency hygiene: unpinned, extraneous, or deprecated APIs/deps

- **Signal:** imports of packages not in `package.json` (hoisting luck), `npm install` in CI instead of `npm ci`, deprecated Node APIs (`new Buffer()`, `url.parse`), `node:`-less builtin imports shadowed by npm packages.
- **Tool coverage:** `n:no-extraneous-import`/`no-extraneous-require`, `n:no-missing-import`, `n:no-deprecated-api`, `n:no-unsupported-features/*` (all recommended, eslint-plugin-n 18.3.0), `n:prefer-node-protocol`, `n:no-hide-core-modules` (deprecated), `security/detect-new-buffer`; `npm audit` (nodebestpractices 6.7, 5.19 `npm ci`).
- **Why it hurts:** Works in monorepo dev via hoisting, fails in isolated deploy bundles; deprecated APIs removed in next major.
- **Severity:** major for extraneous imports in deployables; minor otherwise.
- **Remediation:** declare deps explicitly; `npm ci` with lockfile; `node:` protocol (nodebestpractices 6.27).
- **Not a finding when:** devDependency imports in tests/tooling.
- **Architecture:** no.
- **Sources:** https://www.npmjs.com/package/eslint-plugin-n ; https://github.com/goldbergyoni/nodebestpractices

---

## Security-hygiene overlap

| Smell (entry)                                                                             | CWE                                                                | CodeQL                                                                                                   | Semgrep / ESLint                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uncaught exception kills server from a request (NODE-01, NODE-02)                         | CWE-248, CWE-730                                                   | `js/server-crash` (default suite)                                                                        | —                                                                                                                                                  |
| Unbounded fan-out / attacker-controlled sizes (NODE-05, NODE-10)                          | CWE-400, CWE-770, CWE-834                                          | `js/resource-exhaustion`, `js/loop-bound-injection`, `js/resource-exhaustion-from-deep-object-traversal` | —                                                                                                                                                  |
| Missing rate limiting on expensive handlers                                               | CWE-770, CWE-307, CWE-400                                          | `js/missing-rate-limiting`                                                                               | —                                                                                                                                                  |
| ReDoS (NODE-11)                                                                           | CWE-1333                                                           | `js/redos`, `js/polynomial-redos`, `js/regex-injection`                                                  | `semgrep:javascript.lang.security.audit.detect-redos.detect-redos`; `sonarjs/slow-regex` S5852; `security/detect-unsafe-regex`                     |
| Command injection (NODE-28)                                                               | CWE-78, CWE-88                                                     | `js/command-line-injection`, `js/shell-command-injection-from-environment`                               | `semgrep:javascript.lang.security.audit.spawn-shell-true.spawn-shell-true`; `security/detect-child-process`                                        |
| Path traversal / Zip Slip (NODE-29)                                                       | CWE-22                                                             | `js/path-injection`, `js/zipslip`                                                                        | `semgrep:javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal`                                    |
| Prototype pollution (NODE-30)                                                             | CWE-915, CWE-1321 (latter not in CodeQL tags — UNVERIFIED mapping) | `js/prototype-polluting-assignment`, `js/prototype-pollution-utility`, `js/prototype-pollution`          | `semgrep:javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop`; `security/detect-object-injection` |
| Type confusion via query params (NODE-31)                                                 | CWE-843                                                            | `js/type-confusion-through-parameter-tampering`                                                          | —                                                                                                                                                  |
| SSRF (NODE-32)                                                                            | CWE-918                                                            | `js/request-forgery`                                                                                     | —                                                                                                                                                  |
| Secrets/PII in logs; stack traces to clients (NODE-23)                                    | CWE-312, CWE-532, CWE-209                                          | `js/clear-text-logging`, `js/stack-trace-exposure`, `js/log-injection` (CWE-117)                         | `semgrep:javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring` (CWE-134)                                                         |
| `eval`/`vm`/`Function` on input                                                           | CWE-94, CWE-95                                                     | `js/code-injection`, `js/unsafe-deserialization` (CWE-502)                                               | `security/detect-eval-with-expression`                                                                                                             |
| TLS verification disabled (`rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`) | CWE-295                                                            | `js/disabling-certificate-validation` (precision very-high)                                              | —                                                                                                                                                  |
| Weak randomness for tokens                                                                | CWE-338                                                            | `js/insecure-randomness`                                                                                 | `security/detect-pseudoRandomBytes`; `sonarjs/pseudo-random` S2245                                                                                 |
| JWT verified with falsy key / decode-without-verify                                       | CWE-347, CWE-345                                                   | `js/jwt-missing-verification`                                                                            | `semgrep:javascript.jsonwebtoken.security.audit.jwt-decode-without-verify.jwt-decode-without-verify`                                               |
| Permissive CORS / credentials with reflected origin                                       | CWE-942, CWE-346                                                   | `js/cors-permissive-configuration`, `js/cors-misconfiguration-for-credentials`                           | —                                                                                                                                                  |
| Helmet frame/CSP disabled                                                                 | CWE-693, CWE-1021                                                  | `js/insecure-helmet-configuration`                                                                       | —                                                                                                                                                  |
| User-controlled value in an authorization check                                           | CWE-807, CWE-290                                                   | `js/user-controlled-bypass` (extended)                                                                   | —                                                                                                                                                  |
| User data in LLM system prompt                                                            | CWE-1427                                                           | `js/system-prompt-injection`                                                                             | —                                                                                                                                                  |
| Check-then-use on files / insecure temp files                                             | CWE-367, CWE-377                                                   | `js/file-system-race`, `js/insecure-temporary-file` (extended)                                           | —                                                                                                                                                  |
| Timing-unsafe secret comparison                                                           | CWE-208 (UNVERIFIED mapping)                                       | —                                                                                                        | `security/detect-possible-timing-attacks`                                                                                                          |

## Open questions / unverified

1. ESLint core `no-await-in-loop` and `no-empty` rule pages were not opened (NODE-04, NODE-13).
2. No primary source opened for retry/backoff/jitter policy (NODE-07); AWS Architecture Blog "Exponential Backoff and Jitter" or the AWS Builders' Library would be the citation to open.
3. RESOLVED: `AbortSignal.any()` added v20.3.0/v18.17.0 (Node `globals.md`).
4. `headersTimeout > keepAliveTimeout` rule of thumb not found in the opened Node docs (NODE-26). Also the `keepAliveTimeout` default change to 65000 is on Node `main` as "REPLACEME" — which release ships it is unknown.
5. Piscina, cockatiel, p-retry, pino `redact`, TS `using`/`Symbol.asyncDispose`, pg/Prisma pool semantics — named but not opened.
6. Whether `dns.lookup` uses the libuv threadpool — recalled, not opened (NODE-12).
7. Semgrep registry IDs are formed as `<directory path with dots>.<rule id>` from the opened YAML files; the dotted form was not confirmed on semgrep.dev (the registry site was not fetched). `express-ssrf` rule id suffix not read.
8. CWE-1321 (prototype pollution) and CWE-208 mappings are the agent's, not from a tool's metadata.
9. Current V8 container-aware heap defaults (NODE-27) not verified.
10. `RegExp.escape` runtime availability in Node LTS not verified.
