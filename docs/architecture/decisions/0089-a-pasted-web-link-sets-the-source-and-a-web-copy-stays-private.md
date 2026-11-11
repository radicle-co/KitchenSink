# 0089: A pasted web link sets the recipe's source, and a web copy stays private

- **Status:** Accepted
- **Date:** 2026-11-10
- **Amends:** [ADR-0023](0023-curator-declared-provenance.md) §1a: `POST /api/v1/recipes` now also takes the cook's
  `statement`, and a `PATCH` takes it until the first publish. The curator's `source` and its grant are unchanged.
  [ADR-0072](0072-bulk-recipe-import.md) §9: the statement list and the table of labels. A web statement is private
  only. [ADR-0077](0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md) §3: the linked card is not built,
  so a recipe copied from a web page has one state, private, until the card's read path ships.
- **Relates to:** [ADR-0082](0082-recipes-are-an-open-library-of-facts-cooks-words-and-gated-public-domain.md) §3: a
  recipe aggregator site never gets a public card. [ADR-0058](0058-never-published-drafts-record-no-version.md): the
  first-publish fact that closes the correction window. [ADR-0073](0073-free-tier-private-slots.md): a web copy uses a
  slot, as any private recipe. [ADR-0035](0035-schema-stacks-decoupled-from-service-deploys.md): the migration is
  expand-only. [ADR-0014](0014-service-owned-api-contracts.md): the wire contract. Spec
  [004](../../../specs/004-recipe-importing/spec.md) `004-FR-025`.
- **Drivers:** an owner request to detect that a recipe was copied from a web page, and to publish copied recipes from
  sites such as allrecipes. The decision below meets the first and refuses the second. See "Where this departs from the
  request".

## Context

A cook who copies a recipe from a web page leaves the page's address behind. Nothing in a copied block of text says
where it came from: a text selection carries no address. Our rights label (ADR-0077) needs that fact, and a private
copy of a web page needs it to say what it is.

We never fetch a site, and we never recognise a site by its wording or layout. The only signal we trust is an address
the cook pastes.

## Decision

### 1. The signal is an http(s) link the cook pastes

`sourceLink.ts` in `recipe-core` reads a pasted text. `parseSourceLink` returns the address and the site, or a refusal:
`invalid` (not a public web link) or `ownSite` (a Commise address). The site is the registrable domain from the Public
Suffix List, read by `tldts` (library-first, no hand-kept suffix table). `extractSourceLink` takes a line that is only a
link, with or without a `Source:` label, out of a pasted list of ingredients or steps. A link inside a sentence stays.
One reading serves the editor and the service, so the two cannot disagree.

### 2. A new `statement` field, never the curator's `source`

`statement` is `{ kind: 'public_web', citation: <http(s) address> }`, the same member ADR-0072 §9 already names. It is
authored once, in `recipes.schema.ts`, and the import statement union composes it. The citation must be a usable source:
our own site, `localhost` and a bare IP address are refused by the schema with a `400`.

A create body carrying both `source` and `statement` is a `400`. The service answers it, not the schema. A refinement on
the create body stops the import schema picking from it. The policy input is a union, so "both" cannot be built.

### 3. The statement branch never reads the curator grant

`evaluateProvenance` resolves a statement to `imported_public`, the address, the registrable domain as the attribution,
and the source kind `public_web`. The curator's reading keeps source kind `null`. That is the only thing that tells a
web copy from the curator's public-domain text, which carry the same label. A curator who states a link gets a web copy.

### 4. The source kind is stored beside the label

Migration `0065` adds `recipes.source_kind` (nullable, no default, expand-only, no backfill). A CHECK keeps the
vocabulary closed (`public_web`, `book`, `paid_site`, the import tables' vocabulary, now stated once in `recipe-core`).
A second CHECK says a `public_web` row is `imported_public` and has an address. `null` means no statement. Clone copies
the kind. The account export carries it. The detail and list responses carry `sourceKind`, and leave it out for `null`.

### 5. A web copy is private only

`privateRuleOf(sourceType, sourceKind)` gives `privateOnly` for `imported_public` with kind `public_web`, as for a book
or a paid site. The kind is a required argument, so every caller is a compile error until it states which source it
judges. The server refuses public (`400 INVALID_VISIBILITY`) on create and on set-visibility. The slot rule is unchanged.
A web copy needs a cuisine to publish. Only the curator's reading is exempt. A clone of a web copy lands private.

This fails closed on purpose: the card read path is not built (ADR-0077 §3), and ADR-0082 §3 never gives an aggregator a
card.

### 6. The source can be corrected until the first publish

The editor's draft checkpoints can create the server row before the cook pastes the link. So `PATCH` takes `statement`:
a statement sets the source, `null` removes it, absent leaves it. The rule is one pure policy,
`evaluateSourceCorrection`:

- It is open only while `first_published_at IS NULL` (ADR-0058). The fact is that column, not `status`, so a recipe set
  back to draft stays locked. The row is read from the aggregate that the write's compare-and-swap on `expectedVersion`
  then pins. Every route to a first publish is a `PATCH` that advances the version.
- It is open only for a source the cook stated by link: none, or a web copy. The curator's text, a book and a paid-site
  recipe are never overwritten by a pasted link.
- A statement on a public draft makes it private in the same write. A draft holds no slot, so nothing is counted.
  Clearing the statement never changes visibility.
- Otherwise the answer is `403 FORBIDDEN` with `details.reason: 'SOURCE_LOCKED'`. It is a 403 and not a 409 because an
  installed client reads an unknown 409 as a version conflict (the reason `PRIVATE_SLOTS_FULL` is a 403). It is not a
  new published code. A new code widens a contract both apps consume, for a refusal the editor prevents.

After the first publish the source is frozen (ADR-0023 §1b, ADR-0077 §2, no relabel route). A client knows it is locked
from the existing `firstPublishedAt` field.

### 7. The label states what the cook told us

The owner asked for the source to be set "automatically". It is prefilled from the pasted link, and the cook can remove
it before Publish. Nothing we guess sets it. ADR-0072 §9 says the label is what the cook states. A label we inferred is
not that.

## Where this departs from the request

The owner wanted to publish allrecipes recipes. ADR-0082 §3 keeps recipe aggregator sites private, and ADR-0077 §3
needs a card read path that does not exist. So a recipe with a pasted web link is private, and the cook is told why in
the editor. This ADR does not decide the card. When the read path ships it replaces §5, and the kind is already there.

## Consequences

- **A bulk import's web statement must store the same kind.** The import save path is not built yet. When it is, a
  `public_web` statement stores `source_kind = 'public_web'`, so the rule above holds for it too.
- **Account erasure can still donate an elected private recipe** by flipping it to public, whatever its label. That
  already holds for book and paid-site recipes. It is now also true for a web copy. It is not fixed here. A CHECK on
  visibility makes erasure fail, and the fix belongs in the donation predicate (ADR-0074). It is recorded so nobody
  reads it as covered.
- **Set-visibility reads the source outside its transaction.** A cook racing themselves on two devices (a `PATCH`
  statement and a set-public on the same draft) can leave a web copy public. It can only be an owner-only public DRAFT.
  Publishing refuses it. `evaluatePublishedState` judges the state a write leaves. It reads the visibility under the
  lock. So a published public web copy is never left.
- The correction window is checked with the version compare-and-swap, not a lock. That is enough because
  `first_published_at` moves only inside a `PATCH` that advances the version.
