# 0011 — Every HTTP endpoint is canonically `/api/{version}/*`, with the bare `/{version}/*` kept as a deprecated alias

- **Status**: Accepted
- **Date**: 2026-08-02
- **Drivers**: `specs/governance-rules.md` **GR-002 — API URL Prefix Standard** (severity CRITICAL), which has mandated `/api/v{N}/{resource}` since 2026-05-10 while the shipped services served the bare `/v1/*`
- **Relates to**: [ADR-0003](0003-shared-alb-per-stage.md) (host-based ALB routing — unaffected by path changes), [ADR-0010](0010-ensure-exists-per-pr-deploy-gate.md) (the deploy gate that can skip a service and still smoke it)

## Context

Three deployable HTTP services — identity, food, recipe — served every versioned endpoint at a bare
`/v1/*` path (`/v1/users/me`, `/v1/foods/search`, `/v1/recipes`), and the Clerk webhook answered at
`POST /v1/webhooks/users`. Meanwhile `specs/governance-rules.md` GR-002 already declared the canonical
shape to be `/api/v{N}/{resource-path}`, with both segments required, and features 011 and 014 were
designed and specified against `/api/v1/*`. The code and the governing rule disagreed, and every new
feature had to pick a side.

The obvious fix — rename `/v1/*` to `/api/v1/*` — is unsafe, because **not every consumer of the old paths
lives in this repository**:

- **`POST /v1/webhooks/users` is registered in the Clerk dashboard.** A hard rename returns 404 to every
  `user.created` / `user.updated` / `user.deleted` callback. Nothing in this repo fails: the deploy is
  green, no alarm fires, and the only symptom is users quietly not appearing in RDS. This is the single
  most dangerous edge of the change.
- **Already-shipped mobile builds and cached web bundles have their endpoints inlined at build time**
  (`NEXT_PUBLIC_*` / Expo env are baked into the artifact). Those clients keep dialing `/v1/*` until users
  update, which we do not control.
- **Services call each other.** The identity deletion-worker and erasure-reconciliation Lambdas `POST` to
  recipe's and food's `/v1/internal/account/erasure`, and those five deployables ship independently.

## Decision

1. **`/api/{version}/*` is the canonical path** for every versioned endpoint in every service.

    One deliberate exception exists: the analytics ingest door is mounted at
    `@Controller('ingest/v1/events')` (`packages/services/recipe-service/src/analytics/ingest.controller.ts`),
    outside the `/api` namespace on purpose — [ADR-0030](0030-first-party-analytics-events.md) records why,
    noting that the contract parity filter admits only `health` and `api/*`. It must not be "fixed" to
    `/api/v1/*` without reading that ADR.

    Endpoints created after this ADR carry the canonical path ONLY and no alias — e.g.
    `@Controller('api/v1/recipe-parse-jobs')`. That is decision 4 working as intended, not a gap in
    decision 2.

2. **The bare `/{version}/*` path is retained as a DEPRECATED ALIAS.** It is not dead code and must not be
   "tidied away". Each alias site carries a comment saying so and pointing here.
3. **`/health` and `/health/ready` stay at the origin root, unprefixed.** They are not API surface: the
   shared-ALB target-group health check, the ECS container health check, the prod/sandbox deploy smoke
   steps, and the CI local-boot waits all dial `/health` at the root.
4. **Clients, tests, k6 scripts and contracts use the canonical path only.** The alias exists for consumers
   we cannot redeploy, not as a choice new code gets to make.

### How it is implemented

- **NestJS services** — each controller declares both paths, canonical first:
  `@Controller(['api/v1/users', 'v1/users'])`. Nest's `@Controller` accepts `string | string[]`.

    This is deliberately NOT `setGlobalPrefix('api')`. A global prefix cannot express the alias, so it would
    need a second mechanism (a URL-rewrite middleware) alongside it. Worse, `setGlobalPrefix` is an
    **app-level** call in `main.ts`, whereas every e2e suite boots through `bootServiceApp`
    (`@kitchensink/service-test-harness`), which calls `NestFactory.create` directly and would therefore
    test a different route table from the one production serves. Declaring paths on the controller keeps
    routing in the module graph, so production and every test tier resolve identically.

- **`recipe-service` `AuthMiddleware` exclusions list BOTH spellings** of the internal erasure route. The
  Clerk middleware would 401 a machine token before `ServiceErasureGuard` runs, so the path is excluded —
  and an exclusion covering only one spelling silently fail-closes the other, blocking GDPR Art. 17
  erasure on whichever path the caller happened to use.

- **The Clerk webhook's prefix lives in API Gateway, not the Lambda.** The public path is
  (custom-domain base path) + (resource path `webhooks/users`). As originally shipped, two mappings pointed at
  the same stage: `api/v1` (canonical) and `v1` (alias). **The `v1` alias was retired on 2026-08-07 — see the
  Update below; only `api/v1` remains.** The canonical one is multi-level, which
  `AWS::ApiGateway::BasePathMapping` rejects, so it goes through `DomainName.addApiMapping` →
  `AWS::ApiGatewayV2::ApiMapping`. AWS permits that only on a **REGIONAL** domain with a **TLS 1.2+**
  security policy; both already hold and are asserted in the stack's tests.

- **The deployed smoke probes canonical, then falls back to the alias.** `deployedSmoke.ts` checks the food
  origin from the recipe deploy, but food deploys independently and ADR-0010's gate may skip it entirely.
  A food service predating this change answers an app-level 404 on `/api/v1/foods/search` while still
  serving `/v1/foods/search`. That is a version skew, not an outage, so the probe retries the alias and
  reports a **passing warning** rather than failing the deploy.

## Consequences

- Both paths are live, so the routing table roughly doubles in size. That is the price of not breaking
  out-of-repo consumers, and it is bounded: the alias is a fixed set that only ever shrinks.
- The alias is a real, routable surface, so it inherits every guarantee of the canonical path. Auth,
  validation and rate limiting are enforced identically — pinned by tests, including path-traversal cases
  that assert the alias is not an auth bypass.
- Route-path contract tests per service pin canonical-first ordering, alias retention, and `/health`
  remaining unprefixed. An HTTP-level suite additionally proves the alias round-trips with the same status
  and validation behaviour as canonical, and that `/api/health` does **not** exist.

## Retiring the alias — the order is not optional

Removing `/{version}/*` is a separate, later change, and it is **not one batch**: the four deletions in
step 4 do not share a consumer. The webhook half and the service half retire independently.

**The webhook half has retired.** The `v1` base-path mapping on the webhook API is gone. Steps 2 and 3
never applied to it: the webhook path's only caller is Clerk's svix sender, so "clients with inlined
endpoints" — the reason those steps exist — cannot keep it alive. Step 1's precondition was measured
rather than assumed, by adding `$context.path` and `$context.domainName` to the gateway stage's
access-log format (`$context.resourcePath` is `/webhooks/users` for BOTH mappings, so a real delivery
was unattributable) and then driving a `user.created`/`user.deleted` pair against each Clerk instance:
3/3 deliveries on `/api/v1/webhooks/users` for both prod and sandbox, 0 on `/v1/...`. Svix posts to one
configured URL per endpoint rather than distributing across paths, so 3/3 identifies the configured URL
rather than sampling it. `WebhooksStack.test.ts` asserts exactly one base-path mapping.

**The service half still stands.** The bare `/{version}/*` aliases on the identity, food and recipe
services, the middleware exclusion's legacy entry, and the smoke's `LEGACY_FOOD_SEARCH_PATH` fallback all
have in-the-wild clients with build-time-inlined endpoints, so steps 2 and 3 remain unsatisfied for them.
Retiring those **requires**, in this order:

1. **Repoint the Clerk dashboard webhook endpoint** to the `/api/v1/webhooks/users` URL and let in-flight
   svix retries drain. Until this is done, deleting the `v1` base-path mapping silently breaks user sync.
2. Confirm no mobile build still in the wild dials `/v1/*` (check minimum supported build), and that no
   cached web bundle is still being served.
3. Confirm every service is deployed at or past this change, so no service-to-service caller needs the
   alias.
4. Only then delete the alias paths, the `v1` base-path mapping, the middleware exclusion's legacy entry,
   and the smoke's `LEGACY_FOOD_SEARCH_PATH` fallback.

## Consequences

- Two paths serve every pre-existing versioned endpoint until the alias retires, and the alias is load-bearing
  rather than dead code — an agent "tidying" it strands shipped mobile builds and cached web bundles.
- **Residual risk on the retired webhook mapping:** a second, currently-idle svix endpoint configured at
  `/v1` would have been invisible to the method above. If user sync stops, a `404` on `/v1/webhooks/users`
  is the signature — check the Clerk dashboard's endpoint list first.
- **A clean `cdk diff` is not proof that a stage's access-log format matches.** Against the un-instrumented
  sandbox stack, `cdk diff` listed only Lambda code and `SENTRY_RELEASE` deltas and reported no
  `AWS::ApiGateway::Stage` change, while the synthesized and deployed templates demonstrably differed on
  `AccessLogSetting.Format` — and the deploy then applied it. Read the format from
  `aws apigateway get-stage`, which is ground truth.

## Alternatives rejected

- **Hard rename, no alias.** Breaks the Clerk webhook silently and strands shipped mobile builds. Rejected
  outright.
- **`setGlobalPrefix('api', { exclude: ['health'] })` plus a legacy rewrite middleware.** Two mechanisms
  instead of one, and the prefix would be invisible to every e2e suite because they bypass `main.ts`. See
  above.
- **Keep the bare `/v1/*` as canonical and change GR-002 instead.** Would require rewriting features 011
  and 014, which are already specified against `/api/v1/*`, and abandons the `/api` namespace that keeps
  API routes distinguishable from front-end and framework routes.
- **Version via header or `Accept` negotiation.** A much larger change to every client, with no bearing on
  the problem GR-002 exists to solve (path collisions between API and non-API routes).
