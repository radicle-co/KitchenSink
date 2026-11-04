# Feature Specification: Chef Spaces

**Feature Branch**: `docs/chefSpaces1029` (worktree `.worktrees/chefSpaces`, from `fix/ingredient-matching`. The spec
directory is `specs/026-chef-spaces`. `.specify/feature.json` is not pointed here, because another session uses it.)
**Created**: 2026-10-29
**Status**: Draft. The owner answered Q1 to Q9 on 2026-10-29 (Clarifications). Q4 (the Pro pool) and Q6 (the
commission) are deferred to the royalties and chef-payments work. The money half (section E) waits on 018. Every user-facing surface needs `staff-ux-engineer` DISCOVER and DESIGN
before build. None has run.
**Input**: Owner, 2026-10-29: "We have the creator/chef feature - let's enhance that to make the offering more
powerful and enticing to layer on top of and then replace blogs. The question is how these chefs can earn income while
having their "chef" corner. Income like ads for visits? selling cook books or collections or individual recipes?
ability to still have email lists? ... I believe capturing these kinds of users is critical for us." Earlier the same
day: "how we get people to move their recipes into commise instead of these blogs without loosing the values the blogs
have but also by providing far more benefit." Mindset, owner: "assume that we can do this and figure out how."

**Evidence**: [`research/creatorIncome.md`](./research/creatorIncome.md) (how food creators earn today, and how
Substack, Patreon, Medium, YouTube, Beehiiv, Kajabi and others pulled creators in). The value proposition and income
model are in [`incomeModel.md`](./incomeModel.md). Every number in this spec comes from those two files or carries its own source. A
number with no source is written GAP, with a target and a test.

## How to read this spec

Chef Spaces adds no new profile, page, collection or payment system. It is a change set on features that already
exist, in the same way 017 changes its owner specs. A "chef corner" is the 012 creator page (`/@handle`). A digital
cookbook is 018's sellable collection (`018-FR-087`). Money moves only through 018's money-out apparatus. GR-014
AC-014-b forbids a second profile entity, and this spec does not create one.

Each requirement says which spec it changes:

| Tag                                   | Meaning                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| **`→ 012`**                           | A requirement to merge into 012 (creator page, collections, analytics, tips) |
| **`→ 013`**                           | A requirement to merge into 013 (courses)                                    |
| **`→ 015`**                           | A requirement to merge into 015 (publishing rewards)                         |
| **`→ 018`**                           | A requirement to merge into 018 (chef program, marketplace, money-out)       |
| **`→ 004`**, **`→ 020`**, **`→ 021`** | A change applied in that spec on 2026-10-29, after the owner's rulings       |
| **`→ requested 016`**                 | A change 016 owns. It is listed in Amendments and not edited here            |
| **`026`**                             | Owned here, because no other spec owns it (site claims and the email list)   |

The work comes in three phases. The phases follow what is unblocked, not what matters most.

| Phase                    | What it holds                                                                                                         | What it waits on                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **1. Layer on the blog** | Claim your site, bring your recipes in, the corner page, email sign-up with export, analytics, links back to the blog | `staff-ux-engineer` DESIGN. Counsel review of FR-005                                      |
| **2. Earn on Commise**   | Digital cookbooks, the chef club, tips, courses, affiliate links, the sponsor line                                    | 018's money-out apparatus. The commission, from the royalties and chef-payments work (Q6) |
| **3. Replace the blog**  | Home moves to Commise: the canonical address and redirect help. A decision on native email sending                    | Phase 2 earning in practice (Q3)                                                          |

The Pro pool (FR-040) is in no phase yet. The owner deferred it to the royalties and chef-payments work (Q4).

## Dependencies

| Spec or decision                                                                                                                                              | Relationship                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [012-creator-profiles](../012-creator-profiles/spec.md)                                                                                                       | **Required, amended.** The chef corner is the 012 page. Collections, follows, analytics, the embed widget and the tip jar live there                                                               |
| [018-chef-program-marketplace](../018-chef-program-marketplace/spec.md)                                                                                       | **Required, amended.** Chef standing, what a chef can sell (a purchase of the sold version, or a subscription with a live view, C-018-001 replaced 2026-11-03 by ADR-0082 §9), the seller of record (C-018-002), the ledger, payouts, tax and the store rails                              |
| [013-cooking-school](../013-cooking-school/spec.md)                                                                                                           | **Amended.** Courses are a chef income line. Its 20%/80% split is 018's open C-018-004                                                                                                             |
| [015-publishing-rewards](../015-publishing-rewards/spec.md)                                                                                                   | **Constraining, amended.** Its rewards stay non-monetary (`015-FR-007`, `015-FR-030`). Any future Pro pool (FR-040, deferred) must not become a paid route around it                               |
| [004-recipe-importing](../004-recipe-importing/spec.md)                                                                                                       | **Required, amendment requested.** It owns source types (`004-FR-011`) and the per-item statement (`004-FR-014a`). It also owns bulk import (ADR-0072) and the "Save to Commise" button (`FR-053`) |
| [020-content-source-check](../020-content-source-check/spec.md) and ADR-0074                                                                                  | **Required, amendment requested.** When the check finds the chef's own blog, a claimed site must count as evidence                                                                                 |
| [021-public-discovery-and-sharing](../021-public-discovery-and-sharing/spec.md)                                                                               | **Required, amendment requested.** What is open to the web, indexing and canonical addresses. Another session owns the linked card work there                                                      |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md)                                                                                   | **Required, amendment applied.** The content licence, notice and takedown, the processor terms for the email list                                                                                  |
| [010-subscriptions](../010-subscriptions/spec.md) and [ADR-0075](../../docs/architecture/decisions/0075-payment-stack-store-billing-revenuecat-and-stripe.md) | **Governs.** Plans, store billing through RevenueCat, Stripe on the web. A future Pro pool (FR-040, deferred) is funded from 010 revenue                                                           |
| [014-notification-service](../014-notification-service/spec.md)                                                                                               | **Referenced.** If the owner chooses it (Q3), native email sending in phase 3 is a new 014 channel                                                                                                 |
| [023-referrals-and-growth-measurement](../023-referrals-and-growth-measurement/spec.md)                                                                       | **Referenced.** Traffic a chef sends to Commise, and Commise sends back to the chef, is measured with its events                                                                                   |
| [`docs/research/userNeeds/synthesis.md`](../../docs/research/userNeeds/synthesis.md)                                                                          | **Governs the reader side.** Need 1 is "Get to the recipe and the current step without the page fighting back" (FR-001, CK-005). Ads are part of that complaint                                    |

**Plan-time dependencies.** These run before any of this feature is built. None of them has run for this spec.

- **`staff-ux-engineer` DISCOVER, then DESIGN**, for the chef corner, the site claim, the bring-in flow, the email
  sign-up, the chef analytics, the cookbook page and every money screen, on web and mobile, at phone, tablet and
  desktop widths. Its §3.6 gate applies. It owns the chef-side research questions too: what a blogger needs to see
  before they trust us with their recipes.
- **`staff-architect` PLANNING**, for the site claim record (section A), the canonical choice (FR-006), the email list
  and its processor role (section C), and the chef club (FR-045). Each is persisted data, a contract
  or money, so each is expensive to reverse.
- **`clo` and counsel**, for the processor terms (FR-023), CAN-SPAM's postal address (FR-026), the FTC disclosure
  for affiliate links and sponsors (FR-047, FR-048), and the own-site rule in FR-005, which the owner approved subject
  to counsel review. The Pro pool and the commission go to the royalties and chef-payments work (Q4, Q6).
- **No printed products (owner rule).** This spec proposes no printed product of any kind. A buyer purchases a digital cookbook and gets the sold version of its recipes in the app, plus a PDF or EPUB file to keep where the chef offers one (FR-044). _(amended 2026-11-03, owner ruling, ADR-0082 §9. Was: a live view, with the file paused.)_ The file is a digital file, not a printed product. Nothing
  here is "print-ready" or print on demand.

## Why this feature exists

1. **Food bloggers are losing the thing a blog was for.** A blog earns from search traffic. Search is the largest
   source of traffic for a top recipe blog: 57.23% for Pinch of Yum in March 2026 ([Food Blogger Pro, Apr
   2026](https://www.foodbloggerpro.com/blog/pinch-of-yums-traffic-trends-2024-vs-2026/)). Algorithm changes and AI
   answers put that traffic at risk. The figures are in `research/creatorIncome.md` §2.
2. **Readers hate the page a blog has to be.** A blog earns from ads around the recipe. That page is the #1 cook need
   in our own research: stories, ads and pop-ups bury the recipe (FR-001, CK-005). Commise can show the same recipe
   with none of that, and still pay the chef.
3. **Today a blogger who brings in their own posts looks like a copier.** A blogger can state "I wrote this", so the
   recipe is `user_created` and labelled "Written by you" (ADR-0077 §2). But the outside-copy check finds the blog
   post, and `020-FR-012g` sends every such hit to a person. It says a way to prove a site is yours "is owed by 012",
   and 016 records the same debt. Section A is that proof. Without it, 400 blog recipes mean 400 staff reviews.
4. **The money machinery is specified but not built.** 018 already decided what a chef can sell (a purchase of the sold version, or a
   subscription with a live view, C-018-001 as replaced by the owner rulings of 2026-11-03, ADR-0082 §9) and who the seller is (C-018-002). It left open how a free visit pays (C-018-003) and the commission
   (C-018-004). This spec gives a blogger a reason to arrive before that money exists (phase 1), and a reason to stay
   once it does (phase 2).

## What this feature does NOT do

- **No display ads.** 018 refused in-app display ads (`018` H.4, C-018-003a), and the owner kept that refusal for
  chef corners too (Q8, 2026-10-29).
- **No paywalled recipe.** Visibility stays private or public (GR-014, `001-FR-003`). A purchase grants the sold version and a file,
  and a subscription grants a live view (`018-FR-029`, `018-FR-029h`, amended 2026-11-03, ADR-0082 §9). `012-FR-035` to `012-FR-039` stay retired.
- **No printed product.** See the owner rule above.
- **No crawling.** Bringing in a chef's site is user-directed, from a site they proved they control (FR-004).
- **No editorial choice by staff.** Staff review stays a rights check, never a judgement of quality or taste. That
  keeps the hosting posture that `016-FR-016` to `016-FR-019` rely on (the Mavrix risk in the owner's recipe
  ownership research).
- **No new profile entity.** The corner is the 012 page.

## Words used in this spec

| Word                 | Meaning                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Chef corner**      | The 012 creator page at `commise.app/@handle`, with the sections in section B                              |
| **Chef**             | A cook with 018 chef standing. Phase 1 features are open to any creator. Money features need chef standing |
| **Claimed site**     | A website the chef proved they control, by one of the methods in FR-001                                    |
| **Home**             | Where a chef's recipe page points search engines: their blog, or Commise (FR-006)                          |
| **Pro pool**         | A share of Pro revenue paid to chefs for Pro members cooking their recipes (section E)                     |
| **Digital cookbook** | A sellable collection of a chef's own recipes (`018-FR-087`). A buyer purchases the sold version and keeps its file. |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A blogger brings their recipes in without hurting their blog (Priority: P1)

Dana runs a recipe blog on WordPress with 400 recipes. Dana adds a meta tag to the blog's home page, and Commise
makes sure that Dana controls the site. Dana picks 50 recipes from the site's own recipe list. For each one Dana states
"I wrote this". The recipes arrive with Dana's photos and method. Each page on Commise links to the post on Dana's
blog, and tells search engines the blog is the original. Dana's search traffic does not drop because of Commise.

**Why this priority**: It is the whole "layer on top" phase. Without it a blogger has nothing to put in the corner.

**Independent Test**: Claim a test site, bring in five recipes, and read the public page's canonical address, the
link back and the source type. Change the claim to fail and make sure that a new bring-in is refused.

**Acceptance Scenarios**:

1. **Given** a chef with a claimed site, **When** they bring in a recipe from that site and state "I wrote this",
   **Then** the recipe is saved as `user_created`, labelled "Written by you", with the page address on the claimed
   site recorded as its origin (FR-003, FR-005).
2. **Given** a recipe brought in from a claimed site, **When** the content source check finds the same recipe on the
   claimed site, **Then** that one match does not count as a copy, and every other part of the check runs as usual (FR-005).
3. **Given** a chef whose Home is their blog, **When** a search engine reads the Commise page, **Then** the page's
   canonical address is the blog post, and the page shows a clear "Read on [blog name]" link (FR-006).
4. **Given** a page on a site the chef has not claimed, **When** the chef tries to bring it in as their own, **Then**
   it is refused as an own-site import, and the normal import of someone else's recipe is offered instead (FR-002).
5. **Given** a claim that failed its check (FR-001), **When** the chef tries a new bring-in, **Then** it is refused
   with the reason and the fix. Recipes already brought in stay where they are.

_(Note 2026-11-03, owner ruling O16, ADR-0082.)_ Scenarios 4 and 5 are about the bulk bring-in (FR-003), which lists
recipes from the site itself and so needs a live claim. A single paste, URL or social import can now carry the owner
statement without a claim (`004-FR-014a` statement 1a). Without a live claim that statement clears no hit, and the
recipe goes to a person (`020-FR-012g`).

### User Story 2 - A reader cooks a chef's recipe with nothing in the way (Priority: P1)

Sam finds Dana's recipe from a search. On Commise the ingredients and steps are the first thing on the page. There is
no pop-up and no ad. Sam taps "Save" and signs up. Dana sees one more save and one more cook in their analytics.

**Why this priority**: This is the benefit a blog cannot give. It is the reason a chef sends readers here.

**Independent Test**: Open a chef's recipe signed out on a phone. Make sure that the first screen holds the title and the
start of the ingredients, with no overlay. Save it after sign-up and make sure that the chef's counts move.

**Acceptance Scenarios**:

1. **Given** any chef recipe, **When** it opens on any width, **Then** the ingredients start on the first screen and
   nothing covers them (FR-012).
2. **Given** a chef's story or notes, **When** the page shows them, **Then** they sit after the recipe or behind a
   tab, never in front of it (FR-012).

### User Story 3 - A chef keeps an email list (Priority: P1)

Dana already has 6,000 subscribers on Kit. Dana connects Kit to the corner. A reader who taps "Get Dana's newsletter"
and confirms is added to Dana's Kit list, and nowhere else. Following Dana on Commise does not add anyone to any list.

**Why this priority**: Bloggers treat the list as the asset they own. They will not move to a home that cannot grow it.

**Independent Test**: Connect a test Kit account. Sign up on the corner, confirm, and read the new subscriber in Kit.
Follow the chef with another account and make sure that no list changes.

**Acceptance Scenarios**:

1. **Given** a connected list, **When** a reader signs up and confirms, **Then** the address goes to the chef's
   provider with the time, the page and the consent text (FR-020, FR-022).
2. **Given** a follow, **When** it is saved, **Then** no email address is shared with the chef (FR-021,
   `012-FR-016`).
3. **Given** any time, **When** the chef asks, **Then** they can export every sign-up Commise holds for them, with
   consent records (FR-024).

### User Story 4 - A chef earns when Pro members cook their recipes (DEFERRED)

Deferred by the owner on 2026-10-29 (Q4) to the royalties and chef-payments work. That work writes this story, its
priority, its test and its scenarios. The story number is kept so it is not reused.

### User Story 5 - A chef sells a digital cookbook (Priority: P2)

Dana bundles 30 gluten-free bakes into a cookbook. Commise checks the "gluten-free" claim against each recipe's
ingredients. A buyer purchases it once. They read all 30 recipes in the app as sold, and they download a PDF or EPUB to keep. _(amended 2026-11-03, owner ruling, ADR-0082 §9. Was: a live view with no copies, and the PDF paused.)_

**Why this priority**: People pay for a bounded, trusted set, not a single recipe (`018` section N). It waits on 018.

**Independent Test**: Build a cookbook with one recipe that fails its claim. Make sure that the claim is refused or marked
as the chef's own statement. Buy it and make sure that the buyer can read, cook, plan and list all 30 recipes at once, can download the file of the sold version, and cannot clone or otherwise export it.

**Acceptance Scenarios**:

1. **Given** a cookbook claim the system cannot check, **When** it is listed, **Then** the claim is removed or
   marked as the chef's statement (`018-FR-088`).
2. **Given** a purchase, **When** it completes, **Then** the buyer can read every recipe in one act (`018-FR-089`,
   FR-044), can download the file of the sold version, and no recipe row is written. _(amended 2026-11-03, owner ruling,
   ADR-0082 §9)_
3. **Given** a signed-out reader, **When** they open the cookbook's page or find it in the chef directory, **Then**
   they see only its title, cover, price and the chef's description, and none of its recipes (FR-015).

### User Story 6 - A chef moves home to Commise (Priority: P3)

After a year Dana earns more here than from blog ads. Dana switches Home to Commise. Search engines now see the
Commise page as the original. Commise gives Dana a redirect list for the blog, so old links land on the right recipe.

**Why this priority**: It is the "replace the blog" phase. The chef chooses it once Commise pays them more.

**Independent Test**: Switch Home for a test chef. Make sure that canonical addresses, the sitemap and the redirect list all
change together, and that switching back restores them.

**Acceptance Scenarios**:

1. **Given** a switch of Home, **When** it is saved, **Then** every page of that chef changes canonical address
   within the purge bound (`021-FR-061`), and the switch is recorded (FR-006).
2. **Given** the switch, **When** the chef asks, **Then** they get a redirect list from each blog address to its
   Commise address (FR-007).

### Edge Cases

- **The chef does not own every recipe on their own site.** A guest post or an adapted family recipe sits on many
  blogs. The site claim proves control of the site, not authorship of each recipe. The per-item statement and the
  020 check still apply (FR-002).
- **Two people claim the same site.** Only one live claim per site. A second claim is refused, and a dispute goes to
  support with the evidence (FR-001).
- **The chef sells the blog.** The claim fails its next check. Recipes already brought in stay with the chef who wrote
  them. New bring-ins stop (FR-001).
- **A recipe on the blog changes.** Nothing changes on Commise by itself. The chef can pull the new version (FR-008).
- **The chef deletes their Commise account.** The blog is untouched. Recipes, list sign-ups and earnings follow 016's
  erasure rules and `018-FR-041`.
- **A reader signs up to a list, and the chef later disconnects the provider.** Sign-ups already sent stay with the
  provider. New sign-ups stop, and the sign-up control disappears (FR-020).
- **A home cook with no business address wants a list.** CAN-SPAM needs a postal address in every commercial email.
  The chef is told this before they connect, with the choices (FR-026).
- **Ads on the chef's own blog.** Commise does not touch the blog. Links back to the blog lead to the chef's own ads,
  which is the chef's business.

## Clarifications

### Session 2026-10-29

The owner answered Q1 to Q9 on 2026-10-29, relayed by the business-plan session. Each answer is quoted.

- **Q1. When the copy check finds a chef's recipe on their own claimed page, does a person still look?** Owner: "Claim
  clears own-site hit". Option B, with counsel review before build. Recorded in FR-005 and `020-FR-012g`.
- **Q2. Does a chef's Home start as their blog or as Commise?** Owner: "Their blog". Recorded in FR-006 and
  `021-FR-010a`.
- **Q3. Does Commise send email for chefs, or connect only to their provider?** Owner: "Connect only, for now".
  Connect to the chef's provider in phases 1 and 2. Decide on sending after phase 2. Recorded in FR-025.
- **Q4. The Pro pool.** DEFERRED. Owner: "Let's mark this as something to resolve when we tackle the royalties and
  paying chefs work - it's going to require a lot of thought". There is no share and no rule for which recipes earn
  yet. Recorded in FR-040.
- **Q5. A chef club?** Owner: "Yes, earlier". The club is in phase 2, beside digital cookbooks. Recorded in FR-045.
- **Q6. The commission?** Owner: "Decide with royalties". Deferred to the same royalties and chef-payments work as
  Q4. 013's 20% stays a draft. Recorded in FR-050.
- **Q7. A sponsor line?** Owner: "Yes, as described". Recorded in FR-048.
- **Q8. Display ads?** Owner: "Keep refused". No display ads, chef corners included. Recorded in FR-060.
- **Q9. Which corner features need chef standing?** Owner: "Money features only". Recorded in FR-014.

## Requirements _(mandatory)_

### Functional Requirements

> _(added 2026-11-03, owner ruling, ADR-0082)_ **Every door to public passes 020's hold.** Any recipe text, lesson
> text, photo or video description this feature shows to anyone other than its owner counts as "publicly visible" for
> `020-FR-001`. It goes through 020's one hold before it is shown, and fails closed (020 section K). A buyer reads
> the live recipe through the same hold, and sees the last approved version while an edit is checked (`020-FR-057`,
> `020-FR-064`). _(amended 2026-11-03, owner ruling O15b, ADR-0082. Was: a copy delivered to a buyer carries its
> source's checked-content digest.)_ [House rule] This keeps every path to public
> behind one gate. Counsel review is owed before launch (`016-FR-050`).

#### A. Claim your site and bring your recipes in (phase 1)

- **FR-001** `→ 012`: A chef MUST be able to claim a website by proving they control it, by one of three methods. The methods are a DNS TXT
  record on the domain, a meta tag in the home page, or a token from a recipe plugin the chef runs (`004-FR-053`). A
  site MUST have at most one live claim. The claim MUST be checked again on a schedule. A claim that fails MUST stop
  new bring-ins, and the chef MUST see the reason and the fix. It MUST NOT remove recipes already brought in.
  _(amended 2026-11-03, owner ruling, ADR-0082 §9)_ A social account is proved a different way, by FR-061. The three
  methods here are for websites only.
- **FR-002** `026`: A claim proves control of a site. It MUST NOT be read as proof that the chef wrote any recipe on
  it. Each recipe brought in as the chef's own MUST carry the chef's own statement, made per recipe at the moment of
  bring-in (`004-FR-014a`). A blanket statement for the whole site MUST NOT replace it (`016-FR-014`).
- **FR-003** `→ 004`: A chef MUST be able to bring in recipes from their claimed site in bulk, through
  ADR-0072's import route and its allowance. The list of recipes MUST come from the site's own sitemap or recipe
  structured data. Every page fetched MUST be on the claimed domain, fetched once at the chef's request, with
  robots rules honored. Nothing MUST fetch on a schedule.
- **FR-004** `026`: A bring-in MUST keep the recipe's photos only where the chef states they own them or have the
  right to use them. A photo the chef does not state MUST be left behind, with the chef told which.
- **FR-005** `→ 020`: A recipe brought in from a claimed site with "I wrote this" and "This is my own page"
  is `user_created`, labelled "Written by you" (ADR-0077 §2, `020-FR-012g`). Its address on the claimed site MUST be
  stored as its origin. _(Owner ruling Q1, 2026-10-29: "Claim clears own-site hit".)_ A hit on the recipe's own
  origin page, under a live claim on that domain, MUST NOT count as a copy. Every other part of the check runs as
  usual. A hit on any other page, a model item, or a photo signal still sends the recipe to a person (ADR-0074 §2).
  Only this one hit changes. ⚠️ Counsel reviews this rule before it is built (`020-FR-012g`).
  _(amended 2026-11-03, owner ruling, ADR-0082 §9)_ The social twin is FR-061: an import from a post whose author id
  matches the cook's linked account clears the hit on that post, and only that hit.
- **FR-006** `→ 021`: Each chef MUST choose a Home: their blog or Commise. When
  Home is the blog, each recipe page with a blog origin MUST name the blog post as its canonical address. It MUST
  also show a "Read on [blog name]" link near the top. When Home is Commise, the page is canonical on Commise under
  `021-FR-010`. Home starts as the blog _(owner ruling Q2, 2026-10-29: "Their blog")_. A change of Home MUST reach every public surface within the purge bound
  (`021-FR-061`) and MUST be recorded with its time. The blog is the canonical address only under a live claim, and such a page
  leaves our sitemaps. The full rules are `021-FR-010a`.
- **FR-007** `026`: When a chef's Home is Commise, the chef MUST be able to download a redirect list from each blog
  origin address to its Commise address, in a format a WordPress redirect plugin reads.
- **FR-008** `026`: When a recipe on a claimed site changes, Commise MUST NOT change its copy by itself. The chef MUST
  be able to pull the new version, which runs the 020 check again as any edit does (`021-FR-007`).
- **FR-009** `026`: A chef MUST be able to remove a claim at any time. Their recipes stay theirs. They can take
  everything with them through 017's export.
  _(amended 2026-11-03, owner ruling, ADR-0082 §9)_ The same holds for a linked social account: a cook can unlink it at
  any time (FR-061).

> _(Note 2026-11-03, owner ruling O16, ADR-0082.)_ **The claim now also serves "This is my recipe".** The owner said: "a
> user should be able to mark that they are actually the owner of the recipe (i.e. a user importing from a web page
> they own). This is important for the review process." The site claim in FR-001 is the one way to verify ownership.
> No second mechanism is added, and the three proof methods are unchanged. What changes:
>
> - **Any cook can claim, at import or later.** A cook who makes the owner statement on a paste, URL or social import
>   (`004-FR-014a` statement 1a) is offered this claim for the page's domain. No chef standing is needed (Q9: money
>   features only). The cook can also start it later from the recipe or settings.
> - **One claim serves every later import from that domain** while it is live. The check reads the claim each time
>   (`020-FR-012g`). Nothing on a recipe stores that it is "verified".
> - **Loss** follows ADR-0078 §2. A claim that fails its re-check or is removed (FR-009) stops clearing new hits at
>   once, and never reopens a recipe it cleared.
> - **Erasure.** The claim is personal data and is deleted with the account. A decision record that cited it keeps
>   only its opaque id, method and last check time (`016-FR-069`, `020-FR-063`). A removed claim stays in the removed
>   state while the account exists, because cleared outcomes cite it.
> - **Social accounts** are proved by linking the account through the platform's own sign-in (FR-061, owner ruling
>   2026-11-03, OQ-026-S1 resolved). **OPEN: the re-check interval** (OQ-026-S2 below).
>
> [House rule] A claim proves control of a site, not authorship of each post (FR-002, ADR-0078 §3). Counsel review is
> owed before launch (`016-FR-050`).

- **FR-061** `026` _(added 2026-11-03, owner ruling, ADR-0082 §9)_: **A cook links a social account to prove their
  posts are theirs.** The owner ruled out a code placed in the account's bio. The cook links the account to their
  Commise profile through the platform's own sign-in (OAuth). The platforms are Instagram, TikTok, YouTube, Pinterest,
  Facebook and X, where each one offers a usable identity sign-in.
    - **What it proves.** A linked account proves ownership of the posts that account made. An import from a post whose
      author id matches the linked account's id clears the own-post hit in 020's check (`020-FR-012g`). It is the
      social twin of the own-site hit in FR-005 (ADR-0078 §1). Every other part of the check runs as usual. Clearing
      needs both ids from the platform's official interface: the linked account's id and the post's author id.
    - **OPEN per platform.** A platform with no usable OAuth identity interface is OPEN. A platform that gives no
      author id for a post is OPEN for clearing too, even where linking works. Each is settled at build.
    - **Least privilege.** The link asks only for the platform's minimal identity scope, chosen at build. It reads the
      profile id and nothing else. It never posts, reads messages or reads followers.
    - **Tokens.** Tokens MUST be stored encrypted. They MUST be used only to check the account's identity again. They
      MUST be revoked at the platform when the cook unlinks. Whether the tokens live in Clerk's social connections or in
      our own OAuth client is OPEN for the plan. These custody, revocation and erasure rules bind whichever one holds
      them.
    - **Re-check.** The link MUST be checked again on each import that relies on it, and when the platform reports the
      token revoked. A link that fails its check clears nothing new.
    - **Unlink.** A cook MUST be able to unlink at any time (FR-009). Unlinking stops clearing new imports at once.
      Recipes already public stay public (ADR-0078 §2).
    - **Later claims.** A cook can link an account after import and claim a recipe already saved (`004-FR-055`). The
      "Save to Commise" screen offers the link too (`004-FR-054`).
    - **Erasure.** [Law] The link and its tokens are personal data (GDPR Art. 4(1)). Account erasure MUST delete the
      link and revoke and delete its tokens. A decision record that cited the link keeps only an opaque id, the
      platform and the last check time (`016-FR-069`, `020-FR-063`). The privacy notice lists this data
      (`016-FR-071`).
    - [House rule] A link proves control of an account, not authorship of each post. A repost of someone else's work
      passes the link, so the per-recipe statement (`004-FR-014a`) carries authorship, and takedown still applies
      (ADR-0078 §3). Counsel review is owed before launch (`016-FR-050`).

#### B. The chef corner (phase 1)

- **FR-010** `→ 012`: The corner MUST be able to show, in an order the chef sets: an about section, featured
  collections, latest recipes, digital cookbooks (phase 2), courses (013), a newsletter sign-up (section C), and
  links to the chef's blog and social accounts. Every section is the 012 page, extended. Signed-out visibility
  follows 021 for each section: public collections are readable signed out on their own addresses (021 Q2, owner
  ruling 2026-10-29), and paid items follow FR-015.
- **FR-011** `→ 012`: The corner and every chef recipe page MUST carry no third-party script, no pop-up, no
  interstitial and no auto-playing media. A chef MUST NOT be able to add one.
- **FR-012** `→ 012`: On every chef recipe page the title, the photo and the start of the ingredients MUST be on the
  first screen at phone width. A chef's story or notes MUST come after the method, or behind a tab. This is need 1
  (FR-001, CK-005), stated as a promise to the reader.
- **FR-013** `→ 012`: The 012 embed widget MUST be offered as a "Cook this in Commise" card a chef can place on their
  own blog post. It links to the Commise page of that recipe. It carries no tracking script (`012-FR-026`).
- **FR-014** `→ 012`: _(Owner ruling Q9, 2026-10-29: "Money features only".)_ Every phase 1 feature MUST be open to any
  creator. Every money feature (section E) MUST need 018 chef standing.
- **FR-015** `→ 012, 018`: An item a chef sells MUST NOT be readable signed out (021 Q2, owner ruling 2026-10-29). A
  paid collection, recipe, digital cookbook, course or club MUST show a signed-out reader at most its title, cover,
  price and the chef's own description. That is enough for a reader to find it and buy it. It MUST NOT show any of
  its recipes, their ingredients, steps or photos, or a course's lessons. The same limit MUST hold in the chef directory and its search
  (`018-FR-017`), which list chefs and their public work, never linked cards.

#### C. The email list (phase 1)

- **FR-020** `026`: A chef MUST be able to connect their own email provider (Kit, Mailchimp or Beehiiv at first) so
  that the corner shows a newsletter sign-up. A sign-up MUST go to that provider and nowhere else. Commise MUST send
  it to the provider from its own server and MUST NOT load the provider's form or script on the page (FR-011).
  Disconnecting MUST remove the sign-up control at once.
- **FR-021** `026`: Signing up to a chef's list MUST be its own act, separate from following. A follow MUST NOT share an
  email address with the chef (`012-FR-016`). The sign-up MUST name the chef, say what they will send, and link to
  the chef's privacy notice.
- **FR-022** `026`: Each sign-up MUST record the time, the page, the consent text shown and the reader's market. In a
  market whose law needs it, a sign-up MUST be confirmed by a link in an email before it counts. The GDPR rules are in
  `research/creatorIncome.md` §5. The CASL details are GAP there, so counsel sets the Canadian rule.
- **FR-023** `→ requested 016`: The chef MUST be the controller of their list and Commise its processor, under written
  processor terms the chef accepts before connecting.
- **FR-024** `026`: The chef MUST be able to export every sign-up Commise holds for them, with its consent record, at
  any time, as CSV.
- **FR-025** `026`: _(Owner ruling Q3, 2026-10-29: "Connect only, for now".)_ In phases 1 and 2 Commise MUST NOT send
  email for chefs. It connects to the chef's provider only (FR-020). Whether Commise sends email (a new 014 channel)
  is decided after phase 2. Sending makes Commise responsible for delivery, bounces and complaints for every chef.
- **FR-026** `026`: Before a chef connects a list, they MUST be told that US law (CAN-SPAM) needs a valid postal
  address in each commercial email, and that a post office box registered with the US Postal Service is allowed
  (`research/creatorIncome.md` §5). Commise MUST NOT show a chef's address on
  any Commise page.
- **FR-027** `026`: A sign-up MUST NOT be a condition of reading a recipe, saving it, or any other use of the app.

#### D. Chef analytics (phase 1)

- **FR-030** `→ 012`: Chef analytics (`012-FR-023`) MUST add, per recipe and per period: cooks started, saves, adds to
  a meal plan, adds to a shopping list, newsletter sign-ups, and clicks to the chef's blog. All MUST stay aggregate
  (`012-FR-024`).
- **FR-031** `→ 012`: When a count is below a stated floor, analytics MUST show "fewer than N" rather than the number,
  so a single reader cannot be picked out.

#### E. Earning on Commise (phase 2, needs 018 chef standing and money-out)

- **FR-040** `→ 018`: **The Pro pool. DEFERRED** _(owner ruling Q4, 2026-10-29)_ to the royalties and chef-payments
  work. Owner: "Let's mark this as something to resolve when we tackle the royalties and paying chefs work - it's
  going to require a lot of thought". There is no share and no rule yet. The analysis in
  [`incomeModel.md`](./incomeModel.md) §5 and 018's chef pool (`018` H.4, Next tier) are inputs to that work, not
  requirements.
- **FR-041**, **FR-042**: Reserved for the pool's rules, decided with FR-040: which recipes earn, and how cook events
  count. The input that work starts from is in `incomeModel.md` §5 and §6 (Q4). Any rule it writes MUST read the one
  rights label Policy (ADR-0077 §1), never the source type alone. It MUST also keep 018's hazard H3 in view
  (`018-FR-064`, `015-FR-001`).
- **FR-043** `→ 018`: **Digital cookbooks.** A chef MUST be able to sell a collection of their own recipes as one
  product (`018-FR-087`), with verified constraint claims (`018-FR-088`). This is the primary sellable unit.
  _(Amended 2026-11-03, owner ruling O14d and O14e, ADR-0082.)_ [Law] The cookbook MUST hold only sellable recipes:
  "Written by you", "Adapted by you" in the chef's own words, and family recipes whose giver's permission covers selling
  (`018-FR-026`). It MUST NOT hold an imported copy, a facts card, public-domain curator text or another person's text.
  A non-sellable recipe MUST be refused when it is added. Every recipe sold passes 020's hold (`020-FR-057`). A chef
  can also sell a single private recipe or a private collection (`012-FR-034a`). Counsel review is owed before launch
  (`016-FR-050`).
- **FR-044** `→ 018`: A cookbook purchase MUST grant the sold version of every recipe in it (`018-FR-089`, `018-FR-029`)
  as one act. The buyer MUST be able to read, cook, plan and list them and MUST NOT be able to clone them. Nothing MUST
  offer printing. _(amended 2026-11-03, owner ruling O15, ADR-0082. Amended again the same day, owner ruling, ADR-0082
  §9.)_ _(Was, first: deliver the licensed copies and a PDF or EPUB file of the same recipes, in one act, with the buyer
  and the chef named in the file. Then, for one round: a live view, with the file paused.)_ **The PDF or EPUB file is
  UN-PAUSED.** The founder ruled that downloads stay (FQ-018-1 to FQ-018-3 resolved in `018`). A chef can offer a PDF
  or EPUB with a cookbook or a recipe, and the buyer keeps the file. The file MUST hold only content the chef can sell
  (`018-FR-026`) and only a version with an allowing 020 outcome (`020-FR-079`). Each download is an event in the
  commerce record (`018-FR-029l`). After a takedown, every user who downloaded it gets the notice of `018-FR-029k`. A
  subscriber to the chef reads the current version instead (`018-FR-029h`). [House rule] Counsel review is owed before
  launch (`016-FR-050`).
- **FR-045** `→ 018`: **A chef club** _(owner ruling Q5, 2026-10-29: "Yes, earlier", so it is in phase 2)_: a monthly price
  paid to one chef. Each new club
  recipe is readable by each member while the membership runs, in its current version, and club courses or live
  sessions (013) are open to members. It creates no paywalled recipe and no third visibility state. _(amended 2026-11-03,
  owner ruling, ADR-0082 §9)_ A member keeps nothing after leaving. Access ends with the membership. _(amended again
  2026-11-03, owner ruling, `018` FQ-018-4)_ The club IS the creator subscription of `018-FR-029h`, one product. It
  covers everything the chef sells while it is active. Its refunds follow `018-FR-029i` and `018-FR-029j`.
- **FR-046** `→ 012, 018`: Tips (`012-FR-031` to `012-FR-034`) and courses (`013-FR-001` to `013-FR-010`) are chef
  income lines, settled through 018.
- **FR-047** `→ 018`: A chef MUST be able to add their own affiliate links to equipment and ingredients on their own
  recipe. Each MUST be marked as an affiliate link where it shows, as the FTC requires. Grocery affiliate revenue
  shared with the chef (`018` H.4, Now tier) waits on a grocery partner, which Commise does not have.
- **FR-048** `→ 018`: _(Owner ruling Q7, 2026-10-29: "Yes, as described".)_ A chef MUST be able to sell one sponsor
  line per recipe or cookbook. It MUST be labelled "Sponsored by", hold text and a logo only, and sit under the method,
  never above the ingredients. The chef sells it. It MUST use no ad network, no tracking and no third-party script
  (FR-011).
- **FR-049** `→ 018`: Every price a chef sets MUST map to a store price point where the sale happens in a mobile app,
  because in-app products are set up ahead of time. [To check at plan time: whether Apple and Google let one app
  carry a catalogue priced by each creator, and how. Do not build on either answer until checked.]
- **FR-050** `→ 018`: **The commission. DEFERRED** _(owner ruling Q6, 2026-10-29: "Decide with royalties")_ to the same
  royalties and chef-payments work as FR-040. When it is set, it MUST be set against the whole stack: the store fee,
  then ours, then the chef's net (`018-FR-082`, C-018-004). `013-FR-010`'s 20% stays a draft until then.

#### F. Display ads

- **FR-060**: _(Owner ruling Q8, 2026-10-29: "Keep refused".)_ Display ads MUST NOT appear on any Commise surface,
  chef corners and chef recipe pages included (`018` H.4).

### Amendments to other specs

| Spec | Change                                                                                                                                                                | Status                                       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 004  | A bulk bring-in from a claimed site, listed from its sitemap or structured data (FR-003)                                                                              | Applied 2026-10-29: `004-FR-053a`            |
| 020  | A hit on the recipe's own origin page under a live claim does not count as a copy, with counsel review before build (FR-005)                                          | Applied 2026-10-29: `020-FR-012g`            |
| 021  | When Home is the blog, the canonical address is the chef's blog post, with a "Read on" link (FR-006)                                                                  | Applied 2026-10-29: `021-FR-010a`            |
| 016  | Processor terms for the email list (FR-023). Creator terms that cover the site claim and the sponsor line. FTC disclosure rules for affiliate links and sponsor lines | Applied 2026-10-29: `016-FR-054` to `FR-057` |
| 004, 016, 020, 021 | "This is my recipe" (owner ruling O16, 2026-11-03, ADR-0082): the owner statement on single imports, read by the same claim | Applied 2026-11-03: `004-FR-014a` statement 1a, `016-FR-069`, `020-FR-012g`, `021-FR-010a` |

The linked card (`021-FR-014a` to `FR-014h`) is for a recipe from someone else's page. It does not apply to a chef's
own page under a live claim. This spec does not edit 016 or 010. _(Note 2026-11-03, owner ruling, ADR-0082: the
linked card is now a signed-out facts card, indexable under 021's public rule (owner ruling O2, amended 2026-11-03). A chef's public pages list every open label
(written, adapted, family, public domain, clone) and show each label, and the licence where the chef chose CC BY 4.0.
They never list a linked card. Owner ruling O7, 2026-11-03, ADR-0082, confirms it: no creator or chef page lists a facts card. Counsel review is owed before launch (`016-FR-050`).)_

### Key Entities

- **Site claim**: a chef, a domain, the method used, the time it was last checked, its state (live, failed,
  removed). One live claim per domain. Owned here. _(amended 2026-11-03, owner ruling O16, ADR-0082)_ Any cook can
  hold one, not only a chef. It is personal data, deleted at account erasure (`016-FR-069`). Counsel review is owed
  before launch (`016-FR-050`).
- **Recipe origin**: on a recipe brought in from a claimed site, the page address it came from and the claim it came
  under. An attribute of the 001 recipe, not a new entity.
- **Home choice**: per chef, blog or Commise, with the time of each change. An attribute of the 012 profile.
- **List connection**: a chef, a provider, the state of the connection, the processor terms accepted. Owned here.
  The provider's API secret is stored as a secret, never in the database in plain text.
- **List sign-up**: a reader address, the chef, the time, the page, the consent text, the market, whether it was
  confirmed and whether it reached the provider. Owned here. Personal data under 016.
- **Pool allocation**: deferred with FR-040. No entity is specified until the royalties and chef-payments work.

## Success Criteria _(mandatory)_

Every number below is a target with a test. None is a forecast. The evidence behind each is in
`research/creatorIncome.md`.

- **SC-001**: In the first 60 days of beta, 20 bloggers from the creator list claim a site and bring in at least 10
  recipes each. Test: the creator outreach in the business plan's block 3. Kill rule: fewer than 5 means stop and run
  the `staff-ux-engineer` DISCOVER interviews again before building phase 2.
- **SC-002**: A chef's Commise pages send readers back to the blog: GAP. Target: clicks to the blog per 100 recipe
  views reported to each chef. Test: FR-030.
- **SC-003**: On a phone, 100% of chef recipe pages show the start of the ingredients on the first screen. Test: a
  Playwright and Maestro check over every chef page template.
- **SC-004**: Revenue per 1,000 views to a chef on Commise against their blog's ad RPM: GAP. Target: equal or better
  within 12 months of phase 2. Test: chefs who opt in share their RPM. Compare monthly.
- **SC-005**: No unverified dietary claim on any paid product. Test: `018-FR-088` over every listed cookbook.

## Tasks owed _(added 2026-11-03, owner ruling O15, ADR-0082)_

026 has no task file yet. When it gets one, these come first and each is test-first (red, then green).

- **026-L01**: A cookbook purchase grants the sold version of every recipe in one act, with no partial state
  (`FR-044`, `018-L01`). _(rewritten 2026-11-03, ADR-0082 §9, to prove the new behaviour. Was: a live view of every
  recipe.)_ Tests: unit, integration (one grant per recipe on its sold version, or none), Playwright and Maestro for
  buy, then read all.
- **026-L02**: A cookbook buyer cannot clone any recipe in it, and the only export is the file of the sold version
  (`FR-044`, `018-L02`). _(rewritten 2026-11-03, ADR-0082 §9. Was: no export at all.)_ Tests: integration (each refused
  route answers a refusal, the download route returns the sold version only), deployed e2e.
- **026-L03**: The cookbook listing page says what a purchase gives, what a subscription gives, and the two ways access
  can end (`FR-043`, `018-L07`, `018-FR-029i`, `018-FR-029j`). Tests: component (every state), Playwright and Maestro.
- **026-L04**: A recipe added to a sold cookbook reaches subscribers only, and a recipe removed from it is a creator
  removal for that recipe (`FR-043`, `018-FR-090`, `018-FR-029i`). _(rewritten 2026-11-03, ADR-0082 §9. Was: every
  change reaches every buyer.)_ Tests: integration (add, then a buyer who only purchased does not see it and a
  subscriber does. Remove, then the 30-day download opens).
- **026-L05**: Chef club membership is the creator subscription grant of `018-FR-029h`. It covers everything the chef
  sells while active, ends when the membership ends, and the member keeps nothing (`FR-045`, `018-L25`). _(rewritten
  2026-11-03, owner ruling FQ-018-4, to prove one product. Was: a separate live grant.)_ Tests: unit (a club membership
  is the subscription grant type), integration (a member reads a newly listed item, and a read and a download after the
  membership ends are both refused).
- **026-L06**: The PDF or EPUB file of a cookbook holds only sellable content, only an approved version, and records a
  download event per download (`FR-044`, `018-FR-029l`). _(rewritten 2026-11-03, ADR-0082 §9. Was: a guard that no
  export route exists.)_ Tests: unit (a file built from a version in review fails), integration (each download writes
  one event with the version id), Playwright and Maestro (buy, download).
- **026-L07** _(added 2026-11-03, owner ruling O16, ADR-0082)_: Any cook can start a claim from an import or later, by
  the three FR-001 methods only. One live claim per domain, refused for a second cook. Tests: unit (the method set is
  closed at three), integration (claim at import, then a second import from the domain needs no new proof),
  Playwright and Maestro for verify-at-import.
- **026-L08** _(added 2026-11-03, owner ruling O16, ADR-0082)_: A recipe from a single owner import follows FR-006's
  canonical rule only while its domain has a live claim (`021-FR-010a`). Tests: integration (claim live, canonical is
  the blog post. Claim failed, canonical returns to `commise.app` within `021-FR-061`).
- **026-L09** _(added 2026-11-03, owner ruling O16, ADR-0082)_: Claim erasure. The claim row is deleted with the
  account, and a removed claim stays in the removed state until then. Tests: integration, LOCAL e2e, and the
  erasure-coverage test lists the claim table (`020` K082-29, `016` L083-10).

- **026-L10** _(added 2026-11-03, owner ruling, ADR-0082 §9)_: Link a social account through the platform's own
  sign-in with the minimal identity scope (`FR-061`). Tests: unit (the requested scope set is the minimal identity
  scope and nothing more), integration (a link stores the profile id and an encrypted token only), Playwright and
  Maestro for link.
- **026-L11** _(added 2026-11-03, owner ruling, ADR-0082 §9)_: An import from a post whose author id matches the linked
  account clears the own-post hit, and nothing else (`FR-061`, `020-FR-012g`). Tests: unit (matching id clears, a
  different author id does not, a missing author id does not), integration (the link is checked again on each import).
- **026-L12** _(added 2026-11-03, owner ruling, ADR-0082 §9)_: Unlink and token revocation (`FR-061`, `FR-009`). Tests:
  integration (unlink revokes the token at the platform and the next import from that account is not cleared, a
  recipe already public stays public), integration (a platform revocation event stops clearing at once).
- **026-L13** _(added 2026-11-03, owner ruling, ADR-0082 §9)_: Erasure deletes the link and its tokens (`FR-061`). Tests:
  integration (after erasure no link row or token remains, and a decision record keeps only the opaque id, the
  platform and the last check time), erasure-coverage test lists the link table.
Counsel review is owed before launch (`016-FR-050`).

## Owner questions

All nine were answered on 2026-10-29. The answers are in Clarifications, and the trade-offs that were weighed are in
[`incomeModel.md`](./incomeModel.md) §6.

_(Added 2026-11-03, owner ruling O16, ADR-0082.)_ Two items were OPEN. One is now resolved:

- **OQ-026-S1. Proof for a social account.** RESOLVED 2026-11-03, owner ruling: the cook links the account through
  the platform's own sign-in (OAuth), FR-061. The earlier candidate, a code placed in the account's bio or in a post, is
  replaced and is not used. Still OPEN: which platforms offer a usable identity sign-in and a post author id. Each is
  settled at build.
- **OQ-026-S2. The re-check interval.** FR-001 says a claim is checked again on a schedule, and sets no interval.
  ADR-0078 names a domain that changes hands as a residual risk for the length of that interval. Not decided.

_(Added 2026-11-03, owner ruling O15, ADR-0082. Amended the same day, ADR-0082 §9.)_ Both questions that lived in 018 are
answered. A cookbook still comes with a PDF or EPUB file (`018` FQ-018-2), and a chef club member keeps nothing after
leaving (`018` FQ-018-3). The last one is now answered too (owner ruling 2026-11-03, `018` FQ-018-4): the chef club IS the creator
subscription, one product, covering everything the chef sells while it is active.

## Assumptions

- The WP Recipe Maker plugin path (`004-FR-053`) waits on the plugin team's agreement. The meta tag and DNS methods do
  not.
- US first, as 016-FR-048 sets. The store rail for paid items outside the US is `018-FR-084`.
- A chef keeps copyright in every recipe. Commise takes a licence and never ownership (owner ruling, 2026-10-27).
