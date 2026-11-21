# NestJS — code smells, anti-patterns, red flags (reference corpus for `staff-code-quality`)

<!-- GENERATED INDEX (scripts/buildIndex.py) — edit the entries below, then regenerate. -->

## Index — scan this, then open only the entries that apply (`rg -n '^### <ID>' <this file>`)

| ID      | Smell                                                                                      | Section                                  | Detected by | Default severity | Architecture |
| ------- | ------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------- | ---------------- | ------------ |
| NEST-01 | `forwardRef()` papering over a provider/module cycle                                       | Dependency injection & module design     | partial     | major            | yes          |
| NEST-02 | Service Locator via `ModuleRef` / `app.get()` in business code                             | Dependency injection & module design     | judgement   | major            | yes          |
| NEST-03 | `new`-ing providers / duplicate provider registration                                      | Dependency injection & module design     | judgement   | major            | yes          |
| NEST-04 | `@Global()` / `isGlobal` overuse                                                           | Dependency injection & module design     | judgement   | minor            | yes          |
| NEST-05 | God module / shared "CommonModule" dumping ground                                          | Dependency injection & module design     | judgement   | major            | yes          |
| NEST-06 | Constructor over-injection (fat service) — invisible to parameter-count rules              | Dependency injection & module design     | partial     | major            | yes          |
| NEST-07 | Request scope used casually (and its bubbling cost)                                        | Dependency injection & module design     | judgement   | major            | yes          |
| NEST-08 | `import type` of DTOs / injected classes; interfaces as DI or validation types             | Dependency injection & module design     | partial     | blocker          | no           |
| NEST-09 | Business logic in controllers                                                              | Layering: controllers, services, enhanc… | judgement   | major            | yes          |
| NEST-10 | Enhancer in the wrong layer (middleware vs guard vs interceptor vs pipe vs filter)         | Layering: controllers, services, enhanc… | judgement   | major            | yes          |
| NEST-11 | Protected-by-opt-in routes (no global auth guard)                                          | Layering: controllers, services, enhanc… | partial     | blocker          | yes          |
| NEST-12 | Global enhancers registered in `main.ts` (not tested, not injectable)                      | Layering: controllers, services, enhanc… | judgement   | major            | no           |
| NEST-13 | Heavy or blocking work in interceptors/guards/middleware                                   | Layering: controllers, services, enhanc… | judgement   | major            | no           |
| NEST-14 | Route shadowing on Express (`:id` before static paths)                                     | Layering: controllers, services, enhanc… | tool        | major            | no           |
| NEST-15 | `ValidationPipe` misconfiguration (mass assignment, silent passes)                         | Validation & the wire contract           | judgement   | blocker          | yes          |
| NEST-16 | Nested / array DTOs not actually validated                                                 | Validation & the wire contract           | judgement   | blocker          | no           |
| NEST-17 | ORM entity / DB row returned to the wire (DTO–entity conflation) and deny-list serializat… | Validation & the wire contract           | judgement   | blocker          | yes          |
| NEST-18 | Exception filters leaking internals / wrong mapping                                        | Validation & the wire contract           | partial     | major            | yes          |
| NEST-19 | `ConfigService.get` without validation / typed access; `process.env` in providers          | Configuration & lifecycle                | partial     | major            | yes          |
| NEST-20 | Heavy or order-dependent I/O in `onModuleInit`/`onApplicationBootstrap`; hook reliance on… | Configuration & lifecycle                | judgement   | major            | yes          |
| NEST-21 | Missing `enableShutdownHooks()` / resources not released on shutdown                       | Configuration & lifecycle                | judgement   | major            | yes          |
| NEST-22 | TestingModule where everything is mocked (tests test the mocks)                            | Testing anti-patterns                    | judgement   | major            | no           |
| NEST-23 | Misusing `resolve()` / scoped providers in tests                                           | Testing anti-patterns                    | judgement   | minor            | no           |
| NEST-24 | Transactions spanning services / leaking `QueryRunner`/`EntityManager` through APIs        | Data, events, messaging                  | judgement   | major            | yes          |
| NEST-25 | `@nestjs/event-emitter` misuse (swallowed listener errors, events as hidden control flow)  | Data, events, messaging                  | judgement   | major            | yes          |
| NEST-26 | Microservice client calls: cold `send()`, no timeout, no error mapping                     | Data, events, messaging                  | partial     | major            | yes          |
| NEST-27 | Queue consumers: concurrency and DI assumptions                                            | Data, events, messaging                  | judgement   | major            | no           |
| NEST-28 | `helmet`/`cors` registered after routes or with permissive defaults                        | Security defaults (quality flags that e… | partial     | major            | yes          |
| NEST-29 | Throttling that doesn't throttle (in-memory storage, proxy IPs, per-IP identity)           | Security defaults (quality flags that e… | tool        | major            | yes          |
| NEST-30 | Authorization only at the route level (no resource-level check)                            | Security defaults (quality flags that e… | partial     | blocker          | yes          |
| NEST-31 | `@Res()` library-specific responses                                                        | Security defaults (quality flags that e… | judgement   | major            | no           |
| NEST-32 | Structured logger params and request logging leaking PII/secrets (v12)                     | Security defaults (quality flags that e… | partial     | major            | yes          |

<!-- END GENERATED INDEX -->

## Scope & sources consulted

| Source                                                                                                              | Version / date read             | URL                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@nestjs/core`, `@nestjs/testing`                                                                                   | 12.0.1 (npm latest, 2026-09-13) | https://www.npmjs.com/package/@nestjs/core                                                                                                                                                  |
| NestJS docs repo (`nestjs/docs.nestjs.com` `content/*.md`)                                                          | master, last commit 2026-09-11  | https://github.com/nestjs/docs.nestjs.com                                                                                                                                                   |
| — Migration guide v11 → v12                                                                                         | same                            | https://docs.nestjs.com/migration-guide                                                                                                                                                     |
| — Fundamentals: injection scopes, circular dependency, module reference, lifecycle events, testing                  | same                            | https://docs.nestjs.com/fundamentals/injection-scopes ; /fundamentals/circular-dependency ; /fundamentals/module-ref ; /fundamentals/lifecycle-events ; /fundamentals/testing               |
| — Overview: modules, controllers, pipes, guards, interceptors, middleware, exception filters; FAQ request lifecycle | same                            | https://docs.nestjs.com/modules ; /controllers ; /pipes ; /guards ; /interceptors ; /middleware ; /exception-filters ; /faq/request-lifecycle                                               |
| — Techniques: validation, configuration, serialization, events, SQL (TypeORM/Sequelize), queues, logger             | same                            | https://docs.nestjs.com/techniques/validation ; /techniques/configuration ; /techniques/serialization ; /techniques/events ; /techniques/database ; /techniques/queues ; /techniques/logger |
| — Security: authentication, authorization, CORS, Helmet, rate limiting                                              | same                            | https://docs.nestjs.com/security/authentication ; /security/authorization ; /security/cors ; /security/helmet ; /security/rate-limiting                                                     |
| — Microservices basics                                                                                              | same                            | https://docs.nestjs.com/microservices/basics                                                                                                                                                |
| `@nestjs/config` `dist/config.service.d.ts`                                                                         | 12.0.0 (npm tarball)            | https://www.npmjs.com/package/@nestjs/config                                                                                                                                                |
| `@nestjs/throttler`                                                                                                 | 6.5.0 (npm)                     | https://www.npmjs.com/package/@nestjs/throttler                                                                                                                                             |
| class-validator README + CHANGELOG                                                                                  | 0.15.1 (develop)                | https://github.com/typestack/class-validator                                                                                                                                                |
| class-transformer README                                                                                            | develop                         | https://github.com/typestack/class-transformer                                                                                                                                              |
| Jay McDoniel (NestJS core team), "Circular Dependencies in NestJS and how to Avoid Them"                            | Trilon blog, 2022-12-15         | https://trilon.io/blog/avoiding-circular-dependencies-in-nestjs                                                                                                                             |
| SonarJS `S107/rule.ts` (max-params decoration)                                                                      | GitHub master 2026-09-13        | https://github.com/SonarSource/SonarJS/tree/master/packages/analysis/src/jsts/rules/S107                                                                                                    |
| Semgrep `typescript/nestjs/security/audit/*`                                                                        | `semgrep/semgrep-rules` develop | https://github.com/semgrep/semgrep-rules/tree/develop/typescript/nestjs                                                                                                                     |
| CodeQL JS query help (see nodejs.md for per-query metadata)                                                         | 2026-09-13                      | https://codeql.github.com/codeql-query-help/javascript/                                                                                                                                     |

### Coverage statement (read first)

No linter or SAST tool opened in this research understands Nest's DI graph, module encapsulation, scope propagation, enhancer binding order, or serialization semantics. The **only NestJS-aware scanner rules found** are three Semgrep audit rules: `semgrep:typescript.nestjs.security.audit.nestjs-header-cors-any.nestjs-header-cors-any` (CWE-183), `semgrep:typescript.nestjs.security.audit.nestjs-header-xss-disabled.nestjs-header-xss-disabled` (CWE-79), `semgrep:typescript.nestjs.security.audit.nestjs-open-redirect.nestjs-open-redirect` (CWE-601). Generic TS/Node rules (typescript.md, nodejs.md) still apply to Nest code. **Unless an entry names a rule, assume `none — judgement`** — that is where this agent earns its keep.

Two tool blind spots specific to Nest:

1. **SonarQube S107 (max 7 params) ignores constructors whose parameters are all parameter properties** (`constructor(private readonly a: A, …)`) — SonarJS `S107/rule.ts`: "Decorates ESLint `max-params` to ignore TypeScript constructor when its parameters are all parameter properties". That is exactly the Nest DI constructor shape, so over-injection is invisible to parameter-count rules (NEST-06).
2. Nest v12 generated `tsconfig` (migration guide, ESM project) sets `"strict": true` **and** `"strictPropertyInitialization": false`. A scaffolded project silently opts out of one `strict` sub-flag; `@Inject()`-less property fields and DTO fields without initialisers are therefore unchecked (see typescript.md TS-08).

### v12 changes an agent must know (migration guide, docs commit 2026-09-11)

- Core packages are **ESM-only**; CJS apps rely on `require(esm)` (Node 20.19+ / 22.12+).
- **Standard Schema** validation: `@Body({ schema })` + `StandardSchemaValidationPipe`; `StandardSchemaSerializerInterceptor` + `@SerializeOptions({ schema })`. `@nestjs/config` `validationSchema` accepts any Standard Schema (Joi ≥18 only).
- **Lifecycle hook ordering changed** to component hierarchy level — note the lifecycle-events page still says order "directly depends on the order of module imports". Code relying on hook order is fragile across the upgrade.
- **Route shadowing diagnostics** are opt-in: `routeConflictPolicy: { duplicate: 'error', shadow: 'warn' }`, `routeResolutionStrategy: 'specificity'` — defaults keep the old silent behaviour.
- `HttpException` `errorCode` option (serialized to clients; `cause` never is).
- `ConsoleLogger` **structured params on by default** (`logger.log('User created', { userId, email })` attaches the object) — PII-in-logs exposure grows (NEST-26).
- Express adapter now drains in-flight requests on shutdown.

---

## Dependency injection & module design

### NEST-01 `forwardRef()` papering over a provider/module cycle

- **Signal:** `@Inject(forwardRef(() => X))`, `imports: [forwardRef(() => XModule)]`; pairs of modules importing each other; runtime "Nest can't resolve dependencies of X (?)" fixed by adding `forwardRef`; `index.ts` barrels imported by module/provider files.
- **Tool coverage:** partial: `import-x:no-cycle` detects the _file_ cycle when one exists (not when the cycle is only in the DI graph via tokens); none for module-graph cycles.
- **Why it hurts:** Docs: "The order of instantiation is indeterminate… Having circular dependencies depend on providers with `Scope.REQUEST` can lead to undefined dependencies." Docs also: "A circular dependency might also be caused when using 'barrel files'/index.ts files… Barrel files should be omitted when it comes to module/provider classes." McDoniel (core team): "`forwardRef` is there as your last resort… shouldn't be used as a catch all". Cycle = two modules that cannot change or be extracted independently.
- **Severity:** major; minor only when documented as a temporary step with a follow-up.
- **Remediation:** Extract the shared logic into a lower-level provider/module both depend on (Move Function / Extract Class); invert with a domain event (Observer/Mediator) where one side only needs to notify; accept a small duplication over a cycle (McDoniel: WET acceptable). Remove intra-feature barrel imports. — Trap: replacing `forwardRef` with `ModuleRef.get()` (NEST-02) — same cycle, now invisible.
- **Not a finding when:** a genuinely bidirectional framework integration documented in code (rare); `forwardRef` in generated code.
- **Architecture:** yes — module boundary/layering; escalate to architect.
- **Sources:** https://docs.nestjs.com/fundamentals/circular-dependency ; https://trilon.io/blog/avoiding-circular-dependencies-in-nestjs

### NEST-02 Service Locator via `ModuleRef` / `app.get()` in business code

- **Signal:** `this.moduleRef.get(Token, { strict: false })` inside services/handlers; `moduleRef.resolve()` called per operation; `app.get(SomeService)` outside `main.ts`/scripts; strategy lookup by string token at runtime.
- **Tool coverage:** none — judgement (grep `moduleRef.get(`, `{ strict: false }`, `.resolve(`).
- **Why it hurts:** Dependencies disappear from the constructor, so the module graph, tests and reviewers can't see them; `{ strict: false }` bypasses module encapsulation (docs: retrieves "from the global context"). `get()` "can't retrieve scoped providers"; `resolve()` "returns a unique instance… from its own DI container sub-tree" each call — a new instance per call unless a `contextId` is threaded, and `ContextIdFactory.create()` sub-trees have `REQUEST` `undefined`.
- **Severity:** major in domain/application services; minor in a composition/registry component.
- **Remediation:** Constructor injection; for runtime-selected implementations, a Registry/Strategy map injected as a provider (`useFactory` building `Map<Kind, Handler>`), or `DiscoveryService` at bootstrap for plugin discovery. — Trap: `ModuleRef` as the documented "alternative" to `forwardRef` in the circular-dependency page — it resolves the error, not the coupling.
- **Not a finding when:** a framework-level registry/dispatcher resolving handlers once at bootstrap; standalone scripts using `app.get()`.
- **Architecture:** yes — hidden dependency graph; escalate if used to cross module boundaries.
- **Sources:** https://docs.nestjs.com/fundamentals/module-ref

### NEST-03 `new`-ing providers / duplicate provider registration

- **Signal:** `new UsersService(new UsersRepository(...))` inside a provider/controller; `private readonly x = new SomeClient()` fields; the same service class listed in `providers` of two modules instead of exported once; static singletons (`export const db = new Pool()`) imported by providers.
- **Tool coverage:** none — judgement (grep `new [A-Z]\w*(Service|Repository|Client|Provider)\(`).
- **Why it hurts:** Bypasses lifecycle hooks, config, overrides in tests, and scope. Docs: registering `CatsService` directly in every module "would result in each module getting its own separate instance… increased memory usage… state inconsistency if the service maintains any internal state" — e.g., two DB pools, two caches.
- **Severity:** major for stateful resources (pools, clients, caches); minor for pure helpers.
- **Remediation:** Register once, `exports: [X]`, import the module; custom providers (`useFactory`/`useValue`) for third-party clients; value objects and pure functions may be `new`/called directly. — Trap: making the module `@Global()` to avoid imports (NEST-04).
- **Not a finding when:** instantiating DTOs, entities, value objects, errors, or pure strategy objects with no dependencies.
- **Architecture:** yes when it creates duplicate stateful resources.
- **Sources:** https://docs.nestjs.com/modules

### NEST-04 `@Global()` / `isGlobal` overuse

- **Signal:** `@Global()` on feature modules; `global: true` on dynamic modules beyond config/logging/DB; feature modules with empty `imports` that still inject many providers.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Docs: "Making everything global is not recommended as a design practice… avoiding unnecessary coupling between unrelated parts"; "making everything global **is not a good design decision**". Module dependencies become implicit; extracting a module into another app fails at runtime.
- **Severity:** minor per module; major when domain modules are global.
- **Remediation:** explicit `imports`; keep global for true infrastructure (ConfigModule `isGlobal`, logger), registered once at root (docs: "should be registered **only once**").
- **Not a finding when:** a single infrastructure module at root.
- **Architecture:** yes — module encapsulation contract.
- **Sources:** https://docs.nestjs.com/modules

### NEST-05 God module / shared "CommonModule" dumping ground

- **Signal:** a module exporting >~10 unrelated providers; `SharedModule`/`CommonModule`/`CoreModule` imported by nearly every feature; module re-exporting imported modules wholesale; feature modules organised by type (`services.module.ts`).
- **Tool coverage:** none — judgement (count `exports` entries; fan-in of the module).
- **Why it hurts:** Every feature transitively depends on everything; change amplification; cycles emerge (NEST-01). Docs: feature modules keep "clear boundaries" and "each encapsulating a closely related set of capabilities".
- **Severity:** major when it drives cycles or forced global scope; minor otherwise.
- **Remediation:** split by capability (Extract Module); export only the module's public API (docs: exports "serve as the module's public interface or API"). — Trap: splitting into many tiny modules that still all import each other.
- **Not a finding when:** a thin infrastructure module with cohesive exports (e.g., `DatabaseModule` exporting a connection + repositories).
- **Architecture:** yes — escalate.
- **Sources:** https://docs.nestjs.com/modules

### NEST-06 Constructor over-injection (fat service) — invisible to parameter-count rules

- **Signal:** constructor with ≥6–7 injected `private readonly` dependencies; a service whose methods each use a disjoint subset of injections; >~500 LOC service; names like `UsersService` handling auth, billing, notifications.
- **Tool coverage:** partial/none: SonarQube S107 (default 7) **exempts all-parameter-property constructors** (SonarJS `S107/rule.ts`); ESLint core/typescript-eslint `max-params` do count them (UNVERIFIED — rule page not opened); `sonarjs/max-lines-per-function` S138 (200) and `sonarjs/cognitive-complexity` S3776 (15) catch symptoms per method, not class cohesion.
- **Why it hurts:** Low cohesion, many reasons to change, tests needing large mock setups (NEST-22), high merge-conflict rate.
- **Severity:** major.
- **Remediation:** Extract Class along the disjoint dependency clusters; application services per use case (Command handlers — `@nestjs/cqrs` if already adopted); Facade only if callers need one entry point. — Trap: hiding dependencies behind a "context" or `ModuleRef` to get the constructor short.
- **Not a finding when:** an orchestration/application service whose single job is coordinating several ports for one use case, with thin methods.
- **Architecture:** yes — responsibility boundaries; escalate to architect.
- **Sources:** https://github.com/SonarSource/SonarJS/tree/master/packages/analysis/src/jsts/rules/S107

### NEST-07 Request scope used casually (and its bubbling cost)

- **Signal:** `@Injectable({ scope: Scope.REQUEST })` on services; `@Inject(REQUEST)` in a widely-used provider (logger, repository, DB/tenant data source); `Scope.TRANSIENT` sprinkled for "safety".
- **Tool coverage:** none — judgement (grep `Scope.REQUEST`, `@Inject(REQUEST)`; then trace dependents).
- **Why it hurts:** Docs: "The `REQUEST` scope bubbles up the injection chain. A controller that depends on a request-scoped provider will, itself, be request-scoped." "for, say, 30k requests in parallel, there will be 30k ephemeral instances of the controller"; "Having a common provider that most providers depend on (think of a database connection, or a logger service), automatically converts all those providers to request-scoped". Also: lifecycle hooks "are not triggered for **request-scoped** classes"; "WebSocket gateways should not use request-scoped providers… also applies to… Passport strategies or Cron controllers"; "Event subscribers cannot be request-scoped"; `forwardRef` + REQUEST → undefined (NEST-01). Docs' own estimate: "should not slow down by more than ~5% latency-wise" when _properly designed_.
- **Severity:** major when on a hub provider (DB/logger/tenant); minor for a leaf used by one controller.
- **Remediation:** Singleton + pass request context explicitly as method arguments, or `AsyncLocalStorage`-backed context via `run()` (nodejs.md NODE-21) for cross-cutting data; for a small, fixed tenant set, **durable providers** with a `ContextIdStrategy` (docs warn "not ideal for applications operating with a large number of tenants"). — Trap: ALS carrying authorization-relevant tenant identity without `run()` isolation.
- **Not a finding when:** per-request DataLoader in GraphQL, or a leaf provider with measured acceptable cost.
- **Architecture:** yes — multi-tenancy isolation design; escalate.
- **Sources:** https://docs.nestjs.com/fundamentals/injection-scopes ; https://docs.nestjs.com/fundamentals/lifecycle-events ; https://docs.nestjs.com/techniques/events

### NEST-08 `import type` of DTOs / injected classes; interfaces as DI or validation types

- **Signal:** `import type { CreateUserDto }` used as `@Body() dto: CreateUserDto`; `import type { UsersService }` in a constructor; DTO declared as `interface`/`type`; `@Body() items: CreateUserDto[]`; generic DTOs.
- **Tool coverage:** partial: `typescript-eslint:consistent-type-imports` autofix _causes_ this bug in decorator-metadata code; tsc does not report it (compiles fine, fails at runtime).
- **Why it hurts:** Validation docs: "you can't use a type-only import as that would be erased at runtime". Pipes docs: "if a method parameter's type is declared as an interface instead of a class, the `metatype` value will be `Object`" → `ValidationPipe` skips validation. Validation docs: "TypeScript does not store metadata about generics or interfaces… `createUserDtos` won't be correctly validated" for `CreateUserDto[]`. For DI, a type-only import leaves `design:paramtypes` without the class → resolution error (derived from the same erasure).
- **Severity:** blocker for silently unvalidated bodies; major for DI boot failures (caught at startup).
- **Remediation:** value imports for DTO/provider classes; `ParseArrayPipe({ items: Dto })` or a wrapper class for arrays; or schema-first (`@Body({ schema })` + `StandardSchemaValidationPipe`, v12) which does not depend on emitted metadata. Configure `consistent-type-imports` with `fixStyle`/exclusions for Nest files or rely on `emitDecoratorMetadata`-aware settings (UNVERIFIED: typescript-eslint's decorator-metadata option not opened). — Trap: applying `erasableSyntaxOnly`/Node type-stripping (typescript.md TS-21) to a Nest app — decorators + metadata require a compiler.
- **Not a finding when:** type-only imports used solely in return types/interfaces not read by metadata.
- **Architecture:** no.
- **Sources:** https://docs.nestjs.com/techniques/validation ; https://docs.nestjs.com/pipes

---

## Layering: controllers, services, enhancers

### NEST-09 Business logic in controllers

- **Signal:** controller methods with branching domain rules, DB/ORM calls, transaction handling, multiple service calls stitched with conditionals, manual `try/catch` → status codes, `@Res()` response building.
- **Tool coverage:** none — judgement. Symptom metrics: `sonarjs/cognitive-complexity` S3776 > 15 inside a `@Controller` class.
- **Why it hurts:** Logic unreachable from other transports (queues, gRPC, CLI), untestable without HTTP, duplicated across endpoints. Pipes docs: validating inside the handler "would break the **single responsibility principle**".
- **Severity:** major.
- **Remediation:** Humble Object: controller maps transport ↔ application-service call; domain rules in services/policies (pure where possible); validation in pipes; errors as domain exceptions mapped by a filter. — Trap: moving the same tangle into a service without separating policy (pure) from orchestration (I/O).
- **Not a finding when:** trivial mapping (param extraction, DTO → command) and response shaping.
- **Architecture:** yes when transport concerns leak into domain (or vice versa).
- **Sources:** https://docs.nestjs.com/pipes ; https://docs.nestjs.com/controllers

### NEST-10 Enhancer in the wrong layer (middleware vs guard vs interceptor vs pipe vs filter)

- **Signal:** authorization in middleware (needs handler metadata it can't see); validation/transformation in guards or interceptors; auth decisions in interceptors; response mapping in controllers; logging in pipes; guards reading `req.body` fields assuming they're validated.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Order is fixed (request-lifecycle FAQ): middleware → guards → interceptors (pre) → pipes → handler → interceptors (post) → filters. Guards docs: middleware "is context-blind. It doesn't know which handler will be executed"; guards "are executed **after** all middleware, but **before** any interceptor or pipe" → **a guard sees the raw, unvalidated body**. Filters resolve route → controller → global and "exceptions cannot be passed from filter to filter". Middleware exceptions: "only **global** exception filters apply".
- **Severity:** major (blocker when authorization trusts unvalidated body fields).
- **Remediation:** Authentication (token → principal) in a global guard or middleware; authorization in guards using `Reflector` metadata; validation/coercion in pipes; cross-cutting timing/mapping/caching in interceptors; error → response mapping in filters. If authorization depends on body content, move that check into the service/policy after validation (Specification/Policy module). — Trap: `@Res()` in a handler disables interceptor response mapping (interceptors docs: "doesn't work with the library-specific response strategy").
- **Not a finding when:** body-parsing/helmet/cors/correlation-id as middleware (context-free concerns).
- **Architecture:** yes — request pipeline contract.
- **Sources:** https://docs.nestjs.com/faq/request-lifecycle ; https://docs.nestjs.com/guards ; https://docs.nestjs.com/interceptors ; https://docs.nestjs.com/exception-filters

### NEST-11 Protected-by-opt-in routes (no global auth guard)

- **Signal:** `@UseGuards(AuthGuard)` repeated on controllers with no `APP_GUARD`; new controllers without a guard; `@Public()` absent because default is public; microservice/gateway handlers in a hybrid app relying on `useGlobalGuards()`.
- **Tool coverage:** partial: `codeql:js/missing-rate-limiting` is unrelated; none for missing Nest guards — judgement (list controllers; diff against guarded set).
- **Why it hurts:** One forgotten decorator = unauthenticated endpoint. Docs recommend "register the authentication guard as a global guard… and instead… flag which routes should be public" (`getAllAndOverride(IS_PUBLIC_KEY, …)`). Guards docs: in hybrid apps `useGlobalGuards()` "doesn't set up guards for gateways and microservices by default"; guards from `useGlobalGuards()` "cannot inject dependencies".
- **Severity:** blocker (authz).
- **Remediation:** Secure-by-default: `APP_GUARD` auth guard + explicit `@Public()` metadata; a guard test that enumerates routes (via `DiscoveryService`/router explorer) and asserts each is guarded or explicitly public. — Trap: `getAllAndMerge`/`get` on handler only (missing class-level `@Public()`), or `@Public()` on a controller exposing every route.
- **Not a finding when:** an internal-only app behind an authenticating gateway **and** that is an explicit, documented trust decision.
- **Architecture:** yes — security boundary; escalate to security reviewer.
- **Sources:** https://docs.nestjs.com/security/authentication ; https://docs.nestjs.com/guards

### NEST-12 Global enhancers registered in `main.ts` (not tested, not injectable)

- **Signal:** `app.useGlobalPipes(new ValidationPipe(...))`, `app.useGlobalGuards(...)`, `app.useGlobalFilters(...)`, `app.useGlobalInterceptors(...)` in `main.ts`, while e2e tests build the app with `Test.createTestingModule(...).createNestApplication()`.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Testing docs' e2e setup is `moduleRef.createNestApplication(); await app.init();` — it never runs `main.ts`, and the testing chapter has no `useGlobal*` guidance (only "Overriding globally registered enhancers" for `APP_GUARD`-style registration). So e2e suites exercise the app **without** the validation pipe/guard/filter production uses — tests go green on unvalidated or unauthenticated routes. Also enhancers from `useGlobal*` "cannot inject dependencies"; `useGlobalFilters()` "does not set up filters for gateways or hybrid applications".
- **Severity:** major (blocker when authz/validation is only in `main.ts`).
- **Remediation:** Register as providers (`APP_PIPE`, `APP_GUARD`, `APP_FILTER`, `APP_INTERCEPTOR`) in the root/owning module — docs: "regardless of the module where this construction is employed, the [enhancer] is, in fact, global"; or extract a shared `configureApp(app)` used by both `main.ts` and tests. — Trap: `APP_GUARD` "is a pseudo-provider… cannot be retrieved later with `app.get()`"; override in tests with the documented technique.
- **Not a finding when:** a shared bootstrap function is demonstrably called by the e2e setup.
- **Architecture:** no (test-tier integrity).
- **Sources:** https://docs.nestjs.com/fundamentals/testing ; https://docs.nestjs.com/guards ; https://docs.nestjs.com/pipes ; https://docs.nestjs.com/exception-filters

### NEST-13 Heavy or blocking work in interceptors/guards/middleware

- **Signal:** DB lookups in a global interceptor for every request; synchronous crypto/JSON of full response bodies in interceptors (e.g., logging entire responses); guards calling remote auth services without caching/timeouts; `map()` deep-cloning responses.
- **Tool coverage:** none — judgement (see nodejs.md NODE-09/NODE-10).
- **Why it hurts:** Global enhancers multiply cost by every route; one slow dependency in a guard becomes an app-wide outage.
- **Severity:** major for global scope; minor for route scope.
- **Remediation:** scope the enhancer to routes that need it; cache verification keys (networkless JWT verification); log summaries; timeouts on remote calls. — Trap: RxJS `timeout()` in an interceptor that does not cancel the underlying I/O (see nodejs.md NODE-06).
- **Not a finding when:** cheap, bounded work (header reads, metadata lookups).
- **Architecture:** no (yes if auth depends on a synchronous remote call per request).
- **Sources:** https://docs.nestjs.com/interceptors

### NEST-14 Route shadowing on Express (`:id` before static paths)

- **Signal:** `@Get(':id')` declared above `@Get('me')`/`@Get('search')` in the same controller; controllers with overlapping prefixes; app not setting `routeConflictPolicy`.
- **Tool coverage:** Nest v12 opt-in bootstrap diagnostics: `routeConflictPolicy: { duplicate: 'error', shadow: 'warn' }`, `routeResolutionStrategy: 'specificity'` (defaults preserve old behaviour; on Fastify `shadow` is a no-op because `find-my-way` ranks by specificity).
- **Why it hurts:** Controllers docs: "a parametric route can silently shadow a more specific one… `@Get('me') // never reached`". Often only detected when `ParseIntPipe` rejects "me".
- **Severity:** major (endpoint unreachable).
- **Remediation:** enable `routeConflictPolicy` with `shadow: 'error'` in CI/boot; declare static routes first; constrain params (`ParseUUIDPipe`).
- **Not a finding when:** Fastify adapter (specificity-ranked) and no duplicates.
- **Architecture:** no.
- **Sources:** https://docs.nestjs.com/controllers ; https://docs.nestjs.com/migration-guide

---

## Validation & the wire contract

### NEST-15 `ValidationPipe` misconfiguration (mass assignment, silent passes)

- **Signal:** `new ValidationPipe()` without `whitelist: true`; `whitelist` without `forbidNonWhitelisted` on write endpoints; `forbidUnknownValues: false`; `skipMissingProperties: true` globally; `transformOptions: { enableImplicitConversion: true }`; `disableErrorMessages` absent in prod while messages include internals; DTO properties with no decorator.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Without `whitelist`, extra properties (`role`, `isAdmin`, `userId`) flow into `repository.save(dto)` (mass assignment). Docs: `whitelist` strips "properties that do not use any validation decorators" — an undecorated legitimate field is silently dropped too. class-validator README: `forbidUnknownValues` "is set to `true` by default and **it is highly advised to keep the default**. Setting it to `false` will result unknown objects passing the validation!" class-transformer README on implicit conversion: "If you use class-validator together with class-transformer you propably DON'T want to enable this function" — `{ prop: 1234 }` becomes `"1234"` and then passes `@IsString()`. `skipMissingProperties` skips "all properties that are null or undefined" — required fields become optional everywhere.
- **Severity:** blocker for mass assignment on write paths; major otherwise.
- **Remediation:** Global (provider-registered, NEST-12) `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`; explicit `@Type()`/`ParseIntPipe` for coercion; map DTO → domain command explicitly (never spread DTO into an entity). Or schema-first: `@Body({ schema })` + `StandardSchemaValidationPipe` (v12) with zod `.strict()` objects (zod API UNVERIFIED — not opened). — Trap: `PartialType(CreateDto)` for PATCH makes every field optional including ones that must never be patched; use `OmitType`/`PickType` (docs mapped types) and note `@nestjs/swagger`'s variants must be used in Swagger apps (docs warning).
- **Not a finding when:** a custom schema pipe with equivalent strictness is applied globally.
- **Architecture:** yes — wire contract strictness; escalate to API owner.
- **Sources:** https://docs.nestjs.com/techniques/validation ; https://github.com/typestack/class-validator ; https://github.com/typestack/class-transformer

### NEST-16 Nested / array DTOs not actually validated

- **Signal:** `@ValidateNested()` without `@Type(() => Child)`; nested object typed as interface; `@Body() dtos: Dto[]`; `@IsArray()` without `{ each: true }`/`@ValidateNested({ each: true })`; `Record<string, Dto>` bodies.
- **Tool coverage:** none — judgement.
- **Why it hurts:** class-validator: "nested object _must_ be an instance of a class, otherwise `@ValidateNested` won't know what class is target of validation" — without `@Type`, class-transformer leaves a plain object. Validation docs: array bodies of `CreateUserDto[]` "won't be correctly validated" (no generic metadata).
- **Severity:** blocker when nested data reaches persistence/authorization; major otherwise.
- **Remediation:** `@ValidateNested({ each: true }) @Type(() => Child)`; wrapper DTO class for arrays or `ParseArrayPipe({ items: Dto })`; add a negative test per nested DTO (invalid child → 400). — Trap: a passing happy-path test proves nothing here; the test must send an invalid nested value.
- **Not a finding when:** schema-first validation (zod/valibot) where nesting is explicit in the schema.
- **Architecture:** no.
- **Sources:** https://github.com/typestack/class-validator ; https://docs.nestjs.com/techniques/validation

### NEST-17 ORM entity / DB row returned to the wire (DTO–entity conflation) and deny-list serialization

- **Signal:** controllers returning repository/ORM results directly (`return this.repo.findOne(...)`); `@Exclude()` on entity fields as the only protection for secrets; `ClassSerializerInterceptor` applied while services return plain objects (Prisma/Drizzle/`pg` rows, TypeORM `getRawMany`, Mongoose `lean()`, spread copies `{ ...user }`); entities used as `@Body()` types.
- **Tool coverage:** none — judgement. (`codeql:js/stack-trace-exposure` is unrelated.)
- **Why it hurts:** Serialization docs: `ClassSerializerInterceptor` applies `instanceToPlain()`; "we must return an instance of the class. If you return a plain JavaScript object… the object won't be properly serialized" — so `@Exclude() password` silently **fails open** and the password hash ships, with tests green if they only assert status. The docs' own "Transform plain objects" example returns a plain literal containing `password: 'password'` — it is only stripped because `@SerializeOptions({ type: UserEntity })` is present. Wire shape coupled to schema: a migration renames a column and the public API changes. Entities as input = mass assignment (NEST-15).
- **Severity:** blocker when sensitive fields exist on the entity; major otherwise.
- **Remediation:** Allow-list response DTOs built by explicit mappers (Data Transfer Object + Mapper), or v12 `StandardSchemaSerializerInterceptor` + `@SerializeOptions({ schema })` (schema-driven, allow-list); if using `ClassSerializerInterceptor`, set `@SerializeOptions({ type: ResponseDto })` so plain objects are transformed into instances (docs "Transform plain objects" — verified form). Contract test asserting the exact response key set. — Trap: `const { password, ...rest } = user` per endpoint (the docs' auth sample) — the next new secret column leaks.
- **Not a finding when:** a read model/projection type that is itself the published contract.
- **Architecture:** yes — persistence/wire boundary; escalate to architect and security.
- **Sources:** https://docs.nestjs.com/techniques/serialization ; https://docs.nestjs.com/security/authentication

### NEST-18 Exception filters leaking internals / wrong mapping

- **Signal:** catch-all `@Catch()` filter returning `exception.message`/`stack`; third-party errors with `statusCode`+`message` (HTTP clients, `http-errors`, some SDKs) propagating uncaught; `throw new HttpException(err.message, 500)`; domain services throwing `HttpException`s; filters that swallow and return 200.
- **Tool coverage:** partial: `codeql:js/stack-trace-exposure` (CWE-209/497) where it can trace `err.stack` to a response.
- **Why it hurts:** Exception-filter docs: the global filter "partially supports the `http-errors` library… any thrown exception containing the `statusCode` and `message` properties will be properly populated and sent back as a response (instead of the default `InternalServerErrorException`)" — an upstream client error object can surface its **status and message** (possibly internal URLs/SQL) to your caller. Domain code throwing HTTP exceptions couples domain to transport and breaks non-HTTP consumers (microservices/queues).
- **Severity:** major (blocker when messages contain secrets/infrastructure detail).
- **Remediation:** Domain error hierarchy (custom `Error` + type guard) mapped to HTTP in one global filter (`APP_FILTER`); wrap third-party errors at the adapter (Anti-Corruption Layer) with `cause`; v12 `errorCode` for stable client branching (docs: `cause` "is never serialized", `errorCode` is). Note built-in `HttpException`s are **not logged** by default ("won't appear in the console") — log 5xx in the filter. — Trap: logging and rethrowing in every layer (nodejs.md NODE-15).
- **Not a finding when:** `HttpException` thrown in controllers/guards/pipes (transport layer).
- **Architecture:** yes — error contract; escalate.
- **Sources:** https://docs.nestjs.com/exception-filters

---

## Configuration & lifecycle

### NEST-19 `ConfigService.get` without validation / typed access; `process.env` in providers

- **Signal:** `this.config.get('DB_HOST')` (no generic, no `infer`) → `any`; `get(...)!`; `process.env[...]` inside providers/`registerAs` factories without parsing; `ConfigModule.forRoot()` without `validationSchema`/`validate`; custom `load: [...]` files assumed validated; `forFeature` config read in constructors.
- **Tool coverage:** partial: `typescript-eslint:no-unsafe-assignment`/`no-unsafe-member-access` flag the `any` returned by `get<T = any>`; `n:no-process-env`.
- **Why it hurts:** `@nestjs/config` 12.0.0 `.d.ts`: `get<T = any>(propertyPath)` and `getOrThrow<T = any>(propertyPath): Exclude<T, undefined>` — both default to `any`. Docs: "configuration files aren't automatically validated, even if you're using the `validationSchema` option"; `forFeature` "run during module initialization, and the order of module initialization is indeterminate… access… using the `onModuleInit()` hook, rather than in a constructor". Unknown env vars pass by default (docs).
- **Severity:** major.
- **Remediation:** `validationSchema` (Standard Schema/zod in v12) failing at bootstrap; typed namespaced config via `registerAs` + `ConfigType<typeof dbConfig>` injection (docs) with parsing inside the factory; `getOrThrow<T>` with an explicit type or `{ infer: true }` over a typed `ConfigService<Env, true>`; `skipProcessEnv` if config should come only from validated files. — Trap: `parseInt(process.env.PORT, 10) || 3000` (docs sample) turns a typo into a silent default.
- **Not a finding when:** a single typed config provider that already parses and is injected.
- **Architecture:** yes — config contract (nodejs.md NODE-22).
- **Sources:** https://docs.nestjs.com/techniques/configuration ; https://www.npmjs.com/package/@nestjs/config

### NEST-20 Heavy or order-dependent I/O in `onModuleInit`/`onApplicationBootstrap`; hook reliance on request-scoped classes

- **Signal:** migrations, cache warm-ups, remote fetches, or queue subscriptions in `onModuleInit` without timeouts; hooks that assume another module's hook already ran; lifecycle hooks on request-scoped providers; events emitted from `onModuleInit`.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Docs: hooks "defer the application initialization process" (async awaited) — a hung remote call blocks boot indefinitely → failed health checks/crash loops. Order: lifecycle page says init order "directly depends on the order of module imports"; v12 migration says hooks now run "by component hierarchy level" — reliance breaks across upgrades. Hooks "are not triggered for **request-scoped** classes". Events docs: events emitted "before or during the `onApplicationBootstrap` lifecycle hook… may be missed" (use `EventEmitterReadinessWatcher.waitUntilReady()`).
- **Severity:** major.
- **Remediation:** timeouts + retries with backoff for boot dependencies; migrations as a separate pipeline step, not app boot; explicit dependency (inject the provider whose readiness you need, expose `ready()` promise) instead of hook ordering; readiness probe separate from liveness. — Trap: moving the work to a fire-and-forget promise in the hook (nodejs.md NODE-01).
- **Not a finding when:** fast, local initialisation (compiling a regex, building a lookup map).
- **Architecture:** yes when schema migration happens at app boot (deployment ordering).
- **Sources:** https://docs.nestjs.com/fundamentals/lifecycle-events ; https://docs.nestjs.com/migration-guide ; https://docs.nestjs.com/techniques/events

### NEST-21 Missing `enableShutdownHooks()` / resources not released on shutdown

- **Signal:** server `main.ts` without `app.enableShutdownHooks()`; pools/consumers/intervals created in providers with no `onModuleDestroy`/`onApplicationShutdown`; shutdown hooks awaiting unbounded operations; custom `process.on('SIGTERM')` alongside Nest's.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Docs: shutdown hooks "are disabled by default… you **must enable listeners** by calling `enableShutdownHooks()`"; without it `onModuleDestroy`/`beforeApplicationShutdown`/`onApplicationShutdown` don't run on SIGTERM → dropped in-flight work, unreleased connections. "If a registered function awaits an asynchronous call… Nest will not continue in the sequence until the promise is resolved or rejected" — no built-in timeout, so a hung hook waits for SIGKILL. "Calling `app.close()` doesn't terminate the Node process… if there are some intervals, long-running background tasks… the process won't be automatically terminated." Node: installing a SIGTERM listener removes the default exit (nodejs.md NODE-25).
- **Severity:** major.
- **Remediation:** `enableShutdownHooks()` in `main.ts`; implement `onModuleDestroy` for every owned resource (pool `end()`, consumer `close()`, `clearInterval`); wrap each hook in a deadline; v12 Express adapter drains in-flight requests on shutdown — verify LB deregistration delay ≥ drain time. — Trap: docs note `enableShutdownHooks` "consumes memory by starting listeners" — in parallel test runs with many apps in one process, enable it only in `main.ts`, not in test bootstraps.
- **Not a finding when:** Lambda/serverless handler bootstraps (different lifecycle), or standalone scripts that call `app.close()` and exit.
- **Architecture:** yes — deployment contract (SRE).
- **Sources:** https://docs.nestjs.com/fundamentals/lifecycle-events ; https://docs.nestjs.com/migration-guide

---

## Testing anti-patterns

### NEST-22 TestingModule where everything is mocked (tests test the mocks)

- **Signal:** `Test.createTestingModule({ providers: [SUT, { provide: A, useValue: mockA }, …] })` with every collaborator mocked; `.useMocker(() => vi.fn())` auto-mocking all dependencies; assertions only on `toHaveBeenCalledWith` of mocks; `overrideProvider(RealRepo)` in "integration"/e2e suites; e2e suites overriding guards to always pass.
- **Tool coverage:** none — judgement (mutation testing would expose it; Stryker — UNVERIFIED, not opened).
- **Why it hurts:** A service whose only logic is orchestration, tested by mocking every port, verifies the call sequence the implementation already encodes — it passes when the SQL, the wire shape, or the authorization is wrong. Auto-mocking hides new dependencies from review. Overriding the auth guard in e2e removes the one tier that proves authz.
- **Severity:** major (blocker when it's the only test for authz/persistence behaviour).
- **Remediation:** Unit-test pure policies/domain functions without Nest at all (docs: "isolated testing… independent from the framework"); integration-test services against a real DB (Testcontainers/Docker) with only true external systems faked; e2e via `createNestApplication()` with real guards/pipes and test tokens; fakes (in-memory implementations of a port) over call-assertion mocks. — Trap: e2e setup that omits `main.ts` global enhancers (NEST-12).
- **Not a finding when:** mocking a genuinely external boundary (third-party HTTP, clock, random) in a unit test that asserts outcomes, not calls.
- **Architecture:** no (test strategy; escalate to QA owner if systemic).
- **Sources:** https://docs.nestjs.com/fundamentals/testing

### NEST-23 Misusing `resolve()` / scoped providers in tests

- **Signal:** `await moduleRef.resolve(Service)` called in `beforeEach` and again in the test, then asserting on different instances; `get()` of a scoped provider throwing; spying on one instance while the SUT uses another.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Testing docs: "The `resolve()` method returns a unique instance of the provider, from its own **DI container sub-tree**… if you call this method more than once… they are not equal." Spies attach to the wrong instance → false greens/reds.
- **Severity:** minor.
- **Remediation:** create one `contextId` (`ContextIdFactory.create()`) and pass it to every `resolve()`; or avoid request scope (NEST-07).
- **Not a finding when:** singleton providers via `get()`.
- **Architecture:** no.
- **Sources:** https://docs.nestjs.com/fundamentals/testing ; https://docs.nestjs.com/fundamentals/module-ref

---

## Data, events, messaging

### NEST-24 Transactions spanning services / leaking `QueryRunner`/`EntityManager` through APIs

- **Signal:** `queryRunner`/`manager`/`tx` passed as a parameter through several services; one service method calling two others that each open their own transaction; HTTP/queue calls inside an open transaction; distributed "transaction" across two Nest microservices; `synchronize: true` in TypeORM config for non-local stages.
- **Tool coverage:** none — judgement.
- **Why it hurts:** SQL docs recommend `QueryRunner` for "full control", and suggest a `QueryRunnerFactory` interface for testability — but a runner threaded through APIs makes every signature persistence-aware; nested independent transactions break atomicity; external calls inside a transaction hold locks for network time. SQL docs: "`synchronize: true` shouldn't be used in production - otherwise you can lose production data."
- **Severity:** major (blocker for `synchronize: true` outside local, and for money/data-integrity atomicity gaps).
- **Remediation:** Unit of Work at the application-service boundary (one transaction per use case) with repositories receiving the transaction via a scoped context (e.g., a transactional-context library using ALS — UNVERIFIED which, not opened) or explicit `tx` confined to the repository layer; Outbox pattern for side effects after commit; sagas/compensation across services. — Trap: request-scoped "transaction" providers (NEST-07 cost + hooks don't run).
- **Not a finding when:** a single repository method using a local transaction.
- **Architecture:** yes — consistency boundaries; escalate to architect/data owner.
- **Sources:** https://docs.nestjs.com/techniques/database

### NEST-25 `@nestjs/event-emitter` misuse (swallowed listener errors, events as hidden control flow)

- **Signal:** `@OnEvent('x')` listeners doing critical work (payments, persistence) with default options; `emit()` results assumed to have completed; business flows split across emit/listen pairs in the same process with no durability; `{ async: true }` listeners with no error handling; request-scoped listeners.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Events docs (`OnEventOptions` JSDoc): `suppressErrors` — "If 'true', the onEvent callback will not throw an error while handling the event" — **`@default true`**: a failing listener is silently swallowed by default. "Event subscribers cannot be request-scoped." Events emitted before `onApplicationBootstrap` "may be missed". In-process events vanish on crash/deploy (no retry, no durability) and make flow untraceable from the emitter.
- **Severity:** major (blocker if the listener carries a required side effect like persistence/billing).
- **Remediation:** direct method calls for required steps; in-process events only for optional, idempotent side effects with explicit error logging/metrics; durable queue (BullMQ) or Outbox for must-happen work; name events as past-tense domain events with typed payload classes. — Trap: setting `suppressErrors: false` and letting the error propagate into the _emitter's_ request — decide which failure semantics you want.
- **Not a finding when:** telemetry/cache-invalidation listeners where loss is acceptable and documented.
- **Architecture:** yes — synchronous vs asynchronous boundary; escalate.
- **Sources:** https://docs.nestjs.com/techniques/events

### NEST-26 Microservice client calls: cold `send()`, no timeout, no error mapping

- **Signal:** `this.client.send(pattern, data)` returned/stored without `lastValueFrom`/subscribe; `send` without `.pipe(timeout(ms))`; `emit()` used where a reply is needed (or `send` for fire-and-forget); `RpcException` details exposed to HTTP clients.
- **Tool coverage:** partial: `typescript-eslint:no-floating-promises` does **not** see Observables; none otherwise.
- **Why it hurts:** Microservices docs: `send()` "returns a **cold `Observable`**, which means that you have to explicitly subscribe to it before the message will be sent"; `emit()` returns "a **hot `Observable`**… the proxy will immediately attempt to deliver". Docs: "To prevent indefinitely long waiting, you can use timeouts" via RxJS `timeout` — i.e., none by default.
- **Severity:** major (message never sent; or request hangs).
- **Remediation:** `await lastValueFrom(client.send(p, d).pipe(timeout(ms)))` (rxjs API UNVERIFIED — not opened); map transport errors at the client adapter; idempotent handlers for at-least-once transports. — Trap: `timeout` does not cancel remote work — handlers must tolerate duplicates/late completion.
- **Not a finding when:** controller returns the Observable directly to Nest, which subscribes.
- **Architecture:** yes — inter-service contract (sync RPC vs events).
- **Sources:** https://docs.nestjs.com/microservices/basics

### NEST-27 Queue consumers: concurrency and DI assumptions

- **Signal:** multiple Bull `@Process()` handlers for one queue with `concurrency: 1` expected; sandboxed (forked) processors importing injected services; request-scoped processors on hot queues.
- **Tool coverage:** none — judgement.
- **Why it hurts:** Queues docs (Bull): "When defining multiple consumers for the same queue, the `concurrency` option in `@Process({ concurrency: 1 })` won't take effect. The minimum `concurrency` will match the number of consumers defined." Separate-process processors: "Dependency Injection (and IoC container) won't be available." Request-scoped consumers: "a new instance… for each job".
- **Severity:** major where serialized processing is a correctness requirement.
- **Remediation:** one processor per queue with explicit concurrency; idempotency keys; BullMQ worker options (docs: BullMQ differs — read its section). — Trap: relying on concurrency=1 as a lock; use a real lock or partitioned queue.
- **Not a finding when:** handlers are idempotent and order-independent.
- **Architecture:** no (yes when ordering is a domain invariant).
- **Sources:** https://docs.nestjs.com/techniques/queues

---

## Security defaults (quality flags that escalate)

### NEST-28 `helmet`/`cors` registered after routes or with permissive defaults

- **Signal:** `app.enableCors()` with no options (or `origin: true`/`'*'` with `credentials: true`); `app.use(helmet())` after other `app.use()`/route registration; helmet with `contentSecurityPolicy: false`/`frameguard: false`; Apollo-sandbox CSP relaxations copied to production.
- **Tool coverage:** `semgrep:typescript.nestjs.security.audit.nestjs-header-cors-any.nestjs-header-cors-any` (CWE-183), `semgrep:typescript.nestjs.security.audit.nestjs-header-xss-disabled.nestjs-header-xss-disabled` (CWE-79); `codeql:js/cors-permissive-configuration` (CWE-942), `codeql:js/cors-misconfiguration-for-credentials` (CWE-346/639/942), `codeql:js/insecure-helmet-configuration` (CWE-693/1021). partial: ordering is judgement.
- **Why it hurts:** Helmet docs: helmet "must come before other calls to `app.use()`… If you use middleware like `helmet` or `cors` after you define a route, then that middleware will not apply to that route". The docs' Apollo sample sets `scriptSrc: [... "https: 'unsafe-inline'"]` — fine for a sandbox, a CSP hole in production.
- **Severity:** major (blocker for credentialed wildcard/reflected CORS).
- **Remediation:** explicit origin allowlist from validated config; helmet first; environment-specific CSP; a test asserting security headers on a real route.
- **Not a finding when:** a pure server-to-server API not called from browsers, with CORS intentionally disabled.
- **Architecture:** yes — browser trust boundary; escalate to security.
- **Sources:** https://docs.nestjs.com/security/helmet ; https://docs.nestjs.com/security/cors

### NEST-29 Throttling that doesn't throttle (in-memory storage, proxy IPs, per-IP identity)

- **Signal:** `ThrottlerModule.forRoot` with default storage in a multi-replica deployment; app behind ALB/NGINX without `trust proxy`; throttler keyed by IP on authenticated APIs; `@SkipThrottle()` on auth endpoints; no throttling on login/OTP/reset endpoints.
- **Tool coverage:** `codeql:js/missing-rate-limiting` (CWE-770/307/400) recognises some rate-limit middleware (may not model `ThrottlerGuard` — UNVERIFIED); otherwise judgement.
- **Why it hurts:** Rate-limiting docs: "The built in storage is an in memory cache" → effective limit = limit × replicas and resets on deploy; "For distributed servers you could use the community storage provider for Redis". "If your application is running behind a proxy server, it's essential to configure the HTTP adapter to trust the proxy" — otherwise every client shares the LB's IP (one user throttles everyone) or, if `X-Forwarded-For` is trusted blindly, attackers spoof IPs.
- **Severity:** major (blocker for brute-forceable auth endpoints).
- **Remediation:** shared storage; `trust proxy` set to the exact hop count/LB CIDR (not `true`); key by user/principal for authenticated routes via a custom `getTracker`; multiple named throttlers for burst + sustained. — Trap: `trust proxy: true` behind a single LB lets clients spoof via `X-Forwarded-For` (Express behaviour — UNVERIFIED, express guide not opened).
- **Not a finding when:** rate limiting enforced at the edge (WAF/API gateway) and documented.
- **Architecture:** yes — abuse-prevention layer placement; escalate.
- **Sources:** https://docs.nestjs.com/security/rate-limiting

### NEST-30 Authorization only at the route level (no resource-level check)

- **Signal:** `@Roles('admin')` guards but services load resources by `id` from params without checking ownership/tenant; `RolesGuard` as the only authorization; permission checks duplicated ad hoc in services.
- **Tool coverage:** partial: `codeql:js/user-controlled-bypass` (CWE-807/290, extended suite) for checks based on user-controlled data; IDOR otherwise judgement.
- **Why it hurts:** Authorization docs: the basic RBAC example "only check[s] for the presence of roles on the route handler level. In real-world applications… you'll have to provide a mechanism to check roles somewhere within your business-logic… no centralized place that associates permissions with specific actions." Result: IDOR (read/modify other users' records).
- **Severity:** blocker.
- **Remediation:** Policy/Specification module (pure `can(principal, action, resource)`) invoked in the application service after loading the resource, or CASL abilities (docs); queries scoped by principal (`WHERE owner_id = $caller`) so "zero rows" is the denial; tests per role × ownership. — Trap: resource-level checks in a guard that re-queries the DB (double load, TOCTOU) — keep the check where the resource is loaded.
- **Not a finding when:** truly global admin-only endpoints with no per-resource dimension.
- **Architecture:** yes — authorization model; escalate to security/architect.
- **Sources:** https://docs.nestjs.com/security/authorization

### NEST-31 `@Res()` library-specific responses

- **Signal:** `@Res() res: Response` with `res.status().json()` in handlers; `@Res()` injected only to set a cookie/header without `passthrough: true`.
- **Tool coverage:** none — judgement (grep `@Res()` without `passthrough`).
- **Why it hurts:** Controllers docs: when `@Res()`/`@Next()` is used, "the Standard approach is **automatically disabled** for this single route" — interceptors' response mapping (and therefore serializers, NEST-17) don't apply; forgetting to send hangs the request; Express/Fastify lock-in.
- **Severity:** major when combined with serialization-based field exclusion; minor otherwise.
- **Remediation:** return values; `@Res({ passthrough: true })` for headers/cookies; `StreamableFile` for files (note serialization "does not apply to StreamableFile").
- **Not a finding when:** streaming/SSE or adapter-specific features that require the raw response, isolated in one controller.
- **Architecture:** no.
- **Sources:** https://docs.nestjs.com/controllers ; https://docs.nestjs.com/techniques/serialization

### NEST-32 Structured logger params and request logging leaking PII/secrets (v12)

- **Signal:** `logger.log('msg', user)` / `{ email, token }` objects passed as params; logging `request.headers`/`body` in interceptors/middleware; `json: true` logs shipped to third-party sinks without redaction.
- **Tool coverage:** `codeql:js/clear-text-logging` (CWE-312/359/532) when it can identify sensitive sources; partial.
- **Why it hurts:** v12 migration: `ConsoleLogger` "now treats plain objects passed after the message as structured params attached to the same log entry… on by default" — objects that previously printed as separate records now land in structured, indexed log fields (the migration guide's own example logs `email`). Built-in `HttpException`s are not logged by default, so teams add verbose request logging that captures bodies.
- **Severity:** major (blocker for credentials/tokens).
- **Remediation:** allow-listed log fields; redaction in the logger adapter; log IDs, not entities; `structuredParams: false` only as a stopgap.
- **Not a finding when:** params are non-sensitive identifiers.
- **Architecture:** yes — data classification policy; escalate to security.
- **Sources:** https://docs.nestjs.com/migration-guide ; https://docs.nestjs.com/techniques/logger ; https://docs.nestjs.com/exception-filters

---

## Security-hygiene overlap

| Smell (entry)                                                                                | CWE                                                                                    | CodeQL / Semgrep                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routes public by default / missing global guard (NEST-11), guards in hybrid apps not applied | CWE-862 Missing Authorization; CWE-306 Missing Authentication for Critical Function    | none — judgement                                                                                                                                                                                                                                                                                                                    |
| Resource-level authorization missing (NEST-30)                                               | CWE-639 Authorization Bypass Through User-Controlled Key; CWE-807                      | `codeql:js/user-controlled-bypass` (extended)                                                                                                                                                                                                                                                                                       |
| Mass assignment via DTO/entity (NEST-15, NEST-17)                                            | CWE-915 Improperly Controlled Modification of Dynamically-Determined Object Attributes | none — judgement                                                                                                                                                                                                                                                                                                                    |
| Nested/array DTOs unvalidated; interface/`import type` DTOs (NEST-08, NEST-16)               | CWE-20 Improper Input Validation                                                       | none — judgement                                                                                                                                                                                                                                                                                                                    |
| Sensitive fields serialized (plain object bypasses `@Exclude`) (NEST-17)                     | CWE-200 Exposure of Sensitive Information; CWE-213                                     | none — judgement                                                                                                                                                                                                                                                                                                                    |
| Error details / upstream `statusCode`+`message` leaked (NEST-18)                             | CWE-209, CWE-497                                                                       | `codeql:js/stack-trace-exposure`                                                                                                                                                                                                                                                                                                    |
| Permissive CORS / helmet disabled or misordered (NEST-28)                                    | CWE-942, CWE-346, CWE-693, CWE-1021, CWE-183                                           | `codeql:js/cors-permissive-configuration`, `codeql:js/cors-misconfiguration-for-credentials`, `codeql:js/insecure-helmet-configuration`; `semgrep:typescript.nestjs.security.audit.nestjs-header-cors-any.nestjs-header-cors-any`, `semgrep:typescript.nestjs.security.audit.nestjs-header-xss-disabled.nestjs-header-xss-disabled` |
| Open redirect via `@Redirect`/`res.redirect` with input                                      | CWE-601                                                                                | `semgrep:typescript.nestjs.security.audit.nestjs-open-redirect.nestjs-open-redirect`; `codeql:js/server-side-unvalidated-url-redirection`                                                                                                                                                                                           |
| Ineffective throttling (NEST-29)                                                             | CWE-770, CWE-307                                                                       | `codeql:js/missing-rate-limiting`                                                                                                                                                                                                                                                                                                   |
| JWT verification misconfigured (e.g., falsy secret) in auth guards                           | CWE-347                                                                                | `codeql:js/jwt-missing-verification`                                                                                                                                                                                                                                                                                                |
| Tenant/identity leaking across requests via scope/ALS misuse (NEST-07)                       | CWE-488 Exposure of Data Element to Wrong Session (agent mapping — UNVERIFIED)         | none — judgement                                                                                                                                                                                                                                                                                                                    |
| PII/secrets in structured logs (NEST-32)                                                     | CWE-532, CWE-312                                                                       | `codeql:js/clear-text-logging`                                                                                                                                                                                                                                                                                                      |
| `synchronize: true` in production ORM config (NEST-24)                                       | CWE-1188 Insecure Default Initialization (agent mapping — UNVERIFIED)                  | none — judgement                                                                                                                                                                                                                                                                                                                    |

## Open questions / unverified

1. The e2e-skips-`main.ts`-enhancers conclusion (NEST-12) is derived from the testing chapter's setup code plus the absence of any `useGlobal*` mention in `fundamentals/unit-testing.md`; no doc sentence states it outright.
2. Whether ESLint core / typescript-eslint `max-params` count parameter-property constructors (NEST-06) — rule pages not opened.
3. rxjs `lastValueFrom`/`timeout` signatures, zod `.strict()`, Stryker, transactional-context libraries (e.g. ALS-based), Express `trust proxy` spoofing semantics — named but not opened.
4. `codeql:js/missing-rate-limiting` modelling of `@nestjs/throttler` — not verified.
5. Lifecycle-hook ordering: the lifecycle-events page ("order of module imports") and the v12 migration guide ("by component hierarchy level") disagree; treat any order dependence as fragile.
6. typescript-eslint option to make `consistent-type-imports` decorator-metadata-aware — not opened (NEST-08).
7. CWE-488 and CWE-1188 mappings are the agent's, not tool metadata.
8. Semgrep dotted registry IDs are formed from `<path>.<id>` in the opened YAML files; not confirmed on semgrep.dev.
9. The v12 docs (`docs.nestjs.com` master, 2026-09-11) were read from the repository markdown; the live site may differ slightly in page slugs (e.g., `/fundamentals/testing` vs file `unit-testing.md`, `/techniques/database` vs `sql.md`, `/migration-guide` vs `migration.md`) — slugs not individually fetched; an HTTP check was attempted and is inconclusive (the site returns 200 for unknown paths).
