# Data Model: Offline Mode (019)

All of this lives on the device. The server's data model does not change. Formats marked as one-way doors cannot
change without a migration of what devices already hold.

## Auth state (shared, `@commise/features-account` `authState.ts`)

The union gains one member:

| State             | Meaning                                                                             |
| ----------------- | ----------------------------------------------------------------------------------- |
| `loading`         | Clerk has not loaded, and the device holds no admissible pointer.                   |
| `held`            | NEW. Clerk has not loaded, and the device holds an admissible pointer for `userId`. |
| `authenticated`   | Clerk loaded and reports this cook.                                                 |
| `unauthenticated` | Clerk loaded and reports no cook.                                                   |
| `blocked`         | Clerk loaded and the session is suspended or impersonated (unchanged).              |
| `error`           | The gate cannot decide (unchanged).                                                 |

**Rules**

- `held` carries `userId` and `signedInAt`. It is reachable only while Clerk has not loaded, on web and on mobile.
- An admissible pointer is one whose age, `now - signedInAt`, is less than the offline admission limit (research R6).
- `held` never produces a token. The send gate (contracts/syncTriggers.md) opens only in `authenticated`.
- `deriveAuthState` stays pure. The pointer reaches it as an input, read by the platform adapter.

**Transitions**

```text
loading ──(admissible pointer)──▶ held
held ──(Clerk loads, same cook)──▶ authenticated      drain once, refetch reads
held ──(Clerk loads, no cook)───▶ unauthenticated    drop read cache, keep outbox
held ──(Clerk loads, other cook)▶ authenticated(other) first cook's data stays unreachable, never sent
held ──(Clerk loads, blocked)───▶ blocked            drop read cache, keep outbox
loading ──(Clerk loads)─────────▶ authenticated | unauthenticated | blocked   (unchanged)
```

## Last signed-in cook pointer — one-way door

- **Key**: `auth.lastSignedInCook.v1` in the app's durable store: AsyncStorage on mobile, IndexedDB on web.
- **Value**: `{ subject: string, signedInAt: string }`, `signedInAt` an ISO 8601 timestamp. Parsed with zod on read. A
  value that fails to parse counts as no pointer.
- **Written** at each move into `authenticated`, and refreshed for as long as the state stays there.
- **Cleared** on a proven sign-out (ADR-0009), and on any Clerk report of `unauthenticated` or `blocked`.
- **Beside the web key.** `deviceSession.heldCook.v1` keeps its job on web, noticing a change of cook, and moves to
  IndexedDB. Its rule that an ended session clears the cook's work at once becomes FR-025's rule, as on mobile.

## Stored query (read cache)

- **Key**: `query.v1.{subject}.{queryHash}`, one entry per persisted query.
- **Value**: the persister's envelope: the query's data, its `dataUpdatedAt`, and the `buster`.
- **Version**: `READ_CACHE_VERSION`, a constant of its own. A mismatch discards the entry. Not a one-way door.
- **Which queries persist**: an allowlist. The library summaries query, and the recipe detail query for recipes the
  budget keeps (below). Nothing else persists.
- **Parsing**: at restore, the schema package's zod (`@kitchensink/schema-recipe`) parses each entry.
  An entry that fails is dropped and fetched again.
- **Wipe**: the adapter removes every key with the cook's prefix. It runs at the end of the in-memory cache scope
  (ADR-0054), at sign-out, and on the transitions above that drop the read cache.

## Recipe budget

- **Pinned**: every recipe the cook wrote. These never leave while the cook is held or signed in, because FR-008 needs
  them to edit offline.
- **Recently opened**: other recipes the cook opened, in least-recently-used order.
- **Limit**: a byte budget for the recently opened set. Build step 2 sets it from the storage limit read from
  `@react-native-async-storage/async-storage` 2.2.0's own source. Over budget, the oldest opened recipe leaves first.
- **Refresh**: on reconnect, the app refreshes only the stored bodies whose summary shows a new `currentVersion`.

## Outbox record (existing, ADR-0057) — one-way door, additive change only

- `IntentKind` gains `removeMember`, which ADR-0057 still owes. Additive: an older reader that meets it quarantines the
  record, which ADR-0057 already handles.
- `RecordState` stays `pending | sending | blocked | parked`. The item marks map from it through `itemStatus`
  (`scopeOf`, `remedyFor`).
- **Save as new**: a refused record can become a `create` of a new recipe in one outbox mutation, like `applyDiscard`.
  It is never a withdraw followed by a submit, because a crash between the two splits them.
- `LOCAL_SCHEMA_VERSION` does not change.

## Device draft (existing, ADR-0057)

Unchanged. It stays per cook, and the device session end clears it.

## Photo cache

expo-image's disk cache holds photos the cook opened. `endDeviceSession` clears it with `Image.clearDiskCache()`.
Licensed images are not cached for offline use, and show their placeholder offline (`016-FR-027e`).
