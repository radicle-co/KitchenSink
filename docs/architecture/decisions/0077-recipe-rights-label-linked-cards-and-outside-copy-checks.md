# 0077: Every recipe carries a derived rights label, a web import goes public only as a linked card, and a recipe headed public is checked against outside sources

- **Status:** Accepted
- **Date:** 2026-10-29
- **Amends:** [ADR-0072](0072-bulk-recipe-import.md) §9, its list of source statements. Two statements are added, and
  a family or friend recipe is no longer labelled like a paid source. Every other part of §9 stands.
  [ADR-0074](0074-content-source-check.md), its rule that the check compares a recipe with nothing outside our own
  database. For a recipe headed public, the check can now compare it with the page it was imported from and search
  the web for its method sentences. Everything else in ADR-0074 stands: only the rules block, a model never clears a
  recipe, and every reviewer is an employee. This ADR also writes down that staff review is a rights check only.
- **Relates to:** spec [016](../../../specs/016-legal-compliance-framework/spec.md) section B2, which holds the rights
  label table and its cook-facing rules. Spec [021](../../../specs/021-public-discovery-and-sharing/spec.md)
  `021-FR-014a` to `FR-014h`, the linked card. Spec [020](../../../specs/020-content-source-check/spec.md)
  `020-FR-012` to `FR-012h`, the outside-copy checks. Spec [004](../../../specs/004-recipe-importing/spec.md)
  `004-FR-014a` and C-001. Spec [001](../../../specs/001-commise-recipe-app/spec.md) C-004 and `001-FR-005`.
  [ADR-0023](0023-curator-declared-provenance.md): who can declare `imported_public`, and its downgrade-only rule,
  which this ADR does not widen. [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md): the one LLM pool. The web
  search is not an LLM call, so it has its own budget. [ADR-0073](0073-free-tier-private-slots.md): private slots.
  [ADR-0045](0045-ingredient-lookup-and-unresolved-foods.md): lines with no food match.
- **Drivers:** owner rulings of 2026-10-29, quoted below. Two research notes by the CLO agent of the same day,
  "Recipe ownership: who owns what, what rivals say, and how to spot copies" and "The linked recipe card". They are
  held outside the repository. Both are research, not legal advice. Every rule here that rests on them is subject
  to counsel review before launch (`016-FR-050`).

## Context

A recipe has two layers. The dish is the ingredient list and the bare steps. In the US nobody owns those (Copyright
Office Circular 33, 37 CFR 202.1(a), _Publications International v. Meredith_). The expression is the words someone
wrote, such as the method, the headnote and the tips, and the photos. Those have an owner.

The research found eight gaps in our specs. Five of them drive this ADR.

- **G1.** A word-for-word copy of a blog recipe goes public in full. C-004 says an `imported_public` recipe is "Always
  public with source attribution". `020-FR-013a` greens a public web citation. `020-FR-012` forbids any comparison with
  the source. So a blog's method and headnote reach every signed-in cook, and nothing compares them with the blog.
- **G2.** `021-FR-040` tells every cook who publishes "The cook keeps ownership". That is false for a clone or a copy.
- **G3.** The check cannot see a copy of a web page, because it is not allowed to look outside our database.
- **G5 and G6.** There are only two statements, "I wrote this" and "From a source". A cook who adapted a recipe must
  claim sole authorship or call it a copy. A family card has no public web page, so `004-FR-014a` labels it
  `imported_paid`, and it can never be public.
- **G8.** Nothing written limits what a staff reviewer judges. Under _Mavrix Photographs v. LiveJournal_ (9th Cir.
  2017), review that selects posts on substance can make a post the host's own, which can cost the DMCA §512(c) safe
  harbour. Screening for infringement does not.

The owner ruled on 2026-10-29. On ownership, verbatim: "we'll need to make sure that we're very, very clear about what
chefs own for public recipes and don't and who owns the recipes they don't to cover the cases where they copy a public
recipe on another site without changes. The automated review process needs to check for this as well. Then we can make
the messaging a little more precise and also make it very clear on if a chef actually owns a recipe. The same goes for
a private recipe that a chef copied from a public source and either a public or private recipe copied verbatim from a
copyrighted or private source." On detection, the owner chose "Allow, public recipes only".

## Decision

### 1. Every recipe shows a rights label, derived and never stored

The label tells the cook who owns the writing and what Commise lets them do with it. There are seven:

| Label                                                    | Who owns the writing and photos                          |
| -------------------------------------------------------- | -------------------------------------------------------- |
| Written by you                                           | The cook                                                 |
| Adapted by you from a credited source, in your own words | The cook owns their words. The source owns its own words |
| Copied from a public web page                            | The page's author                                        |
| From a cookbook, magazine or paid site                   | The publisher, or the author                             |
| From a family member or friend, with their permission    | The person who wrote it                                  |
| Cloned from another Commise cook                         | That cook. The cloner owns only their changes            |
| Public domain                                            | Nobody owns the old text. New photos and notes do        |

- The label is **derived**, by one pure Policy, a sibling of `provenancePolicy.ts`. Its inputs are the source type,
  the statement kind (§2), `cloned_from_id`, a licence the source page states, and the curator grant (ADR-0023 §1).
  Every surface reads that one Policy. No surface works out ownership on its own.
- A recipe imported from a social video is "Copied from a public web page". The creator owns the video and its words.
- Commise takes a licence, never ownership (`016-FR-010`, `FR-031`). The cook keeps copyright in what the cook wrote.
- The label never makes a legal claim we cannot back. It says what the cook told us, and what Commise's own rule is.
  The research names words to avoid: "copyright-free", "legally yours", "safe to publish", "we checked this".
- The full table, with what a cook can do under each label and the draft words for each, is in `016-FR-015c`. That
  spec is the one authority for it.

### 2. The statement kind is its own fact, and there is no fifth source type

ADR-0072 §9's statement list becomes six statements. The table replaces §9's table.

| Statement the cook makes                                                   | `sourceType`        | Label                                  |
| -------------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| I wrote this                                                               | `user_created`      | Written by you                         |
| Adapted in my own words, from [credited source]                            | `user_created`      | Adapted by you, with the credit shown  |
| From a public web page, with its link                                      | `imported_public`   | Copied from a public web page          |
| From a cookbook or magazine, with a citation                               | `imported_physical` | From a cookbook, magazine or paid site |
| From a paid site, with a citation                                          | `imported_paid`     | From a cookbook, magazine or paid site |
| From a family member or friend, with their permission (credit is optional) | decided at PLANNING | From a family member or friend         |

- **§9's visibility column still stands** for each source type. That includes its rule that `imported_public` goes
  private only with Pro and a substantive edit. Whether any cook can keep a web import private is an open question in
  spec 001 (Session 2026-10-29).
- **Why no fifth `sourceType` value.** It is a persisted column and a wire enum that installed clients switch over.
  Adding a value is a one-way door, and the visibility policy already has the right answer for this recipe in an
  existing class. So the statement kind is stored as its own fact, beside the label, and the rights label reads it.
- **The family or friend recipe can go public**, under the same 020 check as any recipe. It is never `imported_paid`.
  It is not open to the web (`021-FR-002`). Which existing source type it takes is a PLANNING decision for
  `staff-architect`. The recommendation is `user_created`, because its visibility rules fit: public by default,
  private within a free cook's slots. If it takes `user_created`, every rule that must treat it apart from "I wrote
  this" reads the derived label, never the source type alone.
- **Adapted stays `user_created`, with a credit.** "Adapted" means the method is rewritten in the cook's own words, not
  trimmed (`016-FR-015b`). A method rewritten by an AI feature is not the cook's own words.
- **No relabel route.** This ADR adds no route that turns an existing web import into "Adapted". ADR-0023 allows only a
  downgrade of provenance after a save, and that stays. A cook who rewrites a saved web recipe makes a new recipe with
  the "Adapted" statement.

### 3. A recipe from someone else's web page is private in full, or public as a linked card

A recipe imported from someone else's web page has exactly two states.

- **Private:** the full recipe, for the cook and their household.
- **Public as a linked card**, for other signed-in cooks. The card holds exactly this: the title, servings, times,
  yield and step count, our own computed nutrition, and the ingredients in our normalized form (quantity, unit and our
  food name). It also holds the cook's own notes and photos, a prominent "Open the full recipe on [site]" link, and
  every add-to action (meal plan, grocery list, cart, and AI features that run on ingredient data).

The rules that make the card safe:

- **Never the source's words or photo.** The card never shows the source's method text, headnote or photo, and never
  a source line word for word. A line with no food match (ADR-0045) shows only the quantity, unit and ingredient name
  the parse read, never the raw line. A line the parse could not read is left out and counted.
- **The cook still sees the full recipe.** The cook, and their household where it is shared, see the full private copy
  whether or not the card is public.
- **A clone of a card copies the card, never the full copy.** A cook who wants the full recipe captures it from the
  site themselves, as their own private copy.
- **One public card per page.** C-001's uniqueness moves from "one shared public recipe per page" to one public card
  per canonical page address. Each cook's private copy is their own.
- **Noindexed and signed-in only.** A signed-out reader still gets 021's source card.
- **A per-site opt-out.** A site on the opt-out list gets a card with only the title, the site's name and the link.
- **The page's own licence wins.** A page that states a licence allowing it, such as some Creative Commons licences,
  can be shown in full, on that licence's terms. Public domain text under the curator grant is shown in full too.
- **The EU database right.** A cap on public cards per site, its number set with counsel, and no feature that lists,
  browses or filters public cards by site. The cap applies to every site, because we cannot reliably tell where a site
  was made.
- **No AI rewrite of the source's method for anyone else.**
- **The owner's fallback**, used only if counsel says so: hide the ingredient list on the card and keep add-to-list,
  with words that say so. The research found that hiding them makes no legal difference, so the default shows them.

### 4. A recipe headed public is compared with outside sources, cheapest first

This is the change to ADR-0074 and to `020-FR-012`. It applies only to a recipe headed public.

1. **Its own import page, for free.** When a recipe comes in from a page, we hold the page for a moment. We keep a
   fingerprint of it (word-shingle hashes over the method and headnote), never the page. A paste fetches nothing, so it has no import page. When the recipe heads public,
   its method, headnote and the cook's notes are scored for containment in that fingerprint.
2. **A web search for its method sentences.** Two or three distinctive method sentences are searched as exact phrases,
   through the Brave Search API, about $0.015 a recipe. Only method text is sent, never a name, an account id or
   anything else about the cook.

- The search runs only where other cooks will read the method: a written, adapted or family recipe, or a clone of one,
  headed public. It does not run for a linked card, which shows no method, or for public domain text.
- What either check finds is **for a person**, never blocking. Only the rule-based detectors block (ADR-0074 §2).
- **The search has its own monthly budget, outside ADR-0024's pool**, with its own counter and its own off switch. It
  is not an LLM call. When the budget is spent or the switch is off, the search part is not read. So the recipe is not
  all green and a person decides, as ADR-0074 §3 already requires for a part that was not read. When the budget's next
  period starts, or the switch is back on, those outcomes are searched again, as the model's are. The shadow-mode
  forecast counts this case.
- **False positives.** Ingredient lists match by nature, so they are left out of the comparison. Short methods are
  generic, so a method below a minimum length does not count. A classic recipe found on many unrelated pages is
  "common", not "copied". A blogger who imports their own posts looks like a copier, so a hit on a page the cook says
  is their own goes to a person, and a way to prove a site is yours is owed by 012.
- **A copy of a private source cannot be detected.** A family card or a book that is not online has no page to find.
  That case rests on the cook's statement and on takedown (`016-FR-016` to `FR-022`).

### 5. Staff review is a rights check only

A staff reviewer decides one question: is this someone else's work, shared without the right to share it? A reviewer
never judges quality, taste, style, accuracy or fit, never edits a recipe, and never features or promotes one. This
keeps review on the screening side of _Mavrix_, which that court called "accessibility-enhancing".

## Consequences

- A cook sees, on every recipe, who owns its writing, in words that claim nothing we cannot back.
- No web page's method, headnote or photo is shown to anyone but the cook who saved it and their household, unless
  the page's own licence allows it or the text is public domain.
- Meal plans, grocery lists, carts and ingredient AI keep working for every cook on a public web recipe.
- A family recipe shared with permission can be public. A recipe a cook adapted can say so.
- Some copies of web pages are now found before they go public, and a person decides each one.
- The web search adds a vendor, a cost per recipe and a privacy notice line (`016-FR-039a`).
- Review stays a rights check, which is written down where reviewers work (`016-FR-053j`).

## One-way doors

- **The statement kind values.** They are stored per recipe and sent to clients. A value that is renamed later needs a
  migration and a client release.
- **The card's field list.** Sites will read it as our promise of what we show. Adding a field later, such as a method
  excerpt, breaks that promise.
- **The fingerprint's version.** A change of shingle size or normalisation makes every stored fingerprint stale. It
  carries a `v1:` prefix, as ADR-0074's digests do.

## Residual risks

- **Typed copies of private sources pass.** Nothing can see a family card or an offline book.
- **The card at scale.** Across many cooks, Commise can show a large share of one EU site's catalogue. That is the
  "cumulative" case of Directive 96/9/EC Art 7(5), and it is ours, not the cook's. The cap answers it only if counsel
  sets it well.
- **Server-side fetching.** A server that returns again and again to a site whose terms it knows fits the pattern of
  _Register.com v. Verio_ (2d Cir. 2004). The cook's own capture (paste, share sheet, browser extension) is safer under
  site terms than repeated server fetches. A URL shared from the share sheet that our server then fetches is still a
  server fetch. Only pasted or shared text, and the page the extension reads in the cook's own browser, are the cook's
  own capture. That is a risk for counsel against `004-FR-008`'s URL fetch and against 017's
  tier 5 source-page lookup (`017-FR-005`). This ADR notes it and changes neither.
- **A stored fingerprint could count as a copy.** Counsel confirms that word-shingle hashes are not a reproduction.
- **Brave's API terms are unread.** Whether we can keep a search result as evidence is unconfirmed.
- **Embedding.** The source's photo is still shown by reference to the saving cook (`016-FR-027a`). _Goldman v.
  Breitbart_ (S.D.N.Y. 2018) rejected the server test, and no First Circuit ruling was found.

## Alternatives

- **A fifth `sourceType` for private sources.** Rejected: a one-way door on the wire, for a recipe the existing
  classes already describe.
- **Keep imports private only (ReciMe's model).** Safest, and it ends public sharing of web recipes, which the owner
  wants to keep.
- **Publish a web import only after the cook rewrites the method.** It adds friction to every share, and an AI rewrite
  would be the easy way round it.
- **Hide the card's ingredients and keep add-to-list.** No different in law, and odd for cooks. Kept as the counsel
  fallback only.
- **Search the web for every recipe, private ones too.** It sends private content to a vendor for no gain, since a
  private copy shows nothing to anyone else.
- **Let an outside hit block.** A blogger importing their own post, or a classic recipe, would be blocked. A person is
  the right judge.
