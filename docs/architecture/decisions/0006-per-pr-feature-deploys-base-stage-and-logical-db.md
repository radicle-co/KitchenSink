# 0006 — Per-PR feature-service deploys: base-stage imports + per-PR logical database

- Status: Accepted
- Date: 2026-07-01
- Deciders: platform
- Related: [0002](0002-vpc-consolidation-and-cidr-scheme.md), [0003](0003-shared-alb-per-stage.md), [0005](0005-environment-tagging-and-pr-cleanup.md)

## Context

ADR-0005 declares feature services (e.g. `food`) **ephemeral per-PR**: a deploy runs at
`stage=pr-{N}`, is tagged `Environment=pr-{N}`, is reachable at `{service}-pr-{N}.commise.app`,
and is deleted on PR close. But the platform tier (VPC, RDS, shared ALB, domain) is **persistent
and exists only for two stages** — `sandbox` and `prod` (`GlobalStack` per stage). There is no
per-PR platform.

Two problems followed:

1. **The feature stack imported the platform at `stage`, not a base stage.** `FoodServiceStack`
   did `Fn.importValue('kitchensink-{data,network,alb,domain}-${stage}:…')`. For `stage=pr-7`
   that resolves to `kitchensink-data-pr-7`, which does not exist — so a per-PR deploy could
   never synth/deploy. Per-PR feature previews were therefore not actually possible.
2. **No per-PR database isolation existed.** `kitchensink_food` is a single shared logical
   database on the shared instance. Every preview would read/write the same tables, so one PR's
   fixture/ingest data pollutes another's.

## Decision

**1. Introduce an explicit `baseStage`.** A feature stack takes both `stage` (identity: naming,
tagging, routing, EventBus, per-PR DB name, cleanup) and `baseStage` (the persistent platform it
imports from). Resolution:

| `stage`        | `baseStage` |
| -------------- | ----------- |
| `prod`         | `prod`      |
| `sandbox`      | `sandbox`   |
| `pr-{N}` / any | `sandbox`   |

All platform imports (`kitchensink-{network,data,alb,domain}-…`, `kitchensink/{…}/food/usda-api-key`,
`Vpc.fromLookup`) use **`baseStage`**. A per-PR deploy therefore rides the **shared sandbox** VPC,
RDS, ALB, and domain — no per-PR platform is created (consistent with ADR-0003's shared ALB and
ADR-0002's per-stage VPC). Priorities/host-rules on the shared sandbox ALB stay unique per active
preview (allocate from a per-PR band; unmatched → the listener's default 404).

**Cert-safe preview host.** The shared ALB cert covers `commise.app`, `*.commise.app`, and
`*.sandbox.commise.app` — all **single-label** wildcards. A per-PR host must therefore be a single
label under the apex: `foodSubdomainForStage` emits **`food-{stage}`** (→ `food-pr-7.commise.app`,
covered by `*.commise.app`), NOT `food.{stage}` (→ `food.pr-7.commise.app`, a 3-label host no
wildcard covers, which fails the TLS handshake). Prod keeps the bare label `food`, so its template is
unchanged.

**Amendment (2026-07-29) — a feature service has NO persistent non-prod instance, and the
stage-qualified host is now unrepresentable.** Per owner directive, every PR deploys its own instance
of every feature service; only identity and `packages/infra/global` are shared and persistent. Two
consequences:

- `foodSubdomainForStage` / `recipeSubdomainForStage` take only `stage` and are **total**: prod → the
  bare label, every other stage → the dash form. They no longer accept a `baseStage` to compare
  against, so a stage-qualified `{service}.{stage}` label cannot be constructed at all — it is
  unrepresentable rather than merely rejected.
- Deploying a feature service at the platform's own base stage is refused in `infra/bin/app.ts`, where
  deploy-stage validity belongs. A DNS-label helper is the wrong place to decide which environments
  exist.

Live AWS already matched this (there has never been a `kitchensink-{food,recipe}-service-sandbox`
stack), so nothing was migrated. Note the failure mode this closes was quiet, not loud: the
`*.sandbox.commise.app` wildcard resolves to the shared ALB, so a stage-qualified service host answers
the listener's default **404 on every request** rather than failing DNS. That wildcard still exists (the
per-PR web previews need it), so such a host will always resolve — what has been removed is any code or
configuration that can produce or name one.

**`food_app` needs `CREATEDB` on the sandbox instance.** The per-PR database is created by the
migration runner connected AS `food_app`, so the non-prod bootstrap SQL (DataStack) grants
`ALTER ROLE food_app CREATEDB`. Prod's `food_app` is left without it (prod has no previews), keeping
the prod bootstrap secret byte-identical.

**2. Per-PR isolation is a per-PR logical database on the shared instance.** The database name is
derived from `stage`: `kitchensink_food` for `sandbox`/`prod`, and **`kitchensink_food_pr_{N}`** for
a per-PR deploy. The in-VPC migration-runner Lambda (T-191) **creates the database if absent**
(`SELECT 1 FROM pg_database` → `CREATE DATABASE`, run as a role with `CREATEDB`), then applies the
ordered migrations into it and records them in that DB's own `schema_migrations`. PR-close cleanup
(the `sandbox-deploy.yml` cleanup job) **drops** `kitchensink_food_pr_{N}` alongside the tagged
stacks.

This is deliberately **not** a per-PR RDS instance and **not** a shared-tables model: a logical
database gives clean isolation at ~zero cost (one instance, marginal storage), while shared tables
would let previews corrupt each other.

## Consequences

- Per-PR previews become possible and isolated on one shared sandbox instance.
- **Cost of isolation is negligible** — a logical database has no per-database charge; the real
  per-PR cost is the ephemeral Fargate service (tasks + a public IPv4 + logs), which is independent
  of the DB-isolation choice and is bounded by open-PR count and the ADR-0007 shutdown schedule.
- The migration runner needs a role with `CREATEDB` (or a bootstrap step) — the least-privilege
  `food_app` role owns its per-PR DB; the create step uses the bootstrap credential path.
- Cleanup must drop the per-PR database, or idle preview schemas accumulate. The drop is idempotent
  and keyed on the delimiter-aware `pr-{N}` match (ADR-0005), so `pr-1` ≠ `pr-15`.
- `prod`/`sandbox` behaviour is unchanged (`stage == baseStage`, DB name `kitchensink_food`), so the
  synthesized prod/sandbox templates do not diff on this change.
