# 0024 — The LLM spend ceiling is enforced by a RESERVE-THEN-SETTLE counter in our own code; no AWS mechanism can gate it

- **Status:** Accepted
- **Date**: 2026-08-20
- **Drivers**: `R23` sets an owner-mandated **$100/month, enforced, configurable** ceiling on the U11
  verification gate — a `recipe-workers` Lambda calling Bedrock `Converse` (~660 input / ~80 output tokens,
  ~8,000 calls/month). "Enforced" is the load-bearing word, and it forced three questions the plan could
  only answer by going to primary documentation:
    - Does AWS sell a spend cap? (No — and the near-miss answers are worse than no answer, because each one
      _looks_ like enforcement.)
    - If the gate must be our own code, what is the correct shape? (Not the obvious one. The obvious one
      loses money it has already spent.)
    - Which models can the bake-off actually reach from Bedrock? (Not the three the plan named.)
- **Relates to**:
  [ADR-0004](0004-minimize-nat-egress.md) — the call egresses through the shared `t4g.nano` NAT instance
  that `recipe-workers` already uses; the `bedrock-runtime` **VPC interface endpoint** this ADR originally
  specified was DROPPED on 2026-08-20 (see §4a), though ADR-0004's rule still makes a non-Bedrock provider
  structurally expensive (§4);
  [ADR-0008](0008-additional-cost-levers-gp3-fargate-spot-budget-guardrails.md) — the account-scoped
  `kitchensink-cost-guardrails` budget is `Environment=global` and audits the whole account; the budget in
  §3 layer 5 is a _different_, service-filtered budget with a different job;
  [ADR-0014](0014-service-owned-api-contracts.md) / `GR-015 §15-d` — Bedrock is a third-party API we do not
  serve, so `packages/clients/bedrock/` validates the raw upstream shape with zod and declares its own
  types; no OpenAPI document is written for it;
  [ADR-0022](0022-in-stack-migration-trigger.md) — the counter is a NEW table in the recipe database,
  so it ships as a migration and arrives through that ADR's in-stack Trigger like any other schema change;
  [ADR-0006](0006-per-pr-feature-deploys-base-stage-and-logical-db.md) — per-PR deploys get their own LOGICAL database on the
  shared sandbox instance, which is why the ceiling is prod-only (§3).
- **Supersedes within the plan**: `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md`
  §U11's layer table, its egress paragraph and §KTD-4's bake-off roster. Where this ADR and that plan
  disagree, this ADR wins and the plan is to be corrected.
- **Amended 2026-08-21** after a seven-persona document review (30 findings). The store moved from DynamoDB
  to the recipe Postgres (§2), the daily sub-ceiling was removed (§3), enforcement narrowed to prod (§3),
  layer 4's bypass claim was corrected and IAM added as layer 4b (§3), and billing denials were separated
  from verification disagreements (§2). Owner rulings, all dated 2026-08-21.

## ⚠️ Before you change this — ten "improvements" that are all wrong

1. **Do not replace the counter with an AWS Budget, and do not add a Budget _Action_ thinking it closes the
   gap.** It does not. A budget action fires off the same threshold evaluation as the notification, so it
   automates the _response_ and inherits the full **8–12 hour** detection lag, plus SCP propagation on top.
   See Decision §1.
2. **Do not treat reserved concurrency as the ceiling.** It bounds burn _rate_, and the rate-to-dollars
   conversion is model-dependent by a factor of ~30. The plan already records this correction; it is
   repeated here because it is the single most attractive wrong answer.
3. **Do not "simplify" reserve-then-settle back to "read, call, then increment from `usage`".** That shape
   has a durability defect that `reservedConcurrency = 1` does **not** fix — see Decision §2. It is the
   difference between a ceiling and a ceiling-shaped hope.
4. **Do not put Gemini Flash-Lite in the Bedrock bake-off.** It is not available on Amazon Bedrock. Only
   Google's **Gemma** models are. See Decision §4 — this is the "looks fine, isn't".
5. **Do not move the counter to DynamoDB "because a counter belongs in a key-value store".** The store is
   the recipe Postgres the worker is already bound to. An earlier draft did specify DynamoDB, on a claim
   that `RecipeWorkersStack` already owned a table — it owns none. A separate store buys a dependency, an
   IAM surface and an independent failure domain whose outage closes the gate while everything else is fine.
   See Decision §2.
6. **Do not reintroduce a daily (or weekly) sub-ceiling.** A monthly ceiling is a hard cap, not a slow
   detector — a same-day runaway still stops at $100. A second ceiling denies legitimate bulk work, never
   enforced the monthly one (31 × $5 = $155), and turns §2's single-row invariant into two. See Decision §3.
7. **Do not "simplify" the reserve statement back to `INSERT … VALUES … ON CONFLICT DO UPDATE … WHERE`.**
   That `WHERE` guards only the UPDATE branch, so the first reservation of each period is unguarded. The
   `SELECT … WHERE $headroom >= 0` form is load-bearing. See Decision §2.
8. **Do not write cost logic for `cacheReadInputTokens` / `cacheWriteInputTokens` and assume it runs.** Both
   are `Required: No` on the wire, and they must be costed defensively — caching DOES engage on every warm
   call, so a sustained ZERO is what signals something wrong, not a non-zero value. See Decision §5.

## Context

### What "enforced" has to survive

At a measured $0.27/month for Nova Micro (`KTD-4`), a $100 ceiling is ~370× headroom. It will never bind in
steady state. That is not an argument for a weaker gate — it is a statement about _what the gate is for_.
The ceiling exists for exactly one event: **8,000 calls/month becoming 800,000**, through an SQS redrive
loop, a poison message, a queue replay, or a `maxTokens` mistake. Every design choice below is judged
against that event, not against the steady state.

This inverts the usual reading of a monthly dollar budget. A _monthly_ counter is the **slowest possible
detector** of a runaway that completes inside a single day. The Well-Architected Agentic AI Lens says the
same thing in general form — `AGENTCOST07-BP01`: _"enforce per-cycle, per-task, and per-day budget limits
as pre-invocation checks, not alerts after the fact."_

### Why this needed an ADR and not just a plan line

Three of the findings below are **refutations of things a competent engineer would reasonably assume**, and
all three will be re-proposed by whoever touches this next:

- that a cloud provider billing by the token will sell you a spend cap;
- that a budget _action_ is enforcement rather than automated notification;
- that serializing the caller makes a read-then-write counter correct.

A plan document is transient. These need to outlive it.

## Decision

### 1. No AWS-native mechanism stops Bedrock inference at a dollar threshold in near-real-time

Verified against primary AWS documentation on **2026-08-20**. The full enumeration, so nobody has to redo it:

| Mechanism                                               | Denominated in   | Enforces or alerts                   | Latency                 | Why it cannot be the gate                                                                                                          |
| ------------------------------------------------------- | ---------------- | ------------------------------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Bedrock TPM / RPM quotas                                | Tokens, requests | **Enforces** (`ThrottlingException`) | Real-time               | Not dollars; account + model + Region scoped; adjustable **upward only**                                                           |
| Bedrock **TPD** (`Model invocation max tokens per day`) | Tokens           | **Enforces**                         | Real-time               | Same. Defaults to TPM × 1440 — astronomically above this workload                                                                  |
| Application inference profiles                          | —                | **Neither**                          | n/a                     | Attribution only: _"Track usage metrics"_, _"Use tags to monitor costs"_, cross-Region routing                                     |
| AWS Budgets notification                                | Dollars          | Alerts                               | **8–12h**               | AWS states you _"might incur additional costs … that exceed your budget notification threshold before AWS Budgets can notify you"_ |
| AWS Budgets **Action** (IAM deny / SCP)                 | Dollars          | **Enforces**                         | **8–12h + propagation** | Fires off the same evaluation as the notification. Automates the response, not the detection                                       |
| Cost Anomaly Detection                                  | Dollars          | Alerts only                          | **up to 24h**           | _"it can take up to 24 hours to detect an anomaly after a usage occurs"_                                                           |
| CloudWatch alarm on `AWS/Bedrock` metrics               | Tokens           | Alerts (→ SNS → Lambda)              | ~2–6 min                | Dimensioned on `ModelId` only — account + Region wide, not per-application                                                         |
| Bedrock Guardrails                                      | —                | Content, not cost                    | n/a                     | Wrong axis entirely                                                                                                                |
| AgentCore Policy (Cedar)                                | Configurable     | **Enforces** at the boundary         | Real-time               | Requires an AgentCore Gateway. We do not have one and will not add one for this                                                    |

**`bedrock-runtime` exposes no per-request cost or budget parameter.** The full `Converse` request accepts
`inferenceConfig.{maxTokens, stopSequences, temperature, topP}` and nothing else that bounds consumption.
The OpenAI-shaped Responses / Chat Completions surfaces add none either. `maxTokens` bounds **output only**;
`serviceTier` changes the price _per token_ and caps nothing.

**So the gate is our code.** This is not a gap we are working around — it is the industry position. AWS
publishes the same pattern (_"Build a proactive AI cost management system for Amazon Bedrock"_), and states
the rationale plainly: _"Traditional methods of cost monitoring, such as budget alerts and cost anomaly
detection, can help spot unexpectedly high usage but are reactive in nature."_

### 2. The gate is RESERVE-THEN-SETTLE, not read-then-increment ⚠️ looks like over-engineering, isn't

The obvious shape — read the counter, call Bedrock, increment from the response's actual `usage` — has a
defect that **survives `reservedConcurrency = 1`**.

`reservedConcurrency = 1` removes the read-modify-write **race**. It does nothing about **durability**. If
the Lambda dies between a successful `Converse` response and the increment — timeout, OOM, a thrown error
in the settle path, a `SIGKILL` — the money is spent and the counter never learns. And the failure is not
independent of the risk: under the runaway this ceiling exists to stop, crashes are _correlated_ with calls,
so the counter under-reports **precisely when it matters most**. A counter that silently under-reports
during a runaway is worse than no counter, because it reports green.

The repair is to charge **before** the call and refund **after**, which is exactly how Bedrock's own quota
system works — it deducts `Total input tokens + max_tokens` at request start and, at the end, _"any unused
tokens are replenished to your quota."_ We mirror the mechanism we are metering.

⛔ **The store is the recipe PostgreSQL database, not DynamoDB.** An earlier draft specified DynamoDB and
never argued for it — the only justification was a claim that `RecipeWorkersStack` already owned a DynamoDB
table, which is false (it owns none, and carries no DynamoDB client). Removing the false premise left the
choice unargued, and the honest answer is the database the worker is already bound to: `recipe-workers`
already ships `drizzle-orm`, `pg` and `@aws-sdk/rds-signer`, and every one of its Lambdas is VPC-attached
for the sole purpose of reaching that RDS. Using it adds **no dependency, no IAM surface, no CDK construct,
and — decisively — no new failure domain**. A separate store's outage would close the gate while everything
else is healthy; Postgres going down stops the worker regardless.

One row per period, **one atomic conditional statement per call, with no prior read**:

```sql
-- RESERVE — checks the ceiling and charges worst case in a single round trip.
INSERT INTO verification_spend (period, reserved_micros)
SELECT $period, $worst
 WHERE $headroom >= 0                        -- ⛔ guards the INSERT branch; see below
ON CONFLICT (period) DO UPDATE
   SET reserved_micros = verification_spend.reserved_micros + $worst
 WHERE verification_spend.reserved_micros <= $headroom
RETURNING reserved_micros;
--   $worst    = worstCaseMicros(modelId, MAX_INPUT_TOKENS, maxTokens)
--   $headroom = CEILING_MICROS - $worst
```

⛔ **Corrected — the earlier form of this statement had a hole, and it was found by U11's
integration tier, not by review.** It read `INSERT … VALUES … ON CONFLICT DO UPDATE … WHERE`, and that
`WHERE` guards **only the UPDATE branch**. On the FIRST reservation of a period there is no conflicting row,
so the INSERT proceeded **unguarded** — admitting a single worst-case charge that may exceed the entire
ceiling, once per period, in precisely the situations the ceiling exists for: a ceiling lowered mid-incident,
or a raised `maxTokens`. `WHERE $headroom >= 0` applies the same predicate to the absent row's implicit zero,
so both branches are guarded by one rule. ⚠️ A unit test cannot see this: it only appears against a real
table on a period's first write.

**Zero rows returned IS the budget denial** — the row exists and the `WHERE` failed. `UPDATE`/`INSERT … ON
CONFLICT` takes a row lock, so concurrent callers serialize on the one row and each sees the latest value;
the bound therefore does not depend on `reservedConcurrency`.

```sql
-- SETTLE — refund the difference. $delta is normally negative.
UPDATE verification_spend
   SET reserved_micros = reserved_micros + $delta,
       settled_micros  = settled_micros  + $actual,
       calls           = calls + 1
 WHERE period = $period;   -- the SAME period captured at RESERVE — never recomputed
--   $actual = costMicros(usage.inputTokens, usage.outputTokens, rateTable[modelId])
--   $delta  = $actual - $worst
```

Why this is correct where the obvious shape is not:

- **Reserved spend never exceeds the ceiling**, under arbitrary concurrency, because the row lock serializes
  callers and `$headroom` already subtracts the worst case before the comparison. The bound does **not**
  depend on `reservedConcurrency = 1`, so that setting is free to change later for throughput without
  silently breaking the ceiling.
- **One row, one invariant.** There is a single ceiling (§3) and therefore a single counter. Do not add a
  second keyed counter without re-deriving this section: two rows would be two invariants, and the reserve
  pair would then have to be one transaction so a denial on the second cannot leave the first charged.
- **Every failure mode is fail-safe, and settle is NEVER retried.** Crash after reserve → the worst-case
  charge stands (over-count). Crash after the Bedrock response → same, and because `worst ≥ actual` we can
  never under-count. ⚠️ A **retried settle is the one way to break that guarantee**: `reserved_micros +
$delta` is not idempotent with a negative delta, so a lost response that is auto-retried double-refunds
  most of the reservation — reintroducing exactly the silent under-count this shape exists to prevent. Pin
  `maxAttempts: 1` on **both** statements, and emit a metric when settle fails so unrefunded reservations
  are observable rather than silent.
- **Any outcome with no billed response refunds in full.** `ThrottlingException`,
  `ServiceUnavailableException`, `AccessDeniedException`, `ValidationException` and client timeouts settle
  with `$actual = 0`. Without this a throttling episode consumes the ceiling at **zero actual spend** and
  then closes the gate for the rest of the month.
- **The period key is captured once, at reserve, and carried into settle.** Recomputing it at settle time is
  a real bug: a call spanning midnight UTC on the 1st reserves against month M and settles against M+1,
  leaving M permanently over-reserved and M+1 permanently over-charged. Compute in **UTC** — that is what AWS
  bills on, so our counter and the audit budget (§3) agree on where the boundary is.
- **Scale is a non-issue.** 8,000 writes/month against one item is ~0.006 WCU/s. Revisit single-item
  contention above ~1,000 writes/s; we are six orders of magnitude away.

**Two preconditions the counter depends on, which must ship with it:**

- **`maxTokens` MUST be set explicitly, and input tokens MUST be capped before the call.** Without both, the
  reservation is a lie: an unbounded input or an unbounded completion makes the worst case unbounded too.
  ⚠️ The input cap is enforced in TOKENS, not code points — an earlier code-point cap made the worst case
  computable but wrong, because the two do not convert at a fixed rate.

### 3. Six layers, each stated with its enforcement latency

| #   | Layer                                                           | Stops                                      | Latency                                       | Scope                                                   |
| --- | --------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------- |
| 0   | SQS `maxReceiveCount` + DLQ                                     | A retry loop **before it becomes cost**    | **Real-time**, enforced by SQS                | Per-queue. Cheapest, highest-value control in the stack |
| 1   | Explicit `maxTokens` + input-token cap                          | Worst-case cost of one call                | **Real-time**, in-process                     | Per-call. Precondition for layer 3                      |
| 2   | `reservedConcurrency = 1`                                       | Burst _rate_                               | **Real-time**                                 | Per-function. **Blast radius, not the ceiling**         |
| 3   | **Reserve-then-settle counter — one monthly ceiling ($100)**    | The owner's ceiling                        | **~5–10 ms, before the call.** Never exceeded | **Prod only.** **This is the gate**                     |
| 4   | EMF dollar metric → CloudWatch alarm → SNS → notification       | Counter **bugs** (not bypass — see below)  | **~2–6 min**                                  | Per-application, **dollar-denominated**                 |
| 4b  | `bedrock:InvokeModel` granted to exactly ONE role, guard-tested | Counter **bypass**                         | **Build-time**                                | Account. Authorization, not observation                 |
| 5   | AWS Budget (~$20, filtered to Bedrock), actual + forecasted     | Drift between our estimate and the invoice | **8–12h**                                     | Account. **Audit, never the gate**                      |

⛔ **There is exactly ONE ceiling: $100 per calendar month, reset at the month boundary.** An earlier draft
added a ~$5 daily sub-ceiling, justified as detection speed. That reasoning does not survive: a monthly
ceiling is a **hard cap, not a detector** — a runaway completing inside a day still hits $100 and stops. The
daily ceiling did not stop it harder, it stopped it at a lower figure than the owner authorized, while
manufacturing false denials on legitimate bulk work. It also never enforced the monthly ceiling it sat under
(31 × $5 = $155 > $100), and its own Residual risk conceded it was "the same code with different keys."
Genuine detection latency is layer 4's job, at ~2–6 minutes. **Owner ruling, 2026-08-21: one monthly cap.
Do not reintroduce a second ceiling without re-deriving §2's single-row invariant.**

⛔ **The ceiling is enforced in PROD ONLY** (owner ruling, 2026-08-21). Sandbox and every `pr-{N}` call the
provider ungated, because ADR-0006 gives each PR its own **logical** database on the shared sandbox
instance — Postgres cannot read across logical databases, so a shared counter would mean either a second
connection to the base database or a store outside both VPCs, and neither is worth the machinery for
non-prod. "Ungated" is not "unlimited": layers 0–2 still bound the rate at `reservedConcurrency = 1` and
~1 s per call, i.e. **86,400 calls/day ≈ $2.90/day ≈ $88/month per stage on Nova Micro** (~30× that on
Haiku 4.5, which is only reachable while the bake-off runs). Raising `reservedConcurrency` in a non-prod
stage raises that bound proportionally and is the one change that makes this ruling unsafe.

⚠️ **Both the ceiling value and the model live in SSM parameters, read at Lambda cold start** — R23 requires
the ceiling be _configurable_, and baking it into the function's environment would mean redeploying the
worker stack to change it mid-incident. A lowered ceiling applies to subsequent reserves only; it never
rewrites reservations already taken, and it can deny immediately if the period's accumulated reservations
already exceed the new headroom.

⚠️ **The arithmetic here assumes Nova Micro** (`KTD-4`'s pick, on both measured correctness and cost). If the
bake-off picks Claude Haiku 4.5 instead, per-call cost rises ~30× and every figure in this section must be
re-derived — including whether $100 is still ~370× headroom, and whether the 80,000-line re-import scenario
(~$2.74 on Nova, ~$85 on Haiku) can complete inside one month's budget.

**Layer 4 emits our OWN metric, and that is deliberate.** A CloudWatch alarm on `AWS/Bedrock`
`InputTokenCount` / `OutputTokenCount` is available but is account + Region + `ModelId` scoped and
**token**-denominated — so anything else in the account calling the same model corrupts it, and its dollar
threshold must be re-derived whenever the model changes. An EMF metric from the Lambda we are already
logging from is app-scoped, dollar-denominated, and free. It alarms at **$50 — half the ceiling** — and
routes to a notification. It does **not** invoke a kill switch: at $100 maximum exposure an automated
remediation Lambda costs more to build and carry than the loss it prevents.

⛔ **Layer 4 cannot detect a bypass, and an earlier draft claimed it could.** The EMF metric is emitted BY
the gated code path, so a caller that skips the gate emits **nothing**. Its "Stops" column now reads counter
bugs only. The real control is authorization, not observation: **`bedrock:InvokeModel` / `bedrock:Converse`
is granted to exactly one Lambda execution role** (layer 4b), asserted by a discovery-based guard test over
the infra tree that fails on any additional grantee — the exact-set-equality shape
`packages/infra/global/__tests__/natEgressConsumers.test.ts` already uses for NAT membership. A permission
nobody else holds cannot be bypassed; a metric nobody else emits cannot notice.

**Layer 5's job is to disagree with layer 3.** It is not a smaller ceiling; it is an independent
observation. If the counter says $3 and AWS says $40, the **rate table is wrong** and that is what we need
to learn. Set the threshold low ($20) precisely so it is sensitive to accounting error rather than to spend.

### 4. The bake-off roster is wrong: Gemini Flash-Lite is not on Amazon Bedrock ⚠️ looks fine, isn't

`KTD-4` and `U11` both name **Nova Micro, Claude Haiku 4.5 and Gemini Flash-Lite**. Verified against
[Google models in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-google.html)
on 2026-08-20: the Google models on Bedrock are **Gemma 4 31B, Gemma 4 26B-A4B, Gemma 4 E2B, Gemma 3 12B IT,
Gemma 3 27B PT, Gemma 3 4B IT**. No Gemini, on either endpoint. Gemini Flash-Lite is a Vertex AI /
Google AI Studio model.

This is not a naming quibble — it invalidates the premises `KTD-4` used to _choose_ Bedrock:

- **"Bedrock adds no vendor relationship and no secret."** A Gemini candidate needs a Google Cloud
  relationship and an API key in Secrets Manager.
- **The egress design breaks.** The Bedrock call leaves through the shared `t4g.nano` NAT instance that
  `recipe-workers` is already attached to (§4a), so it costs nothing and reopens nothing. A Vertex AI call
  would need a Google endpoint, a credential in Secrets Manager and its own review of what that adds to the
  NAT — a decision ADR-0004 asks to be made deliberately rather than as a side effect of picking a model.
- **Every enforcement layer above except 0–3 evaporates for it.** No `AWS/Bedrock` metrics (layer 4's
  backstop), no Bedrock CUR line (layer 5). Only our own counter would remain.
- **`R24`'s no-retention/no-training commitment** was argued from _"AWS's no-training commitment applies
  uniformly across models."_ That argument does not extend to Google's own API terms, which would need
  separate review.

**Ruling: the bake-off roster is Nova Micro vs Claude Haiku 4.5, both on `bedrock-runtime`.** If a third
candidate is wanted, the in-boundary option is a **Gemma** model. Adding Gemini is a separate decision with
its own ADR covering the vendor relationship, the secret, the egress path, and `R24` — not a line item in a
bake-off. `KTD-4`'s cost framing is unaffected: it already turns on the ~$8/month Nova-vs-Haiku spread,
which it calls immaterial, and the owner ruling _"ship the winner and improve from there"_ stands.

### 4a. The `bedrock-runtime` VPC interface endpoint is DROPPED — added 2026-08-20 ⚠️ reverses this ADR

This ADR and `U11` both specified a `com.amazonaws.<region>.bedrock-runtime` **VPC interface endpoint** in
`RecipeWorkersStack`, justified as keeping the Bedrock call from widening ADR-0004's four-consumer NAT list.
**Both halves of that justification were wrong.**

**The premise was already false.** `RecipeWorkersStack` places all seven of its Lambdas in
`PRIVATE_WITH_EGRESS`, which routes `0.0.0.0/0` to that NAT instance — they have been NAT consumers since
they shipped. ADR-0004's list said four because it was written in June and never re-checked; the real figure
was already several times that, and has grown again since. ⚠️ The count is deliberately not restated here —
ADR-0004's generated `nat-consumers` table is the authority and `natEgressConsumers.test.ts` asserts it by
exact set equality in both directions. Nothing in the ruling depends on it: the endpoint's cost arithmetic
($14.60/month/stage at `maxAzs: 2`) is per-endpoint, so a growing consumer list makes this argument
STRONGER rather than weaker — the endpoint would buy a second egress path for consumers already on the
first.

**And it is expensive for what it carries.** Priced from the AWS Pricing API on 2026-08-20 (us-east-1,
`USE1-VpcEndpoint-Hours`): **$0.01 per VPC endpoint hour**, billed _per Availability Zone the endpoint is
provisioned in_. This VPC is `maxAzs: 2`, so:

|                                                         | Monthly    |
| ------------------------------------------------------- | ---------- |
| Interface endpoint, 2 AZs (2 × 730 h × $0.01)           | **$14.60** |
| Data processed ($0.01/GB; ~8,000 calls × ~3 KB ≈ 24 MB) | $0.0002    |
| The Nova Micro inference it would carry                 | **$0.27**  |
| The entire `t4g.nano` NAT instance it would be avoiding | ~$3–4      |

54× the traffic, ~4× the NAT, per stage — and declared in a per-service stack it would have been created
once per open PR against the shared sandbox VPC, at $14.60/month each. Nor does privacy rescue it: AWS's
PrivateLink documentation says of the NAT→IGW path to an AWS service that _"while this traffic traverses the
internet gateway, it does not leave the AWS network."_

**Ruling: no endpoint. The call egresses through the existing NAT.** ADR-0004's 2026-08-20 update carries
the corrected consumer list and the guard that now asserts it, including an assertion that no interface VPC
endpoint exists anywhere in the tree — so re-adding one has to come back through that ADR. What §4 above
still needs from ADR-0004 is unchanged: a non-Bedrock provider is structurally expensive because it brings a
vendor relationship, a secret, and an egress question of its own.

⚠️ Two things the ruling depends on, recorded so the reopening path is priced honestly. First, the guard
does more than assert the endpoint's absence: `natEgressConsumers.test.ts` derives its NAT-consumer list
from the inference that **with no interface endpoint anywhere in the tree, VPC-attached and NAT-consuming
are the same set**. Legitimately adding an endpoint after reopening ADR-0004 therefore invalidates that
derivation too, and the guard's consumer assertion must be re-argued alongside it. Second, the arithmetic
above is per-service-stack placement; a shared-stack placement (the ADR-0003 pattern, one per stage rather
than one per service) removes the per-open-PR multiplication from the objection, so it is the shape to
evaluate if the volume ever justifies revisiting.

⚠️ Accepted consequence: the gate now shares a single-AZ NAT instance with 16 other Lambdas, so an AZ
failure takes it down with them. At `reservedConcurrency = 1` and ~1 KB per call, throughput is not the
concern; availability is, and the answer is that this is an async off-queue path whose messages wait.

### 4b. The invocation id is NOT the rate-table key, and the IAM grant follows the registry — added 2026-08-25

The gate used **one string for two jobs**: the rate-table key and recorded model identity, and the id
`Converse` is called with. For every on-demand model those coincide, which is why it went undetected. Claude
Haiku 4.5 reports `inferenceTypesSupported: ["INFERENCE_PROFILE"]`, so its bare id is refused with
`ValidationException: Invocation of model ID … with on-demand throughput isn't supported`, while the profile
id `us.anthropic.claude-haiku-4-5-20251001-v1:0` is not a rate-table key and fails closed as `unpriced`.
**Pointing the SSM parameter at Haiku failed every call in either direction** — a config change, no deploy.

**The split.** `BEDROCK_MODEL_REGISTRY` (the rate table, which §2 already treats as the authorization
boundary: "with no rate there is no worst case") now carries `invocation.invocationId` beside each entry's
`rate`, and `planReservation` resolves both in ONE read. `PricedReservation` carries the address alongside
the captured period and the captured rate, for the same reason those are captured: a mid-call SSM change
cannot split the id that was PRICED from the id that was CALLED. `verifyLine` passes `plan.invocationId` to
`converse` and keeps `plan.modelId` at all three recording sites (`model_id` on the verdict, `verified_by`
on the memo, and the log). Nova Micro's recorded identity is byte-identical to before.

⚠️ **The recorded id must stay bare.** Memos are upserted per phrase, so a `verified_by` that drifted to the
profile spelling would produce a silent MIX of two identities for one model rather than an error. The unit
suite asserts the recorded halves explicitly for exactly that reason.

**The grant had to move with it.** `IngredientVerificationRole` held one statement —
`arn:aws:bedrock:<region>::foundation-model/*`. An inference profile is a **different resource type**
(`inference-profile`) and is **account-scoped** where a foundation model is account-less; invoking one routes
the call to foundation models in regions the caller never names (`us.` from us-east-1 reaches us-east-1,
us-east-2 and us-west-2, read from `aws bedrock get-inference-profile` on 2026-08-23). ⛔ **Fixing only the
code would therefore have converted a `ValidationException` that names the problem into an `AccessDenied`
that does not.**

The ARNs are DERIVED from the registry by a pure helper (`infra/lib/bedrockInvokePolicy.ts`) in AWS's
documented least-privilege shape — **two statements on the one role**, per profile:

| Statement | Resources                                                         | Condition                                          |
| --------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| on-demand | _(none — the wildcard is DELETED)_                                | none                                               |
| profile   | `arn:aws:bedrock:<region>:<account>:inference-profile/<profile>`  | none                                               |
| fan-out   | `arn:aws:bedrock:<each reached region>::foundation-model/<model>` | `StringLike bedrock:InferenceProfileArn = profile` |

The condition is load-bearing: without it the fan-out statement would also authorize a **direct** invocation
of that model in us-west-2 — reach nothing in the registry asked for. The statements are per-profile so one
profile cannot borrow another's regions. No wildcard is emitted: the registry is compile-time, so every
profile ARN is enumerable.

⚠️ **Two statements on one role is not a layer-4b breach.** That control's invariant is over GRANTEES and
ACTIONS, never statement count — `llmSpendGuards.test.ts` records that an earlier `grants.length === 1`
assertion was three defects in one line and was "what blocked adopting AWS's documented least-privilege shape
for inference profiles". The grantee set is unchanged: still exactly `verificationRole`, still only
`bedrock:InvokeModel`.

⛔ **There is no `foundation-model/*` wildcard.** It was deleted: the model registry is the only authority,
and `bedrockInvokePolicy.ts` enumerates every ARN it grants. A wildcard beside the registry would authorize
a direct call nothing asked for, which is exactly the bypass layer 4's EMF metric cannot detect — the metric
is emitted BY the gated path.

⛔ **Residency IS enforced, in both places.** AWS documents that with cross-region inference "your input prompts and output results may be
stored in the opt-in Regions for abuse detection purposes", so the question is about where user text comes to
REST, not only where it is processed, and feature 016 is its home for the data-at-rest half.

⚠️ **None of this has been exercised against a live profile call.** No profile-backed model is invocable on
this account (Anthropic's Bedrock use-case form is an account action, out of scope), so both halves are proved
only by unit tests and synthesized-template assertions. The bake-off says nothing about it either: it runs
under credentials that BYPASS this role, and it keeps its own `INVOCATION_IDS` map — which is why the
conflation survived a full measurement pass. That second map stays, deliberately: the runner is an operator
script that already sits outside this ceiling by design.

### 4c. The ceiling is ONE global pool, and spend is ATTRIBUTED rather than PARTITIONED

Owner ruling, 2026-08-24 (KTD-17): the **$100/month is a single pool**, first come first served, shared by the
verification gate, the ingredient parse leg and 017's capture tiers. It is not sub-divided per consumer — the
same reasoning that rejected the daily sub-ceiling in §3: a second cap denies legitimate work and never
enforces the figure it sits under.

⛔ **DEPRECATED — THE CONSUMER LIST ABOVE IS WRONG. Two of its three members do not exist.**

Owner directive, 2026-08-29. `recipe-workers/src/parsing/llmParse.ts` — "the ingredient parse leg" — was
**DELETED** — the file only. ⚠️ `src/parsing/` still exists and still holds the GATED verification path
(`crfInvoke.ts`, `gatedLlm.ts`, `parseJobExpiry.ts`, `parsePorts.ts`); only `llmParse.ts` went.

It was dead code: every reference to `parseLineWithLlm` outside the module lived in its own
test file, and it had no handler, therefore no Lambda, therefore no execution role, therefore no path to
Bedrock at all. It had never executed outside a unit test. 017's capture tiers are specced and unbuilt.

**The pool therefore has exactly ONE consumer — the verification gate** — which is exactly what layer 4b's
single grantee admits. Before this, §4c budgeted for three consumers while the IAM granted
`bedrock:InvokeModel` to one role; **the budget and the grant now agree.** The deletion closed that
inconsistency rather than creating one.

⚠️ **The pool now has FOUR call sites**, not one: `verification-gate`, `ingredient-parse`,
`foodness-validator` and `measurement-validator` (`SPEND_CALL_SITES`, `spendArithmetic.ts`). Layer 4b is
unbroken — all four run under the one `verificationRole`, so the single-grantee rule and the one-pool ruling
still agree, and `CallSite` is what tells them apart when the pool empties.

⚠️ **ONLY THE ENUMERATION IS DEPRECATED — the ruling it sits under is untouched and still binds.** The
$100/month remains ONE pool, first come first served, and it is still NOT sub-divided per consumer (item 10
of "ten improvements that are all wrong"). `CallSite` attribution likewise stands unchanged, and it now reads **one of four values** rather than one —
the second-consumer moment this mechanism was built for has arrived. Nothing about
reserve-then-settle, the ceiling figure, the prod-only ruling or layer 4b moves.

⛔ **A future parse leg reopens THIS SECTION AND LAYER 4b TOGETHER**, because it needs a Bedrock grant:
either it runs inside the verification gate's existing role (layer 4b intact, but the gate does two jobs
and the parse inherits the verifier's concurrency), or it adds a second grantee — which
`packages/infra/global/__tests__/llmSpendGuards.test.ts` fails by design with kind `'second-grantee'`.
**That decision is unmade, and deleting the dead file did not make it.** Current state:
`docs/architecture/2026-08-28-ingredient-pipeline-state.md` §3.

⛔ **Not capping per consumer makes attribution MORE important, not less.** When the pool empties, the first
question is "who burned it", and a dimensionless `VerificationSpendMicros` cannot answer it. So the spend
metric carries a `CallSite` **EMF dimension** (one of four values — see the amendment below), and nothing
else changes: the
counter row stays keyed on the period alone, and no call site reaches `planReservation`, the headroom, or
either SQL statement. Attribution, not partitioning — asserted directly, by pinning the full field set of the
plan handed to `reserve`.

⚠️ **It is a second dimension SET, not a second key on the only set** — `[['Stage'], ['Stage','CallSite']]`.
EMF publishes only the dimension sets its directive lists; there is no dimensionless rollup underneath them.
Appending `CallSite` to the single `['Stage']` set would have DELETED the aggregate series, and
`VerificationSpendAlarm` — which selects `Stage` alone — would have sat at a permanently confident `OK` with
`treatMissingData: NOT_BREACHING` and no datapoints. That failure has shipped in this repo before
(`serviceInfraWiringInvariants.test.ts` W4, and both deployed `kitchensink-erasure-incomplete-*` alarms). The
cautionary case in the other direction is `source-rolling-window-count`, which carries a `source` dimension
and **no** `stage`, so prod and every preview co-mingle into one series and no call can be attributed at all.

The dimension key space is a closed TypeScript union (`RecipeMetricDimension`), so cardinality grows by
release rather than by traffic, and `callsite` is admitted to the repo-wide facet allowlist with that bound
stated. The alarm is deliberately left on the aggregate: a threshold evaluated per consumer against a pool
none of them owns exclusively would read green at 60% each while the pool is 20% over.

### 5. Cache-token accounting must be defensive, not expectant

`U11` requires the counter to cost `cacheReadInputTokens` / `cacheWriteInputTokens` _"at their own rates
rather than as fresh input."_ That is the right rule. Two facts constrain how it is written:

- On the wire, `TokenUsage.inputTokens`, `outputTokens` and `totalTokens` are **`Required: Yes`**;
  `cacheReadInputTokens`, `cacheWriteInputTokens` and `cacheDetails` are **`Required: No`**. The code must
  treat the cache fields as absent-or-zero, not read them off the response.
- ⛔ **Prompt caching DOES engage, on every warm call.** An earlier draft reasoned that at ~660 input tokens
  it could not — cacheable-prefix minimums are in the low thousands, 4,096 for Claude Haiku 4.5 — and
  concluded both fields would always be zero. The shipped prompt is ~5,025 tokens (§5a), so that premise is
  false and the conclusion inverts with it. The `Required: No` fact above stands regardless.

So the cache-costing branch is **taken on every warm call**, not written-but-unreachable. Write it, still
default both fields to zero defensively (they are `Required: No`), and make the detector the INVERSE of what
an earlier draft specified: alert when a **warm** call reports `cacheReadInputTokens: 0`, because a
sustained zero is now the anomaly. ⛔ Do not add an alert on non-zero — it would report designed behaviour
as a fault on the first call of every deploy.

### 5a. §5's premise is FALSIFIED: caching now engages on every call, and the reservation is 37x the actual

The shipped parse prompt was replaced on 2026-08-27 (511 bytes → **19,777 characters**, flat document →
relational, Nova Micro → **Nova 2 Lite** on the `flex` service tier). Three things §5 states as facts stopped
being true, and one of them is a guard that will now fire correctly and read as an incident.

⚠️ **The model moved again, and the caching finding is independent of it.** The parse leg runs **Nova Lite
v1**: Nova 2 Lite won on accuracy but is `INFERENCE_PROFILE`-only across three regions with no residency
warrant, so once residency became enforced BOTH the runtime and the IAM policy refuse it. The verification
gate's own default is still Nova Micro and is unchanged — it comes from SSM (§3), and the gate and the parse
leg pick their models independently.

⛔ **"At ~660 input tokens, prompt caching cannot engage" no longer holds.** The prompt is **5,025 tokens**.
Measured live on 2026-08-27 over 92 calls: `cacheReadInputTokens: 5025` on every warm call, `cacheWrite` on
exactly **two** — both cold starts. Six concurrent threads cost no more writes than sequential calls did.

⛔ **So §5's "assertion/metric that fires if either is ever non-zero" MUST BE REWRITTEN, not left to fire.**
Its stated meaning — _"the prompt grew past the cache threshold and the cost model needs revisiting"_ — has
already happened and has already been actioned here. Left as written it reports designed behaviour as an
anomaly on the first call of every deploy. What replaces it is the inverse: alert when a warm call reports
`cacheReadInputTokens: 0`, which means the cache is NOT engaging and the bill is 3.4x what this ADR assumes.

⚠️ **Nova cache WRITES are free, and that was not obvious.** `USE1-Nova2.0Lite-cache-write-input-token-count`
= `$0.0000000000`, read from the AWS Pricing API. Cache reads are `$0.0000825/1K` — exactly 0.25x input. So a
cold burst is _cheaper_ than a warm one, not dearer, and "keep the cache warm or pay a write premium" —
which is true of Claude — is **wrong for Nova** and must not be carried over.

⛔ **`flex`, NOT batch, is the 50% path.** AWS documents prompt caching as supported _"only for on-demand
inference endpoints… not with the batch inference API."_ Batch's 50% would be bought by surrendering the 75%
cache discount, costing **$0.000882/line against $0.000521** — batch is 1.69x DEARER here. The `flex` service
tier is 50% off (`-flex` usage types, half of every rate) **and keeps the cache**: verified live, accepted,
echoed back in the response, same `cacheReadInputTokens`. Measured shipped cost is **$0.000260/line**.

⚠️ **THE OPEN ITEM: the reservation is now ~37x the actual, and this ADR has not decided what to do.**
Layer 1's caps rose with the prompt — `MAX_PARSE_PROMPT_CHARS` 2,000 → 22,000, `PARSE_MAX_OUTPUT_TOKENS`
200 → 900 — so the worst case charged before each call went **116 → 9,735 micro-dollars**, against a measured
actual of **260**.

⛔ **The derived worst-case figures in this section are NOT current, and have not been re-derived.** They
were computed under a CODE-POINT input cap that has since been replaced by a UTF-8 BYTE bound (up to 4×
wider), and against a model the leg no longer runs. The two prompt constants are still current; every figure
derived FROM them here — the worst case, the "~37×" ratio, the reserved-headroom call count — is stale in an
unknown direction until someone re-derives it against `PARSE_INPUT_TOKEN_CEILING` and Nova Lite v1. Treat
them as illustrative of the SHAPE (reserve worst case, settle actual), never as numbers.
inputTokenCeiling(MAX_PARSE_PROMPT_CHARS, PARSE_PROMPT_TURNS)` at

> `packages/shared/recipe-core/src/parsing/parsePrompt.ts:298-308`. Both constants above are still current
> (`parsePrompt.ts:273,292`), but the derived worst case and the "~37×" / "~10,272 calls of reserved headroom"
> figures below are **not** — they have not been re-derived against the byte bound, nor against Nova Lite v1.
> The DIRECTION is unchanged and is the load-bearing part: the reservation over-charges, refunds at settle, and
> errs safe. Do not quote these numbers.

The reservation is refunded at settle, so monthly totals stay accurate; what degrades is
PRECISION. The cap is now almost entirely OUR OWN CACHED PROMPT priced as fresh input, so every in-flight
call holds headroom it cannot spend and the ceiling begins refusing calls while real budget remains — about
**10,272 calls** of reserved headroom against a $100 pool that would really buy ~385,000.

⛔ The fix is to reserve the FIXED prompt at its **cached** rate plus the VARIABLE line at the fresh rate,
rather than treating the whole cap as fresh input. That changes what "worst case" means and therefore what
the ceiling enforces, so it is a decision this ADR owes and **not** a refactor to be done in passing. Until
it is taken, the ceiling is conservative in the safe direction — it denies early, it never under-counts.

## Consequences

**Accepted:**

- **The counter is a circuit breaker, not an invoice.** It is estimated from token counts at list-price
  rates held in our own table. It will drift from CUR — negotiated rates, credits and rounding are not
  modelled. Layer 5 exists to measure that drift, not to eliminate it.
- **Reserved spend never exceeds the ceiling**, because `$headroom` subtracts the worst case before the
  comparison. Actual spend is always at or below reserved. ⚠️ Do not "simplify" the comparison to
  `reserved_micros <= CEILING_MICROS` to make it read more naturally — that is the edit that would create
  real overshoot.
- **Crashes over-count.** A reservation whose settle never runs is never refunded within the period. At 370×
  headroom this is invisible; it is recorded because the arithmetic is deliberately biased one way.
- **The ceiling protects PROD only.** Sandbox and every open PR call the provider ungated, bounded solely by
  layers 0–2 at ≈$88/month/stage on Nova. A non-prod runaway is billed, not denied — which is also where a
  runaway is most likely to originate.
- **On Nova Micro the ceiling will essentially never fire.** The runaway §Context names — 8,000 calls
  becoming 800,000 — costs ~$27, well under $100. The ceiling is a backstop against a `maxTokens` mistake
  and against a model change, not against call volume alone.
- **`reservedConcurrency = 1` serializes the workload.** ~1s per call means a 2,432-line bake-off is ~40
  minutes and `KTD-4`'s 80,000-line re-import scenario would be ~22 hours. Acceptable for an async
  off-queue path. §2's bound does not depend on this value, so it can be raised for throughput without
  reopening the ceiling.
- **The call shares the NAT instance with every other VPC-attached Lambda** (§4a) — the set and its size are
  ADR-0004's generated `nat-consumers` table, asserted by `natEgressConsumers.test.ts`, and are deliberately
  not restated here because this copy has rotted twice. At `reservedConcurrency = 1` and
  roughly 1 KB each way this is invisible against the instance's throughput, but it is a shared resource
  rather than a dedicated path, and the NAT is a documented single-AZ SPOF: an AZ failure stops the
  verification gate along with every other DB-bound Lambda. That is the accepted trade for not paying
  $14.60/month/stage to carry $0.27/month of inference.

**Rejected, with reasons:**

- **A Budget Action as the gate** — inherits the 8–12h detection lag (§1).
- **Lowering the Bedrock TPD quota to act as a ceiling** — Service Quotas is increase-only
  (_"The new value must be greater than the current value"_), it is token- not dollar-denominated, and it is
  account + model + Region scoped, so it would throttle every other Bedrock consumer in the account.
  ⚠️ Whether AWS Support will lower a Bedrock quota on request is **undocumented and unverified** — do not
  build on it without a support case that says yes in writing.
- **Application inference profiles as an enforcement point** — attribution only.
- **An AgentCore Gateway with Cedar budget policies** — real enforcement at the right latency, but it means
  adopting AgentCore for one Lambda calling one model. Revisit only if the agentic surface grows.
- **Reading CloudWatch metrics as the counter** (the shape AWS's own published sample uses) — inherits
  minute-scale metric lag and account-wide scope, and cannot deny a call it has not yet seen.

## Residual risk

- **The rate table is a hand-maintained copy of Bedrock's price list.** A stale entry silently under-counts.
  It carries an effective date; layer 5 is the detector.
- **A second caller invoking Bedrock outside the gate is prevented by IAM, not by the counter** (layer 4b).
  The guard test is what keeps that true; without it the grantee set drifts silently and nothing notices.
- **Layer 5's counter-vs-invoice comparison assumes this gate is the account's only Bedrock consumer.** That
  holds today — feature 005's AI work is BYOK against the user's own provider and never touches this
  account — but a future in-account consumer would make the budget aggregate a wider scope than the counter
  measures, and the disagreement diagnostic would start false-alarming. The fix at that point is a
  cost-allocation tag on an application inference profile, which is the one job §1 correctly identifies
  those profiles as fit for.
- **Prompt-cache minimums are model-specific and were confirmed for Claude Haiku 4.5 only.** Nova Micro's
  threshold was not verified. ⚠️ Only the **defensive reads** half of §5's guidance carries over: "alert on
  non-zero" is wrong at the shipped prompt size, where caching engages on every warm call, so the detector
  is the inverse (alert when a warm call reports `cacheReadInputTokens: 0`).

## Verification record

Checked against primary AWS documentation on **2026-08-20**. Blogs were used only to establish prior art,
never to establish a fact.

| Claim                                                                                                 | Source                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quotas are on tokens/requests; no dollar quota                                                        | [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html), [bedrock-runtime quotas](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-runtime.html)      |
| TPD exists; reserve-then-settle mirrors Bedrock's own burndown                                        | [How tokens are counted](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html)                                                                                              |
| Service Quotas is increase-only                                                                       | [Requesting a quota increase](https://docs.aws.amazon.com/servicequotas/latest/userguide/request-quota-increase.html)                                                                                  |
| Inference profiles are attribution, not enforcement                                                   | [Inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles.html), [Track usage and costs](https://docs.aws.amazon.com/bedrock/latest/userguide/cost-management.html) |
| `usage` field requiredness                                                                            | [TokenUsage](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_TokenUsage.html)                                                                                                      |
| No per-request cost parameter                                                                         | [Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)                                                                                                          |
| Budgets refresh 8–12h; overshoot warning                                                              | [Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)                                                                       |
| Budget actions fire off the same evaluation                                                           | [Configuring budget actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html)                                                                                       |
| Anomaly detection up to 24h, alert-only                                                               | [Cost Anomaly Detection](https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html)                                                                                                  |
| Bedrock metrics + `ModelId` dimension                                                                 | [bedrock-runtime CloudWatch metrics](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html)                                                                             |
| Alarm actions cannot invoke Lambda directly                                                           | [Using CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)                                                                                     |
| A row-level lock serializes concurrent writers on the counter row; `SET x = x + $d` is not idempotent | [PostgreSQL — Row-level locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)                                                                                             |
| Only Gemma, no Gemini, on Bedrock                                                                     | [Google models in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-google.html)                                                                                        |
| Pre-invocation budget checks are the recommended shape                                                | [AGENTCOST07-BP01](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentcost07-bp01.html)                                                                                           |

**Prior art** (pattern precedent, not authority):
[Build a proactive AI cost management system for Amazon Bedrock](https://aws.amazon.com/blogs/machine-learning/build-a-proactive-ai-cost-management-system-for-amazon-bedrock-part-1/) ·
[Per-user token guardrails for Amazon Bedrock](https://aws.amazon.com/blogs/publicsector/implementing-per-user-token-guardrails-for-amazon-bedrock-in-government-agencies/) ·
[Claude apps gateway for AWS](https://aws.amazon.com/blogs/machine-learning/introducing-claude-apps-gateway-for-aws/)

**Not verified — do not treat as settled:**

- Whether AWS Support will lower a Bedrock TPM/TPD quota.
- CloudWatch publication lag for `AWS/Bedrock` metrics (undocumented; the ~2–6 min figures for layer 4/5 are
  inferred from standard-resolution behaviour, not an SLA). **Measure before relying on it.**
- Claude Haiku 4.5's per-token price **on Bedrock** — the pricing page renders client-side and the AWS
  Pricing API's Bedrock `model` attribute does not list it. The plan's $8.48/month figure computes exactly
  from Anthropic's FIRST-PARTY rates ($1.00/$5.00 per 1M), which is an assumption, not a reading. Nova Micro
  IS settled: $0.035/1M input and $0.14/1M output in us-east-1, read from the Pricing API on 2026-08-20,
  which reproduces the $0.27/month figure exactly.
- Nova Micro's prompt-cache minimum token threshold.

## Amendment — four call sites, one attribution falsehood corrected, still ONE pool

The pool's consumer roster is now FOUR call sites on the one $100 ceiling — attribution, never
partitioning, exactly as §4c's deprecation note demanded:

- `verification-gate` — the original consumer, unchanged.
- `ingredient-parse` — the revived parse leg (plan U8), inside the verification gate's role per §4b's
  single-grantee rule.
- `foodness-validator` — the in-loop foodness judge (plan U6, KTD-E/KTD-F); fires up to twice per parse
  attempt, four attempts per line.
- `measurement-validator` — **new, and it corrects a documented falsehood.** The measurement validator's
  own docstring claimed it "reuses the gate's quantity machinery as a LIBRARY and spends nothing", while
  the implementation reserved, called Bedrock and settled on every judgement — billed under the FOODNESS
  dimension, so the one metric that decomposes this pool lied about which validator was burning it. It
  now bills under its own name (`gatedMeasurementCallSite.test.ts` pins the dimension).

Recomputed per-LINE worst case under the retry loop (KTD-F's four attempts): 1 parse call + up to 2
foodness judgements and 1 measurement judgement per attempt ⇒ ≤ 1 + 4×3 = 13 gated calls per imported
line, plus 1 verification-gate call per resolved line at save. The ceiling arithmetic is unchanged — the
reserve-then-settle counter bounds all of them together, and the parse CACHE bounds redelivery
amplification.

Non-consumers, stated so the roster cannot rot the way §4c's did: plan U12's promotion funnel and U19's
corroborated-completion trigger added NO Bedrock consumers — both are pure service/database flows — and
layer 4b's single `bedrock:InvokeModel` grantee is unchanged (`llmSpendGuards.test.ts`).

## Amendment — residency is enforced, the wildcard is gone, and three §4/§4b claims are retracted

PR #91's review surfaced findings that contradict text this ADR states as fact. Amending in place rather than
superseding: §1–§3, the reserve-then-settle protocol, the $100 monthly ceiling and the single-grantee rule
are unchanged. What follows retracts named clauses only.

### Retracted — the `foundation-model/*` wildcard

§4b recorded that the wildcard's stated justification ("the model id comes from SSM and cannot be resolved at
synth time") "no longer holds, and it stays for a weaker reason … not because it is irreducible."

**It is gone.** `bedrockInvokeStatements` derives every ARN from `BEDROCK_MODEL_REGISTRY`: on-demand models by
name in the deploy region, profiles and their `bedrock:InferenceProfileArn`-conditioned fan-outs as before. A
profile-addressed model deliberately receives **no** bare-id deploy-region grant — that would re-authorize the
direct call the condition exists to deny. `VERIFICATION_BEDROCK_MODEL_WILDCARD` is deleted from
`AcceptedNagFindings`, because leaving an acceptance for a wildcard that no longer exists would silence the
IAM5 finding a future registry entry written with a `*` ought to raise.

### Retracted — "RESIDENCY IS STILL OPEN, AND IS NOT GATED BY IAM"

§4b's ⛔ paragraph is retracted in full. `residencyClearance` now has both its declared callers, landed as ONE
change exactly as that paragraph required: `planReservation` refuses a `residency-unapproved` entry, and
`bedrockInvokeStatements` emits no statement for one. IAM cannot grant what the runtime refuses, because both
ask the same predicate and resolve the same region (`Stack.region` at synth, `AWS_REGION` at runtime).

⛔ **No `residencyApproval` was recorded, and that was the decision.** Whether user recipe text may come to
REST in us-east-2/us-west-2 — where AWS documents that prompts and outputs "may be stored … for abuse
detection purposes" — is a data-protection determination owned by feature **016**, not a marker to edit. The
registry's own comment said so ("not a config detail, and not mine to close by editing a marker"), and adding
one would have manufactured the green signal instead of fixing the system.

**The parse leg moved to Nova Lite v1**, whose `reach` is `deploy-region`. That keeps the leg working while
the clearance is enforced, and takes the 016 question off the critical path rather than pre-empting it: if 016
later approves cross-region routing, the marker will then mean something. Accuracy against Nova 2 Lite is the
trade, and it is a trade — not a free substitution.

⚠️ ADR-0026 §9 and `docs/architecture/2026-08-28-ingredient-pipeline-state.md` still name Nova 2 Lite as the
shipped parse model. Both are now stale and are corrected separately.

### Retracted — "reservation is a bound" and the code-point input cap

§4's reservation arithmetic is amended on two counts found in review. The reservation rounded every input
class once at the highest rate while settlement rounded each class independently, so the reserved figure was
not an upper bound on the settled one; classes are now rounded consistently. And the input cap counted Unicode
**code points**, which is not an upper bound on tokens — a byte-fallback BPE tokenizer emits an unknown code
point as up to four tokens. The bound is now bytes.

⚠️ `CHAT_TEMPLATE_BASE_TOKENS` / `_PER_TURN` (32 / 16) are **unmeasured**. No Bedrock tokenizer is published
and no live call was made. They are a defensive constant, and the control is the
`VerificationInputBoundExceeded` detector, not the numbers.

### Accepted, not fixed — a refused line stalls rather than re-drives

A residency refusal leaves the line `pending`. U9 re-runs only `failed_retryable`, so nothing re-drives it and
the job closes at TTL. `verifyLine.ts` treats a _ceiling denial_ — also month-long — as transient precisely so
it surfaces as redrivable DLQ depth, and this deliberately differs: a residency refusal is a standing product
decision, and reporting a decision as queue depth trains an operator to ignore the queue.

⛔ The reason that is tolerable is the alarm, not the disposition. The refusal is the one failure leaving no
other trace — message acknowledged, nothing landed, nothing reserved, nothing thrown, DLQ flat, `Errors` flat,
spend merely quiet. `VerificationResidencyRefused` and its `> 0` alarm exist so the stall is loud. **Without
that metric this disposition would be wrong**, and a change that removes it must revisit this paragraph.

⚠️ Corrected while writing this: an earlier claim that recipe-workers logs route to Sentry is **false**. The
repository's only `logs.SubscriptionFilter` is in `WebhooksStack`, draining the webhook Lambda, the API access
log and the identity ECS service. No recipe-workers log group is subscribed.

### Still open

- **The bake-off can still reach a profile-addressed model, and the new gate does not stop it.**
  `verificationBakeOff.ts` keeps its own `INVOCATION_IDS` map, preserved in §4b on a _spend_ argument that does
  not carry the data-protection one this change creates, and it runs under operator credentials that bypass
  this role by design.

    ⚠️ State the scope precisely, because an earlier draft of this section did not. It is a **hand-run operator
    script**, not a live path: a bare invocation runs §4a's roster (Nova Micro, Claude Haiku 4.5), reaching a
    profile requires deliberately passing `--models`, and the corpus is **operator-supplied and refused if
    absent** — `--corpus <path.jsonl> is required; the corpus is operator-supplied and not in this repo` — so it
    may well be the synthetic one from `generateBakeOffCorpus.ts`. No user recipe text flows through it by
    default, and nothing runs it automatically. What is true is narrower and still worth recording: an operator
    who runs it against a profile can route whatever file they supplied cross-region, and the residency
    enforcement above will not intervene.

- **Nothing is exercised against a live profile call**, unchanged from §4b: no profile-backed model is invocable
  on this account, so both halves remain proved by unit tests and synthesized templates only.
