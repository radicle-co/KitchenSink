# 0096: An ingredient tick belongs to its recipe line

- **Status:** Accepted
- **Date:** 2026-11-19
- **Relates to:** [ADR-0094](0094-kept-cooking-session-record.md) (sections 2 and 9: the kept record and its ticks) and
  [ADR-0058](0058-never-published-drafts-record-no-version.md) (a draft is saved in place, so a version does not name
  a line). Owner rulings P57 and P58, and issue #155.
- **Drivers:** a cook who ticks one of two identical lines, for example two butter lines, must see only that line
  ticked. When the servings change, when a line is added above it, or when the page reloads, the tick must stay with its line.

## Context

Ticks were keyed by the ingredient binding id. Two lines bound to one food shared one tick, so ticking the first butter
line ticked the second (#155). The server has a per-line id, but it is not on the wire, by design. A stored position is
not stable across edits. A version does not help either, because a never-published draft is saved in place.

## Decision

1. **A tick is a line key.** The key is `l<version>:<8 hex>#<ordinal>`. The hex is FNV-1a 32 over the JSON of the
   line's cook-authored, unscaled fields: `ingredientId`, the quantity (exact, range or absent), `unit`, `displayText`,
   `note`, `preparation` and `groupLabel`. Absent fields count as `null`. Each text field is NFC-normalized, with
   whitespace collapsed and trimmed. The ordinal counts the lines that share a digest, in stored order.
2. **Derived fields stay out of the digest.** `name`, `foodId`, `variant`, `hasVariants`, `foodVisibility`,
   `unresolvedReason`, `resolutionStatus`, `boundBy`, `isUserEntered` and `sourceLine` are worked out at read time. A
   change in them must not clear a cook's ticks.
3. **Keys come from the stored, unscaled lines, in one place.** `useCookMarks(recipeId, lines)` is the only code that
   turns a position into a key and back. Render components and cooking mode see positions. The store sees keys. A
   position that no line has does nothing and writes nothing.
4. **Nothing reconciles or moves a tick.** Servings, a reorder, an insert and an unchanged version keep ticks. An edit
   to a covered field drops that line's tick.
5. **The kept record stays version 1.** Its `ticks` accept the same JSON as before. The parse keeps a key of any
   version (`/^l\d+:[0-9a-f]{8}#\d+$/`) and drops other strings one by one, so an old ingredient id reads as no tick.
   The writer builds `l1` keys only.
6. **The cook-marks prefix stays `cook.v1.`.** The kept record owns `cook.v2.`, and a test pins that neither prefix
   matches the other.

## Consequences

- Identical lines are told apart by their order. Ticking one never ticks the other.
- A rebind (the cook picks a different food for a line) drops that line's tick (P58), because `ingredientId` is in
  the digest.
- Renaming a food that the cook declared keeps the tick. The food id, amount and unit are the same, so the cook
  measured the same thing and only the label changed.
- A stale key (its line was edited) stays in storage. It is never shown, and the Clear checks command counts only
  ticks the cook can see.
- Rolling back the code is safe. The old code reads the new keys as ids, matches none, and shows the ticks as lost.
  Nothing crashes and nothing needs cleanup.

## Risks

- A tick on a line whose unresolved food is resolved in the background drops, and the cook ticks it again. The server
  moves lines off a shared unresolved failure onto the bound food with no action from the cook, and that changes
  `ingredientId` (owner ruling, option a).
- If the server re-keys its lookup rows, every tick drops. This is a known limit of keeping the key off the wire.
- Two different lines can collide on the 32-bit digest. The ordinal still keeps their keys apart. The worst case is a
  tick that swaps between them after a reorder. At a few dozen lines, the chance is about 3 in 10 million for each
  recipe.

## One-way door

The key format is stored on the device, in the cook marks and in the kept record. A later format bumps the prefix
(`l2`). When an older client writes, newer keys stay untouched. The older client reads them as ticks no line has.
So the door is cheap, and it is decided once here.

## Alternatives rejected

- **Position plus digest with a strict reconcile.** It drops identical lines, and cooking mode and the page disagree
  after a refetch.
- **Version plus position.** A draft is edited in place, so a version does not name a line.
- **The binding id.** This is the bug (#155).
- **The server's per-line id.** It is not on the wire, and adding it is a contract change for a device-only concern.
- **A version 2 kept record.** It accepts the same JSON, and nothing was written in the old form that needs it.
