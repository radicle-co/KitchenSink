# Sentry Observability — Operator Setup

The code for Sentry across all four deployables + the CloudWatch→Sentry log drain has shipped (see
the plan at `docs/plans/2026-06-11-001-feat-sentry-observability-rollout-plan.md`). The integrations
stay **inert until the external configuration below is in place** — each SDK no-ops without its DSN,
and the source-map upload step no-ops without its token. None of these values are committed to the
repo.

## 1. Sentry org / projects

- Confirm the Sentry org plan includes **Logs** and **OTLP log ingestion** (the drain rides the OTLP
  logs endpoint, which is open beta).
- Projects (org `radicle-co`): `commise-web`, `commise-mobile`, plus the backend identity-service,
  identity-webhooks, and the dedicated **log-drain** project. Note each project's DSN and slug.

## 2. AWS SSM parameters (per stage — `prod` and `sandbox`)

The CDK reads these at deploy via `valueForStringParameter`, so create all of them as plain
`String` parameters. DSNs/keys are send-only and low-sensitivity, so `SecureString` is unnecessary —
and would not work here, since `valueForStringParameter` cannot resolve a `SecureString`.

Stage-scoped params use the org-standard **stage-first** layout `/kitchensink/{stage}/{service}/{key}`,
matching Secrets Manager (`kitchensink/{stage}/identity/keys`). For the per-service Sentry DSNs the same
DSN serves both stages; the `STAGE`-driven Sentry `environment` tag separates sandbox from prod events.
The clerk issuer/JWKS values are instance-specific (they must match each stage's live Clerk Frontend
API, **not** a brand domain): prod is the custom domain `clerk.commise.app`, sandbox is the Clerk dev
instance `nice-fowl-6.clerk.accounts.dev`.

The **log-drain** DSN is a single, stage-agnostic param under `global/` — there is one log-drain
Sentry project for all stages, and the forwarder tags each record's `environment` from the source
CloudWatch log group name (`kitchensink-identity-<component>-<stage>-…`). All of these are already
populated.

| Parameter                                    | Used by                               |
| -------------------------------------------- | ------------------------------------- |
| `/kitchensink/{prod,sandbox}/clerk/jwks-url` | authorizer JWT validation (`jose`)    |
| `/kitchensink/{prod,sandbox}/clerk/issuer`   | authorizer JWT validation (`jose`)    |
| `/kitchensink/{prod,sandbox}/clerk/audience` | set as `IDP_AUDIENCE` (not validated) |

### The Sentry DSN register

⛔ **This table is the authority, and it is guarded.** `sentryDsnRegister.test.ts` derives every
`/kitchensink/…/sentry/…-dsn` parameter the CDK stacks and workflows actually resolve, and fails if one is
missing from this table or listed here with no consumer. The table had gone stale once — it named three
parameters while six more were being resolved at deploy — which is how a runtime comes to hold a DSN nobody
knows about, or a parameter nobody reads.

⚠️ **One Sentry project per runtime, not per stage.** `prod` and `sandbox` hold the same project's DSN and
separate themselves with the Sentry `environment` tag; a `pr-{N}` preview resolves its base stage's
parameter, so previews cost no extra projects and no extra quota.

<!-- sentry-dsn:start -->

| Parameter                                                  | Sentry project                  | Used by                                              |
| ---------------------------------------------------------- | ------------------------------- | ---------------------------------------------------- |
| `/kitchensink/{prod,sandbox}/sentry/webhook-dsn`           | `kitchensink-identity-webhook`  | identity-webhooks Lambdas + forwarder                |
| `/kitchensink/{prod,sandbox}/sentry/identity-service-dsn`  | `kitchensink-identity`          | identity service (ECS)                               |
| `/kitchensink/{prod,sandbox}/sentry/recipe-service-dsn`    | `kitchensink-recipe-service`    | recipe service (ECS)                                 |
| `/kitchensink/{prod,sandbox}/sentry/food-service-dsn`      | `kitchensink-food-service`      | food API, worker and change refresh (ECS)            |
| `/kitchensink/{prod,sandbox}/sentry/recipe-workers-dsn`    | `kitchensink-recipe-workers`    | the ten recipe Lambdas, queue check included         |
| `/kitchensink/{prod,sandbox}/sentry/platform-dsn`          | `kitchensink-platform`          | migration runners, bootstrap, reaper, scheduler      |
| `/kitchensink/{prod,sandbox}/sentry/ingredient-parser-dsn` | `kitchensink-ingredient-parser` | the Python CRF parser Lambda                         |
| `/kitchensink/{prod,sandbox}/sentry/edge-dsn`              | `kitchensink-edge`              | the Lambda@Edge verifier — **inlined at BUILD time** |
| `/kitchensink/global/sentry/log-drain-dsn`                 | `kitchensink-log-drain`         | log forwarder (`LOG_DRAIN_DSN`)                      |

<!-- sentry-dsn:end -->

⛔ **The edge row is different in kind, in two ways.** First, Lambda@Edge accepts no environment variables,
so its DSN cannot be resolved at deploy like every other row — `esbuild.mjs` inlines it into the bundle from
`SENTRY_EDGE_DSN`. Nothing set that variable until U23, so every edge bundle shipped with an empty DSN and
reported nothing while the parameter sat populated. An absent DSN stays non-fatal (the verifier reports
nothing, as before) and the bundle step emits a `::notice::` rather than failing, so a local bundle still
works.

⚠️ Second, **only `prod-deploy.yml` reads it, because the verifier is prod-only.** `bin/app.ts` gates
`EdgeStack` on `stage === 'prod'` and `esbuild.mjs` skips the edge bundle entirely unless `CLERK_JWT_KEY` is
exported — which no sandbox workflow does. The sandbox parameter therefore exists and is never read; it is
left in place rather than deleted, because the cost is nothing and a future non-prod edge deploy would need
it. `globalBootstrapBundle.test.ts` asserts the DSN is supplied by the workflows that actually build the
bundle, and names the single builder so the assertion cannot pass vacuously.

## 3. GitHub Actions (prod-deploy)

- Secret `SENTRY_AUTH_TOKEN` — scoped minimally to `project:releases` + `sourcemaps:write` for the
  backend project(s). Without it, the Lambda source-map upload step is skipped.
- Repo variable `SENTRY_WEBHOOKS_PROJECT` — the webhook project slug (gates the upload step).
- `SENTRY_RELEASE` is already wired to the commit SHA on the webhooks deploy + the ECS image tag.

## 4. Vercel (web — source maps upload during `next build`)

- Env vars: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG=radicle-co`, `SENTRY_PROJECT=commise-web`,
  `SENTRY_AUTH_TOKEN`, and `SENTRY_RELEASE` (set to the deployed commit SHA so runtime and upload
  releases match).

## 5. EAS (mobile — source maps upload during the native build)

- EAS secret `SENTRY_AUTH_TOKEN`; `EXPO_PUBLIC_SENTRY_DSN` available to the build.
- Build with the new `production` EAS profile. Verify the Expo 53 native targets meet
  `@sentry/react-native` v8 minimums (iOS 15+).

## 6. Verification — a forced error in each runtime, landing in its own project

⛔ **Wiring and delivery are two claims, and only the first is provable from a checkout.** The guards prove
every runtime is assembled correctly up to the network boundary. Nothing in this tree can prove an event
CROSSES it — that hop needs a deployed runtime holding a live DSN, which is why
[ADR-0043](architecture/decisions/0043-application-log-routing.md) records this confirmation as owed.

### Provable now, from a checkout

`npm run test --workspace=packages/infra/global` runs the guards that hold the wiring: that a bootstrap
passes the routing adapter, that no adopted service reaches past the sink to `Sentry.logger`, that every
`instrument.ts` wires both scrubbers and `enableLogs`, that a container `command` keeps its `--import`, and
that every `…-dsn` parameter the stacks resolve appears in the register above while every row there has a
consumer. The Python parser's SDK is held one layer out, by the asset predicate its own BUILD runs against
pip's `RECORD` (ADR-0025), so a wheel that failed to install is a build failure rather than a first-invoke
`ImportError`.

A green run means a runtime that RECEIVES its DSN will initialise and route. It says nothing about whether
the parameter is populated on a stage, whether the task was redeployed, or whether the event arrived.

### Reading which runtimes have reported — ask, do not keep a list

⛔ Do not record the answer here. A roster of confirmed runtimes is the same artefact as the DSN table that
drifted above, and it goes stale on the next deploy. Query the org instead, grouping by project:

| Dataset | Group by                 | What a non-zero row proves                                                 |
| ------- | ------------------------ | -------------------------------------------------------------------------- |
| `spans` | `project`, `environment` | `Sentry.init` RAN in a deployed build — an uninitialised SDK emits nothing |
| `logs`  | `project`, `severity`    | an `error` row is the diverted error path working end to end               |
| issues  | —                        | `captureException`, or an unhandled throw reaching the SDK                 |

⚠️ Scope by name to the `kitchensink-*` / `commise-*` projects; the org also hosts `armoury-*`, a different
product — the same rule ADR-0005 applies to the shared AWS account.

⚠️ **An `info` or `warn` row in a per-SERVICE project means that runtime is running a build older than
ADR-0043**, not that the table is wrong: `logRouting.ts` sends those levels to the console, and ADR-0042's
drain carries them to `kitchensink-log-drain`. It is the cheapest check of whether a stage has picked the
routing up, and it needs no forced error.

### Forcing the error, by runtime SHAPE

Every row of the DSN register above is one of four shapes, and the shape decides the method — so nothing
here names a runtime, and nothing needs topping up when a row is added.

**ECS service.** No diagnostic trigger exists in the tree, and no request forces a 500: a handled
`HttpException` is a 4xx the filter does not capture. The error half therefore needs either a throw shipped
in a build or a deliberately unavailable downstream on a preview. Initialisation itself needs neither — the
`spans` query above answers it. ⚠️ This is the shape that keeps the verification owed, and an admin-scoped
diagnostic route that throws would turn a deploy into a ten-second check.

**Lambda with the SDK initialised** (Node handlers and the Python parser alike). `aws lambda invoke` with a
payload the handler cannot parse; the wrapper captures and the invocation fails. This is the one shape
runnable **today**, against an already-deployed preview, with no code change and no workflow dispatch.
⚠️ Choose a handler with no write side effect — a queue worker consumes its message.

**Lambda@Edge.** Not verifiable outside prod: `bin/app.ts` creates `EdgeStack` only at `stage === 'prod'`,
and `SENTRY_EDGE_DSN` is exported by `prod-deploy.yml` alone. Its DSN is inlined at BUILD time, so this is
owed by the next prod deploy carrying that export, and the first check is simply whether `kitchensink-edge`
holds any event at all.

**Client** (web, mobile). A thrown error in a route handler or screen. Mobile needs a real build carrying
both `EXPO_PUBLIC_SENTRY_DSN` and `EXPO_PUBLIC_STAGE`; the alerting section below records why the second
matters — a runtime reporting anything but `prod` in production is unalerted, not merely mis-filed.

In every case the pass is: **exactly one** source-mapped entry, in the project the register names, tagged
with that stage's `environment`, its `release` equal to the uploaded one — and NO duplicate in
`kitchensink-log-drain`, which is the double-recording ADR-0043 exists to prevent.

### Preconditions

- **The stage must be up.** Sandbox is shut down 00:00–09:00 ET (ADR-0007) and does not self-wake, so a
  probe in that window fails for a reason unrelated to telemetry.
- **A probe confirms only the build deployed to the stage it hits.** A per-PR preview carries the branch;
  the shared `sandbox` services and prod carry `main`.
- Confirm separately that `ReconciliationDrift` and the user-event counts still appear as CloudWatch
  metrics, and that the drain carries access/warning/error lines with `START`/`END`/`REPORT` and EMF lines
  absent.

## DSN mapping

The concrete DSN values were provided out-of-band; place them in SSM (backend) / Vercel + EAS env
(web, mobile) / the apps' `.env.local`, never in source.

## Per-project alerting posture (plan U23)

Every `kitchensink-*` and `commise-*` project is on the `commise` team, and each carries the same three
settings. They are recorded here because they are org state, not repository state — nothing in this tree
enforces them, and the only way to notice one has drifted is to look.

⚠️ **The `radicle-co` org also hosts the `armoury-*` projects, which are a different product.** Every change
below was scoped to the `kitchensink-*` / `commise-*` set by name, the same rule ADR-0005 applies to the
shared AWS account. Do not run an org-wide sweep here.

### An alert fires for `prod` and stays quiet everywhere else

Each project's issue workflow is scoped to `environment: prod`. They were created with **no** environment
filter, which meant every one of them notified on `sandbox` and on **every `pr-{N}` preview** — an alert per
throwaway stage, which is how an alert channel becomes something people mute. The trigger and action are
unchanged from Sentry's default (new/existing high-priority issue → email the issue owners); only the
environment moved.

⚠️ **This is why the runtime's `environment` string matters more than it looks.** A runtime that reports
anything other than `prod` in production is now not merely mis-filed — it is unalerted. That is the failure
`EXPO_PUBLIC_STAGE` shipped with on mobile: read in one place, set in none, so every build including a real
release reported `development`. `eas.json` sets it per build profile now, and
`tests/config/easProfiles.test.ts` holds the vocabulary to `prod` / `sandbox` / `pr-{N}`.

### Ownership auto-assigns to the team

Each project has an ownership rule of `path:** #commise` with auto-assignment on. With one team the set of
people notified does not change — what changes is that an issue arrives **assigned** rather than falling
through to every active member unowned, which is the difference between a triage queue and an inbox. It also
makes the workflows' `targetType: issue_owners` action resolve to something.

### Spike protection is on

Enabled for every project. It caps runaway ingestion, which matters most for the runtimes that can emit per
request or per queue message — a loop in the edge verifier or a redelivery storm can otherwise spend the
month's quota in an afternoon, and a filled quota drops **errors**, not just traces.

⚠️ Reading it back needs a permission the write does not: `GET /organizations/{org}/spike-protections/`
answers `403` with a token that can `POST` to the same path. Check the project instead — the project detail's
`options["quotas:spike-protection-disabled"]` is `false` when it is on.

### Still owed, and not doable from here

- **An environment exists in a project only once an event arrives**, so a project created ahead of its
  runtime's first deploy shows none. Which runtimes have reported is a QUERY (§6), never a list kept here.
- **Traces, metrics and profiles** cannot be confirmed arriving until the runtimes emit them (plan U22).
- ⛔ **A project whose live deploy reports an environment other than `prod` is UNALERTED**, because the issue
  workflows above are scoped to that exact string — and this is not hypothetical for `commise-web`. Next sets
  `NODE_ENV=production` for every production build, which is the value `deployStageFor` exists to replace;
  until that derivation reaches `main` and Vercel rebuilds production, the live web deploy reports
  `production` and no `prod`-scoped rule matches it. ⚠️ Read it off a grouping of that project's errors by
  `environment`, not off this line — the same failure mode applies to any runtime whose stage string drifts.

## Queue-backstop cron monitors

⛔ **These monitors are created by CODE, not in the UI, which is why they are written down here.** Each
service's queue backstop (ADR-0041) calls `Sentry.captureCheckIn` with an upsert config on every run, so the
monitor appears the first time a stage runs the check and nobody has to remember to create it. The cost of
that convenience is that a monitor nobody created is also a monitor nobody can find by searching the setup
history — so the slugs, and the reasoning behind their settings, live here.

| Service             | Monitor slug                            | Interval | Why that interval                                             |
| ------------------- | --------------------------------------- | -------- | ------------------------------------------------------------- |
| `recipe-workers`    | `recipe-workers-queue-check-<stage>`    | 5 min    | Its own EventBridge rule                                      |
| `identity-webhooks` | `identity-webhooks-queue-check-<stage>` | 5 min    | Its own EventBridge rule                                      |
| `food-service`      | `food-service-queue-check-<stage>`      | 1 min    | It rides the drainer's reaper tick and has no rule of its own |

`<stage>` is `prod` or `sandbox`, and **only** those two. A `pr-{N}` preview escalates what it finds and
never checks in: its stack is torn down when the PR closes while the monitor it created is not, which would
leave one permanently-missing monitor per PR until the live ones were unreadable among the dead.

⛔ **The stage is part of the slug on purpose.** A monitor shared between `prod` and `sandbox` is checked in
by whichever stage is still healthy, so a dead prod check reads green for as long as sandbox keeps running —
the monitor would report success for exactly the outage it was installed to catch.

Settings arrive with the upsert and need no UI change: `checkinMargin` 5 minutes, `failureIssueThreshold` 2,
`recoveryThreshold` 1. Two consecutive misses rather than one, because every deploy of these services
replaces the thing that checks in — a Lambda version cut over, an ECS task drained and restarted — so a
single miss is the normal shape of a release.

**Must page:** a missed check-in on a `prod` monitor. `food-service-queue-check-prod` going quiet means the
food drainer itself is down, not only its backstop.

**Must NOT page:** an escalation with `condition: delayed`. That is work behind a moving queue — late, not
lost — and paging on it is how the channel gets muted before a `lost` ever arrives.

## Provisioning-failure alert (`auth.provisioning: failed`)

The create-user flow emits one distinct signal for a **genuine** provisioning failure — a DB/constraint
error that leaves a user without a complete `user + account + profile`. It is tagged
`auth.provisioning: failed` and carries only the Clerk identity id / app user id (never PII; a Postgres
23505 message embeds the email, so the message is run through `scrubText` before it becomes an
attribute). Emit sites: the read-through `AuthMiddleware`, `resolveUser` (present-but-incomplete
anomaly), the `user.created` webhook, and nightly reconciliation.

**Must page:** any event with `tags.auth.provisioning = failed`.
**Must NOT page (by construction, never tagged):** the expected email-collision placeholder fallback
(the routine returns `incomplete`, the webhook logs and skips), idempotent `onConflictDoNothing` no-ops,
and best-effort `setExternalId` failures (`webhook.set_external_id_failed`).

Create the alert rule in both projects (`kitchensink-identity`, `kitchensink-identity-webhook`): fire
on `tags.auth.provisioning = failed` → notify the on-call channel.

**Known gap (accepted):** this is an event-driven signal. A zero-request webhook-Lambda crash-loop
(a boot failure before any event is processed) emits no event and will not page. The identity **service**
already has a CloudWatch `healthyHostCount` crash-loop alarm for its own boot; the webhook Lambda has no
equivalent. Revisit with a CloudWatch metric-filter/no-data alarm if webhook-side boot failures recur.
