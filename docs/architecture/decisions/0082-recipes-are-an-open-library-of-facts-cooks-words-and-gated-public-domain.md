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
- **Facts cards are indexable** (owner ruling 2026-11-03). The founder's words: "Our competitors rely on making users
  pay to access any recipe. I want to undercut them and I believe recipes are like a library and so I want people to
  find public and creator recipes on our app over all others." Indexing is not a separate permission. It follows the
  public rule. Every indexable page, a card included, is server-rendered signed out, has one canonical URL and a
  sitemap entry, and carries schema.org `Recipe` data built only from our own facts and the cook's or Commise's own
  text, with `isBasedOn` pointing at the source (`021-FR-020`, `FR-023`, `FR-027`). The card keeps its facts-only
  field list, its caps, a visible credit and link, and no source prose, headnote or photo.
- **One canonical page per dish from one source page.** Where many cards, or a card and a cook's own recipe, describe
  one dish from the same page, one canonical page wins and the others declare it, so we never publish thin duplicates
  (`021-FR-026a`). Two cooks' texts are never merged.
- **No paywall on reading a public recipe** (owner ruling 2026-11-03). No Pro gate or other charge ever applies to
  reading a PUBLIC recipe or collection, signed in or out. Commise never charges anyone to read a recipe. Pro sells
  private capacity and tools, never access. A creator's sale of a private recipe or collection (§9) is the creator's
  own offer, not a Commise paywall.
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
- user-recipe aggregator sites get NO public facts cards (owner ruling 2026-11-03). Their recipes are other users'
  work, and they carry the highest database-right risk (_British Horseracing Board_, C-203/02). A cook's import from one
  stays private, or the cook publishes it in their own words as "Adapted by you". Edited publishers' collections get
  the tightest cap.
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

### 9. The founder's rulings on the remaining questions

Owner rulings of 2026-11-03, each accepting the recommendation put to the founder:

- **Creator pages** list only recipes the cook wrote or adapted, never their facts cards (`012-FR-008`,
  `021-FR-015`).
- **Pages shown under their own stated open licence are indexable**, and so are public-domain pages (`021-FR-014f`,
  `021-FR-006`).
- **At launch the app is listed only in US app stores.** The EU and UK duties (`016-FR-048c`) must be met before any
  listing in those stores, and `025` gates that listing on them. [Law] A store listing is enough to serve a market
  (DSA Recital 8, GDPR Art. 3(2)).
- **While an edited public recipe is being checked, readers see the last approved version** (`020-FR-064`).
- **Bios and avatars are not checked by the outside-copy check.** [House rule] Notice and takedown covers them
  (`020-FR-071`).
- **No public bulk download and no public API of the open layers for now.** A cook's export of their own recipes
  stays (`016-FR-033`, `016-FR-034`, `021-FR-060`).
- **Creators choose public or private, and can sell private work.** The founder's words: "For creator recipes, a
  creator can choose to make recipes public or private. Same for collections. They can also choose to list private
  recipes and collections for sale." The creator sets the price (`012-FR-034a` to `FR-034c`, `018-FR-026`).
- **A buyer PURCHASES the sold version, and can SUBSCRIBE for the creator's current versions** (owner rulings
  2026-11-03, `018-FR-029`, `FR-029a`, `FR-029h`). The founder's words: "The purchase gives download ability of the
  sold version." A purchase, at a base rate the creator sets, gives the version on sale at that moment. The buyer reads
  it in the app and downloads it as a file, and keeps the file. A subscription gives the live view of the creator's
  current versions while it runs, and the subscriber keeps nothing after it ends. Neither writes a recipe, a clone or a
  paid visibility state. An edit re-runs the 020 hold, and subscribers see the last approved version meanwhile. A buyer
  can read, cook, plan and add to a grocery list, and keep their own private notes. Clone, publish, resale, share and
  every other export are refused. What a subscription covers, and whether `026`'s chef club is that subscription, are
  founder questions (FQ-018-4). [Law] The EU and UK digital-content rules (Directive 2019/770, UK Consumer Rights Act
  2015 Part 1 Chapter 3) apply once we list in those stores (`025`). A buyer's erasure keeps the sale record
  de-identified (GDPR Art. 17(3)(b)), and the creator sees aggregate sales only.
- **Creator removal gives a 30-day download and no refund** (owner ruling 2026-11-03, `018-FR-029i`). When a creator
  takes a recipe down, stops selling it, or erases their account, the subscription ends. Every buyer and subscriber can
  download the last approved version for 30 days, and gets an email with the link. The download works after the
  creator's account is gone. [Law] Keeping only the files buyers are owed, for 30 days, rests on legitimate interest
  (GDPR Art. 6(1)(f)). Whether a subscriber's current period is pro-rated is a founder question (FQ-018-5).
- **A takedown gives a full refund and no download** (owner ruling 2026-11-03, `018-FR-029j`). When content is taken
  down for infringement or found illegal, every buyer gets a full refund. Commise pays first and claws the amount back
  from the seller's balance or payouts. When that fails, Commise refunds from its own funds and pursues the seller. The
  seller terms grant the clawback and an indemnity. [Law] No download is offered. A host that keeps distributing
  content after notice that it infringes loses the safe harbor (17 U.S.C. §512(c)(1)(A)(iii) and (C)). A takedown
  closes an open 30-day window at once. Whether those buyers also get the refund is a founder question (FQ-018-6).
- **Past downloaders are told** (owner ruling 2026-11-03, `018-FR-029k`). When content is taken down for legal
  reasons, everyone who downloaded it gets a notification and an email. It says the content was removed for legal
  reasons, says why in plain words, and asks them to delete their copies. It states what happened, not a judgement.
  So it is accurate and not defamatory toward the seller. [House rule] The terms say users are told, agree to delete
  such content, and accept responsibility if they knowingly keep or use it after notice (`016-FR-070`,
  `018-FR-029m`). Counsel drafts the clause.
- **One commerce transaction record** (owner ruling 2026-11-03, `018-FR-029l`). The founder's words: "The feature that
  develops this will need to create a database or data lake of these transactions for all sorts of reasons beyond just
  takedown." It is append-only and has one owning service. It records purchases, subscriptions, downloads by version,
  refunds, clawbacks, payouts, takedowns, notices and creator removals. It serves notices, refunds, payouts, tax, fraud,
  disputes, legal holds, analytics and audit. It survives erasure through pseudonymous ids, with the identity mapping
  removed. Retention and the legal basis are set per purpose, and counsel and the accountant set the exact periods.
  Tables or a data lake is open for the feature's plan. The privacy notice lists it (`016-FR-071`).
- **Refunds, downloads and clubs** (owner rulings 2026-11-03). Public recipes involve no payment, so there is no refund.
  A creator can offer a PDF or EPUB with a cookbook or recipe, and the buyer keeps it. The file holds only content the
  creator can sell, and passes the 020 gate like any sale (`026-FR-044`, `020-FR-079`). A chef-club member keeps nothing
  after leaving (`026-FR-045`).
- **Selling rules.** [Law] A creator can sell only content they own: "Written by
  you", "Adapted by you" in their own words, and a family recipe whose giver's permission covers selling. Never a
  copy of someone else's page, book or paid site, a facts card, or public-domain curator text (17 U.S.C. §106(3),
  `016-FR-029a`). A collection for sale holds only sellable recipes. Facts cards and other people's recipes can sit
  only in a free public collection. Selling is distribution, so every sold recipe passes the same 020 hold as
  publishing (`020-FR-057`).
- **The copy check runs at import, and suggests fresh wording** (owner ruling 2026-11-03, `020-FR-075` to
  `FR-078`, `004-FR-054`, `016-FR-067`, `016-FR-068`). The check runs on the steps beside the ingredient-match review.
  A flagged step shows a suggested rewording that restates what the step does in fresh words, never a line-by-line
  paraphrase. The cook accepts, edits or disputes it, and the check runs again. A flag blocks public and sale until it
  is resolved. Private is never blocked. The same suggestions appear in the review of a flagged recipe. A step from an
  accepted suggestion makes the recipe "Adapted by you". The AI text is never the cook's own words, so the recipe is
  never "Written by you" and cannot take CC BY (`016-FR-015i`, `020-FR-077`). Rewording a flagged recipe before any
  takedown is not a strike. An upheld takedown is (`016-FR-062`). A private bulk-imported recipe is usable at once.
  Only going public or on sale waits for review (`020-FR-003b`). Site owners get
  a claim flow: a DMCA-element form, ADR-0078's live-site proof, a counter-notice, and a reword-to-restore path. Until
  the check is built, launch needs a registered DMCA agent, working takedown and counter-notice, and a live
  repeat-infringer policy.
- **The check uses AI and searches the wider internet** as well as the source the cook named (owner ruling
  2026-11-03). HOW the search works (provider, method, terms) and the AI and search cost and budget are OPEN, decided
  when feature 020 starts. ADR-0077 §4's named search provider and per-recipe cost are therefore not settled. If the
  search or the model cannot run, the part is not green and a person decides.
- **A cook can say "This is my recipe, from my site or account"** (owner ruling 2026-11-03, `004-FR-014a`,
  `016-FR-069`, `020-FR-012g`). The bare statement is the cook's attestation, with the cook's own legal risk, and gives
  the "Written by you" label. It never clears a copy flag, because anyone can claim. Verified ownership of a site is
  026's live site claim and nothing else (ADR-0078). It clears only the hit on the recipe's own import page, persists
  per site, and is read as it stands. A claim that lapses clears nothing new, and does not reopen a recipe it cleared.
  A social account is proved by linking it through the platform's own sign-in (OAuth), never by a code in a bio
  (`026-FR-061`). An import from a post whose author id matches the linked account clears the own-post match. The link
  asks only for the profile id. Its tokens are stored encrypted and revoked at unlink, and erasure deletes both. It is
  re-checked on each import and when a token is revoked. Unlinking clears nothing new, and public recipes stay public.
  A platform with no usable identity or post-author API is OPEN. A cook can claim ownership later on a saved recipe,
  and the "Save to Commise" screen offers the claim (`004-FR-055`). A verified owner can file 016's site-owner claim against copies on Commise, and a notice
  against the owner's recipe runs the normal notice and counter-notice flow with the claim as evidence. ADR-0078 §3
  still holds: a claim proves control of a site, not authorship of each post.
- **The founder owns renewing the DMCA designated-agent registration every three years** (37 C.F.R. §201.38,
  `016-FR-059`).

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
- **UK traffic can still reach the open web pages.** At launch the app is listed only in US stores (§9), but the UK
  OSA can attach through a significant number of UK users (s.4(5)). `025` holds the market preconditions.
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
- **Keep facts cards `noindex`.** Lawful, and weaker for discovery. The founder chose to be found over all others.
  Rejected.
- **Keep the US URL-import copy in every market.** Fails in the EU and UK. Rejected.
