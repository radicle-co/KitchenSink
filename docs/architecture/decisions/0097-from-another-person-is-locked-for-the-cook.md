# 0097: "From another person" is locked for the cook on every route

- **Status:** Accepted
- **Date:** 2026-11-20
- **Supersedes:** one bullet of [ADR-0095](0095-a-recorded-source-is-kept-and-a-recipe-is-public-only-with-a-statement.md) §4.
  The bullet "It is sticky" said the recipe stays out of Public "until the cook makes an explicit statement that replaces
  it". No cook statement replaces it now.
- **Amends:** [ADR-0023](0023-curator-declared-provenance.md) §1b. A stored "From another person" is not a source of the
  downgrade to a book or a paid site. The rule "the current label must be `user_created` or `imported_public`" does not
  reach a recipe that stores it.
- **Relates to:** [ADR-0089](0089-a-pasted-web-link-sets-the-source-and-a-web-copy-stays-private.md), the one lock rule
  `sourceIsCorrectable`.

## Context

A cook who said "From another person" could say "I wrote this" in a later write, or clear the statement, and the recipe
could then go Public as the cook's own. Owner ruling 2026-11-19: once a recipe stores "From another person", no cook
write changes or clears it.

## Decision

- **A stored "From another person" is locked.** The shared rule `sourceIsCorrectable` returns false for it, and for an
  unrecognised statement kind. The server policy and the editor both read that one rule. The editor save, a publish
  request and the "Make public" sheet all answer `403 SOURCE_LOCKED` to any other statement or to a clear.
- **Saying it again is not a change.** "From another person" over itself is accepted and writes nothing.
- **A recipe with no stored statement and a past "From another person" attestation is locked the same way.** The
  server reads the attestation inside the write's own transaction, and only when a statement is sent and none is
  stored. Only "From another person" passes, as a first statement.
- **A clone holds the answer its source held**, so the clone is locked too.
- **The editor shows the answer, not a field.** The Source row reads "From another person" with the reason, and has no
  input and no Remove control. A pasted link is left out.
- The SQL rule `recipe_is_from_person` is unchanged, so Public stays refused and erasure never donates it.

## Consequences

- A cook who chose "From another person" by mistake cannot undo it. The route to change it is a staff action, which is
  outside this decision.
- Every other confirmed answer follows the same lock when it is added.
- A queued write from a stale device that sends a refused statement meets `403 SOURCE_LOCKED`. The write parks with its
  other edits, and the drain does not send it again by itself.
