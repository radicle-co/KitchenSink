# Feature Specification: Chef Spaces

**Feature Branch**: `docs/chefSpaces1029` (worktree `.worktrees/chefSpaces`, from `fix/ingredient-matching`. The spec
directory is `specs/026-chef-spaces`. `.specify/feature.json` is not pointed here, because another session uses it.)
**Created**: 2026-10-29
**Status**: Draft. Nine owner questions are open (Q1 to Q9). Phase 1 can be built under either answer to Q1. The
money half (section E) waits on 018. Every user-facing surface needs `staff-ux-engineer` DISCOVER and DESIGN
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

| Tag               | Meaning                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| **`→ 012`**       | A requirement to merge into 012 (creator page, collections, analytics, tips)                      |
| **`→ 013`**       | A requirement to merge into 013 (courses)                                                         |
| **`→ 015`**       | A requirement to merge into 015 (publishing rewards)                                              |
| **`→ 018`**       | A requirement to merge into 018 (chef program, marketplace, money-out)                            |
| **`→ requested`** | A change that 004, 016, 020 or 021 owns. It is listed in Requested amendments and not edited here |
| **`026`**         | Owned here, because no other spec owns it (site claims and the email list)                        |

The work comes in three phases. The phases follow what is unblocked, not what matters most.

| Phase                    | What it holds                                                                                                         | What it waits on                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| **1. Layer on the blog** | Claim your site, bring your recipes in, the corner page, email sign-up with export, analytics, links back to the blog | The requested amendments to 004 and 021. Q1 for 020 |
| **2. Earn on Commise**   | The Pro pool, digital cookbooks, tips, courses, affiliate links                                                       | 018's money-out apparatus and C-018-003, C-018-004  |
| **3. Replace the blog**  | Home moves to Commise: the canonical address, a chef club, native email sending, redirect help                        | Phase 2 earning in practice. Q2, Q3 and Q5          |

## Dependencies

| Spec or decision                                                                                                                                              | Relationship                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [012-creator-profiles](../012-creator-profiles/spec.md)                                                                                                       | **Required, amended.** The chef corner is the 012 page. Collections, follows, analytics, the embed widget and the tip jar live there                                                               |
| [018-chef-program-marketplace](../018-chef-program-marketplace/spec.md)                                                                                       | **Required, amended.** Chef standing, what a chef can sell (licensed copy, C-018-001), the seller of record (C-018-002), the ledger, payouts, tax and the store rails                              |
| [013-cooking-school](../013-cooking-school/spec.md)                                                                                                           | **Amended.** Courses are a chef income line. Its 20%/80% split is 018's open C-018-004                                                                                                             |
| [015-publishing-rewards](../015-publishing-rewards/spec.md)                                                                                                   | **Constraining, amended.** Its rewards stay non-monetary (`015-FR-007`, `015-FR-030`). The Pro pool in section E must not become a paid route around it                                            |
| [004-recipe-importing](../004-recipe-importing/spec.md)                                                                                                       | **Required, amendment requested.** It owns source types (`004-FR-011`) and the per-item statement (`004-FR-014a`). It also owns bulk import (ADR-0072) and the "Save to Commise" button (`FR-053`) |
| [020-content-source-check](../020-content-source-check/spec.md) and ADR-0074                                                                                  | **Required, amendment requested.** When the check finds the chef's own blog, a claimed site must count as evidence                                                                                 |
| [021-public-discovery-and-sharing](../021-public-discovery-and-sharing/spec.md)                                                                               | **Required, amendment requested.** What is open to the web, indexing and canonical addresses. Another session owns the linked card work there                                                      |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md)                                                                                   | **Required, amendment requested.** The content licence, notice and takedown, the processor terms for the email list                                                                                |
| [010-subscriptions](../010-subscriptions/spec.md) and [ADR-0075](../../docs/architecture/decisions/0075-payment-stack-store-billing-revenuecat-and-stripe.md) | **Governs.** Plans, store billing through RevenueCat, Stripe on the web. The Pro pool is funded from 010 revenue                                                                                   |
| [014-notification-service](../014-notification-service/spec.md)                                                                                               | **Referenced.** If the owner chooses it (Q3), native email sending in phase 3 is a new 014 channel                                                                                                 |
| [023-referrals-and-growth-measurement](../023-referrals-and-growth-measurement/spec.md)                                                                       | **Referenced.** Traffic a chef sends to Commise, and Commise sends back to the chef, is measured with its events                                                                                   |
| [`docs/research/userNeeds/synthesis.md`](../../docs/research/userNeeds/synthesis.md)                                                                          | **Governs the reader side.** Need 1 is "Get to the recipe and the current step without the page fighting back" (FR-001, CK-005). Ads are part of that complaint                                    |

**Plan-time dependencies.** These run before any of this feature is built. None of them has run for this spec.

- **`staff-ux-engineer` DISCOVER, then DESIGN**, for the chef corner, the site claim, the bring-in flow, the email
  sign-up, the chef analytics, the cookbook page and every money screen, on web and mobile, at phone, tablet and
  desktop widths. Its §3.6 gate applies. It owns the chef-side research questions too: what a blogger needs to see
  before they trust us with their recipes.
- **`staff-architect` PLANNING**, for the site claim record (section A), the canonical choice (FR-006), the email list
  and its processor role (section C), and the Pro pool's attribution (section E). Each is persisted data, a contract
  or money, so each is expensive to reverse.
- **`clo` and counsel**, for the processor terms (FR-023), CAN-SPAM's postal address (FR-026), the FTC disclosure
  for affiliate links and sponsors (FR-047, FR-048), and whether a pool paid for engagement changes 016's hosting
  posture (FR-041). **`cfo-1`**, for the pool's size and the commission against the store stack (Q4, Q6).
- **No printed products (owner rule).** This spec proposes no printed product of any kind. A digital cookbook is a PDF or EPUB file and the licensed copies in the app (FR-044). Nothing
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
4. **The money machinery is specified but not built.** 018 already decided what a chef can sell (a licensed copy,
   C-018-001) and who the seller is (C-018-002). It left open how a free visit pays (C-018-003) and the commission
   (C-018-004). This spec gives a blogger a reason to arrive before that money exists (phase 1), and a reason to stay
   once it does (phase 2).

## What this feature does NOT do

- **No display ads at v1.** 018 refused in-app display ads (`018` H.4, C-018-003a). Q8 puts the question back to the
  owner with the evidence on both sides. This spec does not reopen it.
- **No paywalled recipe.** Visibility stays private or public (GR-014, `001-FR-003`). A sale delivers a licensed copy
  (`018-FR-029`). `012-FR-035` to `012-FR-039` stay retired.
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
| **Digital cookbook** | A sellable collection of a chef's own recipes (`018-FR-087`), delivered as licensed copies and a file      |

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
   claimed site, **Then** under Q1 option A it goes to a person with the claim shown, and under option B that one match does not
   count as a copy (FR-005).
3. **Given** a chef whose Home is their blog, **When** a search engine reads the Commise page, **Then** the page's
   canonical address is the blog post, and the page shows a clear "Read on [blog name]" link (FR-006).
4. **Given** a page on a site the chef has not claimed, **When** the chef tries to bring it in as their own, **Then**
   it is refused as an own-site import, and the normal import of someone else's recipe is offered instead (FR-002).
5. **Given** a claim that failed its check (FR-001), **When** the chef tries a new bring-in, **Then** it is refused
   with the reason and the fix. Recipes already brought in stay where they are.

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

### User Story 4 - A chef earns when Pro members cook their recipes (Priority: P2)

Dana's recipes are cooked by Pro members. Each month Dana's earnings page shows a share of the Pro pool, worked out
from those cooks, with the rule written in plain words.

**Why this priority**: It is the answer to "income like ads for visits", without ads. It pays the long tail of chefs,
which direct sales do not (`018-FR-058a-i`). It waits on 018's money-out apparatus.

**Independent Test**: Seed cook events for two chefs by distinct Pro members. Run the month's allocation. Make sure that the
split matches the stated rule to the cent. Make sure that the rule, and nothing else, decides how events from free
members, the chef's own account and repeated cooks count.

**Acceptance Scenarios**:

1. **Given** a month's pool, **When** it is allocated, **Then** each chef's share follows the published rule exactly
   and the ledger balances (FR-040, `018-FR-037`).
2. **Given** a recipe that is not the chef's own authored work, **When** it is cooked, **Then** it earns nothing
   (FR-041).
3. **Given** cook events that look automated or self-dealt, **When** the month closes, **Then** they are held for
   review and not paid until cleared (FR-042).

### User Story 5 - A chef sells a digital cookbook (Priority: P2)

Dana bundles 30 gluten-free bakes into a cookbook. Commise checks the "gluten-free" claim against each recipe's
ingredients. A buyer pays once and gets 30 private copies in their library and a PDF to keep.

**Why this priority**: People pay for a bounded, trusted set, not a single recipe (`018` section N). It waits on 018.

**Independent Test**: Build a cookbook with one recipe that fails its claim. Make sure that the claim is refused or marked
as the chef's own statement. Buy it and make sure that the copies and the file arrive together.

**Acceptance Scenarios**:

1. **Given** a cookbook claim the system cannot check, **When** it is listed, **Then** the claim is removed or
   marked as the chef's statement (`018-FR-088`).
2. **Given** a purchase, **When** it completes, **Then** every copy and the file arrive in one act (`018-FR-089`,
   FR-044).
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

No answers yet. The open questions are Q1 to Q9 in Owner questions.

## Requirements _(mandatory)_

### Functional Requirements

#### A. Claim your site and bring your recipes in (phase 1)

- **FR-001** `→ 012`: A chef MUST be able to claim a website by proving they control it, by one of three methods. The methods are a DNS TXT
  record on the domain, a meta tag in the home page, or a token from a recipe plugin the chef runs (`004-FR-053`). A
  site MUST have at most one live claim. The claim MUST be checked again on a schedule. A claim that fails MUST stop
  new bring-ins, and the chef MUST see the reason and the fix. It MUST NOT remove recipes already brought in.
- **FR-002** `026`: A claim proves control of a site. It MUST NOT be read as proof that the chef wrote any recipe on
  it. Each recipe brought in as the chef's own MUST carry the chef's own statement, made per recipe at the moment of
  bring-in (`004-FR-014a`). A blanket statement for the whole site MUST NOT replace it (`016-FR-014`).
- **FR-003** `→ requested 004`: A chef MUST be able to bring in recipes from their claimed site in bulk, through
  ADR-0072's import route and its allowance. The list of recipes MUST come from the site's own sitemap or recipe
  structured data. Every page fetched MUST be on the claimed domain, fetched once at the chef's request, with
  robots rules honored. Nothing MUST fetch on a schedule.
- **FR-004** `026`: A bring-in MUST keep the recipe's photos only where the chef states they own them or have the
  right to use them. A photo the chef does not state MUST be left behind, with the chef told which.
- **FR-005** `→ requested 020`: A recipe brought in from a claimed site with "I wrote this" and "This is my own page"
  is `user_created`, labelled "Written by you" (ADR-0077 §2, `020-FR-012g`). Its address on the claimed site MUST be
  stored as its origin. [NEEDS OWNER DECISION: **Q1**.] What a hit on that claimed page does in the 020 check:
    - **Option A, a person still looks.** The hit goes to a person with the live claim shown as evidence, as
      `020-FR-012g` does today. Nothing in 020 changes. The cost is one staff review per recipe.
    - **Option B, the claim clears that one hit.** A hit on the recipe's own origin page, under a live claim on that
      domain, MUST NOT count as a copy. Every other part of the check runs as usual. A hit on any other page, a
      model item, or a photo signal still sends the recipe to a person (ADR-0074 §2). Only this one hit changes.
- **FR-006** `→ requested 021`: Each chef MUST choose a Home: their blog or Commise. When
  Home is the blog, each recipe page with a blog origin MUST name the blog post as its canonical address. It MUST
  also show a "Read on [blog name]" link near the top. When Home is Commise, the page is canonical on Commise under
  `021-FR-010`. The default is Q2. A change of Home MUST reach every public surface within the purge bound
  (`021-FR-061`) and MUST be recorded with its time.
- **FR-007** `026`: When a chef's Home is Commise, the chef MUST be able to download a redirect list from each blog
  origin address to its Commise address, in a format a WordPress redirect plugin reads.
- **FR-008** `026`: When a recipe on a claimed site changes, Commise MUST NOT change its copy by itself. The chef MUST
  be able to pull the new version, which runs the 020 check again as any edit does (`021-FR-007`).
- **FR-009** `026`: A chef MUST be able to remove a claim at any time. Their recipes stay theirs. They can take
  everything with them through 017's export.

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
- **FR-014** `→ 012`: [NEEDS OWNER DECISION: **Q9**.] Which corner sections need 018 chef standing, and which any
  creator gets. The recommendation is: phase 1 sections for any creator, money sections for chefs only.

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
- **FR-025** `026`: [NEEDS OWNER DECISION: **Q3**.] Whether Commise sends email for chefs (phase 3, a new 014
  channel), or only connects to the chef's provider. Sending makes Commise responsible for delivery, bounces and
  complaints for every chef.
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

#### E. Earning on Commise (phase 2, needs 018)

- **FR-040** `→ 018`: [NEEDS OWNER DECISION: **Q4**.] **The Pro pool.** A stated share of Pro revenue MUST be paid to
  chefs each month, split by Pro members' cooks of each chef's recipes, counted per member first (user-centric: each
  member's share goes only to the chefs that member cooked). The rule MUST be published to chefs in plain words
  before it applies (`018-FR-058a`). This is 018's "chef pool" (`018` H.4, Next tier), brought forward.
- **FR-041** `→ 018, 015`: Only a chef's recipe that is open to the web and whose rights label (`016-FR-015c`) is
  "Written by you" MUST earn from the pool. Every other label MUST earn nothing: an adaptation, a web copy, a book or
  paid-site recipe, a family recipe, a clone and public domain text. Whether an adaptation earns is part of Q4. The rule MUST read the one rights label
  Policy (ADR-0077 §1), never the source type alone, because a family recipe can share `user_created`.
  This keeps H3's guard: money is a stronger inducement than a reward, so every eligibility rule from 015 and 004
  binds harder here (`018-FR-064`, `015-FR-001`).
- **FR-042** `→ 018`: Cook events MUST count only from distinct paying members, at most once per member per recipe per
  month, never from the chef's own account or household. Events that look automated MUST be held, not paid, until a
  review clears them (`018` section L).
- **FR-043** `→ 018`: **Digital cookbooks.** A chef MUST be able to sell a collection of their own recipes as one
  product (`018-FR-087`), with verified constraint claims (`018-FR-088`). This is the primary sellable unit.
- **FR-044** `→ 018`: A cookbook purchase MUST deliver the licensed copies (`018-FR-089`) and a PDF or EPUB file of
  the same recipes, in one act. The file MUST name the buyer and the chef. Nothing MUST offer printing.
- **FR-045** `→ 018`: [NEEDS OWNER DECISION: **Q5**.] **A chef club.** A monthly price paid to one chef. Each new club
  recipe arrives in each member's library as a licensed copy, and club courses or live sessions (013) are open to
  members. It creates no paywalled recipe and no third visibility state.
- **FR-046** `→ 012, 018`: Tips (`012-FR-031` to `012-FR-034`) and courses (`013-FR-001` to `013-FR-010`) are chef
  income lines, settled through 018.
- **FR-047** `→ 018`: A chef MUST be able to add their own affiliate links to equipment and ingredients on their own
  recipe. Each MUST be marked as an affiliate link where it shows, as the FTC requires. Grocery affiliate revenue
  shared with the chef (`018` H.4, Now tier) waits on a grocery partner, which Commise does not have.
- **FR-048** `→ 018`: [NEEDS OWNER DECISION: **Q7**.] Whether a chef can sell a sponsor slot: one labelled "Sponsored
  by" line per recipe or cookbook, text and a logo, with no tracking and no third-party script.
- **FR-049** `→ 018`: Every price a chef sets MUST map to a store price point where the sale happens in a mobile app,
  because in-app products are set up ahead of time. [To check at plan time: whether Apple and Google let one app
  carry a catalogue priced by each creator, and how. Do not build on either answer until checked.]
- **FR-050** `→ 018`: [NEEDS OWNER DECISION: **Q6**.] The commission, decided against the whole stack: the store fee,
  then ours, then the chef's net (`018-FR-082`, C-018-004).

#### F. Display ads

- **FR-060**: [NEEDS OWNER DECISION: **Q8**.] Display ads stay refused (`018` H.4) unless the owner reopens them.

### Requested amendments (other specs own these)

| Spec | Change                                                                                                                                        | Needed by   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 004  | A bulk bring-in from a claimed site, listed from its sitemap or structured data (FR-003)                                                      | Phase 1     |
| 020  | Under Q1 option B, a hit on the recipe's own origin page under a live claim does not count as a copy (FR-005, `020-FR-012g`)                  | Phase 1     |
| 021  | When Home is the blog, a canonical address that points to the chef's blog, and the "Read on" link (FR-006)                                    | Phase 1     |
| 016  | Processor terms for the email list (FR-023). Creator terms that cover the pool and the site claim. Disclosure rules for affiliate and sponsor | Phase 1 / 2 |

The linked card (`021-FR-014a` to `FR-014h`) is for a recipe from someone else's page. It does not apply to a chef's
own page under a live claim. This spec edits none of 004, 016, 020 or 021.

### Key Entities

- **Site claim**: a chef, a domain, the method used, the time it was last checked, its state (live, failed,
  removed). One live claim per domain. Owned here.
- **Recipe origin**: on a recipe brought in from a claimed site, the page address it came from and the claim it came
  under. An attribute of the 001 recipe, not a new entity.
- **Home choice**: per chef, blog or Commise, with the time of each change. An attribute of the 012 profile.
- **List connection**: a chef, a provider, the state of the connection, the processor terms accepted. Owned here.
  The provider's API secret is stored as a secret, never in the database in plain text.
- **List sign-up**: a reader address, the chef, the time, the page, the consent text, the market, whether it was
  confirmed and whether it reached the provider. Owned here. Personal data under 016.
- **Pool allocation**: per month, the pool total and each chef's share, with the events it rests on. Booked in 018's
  ledger.

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

## Owner questions

Each question is framed with its trade-offs in [`incomeModel.md`](./incomeModel.md) §6.

- **Q1**: When the copy check finds a chef's recipe on their own claimed page, does a person still look (option A), or
  does the claim clear that one hit (option B)?
- **Q2**: Does a chef's Home start as their blog or as Commise?
- **Q3**: Does Commise send email for chefs, or only connect to their provider?
- **Q4**: What share of Pro revenue goes to the Pro pool, from when, and does an "Adapted by you" recipe earn?
- **Q5**: A chef club (a monthly price to one chef that delivers new recipes as copies): yes or no?
- **Q6**: The commission, against the store stack (C-018-004)?
- **Q7**: Can a chef sell a labelled sponsor line on their own recipe?
- **Q8**: Do display ads stay refused?
- **Q9**: Which corner features need chef standing?

## Assumptions

- The WP Recipe Maker plugin path (`004-FR-053`) waits on the plugin team's agreement. The meta tag and DNS methods do
  not.
- US first, as 016-FR-048 sets. The store rail for paid items outside the US is `018-FR-084`.
- A chef keeps copyright in every recipe. Commise takes a licence and never ownership (owner ruling, 2026-10-27).
