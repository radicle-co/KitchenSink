# 0082: Recipes are an open library of facts, cooks' words and gated public domain

- **Status:** Accepted
- **Date:** 2026-11-03
- **Amends:** [ADR-0077](0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md) §2 and §3. A family recipe
  and gated public-domain text are open to the web. The linked card is readable signed out. Book and paid-site recipes
  get a facts card. The ban on an AI rewrite becomes a launch decision with a pilot gate (§6 below). Its §4 "never
  blocking" wording means "never rejected automatically". Every other part of ADR-0077 stands.
  [ADR-0072](0072-bulk-recipe-import.md) §9 and its Related work: a recipe whose source is not a public web page can be
  public as the cook's own "Adapted" version or as a facts card, and the server looks for a STATED licence, never for
  "no copyright". [ADR-0073](0073-free-tier-private-slots.md): a public facts card is a public recipe and uses no slot.
  [ADR-0074](0074-content-source-check.md): the hold covers every door to public, and fails closed (§8 below).
  [ADR-0023](0023-curator-declared-provenance.md) §1: the curator grant carries a public-domain record.
  [ADR-0052](0052-food-data-sources.md): its citation of `016-FR-033` now reads the amended FR-033. The food catalog
  rule does not change.
- **Relates to:** spec [016](../../../specs/016-legal-compliance-framework/spec.md) `FR-010`, `FR-012`, `FR-015c` to
  `FR-015k`, `FR-016` to `FR-066`, `FR-024a`, `FR-027f`, `FR-030`, `FR-030a`, `FR-033` and `FR-050`. Spec
  [021](../../../specs/021-public-discovery-and-sharing/spec.md) `FR-002` to `FR-006`, `FR-014` to `FR-014h` and
  `FR-040` to `FR-042`. Spec [020](../../../specs/020-content-source-check/spec.md) section K. Spec
  [004](../../../specs/004-recipe-importing/spec.md) `FR-008`, `FR-014a`, `FR-014b`, `FR-023` and `FR-026`. Spec
  [025](../../../specs/025-international-launch/spec.md). GR-014.
- **Drivers:** owner rulings of 2026-11-03. The founder's goal: recipes are a public resource, and Commise is a free,
  open, worldwide recipe library, except private recipes. Every dish is fully readable by anyone, signed in or not,
  with nothing hidden. A legal analysis of the same day, held outside the repository, tested every earlier rule. It is
  analysis, not legal advice. Every rule here is subject to counsel review before launch (`016-FR-050`).

## Context

Earlier rules hid more than the law requires. A signed-out visitor saw only a source card with no ingredients. A
family recipe and public-domain text were "never open". A recipe from a book was never public in any form.
Several of those rules were written as law. They were product choices.

[Law] Nobody owns a recipe's facts: the dish, ingredients, amounts, times, temperatures, yield and the order of steps
(17 U.S.C. §102(b), _Feist v. Rural_, 499 U.S. 340 (1991), Copyright Office Circular 33, _Publications International
v. Meredith_, 88 F.3d 473 (7th Cir. 1996)). The words people write about a recipe, and their photos and video, are
protected. Forty copies of a blog post online are forty infringements, not forty owners.

[Law] The EU and UK database right protects the contents of a site's collection, even as bare facts (Directive 96/9/EC
Art. 7(5), UK SI 1997/3032, _CV-Online Latvia v Melons_, C-762/19). Rewording does not cure it.

The earlier public-domain test ("the author died more than 70 years ago") fails for US works published after 1930,
for Spain's life plus 80, for Germany's treatment of US works, for French authors "mort pour la France", for
translations and for books with no named author.

## Decision

### 1. The library is open to the web where the words are ours, the cook's, or nobody's

A recipe is open to the web in full when its rights label (`016-FR-015c`) is Written by you, Adapted by you, From a
family member or friend (with permission that covers the web), or Public domain passing `016-FR-015k`, or it is a
clone of one of those. Open to the web reads the LABEL, never the source type alone, because public-domain text is
`imported_public` under the curator grant. Every such recipe passes 020's check and carries the cook's licence
(`016-FR-010`). The full rule is `021-FR-002`.

### 2. The facts of every public recipe are readable signed out

- **The linked card is a signed-out public projection** (`021-FR-014`, `021-FR-014a`). Its field list does not grow:
  title, servings, times, yield, step count, our nutrition, the ingredients in our normalized form, the owner's own
  notes and photos, and the source link. It never shows the source's method, headnote, photo, ratings or any line
  word for word.
- **Book and paid-site recipes get a facts card** (`004-FR-014b`, `021-FR-004`): the same field list, with a credit to
  the book (title, author, publisher) or the site, a per-source cap, and never in the book's order. Our servers never
  fetch paid sites. The cook's full copy stays private.
- **[House rule] Facts cards stay `noindex`**, with no recipe structured data. This is for search quality, goodwill
  toward source sites, and lower database-right exposure. It is not a legal bar, and the founder can change it.
- **A public facts card is a public recipe.** It uses no private slot (ADR-0073). The cook's full copy behind it is
  visible only to the cook and their household. This matches ADR-0077 §3 for web imports, and `016-FR-029a` forbids
  pricing on imported content in any case. A free cook can therefore import a whole cookbook, publish each recipe as a
  card and keep every full copy without a slot, so ADR-0073's "bulk import pauses" no longer happens for book
  recipes. Owner ruling 2026-11-03: "No, it is free." This follows `016-FR-029a`.

### 3. Caps are counted over time, per site and per source

[Law, EU and UK] A per-site cap on public facts cards answers Art. 7(5)'s repeated and systematic taking. [Law, US]
Copying one site's or one book's selection wholesale engages compilation copyright (17 U.S.C. §103). [House rule]
Goodwill. So:

- the cap is counted over time, across every public card and any later Commise version together, never per import.
- user-recipe aggregator sites and edited publishers' collections get the tightest cap, or no public cards
  (_British Horseracing Board_, C-203/02).
- book and paid-site cards have a per-source cap, and bulk import has a per-source public cap (`004-FR-026`).
- no surface lists, browses or filters public cards by site or by book.
- a site or book past its cap shows only the title, its name and the link.

The numbers are set with counsel (`016-FR-030a`).

### 4. Public domain opens under one rolling global gate

The rule lives once, in `016-FR-015k`. A text opens only when all six tests pass: first published in or before the
current year minus 96, every author, translator and illustrator died in or before the current year minus 81, no author
is recorded as "mort pour la France", a book with no named person needs the publication test only, the text is the
old edition without modern notes, and the curator has recorded the facts. This REPLACES the earlier owner ruling that
used the 70-year test. One global rule is stricter than US law needs, because the open web cannot be gated by market.

The curator grant (ADR-0023 §1) carries the public-domain record: first publication year and place, each creator with
their role (author, translator, illustrator) and death year or "no named author", a "mort pour la France" flag per
creator, the edition used, the markets checked, who checked and when, and the rule version it was judged under. No
`sourceType` value is added (ADR-0077 §2's one-way-door reason holds). A record that fails later closes the page
(`020` section K).

### 5. The statement kinds and the licence choice are stored facts

- **Statement kinds:** `authored`, `adapted`, `source` (with its citation and source kind), `family` (with the giver's
  permission to share on Commise and the web, giver credit optional) and `publicDomain` (curator grant only, with the
  §4 record). The shipped import table holds only the first and third. The new values widen it, expand first.
- **Licence choice:** each recipe stores a licence (`commise` by default, or `cc-by-4.0`) and the licence version, and
  a separate photo licence. The recipe's read contract sends them to clients, and public pages carry schema.org
  `license`.
- **CC BY 4.0 is opt-in, per recipe, only on a "Written by you" recipe that passed 020's check.** The cook is the
  licensor. Adults only. The words say "irrevocable as far as the law allows" ([Law] French moral right of withdrawal,
  CPI L121-4, a free licence can be revocable in England, 17 U.S.C. §203).
- **CC0 1.0 on text Commise itself writes.** Never CC0 on collected facts as a class, because facts taken from another
  site's EU or UK database are not ours to waive.
- **The Public Domain Mark** on public-domain text.
- The app, code, ranking, ingredient matching, the food catalog (ADR-0052), user data, the brand and 018's paid
  content stay proprietary. `016-FR-030`'s anti-extraction terms carve out what a CC licence allows.

### 6. The Commise version is not built at launch

An AI rewrite of another site's recipe, published as Commise's own, is not built at launch. [Law] Commise is then the
publisher, outside the §512(c) safe harbor and outside DSA Art. 6. _Thomson Reuters v. Ross_ (3d Cir., 29 Sep 2026)
weighs a commercial substitute against fair use. The database right applies to rewritten text. At launch, the facts
card and the cook's own "Adapted by you" version carry the search value.

A later pilot needs all of these first:

1. US users only, behind a per-market flag, until EU and UK counsel sign off.
2. Open-web blog sources only. No paid sites, cookbooks, magazines, user-recipe aggregators or test kitchens.
3. Extraction to structured fields only: quantities, temperatures, times and a short verb list. No tips or reasons.
4. A sentence check and a structure check, each with a low threshold and each logged. Either one holds publication.
5. Human review for registered or high-value publishers.
6. The §3 cap, counted across versions and cards together.
7. Every opt-out honoured, AI signals included (§7).
8. CC0 only on the Commise text, labelled as written by Commise and AI-made. No CC0 on facts. No rewards.
9. Media and IP liability insurance, a live publisher opt-out contact, and counsel sign-off.
10. A wide launch only if it adds real search traffic over facts cards and cook adaptations.

So `021-FR-014h` and `016-FR-015i` stand at launch, as a launch decision and an honesty rule, not as law.

### 7. Fetching follows the signals that bind, and the URL import depends on the market

- [Law] Never pass a paywall, login or meter, use a cook's credentials, pose as another bot or rotate addresses
  (17 U.S.C. §1201, _Facebook v. Power Ventures_, 844 F.3d 1058 (9th Cir. 2016), UK Computer Misuse Act).
- robots.txt follows RFC 9309: the group that names our user-agent binds us, and otherwise the `*` group binds us.
- [Law, EU, Judgement, strong] Machine-readable data-mining opt-outs bind under DSM Art. 4(3): TDMRep, `noai` tags,
  blocks on AI crawlers and `ai-input=no`. [House rule] We honour them everywhere from v1, and log per fetch what each
  signal said, including "none found".
- **The per-market URL-import switch.** [Law, EU and UK] Our server makes the copy, so no private-copy or hosting
  defence covers a stored verbatim copy (UK s.28B quashed, _VCAST_, C-265/16, DSM Art. 4(2)). EU and UK cooks keep
  facts and a link from a URL import. US cooks keep the private full copy (defensible but untested). A cook who wants
  the full text pastes it. The switch lives in one policy and is closed for any market counsel has not cleared.

### 8. One gate covers every door to public, and it fails closed

[Law] A copy-check flag creates knowledge, so a flagged recipe must not reach the public until a person decides, and a
person never publishes a confirmed copy (DSA Art. 7, the §512(c)(1)(A) knowledge test). ADR-0074 already holds a
non-green recipe. "Never blocking" in ADR-0077 §4 and ADR-0078 means "never rejected automatically". The hold stays.

Every door that makes content public or more visible goes through the one hold in the read rule: publish, a toggle,
an edit to any checked field or photo, a version restore, a clone, a public collection, bulk import, a facts card, a
licensed page, a CC BY switch, a re-publish after takedown and a donation at erasure. A missing or unknown input reads
as held. A later change outside the recipe (an opt-out, a cap, a failed public-domain record, a lost site claim) is
read live. The door list and its failure modes live in `020` section K. Notice and takedown, counter-notice, repeat
infringers and the DSA and UK OSA duties live in `016-FR-016` to `FR-066`.

## Consequences

- Anyone can read the facts of every public recipe, and every cook's own words, with no account.
- Family recipes and public-domain cookbooks join the open web.
- A cook can publish a cookbook recipe in their own words, with credit.
- Cooks can open their own recipes under CC BY 4.0.
- EU and UK cooks get a weaker URL import than US cooks.
- The rights label Policy, the public-domain record, the licence fields, the facts-card projection, the cap ledger
  and the fetch-signal log are new work. None of them exists in code yet.
- A free cook can publish a book or web recipe as a facts card without using a slot. That follows `016-FR-029a`, and
  it is the founder's ruling of 2026-11-03 (§2).

## One-way doors

- **The statement kind values and the licence values.** They are stored and sent to clients.
- **A CC BY grant.** Copies others make under it cannot be recalled.
- **The facts card's field list.** Sites read it as our promise. Adding a method excerpt later breaks it.
- **Opening a public-domain text.** Once indexed, a mistaken page is copied by others. The record and the annual
  counsel check exist for this reason.

## Residual risks

- **Counsel has not reviewed any of this.** Every rule is subject to `016-FR-050`.
- **The founder has not registered the DMCA agent.** Until then there is no safe harbor for anything users post.
- **"US-only" is not true while the app is listed in EU or UK stores** (DSA Recital 8, GDPR Art. 3(2), UK OSA
  s.4(5)). `025` holds the market preconditions.
- **The cap numbers are not set.** A cap set too high does not answer Art. 7(5).
- **The law on prose-only opt-outs is not settled** (_Kneschke v. LAION_, further appeal pending).
- **Shipped code is behind this decision.** `visibilityPolicy.ts` still lets a full `imported_public` copy go public,
  and the read rule carries no hold yet.

## Alternatives

- **Keep the signed-out source card with no ingredients.** No legal difference, and it hides what the founder wants
  open.
- **Open public domain under the 70-year test.** Fails in at least six common cases. Rejected.
- **Ship the Commise version at launch.** Commise is then the direct infringer for any close paraphrase, with no safe
  harbor. Rejected for launch, kept as a gated pilot.
- **CC0 on every recipe's facts.** It implies rights we do not hold in other sites' databases. Rejected.
- **Index facts cards.** Lawful, but weaker for search quality and goodwill. Left to the founder.
- **Keep the US URL-import copy in every market.** Fails in the EU and UK. Rejected.
