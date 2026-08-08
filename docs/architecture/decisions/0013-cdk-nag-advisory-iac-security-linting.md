# 0013 — cdk-nag on every CDK app, ADVISORY (warnings only), with a byte-identical-template guarantee

- **Status:** Accepted — implemented. `attachSecurityChecks(app)` is called from all seven CDK app entrypoints; findings are reported as CDK warnings. **Burn-down pass #1 is done (115 → 62) — see "Update (2026-08-07)" for the record, the three escalations awaiting an owner decision, and the remaining backlog.**
- **Date:** 2026-08-07
- **Area:** IaC security · CDK Aspects · prod-template stability
- **Related:** `docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md` (no-prod-diff), `0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md` (no-prod-diff), `packages/infra/security/**`, `packages/infra/global/__tests__/cdk-nag-{attachment,template-parity,synth.integration}.test.ts`

## ⚠️ Before you change this — the two traps

- **Do NOT "simplify" `AdvisoryAwsSolutionsChecks` to a bare `new AwsSolutionsChecks(...)`.** Most `AwsSolutions` rules are ERROR level, cdk-nag reports them via `Annotations.addError`, and the CDK CLI **exits 1** when any error annotation is present. Measured: a bare `AwsSolutionsChecks` over one default S3 bucket makes `cdk synth` exit 1. Attaching the stock pack would therefore not "report" a 115-finding backlog — it would **block every `cdk synth` and `cdk deploy`** on live infrastructure. The subclass exists solely to downgrade ERROR→WARN, and removing it is an outage, not a cleanup.
- **Do NOT add a `NagSuppressions` entry casually, and never call `NagSuppressions` directly.** A suppression is **not** annotation-only: it writes `Metadata.cdk_nag.rules_to_suppress` **into the CloudFormation resource** (verified by diffing synth output with and without one). That is a real template diff, and prod template stability is what ADR-0002 and ADR-0008 both stake data safety on. Every suppression must be its own reviewed change with its own diff. Since burn-down #1 there is exactly one way in: add an entry to the `AcceptedNagFindings` register in `@kitchensink/infra-security` and apply it with `acceptNagFindings(construct, …)`. Its key set is pinned by a test, the prod-template allowlist (`EXPECTED_PLATFORM_SUPPRESSIONS`) is pinned by another, and reasons must be ASCII (see the base64 trap in the 2026-08-07 update).

## Context

- The repo owns a VPC, IAM roles, RDS, S3, SQS, SNS, an internet-facing shared ALB, API Gateway, CloudFront and ~20 Lambdas across seven CDK apps, and had **no IaC security scanning of any kind** — no cdk-nag, no Checkov, no `Aspects` at all (verified by grep before the change).
- Two ADRs make prod template stability load-bearing rather than cosmetic. ADR-0002 keeps prod on `10.0.0.0/16` precisely so the explicit value produces **no diff**, because replacing the prod VPC replaces the prod RDS (`removalPolicy: DESTROY`, `deletionProtection: false`, no snapshot). ADR-0008 makes the same promise for the gp3/Spot/budget levers. An Aspect runs over **every** construct in the tree, so an output-mutating one would breach that line everywhere at once — and invisibly.
- There is an existing backlog: 115 non-compliant findings across the seven prod apps at the time of adoption (112 at cdk-nag's ERROR level, 3 at WARN). Gating deploys on it was never an option.

## Decision

1. **`cdk-nag`'s `AwsSolutionsChecks` is attached to every CDK app**, at the app root, via one shared helper — `attachSecurityChecks(app)` from `@kitchensink/infra-security`. The pack is not subsetted: review breadth is whatever cdk-nag ships.
2. **Advisory mode, via a logger Decorator.** `AdvisoryAnnotationLogger` extends cdk-nag's `AnnotationLogger` and rewrites ERROR-level findings to WARN, passing WARN and INFO through unchanged. `AdvisoryAwsSolutionsChecks` filters the stock annotation logger out of the pack's logger list and prepends the advisory one, so exactly one annotation logger survives and it cannot raise errors. Findings are visible on every synth; nothing fails.
3. **One wiring point, discovery-enforced.** The posture lives in one function, and `cdk-nag-attachment.test.ts` walks the workspace for CDK apps (parsing each entrypoint with the TypeScript compiler, not regex) and fails if any discovered app does not call it, attaches a raw `AwsSolutionsChecks`, or omits the dependency. A new CDK app cannot ship unreviewed.
4. **Zero suppressions at adoption.** Because a suppression mutates the template, the advisory-first change carries none; the byte-identical guarantee and a suppression are mutually exclusive in one commit. cdk-nag itself rejects a `reason` under 10 characters at the call site, so a suppression can never be added without a stated justification. **Superseded by burn-down #1** — suppressions now exist, they go through the `AcceptedNagFindings` register, and "zero suppressions" became an explicit allowlist. See the 2026-08-07 update.
5. **Compliance reports stay on** (cdk-nag's default): one `AwsSolutions-{stack}-NagReport.csv` per stack in `cdk.out`, which is the burn-down inventory for free.

## Consequences

**Positive**

- Every stack in every app is now security-reviewed on every synth, including per-PR previews, with no deploy risk.
- The no-prod-diff line is now _asserted_, not merely intended: `cdk-nag-template-parity.test.ts` compares full template JSON per stack, with and without the Aspect, for prod and sandbox — and includes a negative control proving the comparison detects a mutating Aspect.
- Proven byte-identical at adoption: all **12** synthesized prod templates across the 7 apps had identical checksums before and after. Only `*.metadata.json` (the cloud-assembly annotation sidecar, which CloudFormation never sees) changed, plus 11 added NagReport CSVs.

**Negative / costs**

- Every `cdk synth`/`cdk deploy` log now carries ~3–30 nag warnings per app (115 total at adoption). That is deliberate pressure, but it does add noise and can bury unrelated CDK warnings until the backlog shrinks.
- Synth walks the tree an extra time (~200 rules per resource). Measured as sub-second per app; no meaningful deploy-time cost.
- `AwsSolutions-L1` ("not the latest Lambda runtime") re-fires on every `aws-cdk-lib` bump that adds a runtime, so it is a recurring, low-value 19-finding block of noise. Expect to suppress or fix it early in the burn-down.
- Advisory mode reports but does not enforce. Promoting a rule to blocking is a separate decision; the intended path is to swap the logger for one that keeps ERROR level once a rule's findings are at zero, **not** to gate on the whole pack.

## Alternatives considered

- **Attach the stock `AwsSolutionsChecks` and fix the findings first** — rejected: it makes `cdk synth` exit 1 immediately, so the repo could not deploy until a 115-finding backlog was cleared. Advisory-first is what makes adoption possible at all.
- **Gate the Aspect behind a context flag / a separate `npm run infra:nag` audit command** — rejected: a review that only runs when someone remembers to ask for it is not a control. Attaching unconditionally, at zero deploy risk, is strictly better.
- **Checkov / tfsec-style external scanners over `cdk.out`** — rejected for now: they scan the emitted template, so findings point at synthesized logical IDs rather than the construct that produced them, and they need a separate synth+scan pipeline stage. cdk-nag reports at the construct path, which is where the fix goes.
- **Suppress the known-deliberate findings in the same change** (ALB `0.0.0.0/0`, the intentionally unauthenticated Clerk webhook route, RDS deletion protection) — rejected: each suppression writes template metadata, which would have made the prod diff non-empty and broken the acceptance criterion of this very change.
- **Bump `aws-cdk-lib` to satisfy `cdk-nag@3`'s peer range** — rejected: a CDK bump can itself move synthesized output, which is precisely the risk being controlled. `cdk-nag@2.38.2` peers on `aws-cdk-lib ^2.176.0` and works against the pinned 2.254.0.

## Implementation guards

- `packages/infra/security/src/attach-security-checks.ts` carries the "annotation-only, and a suppression is NOT" rationale at the wiring point.
- `packages/infra/global/__tests__/cdk-nag-template-parity.test.ts` — byte-identical prod + sandbox templates, per stack, plus "a suppression would show up here" (`no cdk_nag metadata`) and a mutating-Aspect negative control.
- `packages/infra/global/__tests__/cdk-nag-synth.integration.test.ts` — a real `cdk synth` at prod and sandbox: exit 0, warnings present, no CLI error line. This is the only tier that can catch the ERROR→exit-1 regression, because it is a property of the CLI, not of in-process synthesis.
- `packages/infra/global/__tests__/cdk-nag-attachment.test.ts` — discovery-based; also pins the known entrypoint set so a broken walk cannot pass silently.

---

## Update (2026-08-07) — burn-down #1: 115 → 62, and three escalations

The first burn-down pass. **115 findings → 62** across the seven prod apps, with zero cdk-nag errors and every app still synthesizing `exit 0`. Advisory mode is unchanged; nothing was promoted to blocking.

### Where the 53 went

| Rule                                   | Before | After  | Disposition                                                                                                 |
| -------------------------------------- | ------ | ------ | ----------------------------------------------------------------------------------------------------------- |
| `L1` non-latest Lambda runtime         | 19     | **2**  | **FIXED** — `nodejs24.x`                                                                                    |
| `SQS4` / `SNS3` no TLS-only policy     | 13     | **0**  | **FIXED** — `enforceSSL` / an explicit deny statement                                                       |
| `ECS2` plaintext task env              | 5      | **0**  | Accepted (re-verified)                                                                                      |
| `IAM5` wildcards                       | 31     | **20** | 11 removed by **narrowing real over-grants**; the residual object-key wildcard accepted with a scoped regex |
| `EC23` `0.0.0.0/0` on the ALB SG       | 1      | **0**  | Accepted (ADR-0003)                                                                                         |
| `APIG4` + `COG4` unauthenticated route | 2      | **0**  | Accepted (svix HMAC verified in the Lambda)                                                                 |
| `APIG3` / `CFR1` / `CFR2` WAF + geo    | 3      | **0**  | Accepted — deferred on cost proportionality                                                                 |
| `SMG4` no secret rotation              | 2      | **1**  | `MigrationPlanSecret` accepted; `DatabaseCredentialsSecret` **ESCALATED**                                   |

The 2 remaining `L1` findings are CDK's own `custom_resources.Provider` framework functions. `Provider` calls `lambda.determineLatestNodeRuntime(this)` and exposes no runtime prop, so they are not ours to set. They are left **reporting** deliberately: the finding is accurate, it clears itself on an `aws-cdk-lib` bump, and suppressing it would write template metadata onto the prod data stack in exchange for hiding a genuinely stale runtime later.

`AwsSolutions-L1` was described above as "a recurring, low-value 19-finding block of noise". That framing was wrong, and the correction is worth recording: the repo pins `engines.node: 24.x`, so **every test, lint and local command ran on Node 24 while all nineteen deployed Lambdas ran `nodejs22.x`**. The code was verified on one Node major and executed on another. The runtime is now one pinned constant (`NODE_LAMBDA_RUNTIME`, `@kitchensink/infra-security`) whose own suite asserts it equals both the newest Node runtime `aws-cdk-lib` exposes (computed the way cdk-nag's `LambdaLatestVersion` computes it, then confirmed _through the real pack_) and the `engines.node` major. The next CDK bump that ships a newer runtime therefore fails **one test, in the PR that caused it**, instead of silently re-firing nineteen warnings — the treadmill, closed. Evidence the move is safe: all 25 built handler bundles import cleanly under Node 24.16.0 (esbuild targets `node22`, a forward-compatible downlevel), and `nodejs24.x` is present in the live Lambda API's runtime enum.

### The test contract changed, deliberately

`cdk-nag-{template-parity,synth.integration}.test.ts` asserted that **no** prod template contained `cdk_nag`. That was the correct contract at zero suppressions, and it is unsatisfiable once suppressions exist — so the only way to "keep it passing" would have been to delete it, dropping the control at the exact moment it starts mattering.

It is now an **allowlist**: `EXPECTED_PLATFORM_SUPPRESSIONS` is an exact, closed inventory of `stack/logicalId → ruleId`, plus an assertion that every reason is readable. Same guarantee — no unreviewed suppression reaches a prod template — but it fails loudly and names the resource.

Two properties are now separated, and both still hold:

1. **cdk-nag still changes no synthesized output.** A suppression is written by the _stack constructor_ (`acceptNagFindings(...)`), not by the Aspect, so the byte-identical-with-and-without-the-Aspect proof that ADR-0002/ADR-0008 depend on is intact. `'records the same set with the Aspect detached'` pins that distinction.
2. **The suppression set is fixed.**

### Three traps found while doing this — do not re-introduce them

- **A suppression `reason` containing any codepoint above 255 is base64-encoded into the template.** `NagSuppressionHelper.toCfnFormat` sets `is_reason_encoded: true` and replaces the whole string. One em-dash — and this repo's prose style uses them everywhere — turns the justification into an opaque blob in the CloudFormation template _and in the prod `cdk diff` a human approves_. The entire value of a suppression is that the next engineer can read the argument and disagree with it. Reasons are ASCII/Latin-1 only, asserted in two suites.
- **`sns.Topic({ enforceSSL: true })` on a topic that already has a hand-built `sns.TopicPolicy` emits a SECOND `AWS::SNS::TopicPolicy`.** That resource maps onto `SetTopicAttributes(Policy=…)`, which _replaces_ the document, so two of them is last-writer-wins. On `CostAlertTopic` that would have silently dropped the AWS Budgets / Cost Anomaly Detection publish grants — the alerting ADR-0008 exists to provide — with no symptom other than alerts that never arrive. The deny statement joins the existing document there instead. SQS has no such hazard: `Queue.addToResourcePolicy` reuses one singleton policy.
- **In an `appliesTo` regex, the partition segment must be matched with `.*`, not `[^:]+`.** CDK renders it as the `<AWS::Partition>` pseudo-parameter, which _contains colons_. The colon-excluding form matches a hardcoded `arn:aws:…` — so it passes a naive unit test — and matches nothing in any real stack. Measured: five findings kept reporting. The regression guard builds its probe with `bucket.arnForObjects()`, the way production does.

### ⛔ ESCALATED — owner's call, deliberately left as-is

Three findings are real risks that cdk-nag is right about, whose resolution is a business trade-off rather than an engineering one. **Nothing was changed for any of them.** Costs are us-east-1; the RDS instance rates were queried live from the AWS Pricing API, storage and WAF rates are published list prices.

#### 1. `RDS10` — deletion protection disabled on `Data-prod/Database`

Today: `deletionProtection: false`, `removalPolicy: DESTROY`, **no final snapshot**. A stack delete, a construct-ID change that replaces the instance, or a CIDR change (ADR-0002) destroys production data with no recovery path.

| Option                                             | Monthly cost                            | Consequence                                                                               |
| -------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Leave as-is                                        | $0                                      | One mistaken `cdk destroy` / replacement = total, unrecoverable loss of prod user data    |
| `deletionProtection: true`                         | **$0**                                  | A stack delete _fails_ until someone consciously turns it off; teardown becomes two steps |
| `+ removalPolicy: RETAIN`                          | $0 (an orphaned instance keeps billing) | The instance survives stack deletion entirely                                             |
| `+ deleteAutomatedBackups: false` / final snapshot | ~$0.095/GB-mo of snapshot               | A recoverable point even after deletion                                                   |

**Recommendation: enable `deletionProtection: true` now.** It costs nothing, and the cost posture (ADR-0007/0008) is not why it is off — it predates prod holding real data. The only price is that data-stack teardown gains a manual step, which is the point. This does _not_ conflict with ADR-0005: the data stack is `Environment=global` and is never swept by per-PR cleanup.

#### 2. `RDS3` — no Multi-AZ on `Data-prod/Database`

Today: `multiAz: false`. An AZ failure or a failed instance means downtime until a manual restore; single-AZ maintenance also implies a restart window.

| Option                           | Monthly cost                                                                       | Delta           |
| -------------------------------- | ---------------------------------------------------------------------------------- | --------------- |
| Single-AZ `db.t4g.small` (today) | $0.032/hr → **$23.36** instance + ~$11.50 gp2 (100 GB @ $0.115/GB-mo) ≈ **$34.86** | —               |
| Multi-AZ `db.t4g.small`          | $0.065/hr → **$47.45** instance + ~$23.00 mirrored storage ≈ **$70.45**            | **+ ~$35.6/mo** |

**+~$35.6/mo is ~12% of the $300 account budget (ADR-0008) for one line of config.** That is a product decision, not a lint fix: it buys automatic failover and a shorter maintenance window for a pre-launch service. **Recommendation: defer, and revisit at launch or first paying user** — but re-read this table once prod traffic is real, because the failure mode is "prod is down until someone restores it by hand".

#### 3. `SMG4` — no rotation on `DatabaseCredentialsSecret` (was in the triage's FIX list, and must not be)

The triage listed this under FIX. **Enabling rotation as-is would cause a production outage**, and the evidence is specific:

- `identity-service-stack.ts` injects the password with `ecs.Secret.fromSecretsManager(dbCredentialsSecret, 'password')`. ECS resolves that **at task start** and hands it to the container as an environment variable for the task's whole lifetime.
- `database.module.ts` builds the connection string **once**, at module init, from `process.env['DB_PASSWORD']`, and the `pg` Pool runs `idleTimeoutMillis: 30_000`.

So a `HostedRotation.postgreSqlSingleUser()` rotation changes the password at the database, and within ~30 seconds the running tasks re-dial with the stale one and every query fails — until the ECS tasks are replaced. Adding a rotation schedule would satisfy cdk-nag and take identity down.

| Option                                         | Monthly cost                                                      | Consequence                                                                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leave as-is                                    | $0                                                                | A long-lived static master password. Real, but _known_                                                                                                                                                     |
| Single-user hosted rotation                    | ~**$0** (one invocation / 30 days; egresses via the existing NAT) | **Outage** on every rotation, as above                                                                                                                                                                     |
| Multi-user hosted rotation                     | ~$0 + a second DB role                                            | Survives one cycle, so tasks get a rotation window to be replaced — but the username alternates, and DB objects are owned by `identity_app`, so ownership / default privileges need designing              |
| Read the secret at connect time in the service | $0 + service work                                                 | Correct, and makes single-user rotation safe. A service change with its own tests                                                                                                                          |
| **Move identity to RDS IAM auth**              | $0                                                                | **The architecturally right answer.** `iamAuthentication: true` is _already on the instance_, and `food_app` / `recipe_app` already authenticate passwordlessly this way (ADR-0006). No password to rotate |

**Recommendation: do NOT add a rotation schedule. Track the last option** — identity is the only service still on password auth, and the pattern it needs already exists in this repo.

### Deferred, costed, and recommended — the logging fixes (S1 ×2, ELB2, VPC7)

These four were in the FIX list and are **not implemented**; they add new resources and new billable telemetry, so they warrant their own reviewed diff. The cost concern turns out not to bind. Volumes are estimates for current (pre-launch) traffic; the retention caps are what keep them bounded as traffic grows.

| Finding                                 | Fix                                               | Estimated monthly cost    | Notes                                                                                                   |
| --------------------------------------- | ------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `S1` on `MediaBucket` + `ArchiveBucket` | Server access logging to a new `AccessLogsBucket` | **< $0.05**               | The feature is free; delivery `PUT`s are not billed. Storage only (~500 B/request)                      |
| `ELB2` on the shared ALB                | ALB access logs to the same bucket                | **≈ $0.10**               | No ELB charge; ~17k delivery `PUT`s/mo @ $0.005/1k, plus a few MB of gzip                               |
| `VPC7` on the prod VPC                  | Flow logs → **S3**, not CloudWatch Logs           | **≈ $0.20 – $1.50**       | Vended-log delivery to S3 is $0.25/GB vs CWL's $0.50/GB ingest, and S3 storage is cheaper. ~0.5–5 GB/mo |
|                                         |                                                   | **≈ $0.35 – $1.65 total** | ~0.5% of the $300 budget                                                                                |

**Recommendation: do all three**, with retention caps rather than defaults — a lifecycle expiry of **30 days** on the flow-log prefix and **90 days** on the access-log prefixes. Two notes for whoever picks this up: the log bucket itself will fire `S1` (a log target cannot log to itself — S3 rejects it, and it would recurse), so it needs its own accepted register entry; and one bucket serving S3 server access logs _plus_ ALB logs _plus_ flow logs means three different bucket-policy/ACL models, so verify by synth before assuming one bucket works.

### Remaining backlog (62), untouched and not in this pass's triage

| Rule                                                | Count | Note                                                                                                                                                                                                                                                                    |
| --------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IAM4` AWS managed policies                         | 27    | Almost all `AWSLambdaBasicExecutionRole` / `AWSLambdaVPCAccessExecutionRole` / `AmazonECSTaskExecutionRolePolicy`. Replacing them with inline equivalents is mechanical but touches every role; worth one dedicated change                                              |
| `IAM5` residual wildcards                           | 20    | Mostly `Resource::*` on ECS task _execution_ roles (CDK-generated ECR/logs grants) and the recipe/identity API task roles' `grantRead`/`grantDelete` on the shared buckets — the **same over-grant just fixed in recipe-workers**, and the next highest-value narrowing |
| `EC26` / `EC28` / `EC29`                            | 3     | The `t4g.nano` NAT instance: unencrypted EBS, no detailed monitoring, no termination protection. ADR-0004 owns this resource                                                                                                                                            |
| `RDS11` default endpoint port                       | 1     | Changing 5432 breaks every consumer's config; low value                                                                                                                                                                                                                 |
| `APIG2` no request validation                       | 1     | The webhook body is validated by svix + the handler's own parsing                                                                                                                                                                                                       |
| `CFR3` no CloudFront access logging                 | 1     | The router is being retired for previews (ADR-0001)                                                                                                                                                                                                                     |
| `S1`, `ELB2`, `VPC7`, `SMG4`, `RDS3`, `RDS10`, `L1` | 9     | Deferred / escalated / not-ours, as above                                                                                                                                                                                                                               |

### Two unrelated defects found in passing (reported, not fixed)

- **`packages/services/recipe-workers/dist/tsconfig.tsbuildinfo` (390 KB) and `dist/scripts/` ship inside all six recipe-workers Lambda assets**, because `Code.fromAsset(DIST_PATH)` points at the whole `dist/`. A TypeScript incremental-build cache is not deployable code, and including a build artifact in the asset makes the asset hash — and therefore `Code.S3Key` in the prod template — churn on unrelated rebuilds, adding noise to exactly the prod diff review ADR-0002 makes load-bearing.
- **`packages/services/{identity,identity-webhooks}/cdk.context.json` pin a prod VPC id that no longer exists** (`vpc-0ec22fac8e09a5751`; the live `KitchenSink-prod` VPC is `vpc-007a83efa4b118d25`). It is currently harmless because CI passes `IDENTITY_VPC_ID` from a live lookup, so the stale cache entry is never hit — but a `--lookups false` synth of those apps resolves against a VPC that is gone.
