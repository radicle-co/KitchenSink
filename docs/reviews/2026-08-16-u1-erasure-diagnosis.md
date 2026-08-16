# U1 — Is the erasure failure provisioning, a stale deploy, or a code defect?

**Date** 2026-08-16 · **Plan** `docs/plans/2026-08-15-001-feat-pr91-foundation-hardening-plan.md` U1 ·
**Requirements** R3.1, R3.2 · **Method** read-only AWS describes against account `040663841500`,
us-east-1, profile `default`, plus source reading. No resource was modified by this investigation.

U1 exists to stop U2 from writing erasure code against a guess. The answer is that **the three symptoms
have three different causes, and none of them is a code defect in the erasure path.** One is a stale
documentation status, one is a scheduling collision, one is a stale production deploy.

---

## Symptom 1 — "prod erasure provisioning is missing"

**Verdict: NOT a defect. Provisioning is COMPLETE and self-consistent. The RUNBOOK is stale.**

`docs/runbooks/cr-002-erasure-key-provisioning.md` states **"prod — NOT DONE."** That is no longer true.
All four prod values exist, and the keypair actually verifies:

| Value                                                       | State                                       |
| ----------------------------------------------------------- | ------------------------------------------- |
| `kitchensink/prod/erasure/keys` (Secrets Manager)           | exists; `SIGNING_KEY` is a PKCS#8 PEM       |
| `/kitchensink/prod/recipe/service-principal-jwt-public-key` | exists                                      |
| `/kitchensink/prod/food/service-principal-jwt-public-key`   | exists                                      |
| `/kitchensink/prod/erasure/{recipe,food}-base-url`          | exist — `https://{recipe,food}.commise.app` |

Presence is not correctness, so the halves were checked against each other rather than merely counted.
Deriving the public key from the stored private key with `crypto.createPublicKey` and comparing to each
SSM parameter:

- key type `ed25519` ✅
- recipe SSM public key **matches** the private key ✅
- food SSM public key **matches** the private key ✅
- both services hold the **same** public key ✅

So the "internal erasure route returns 401" failure mode in the runbook's own table **cannot** be the
prod cause: the verifiers hold the minter's actual public half.

**Action for U2:** none to the credentials. **Correct the runbook's status line** — leaving "NOT DONE"
in place is what would send the next person provisioning a _second_ keypair over a working one, which
would 401 every in-flight erasure until all three services redeployed.

---

## Symptom 2 — "the erasure-reconciliation Lambda is failing 36 of 38"

**Verdict: NOT provisioning, NOT a code defect. A SCHEDULE COLLISION, and it is SANDBOX-ONLY.**

Two corrections to the premise before the cause. First, **the failing Lambda is in sandbox, not
production** — `22-adversarial-reliability.md:529` says so explicitly ("the sandbox
erasure-reconciliation Lambda is failing 36/38") and the plan's U1 line drops the word "sandbox". Second,
the reporter recorded that they **did not read the actual exception** (`22-…:637`). It has now been read.

**Production is healthy.** `ErasureReconciliationFunction` (prod) runs 1×/day, **0 errors** across the
last 30 days. The deletion worker: 2 invocations, 0 errors.

**Sandbox fails every single run**, and the shape is diagnostic — exactly **3 errors/day, every day**,
which is one scheduled invocation plus Lambda's two async retries. It began ~14 days ago and is ongoing.

The cause is a collision between two independently-correct decisions:

| Fact                                                                 | Source                                       |
| -------------------------------------------------------------------- | -------------------------------------------- |
| Sandbox RDS is **stopped 00:00–09:00 America/New_York**              | ADR-0007, `SandboxSchedulerStack.ts:141-157` |
| The reconciliation rule fires at `cron(0 5 * * ? *)` = **05:00 UTC** | live EventBridge rule                        |
| 05:00 UTC = **01:00 ET** — inside the shutdown window                | arithmetic                                   |

So every night the sweep wakes up while its own database is switched off. The handler dies in `withDb`
before reaching any `logger` call, which is why **the log group contains zero lines from this handler in
20 days** despite 42 errors — an absence that reads as "not running" and is actually "dying early".

`erasureReconciliation.ts` itself is **correct** and should not be touched for this: per-identity throws
are caught (`:143`), the loop continues, and `emitMetric('ErasureIncomplete', incomplete)` runs
unconditionally at `:158`. The failure is upstream of the handler body.

**The second-order consequence is the serious part.** Because the handler dies before `:158`, the
aggregate metric is never emitted, so the alarm that exists to detect incomplete erasure has **no data**
— it is silenced by the very outage class it was built to report. A control that goes quiet when its
subject breaks is worse than no control, because quiet reads as healthy.

**Action for U2:** move the sandbox schedule outside the shutdown window (09:00–23:59 ET), or make the
sweep exit cleanly when its database is intentionally stopped. Do **not** "fix" it by removing the
nightly shutdown (ADR-0007 is a cost decision) and do **not** add a catch that swallows the failure —
that would restore the silence.

### A separate, real defect this uncovered — the sandbox fan-out targets services that do not exist

The deletion-worker exception, read from the log group (the step nobody had performed):

```
erasure fan-out incomplete for owner 01KZKES1FNHBW29N2VZJD7D0TW: recipe(404: ); food(404: )
```

**`404`, not `401`** — which independently rules out the credential theory for sandbox too. The reason is
structural: **there is no recipe-service or food-service in sandbox at all.** The deployed sandbox stacks
are identity-service, identity-webhooks, alb, data, network, global, domain, router, scheduler — the
feature services exist only in **prod** and in **`pr-{N}`** previews. The SSM base URLs nonetheless point
at `https://recipe.sandbox.commise.app` and `https://food.sandbox.commise.app`, which resolve, terminate
TLS against `*.sandbox.commise.app`, match **no** listener rule, and therefore receive the shared ALB's
default fixed-response `404` (ADR-0003). Probed live: both return `404`.

`fanOutOrThrow` treats any non-2xx as incomplete and throws — correctly. The configuration is what is
wrong, not the code.

**This does not affect prod**, where both services exist and answer. It is recorded here because the
sandbox erasure path will keep failing after the schedule is fixed, and the next investigator would
otherwise re-derive it.

---

## Symptom 3 — "the prod alarm is dead"

**Verdict: TWO independent causes. One is a STALE PROD DEPLOY; the other is an unresolved
metric-extraction failure whose prime suspect is named below.**

### 3a. The deployed prod alarm is the pre-fix shape — stale deploy

Live comparison of the two deployed alarms:

| Alarm                                     | Dimensions                                            | Alarm actions |
| ----------------------------------------- | ----------------------------------------------------- | ------------- |
| `kitchensink-erasure-incomplete-**prod**` | **`[]`**                                              | **`[]`**      |
| `kitchensink-erasure-incomplete-sandbox`  | `service=identity-webhooks, metric=ErasureIncomplete` | 1 SNS topic   |

The source is already correct — `WebhooksStack.ts:473` sets `dimensionsMap: emitterDimensions(...)` and
`:483` calls `addAlarmAction`; `:444` even records that this alarm "was written dimensionless and had
been [dead]". Sandbox reflects that fix; prod does not. **Prod is running an older template.**

A dimensionless alarm cannot match a dimensioned metric, so prod's alarm could never fire **even with
perfect data**, and with no alarm action it would notify nobody if it did. This is exactly the "stale
prod deploy" KTD-6 predicted, now confirmed rather than assumed.

**Action for U2/U11:** redeploy `kitchensink-identity-webhooks-prod`. That is the entire fix for 3a.

### 3b. `KitchenSink/IdentityWebhooks` has no metrics at all — cause NOT proven

`aws cloudwatch list-metrics --namespace KitchenSink/IdentityWebhooks` returns **nothing**, in either
stage. What was established, and what was not:

**Established:**

- The EMF envelopes **are** being written, and are **well-formed**. Raw event, unmodified:
  `{"level":"INFO","message":"metric","metricName":"ReconciliationDrift",…,"_aws":{"Timestamp":…,"CloudWatchMetrics":[{"Namespace":"KitchenSink/IdentityWebhooks","Dimensions":[["service","metric"]],…}]},"service":"identity-webhooks","metric":"ReconciliationDrift"}`
  Every dimension named in `Dimensions` is present as a top-level member, as EMF requires.
- The log event is **pure JSON with no Lambda text prefix**, so the classic "Text format prefixes the
  line and breaks parsing" failure is **ruled out**.
- `LogFormat` is **`Text`**, not `JSON`, so the "structured logging wraps `_aws` one level down" failure
  is also **ruled out**. (This was my first hypothesis; it is wrong.)
- **EMF extraction works fine in this account** — `Commise/Food`, `Commise/RecipeAccount`,
  `Commise/RecipeArchive` and `Commise/RecipeErasure` all have live metrics. So this is not an account
  setting.
- Prod's emitter is **not** dying: prod erasure-reconciliation runs daily with 0 errors and reaches its
  unconditional `emitMetric` call.

**Not established — the prime suspect, stated as a hypothesis.** The one structural difference between
the namespaces that work and the one that does not: every `KitchenSink/IdentityWebhooks` emitter is a
**Lambda writing to a shared CUSTOM log group** (`LoggingConfig.LogGroup` →
`…WebhooksLogGroupA05F4FC6…`), which additionally carries a **Sentry subscription filter**. The
namespaces that work are emitted by **ECS tasks to their own log groups**. Whether Lambda EMF extraction
is performed for a non-default log group is the open question.

**The experiment that settles it, for whoever picks this up:** point one webhook Lambda at its default
log group, invoke it, and see whether the namespace appears. That is a one-parameter change and a single
`list-metrics`. Do not attempt to fix 3b by rewriting the emitter — the emitter is provably correct.

---

## Summary — what U2 should and should not do

| Symptom                                    | Cause                                                                 | Is it a code defect?  |
| ------------------------------------------ | --------------------------------------------------------------------- | --------------------- |
| Prod provisioning "missing"                | Complete and verified; the **runbook status** is stale                | No — fix the doc      |
| 36/38 reconciliation failures              | **Sandbox only**: schedule fires inside ADR-0007's RDS shutdown       | No — fix the schedule |
| Sandbox fan-out `404`s                     | Sandbox has **no** recipe/food service; SSM URLs point at nothing     | No — fix the config   |
| Prod alarm dead (dimensionless, no action) | **Stale prod deploy**; source already correct                         | No — redeploy         |
| Namespace has zero metrics                 | Unresolved; emitter proven correct; suspect = custom Lambda log group | No — see experiment   |

**The single most important consequence for U2:** the erasure alarm is currently unable to report a
failure in either stage — prod because the alarm shape is stale, sandbox because the emitter dies before
emitting. Any U2 work that "makes erasure erase" must be verified by something other than that alarm
until both are repaired, or it will look successful because nothing is capable of saying otherwise.
