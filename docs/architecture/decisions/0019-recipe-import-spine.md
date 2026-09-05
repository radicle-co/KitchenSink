# 0019 — The recipe import spine: one bulk processor, source-typed channels, and status-shell placeholders

- **Status:** Accepted
- **Date**: 2026-08-14
- **Drivers**: Owner ruling (2026-08-14). Feature 004 and feature 011 had each specified their own
  photo-import pipeline, feature 011's own prerequisite table already asserted a boundary
  (_"004 = structured/web-URL imports; 011 = unstructured photo imports"_) that 004's `D-001` contradicted by
  committing OCR to ship at launch, and no feature described how a client learns that an import is _in
  progress_. This ADR replaces four independent answers with one spine.
- **Relates to**:
  [ADR-0014](0014-service-owned-api-contracts.md) — the import request/response and every status event are
  wire contracts, so the owning service authors the zod and the schema package is generated, never
  hand-written;
  [ADR-0016](0016-notification-retention-payload-dedup-and-valkey.md) — retention and dedup of the messages
  this ADR emits;
  [ADR-0017](0017-service-ownership-for-features-006-007-009-010.md) — the "no new deployable" default that
  this ADR takes a **named exception** to for 011's image processor;
  [ADR-0011](0011-api-version-prefix.md) — every path below begins `/api/{version}/`.

## Context

Four problems, all consequences of each feature having designed its import path alone:

1. **Two owners for one channel.** 004 `FR-012` + `D-001` specified photo/OCR import at launch on AWS
   Textract. 011 specified a deeper photo-to-recipe pipeline (handwriting, multi-photo batches, per-token
   confidence, a side-by-side correction UI). Both were "accepted". Whichever shipped second would have
   found the other already owning `sourceType`, the draft-confirm flow, and the recipe-creation call.
2. **Four import channels, four flows.** URL, structured file, Instagram and photo each described their own
   path to a created recipe. The parsing differs; **everything after parsing is identical** — validate,
   resolve ingredients to food entities, create recipes, report per-recipe outcome. Four copies of that
   tail is four places for provenance rules, quota enforcement and partial-failure semantics to drift.
3. **No in-flight status anywhere.** A bulk file may carry up to 1,000 recipes (004 `FR-026`) and ingredient
   resolution reaches an external catalogue. Both are slow. Nothing in any spec told a client that work was
   underway, how far it had got, or that it had failed — so every client's only option was to poll a
   terminal result, and a recipe whose ingredients were still resolving was indistinguishable from one whose
   ingredients had failed.
4. **Nothing to hang status on.** A recipe references ingredients by opaque `food_id`. If the referenced
   food is not yet resolved there is no row to carry "resolving", so the recipe could only store a dangling
   id or nothing at all.

## Decision

### 1. One bulk import processor; channels differ only in extraction

Every import channel — URL, structured file, Instagram, and (via 011) photo — terminates in **one** bulk
import processor owned by the recipe service. A channel's only distinct responsibility is producing
candidate recipe records from its source, plus the `sourceType` that records provenance.

```
  ┌ URL adapter ──────────┐
  ┌ file adapter ─────────┤
  ┌ Instagram adapter ────┼──▶ bulk import processor ──▶ recipes + ingredient resolution
  ┌ image branch (011) ───┘         (recipe service)
```

**Consequences.** Provenance classification, quota, per-recipe outcome reporting, draft expiry and
partial-failure semantics are written once. A new channel is an adapter plus a `sourceType` member, not a
new pipeline. The union of `sourceType` is exhaustive, so adding a member is a compile error at every
`switch` that must handle it (Visitor intent, already satisfied by TS — see the
`design-pattern-contracts` skill §3; add no dispatch machinery on top).

### 2. The client chooses a method, then gets a surface built for that method

The apps present an **import-method chooser**. Selecting a method routes to a screen designed for that
input — a URL field, a file picker, a photo capture/batch surface — and that screen calls the bulk import
endpoint with `sourceType` set. There is no single omni-input that guesses the format: guessing is where
a paste-a-URL box silently accepts a file path, and where provenance gets inferred instead of declared.

`sourceType` is **declared by the surface, never inferred from the payload**, and is whitelisted
server-side (004 `FR-025` — provenance is never mass-assigned).

### 3. 011 owns the image branch, behind a stateless service, and hands off to the same processor

004 `D-001` is **superseded**: photo/OCR does not ship with 004. 004 builds the chooser, the URL and file
channels, and the first phase of bulk import. 011 lands after 004 and **adds the image branch**.

The image branch routes to a **dedicated image-processing service that owns no database**. It accepts
images, performs OCR/normalisation, and submits the resulting candidate recipes to the same bulk import
processor as every other channel. It is a **named exception to ADR-0017's "no new deployable" default**,
justified on three grounds ADR-0017 itself uses as its flip conditions: the workload is CPU/GPU-shaped and
bursty rather than request-shaped, it carries a vendor dependency the recipe service should not link, and
it scales on a different axis from recipe CRUD.

> ⚠️ **Note (2026-09-04): this section is now cited as a TEMPLATE by a second ADR, and that ADR is the only
> one of the two whose deployable exists.** [ADR-0025](0025-ingredient-parser-python-deployable.md) takes its
> named exception to ADR-0017 on "§3's three grounds" (CPU-shaped and bursty; a vendor dependency the recipe
> service should not link; scales on a different axis) and adopts §3's consequence literally — the new
> deployable owns **no database**. That reading of §3 is accurate. `packages/services/ingredient-parser`
> ships; the image-processing service this section is actually about does not.

**It holds no persistent state.** Images in flight live in object storage; the durable record of the import
is the recipe service's, exactly as for a URL import. This keeps the "recipe result" in one database and
means the image service can be redeployed or scaled to zero without owning data.

> ⚠️ **011 also specifies Family Circles**, a sharing primitive that is unrelated to image processing and
> **does** require persistence. That half is a separate deployable with its own tables; the "no database"
> rule in this ADR governs the **image-processing service only**. Do not collapse the two.

### 4. Progress is a superseding status message per entity

As an import advances, the owning service emits a status message **per entity** — per recipe, and per food
item — on each transition:

| Stage        | Meaning                                                    |
| ------------ | ---------------------------------------------------------- |
| `queued`     | accepted, not yet started                                  |
| `processing` | in flight, carrying the current stage                      |
| `succeeded`  | terminal, entity is usable                                 |
| `failed`     | terminal, expected failure (unreachable source, no recipe) |
| `errored`    | terminal, unexpected fault                                 |

Messages for one entity **supersede** prior messages for that entity rather than accumulating: a consumer
that receives only the latest message for an entity holds the correct current state. This is what makes the
feed bounded — a 1,000-recipe import produces a bounded live view, not 1,000 × N events to reconcile.
Ordering is **not** assumed; supersession is decided by a monotonic sequence carried in the envelope, not
by arrival order (an at-least-once bus delivers out of order, and last-write-wins on arrival order silently
reverts `succeeded` to `processing` on a redelivery).

Feature 014 owns the service that consumes these messages and pushes them to clients. 004 and 011 own
**emitting** them and the destination's existence; they do not own delivery.

### 5. Placeholders make in-progress state representable in the database

A recipe may reference a food item that is not yet resolved. Rather than storing a dangling id:

- the **recipe** stores a placeholder reference to the food item, and
- the **food database** holds a corresponding **shell entry** carrying that item's current
  processing/sync/import status.

Status is therefore readable from the database at any time, not only by having witnessed the message
stream. A client that connects mid-import renders correct state from a read; the messages make it _live_,
they are not the only source of truth. This is the standing rule that a durable projection and an event
stream must not disagree — the message is a notification _of_ a committed state change, never the state
itself.

> ⛔ **A shell entry is NOT a recipe written into the food database.** The prohibition recorded in
> `CLAUDE.md` — a recipe is a method, not a substance, and is never registered as a food entity — is
> unchanged and absolute. A shell is a **food** in a pending state, created and advanced by the food
> service's own resolution pipeline (the USDA/source path) because a recipe referenced an ingredient it had
> not yet resolved. The food database still has exactly one writer. The recipe→food relationship stays
> one-directional.

## Alternatives considered

- **Let each channel keep its own pipeline.** Rejected: it is the status quo, and it is what produced two
  owners for photo import and four divergent copies of the post-parse tail.
- **004 keeps photo import; 011 is cut to Circles.** Rejected: 011's photo depth (handwriting, batches,
  per-token confidence, correction UX) is a product in its own right and far exceeds 004's single `FR-012`.
  Cutting it discards the differentiator 011 exists for.
- **Put image processing inside the recipe service.** Rejected: couples recipe CRUD availability and
  deploy cadence to a bursty vendor-dependent workload, and forces the recipe service to scale on the
  image axis.
- **Give the image service a database.** Rejected: it would create a second durable record of an import
  whose authoritative record already lives in the recipe service — two places to reconcile, for no gain.
- **Accumulate events instead of superseding.** Rejected: unbounded for a 1,000-recipe import, and it
  pushes reconciliation into every client.
- **Status only in messages, no database placeholder.** Rejected: a client connecting mid-import, or after
  a dropped connection, could not render correct state; and a recipe would hold a dangling food reference.

## Consequences

**Accepted costs.**

- One additional deployable (011's image service) against ADR-0017's default, with its per-stage and
  per-open-PR cost (ADR-0006/0007/0008/0010) and an ALB listener-rule priority from the single allocator in
  `packages/infra/alb` (ADR-0003) — never a per-service constant.
- 004 ships **without** photo import. The chooser must present that honestly rather than offering a method
  that does nothing.
- Every emitting service now owns an outbox/publish path and its failure modes. A status message that is
  never emitted must not strand a client: the database projection (§5) is the fallback, which is precisely
  why §5 is not optional.

**Required by this ADR.**

- The status envelope, its stage vocabulary, and its supersession key are **one contract**, authored once
  and generated into the schema package per ADR-0014. Two services emitting near-identical status shapes
  from hand-written types is the drift GR-015 exists to prevent.
- Consumers parse status messages at the boundary with zod (ADR-0015). A bus payload is untrusted input.
- Ingestion is idempotent: at-least-once delivery means a handler must tolerate redelivery of a message it
  has already applied.

## Amendment (2026-08-16) — §1 and §4 both overreached, and PR 91 built the substrate that shows why

Two decisions above were made before the message substrate existed. Building it (plan U4–U7) established
facts about the storage that make both unimplementable as written. Neither is a change of intent; both are
the same intent expressed against what the substrate actually guarantees.

### §4 is amended: supersession is CONSUMER-SIDE SELECTION, not a monotonic sequence in the envelope

**What §4 says.** "Supersession is decided by a monotonic sequence carried in the envelope, not by arrival
order."

**Why that cannot be built as stated.** A monotonic sequence has to be issued by something, and the only
place to issue it from is the producer. That makes the producer stateful for a value whose entire purpose is
to be read by a consumer that does not exist yet (014), and it makes every producer's write depend on
knowing what it last wrote for that entity — which the substrate's producers deliberately do not, because
they are fire-and-forget (R1.1) and may run concurrently in more than one task.

The sequence was also solving a problem the substrate solves better. Its stated job is to stop an
at-least-once redelivery reverting `succeeded` to `processing`. The substrate stores messages **durably per
group, ordered by sort key** (`<ISO-8601 ms>#<ULID>`), and its stream record is a **doorbell**: a consumer
is woken and then RE-QUERIES the group, which returns in order. A consumer that re-queries never observes a
revert, because it never reads a single message in isolation — so there is nothing for a sequence number to
protect against.

**Amended decision.** The consumer, not the producer, decides which message for a group is current:
**most-recent-by-timestamp wins** (owner ruling, 2026-08-15). The envelope carries no sequence.

**The precondition this depends on, stated so it is checked rather than assumed: SINGLE WRITER PER GROUP.**
Timestamp selection is only correct when one writer is producing a group's messages. Two concurrent writers
for one entity can stamp out of order relative to their real sequence, and most-recent-wins would then pick
the loser. Every producer named in this ADR satisfies this today — a bulk import job owns its entities, and
food's resolution pipeline is the single writer for a food (ADR-0003/`food_id` ownership). **A future
producer that shares a group with another writer must not use this rule**; it needs its own ordering
discipline, and adding one is a decision, not an implementation detail. Feature 011 records this invariant
in its own spec (plan U14).

### §1 is amended: per-domain processors that CONVERGE at recipe creation, not one shared processor

**What §1 says.** Every channel terminates in "**one** bulk import processor owned by the recipe service".

**Why that is the wrong shape.** The diagram's own boxes give it away: the image branch (011) is a separate
deployable by this ADR's §3, and food resolution is owned by the food service, not recipe. "One processor"
therefore describes a component that would have to reach across two service boundaries to do its job — and
§1's stated benefit (provenance, quota, outcome reporting and partial-failure semantics written once) does
not actually require one processor. It requires one place where those rules live, which is the convergence
point, not the pipeline.

Forcing one processor also fights ADR-0017's no-new-deployable default in the opposite direction: it would
pull 011's image work back into recipe-service, which §3 of this same ADR explicitly took an exception to
keep out.

**Amended decision.** Each domain runs its **own** processor — recipe's bulk import, 011's image branch,
food's resolution pipeline — and they **converge at recipe creation**, which remains the single place that
classifies provenance, enforces quota, reports per-recipe outcome and defines partial-failure semantics.
The union of `sourceType` and its exhaustive `switch` are unchanged: they live at the convergence point,
which is where they always effectively were.

**What does NOT change.** A channel is still "an adapter plus a `sourceType` member". Nothing about the
client-facing surface, the status vocabulary, or §5's placeholders is affected.
