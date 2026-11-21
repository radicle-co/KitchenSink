# 0099: A kept timer records where it came from, in version 2 of the kept record

- **Status:** Accepted
- **Date:** 2026-11-21
- **Relates to:** [ADR-0094](0094-kept-cooking-session-record.md) (the kept record, its one-way door and its rule that
  any shape change is a new version). Spec [008](../../../specs/008-cooking-mode/spec.md).
- **Drivers:** the product and design decision that only a timer that a step line offered reads that line's label as
  its name, and it keeps that name after "+ time" and a reload. A timer the cook adds with no name reads "Step {n}".

## Context

A timer row needs a name. The cook may type one. If the cook did not, the row reads either the step's own line (for
example "Roast") or "Step {n}". Which one depends on where the timer came from. The reducer's timer holds no label for
a timer the cook did not name, and the kept record stores no label (ADR-0094 section 2), so a reload lost the one fact
that decides the name.

Three signals were considered and rejected. The starting length fails, because a cook often adds a timer with the
length of the offer. The current length fails, because "+ time" changes it. The absence of a typed name fails, because
it cannot tell an offered timer from an added one.

## Decision

1. The timer carries `origin`, one of `{ kind: 'offer', lineIndex }` and `{ kind: 'added' }`. An offer names the step
   line that offered it by its index in the step, and never by its text. `lineIndex` is `null` when the line is not
   known. `start` sets the origin, and every other command keeps it, as it keeps `recipeId`. The one exception is
   `rematch`: when a timer did not keep its step (the step's digest changed), an offer forgets its line and becomes
   `{ kind: 'offer', lineIndex: null }`, because the old index may now name another line. The reducer (`reduceTimer` in
   cooking-core) is the one owner.
2. The kept record moves to version 2, and `origin` is required on every timer state (`running`, `paused`, `ringing`,
   `endedAway`). It is a strict object, so no line text and no stray key can be stored. A timer with no origin, or with
   a value outside the set, is dropped on its own, as any bad timer is.
3. The name has one source, `timerLabel(timer, step, copy)`: the typed label, else for an offer with a known line the
   label of that line of the matched step, else "Step {n}". An offer whose line is not known, or not in the step, reads
   "Step {n}". It does not fall back to the first label of the step: on a step with two timed lines that would name the
   second timer after the first. The `line` kind leaves the label type, so memory holds typed labels only.
4. There is no migration. The product holds no live data, so a version 1 document fails the version 2 parse and is
   treated as no record and removed, as any unreadable document is.

## Consequences

- An older tab that reads a version 2 record refuses it and removes it (ADR-0094 section 2). That is the reason this is
  a new version and not an optional field in version 1, which ADR-0094 forbids.
- The golden literal of the record and the map of where each field comes from move to version 2, so a field added later
  fails a test until someone decides its source.
- A timer started before this change cannot be read. This costs nothing today, because no screen starts a timer yet.
