# 0041 — Queued work is claimed, owned by a row, and watched by something that cannot write

- **Status:** Accepted
- **Date:** 2026-09-16
- **Relates to:** [ADR-0007](0007-sandbox-cost-controls.md) — the nightly stop the backstop must be silent
  inside; [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md) — the reserve-then-settle counter whose
  refusal is transient, not terminal; [ADR-0034](0034-recipe-save-and-version-row-are-atomic.md) — the
  outbox whose rows are one of the owed populations; [ADR-0039](0039-database-role-split.md) — the service
  role the backstop connects as.

## Context

Every queue in this system had the same shape: a producer sent a message, a consumer did the work, and
whether the work actually happened was inferred from the absence of complaints. That shape fails in five
ways that are individually cheap to fix and collectively invisible, and each one had already happened here.

**Paid work before the decision to do it.** The parse consumer ran the CRF engine and the gated Bedrock call,
then decided what to land. A duplicate delivery, a line whose job had expired, and two deliveries arriving
together all paid in full for an answer that was then discarded. SQS standard delivery is at-least-once, so
the duplicate case is not an edge — it is the ordinary one.

**A counter that counts the wrong event.** "How many times has this been tried" was read from SQS's own
receive count. A receive is spent whenever SQS hands the message over, including when the consumer cannot
reach the database at all — so an hour of connectivity trouble exhausted the allowance of every message in
flight without a single attempt at the work.

**A lease with no fencing.** A worker that stalled past its lease had its row reclaimed and re-leased to a
second worker, and then woke up and wrote its result. Both workers believed they held the claim, the later
write won, and nothing recorded that the first one had lost.

**An expired refusal treated as a verdict.** The spend ceiling and an unreadable counter both produced
"could not verify". Recorded as a verdict, that makes a transient condition a permanent fact about an
ingredient — and the wrong direction, because a false disagreement is worse than a delay.

**Nobody reading the rows.** The alarms watched queue depth. A queue can be empty while work is owed: the row
exists, the message that would carry it does not, and depth is zero. Every guarantee above lives inside a
producer or a consumer, so every one of them fails silently when it fails.

## Decision

### Claim before paid work, in one statement

A consumer asserts everything that makes the work worth doing in a single statement, before the first
expensive call: that the unit is unexpired, that the stored digest still matches, that the unit is still
claimable, and that no other worker holds the lease. **Zero rows returned is the refusal**, and the message
completes having invoked nothing. The statement's row lock serialises concurrent deliveries, so the
guarantee does not depend on the consumer's concurrency setting.

### The attempt belongs to the row, not to the transport

Attempts are counted by the claim, in a column the work owns. A receive that never reached the database is
not an attempt, because nothing was attempted. The two counters are sized independently and mean different
things: the transport's `maxReceiveCount` bounds redelivery and is sized to outlast ADR-0007's nightly stop,
while the claim allowance bounds real work.

### The lease is fenced by a value, not by a timestamp comparison

A claim returns the exact instant it was granted, and every settle carries that value back and is conditional
on it still being current. A worker whose lease was reclaimed writes nothing and learns that it lost; a
worker that still holds it writes normally. The fence is carried as text rather than as a parsed timestamp,
because the stored precision is finer than the client's — a round-tripped value silently matches no row,
which turns the fence into a permanent refusal rather than a guarantee.

Settling without a fence is possible, and the ways to do it are named in a register rather than reached for.
A settle that has no claim behind it is a real case — a correction arriving out of band, a terminal tombstone
— and the register makes each one a decision somebody made rather than a convenience somebody took.

### Slow is not lost

A backlog behind a moving queue is late. The same backlog behind an empty queue is stranded, and only the
second is worth waking somebody for. The two are indistinguishable from the rows alone, so anything that
judges owed work reads the transport as well, and reports:

- **dead-lettered** before anything else, because work on a DLQ is already out of the system's hands and its
  rows still look merely owed;
- **exhausted** when the consumer gave up by its own rule, regardless of what the transport is doing;
- **stuck** when a claim has outlived any plausible run — something did pick this up, and calling it lost
  sends an operator hunting a producer bug that is not there;
- **lost** only when work is owed, nothing has ever received it, and the transport is carrying nothing;
- **delayed** otherwise.

Each earlier condition would be misread as a later one, which is why the order is part of the rule.

### Pacing, not refusal

A source that must not be overrun is paced: the work waits and then proceeds. It is not refused at intake and
it is not dropped. A refusal has to be re-driven by something, and the thing that would re-drive it is the
part most likely to be missing when the pressure arrives.

For the same reason a transient inability to reach a verdict — a spend ceiling denial, an unreadable counter,
a provider timeout — leaves the work owed and retries under the transport's own allowance. Only a completed
judgement is recorded as one.

### The backstop reads, and cannot write

Each service runs a check that reads its owed rows and its queue depths together, classifies by the rule
above, and reports. It is constrained three ways, and each constraint answers a way the check itself could
become the outage:

- **It runs inside a read-only transaction.** A backstop that can write can make the thing it is watching
  worse, and that is the one failure it must never cause. The database refuses the write, so the property
  belongs to the database rather than to whoever next edits the check.
- **Its role may read queue attributes and nothing else.** A backstop that could receive would take a message
  from the consumer it is watching; one that could delete or purge could destroy the evidence it exists to
  report.
- **It escalates, it never repairs.** Every guarantee here lives in a producer or a consumer. A backstop that
  repairs is a second writer nobody designed for, and the first thing it does under load is contend with the
  consumer for the same rows.

It is silent inside ADR-0007's nightly stop, before any database call: owed work during a deliberate shutdown
is the shutdown working, and a signal that fires nightly for a reason nobody can act on is a signal its
reader mutes.

### The escalation carries counts and closed vocabularies, and has nowhere to put text

What a backstop reads is user content — recipe lines, ingredient phrases, display names, food names. A
Sentry event sits outside every erasure path in this system, so the escalation type holds identifiers,
enum members and numbers, with no open map and no free-text field. Adding one is a change to the type,
which a reviewer sees, rather than a key added to a bag, which nobody does.

### Silence is the alert

The backstop's own death looks exactly like a healthy stage: it finds nothing and says nothing. So each check
promises a cron check-in on a schedule, and a missed one raises the issue. The promise is made only where it
can be kept — an ephemeral per-PR stage is torn down while its monitor is not, so a preview escalates what it
finds and promises nothing. The check-in is issued after the work and regardless of the findings: "the
backstop is dead" and "the backstop found something" are unrelated failures, and the escalations already
carry the second.

## Consequences

A consumer's first database round trip is now a claim rather than a read, which costs one statement and
removes every engine call that a refused message used to make.

Two numbers that used to be one — the transport's redelivery bound and the work's attempt allowance — are
configured separately and can drift apart. They are passed from the stack that owns the resource each
describes, so neither has a second definition a handler could default to.

Owed work is observable without reading the code: the same five counts describe every class, so a new class
is a statement and a name rather than a new alarm.

A backstop is a new deployable with its own role and its own VPC attachment on every service that has one,
which is a cost the consumer list in ADR-0004 carries.

The check reports a class that has no transport with an explicit statement that it has none, rather than with
three zeros — three zeros classify as "nothing is carrying this", which is true for a class whose runner is
in-process and false for one whose depth is merely unreadable.

A backstop that keeps finding the same stuck work keeps saying so. The escalation is fingerprinted by what it
found rather than by where it was raised, so repeated runs group into one issue that accumulates rather than
into an issue per run — but a genuinely stuck queue stays open until somebody acts on it, which is the
intent.
