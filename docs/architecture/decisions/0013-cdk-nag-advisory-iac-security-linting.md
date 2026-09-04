# 0013 — cdk-nag on every CDK app, ADVISORY (warnings only), with a byte-identical-template guarantee

- **Status:** Accepted — implemented. `attachSecurityChecks(app)` is called from all ~~seven~~ **eight** CDK app entrypoints; findings are reported as CDK warnings. **Burn-down pass #1 is done (115 → 62) — see "Update (2026-08-07)" for the record, the three escalations awaiting an owner decision, and the remaining backlog.**
- **Date:** 2026-08-07
- **Area:** IaC security · CDK Aspects · prod-template stability
- **Related:** `docs/architecture/decisions/0002-vpc-consolidation-and-cidr-scheme.md` (no-prod-diff), `0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md` (no-prod-diff), `packages/infra/security/**`, ~~`packages/infra/global/__tests__/cdk-nag-{attachment,template-parity,synth.integration}.test.ts`~~, `packages/infra/global/tests/nagRulesAtZero.integration.test.ts`

> ⚠️ STALE (2026-09-04) — two corrections to the header, both of which a reader greps and fails on.
>
> 1. **There are EIGHT CDK app entrypoints, not seven.** `ingredient-parser` joined
>    ([ADR-0025](0025-ingredient-parser-python-deployable.md)) and is pinned in `KNOWN_ENTRYPOINTS`
>    (`packages/infra/global/__tests__/cdkNagAttachment.test.ts:41-50`) alongside the other seven. Later
>    sections of this ADR already say "all eight apps"; the header, Context and Update (2026-08-07) still say
>    seven, and in the historical sections that is correct **as history** (seven was the count at adoption).
>    The Status line is a present-tense claim, so it is the one that is wrong.
> 2. **The three guard files are named `cdkNag*`, not `cdk-nag-*`, and one of them is in `tests/`, not
>    `__tests__/`.** The real paths are `packages/infra/global/__tests__/cdkNagAttachment.test.ts`,
>    `packages/infra/global/__tests__/cdkNagTemplateParity.test.ts` and
>    `packages/infra/global/tests/cdkNagSynth.integration.test.ts` (the `tests/` directory is this repo's
>    integration tier). The brace-expansion spelling above resolves to nothing on disk. The same wrong
>    spelling appears once more, under "The test contract changed, deliberately".

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
3. **One wiring point, discovery-enforced.** The posture lives in one function, and `cdkNagAttachment.test.ts` walks the workspace for CDK apps (parsing each entrypoint with the TypeScript compiler, not regex) and fails if any discovered app does not call it, attaches a raw `AwsSolutionsChecks`, or omits the dependency. A new CDK app cannot ship unreviewed.
4. **Zero suppressions at adoption.** Because a suppression mutates the template, the advisory-first change carries none; the byte-identical guarantee and a suppression are mutually exclusive in one commit. cdk-nag itself rejects a `reason` under 10 characters at the call site, so a suppression can never be added without a stated justification. **Superseded by burn-down #1** — suppressions now exist, they go through the `AcceptedNagFindings` register, and "zero suppressions" became an explicit allowlist. See the 2026-08-07 update.
5. **Compliance reports stay on** (cdk-nag's default): one `AwsSolutions-{stack}-NagReport.csv` per stack in `cdk.out`, which is the burn-down inventory for free.

## Consequences

**Positive**

- Every stack in every app is now security-reviewed on every synth, including per-PR previews, with no deploy risk.
- The no-prod-diff line is now _asserted_, not merely intended: `cdkNagTemplateParity.test.ts` compares full template JSON per stack, with and without the Aspect, for prod and sandbox — and includes a negative control proving the comparison detects a mutating Aspect.
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

- `packages/infra/security/src/attachSecurityChecks.ts` carries the "annotation-only, and a suppression is NOT" rationale at the wiring point.
- `packages/infra/global/__tests__/cdkNagTemplateParity.test.ts` — byte-identical prod + sandbox templates, per stack, plus "a suppression would show up here" (`no cdk_nag metadata`) and a mutating-Aspect negative control.
- ~~`packages/infra/global/__tests__/cdkNagSynth.integration.test.ts`~~ — ⚠️ STALE (2026-09-04): it lives in the integration tier, at `packages/infra/global/tests/cdkNagSynth.integration.test.ts` — a real `cdk synth` at prod and sandbox: exit 0, warnings present, no CLI error line. This is the only tier that can catch the ERROR→exit-1 regression, because it is a property of the CLI, not of in-process synthesis.
- `packages/infra/global/__tests__/cdkNagAttachment.test.ts` — discovery-based; also pins the known entrypoint set so a broken walk cannot pass silently.

---

## Update (2026-08-07) — burn-down #1: 115 → 62, and three escalations

The first burn-down pass. **115 findings → 62** across the seven prod apps, with zero cdk-nag errors and every app still synthesizing `exit 0`. Advisory mode is unchanged; nothing was promoted to blocking.

### Where the 53 went

| Rule                                   | Before | After  | Disposition                                                                                                 |
| -------------------------------------- | ------ | ------ | ----------------------------------------------------------------------------------------------------------- |
| `L1` non-latest Lambda runtime         | 19     | **2**  | **FIXED** — `nodejs24.x`                                                                                    |
| `SQS4` / `SNS3` no TLS-only policy     | 13     | **0**  | **FIXED**, and since 2026-09-03 **MECHANISED** — see the two updates below; the zero regressed once first   |
| `ECS2` plaintext task env              | 5      | **0**  | Accepted (re-verified)                                                                                      |
| `IAM5` wildcards                       | 31     | **20** | 11 removed by **narrowing real over-grants**; the residual object-key wildcard accepted with a scoped regex |
| `EC23` `0.0.0.0/0` on the ALB SG       | 1      | **0**  | Accepted (ADR-0003)                                                                                         |
| `APIG4` + `COG4` unauthenticated route | 2      | **0**  | Accepted (svix HMAC verified in the Lambda)                                                                 |
| `APIG3` / `CFR1` / `CFR2` WAF + geo    | 3      | **0**  | Accepted — deferred on cost proportionality                                                                 |
| `SMG4` no secret rotation              | 2      | **1**  | `MigrationPlanSecret` accepted; `DatabaseCredentialsSecret` **ESCALATED**                                   |

⚠️ **This paragraph is the 2026-08-07 record and its first sentence is no longer true** — those two findings
cleared on an `aws-cdk-lib` bump, unnoticed until the 2026-09-03 census. The reasoning it states is still the
reasoning in force; see "the WHOLE table becomes a control" below for what `L1` is today.

The 2 remaining `L1` findings are CDK's own `custom_resources.Provider` framework functions. `Provider` calls `lambda.determineLatestNodeRuntime(this)` and exposes no runtime prop, so they are not ours to set. They are left **reporting** deliberately: the finding is accurate, it clears itself on an `aws-cdk-lib` bump, and suppressing it would write template metadata onto the prod data stack in exchange for hiding a genuinely stale runtime later.

`AwsSolutions-L1` was described above as "a recurring, low-value 19-finding block of noise". That framing was wrong, and the correction is worth recording: the repo pins `engines.node: 24.x`, so **every test, lint and local command ran on Node 24 while all nineteen deployed Lambdas ran `nodejs22.x`**. The code was verified on one Node major and executed on another. The runtime is now one pinned constant (`NODE_LAMBDA_RUNTIME`, `@kitchensink/infra-security`) whose own suite asserts it equals both the newest Node runtime `aws-cdk-lib` exposes (computed the way cdk-nag's `LambdaLatestVersion` computes it, then confirmed _through the real pack_) and the `engines.node` major. The next CDK bump that ships a newer runtime therefore fails **one test, in the PR that caused it**, instead of silently re-firing nineteen warnings — the treadmill, closed. Evidence the move is safe: all 25 built handler bundles import cleanly under Node 24.16.0 (esbuild targets `node22`, a forward-compatible downlevel), and `nodejs24.x` is present in the live Lambda API's runtime enum.

### The test contract changed, deliberately

~~`cdk-nag-{template-parity,synth.integration}.test.ts`~~ (⚠️ STALE (2026-09-04): the real names are `__tests__/cdkNagTemplateParity.test.ts` and `tests/cdkNagSynth.integration.test.ts`) asserted that **no** prod template contained `cdk_nag`. That was the correct contract at zero suppressions, and it is unsatisfiable once suppressions exist — so the only way to "keep it passing" would have been to delete it, dropping the control at the exact moment it starts mattering.

It is now an **allowlist**: `EXPECTED_PLATFORM_SUPPRESSIONS` is an exact, closed inventory of `stack/logicalId → ruleId`, plus an assertion that every reason is readable. Same guarantee — no unreviewed suppression reaches a prod template — but it fails loudly and names the resource.

Two properties are now separated, and both still hold:

1. **cdk-nag still changes no synthesized output.** A suppression is written by the _stack constructor_ (`acceptNagFindings(...)`), not by the Aspect, so the byte-identical-with-and-without-the-Aspect proof that ADR-0002/ADR-0008 depend on is intact. `'records the same set with the Aspect detached'` pins that distinction.
2. **The suppression set is fixed.**

### Three traps found while doing this — do not re-introduce them

- **A suppression `reason` containing any codepoint above 255 is base64-encoded into the template.** `NagSuppressionHelper.toCfnFormat` sets `is_reason_encoded: true` and replaces the whole string. One em-dash — and this repo's prose style uses them everywhere — turns the justification into an opaque blob in the CloudFormation template _and in the prod `cdk diff` a human approves_. The entire value of a suppression is that the next engineer can read the argument and disagree with it. Reasons are ASCII/Latin-1 only, asserted in two suites.
- **`sns.Topic({ enforceSSL: true })` on a topic that already has a hand-built `sns.TopicPolicy` emits a SECOND `AWS::SNS::TopicPolicy`.** That resource maps onto `SetTopicAttributes(Policy=…)`, which _replaces_ the document, so two of them is last-writer-wins. On `CostAlertTopic` that would have silently dropped the AWS Budgets / Cost Anomaly Detection publish grants — the alerting ADR-0008 exists to provide — with no symptom other than alerts that never arrive. The deny statement joins the existing document there instead. SQS has no such hazard: `Queue.addToResourcePolicy` reuses one singleton policy.
- **In an `appliesTo` regex, the partition segment must be matched with `.*`, not `[^:]+`.** CDK renders it as the `<AWS::Partition>` pseudo-parameter, which _contains colons_. The colon-excluding form matches a hardcoded `arn:aws:…` — so it passes a naive unit test — and matches nothing in any real stack. Measured: five findings kept reporting. The regression guard builds its probe with `bucket.arnForObjects()`, the way production does.

### ⛔ ESCALATED — owner's call, deliberately left as-is

Three findings are real risks that cdk-nag is right about, whose resolution is a business trade-off rather than an engineering one. ~~**Nothing was changed for any of them.**~~ Costs are us-east-1; the RDS instance rates were queried live from the AWS Pricing API, storage and WAF rates are published list prices.

> ⚠️ STALE (2026-09-04): "nothing was changed for any of them" is true of #2 (`RDS3`) and #3 (`SMG4`) and
> **false of #1** — `RDS10` was subsequently FIXED. See the mark on #1.

#### 1. `RDS10` — deletion protection disabled on `Data-prod/Database`

~~Today: `deletionProtection: false`, `removalPolicy: DESTROY`, **no final snapshot**.~~ A stack delete, a construct-ID change that replaces the instance, or a CIDR change (ADR-0002) destroys production data with no recovery path.

> ⛔ FALSE (2026-09-04): `deletionProtection` is **`true`**
> (`packages/infra/global/lib/platform/DataStack.ts:267`), so the escalation's recommendation was taken and
> the finding has cleared — the backlog table further down already records `RDS10` at **0** ("the escalated
> deletion-protection finding has CLEARED and nothing said so"). What is still accurate: `removalPolicy`
> remains `RemovalPolicy.DESTROY` (`DataStack.ts:269`, left as-is deliberately — the in-code comment says
> flipping it to `RETAIN` is a separate decision), and there is still no final snapshot. So the
> option-table row that was chosen is `deletionProtection: true` at $0, and the rows below it are still
> open decisions.

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

- `IdentityServiceStack.ts` injects the password with `ecs.Secret.fromSecretsManager(dbCredentialsSecret, 'password')`. ECS resolves that **at task start** and hands it to the container as an environment variable for the task's whole lifetime.
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

### Remaining backlog (74), ASSERTED — see the 2026-09-03 census update below

⚠️ **These numbers are now a CONTROL, not a note.** `nagRulesAtZero.integration.test.ts` runs the real rules
over every synthesizable app and asserts this table row by row, by EQUALITY. A burn-down that lands reds it
until the row is updated in the change that earned it; a regression reds it too; and a rule that starts
reporting and is not named here reds a third assertion. Editing a count without the measurement to back it is
now a failing build rather than a stale sentence. The heading's total must equal the rows' sum — that is
asserted as well.

| Rule                                          | Count | Note                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IAM4` AWS managed policies                   | 33    | Almost all `AWSLambdaBasicExecutionRole` / `AWSLambdaVPCAccessExecutionRole` / `AmazonECSTaskExecutionRolePolicy`. Replacing them with inline equivalents is mechanical but touches every role; worth one dedicated change. Was 27 on 2026-08-07; `EdgeStack` and the recipe tier added six                                                                                                |
| `IAM5` residual wildcards                     | 21    | Mostly `Resource::*` on ECS task _execution_ roles (CDK-generated ECR/logs grants) and the recipe/identity API task roles' `grantRead`/`grantDelete` on the shared buckets — the **same over-grant fixed in recipe-workers**, and the next highest-value narrowing. Was 20                                                                                                                 |
| `EC26` / `EC28` / `EC29`                      | 3     | The `t4g.nano` NAT instance: unencrypted EBS, no detailed monitoring, no termination protection. ADR-0004 owns this resource                                                                                                                                                                                                                                                               |
| `RDS11` default endpoint port                 | 1     | Changing 5432 breaks every consumer's config; low value                                                                                                                                                                                                                                                                                                                                    |
| `APIG2` no request validation                 | 1     | The webhook body is validated by svix + the handler's own parsing                                                                                                                                                                                                                                                                                                                          |
| `CFR3` no CloudFront access logging           | 4     | ⚠️ **1 TRUE, 3 FALSE POSITIVES.** The true one is the sandbox router, which genuinely logs nothing (being retired for previews, ADR-0001). `EdgeStack`'s three DO log — via standard logging **v2**, which cdk-nag cannot see: its rule reads only the legacy `DistributionConfig.Logging` property. Left REPORTING, never suppressed, asserted EXPLAINED — see the 2026-09-03 CFR3 update |
| `ECS4` no Container Insights                  | 3     | ⚠️ **NEW to the table**, on all three ECS clusters. Two of those clusters existed at burn-down #1, so either the rule postdates that pass or the 2026-08-07 census was itself incomplete — nothing recorded then can distinguish the two, which is the whole argument for this table being asserted                                                                                        |
| `S1`, `ELB2`, `VPC7`, `SMG4`, `RDS3`, `RDS10` | 7     | Deferred / escalated, as above. `S1` 2, `ELB2` 1, `VPC7` 1, `SMG4` 2, `RDS3` 1, **`RDS10` 0** — the escalated deletion-protection finding has CLEARED and nothing said so. ⚠️ The `S1` 2 are `DataStack`'s media and archive buckets, which hold USER DATA and stay open; the edge access-log bucket's third `S1` is ACCEPTED separately (2026-09-03) and is not counted here              |
| `L1` non-latest Lambda runtime                | 1     | The Lambda@Edge verifier, pinned to `nodejs22.x` because Lambda@Edge offers no `nodejs24.x`. Left REPORTING and asserted EXPLAINED in both directions — see below. **The 2 CDK `Provider` findings this row used to hold are GONE**                                                                                                                                                        |

### Two unrelated defects found in passing (reported, not fixed)

- **`packages/services/recipe-workers/dist/tsconfig.tsbuildinfo` (390 KB) and `dist/scripts/` ship inside all six recipe-workers Lambda assets**, because `Code.fromAsset(DIST_PATH)` points at the whole `dist/`. A TypeScript incremental-build cache is not deployable code, and including a build artifact in the asset makes the asset hash — and therefore `Code.S3Key` in the prod template — churn on unrelated rebuilds, adding noise to exactly the prod diff review ADR-0002 makes load-bearing.
- **`packages/services/{identity,identity-webhooks}/cdk.context.json` pin a prod VPC id that no longer exists** (`vpc-0ec22fac8e09a5751`; the live `KitchenSink-prod` VPC is `vpc-007a83efa4b118d25`). It is currently harmless because CI passes `IDENTITY_VPC_ID` from a live lookup, so the stale cache entry is never hit — but a `--lookups false` synth of those apps resolves against a VPC that is gone.

## Update (2026-09-03) — the `SQS4` zero REGRESSED, because a burn-down count is not a control

`RecipeParseQueue` and `RecipeParseDlq` (`RecipeWorkersStack`, added with the service parse leg) shipped with
no `enforceSSL`, while their eight siblings in the same file had it. That put the burn-down table's
`SQS4 / SNS3 … 13 → 0 | FIXED` row back to **2**.

⚠️ **Nothing failed, and nothing was going to.** cdk-nag saw it and reported `AwsSolutions-SQS4` against
exactly those two resources — into the advisory channel this ADR deliberately chose, where by construction
nothing gates. The finding sat in `cdk synth` output among the other ~62. **The defect is not that the
warning was missed; it is that a measured outcome was recorded in this table with no mechanism re-checking
it.** A one-time count degrades silently the moment the next queue is written, and the reader of this table
has no way to know whether its "0" is still true.

### What now holds it

`packages/infra/global/__tests__/queueBaselineDeclarations.test.ts` — a repo-wide, SOURCE-derived guard
asserting that every `new sqs.Queue(...)` construction site declares `enforceSSL: true`, `encryption` and
`retentionPeriod`. It enumerates nothing, so a queue written tomorrow joins its subject set that day.

⛔ It is deliberately a SOURCE guard, and the reason is measured rather than aesthetic. Discharging this at
template level means synthesizing every app, and `infrastructureManifest.test.ts` records why that is not
available: every service app calls `ec2.Vpc.fromLookup`, so synth needs credentials and an uncached context;
`RecipeWorkersStack` additionally throws unless the service has been built; and each entrypoint needs between
one and nine environment variables. `transportSecurity.test.ts` keeps the MECHANISM claim (that `enforceSSL`
emits a real deny and that cdk-nag's own rule agrees) for the platform app, and `RecipeWorkersStack.test.ts`
now carries the same mechanism claim, template-derived, for its own ten queues.

⚠️ **Residual, stated plainly:** the source guard is a PROXY for this table's row, not the row itself. Nothing
runs the `SQS4` rule across all seven apps and asserts the count is zero. Declaration implies the policy
(CDK emits it), so the proxy is sound — but a future finding of this class in an app whose queues are not
constructed through `sqs.Queue` would still land in the advisory channel unobserved.

**⛔ That residual is CLOSED — see the next section. Read it before citing the paragraph above.**

## Update (2026-09-03, later) — the row is now MECHANISED: the real rules run over every app

The residual above ("nothing runs the `SQS4` rule across all seven apps and asserts the count is zero") is
discharged by `packages/infra/global/tests/nagRulesAtZero.integration.test.ts`. Owner ruling, same day, on
whether any queue or topic should be exempt from TLS enforcement: **no — enforce it everywhere, and make the
burn-down a control rather than a number in a table.**

### The finding that came first: nothing needed enforcing

Every queue and every topic in the repository ALREADY declares its TLS deny — **12 queues and 7 topics, all
19 compliant**, verified by running the rules rather than by reading the source. The two parse queues were
the whole regression and they were fixed hours earlier. So this change adds **no** `enforceSSL` and moves
**no** synthesized template; `cdkNagTemplateParity.test.ts` and every stack snapshot are untouched, by
construction rather than by inspection. `CostAlertTopic` is compliant through the hand-built deny statement
in its existing `TopicPolicy` (the trap recorded above), which the rule accepts — now asserted rather than
assumed.

### What the control actually does

It discovers the CDK apps from `cdkApps()` (content-derived, the same reading `cdkAppDeployCoverage.test.ts`
uses), runs each entrypoint in a child process, and reads cdk-nag's own
`AwsSolutions-…-NagReport.csv` compliance reports out of the emitted cloud assembly. For every rule in
`RULES_AT_ZERO` it asserts that every row is `Compliant` — so `Non-Compliant`, `Suppressed` and `UNKNOWN` all
red. `RULES_AT_ZERO` is the register this ADR's table has been missing: **a rule joins it the day its
burn-down reaches zero, in the change that lands that zero**, and from then on the table's number is an
assertion. `SNS3` and `SQS4` are its first two members.

⛔ **The premise the earlier guards settled for is measured FALSE.** They cited
`infrastructureManifest.test.ts`'s "synth needs AWS credentials and an uncached context …". `CDK_CONTEXT_JSON`
pre-seeds the context-provider cache so `Vpc.fromLookup` never calls AWS (the trick `recipe-workers`'
own app-synth spec already used); `CDK_OUTDIR` redirects the assembly; the environment variables are ONE
shared block of ~20 keys, because no two entrypoints disagree about what a key means. ~~All eight apps
synthesize with **no credentials and no network**, at prod, in ~15 s.~~

> ⛔ FALSE (2026-09-04): **SEVEN** of the eight apps synthesize — `ingredient-parser` does not, and the very
> next section of this ADR says so ("`ingredient-parser` is not synthesized … it refuses until
> `python3 -m pip` fetches ~90 MB of arm64 wheels"). The exclusion is explicit in the suite itself, in
> `UNSYNTHESIZABLE` (`packages/infra/global/tests/nagRulesAtZero.integration.test.ts:247-252`). Everything
> else in the sentence — no credentials, no network, at prod, ~15 s — holds for those seven.

### The two honest limits, and the assertion that keeps each honest

| Limit                                                                                  | Why                                                                                                         | What stops it being a hole                                                                                                                               |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthesizes at ONE stage (`prod`), so stage-conditional resources elsewhere are unseen | Two stages doubles the cost for resources that today differ only in `SandboxSchedulerStack` and `EdgeStack` | The rule census must be ≥ the SOURCE census (`messagingConstructSites.ts`). A queue that exists only at another stage raises one and not the other → red |
| `ingredient-parser` is not synthesized                                                 | It refuses until `python3 -m pip` fetches ~90 MB of arm64 wheels from PyPI (ADR-0025)                       | Same census comparison. **Proven by mutation**: a queue added there reds with `expected 12 to be >= 13`; a topic, `expected 7 to be >= 8`                |

### Mutation evidence (every claim above was made to fail)

| Mutation                                                         | Result                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Drop `enforceSSL` from `RecipeParseQueue`                        | `reports only Compliant rows for AwsSolutions-SQS4` reds, naming the resource AND the app |
| Drop `enforceSSL` from `FoodAlarmTopic`                          | `…for AwsSolutions-SNS3` reds — coverage NO source guard had, since none reads topics     |
| Add an `acceptNagFindings` SQS4 suppression to a COMPLIANT queue | Still green, correctly: cdk-nag reports `Compliant`; there was nothing to hide            |
| …the same suppression on a queue whose `enforceSSL` was dropped  | Reds with `Suppressed …` — a suppression cannot launder a rule held at zero               |
| Add a queue / a topic to the unsynthesized `ingredient-parser`   | The census comparison reds in both directions                                             |

Its own negative control is a fixture app with a bare `Queue` and a bare `Topic`, synthesized in-process
through the real `attachSecurityChecks` and read with the same reader — so "no non-compliant row" cannot be
satisfied by a reader that found nothing, a pack that never attached, or a rule that stopped evaluating.

### What is now MECHANISED versus merely MEASURED

| Burn-down row                                                                                 | Status                                                                                         |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `SQS4` / `SNS3` = 0                                                                           | **MECHANISED** — asserted per-app by `nagRulesAtZero.integration.test.ts` on every CI run      |
| `L1` (2 residual, CDK's own `Provider` functions)                                             | MEASURED — and additionally pinned by `lambdaRuntime.ts`'s own suite                           |
| `ECS2`, `EC23`, `APIG4`/`COG4`, `APIG3`/`CFR1`/`CFR2` (router; `EdgeStack` joined 2026-09-03) | MEASURED — accepted via the register; the register's key set and the prod allowlist are pinned |
| `IAM4` (27), `IAM5` (20), `EC26`/`EC28`/`EC29`, `RDS11`, `APIG2`, `CFR3`                      | MEASURED only — a count in a table, with nothing re-checking it                                |
| `S1`, `ELB2`, `VPC7`, `SMG4`, `RDS3`, `RDS10`                                                 | MEASURED only — deferred / escalated, above                                                    |

⚠️ **Residual, stated plainly.** (1) Only rows at zero can join `RULES_AT_ZERO`, so the un-burnt-down majority
of the table is still a measurement — the mechanism now exists, but each row still needs its burn-down.
**Superseded hours later by the census below, which mechanises the un-burnt-down rows without burning them
down.** (2) The census cross-check bounds the two limits above by COUNT, not by identity: it would not notice
a stage-only queue being swapped for a differently-named one, only a change in how many exist. (3) The
suite's own numbers for that comparison come from `queueBaselineDeclarations.test.ts`'s reader, so a defect in
that AST reading weakens the cross-check — which is why that reader keeps its own per-property negative
control.

## Update (2026-09-03, later the same day) — the WHOLE table becomes a control, and it had already rotted

The residual above said the un-burnt-down rows "still need their burn-down" before they could be asserted.
That conflated two things. A rule at **zero** can be asserted by a predicate (`no non-Compliant row`); a rule
at **twenty** can be asserted by a **census** (`exactly twenty non-Compliant rows`). The second needs no
burn-down at all — it needs a number and something that re-measures it.

So `nagRulesAtZero.integration.test.ts` gained a second half. It reads **this ADR's own backlog table** as the
authority — parsing the rows out of the markdown rather than re-listing the rules in the suite, because a copy
of the numbers would rot exactly as the numbers did — and asserts three things over the same synthesis
`RULES_AT_ZERO` already performs, so the whole control costs no extra CDK runs:

1. **Every rule reporting a finding appears in the table.** The subject set is what cdk-nag ACTUALLY reported,
   not what the table remembered to list, so a rule that starts firing on a resource class nobody has thought
   about cannot slip in behind a table that never mentioned it.
2. **Every row is held at its recorded count, by EQUALITY.** A ceiling (`≤`) was the obvious choice and is the
   weaker one: it lets the written number drift above reality forever, so a burn-down that actually lands
   leaves the ADR overstating it with nothing to say so. Equality flips in both directions — an improvement
   reds the suite just as a regression does, which is what forces the table to move in the change that earns
   it.
3. **The rows sum to the total in the heading.** Nothing checked the table against itself either.

### What it found the moment it existed

**The table was wrong in five places and incomplete in four**, 27 days after it was written. Every number
below is measured, at `prod`, through the real pack:

| Row                          | Recorded | Measured | What happened                                                                                                                                                                                                 |
| ---------------------------- | -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IAM4`                       | 27       | **33**   | `EdgeStack` (2026-08-16) and the recipe tier added roles                                                                                                                                                      |
| `IAM5`                       | 20       | **21**   | one more wildcard                                                                                                                                                                                             |
| `CFR3`                       | 1        | **4**    | `EdgeStack`'s three production distributions, none of them the sandbox router the row is about                                                                                                                |
| `S1`…`RDS10`, `L1` (grouped) | 9        | **8**    | `RDS10` cleared to 0 (escalated, then fixed, unrecorded) and `L1` fell from 2 to 1                                                                                                                            |
| `CFR1` / `CFR2`              | —        | **6**    | Table A records these at **0**, accepted via the register — which applies to `SandboxRouterStack` only. `EdgeStack`'s three do not carry it. **TRIAGED 2026-09-03 — accepted under their OWN key; see below** |
| `CFR4`                       | —        | **3**    | never triaged in any pass. **⛔ SUPERSEDED — this was a defect in the MEASUREMENT, not a finding. See below**                                                                                                 |
| `DDB3`                       | —        | **1**    | `MessageSubstrateStack`'s table (2026-08-16). **TRIAGED 2026-09-03 — accepted; see below, and note the stated reason is NOT the one first proposed**                                                          |
| `ECS4`                       | —        | **3**    | all three ECS clusters                                                                                                                                                                                        |

Two of those deserve emphasis.

⛔ **`CFR1`/`CFR2` are not covered by the acceptance that Table A records.** The register entry
`CLOUDFRONT_EDGE_CONTROLS_NOT_PROPORTIONATE` argues cost-proportionality for a _sandbox preview router_ and
says in its own words: _"REVISIT if the router ever fronts production."_ `EdgeStack` fronts production. The
entry was never applied to it — correctly, since nobody re-argued it — so the findings report, and until
2026-09-03 nothing said so. **Owner triage is owed** on `CFR1`/`CFR2`/`CFR3`/`CFR4` for `EdgeStack`, and on
`DDB3` for the message substrate. They are recorded here as measured and untriaged, NOT as accepted: writing a
finding into a table is not a decision about it.

⚠️ **`ECS4` fires on clusters that existed at burn-down #1.** Either the rule postdates that pass, or the
2026-08-07 census was itself incomplete. Nothing recorded then can distinguish the two — which is precisely
the argument for a table that is re-measured rather than remembered.

### `L1` is now EXPLAINED in both directions, on ADR-0025's precedent

The `L1` row's own prediction came true and nobody noticed: **the two `custom_resources.Provider` findings
have cleared** on an `aws-cdk-lib` bump, exactly as the 2026-08-07 note said they would. What is left is ONE
finding, on the Lambda@Edge viewer-request function, which is pinned to `nodejs22.x` because **Lambda@Edge
offers no `nodejs24.x`** — the repo-wide `NODE_LAMBDA_RUNTIME` cannot be used there.

That is the same shape ADR-0025 §4 records for the Python CRF parser, and it gets the same treatment: left
**reporting**, never suppressed, with the assertion made about the EXPLANATION rather than the count —

```
findings.some(isEdgeVerifier) === (EDGE_LAMBDA_RUNTIME.name !== NODE_LAMBDA_RUNTIME.name)
```

— total in both directions, so the day Lambda@Edge ships the pinned runtime the finding must be GONE and the
row must come out of the table, with nobody having to remember to check. An `L1` on any other function we
control is not covered by either exemption and reds as unexplained.

> ⚠️ STALE (2026-09-04) — **the `L1` count of 1 is a census over seven apps, and there is a SECOND accepted
> `L1` it cannot see.** [ADR-0025](0025-ingredient-parser-python-deployable.md) pins the CRF parser to
> `python3.13` (`latestPythonRuntimeBelow(ENGINE_PYTHON_CEILING)`, because
> `ingredient-parser-nlp==2.3.0` declares `Requires-Python: <3.14`) while `aws-cdk-lib` already exposes
> `python3.14`, and records that its `AwsSolutions-L1` finding is likewise left **REPORTING and must not be
> suppressed**. Because `ingredient-parser` is in `UNSYNTHESIZABLE`, that finding never reaches this census —
> so the row's `1` and the "reds as unexplained" clause are both scoped to the seven apps that DO synthesize,
> and neither contradicts ADR-0025. ⚠️ But the day `ingredient-parser` becomes synthesizable here, the
> unexplained-`L1` assertion above will red on the Python function unless `EDGE_VERIFIER` /
> `CDK_PROVIDER_FRAMEWORK` gains a third explained class. Recorded so that is a decision rather than a
> surprise.

### What is now MECHANISED versus merely MEASURED — revised

| Burn-down row                                                                                                  | Status                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `SQS4` / `SNS3` / `CFR4` = 0                                                                                   | **MECHANISED** — asserted at zero, per app, every CI run                                                   |
| `L1` (1 residual, the Lambda@Edge verifier)                                                                    | **MECHANISED** — count asserted, AND explained in both directions against the runtime pins                 |
| Every other backlog row (`IAM4`, `IAM5`, `CFR3`, `ECS4`, `EC26`/`EC28`/`EC29`, `RDS11`, `APIG2`, `S1`…`RDS10`) | **MECHANISED** — held at the count above by equality, with the rule set derived from what actually reports |
| `ECS2`, `EC23`, `APIG4`/`COG4`, `APIG3`, `CFR1`/`CFR2`, `DDB3`                                                 | MEASURED — accepted via the register; the register's key set and the prod allowlist are pinned             |

⚠️ **Residual, revised.** (1) The census counts findings, not resources — two findings on one resource read as
two, which is the right unit for a burn-down but not for "how much is left to fix". (2) It measures at `prod`
and skips `ingredient-parser`, inheriting both limits above; a finding that exists only at another stage is
still invisible, and the queue/topic cross-check bounds only those two rules. (3) The counts are now a
maintenance obligation: any change that adds a role, a distribution or a table reds this suite until the table
moves with it. That is the intended cost — it is what makes the number mean something — but it will read as
noise to someone who has not read this section. (4) **Four rules are recorded as measured and untriaged**
(`CFR1`, `CFR2`, `CFR4`, `DDB3`, plus `CFR3` on `EdgeStack`); they are findings on production edge
infrastructure and a dispositions pass is owed on them. **⛔ ALL FIVE ARE NOW TRIAGED — superseded by the four
updates below.** `CFR4` was a measurement artifact; `CFR1`/`CFR2` and `DDB3` are accepted under their own
register keys; `CFR3` is FIXED (the three `EdgeStack` findings that remain are false positives from a rule
that reads the legacy property). Nothing on the production edge is untriaged.

## Update (2026-09-03, triage) — `CFR4` was a defect in the MEASUREMENT, and the census now synthesizes what production deploys

⛔ **The three `CFR4` findings were never true of production.** The census spawned each CDK entrypoint with a
deliberately minimal child environment — essentially `PATH`, `HOME` and a block of stubbed coordinates — so
`EDGE_CUTOVER_SERVICES` was **unset**. `publicRecordOwnerFor` reads unset as _"nobody has cut over"_, which is
the correct and deliberate default **for a deploy** and the wrong one **for a census**. `EdgeStack` therefore
computed `claimsPublicName === false`, omitted `domainNames`/`certificate` from all three distributions, and
CloudFront's **default certificate** applied — which forces `MinimumProtocolVersion: TLSv1`. cdk-nag reported
the truth about a template nobody deploys.

Verified against the live account on 2026-09-03: all three production distributions carry their alias and
`TLSv1.2_2021` — `E27S6KQKF1ARBS` (`food.commise.app`), `E3TFQL4RM1J1FZ` (`recipe.commise.app`),
`E3PXHE5PATOILU` (`identity.commise.app`) — as does the sandbox router, `E16KE2M2O5UD4J`.
`.github/workflows/prod-deploy.yml` sets `EDGE_CUTOVER_SERVICES: food,recipe,identity`, and
`prodDeployMigrationOrder.test.ts` already asserts that value equals the full service registry.

### The fix is DERIVATION, not a corrected copy

`packages/infra/global/__tests__/prodDeployEnvironment.ts` reads `prod-deploy.yml` — the only thing that runs
`cdk deploy` against prod, and therefore the authority for what prod deploys with — and returns every
**literal** environment value it declares at workflow or job scope. The census overlays that onto its stubs.
Writing `EDGE_CUTOVER_SERVICES: food,recipe,identity` into the suite instead would have put one fact in two
places, which is the failure this whole table exists to stop.

⛔ **The literal-versus-expression split is the workflow's own, not a heuristic.** A `${{ … }}` value is a
**coordinate** resolved at deploy time from a repository variable, a secret or a live `describe` — a test
cannot know it, must not contact AWS to learn it, and does not need to, because it names _where_ a resource
lives rather than _which_ resources are declared. A **literal** is a **posture decision** the pipeline states
outright (`STAGE: prod`, `EDGE_CUTOVER_SERVICES: …`); those select between _different templates_, so a synth
that stubs them is not synthesizing the deployed shape at all.

⚠️ **Note the shape of the hole, because it is the general case.** An environment variable with a **safe
default** is invisible to `HERMETIC_ENV`'s "an app that starts reading a key nobody supplies fails LOUDLY"
mechanism: it does not fail, it silently synthesizes the other branch. Deriving _every_ literal rather than
naming the one key we knew about is what closes this for the next posture flag as well as for this one.

### Measured before / after — the only row that moved is `CFR4`

Both censuses ran the real pack over ~~all eight synthesizable apps~~ at `prod`; the only difference is the
overlay. Every other rule is byte-identical, resource for resource, not merely equal in count.

> ⛔ FALSE (2026-09-04): **seven**, not eight. The repository has eight CDK apps and only seven of them are
> synthesizable by this suite — `ingredient-parser` is listed in `UNSYNTHESIZABLE`
> (`packages/infra/global/tests/nagRulesAtZero.integration.test.ts:247-252`), which this ADR's own "two honest
> limits" table and its revised residual both state. Every count in the table below, and every count in the
> backlog table above, is therefore a census over **seven** apps.

| Rule                                                                                                                                       | Stubbed posture (before) | Deployed posture (after) |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------ |
| `CFR4`                                                                                                                                     | 3                        | **0**                    |
| `IAM4`, `IAM5`, `CFR1`, `CFR2`, `CFR3`, `DDB3`, `ECS4`, `APIG2`, `EC26`/`EC28`/`EC29`, `RDS11`, `RDS3`, `S1`, `SMG4`, `VPC7`, `ELB2`, `L1` | unchanged                | unchanged                |
| **Total non-compliant**                                                                                                                    | 84                       | **81**                   |

The three findings that disappeared were `Edge/FoodDistribution/Resource`, `Edge/IdentityDistribution/Resource`
and `Edge/RecipeDistribution/Resource`. `CFR4` therefore leaves the backlog table and **joins `RULES_AT_ZERO`**,
where a real regression to CloudFront's default certificate reds against a predicate rather than merely
disagreeing with a number. It is the one member that did not arrive by a burn-down, and the register says so.

⚠️ **Residual.** The overlay makes the workflow win on any key the census also stubs — which is the point, but
it means a literal _coordinate_ added to `prod-deploy.yml` would break the hermetic seal. It would break it
loudly, as a synth failure naming the app, which is the same failure mode `HERMETIC_ENV` already documents for
a key nobody supplies. Anti-vacuity on the reader itself is asserted directly (`EDGE_CUTOVER_SERVICES` must be
present in the overlay) and again indirectly, since a reader that stopped matching would put `CFR4` back to 3
against a table that records 0.

## Update (2026-09-03, triage) — `CFR1` / `CFR2` on `EdgeStack` are ACCEPTED, under their own key

Owner triage. `EdgeStack`'s three production distributions now carry
`AcceptedNagFindings.PRODUCTION_EDGE_GEO_INAPPLICABLE_AND_WAF_DEFERRED`. **Measured: `CFR1` 3 → 0 and
`CFR2` 3 → 0** (they report `Suppressed`, which this table does not count and `RULES_AT_ZERO` would red on —
the same treatment `ECS2`, `EC23`, `APIG4`/`COG4` and `APIG3` already get). Total non-compliant **81 → 75**.
Nothing else moved.

- **`CFR1` (geo restriction) — INAPPLICABLE, not deferred.** Commise is a consumer recipe application with no
  geographic licensing, export-control or data-residency constraint that a country allow/deny list would
  enforce. Enabling one would **deny legitimate viewers by country in order to satisfy a lint** — a
  user-visible outage for every excluded country, blocking no threat this product has, since an attacker is
  not constrained to an origin country and CloudFront geo restriction is not an authorization boundary.
  cdk-nag words the rule as "may require": a prompt to decide. Decided: not required. It carries no revisit
  date; it reopens only if the product acquires a real jurisdictional constraint.
- **`CFR2` (WAFv2) — DEFERRED on cost, pre-launch.** A web ACL is ~USD 5–10/month recurring once rules are
  counted, against ADR-0008's $300/month account budget, for a product with **no users** — measured over 30
  days, all three distributions together served **630 requests** (food 19, recipe 38, identity 573). What
  stands in front of these origins meanwhile: HTTPS-only viewer policy, the Lambda@Edge viewer-request
  function that verifies the Clerk session token before the origin is reached (ADR-0020), and anchored `azp`
  enforcement in the services themselves.

### ⛔ Why this is a SEPARATE register key, and not the router's widened

`SandboxRouterStack` carries `CLOUDFRONT_EDGE_CONTROLS_NOT_PROPORTIONATE`, whose own final sentence is
_"REVISIT if the router ever fronts production."_ `EdgeStack` fronts production — that is the condition, and
it had already fired. Applying the router's key here would **discharge its revisit condition by ignoring
it**, which is precisely how it went stale. So the argument is made here, for these resources, at this risk
level, and is reviewable on its own. `acceptedNagFindings.test.ts` pins the key set, so the new key could not
land without a reviewer seeing the list move.

### ⚠️ Residual: the `CFR2` premise expires and NOTHING here can observe it

`CFR1`'s acceptance is a judgement about the control, so it does not rot. **`CFR2`'s does.** Its premise —
pre-launch, no users — is time-limited, and this repository has no signal for "launched", no view of request
volume, and no scheduled re-review. The reopening is therefore an **owner obligation**, recorded in three
places (the register reason, this section, and the call site in `EdgeStack.ts`) precisely because prose with
nothing watching it is the failure mode the router entry demonstrated. **It must be reopened at launch, or on
first evidence of abuse or of meaningful request volume.**

### What holds the acceptance to its shape

| Control                                                                   | What it would catch                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `acceptedNagFindings.test.ts` → 'pins the exact set of accepted findings' | A new suppression key landing unreviewed                                                    |
| `cdkNagTemplateParity.test.ts` → `EXPECTED_PLATFORM_SUPPRESSIONS`         | Any suppression reaching a prod template that is not this exact resource/rule inventory     |
| `EdgeStack.test.ts` → 'accepts CFR1 and CFR2 … and nothing else anywhere' | The suppression migrating onto the Lambda@Edge function, its role or the certificate        |
| `EdgeStack.test.ts` → 'leaves CFR3 REPORTING'                             | The accepted set drifting wider and silently laundering the one finding nobody has ruled on |
| `nagRulesAtZero.integration.test.ts`                                      | The count moving in either direction without this table moving with it                      |

⚠️ `cdkNagTemplateParity.test.ts`'s **'keeps sandbox in step with prod' was REWRITTEN, not weakened.** It
compared the two stages' whole suppression sets, which assumed both stages build the same stacks — and
`kitchensink-edge-prod` is prod-ONLY (`bin/app.ts` gates it on `stage === 'prod'`). The subject set is now the
stacks both stages build, the excluded prod-only stacks are pinned by name, and the shared set is asserted
non-empty so the comparison cannot pass by comparing nothing.

## Update (2026-09-03, triage) — `DDB3` on the message substrate is ACCEPTED, and the FIRST reason offered for it was wrong

Owner triage. `MessageSubstrateStack`'s `MessageTable` **and** `FoodServiceStack`'s per-PR `FoodMessageTable`
now carry `AcceptedNagFindings.MESSAGE_SUBSTRATE_ROWS_OUTLIVE_NOTHING`. **Measured: `DDB3` 1 → 0.** Total
non-compliant **75 → 74**.

### ⛔ The correction, recorded because it is the useful part

The acceptance was proposed on the grounds that the table is a **transient dedup / idempotency substrate**,
"transient by construction" from `timeToLiveAttribute: 'ttl'` plus `RemovalPolicy.DESTROY`. **That
characterisation is false and was not recorded.** Verified against the code:

- **It is not a dedup or idempotency store.** No `ConditionExpression` exists anywhere in the repository, and
  there is no "have I seen X" read or hit/miss branch. The sort key's ULID suffix exists to make a collision
  **impossible** — the opposite of dedup, since `PutItem` REPLACES on an identical `PK+SK` and returns 200.
- **It is a durable, append-only, per-group progress log** with exactly one writer
  (`food-service`'s `DynamoPublisher`, IAM-scoped to `dynamodb:PutItem` on one table ARN), **zero readers**
  (no `Query`/`Get`, no `EventSourceMapping`, no read grant anywhere), and a stream deliberately unattached
  until feature 014.
- ADR-0016 R1.3 does say _"Messages MUST NOT be lost or dropped once accepted"_, so "the rows do not matter"
  would also have been wrong.

⚠️ Writing the dedup framing into the register would have **pinned an inaccurate claim inside a mechanised
guard** — precisely the failure this ADR's own update sections are about. The correction is the reason the
verification step existed.

### The grounds the acceptance actually rests on

1. **DERIVED, not authoritative.** Every row is a doorbell about state that has **already committed to
   PostgreSQL** before the message is published, and PR 91's R2.2 obliges that state to stay readable from the
   database at any time. `OutboundMessage.ts` says it outright — _"nothing downstream is entitled to assume a
   payload exists"_, because a consumer is woken and then **re-queries** the group. Losing a row costs a
   notification, not a fact.
2. **A restore window exceeds the data's own lifetime.** Every write carries a NUMBER-typed `ttl` of
   now + 3 days (`ttlFor`), verified against a real table by `messageSubstrate.integration.test.ts`.
3. **A restore could not be used.** PITR restores into a **new table under a new name**, and this store is
   addressed by a fixed deterministic name (`messageTableNameForStage`) that is also the ADR-0005 teardown
   boundary — so the recovered table would be unreachable by every producer, and at a `pr-{N}` stage outside
   the tag/name scope that reclaims it. ADR-0016 already goes further and accepts **total loss of the
   contents** across a release boundary: _"the substrate is NOT a backfill source for 014 … it does not replay
   the substrate."_

### Both construct sites, and one new assertion

The key is applied at **both** tables. The per-PR twin declares no `pointInTimeRecoverySpecification` at all
and reports the identical finding — but the census measures at `prod` only, so that finding is currently
**invisible, not absent**, and invisible is not decided.

⚠️ Ground (2) rests on a premise the **infrastructure cannot enforce**: `timeToLiveAttribute` tells DynamoDB
which attribute to expire, not anybody to write one, and a second adapter landing without a `ttl` would make
the table grow forever — silently, because the write succeeds and every "TTL is enabled" test keeps passing.
`recipe-import` is already an admitted `groupType` with no code behind it. So the single-writer premise is now
**asserted**, by `messagePublisherWriters.test.ts`: the set of production modules importing a DynamoDB client
is discovered and compared by **equality** to `DynamoPublisher` alone, in both directions, the same shape
`natEgressConsumers.test.ts` uses. A second writer reds it and has to argue its own `ttl`.

⚠️ **Residual.** PITR is the wrong instrument for R1.3 either way — the durability that requirement needs is
DynamoDB's own replicated write, not a restore window — so this acceptance does not discharge R1.3, and
nothing yet does.

## Update (2026-09-03, triage) — `CFR3` is FIXED, and the lint still reports it, on purpose

Owner approval. `EdgeStack`'s three production distributions now deliver access logs to a dedicated S3
bucket. **⚠️ The `CFR3` count does not move: it stays at 4.** That is not a failed fix — it is the honest
outcome of the design choice below, and the row's note now says which of the four findings are true.

| Finding                               | Before                     | After                                                                |
| ------------------------------------- | -------------------------- | -------------------------------------------------------------------- |
| `CFR3` × 3, `EdgeStack` distributions | TRUE — nothing was logging | **FALSE POSITIVE** — logging is on; the rule cannot see it           |
| `CFR3` × 1, `SandboxRouterStack`      | TRUE                       | TRUE, untouched (being retired for previews, ADR-0001)               |
| `S1` on the new access-log bucket     | —                          | **+1, then ACCEPTED** (`ACCESS_LOG_BUCKET_TERMINATES_THE_LOG_CHAIN`) |
| **Total non-compliant**               | 74                         | **74**                                                               |

Nothing else moved — verified resource-for-resource against the previous census, not merely by count. In
particular `IAM4`/`IAM5` did not rise, which was not obvious in advance (see the blind spot below).

### ⛔ Standard logging **v2**, not the legacy path the lint would have accepted

cdk-nag's rule is `CloudFrontDistributionAccessLogging`, and its whole body is:

```ts
if (distributionConfig.logging == undefined) {
    return NagRuleCompliance.NON_COMPLIANT;
}
```

`logging` is the **legacy (v1)** property. So v1 is the path that makes the finding go away and v2 leaves it
reporting. v1 was still rejected, on three grounds that each outrank a quieter lint:

1. **v1 requires ACLs ENABLED on the log bucket.** AWS: _"Don't choose an Amazon S3 bucket with S3 Object
   Ownership set to bucket owner enforced. That setting disables ACLs for the bucket and the objects in it,
   which prevents CloudFront from delivering log files to the bucket."_ Clearing the lint would mean
   **weakening a brand-new bucket** to an access-control model AWS is steering away from. v2 uses a bucket
   policy and no ACL at all.
2. **v1's failure mode is deploy-time, on a stack that cannot be rehearsed.** There is no sandbox `EdgeStack`
   (`bin/app.ts` gates it on `stage === 'prod'`), so its first execution is production. A bucket with ACLs
   disabled synthesizes perfectly clean and is rejected when CloudFront tries to write. v2 adds three
   `AWS::Logs::*` resources and **does not modify the distribution resource at all**.
3. **v1 mutates the bucket ACL out of band** — CloudFront calls `PutBucketAcl` to grant `awslogsdelivery`
   `FULL_CONTROL` — so CloudFormation does not own that grant and `cdk diff` cannot show it drifting.

The accepted cost is the false positive. It is **left REPORTING and never suppressed**, with the assertion
made about the EXPLANATION — ADR-0025's precedent, and this stack's own `L1`. `EdgeStack.test.ts` asserts the
biconditional in substance: the number of `CFR3` findings equals the number of distributions, **and** the
number of deliveries equals the number of distributions. A distribution that quietly lost its delivery keeps
the finding count identical and is caught by the other half. `keeps ACLs DISABLED` additionally pins
`ObjectOwnership: BucketOwnerEnforced` and the absence of a legacy `Logging` block, so a later "fix `CFR3` by
switching to v1" has to change a line in review rather than discover the requirement in production.

### What was built

One bucket (`BlockPublicAccess.BLOCK_ALL`, SSE-S3, `enforceSSL`, `BucketOwnerEnforced`, **90-day lifecycle
expiry**, `DESTROY` + `autoDeleteObjects` matching the house posture), one `AWS::Logs::DeliveryDestination`
shared by all three, and one `DeliverySource` + `Delivery` per distribution with an explicit `addDependency`
— neither `Delivery` property is a `Ref` to the source (one is its NAME, a plain string), so CloudFormation
infers no ordering and would otherwise create the delivery first and fail.

**Cost:** none from CloudFront (_"CloudFront doesn't charge for enabling standard logs"_; _"There are no
additional charges for log delivery to Amazon S3"_) and effectively none from S3 — measured volume is **630
requests across all three distributions over 30 days** (food 19, recipe 38, identity 573), about 0.3 MB/month.
The lifecycle rule exists because CloudFront deletes nothing and that volume is exactly what makes an
unbounded log bucket easy to ship and hard to notice.

### The `S1` the fix ADDED, and why it is accepted rather than chased

Fixing one finding added one: the log bucket has no S3 server access logging of its own. **"Log the reads of
the log" does not terminate** — whatever bucket became this one's target fires `S1` in turn, so the literal
fix is one more bucket per level, forever. The chain ends at the first level.

⚠️ The key is **narrow to a bucket whose contents are logs**. `DataStack`'s media and archive buckets carry
the same finding over **user data**; those two stay open in the table above and are a different decision. And
this is not a claim that access logs are unimportant — they carry client IPs, URIs and user agents, which is
why the bucket is blocked, encrypted, TLS-only, ACL-less and expiring, and why object-level read auditing (if
ever wanted) belongs in CloudTrail data events, which need no target bucket and so do not recurse.

### ⚠️ A cdk-nag blind spot found in passing — the `IAM4` count UNDERSTATES reality

`autoDeleteObjects` creates a role carrying `AWSLambdaBasicExecutionRole`, which should be an `IAM4` finding —
and `IAM4` did not move. The reason: cdk-nag's rule tests `node instanceof CfnRole`, while CDK's
`CustomResourceProvider` emits its role as a **generic `CfnResource` with `type: 'AWS::IAM::Role'`**, which is
not an instance of `CfnRole`. The rule therefore returns `NOT_APPLICABLE` and the role is invisible.

This is **pre-existing** — `DataStack`'s two `autoDeleteObjects` buckets have the same invisible role — and it
is not ours to fix. It is recorded because it bounds what this table's `IAM4` number means: it counts the
roles cdk-nag can see, not every role the repository declares. **No new decision is made here.**
