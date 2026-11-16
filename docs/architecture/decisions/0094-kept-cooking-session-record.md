# 0094: The kept cooking-session record is one versioned document per cook, written by one writer at a time

- **Status:** Accepted
- **Date:** 2026-11-16
- **Relates to:** spec [008](../../../specs/008-cooking-mode/spec.md) (FR-038 to FR-040, leave and come back).
  [ADR-0057](0057-editor-device-draft-and-outbox-format.md) (the device draft and its end with the session) and
  [ADR-0054](0054-session-seam.md) (what ends with a cook's session).
- **Drivers:** a cook who leaves cooking mode must come back to the same step with their marks and their timer, on web
  and phone, and a shared browser must never show one cook's place to the next.

## Context

Cooking mode kept the cook's step and ticks in memory per screen, so leaving lost them. S4a keeps them on the device. The
record is read by several tabs and written by them, it outlives the page, and on a shared browser it must end with the
cook's session. Its format is a one-way door: once a client has written it, tightening it needs a migration.

## Decision

### 1. Where the store lives (KTD0)

The store lives in `@commise/features-recipes`, beside the device session, because both apps mount the recipe subtree and
the end of a session already runs there. It is built from a port (`KeptPort`) and an exclusion (`ExclusiveRunner`) that
each app supplies, so the rules are tested once with fakes and each app adds only a thin adapter.

### 2. The record, v1 (KTD1)

The key is `cook.v2.{clerkUserId}`. The value is `{ v: 1, rev, entries, timers }`, parsed with a strict zod schema
(parse, don't validate). An entry is a union on `kind`: a `page` entry (ingredient ticks, the page's step mark,
servings) is not a session and never reads as one; a `cooking` entry is a session. A timer is a union on `state`, and
each state carries exactly the instants it needs: `running` has `endsAt`; `paused` has `remainingMs` and `pausedAt`;
`ringing` and `endedAway` have `endedAt` alone (the reducer ends a timer at its own end, so a second instant could only
equal it or be wrong), and only `endedAway` may carry `announcedAt`. Every timer, in every state, also carries a
required `ordinal` and `run` (positive integers) and `durationMs` (an integer from `MIN_TIMER_MS` to `MAX_TIMER_MS` in
cooking-core, so a timer the reducer would refuse is never stored). `pausedAt` and `announcedAt` live in the record
alone. The reducer's `name` and its Undo are not stored. A timer has no
label field, so a typed label can never be stored. The record holds ids, positions, digests, servings and instants only.
Every schema is strict and an unparseable document is removed, so any change to the shape, an added optional field
included, is a new version (v2) and never an edit to v1: an older tab or app would delete a record it cannot read.

A document that fails to parse counts as no record and is removed. One bad timer is dropped and reported once, and the
rest of the document stays. A duplicate timer id keeps the first. The schema takes any number of timers, so several
timers need no format change. The one-timer limit and the numbering and step rules belong to cooking-core's `reduceTimer`, not to the record (staff S63). A later format
change bumps `v` and adds a migration.

### 3. The port and the write outcome (KTD2)

A write returns `{ ok: true }` or `{ ok: false, error }`; it never throws. When a write fails, the new document stays in
memory, the failure is reported once, and the next change builds on it only while storage still holds the revision the
failed write started from.

### 4. The clear goes through the store's own writer (KTD3)

Ending a session calls `kept.clear(subject)`, before the early return for a missing subject. The clear bumps a
generation synchronously and removes the key inside the same lock as every write, so a write queued before it is
dropped by the generation check or removed by the clear, and none lands afterwards. Clearing another cook (a switch of
cook) removes that cook's key and does not reset the cook now scoped.

### 5. The subject has three states (KTD4)

`undefined` means auth is loading and removes nothing. `null` means signed out and removes every kept record. A string
is the cook, and every other cook's record is removed once auth has resolved. The scope lives in `RecipeServicesTree`,
which both apps mount, and not in `useDeviceSessionScope`, which is web only. On the phone this is the one thing cleared
when the `userId` goes to `null`: the drafts and the outbox stay, by the owner's ruling of 2026-10-13, because they are
unsent work, and the kept session is the cook's place in a recipe.

### 6. One writer across tabs (KTD5)

Each write runs in one exclusive section named by the key. On web the section is a Web Lock; on the phone it is one
serial queue per name. Inside it, the store re-reads the stored document, applies one command to it with a pure reducer,
and writes once. So a tab with an older revision cannot overwrite another tab's work, and a command for an entry that no
longer exists changes nothing. When the key is absent, storage is empty: memory is never the base, or a record another
tab cleared at sign-out would come back. Where Web Locks are missing, the store keeps the session in memory, writes
nothing and warns once. A re-read, on a `storage` event, a restored page or a tab becoming visible, never writes.

### 7. The alarm across tabs (KTD9a)

Every tab shows the alarm, and one tab that can sound it plays it, under a lock. This is decided here and built in the
timer unit (T3).

### 8. The four conditions of the device record

The plan carries four conditions from its decision record, and each is met above:

1. The record ends with the cook's session, through the store's own writer (section 4).
2. No typed label is stored (section 2).
3. The key is per cook (section 2).
4. One writer at a time, across tabs (section 6).

### 9. The step digest

A saved step is found again by `stepDigest`: FNV-1a 32 over the UTF-8 bytes of the step's text after NFC and
whitespace-collapse normalisation. It is a change detector for a few dozen steps of one recipe, not a security control,
so a published, five-line, synchronous algorithm with reference vectors beats a runtime dependency in a shared library
that runs on Hermes and in browsers.

## Consequences

- A cook who leaves cooking mode returns to the same step, marks and timer, and a shared browser shows the next cook
  nothing of the last.
- The web record lives in `localStorage` so every tab shares it; it is not in the tab's `sessionStorage`.
- A browser without Web Locks keeps a session for the page's life only.
- The store has one writer in each environment, so a second adapter object would be a second writer: each app exports
  exactly one store.

## Risks

- If a tab's first write fails (quota, or private mode), another tab signs out before this one notices, and this tab's
  next write succeeds, then only this tab's own changes since the failed write can come back. The cleared record never
  does. Refusing the held document when storage is empty would make a storage that always fails lose every change but
  the last, so the risk is kept.
- Storage can throw on read, remove or keys (blocked cookies). The store reports it once, treats the record as
  unreadable, keeps the session in memory and writes nothing over what it could not read, so a blocked storage costs
  the session its persistence and never wedges it.
- Two devices keep separate records.

## Alternatives

- **One key per recipe.** Rejected: sign-out, the other-cook sweep and the one timer act on the whole cook, and one
  document keeps that atomic.
- **A server record.** Rejected for now: it adds a one-way door and a privacy surface for a convenience the device can
  give.
- **A hash library for the digest.** Rejected: the one candidate in the lockfile is a transitive development package.
