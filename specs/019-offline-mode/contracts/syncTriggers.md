# Contract: Sync triggers and the send gate

Owner: `@commise/query` `syncProvider.tsx`. Pattern: Command Processor triggered by an Observer, unchanged.

## The split

`SyncProvider` keeps two facts apart:

- **Open stores**: whose outbox and drafts the app reads and writes. Open in `held` and in `authenticated`.
- **Can send**: whether the drainer is allowed to call the server. True only in `authenticated` with the device online.

A write in `held` resolves on the projection and waits in the outbox, the same as an offline write today.

## Drain triggers

The drainer runs one pass on each of these events:

| Trigger                        | Today | After |
| ------------------------------ | ----- | ----- |
| Mount, once per cook           | yes   | yes   |
| The device goes online         | yes   | yes   |
| The state becomes verified     | no    | yes   |
| A parked `401` reaches its due | no    | yes   |

- **The state becomes verified** is the move from `held` or `loading` into `authenticated`. It closes the lead in
  research R2: a record parked with a `401`, before Clerk was able to mint a token, gets another pass at that moment.
- **A parked `401` reaches its due**: a parked `401` gets one more pass after a bounded backoff while the device is
  online and the state is `authenticated`. After that pass, a record still parked raises the error in FR-018 with a
  retry action.

## Guarantees

- One pass at a time per cook (the existing `drainLaneFor` lane). On web, the lane also holds a Web Lock named for the
  cook, so only one tab drains the shared outbox at a time.
- No pass runs outside `authenticated`. The token proxy (`subjectBoundToken`) refuses a token for any other cook,
  which enforces FR-019.
- A record leaves the outbox only on a server acknowledgement or a cook's discard (FR-015).

## Observability

A Sentry event fires for a record parked with a `401` for longer than SC-004's two minutes while online. It carries the
record's state and the auth state, never its payload.
