# 0093: An imported recipe goes public only as a Commise-written version, and there are no facts cards

- **Status:** Accepted
- **Date:** 2026-11-15
- **Amends:** [ADR-0077](0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md) §3: the linked card is
  retired. [ADR-0082](0082-recipes-are-an-open-library-of-facts-cooks-words-and-gated-public-domain.md) §2, §3, §5's
  licence for Commise's own text, §6 and §7: facts cards are retired, the Commise version is the public form of an
  import, and the import never fetches a page. [ADR-0072](0072-bulk-recipe-import.md) §8 and §9: one import allowance,
  and the Private, Public or Both choice. [ADR-0073](0073-free-tier-private-slots.md): "can never go public" now means
  the cook's private copy. [ADR-0089](0089-a-pasted-web-link-sets-the-source-and-a-web-copy-stays-private.md) §5: a web
  copy stays private until the Commise-written version ships.
- **Relates to:** spec [004](../../../specs/004-recipe-importing/spec.md), the one import pipeline. Spec
  [016](../../../specs/016-legal-compliance-framework/spec.md): age, source evidence and attestation, notice and
  takedown, publisher opt-outs and licences. Spec [020](../../../specs/020-content-source-check/spec.md): the reviewer
  check and the public hold. Spec [017](../../../specs/017-recime-parity/spec.md): households. Spec
  [010](../../../specs/010-subscriptions/spec.md): the import dead end. Spec 003B (public versions of imported recipes,
  planned) builds the Commise-written version. Spec 027 (Flow Steps, planned) is a separate, cook-requested rewrite of
  a cook's own steps.
- **Drivers:** owner rulings, 2026-11-15.

## Context

Before this decision, an imported recipe had three ways to reach other cooks: as the cook's own "Adapted" version, as a linked
card (ADR-0077 §3), or as a facts card (ADR-0082 §2). Neither card was built. The owner replaced both cards with one
public form that Commise writes, and settled what the cook keeps privately.

## Decision

### 1. The cook's private copy keeps the source's wording

- A cook's private copy of an imported recipe keeps the source's wording, with food matching (ADR-0071).
- The private copy shows the source author's name.
- A recipe a cook makes in the single-recipe editor is never rewritten automatically.

### 2. The import offers Private, Public or Both

- At import the cook chooses Private, Public (a Commise-written version) or Both.
- If the rewrite cannot run, only Private is offered.
- Every import goes through one pipeline, with source detection first (spec 004).

### 3. Which imports are rewritten

The import rewrites the instructions of every public-facing recipe in two cases. The first case is a source that is
not on the copy-outright allowlist. The second case is a recipe that the reviewer check (spec 020) flags. The
allowlist has four entries:

- The cook's own verified site (ADR-0078).
- A page whose structured data states an open licence.
- A public-domain work (`016-FR-015k`).
- A US government work.

A recipe from an allowlisted source can be shown as it is, on its own terms. It still passes spec 020's hold.

### 4. Every public Commise-written version

- The writer sees the recipe's facts only, never the source's wording.
- A similarity check against the source runs on every save. A two-way check makes sure that the facts and the safety
  information match the source in both directions.
- The cook confirms the version before it publishes.
- "Report a problem" hides the version until staff look at it.
- It never uses the source's photos. Its title describes the dish.
- It says plainly that AI wrote it, for example "Steps written by Commise with AI, checked by {cook}". The final
  wording is to be confirmed.
- Its text carries CC BY-SA 4.0, credited "Commise and contributors". This replaces CC0 for text Commise writes.
- A version from a free site names and links the site's domain, with "Not affiliated."
- Commise keeps an internal source record for it. The record is append-only and never shown.

### 5. Paid sites

- A site is paid in three cases. Its page says `isAccessibleForFree=false`. Its domain is on the paid list. It has a
  metered paywall.
- A paid-site recipe goes public only as a page Commise writes in full, which names no site.
- Where the dish exists in free or independent sources, the public page prefers a consensus recipe drawn from them.
- A paid site's signature recipe is never published from that one source.
- Publisher opt-outs are honoured (`016`).
- Paid content is held back for 6 months before any public version.
- Per-publisher caps count only distinctive recipes.
- The cook's private copy keeps the site's wording. It has no export of that wording, and households never see it.

### 6. No facts cards

There are no facts cards anywhere. The linked card of ADR-0077 §3 is retired with them. No surface shows a public
projection of an import's facts beside a link to the source.

### 7. Households

A household sees a member's private recipes read-only (spec 017). The exception is a paid site's own wording. For
it, the household sees the Commise-written version. If no such version exists, the household sees nothing.

### 8. What is open

These were not ruled and are owner questions. No document answers them until the owner does:

- Does a recipe whose public version is Commise-written use a private slot for the cook's private copy? (ADR-0073,
  `016-FR-029a`.)
- What replaces the server-side fetch of a link import, now that the import never fetches a page? (Spec 004.)
- How does "the cook's statement stays editable" (spec 016) meet ADR-0089 §6, which locks the source after the first
  publish?
- How does "no export" of a paid site's wording meet a cook's export of their own data? (Spec 016, spec 017.)
- Can user-recipe aggregator sites, which ADR-0082 §3 kept private, get a Commise-written public version?

## Consequences

- Every public page from an import is Commise's own text or an allowlisted source. A cook never publishes another
  site's wording.
- A cook keeps a full private copy of any import, with the author's name.
- The Commise-written version is new work (spec 003B). Until it ships, a web copy stays private (ADR-0089 §5), and the
  import offers Private only.
- The RecipeFacts canvas boards no longer match a product rule. They change only by PR and publish, and are owed to the
  designer.
- Spec 027 (Flow Steps) is the only other rewrite, and only when the cook asks for it.

## Alternatives

- **The linked card and the facts card.** Retired by the owner. They are replaced by one public form that Commise
  writes.
- **Publish only the cook's own adaptation.** Kept: a cook can still publish an "Adapted by you" recipe in their own
  words (ADR-0077 §2). It is no longer the only public form of an import.
