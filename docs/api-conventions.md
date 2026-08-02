# API Conventions

The shared HTTP conventions every KitchenSink service follows. This document satisfies
`specs/governance-rules.md` **GR-002 / AC-002-d**; the rule itself is the normative source, and
[ADR-0011](architecture/decisions/0011-api-version-prefix.md) records how and why the platform got here.

## 1. URL shape

```
{protocol}://{host}[:{port}]/api/v{N}/{resource-path}
```

Both the `/api` segment and the `/v{N}` version segment are **required**. Neither may be omitted.

| Correct                                | Wrong                | Why wrong                      |
| -------------------------------------- | -------------------- | ------------------------------ |
| `/api/v1/recipes`                      | `/v1/recipes`        | missing `/api`                 |
| `/api/v1/foods/search`                 | `/api/foods/search`  | missing version                |
| `/api/v1/users/me`                     | `/api/v1/Users/Me`   | paths are lowercase kebab-case |
| `/api/v1/collections/{id}/pull-source` | `/api/v1/getRecipes` | resources are nouns, not verbs |

## 2. The deprecated `/{version}/*` alias

Every versioned endpoint **also** answers on the bare `/v1/*` path it originally shipped on. This is a
transitional alias for consumers that cannot be redeployed from this repository — the Clerk dashboard's
webhook URL, already-shipped mobile builds, and cached web bundles with build-time-inlined endpoints.

**Rules:**

- New code — clients, tests, k6 scripts, contracts — uses the **canonical** path only.
- Do not delete an alias. Retiring the family is a coordinated change with an ordered prerequisite list;
  see [ADR-0011](architecture/decisions/0011-api-version-prefix.md#retiring-the-alias--the-order-is-not-optional).
- An alias is a real routable path, so it carries identical auth, validation and rate limiting. It is never
  a bypass.

## 3. Operational endpoints are NOT under the prefix

`/health` and `/health/ready` live at the **origin root** and are unversioned. They are liveness/readiness
probes, not API surface, and are dialed by:

- the shared-ALB target-group health check (all three services),
- the ECS container health check (`curl -f http://localhost:3000/health`),
- the prod and sandbox deploy smoke steps,
- CI local-boot waits.

Moving them under `/api` would break the ALB health check and drain every target group to zero healthy
hosts. CDK assertions in each service pin `HealthCheckPath: '/health'` to prevent exactly that.

## 4. Adding a versioned endpoint

In a NestJS service, declare both paths on the controller, canonical first:

```ts
@Controller(['api/v1/recipes', 'v1/recipes'])
export class RecipesController {}
```

Do not reach for `setGlobalPrefix` — see
[ADR-0011](architecture/decisions/0011-api-version-prefix.md#how-it-is-implemented) for why the
controller is the correct seam (the short version: every e2e suite boots the app without `main.ts`, so an
app-level prefix would not be under test).

If the controller's route needs a middleware exclusion (e.g. a machine-token route that must bypass Clerk
auth), **list both spellings** in the exclusion. Covering only one fail-closes the other.

## 5. Introducing `v2`

`v2` is additive: add `api/v2/...` as a new canonical path and keep `api/v1/...` serving until its
consumers are gone. The bare `/v1/*` alias does not gain a `v2` counterpart — it exists only for clients
that predate the prefix, and nothing new should ever be built against it.

## 6. Base URLs are origins

Every client env var (`NEXT_PUBLIC_IDENTITY_API_URL`, `NEXT_PUBLIC_RECIPE_API_URL`,
`FOOD_SERVICE_URL`, …) holds an **origin only** — no path, no trailing `/api/v1`. The typed clients append
the full canonical path. A base URL with a path baked in produces doubled prefixes that only surface at
runtime.
