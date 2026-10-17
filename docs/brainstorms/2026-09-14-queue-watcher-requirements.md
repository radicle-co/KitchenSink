---
title: Queue throughput and integrity — guarantees for every background work queue
date: 2026-09-14
topic: queue-watcher
---

# Queue throughput and integrity — guarantees for every background work queue

## Summary

Every background work queue drains at scale in prod, runs each unit of work once, drops junk before it costs
anything, and never leaves owed work silently stuck. The guarantees live in the producers and consumers, backed
by the rows that already record owed work. A small escalate-only check reports owed work that stops moving to
Sentry and changes nothing itself.

---

## Problem Frame

On pr-91 the recipe parse queue held 837,892 messages from manual k6 runs of `parseJobCreate.load.js` for about
three days. Nothing noticed and it was purged by hand. Every parse job created after the flood waited behind it.

The queue drains one line at a time in every stage: the parse consumer's reserved concurrency of 1 is the only
spend bound in stages without the ADR-0024 ceiling. A large backlog therefore takes days. The consumer also checks
only the line's text fingerprint before calling the CRF engine and Bedrock, so messages for expired or deleted work
still pay for engine calls. Alarms are disabled outside prod.

An inventory of every queue found defects that nobody noticed and no signal would have raised:

- Version archives dispatch at most 100 a day, and a row that always fails blocks the head of the batch.
- Every duplicate verification message pays Bedrock again.
- A handle-sync publish that fails is swallowed, and the consumer silently acknowledges unparseable messages.
- A food refused at intake is left `PENDING` with no queue row.
- A parse line whose message dead-letters stays `pending` until its job expires, and retry cannot reach it.
- The identity deletion DLQ has no alarm, although two code comments say it does.
- Identity's closure and reactivation enqueue lacked send permission on the deployed sandbox, and the failure only
  logged a warning. The permission is fixed on the current branch, and no account has been closed in prod.

The owner's direction is throughput and integrity, not throttling: users and bulk imports are never capped, and the
queue must stay fast, unstuck, free of duplicates and free of junk.

---

## Key Decisions

- **No intake caps.** Restricting users or bulk imports is a bad business decision. A flood of valid work is a
  backlog to drain, and a flood of junk must cost almost nothing.
- **Guarantees live in producers and consumers.** Each queue's consumer decides, from the owning row, whether a
  message is still owed before it does paid work. That makes junk cheap, duplicates harmless and stuck work visible,
  without an automated system that purges or rebuilds queues.
- **The existing rows are the ledger.** Parse lines, the archive outbox, `fetch_queue` and `users.status` already
  record owed work. Handle sync and identity closure or reactivation gain a durable record written with the change
  that makes the work owed. No separate ledger store is added.
- **Keep the existing transports.** SQS stays for recipe and identity work and `fetch_queue` stays for food.
  Research found no product that provides unbounded de-duplication, whole-backlog queries on AWS-managed queues, or
  the ability to tell valid-looking junk from real work, and every replacement added cost or a new vendor.
- **External limits pace the drain; they never refuse users.** Food's queue accepts every request and drains at up
  to 90% of USDA's hourly limit. This replaces food's queue-depth refusal and flood shedding (003 FR-043b and the
  admission service), which the specification must be amended to drop.
- **Only prod scales for now.** Prod's spend is bounded by the ADR-0024 ceiling, so its consumers can run above one
  at a time. Sandbox and previews keep one line at a time, because most current work happens in sandbox and a
  per-stage spend ceiling is deferred.
- **The watcher is a backstop, not an actor.** An adversarial review concluded the automated-remediation design was
  over-built for the one incident observed. What remains is a check that reports owed work that stops moving. It
  holds no permission to purge, receive, rebuild or delete.
- **Slow is not lost.** Work waiting behind a live backlog is reported as delayed. Work counts as lost only when its
  record is owed, it has no receive recorded, and its transport holds nothing.

---

## Requirements

**Throughput**

- R1. In prod, the parse and verification consumers process more than one unit of work at a time, bounded by the
  ADR-0024 spend ceiling and Bedrock's service quotas.
- R2. A consumer's concurrency limit is set so throttled deliveries do not consume retries and dead-letter healthy
  messages.
- R3. In prod, one submitter's bulk import cannot starve other submitters' work of processing.
- R4. Sandbox and previews keep processing parse and verification work one unit at a time.
- R5. No user or bulk import is refused or capped for the amount of work it submits.
- R39. Food accepts every fetch request, with no queue-depth refusal or flood shedding, and demotes heavy
  requesters in priority order only, per FR-043a.
- R40. Food drains its queue at no more than 90% of USDA's hourly call limit, which is 900 calls an hour at
  today's limit of 1,000.

**No stuck work**

- R6. Before any paid or side-effecting work, every consumer confirms from the owning row that the work is still
  owed: not settled, expired, deleted or superseded.
- R7. A message that is no longer owed completes without calling any engine, model or external service.
- R8. Every consumer completes or dead-letters an invalid payload once and never retries it, per GR-018 §18-b.
- R9. Each owed record stores its own attempt count, last receive time and last failure code, and a consumer gives
  up by that count rather than by the SQS receive count.
- R10. Consumer timeouts, visibility timeouts and retention match how long each unit of work takes.
- R11. A dead-letter queue retains messages longer than its source queue.
- R12. A parse line whose delivery is exhausted becomes retryable by its user instead of staying `pending` until its
  job expires.
- R13. Version-archive dispatch keeps pace with version creation, and a row that always fails backs off without
  blocking others.
- R14. A pending version archive is removed only after S3 confirms the archive, per FR-007b-i.
- R15. A food refused at intake is never left `PENDING` without a queue row.
- R16. A food fetch cannot be claimed by a second worker loop while the first is still processing it.
- R17. A standby food worker takes over when the active drainer dies, per FR-022.

**No duplicates**

- R18. A consumer acts only on a still-owed row and marks it settled in the same update, so a unit of work takes
  effect once however many times it is delivered.
- R19. Verification checks for an existing verdict before it reserves spend or calls the model.
- R20. Food's duplicate request keeps raising priority by distinct-requester count, per FR-014.
- R21. Handle sync applies only a newer source timestamp than the one stored.

**No junk**

- R22. Only a queue's own producer role may send to it, asserted by a guard test.
- R23. Producers validate a payload against the consumer's schema before sending.
- R24. Handle sync stops silently acknowledging unparseable messages.

**Durable records of owed work**

- R25. A handle change writes a durable owed-sync record in the same transaction as the profile change, from both the
  identity service and the Clerk webhook.
- R26. A closure or reactivation writes a durable owed-apply record in the same transaction as the status change, and
  the worker records when the change is applied at Clerk.
- R27. Closure and reactivation converge on the latest intended account state, whatever order messages arrive in.
- R28. Settled records are pruned so the ledger does not grow without bound.

**Backstop check**

- R29. A scheduled check reports owed work that has stopped moving on every covered queue, in every stage.
- R30. The check covers parse lines, verifications, version archives, handle sync, food fetches including foods
  `PENDING` with no queue row, and identity closure or reactivation not yet applied.
- R31. The check distinguishes work delayed behind a live backlog from work that is lost, per the Key Decisions.
- R32. The check escalates to Sentry within about one hour, naming the stage, queue and failure code, with numeric
  measures only.
- R33. Escalations never carry message payloads, recipe or ingredient text, or display names.
- R34. The check holds no permission to purge, receive from, rebuild or delete from any queue.
- R35. The check does not run or escalate while its stage is in its scheduled nightly shutdown.
- R36. A Sentry cron monitor alerts when the check stops running in prod or sandbox.
- R37. The identity deletion DLQ alarms in prod.
- R38. The food tombstone escalation fires on `FAILED` tombstones only, per REQ-NF-016.

---

## Per-queue policy

| Queue                             | Owed-work record                   | Still-owed check                            | Duplicate means                                          | Concurrency                             |
| --------------------------------- | ---------------------------------- | ------------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| Parse lines                       | Job and line rows                  | Line pending, job unexpired, digest matches | A stale edit is discarded; an identical line is harmless | Scaled in prod; one at a time elsewhere |
| Verification                      | Line with no verdict               | No verdict for the line                     | The existing verdict stands; no second model call        | Scaled in prod; one at a time elsewhere |
| Version archive                   | Outbox row in the save transaction | Outbox row present and due                  | Once; a re-run is harmless                               | Unchanged                               |
| Handle sync                       | Owed-sync record (R25)             | Record newer than the stored handle         | Latest source timestamp wins                             | Batched                                 |
| Food fetch                        | `fetch_queue` and requester rows   | Row pending or leased                       | Another requester raises priority (FR-014)               | One drainer                             |
| Identity closure and reactivation | Owed-apply record (R26)            | Applied state behind intended state         | Latest intended state wins                               | One at a time                           |

---

## Acceptance Examples

- AE1. A large valid import in prod
    - **Covers:** R1, R3, R5.
    - **Given:** one submitter pastes enough recipes to queue hundreds of thousands of parse lines in prod.
    - **When:** another user submits a single recipe.
    - **Then:** neither is refused, the backlog drains above one line at a time, and the second user's lines are
      processed without waiting for the whole import.
- AE2. A flood of expired work in sandbox
    - **Covers:** R4, R6, R7.
    - **Given:** sandbox's parse queue holds hundreds of thousands of messages whose jobs have expired.
    - **When:** the consumer receives them one at a time.
    - **Then:** each completes without a CRF or Bedrock call, and new parse jobs are processed once the dead messages
      drain.
- AE3. The same line delivered twice
    - **Covers:** R18.
    - **Given:** a parse line is delivered twice.
    - **When:** both deliveries are processed.
    - **Then:** the line's result is stored once and the second delivery pays for no engine call.
- AE4. A duplicate verification
    - **Covers:** R19.
    - **Given:** a verdict already exists for the line.
    - **When:** a duplicate message is consumed.
    - **Then:** no spend is reserved and no model is called.
- AE5. An invalid payload
    - **Covers:** R8, R24.
    - **Given:** a message that fails its consumer's schema.
    - **When:** it is consumed.
    - **Then:** it is completed or dead-lettered once and never redelivered.
- AE6. A send from the wrong role
    - **Covers:** R22.
    - **Given:** a role other than the queue's producer.
    - **When:** it attempts to send to the queue.
    - **Then:** the send is denied, and the guard test fails any change that grants it.
- AE7. A parse line whose delivery is exhausted
    - **Covers:** R9, R12.
    - **Given:** a parse line whose attempts reach the allowance.
    - **When:** the consumer gives up.
    - **Then:** the line becomes retryable by its user.
- AE8. A handle-sync publish fails
    - **Covers:** R25, R29, R30.
    - **Given:** a rename commits but its publish fails.
    - **When:** the owed-sync record passes its deadline unpublished.
    - **Then:** the backstop escalates it within about an hour.
- AE9. A closure applied out of order
    - **Covers:** R26, R27.
    - **Given:** an account is closed then reactivated.
    - **When:** the reactivation is applied at Clerk before the closure message arrives.
    - **Then:** the later closure message does not ban the account, because the intended state is active.
- AE10. A food refused at intake
    - **Covers:** R15, R30.
    - **Given:** food admission refuses a new food.
    - **When:** the request completes.
    - **Then:** no `PENDING` food exists without a queue row.
- AE11. A slow backlog
    - **Covers:** R31.
    - **Given:** owed parse lines wait behind a live sandbox backlog past their deadline.
    - **When:** the backstop runs.
    - **Then:** it reports the backlog as delayed and marks nothing lost.
- AE12. The nightly shutdown
    - **Covers:** R35, R36.
    - **Given:** sandbox is in its scheduled shutdown.
    - **When:** the backstop's schedule reaches that window.
    - **Then:** it does not run, the cron monitor expects no check-in, and nothing escalates.

---

## Success Criteria

- A prod-scale import of valid parse work drains above one line at a time without refusing any submitter.
- Replaying the pr-91 flood of expired work on sandbox drains with no engine calls and no manual purge.
- No unit of work is billed or applied twice, however often it is delivered.
- No invalid payload is retried.
- Owed work that stops moving on any covered queue reaches Sentry within about one hour, and a live backlog is never
  reported as lost.
- The deployed success criteria are proven on a raised preview or sandbox by manual dispatch, not by a green PR.

---

## Scope Boundaries

- Intake caps of any kind, per submitter or per stage.
- Automated remediation: purging, rebuilding, quarantining or deleting queue contents.
- Scaling sandbox or preview consumers above one at a time.
- Erasure messages and their legally required paths.
- Replacing SQS or `fetch_queue` with another transport, engine or vendor.
- Async work that is specified but not built adopts these guarantees when it is built: OCR digitization (011),
  recipe import jobs (004), capture tiers (017), export completion notice (016) and food promotions.

### Deferred for later

- A per-stage spend ceiling for sandbox and previews, which would let non-prod consumers scale.
- Automated remediation by the backstop, if its escalations show a recurring condition worth automating.
- Deferring spend-ceiling refusals to the next period; ADR-0024's transient retry stands.

---

## Dependencies / Assumptions

- ADR-0024's reserve-then-settle ceiling bounds prod spend at any concurrency, so R1 needs no new spend control in
  prod.
- Bedrock's per-account quotas bound prod throughput; the account's current quotas are unverified.
- SQS fair queues reorder delivery by submitter through EITHER of two measures, and the distinction decides
  whether R3 is achievable at the concurrency R1 asks for. Verified against AWS's own documentation
  (`sqs-fair-queues-detailed.html`, read 2026-09-15): a tenant is noisy when its **concurrency share**
  exceeds 10% of in-flight messages **and it has at least 30 of its own messages in flight**, OR when its
  **processing-time share** exceeds 10% of recent consumer processing time — the second measure carries **no
  in-flight minimum**, and AWS states explicitly that "when the number of in-flight messages is too low for
  the concurrency share threshold to trigger, the processing time share measure can still detect noisy
  neighbors". So the ≥30 figure bounds only the FIRST measure. A bulk importer occupying most of a small
  consumer fleet's time is caught by the second at any concurrency, which is what makes R3 reachable without
  a large fleet. `MessageGroupId` is applied automatically on every standard queue that carries it — no
  queue attribute to enable — and on a standard queue it is a tenant label only, never an ordering
  constraint.
- Sentry is wired today only in identity and identity-webhooks; recipe-workers and food-service need a Sentry client
  and DSN for R32.
- The sandbox nightly shutdown stops RDS and the NAT instance, so R35's pause is set by schedule, not detected at
  runtime.
- The backstop reads each service's own database with that service's existing role under ADR-0039.
- PR 91's deletion-queue send permission fix ships before any prod account closure.

---

## Outstanding Questions

### Deferred to Planning

- Prod concurrency for the parse and verification consumers, given the spend ceiling and Bedrock quotas.
- How R3's fairness is achieved: SQS fair queues keyed by submitter, or ordering in the rows.
- Where each service's backstop runs, and whether it rides an existing schedule.
- The numbers: attempt allowances, deadlines, retention margins and escalation thresholds.
- Whether R26's owed-apply record is a column on `users` or a separate record, and how R27 orders intents.
- The erasure disposition of the owed-sync and owed-apply records, and which database holds each.
- Whether the version-archive sweep returns to its one-minute cadence or gains another dispatch path (R13).

---

## Sources

- Queue inventory: parse (`packages/services/recipe-service/src/recipes/parseJobs.service.ts`,
  `packages/services/recipe-workers/src/handlers/parseLine.ts`), archive
  (`packages/services/recipe-workers/src/handlers/archiveSweeper.ts`), verification
  (`packages/services/recipe-workers/src/handlers/verifyLine.ts`), handle sync
  (`packages/services/identity/src/users/handleSync.publisher.ts`,
  `packages/services/recipe-workers/src/handlers/handleSyncWorker.ts`), food
  (`packages/services/food-service/src/foods/dao/fetchQueue.dao.ts`,
  `packages/services/food-service/src/foods/foods.service.ts`), identity deletion
  (`packages/services/identity-webhooks/src/handlers/deletionWorker.ts`,
  `packages/services/identity/src/queue/deletionEnqueue.error.ts`), queue topology
  (`packages/services/recipe-workers/infra/lib/RecipeWorkersStack.ts`,
  `packages/infra/global/lib/platform/DataStack.ts`).
- Specifications: `specs/001-commise-recipe-app/spec.md` FR-007b-i; `specs/003-usda-food-data/spec.md` FR-014,
  FR-022; `specs/003-usda-food-data/v-model/requirements.md` REQ-NF-016; `specs/governance-rules.md` GR-018 §18-b.
- Decisions: ADR-0004 (NAT), ADR-0024 (spend ceiling), ADR-0039 (database roles), ADR-0040 (test principals).
- External research (2026-09-14): SQS semantics, fair queues, PurgeQueue and DLQ retention; Sentry cron monitors;
  Kafka, DynamoDB Streams, Step Functions, Postgres job engines, Inngest, Hookdeck, NATS JetStream and change data
  capture, all rejected as replacements.
- Adversarial review (2026-09-15): advocate and skeptic both concluded the automated-remediation watcher was
  over-built and converged on source fixes plus an escalate-only backstop.
