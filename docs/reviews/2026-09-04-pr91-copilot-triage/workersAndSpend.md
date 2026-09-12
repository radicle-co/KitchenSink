# PR #91 Copilot triage — `recipe-workers` and the spend gate

Twelve open (non-outdated) review threads on `packages/services/recipe-workers/**` and
`packages/shared/recipe-core/**`. Ten distinct findings — two threads are the same CodeQL alert reported
twice.

**Nothing has been posted to the PR.** The reply text below is a draft for the owner to approve.

Base: `254a906b`. Everything below was implemented TDD (failing test first) and verified locally:
`npm run lint`, `npm run typecheck`, the full `recipe-workers` unit suite (614), the full integration tier
against a throwaway `postgres:18` + LocalStack (89 passed, 4 skipped — the CRF suite needs the Python
engine), `recipe-core` (1,024), `infra-security` (78), `cookbook-import` (565), and the four global-infra
guards most exposed to these changes (`llmSpendGuards`, `cdkNagAttachment`, `erasureSweepCoverage`,
`serviceInfraWiringInvariants` — 111).

## Dispositions

| #   | Thread                                            | Location                                                                      | Verdict                               |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------- |
| 1   | `PRRT_kwDOR7sDRs6cHFsI`                           | `infra/lib/RecipeWorkersStack.ts:964`                                         | **fixed**                             |
| 2   | `PRRT_kwDOR7sDRs6bk_Os`                           | `src/common/verificationSpend.ts:176`                                         | **fixed**                             |
| 3   | `PRRT_kwDOR7sDRs6bcIOH`                           | `src/common/verificationSpend.ts:227`                                         | **fixed**                             |
| 4   | `PRRT_kwDOR7sDRs6bcION`                           | `src/handlers/accountErasureWorker.ts:711`                                    | **fixed**                             |
| 5   | `PRRT_kwDOR7sDRs6bk_Pb`                           | `src/spend/spendArithmetic.ts:636`                                            | **fixed**                             |
| 6   | `PRRT_kwDOR7sDRs6bcIOT`                           | `src/resolution/verificationPrompt.ts:86`                                     | **fixed**                             |
| 7   | `PRRT_kwDOR7sDRs6bZ1A5`                           | `__tests__/integration/verification/verificationSpend.integration.test.ts:34` | **fixed** (widened to all 16 suites)  |
| 8   | `PRRT_kwDOR7sDRs6bAt7j`                           | `infra/lib/RecipeWorkersStack.ts:100`                                         | **fixed**                             |
| 9   | `PRRT_kwDOR7sDRs6bk_PQ`                           | `src/handlers/verifyLine.ts:356`                                              | **owner-decision**                    |
| 10  | `PRRT_kwDOR7sDRs6XhR4A`                           | `package.json:45`                                                             | **rejected**                          |
| 11  | `PRRT_kwDOR7sDRs6Zjvr9` + `PRRT_kwDOR7sDRs6fJMAR` | `src/handlers/__tests__/handleSyncWorker.test.ts:138`                         | **fixed** (one alert, reported twice) |

---

### 1. `RecipeWorkersStack.ts:964` — `bedrock:InvokeModel` on every foundation model in the region

**fixed** — commit `892792b4`.

The bot is right, and ADR-0024 had already said so about itself. §4b: _"The `foundation-model/*` wildcard's
stated justification no longer holds, and it stays for a weaker reason … not because it is irreducible."_
The justification in the code and in the nag acceptance was still the retracted one — that the SSM model id
cannot be resolved at synth time. It can: `BEDROCK_MODEL_REGISTRY` is a frozen compile-time table, and every
runtime caller resolves through `planReservation`, which refuses an unregistered id as `unpriced` before
Bedrock is reached. So the wildcard authorized precisely the set of models the runtime could never call,
while standing as a second authority beside the registry on the layer ADR-0024 names as the ceiling's only
bypass control.

`inferenceProfileStatements` became `bedrockInvokeStatements` and now derives the on-demand grants too: each
self-addressed registry entry by its own ARN in the deploy region, unconditioned. Profile ARNs and their
`bedrock:InferenceProfileArn`-conditioned fan-outs are unchanged. A profile-addressed model deliberately
receives **no** bare-id deploy-region grant — that would re-authorize the direct call the condition exists to
deny.

`VERIFICATION_BEDROCK_MODEL_WILDCARD` is deleted from `AcceptedNagFindings`: there is no wildcard left to
accept, and leaving it would silence the IAM5 finding a future registry entry written with a `*` should
raise.

Answering the two specific questions in the comment:

- **Was the resource scope meant to be the registry's models?** Yes — that is exactly what §4b argues, and
  what it deferred only on blast-radius grounds ("narrowing a shipped, cdk-nag-suppressed, currently-green
  statement is a separate change"). This is that change, taken deliberately.
- **Does `llmSpendGuards.test.ts` assert it?** **No, and it structurally cannot.** That guard is a
  TypeScript AST parser over infra _source text_: it reads `actions` array literals and judges the GRANTEE
  set. The resources are `formatArn` calls that only exist after synth. The resource half is asserted in
  `RecipeWorkersStack.test.ts` against a synthesized template, and it is now **set equality in both
  directions** against the registry (`toContain` per entry only proves the grant is not too _narrow_) plus a
  zero-wildcard assertion. Layer 4b's own invariant — one grantee, `InvokeModel` only — is untouched and
  still green.

> **Draft reply.** Accepted, and the ADR agreed with you before the review did: ADR-0024 §4b already recorded
> that this wildcard's stated justification ("the model id comes from SSM and cannot be resolved at synth
> time") no longer holds, and that it survived only because narrowing a shipped, suppressed statement was a
> change with its own blast radius. Taken now. `bedrockInvokeStatements` derives every ARN from
> `BEDROCK_MODEL_REGISTRY` — on-demand models by name in the deploy region, profiles and their conditioned
> fan-outs as before — and the `VERIFICATION_BEDROCK_MODEL_WILDCARD` nag acceptance is deleted with it. One
> correction to the suggestion: `llmSpendGuards.test.ts` cannot assert registry/resource parity, because it
> parses infra _source text_ and these ARNs only exist after synth; the parity assertion therefore lives in
> `RecipeWorkersStack.test.ts` as set equality in both directions, plus "no wildcard at all". Layer 4b's
> grantee/action invariant is unchanged and green.

### 2. `verificationSpend.ts:176` — an unreadable ledger value returned `0`

**fixed** — commit `ad9b29c8`.

Correct, and it defeated the ceiling in the exact way ADR-0024 §2 warns about. `Number(null)` and
`Number('')` are both `0`, so a corrupted or driver-mangled `reserved_micros` read as "nothing spent yet" —
the one value that keeps layer 4's half-ceiling alarm quiet — while the conditional write had already
committed and the call proceeded. The ADR's rule is unambiguous: _"An unreadable counter fails CLOSED — the
call is never made."_

`toMicros` is now `readMicros` and refuses: the column is `bigint NOT NULL` under a `>= 0` CHECK, so
anything that is not a non-negative safe integer is corruption, and the only wrong answer available is a
plausible one. The reserve raises its existing `SpendLedgerError('reserve', …)`, the standing charge
over-counts (ADR-0024's accepted direction), and the handler already treats that as transient — the message
returns to the queue rather than resolving the line.

Six shapes are covered: `null`, `''`, a non-numeric string, a fraction, a negative, and `undefined`.

> **Draft reply.** Accepted. `Number(null)` and `Number('')` are both `0`, so this turned a corrupted counter
> into "nothing spent yet" — the reading that keeps the half-ceiling alarm quiet — after the charge had
> already committed. `readMicros` now refuses anything that is not a non-negative safe integer (the column is
> `bigint NOT NULL` with a `>= 0` CHECK, so nothing else is legitimate) and the reserve fails closed through
> the existing `SpendLedgerError`, which the handler already treats as transient. Six unreadable shapes are
> under test, red before the change.

### 3. `verificationSpend.ts:227` — the settlement `UPDATE` was success by absence of a throw

**fixed** — commit `ad9b29c8`.

Correct, including the consequence the comment spells out. A missing period row makes the `UPDATE` succeed
matching zero rows: no refund, no `calls` increment, no `SETTLE_FAILURE_METRIC_NAME`, and the month's next
reservation starts against a fresh row as though nothing had been spent.

The statement now carries `RETURNING period` and the result is read. `period` is the primary key, so it
matches exactly one row or none; none raises `SpendLedgerError('settle', …)`, which `settleQuietly` already
meters and swallows — so the handler's "nothing after the money is spent may fail the handler" rule is
preserved. It is still **never retried**: nothing at this layer can distinguish a deleted row from one that
is about to exist, and ADR-0024 forbids a second settle because `reserved + delta` is not idempotent.

Covered at both tiers — unit (mocked zero rows) and integration, where the row is genuinely deleted between
reserve and settle so the real engine produces the zero-row `UPDATE`. A mock cannot prove that one; it
answers whatever rows it is told to.

> **Draft reply.** Accepted, with the row count read the way you suggested. `RETURNING period` and a check
> that exactly one row came back; zero raises `SpendLedgerError('settle', …)`, which `settleQuietly` already
> meters — so the settle-failure metric now fires for this case, and the handler still cannot be failed after
> the call is billed. Deliberately still not retried: nothing here can tell a deleted row from one about to
> exist, and a second settle double-refunds. Regression tests at both tiers, including an integration case
> that deletes the row between reserve and settle so a real engine produces the zero-row UPDATE.

### 4. `accountErasureWorker.ts:711` — a misrouted delivery was logged and acknowledged

**fixed** — commit `315a10e7`.

Correct, and it is the failure this worker's own docstring names: _"the failure this worker is designed
against is not a crash — it is a false success."_ An acknowledged message is deleted by SQS: no redelivery,
nothing in the DLQ, and `AccountErasureDlqAlarm` never fires. A right-to-erasure request could be lost in
silence.

The ack was deliberate once — the 2026-07-18 hardening plan wrote _"the message still acks (it is genuinely
not this DB's job)"_ — but that premise does not survive: nobody learns either way, whether the cause is a
cross-stage misroute, a producer that enqueued before its row committed, or a row an operator removed. The
refusal now throws `MisroutedErasureMessageError`.

The destructive interlock is unchanged and still refuses first, so a retry costs one read-only `SELECT`,
refused again, and the message drains to the DLQ where a human sees it. Completed replays are unaffected —
`erasureJobExistsForOwner` is true for them, so they still run their idempotent no-op and still ack.

The suite's `resolves.toBeUndefined()` on that path was **rewritten to prove the new behaviour** rather than
edited to compile, with the reasoning in the test body; it now asserts the error type, that no `DELETE` and
no S3 call was issued, and that no `last_error` was written (there is no row to annotate). An integration
case shows the two interlock predicates answering differently for a completed replay versus a misrouted
owner on the real schema.

> **Draft reply.** Accepted — this was a false success on the GDPR path, which is the one failure this
> worker's docstring says it exists to prevent. The interlock still refuses first (no DELETE, no S3), and it
> now throws `MisroutedErasureMessageError` instead of returning, so the delivery retries — one read-only
> SELECT each time, refused again — and lands in the DLQ where the alarm can see it. Completed replays are
> unaffected, exactly as you noted, because `erasureJobExistsForOwner` is true for them. Worth recording that
> the ack was once deliberate: the 2026-07-18 hardening plan wrote "the message still acks (it is genuinely
> not this DB's job)". That premise is what is wrong — nobody learns either way.

### 5. `spendArithmetic.ts:636` — reservation rounds once, settlement rounds per class

**fixed** — commit `e0c09e75`.

Correct, and it is a real breach of the invariant every consequence in ADR-0024 §2 rests on
(`worst >= actual` for every admissible usage). `Σ ceil(xᵢ) ≤ ceil(Σ xᵢ) + (n − 1)`, and the settlement has
three independently-ceiled input classes where the reservation has one — so the bound could be short by up
to two micro-dollars.

Concretely, at Nova Micro's rates with the gate's 2,000-token cap: the reservation charges
`ceil(2000 × 0.04375) = 88`, while 1,999 cache-write tokens cost `ceil(87.456) = 88` and the one fresh token
beside them costs `ceil(0.035) = 1` — 89 settled against 88 reserved. The existing "every input-token SPLIT,
for EVERY model" test steps 100 tokens at a time and lands on no such partition, which is why it was green.

`worstCaseMicros` now adds a constant `INPUT_ROUNDING_ALLOWANCE_MICROS` (= classes − 1). It is a
**constant**, never a multiple of the cap, so it costs precision nothing — asserted directly, because a
bound that scaled with the cap would re-open ADR-0024 §5a's precision problem through a second door. The new
tests are the named counterexample, an exhaustive enumeration of every `(fresh, read, write)` partition of
every cap up to 40 for every model in the table, and the constant-overhead property.

Two micro-dollars is $0.000002. It is fixed anyway, because "reserved spend never exceeds the ceiling" is an
invariant the ADR argues everything else from, and a bound that is short by a constant is not a bound.

> **Draft reply.** Accepted — real, and it breaks the invariant ADR-0024 §2 argues everything else from.
> `Σ ceil(xᵢ) ≤ ceil(Σ xᵢ) + (n − 1)`: the settlement rounds three input classes independently where the
> reservation rounds once, so the bound can be short by two micro-dollars. The concrete case at Nova Micro
> with a 2,000-token cap is 1,999 cache-write tokens plus one fresh token — 89 settled against 88 reserved.
> The existing partition sweep steps 100 tokens and never lands on it. `worstCaseMicros` now carries a
> constant rounding allowance (never a multiple of the cap, asserted, so precision is untouched), and the
> tests are the counterexample plus an exhaustive enumeration of every partition of every cap to 40, for
> every model.

### 6. `verificationPrompt.ts:86` — a code-point count is not an upper bound on tokens

**fixed** — commit `e0c09e75`. The most consequential of the ten.

The bot is right and the stated reasoning was simply false. `VERIFICATION_MAX_INPUT_TOKENS = 2_000` was set
equal to the code-point cap on the claim that _"no tokenizer emits more than one token per code point"_. A
byte-fallback BPE tokenizer emits a code point its vocabulary does not know as its **UTF-8 bytes** — up to
four tokens. A 2,000-code-point CJK or emoji prompt could be billed ~8,000 input tokens against a
reservation priced for 2,000. `PARSE_MAX_INPUT_TOKENS` repeated the same claim at 22,000, where the gap is
~66,000 tokens. ADR-0024 §2 makes the input cap a **precondition** of the ceiling — _"if prompt length is
unbounded, the reservation is a lie and the ceiling does not hold"_ — so this was the ceiling not holding.

The repair separates two bounds that were being conflated:

- the **acceptance** cap stays in code points (`MAX_VERIFICATION_PROMPT_CHARS`) — which lines the gate will
  judge is a fact about the text a cook wrote, and must mean the same thing in every alphabet. No line's
  accept/reject outcome changes;
- the **spend** bound is `inputTokenBound(turns)`: UTF-8 byte length plus a chat-template allowance. One
  token per _byte_ is the bound a byte-fallback tokenizer actually respects. For a caller that reserves
  before a prompt exists — the band drain, sizing a batch from headroom — `inputTokenCeiling` applies four
  bytes per code point.

Byte length is computed arithmetically from code points, with no `Buffer` and no `TextEncoder`, because
`recipe-core` is bundled into `@commise/web` and `@commise/mobile`; the unit test proves equality with
`TextEncoder` over a generated corpus (the oracle a test may import and the code may not). For the ordinary
ASCII line the new bound is **tighter** than the constant it replaces.

**Cross-check found a worse instance of the same class** (`gatedLlm.ts:106`, not flagged by the bot):
`[...system].length + [...user].length + 400` — code points, a bare `400` with no provenance, and no count
of `fewShotTurns` at all, so the foodness validator's six few-shot messages were reserved for at **zero** on
a leg that fires up to twice per parse attempt, four attempts per line. `turnsOf` now enumerates every turn
the transport sends.

**Residual risk, stated rather than hidden.** The byte bound is a claim about the tokenizers we know of, not
a theorem: NFKC normalisation before encoding, or template framing costing more than the allowance, would
beat it — and the unclamped settle delta would charge the overshoot silently. So both consumers now emit
`VerificationInputBoundExceeded` (valued in excess tokens, carrying `CallSite`) when the **billed total**
input exceeds the bound the plan was priced from, with a CloudWatch alarm on the aggregate `Stage` series.
Billed _total_, not `usage.inputTokens`: ADR-0024 §5a measured the parse prompt arriving almost entirely as
cache reads, so a detector reading the fresh count alone would never fire on the consumer that matters.

`CHAT_TEMPLATE_BASE_TOKENS` (32) and `CHAT_TEMPLATE_TOKENS_PER_TURN` (16) are **provisional and unmeasured** —
neither Bedrock tokenizer is published, and no live call has been made to read them off `usage`. The
measurement recipe is in their docstring; the detector above is what keeps a guess honest until then.

The comment's own suggestion — "use the exact model tokenizer" — is the one option deliberately not taken:
neither Amazon's nor Anthropic's Bedrock tokenizer is published, and shipping a third-party approximation
into a package the mobile app bundles is a heavier dependency than the bound needs.

> **Draft reply.** Accepted, and this was the most serious of the batch. The old cap rested on "no tokenizer
> emits more than one token per code point", which is false for byte-fallback BPE — an unknown code point is
> emitted as its UTF-8 bytes, up to four tokens, so a 2,000-code-point CJK prompt could bill ~8,000 tokens
> against a reservation priced for 2,000 (and the parse leg's 22,000 cap is ~66,000 out). ADR-0024 §2 makes
> the input cap a precondition of the ceiling, so this was the ceiling not holding. The acceptance cap stays
> in code points (unchanged behaviour for which lines are judged); the spend bound is now UTF-8 bytes plus a
> chat-template allowance, per call, and is _tighter_ than the old constant for an ASCII line. We did not take
> the "exact model tokenizer" option: neither Bedrock tokenizer is published, and shipping an approximation
> into a package mobile bundles is a heavier dependency than the bound needs. Two things worth flagging: the
> same class was worse one file over in `gatedLlm.ts` (a bare `+ 400`, and `fewShotTurns` not counted at all,
> so the foodness validator's six examples were reserved for at zero) — fixed too; and the template allowance
> is provisional and unmeasured, so both consumers now emit `VerificationInputBoundExceeded` with an alarm,
> because a byte bound is a claim about known tokenizers rather than a theorem.

### 7. `verificationSpend.integration.test.ts:34` — destructive DDL against whichever `DATABASE_URL` is set

**fixed** — commit `8c9b0a8f`, and widened from the one suite to all sixteen.

Correct, and the blast radius is larger than the thread says. Every suite under `__tests__/integration/`
drops tables, recreates schema or deletes rows, and all sixteen selected their target as
`DATABASE_URL ?? TEST_DATABASE_URL` with no check on where it pointed. `DATABASE_URL` is the application's
own connection variable — `.env.development` aims it at the local sandbox's live recipe database. One
`npm run test:integration` from a shell that had sourced the app's env would have dropped
`verification_spend` and deleted erasure-job rows for the fixture owners.

`disposableDatabaseUrl()` admits a URL only when the host is loopback **and** the database name ends in
`_test`. CI's `recipe_workers_test` already complies, so no workflow changes. Absent both variables the
suites still skip in lockstep. `TEST_DATABASE_URL` is now read **first**: when both are set, the variable
whose name says "test" is the one meant for this tier.

One departure from the suggestion, argued rather than assumed: a URL that is **set but refused fails the
run** rather than skipping it. A skip is the quiet failure this very file has already produced once — its
own docstring records thirteen tests reporting as SKIPPED because `beforeAll` threw, leaving the piece of
U11 that decides whether the $100 ceiling holds with no executed coverage while every run was green.

Pure `decideDatabaseUrl` + one impure reader, so the rule is a truth table. Thirteen unit tests, including
the local-sandbox URL (loopback and live) and a `_test` database on a remote host — the two cases a
one-sided rule would wrongly admit.

> **Draft reply.** Accepted, and widened: all sixteen integration suites selected their database the same
> way, so the one you flagged was an instance rather than the case. `disposableDatabaseUrl()` now admits a URL
> only when the host is loopback AND the database name ends in `_test` (CI's `recipe_workers_test` already
> complies — no workflow change), and `TEST_DATABASE_URL` is preferred over `DATABASE_URL` as you suggested.
> One deliberate difference from the suggestion: a URL that is set but refused FAILS the run rather than
> skipping it. This file's own history is the argument — it once reported thirteen SKIPs because `beforeAll`
> threw, so the spend ledger had no executed coverage while every run looked green.

### 8. `RecipeWorkersStack.ts:100` — `s3:ListBucket` unscoped over a shared bucket

**fixed** — commit `892792b4`.

Correct. `s3:ListBucket` is a bucket-level action; the buckets are shared; and the `s3:DeleteObject`
statement immediately beside it was already scoped to `recipes/*` at the object level. So the two most
destructive roles in the stack could enumerate keys under every other tenant's prefix — objects they could
neither read nor delete, but enumeration is still disclosure, and the asymmetry with the delete grant was
plainly unintended.

`grantRecipeObjectErasure` now attaches `StringLike { s3:prefix: ['recipes/*'] }`, exactly as suggested.
`eraseRecipeObjects` only ever lists `recipes/{ownerId}/{recipeId}/`, so the condition admits precisely what
the handler issues and denies a bare or foreign-prefix listing outright. Both roles that call it — the
account-erasure worker and the erasure-orphan sweeper — are covered and asserted.

The `*` here is a **condition value**, not a resource, so cdk-nag's IAM5 (which reads resources and actions)
raises nothing new and no suppression was added.

> **Draft reply.** Accepted, spelled exactly as suggested: `StringLike` on `s3:prefix` for `recipes/*`, on
> both roles that call `eraseRecipeObjects`. The asymmetry you spotted was the tell — the delete statement
> beside it was already object-scoped to `recipes/*`, so the bucket-level list was wider than anything the
> handler does. It only ever lists `recipes/{ownerId}/{recipeId}/`. Asserted in the stack suite for both
> roles; note the `*` is a condition value rather than a resource, so no new IAM5 finding and no suppression.

### 9. `verifyLine.ts:356` — `residencyClearance` is never called

**owner-decision.** No code change made, on purpose.

The bot's **factual claim is correct** — `residencyClearance` has no caller anywhere outside its own unit
tests — but the framing that this is an oversight is not. ADR-0024 §4b records it as an open decision, in
capitals:

> ⛔ **RESIDENCY IS STILL OPEN, AND IS NOT GATED BY IAM.** … `residencyClearance` exists in
> `spendArithmetic.ts` and no shipped entry carries a `residencyApproval` warrant, but **nothing calls it
> yet** … **Wiring `residencyClearance` into `planReservation` and into this derivation must land as ONE
> change**, or IAM will grant what the runtime refuses (or the reverse).

So the fix is not "add a check in `verifyLine`". Adding it there alone would produce exactly the split the
ADR forbids — a runtime that refuses a model the IAM policy grants — and it would be the _wrong layer_
besides: residency is already a pure policy (`residencyClearance` is pure and total, deliberately "the only
interpreter of the marker, called by BOTH the runtime gate and the CDK stack"), which is the same shape
ADR-0023 ruled on for authorization.

**What makes this an owner decision rather than an implementation task:** enforcing residency today makes
the _shipped parse model uncallable_. `amazon.nova-2-lite-v1:0` is `INFERENCE_PROFILE`-only, every profile
that exists for it leaves us-east-1, and it carries no `residencyApproval` — so `residencyClearance` answers
`unapproved` for the model selected on gold-set accuracy (84%/53% against Nova Micro's 64%/30%). Turning the
predicate on is therefore a product decision: fall back to Nova Lite v1 (73/41 static, 82/52 with retrieval —
the residency-clear option), or record an approval, which ADR-0024 and the registry both assign to feature 016.

**The decision needed, precisely:** _may recipe text be routed to us-east-2/us-west-2 under AWS's
cross-region inference, given that AWS stores prompts and outputs in destination Regions for abuse
detection?_ A **yes** is a `residencyApproval` warrant on the registry entry (date + reference), after which
nothing else changes. A **no** wires `residencyClearance` into `planReservation` and `bedrockInvokeStatements`
in one commit, and the parse leg falls back to a residency-clear model.

Two documentation falsehoods on this path **were** corrected, because they would have let the next reader
believe the control exists:

- the Nova 2 Lite registry entry claimed _"`residencyClearance` therefore answers `unapproved`, which the
  runtime gate and the CDK IAM grant both honour"_. Neither honours it. Corrected in place, with the reason
  and the shape of the change that would close it.
- the sibling assertion in `spendArithmetic.test.ts` carried the same claim in its docstring; it now states
  that it proves what the predicate _answers_, not that anything asks it.

The bot's phrase _"once the invocation-ID and IAM fixes allow the registered Claude profile to run"_ is also
worth flagging back: those fixes shipped in U35, so the gap is live now rather than pending — which is why
the ADR wants the two halves landed together.

> **Draft reply.** Correct on the facts — `residencyClearance` has no caller outside its own tests — but this
> is a recorded open decision rather than a missed check, and the fix you describe would create the specific
> failure the ADR warns about. ADR-0024 §4b: "RESIDENCY IS STILL OPEN, AND IS NOT GATED BY IAM … wiring
> `residencyClearance` into `planReservation` and into this derivation must land as ONE change, or IAM will
> grant what the runtime refuses (or the reverse)." Adding the check in `verifyLine` alone is that split, and
> it is also the wrong layer — residency is already a pure policy, called by both the runtime and the CDK
> derivation by design. It needs an owner ruling because enforcing it today makes the shipped parse model
> uncallable: `amazon.nova-2-lite-v1:0` is profile-only, every profile leaves us-east-1, and it carries no
> approval — so the question is whether to record a `residencyApproval` (016's decision) or fall back to Nova
> Lite v1. Flagged for the owner rather than implemented. Two docstrings that claimed the runtime and the IAM
> grant "both honour" the clearance have been corrected, since that was the actively misleading part.

### 10. `package.json:45` — `@kitchensink/infra-security` as a devDependency

**rejected**, with empirical evidence.

The premise ("deploy workflows prune devDependencies before running CDK entrypoints, so this will be missing
at deploy time") is checkable, and it is false for this repository. Measured in this worktree at
`254a906b`, running the real command the pipeline runs:

```
$ npm prune --omit=dev
$ ls -d node_modules/@kitchensink/infra-security       -> present (workspace link survives)
$ ls packages/infra/security/node_modules/cdk-nag      -> present
$ ls packages/infra/security/dist/index.js             -> present
$ ls node_modules/.bin/tsx                             -> present
$ node -e "import('@kitchensink/infra-security')"      -> loaded; exports AcceptedNagFindings, …
$ npx --no-install tsx -e "import('./packages/services/recipe-workers/infra/lib/RecipeWorkersStack.js')"
  -> stack module loaded post-prune
```

The whole CDK import chain resolves after the prune. The mechanism: `packages/infra/security` is a
**workspace**, so npm links it from the root regardless of how consumers classify it, and `cdk-nag` is a
real `dependencies` entry _of that workspace_ — installed nested at
`packages/infra/security/node_modules/cdk-nag` and marked non-dev in `package-lock.json`, so the prune
retains it as a production dependency of a retained package.

Corroborating: eight workspaces declare `@kitchensink/infra-security` and **all eight** place it in
`devDependencies` (identity, identity-webhooks, recipe-service, recipe-workers, food-service,
ingredient-parser, web, infra-global) — so moving one would break a uniform convention. And both pipelines
that prune (`prod-deploy.yml`, `sandbox-identity-deploy.yml`) have run green with post-prune `cdk deploy`
since infra-security landed on 2026-08-07; the most recent sandbox-identity run at the time of writing shows
"Prune dev dependencies", "Verify runtime dependencies" and three `CDK Deploy` steps all succeeding.

⚠️ **The finding is aimed at a real hazard class**, which is why it is worth answering carefully rather than
dismissing: post-prune steps invoking pruned tooling _is_ a live problem in these workflows — `aws-cdk` was
moved to root `dependencies` for exactly that reason while this triage was in flight, and
`postPruneToolchain.test.ts` now derives which post-prune steps invoke a tool the prune removed. That guard
is the right home for this class. This particular package is not an instance of it.

> **Draft reply.** Checked empirically and this one does not hold for this repo. Running the pipeline's own
> `npm prune --omit=dev` in a clean worktree: the `@kitchensink/infra-security` workspace link survives, its
> nested `cdk-nag` survives (it is a real `dependencies` entry _of that workspace_, marked non-dev in the
> lockfile, so the prune keeps it), and `npx tsx -e "import('.../RecipeWorkersStack.js')"` loads the whole
> chain post-prune. The mechanism is that npm links a workspace from the root regardless of how consumers
> classify it. Corroborating: all eight consumers place it in `devDependencies`, and both pruning pipelines
> have deployed green since it landed on 2026-08-07. The hazard class you are pointing at is real, though —
> post-prune steps invoking pruned tooling — and it is now covered by `postPruneToolchain.test.ts`, which
> derives those cases rather than relying on review.

### 11. `handleSyncWorker.test.ts:138` — superfluous trailing arguments

**fixed** — one CodeQL alert reported twice (`PRRT_kwDOR7sDRs6Zjvr9` from github-advanced-security,
`PRRT_kwDOR7sDRs6fJMAR` from github-code-quality). Both refer to the same call.

The scanner is right on both counts: `handler(event, {} as never, () => {})` passed a `context` and a
`callback` to an implementation that declares neither, and the values were inert placeholders that implied a
context the handler never reads.

`SQSHandler`'s declared arity makes a one-argument call a type error, so the fix is a narrowed alias —
`type TestHandler = (event: SQSEvent) => Promise<SQSBatchResponse>` — which is the shape
`accountErasureWorker.test.ts` already uses for the same reason. If the handler ever does need its context,
that alias is what fails first.

> **Draft reply.** Fixed. The suite drove the handler as `handler(event, {} as never, () => {})`, feeding a
> context and callback to an implementation that declares neither — inert placeholders that also implied a
> context the handler reads. `SQSHandler`'s arity makes a one-arg call a type error, so it now goes through a
> narrowed `TestHandler` alias, the same shape `accountErasureWorker.test.ts` uses. (Note this alert is
> reported on two threads; both are this one call.)

---

## ADR-0024 amendment owed

Findings 5, 6 and 1 all touch text ADR-0024 states as fact. The code and the ADR currently disagree, and the
ADR is the authority — so the amendment is owed before this merges. Proposed, for owner review:

1. **§2, "Two preconditions the counter depends on".** The input-cap bullet should say the bound is in
   **UTF-8 bytes plus chat-template framing**, not code points, and say why: a byte-fallback BPE tokenizer
   emits an unknown code point as up to four tokens, so a code-point count is not an upper bound on tokens.
   Note that the _acceptance_ cap remains in code points, and that the two are different bounds with
   different jobs.
2. **§2, Consequences.** "Reserved spend never exceeds the ceiling" should record that a single rounding of
   the input cap is **not** a bound on the settlement's three independently-rounded classes, and that the
   worst case therefore carries a constant `(classes − 1)` micro-dollar allowance.
3. **§5/§5a.** Add the new failure mode and its detector: the byte bound is a claim about known tokenizers,
   the unclamped settle delta charges any overshoot silently, and `VerificationInputBoundExceeded` +
   `VerificationInputBoundAlarm` are what make it observable. Record that the template allowance is
   provisional and unmeasured, with the measurement recipe.
4. **§4b.** The paragraph beginning "The `foundation-model/*` wildcard's stated justification no longer
   holds" should be closed out: the wildcard is gone, the grant is derived from the registry in full, and
   `VERIFICATION_BEDROCK_MODEL_WILDCARD` is deleted. The residency paragraph **stands unchanged** — that is
   finding 9, and it is still open.

## Residual risk

- `CHAT_TEMPLATE_BASE_TOKENS` / `CHAT_TEMPLATE_TOKENS_PER_TURN` are **unmeasured**. They are conservative
  guesses; the detector metric is the control, not the constants.
- The byte bound is not a theorem. A tokenizer that normalises before encoding (NFKC can expand one
  compatibility character considerably) would beat it. That is what the detector exists to catch.
- The narrowed Bedrock grant is proved by synthesized-template assertions only. No profile-backed model is
  invocable on this account, so — exactly as ADR-0024 §4b already records for the U35 work — **none of this
  has been exercised against a live profile call.**
- Finding 9 is unresolved by design: residency is not enforced anywhere, and the shipped parse model would
  fail the check if it were.
