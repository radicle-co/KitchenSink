# 0024 — The LLM spend ceiling is enforced by a RESERVE-THEN-SETTLE counter in our own code; no AWS mechanism can gate it

- **Status**: Accepted
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
  [ADR-0022](0022-in-stack-migration-trigger.md) — the counter's table is the DynamoDB substrate
  `RecipeWorkersStack` already owns, so it is inside the same deploy barrier.
- **Supersedes within the plan**: `docs/plans/2026-08-20-001-fix-ingredient-resolution-quality-plan.md`
  §U11 layer 2 and §KTD-4's bake-off roster. Where this ADR and that plan disagree, this ADR wins and the
  plan is to be corrected.

## ⚠️ Before you change this — five "improvements" that are all wrong

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
5. **Do not write cost logic for `cacheReadInputTokens` / `cacheWriteInputTokens` and assume it runs.** Both
   are `Required: No` on the wire, and at ~660 input tokens prompt caching **cannot engage on any
   candidate**. See Decision §5.

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

One item per period, **one atomic conditional write per call, with no prior read**:

```
// RESERVE — checks the ceiling and charges worst case in a single round trip.
UpdateItem
  Key:                 { pk: "verification-spend#2026-08" }
  UpdateExpression:    "ADD reservedMicros :worst SET expiresAt = if_not_exists(expiresAt, :ttl)"
  ConditionExpression: "attribute_not_exists(pk) OR reservedMicros <= :headroom"
  Values:  :worst    = worstCaseMicros(modelId, MAX_INPUT_TOKENS, maxTokens)
           :headroom = CEILING_MICROS - :worst
```

`ConditionalCheckFailedException` **is** the budget denial. The cascade terminates as `unresolved` without
invoking the provider — the same defined, safe path as provider-unavailable.

```
// SETTLE — refund the difference. :delta is normally negative.
UpdateItem
  Key:              { pk: <the SAME key captured at RESERVE time — never recomputed> }
  UpdateExpression: "ADD reservedMicros :delta, settledMicros :actual, calls :one"
  Values:  :actual = costMicros(usage.inputTokens, usage.outputTokens, rateTable[modelId])
           :delta  = :actual - :worst
```

Why this is correct where the obvious shape is not:

- **Overshoot is provably bounded at `CEILING + one worst-case call`**, under arbitrary concurrency.
  DynamoDB conditional writes _"check their conditions against the most recently updated version of the
  item"_ and writes to a single item are serialized. The bound therefore does **not** depend on
  `reservedConcurrency = 1` — which means the concurrency setting is free to change later for throughput
  reasons without silently breaking the ceiling. That decoupling is the main reason to prefer this shape.
- **Every failure mode is fail-safe.** Crash after reserve → the worst-case charge stands (over-count).
  Crash after the Bedrock response → same, and because `worst ≥ actual` we can never under-count. An SDK
  retry of the reserve double-charges — also conservative. Set `maxAttempts: 1` on the reserve call to keep
  that rare.
- **`TransactWriteItems` is NOT warranted.** One item, one invariant. Transactions cost 2× and buy nothing.
  Do not "harden" this into a transaction.
- **The period key is captured once, at reserve, and carried into settle.** Recomputing it at settle time is
  a real bug: a call spanning midnight UTC on the 1st reserves against month M and settles against M+1,
  leaving M permanently over-reserved and M+1 permanently over-charged. Compute in **UTC** — that is what AWS
  bills on, so our counter and the audit budget (§3) agree on where the boundary is.
- **Scale is a non-issue.** 8,000 writes/month against one item is ~0.006 WCU/s. Revisit single-item
  contention above ~1,000 writes/s; we are six orders of magnitude away.

**Two preconditions the counter depends on, which must ship with it:**

- **`maxTokens` MUST be set explicitly, and input tokens MUST be capped before the call.** Worst-case cost is
  `MAX_INPUT_TOKENS × inRate + maxTokens × outRate`. If prompt length is unbounded, the reservation is a
  lie and the ceiling does not hold. The raw source line is already untrusted input (U11); it is also
  unbounded length. Truncate or reject at the boundary.
- **An unreadable counter fails CLOSED**, to `unresolved`. Correct for this workload specifically: the gate
  is a quality enhancement on an async queue path, so failing closed degrades resolution quality rather than
  causing an outage, and a hard ceiling is the component's entire purpose. (Note that the published
  precedents default the _other_ way — the Claude apps gateway fails open, because blocking a developer's
  IDE is worse than overspending. Different workload, different trade. Do not import their default.)

### 3. Five layers, each stated with its enforcement latency

| #   | Layer                                                                  | Stops                                      | Latency                                           | Scope                                                   |
| --- | ---------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------- | ------------------------------------------------------- |
| 0   | SQS `maxReceiveCount` + DLQ                                            | A retry loop **before it becomes cost**    | **Real-time**, enforced by SQS                    | Per-queue. Cheapest, highest-value control in the stack |
| 1   | Explicit `maxTokens` + input-token cap                                 | Worst-case cost of one call                | **Real-time**, in-process                         | Per-call. Precondition for layer 3                      |
| 2   | `reservedConcurrency = 1`                                              | Burst _rate_                               | **Real-time**                                     | Per-function. **Blast radius, not the ceiling**         |
| 3   | **Reserve-then-settle counter — monthly ($100) and daily sub-ceiling** | The owner's ceiling                        | **~5–10 ms, before the call.** Overshoot ≤ 1 call | Per-application. **This is the gate**                   |
| 4   | EMF dollar metric → CloudWatch alarm → SNS → Lambda                    | Counter bugs, counter bypass               | **~2–6 min**                                      | Per-application, **dollar-denominated**                 |
| 5   | AWS Budget (~$20, filtered to Bedrock), actual + forecasted            | Drift between our estimate and the invoice | **8–12h**                                         | Account. **Audit, never the gate**                      |

**Layer 3 gains a DAILY sub-ceiling** (~$5) on the same mechanism and the same code path, keyed
`verification-spend#YYYY-MM-DD`. Rationale: the monthly ceiling cannot detect a runaway that completes
inside the month it happens, and §Context establishes that a same-day runaway is the _only_ event this
system is defending against. The daily ceiling costs one extra conditional write and is the layer most
likely to actually fire.

**Layer 4 emits our OWN metric, and that is deliberate.** A CloudWatch alarm on `AWS/Bedrock`
`InputTokenCount` / `OutputTokenCount` is available and is kept as a bypass detector, but it is
account + Region + `ModelId` scoped and **token**-denominated — so anything else in the account calling the
same model corrupts it, and its dollar threshold must be re-derived whenever the model changes. An EMF
metric from the Lambda we are already logging from is app-scoped, dollar-denominated, and free.

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
is 17 across six stacks. The endpoint would not have prevented a widening. It would have bought a second
egress path for a consumer already on the first one.

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

⚠️ Accepted consequence: the gate now shares a single-AZ NAT instance with 16 other Lambdas, so an AZ
failure takes it down with them. At `reservedConcurrency = 1` and ~1 KB per call, throughput is not the
concern; availability is, and the answer is that this is an async off-queue path whose messages wait.

### 5. Cache-token accounting must be defensive, not expectant

`U11` requires the counter to cost `cacheReadInputTokens` / `cacheWriteInputTokens` _"at their own rates
rather than as fresh input."_ That is the right rule. Two facts constrain how it is written:

- On the wire, `TokenUsage.inputTokens`, `outputTokens` and `totalTokens` are **`Required: Yes`**;
  `cacheReadInputTokens`, `cacheWriteInputTokens` and `cacheDetails` are **`Required: No`**. The code must
  treat the cache fields as absent-or-zero, not read them off the response.
- **At ~660 input tokens, prompt caching cannot engage.** Cacheable-prefix minimums are in the low
  thousands of tokens — 4,096 for Claude Haiku 4.5. Both fields will be zero on every call, for every
  candidate, for this prompt size.

So the cache-costing branch is **correct but unreachable**. Write it, default both fields to zero, and add
an assertion/metric that fires if either is ever non-zero — that signal means the prompt grew past the cache
threshold and the cost model needs revisiting. Do **not** write a test that claims to verify cache costing
against a real cache hit; it cannot be produced at this prompt size, and a test that fabricates the response
proves only that the arithmetic compiles.

## Consequences

**Accepted:**

- **The counter is a circuit breaker, not an invoice.** It is estimated from token counts at list-price
  rates held in our own table. It will drift from CUR — negotiated rates, credits and rounding are not
  modelled. Layer 5 exists to measure that drift, not to eliminate it.
- **Overshoot of up to one worst-case call above the ceiling is permitted, by design.** Eliminating it would
  require holding a lock across the Bedrock call.
- **Crashes over-count.** A reservation whose settle never runs is never refunded within the period. At 370×
  headroom this is invisible; it is recorded because the arithmetic is deliberately biased one way.
- **`reservedConcurrency = 1` serializes the workload.** ~1s per call means a 2,432-line bake-off is ~40
  minutes and `KTD-4`'s 80,000-line re-import scenario would be ~22 hours. Acceptable for an async
  off-queue path. §2's bound does not depend on this value, so it can be raised for throughput without
  reopening the ceiling.
- **The call shares the NAT instance with 16 other VPC Lambdas** (§4a). At `reservedConcurrency = 1` and
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
- **Nothing prevents a _second_ caller from invoking Bedrock without going through the gate.** The counter
  guards one code path, not the IAM permission. Layer 4's `AWS/Bedrock` alarm is the only bypass detector.
- **The daily sub-ceiling and the monthly ceiling are the same code with different keys.** A bug in the
  shared path disables both. They are not independent layers; layers 4 and 5 are.
- **Prompt-cache minimums are model-specific and were confirmed for Claude Haiku 4.5 only.** Nova Micro's
  threshold was not verified. §5's guidance (defensive reads, alert on non-zero) is correct either way.

## Verification record

Checked against primary AWS documentation on **2026-08-20**. Blogs were used only to establish prior art,
never to establish a fact.

| Claim                                                                                           | Source                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quotas are on tokens/requests; no dollar quota                                                  | [Quotas for Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas.html), [bedrock-runtime quotas](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-runtime.html)      |
| TPD exists; reserve-then-settle mirrors Bedrock's own burndown                                  | [How tokens are counted](https://docs.aws.amazon.com/bedrock/latest/userguide/quotas-token-burndown.html)                                                                                              |
| Service Quotas is increase-only                                                                 | [Requesting a quota increase](https://docs.aws.amazon.com/servicequotas/latest/userguide/request-quota-increase.html)                                                                                  |
| Inference profiles are attribution, not enforcement                                             | [Inference profiles](https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles.html), [Track usage and costs](https://docs.aws.amazon.com/bedrock/latest/userguide/cost-management.html) |
| `usage` field requiredness                                                                      | [TokenUsage](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_TokenUsage.html)                                                                                                      |
| No per-request cost parameter                                                                   | [Converse](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html)                                                                                                          |
| Budgets refresh 8–12h; overshoot warning                                                        | [Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)                                                                       |
| Budget actions fire off the same evaluation                                                     | [Configuring budget actions](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html)                                                                                       |
| Anomaly detection up to 24h, alert-only                                                         | [Cost Anomaly Detection](https://docs.aws.amazon.com/cost-management/latest/userguide/manage-ad.html)                                                                                                  |
| Bedrock metrics + `ModelId` dimension                                                           | [bedrock-runtime CloudWatch metrics](https://docs.aws.amazon.com/bedrock/latest/userguide/monitoring-runtime-metrics.html)                                                                             |
| Alarm actions cannot invoke Lambda directly                                                     | [Using CloudWatch alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)                                                                                     |
| Conditional writes evaluate against the latest item version; atomic counters are not idempotent | [Working with items](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithItems.html)                                                                                           |
| Only Gemma, no Gemini, on Bedrock                                                               | [Google models in Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-google.html)                                                                                        |
| Pre-invocation budget checks are the recommended shape                                          | [AGENTCOST07-BP01](https://docs.aws.amazon.com/wellarchitected/latest/agentic-ai-lens/agentcost07-bp01.html)                                                                                           |

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
