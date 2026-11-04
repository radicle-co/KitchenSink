# Feature Specification: Public Discovery and Sharing

**Feature Branch**: `docs/spec021-022` (single-branch directive. The spec directory is
`specs/021-public-discovery-and-sharing`.)
**Created**: 2026-10-27
**Status**: Draft. Q1 and Q2 are resolved. Amended 2026-10-28 for AI answer engines (FR-011a, FR-028a, FR-080a,
FR-085a) and the save route (FR-035). Amended 2026-10-29 for recipe rights: the linked card (FR-014a to FR-014h), who
can be open to the web (FR-002), and the licence panel's ownership line (FR-040). Amended 2026-10-29 for a chef's Home (FR-010a), on
the owner's ruling on [026](../026-chef-spaces/spec.md) Q2. Amended 2026-11-03 for the open library (owner rulings,
ADR-0082). Facts cards open signed out (FR-003, FR-004, FR-014 to FR-014h). Family and gated public domain text open
to the web (FR-002, FR-006). Cooks get a CC BY choice (FR-040a, FR-040b). The counsel list grows (FR-095). See
Session 2026-11-03
**Input**: Owner, 2026-10-27: "Let's add a feature and spec for indexing and sharing as you note." And: "Include the
other recommendations in either new features or expanding existing features." Mindset, same day: "assume that we can do
this and figure out how." Owner, 2026-10-28: "Let's also do the pages for AI recommendation."

The ruling answers a recommendation, and the owner accepted all of it. Allow signed-out reading of public recipes that
cooks wrote themselves, and of creator pages. Add recipe structured data, so the pages can appear in Google's recipe
results. Everything else stays behind sign-in. The app still opens on sign-in. Imported third-party recipes stay
private, as they already are. A shared recipe link must open for a friend who has no account, because that is the
virality loop.

_(Amended 2026-11-03, owner rulings, ADR-0082.)_ The owner widened the 2026-10-27 ruling. The facts of any public
recipe are free for anyone to read signed out, as a facts card. A family recipe and gated public domain text can open
to the web in full. What stays private is the full copy of words the cook did not write: a copied web page, book or
paid site. The paragraph above is the 2026-10-27 ruling as given. The Overview and Session 2026-11-03 state the rule
now in force.

## Dependencies

| Spec or decision                                                                                                                              | Relationship                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)                                                                                   | **Required, amended.** Owns visibility (`001-FR-003`) and public read (`001-FR-004`). Owns clones (`001-FR-005`), sign-in (`001-FR-045`), the front door (`001-FR-045a`) and C-004. FR-090 amends them                                                            |
| [012-creator-profiles](../012-creator-profiles/spec.md)                                                                                       | **Required, amended.** Owns `CreatorProfile`, the `/@handle` page and its embed widget. Its signed-out page conflicted with `001-FR-045`. FR-091 resolves the conflict                                                                                            |
| [020-content-source-check](../020-content-source-check/spec.md)                                                                               | **Required.** Its publication hold is part of the one read rule. A recipe it holds is not public, so it is not open to the web. Its enforcement stamp (`020-FR-019`) decides if a page can be indexed                                                             |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md)                                                                   | **Required, amendments listed.** Owns the content licence (`016-FR-010` to `FR-015a`) and terms acceptance (`016-FR-001` to `FR-003`). Owns notice and action (`016-FR-016` to `FR-026`) and anti-extraction (`016-FR-030`)                                       |
| [004-recipe-importing](../004-recipe-importing/spec.md) and [ADR-0023](../../docs/architecture/decisions/0023-curator-declared-provenance.md) | **Required, amended by ADR-0082.** Own provenance. Since 2026-11-03 the rights label (`016-FR-015c`), not the source type, decides eligibility here. This feature never changes a source type. ADR-0023's curator grant carries the public domain record (FR-006) |
| ADR-0082                                                                                                                                      | **Governs (2026-11-03).** Recipes are an open library: facts, cooks' words and gated public domain open to the web. It amends ADR-0077, ADR-0072, ADR-0023, ADR-0073 and ADR-0052                                                                                 |
| [ADR-0047](../../docs/architecture/decisions/0047-shared-cors-policy.md)                                                                      | **Governs.** Every browser-facing service is bearer-only. A signed-out read must not add a cookie, a session read or a WebSocket to any adopter                                                                                                                   |
| [ADR-0020](../../docs/architecture/decisions/0020-cloudfront-edge-and-internal-alb-hostnames.md)                                              | **Governs, amendment listed.** The production edge answers a tokenless call with `401` except on its passthrough paths. A cached response must not depend on who asked                                                                                            |
| [ADR-0064](../../docs/architecture/decisions/0064-media-delivery-base-stage-cloudfront-oac-plain-urls.md)                                     | **Governs, amendment listed.** Photos and avatars are plain, long-cached CDN URLs. Avatar keys carry the user id today                                                                                                                                            |
| [018-chef-program-marketplace](../018-chef-program-marketplace/spec.md)                                                                       | **Amends, resolved 2026-10-29 (Q2).** `018-FR-017`'s chef directory is readable signed out, never with paid content (FR-008). 018 states the paid-content limit in its own words, applied 2026-10-31 (FR-097)                                                     |
| [GR-014](../governance-rules.md#gr-014-audience-and-sharing-model)                                                                            | **Governs, amendment listed.** Recipe visibility stays binary. "Open to the web" is a derived fact, not a third visibility value                                                                                                                                  |
| `specs/022-marketing-site-and-waitlist`                                                                                                       | **Sibling.** Shares the app store badge and smart banner rule (FR-037) and the no-consent measurement rule (FR-080)                                                                                                                                               |
| `GR-003` FR Identifier Namespace                                                                                                              | **Governs.** Every cross-feature reference here is written `{feature}-FR-{NNN}`                                                                                                                                                                                   |
| `GR-005` Offline declaration                                                                                                                  | **Governs.** See Offline Behavior                                                                                                                                                                                                                                 |

**Plan-time dependencies.** These run before any of this feature is built. None of them has run for this spec.

- **`staff-ux-engineer` DESIGN, then SPECIFY**, for every user-facing surface here, on web and mobile. The surfaces
  are the public recipe page, the app's public recipe view, the creator page, the facts cards (FR-014a, FR-004), the
  source card and the not-available state. They also include the share controls, the sign-up sheet and the licence moment
  at publish with its CC BY choice (FR-040a). The last ones are the public domain basis line (FR-006), the search
  setting and the smart banner. Its §3.6 web-to-mobile gate applies to each one. Every state in FR-019 is a deliverable.
- **`staff-architect` PLANNING**, to choose how signed-out reads reach the data (section J), then BLUEPRINT and
  REVIEW.
- **Counsel**, for the items in FR-095.
- **`ts-1`**, for the tracking plan behind section I, and the referrer classes and crawler counts added 2026-10-28.

**Plan work owed (2026-11-03, ADR-0082).** This feature has no `plan.md` or `tasks.md` yet. The 2026-11-03 rulings add
capability that the plan must design. `staff-architect` PLANNING owns each item:

- the facts card as a signed-out public projection, for web pages and for books and paid sites (FR-014a, FR-004,
  FR-102)
- the per-site and per-source cap, counted over time, and the aggregator list, whose sites get no card (FR-014e, O6)
- the public domain record and its gate (FR-006, `016-FR-015k`), and where the record is stored, because ADR-0023's
  grant is a token scope and not a row
- the stored licence choice and its markup (FR-040a, FR-023)
- the statement kind for a recipe made in the editor (`016-FR-015d`). Today it exists only on bulk import items
  (migration 0059)
- the rights label Policy (`016-FR-015d`) that FR-002 rule 5 reads. Which source type an adapted recipe gets is that
  Policy's decision, not this spec's

_(Added 2026-11-03, ADR-0082.)_ The airtight path to public (`020` section K) adds these tasks. Each is test-first.
Unit and integration tests of the gate on the door come first. Then a row in 020's deployed bypass suite
(`020-FR-074`) tries the door and must see it held.

- **P082-01**: the open-to-web Specification imports 020's hold Specification, so a public route cannot compile
  without it (FR-001, `020-FR-057`). Tests: unit (each surface refuses a held recipe), integration (each public route
  answers not-available for a held recipe).
- **P082-02** _(amended 2026-11-03, owner ruling O10, ADR-0082)_: version-pinned public reads: readers see the last approved version while an edit is checking
  (`020-FR-064`). Not-available applies only when no approved version exists. Tests: integration, deployed e2e (the
  public page shows the old approved text, never the new text before it clears).
- **P082-03**: every facts card, the creator page list and the embed widget inside the purge bound (FR-061). Tests:
  deployed e2e (a takedown, then each surface answers not-available within the bound).
- **P082-04**: live reads for opt-out, cap, exclusion, the public domain record and Home (`020-FR-067`), with an
  unreadable input read as closed (`020-FR-059`). Tests: unit (each input forced unreadable), integration.
- **P082-05**: the licence line and schema.org `license` follow the served version (`020-FR-070`). Tests: component,
  Playwright.
- **P082-06**: a non-owner read of a public `imported_public` recipe returns only the facts card projection. Today it
  returns the full copied text (`visibilityPolicy.ts` allows it, and the read has no projection). Tests: unit,
  integration, deployed e2e.
- **P082-07** _(amended 2026-11-03, owner rulings O6 to O12, ADR-0082)_: the aggregator-site list, and a denial before any count so no card is made for one (FR-014e,
  `016-FR-030a`, `001` T193). Tests: unit, integration, LOCAL e2e.
- **P082-08**: a creator page, its widget and its sitemap list never include a facts card (FR-015, `012` T-067).
  Tests: unit, integration, Playwright and Maestro.
- **P082-09**: pages under their own stated licence and public domain pages are indexable under FR-020. The earlier
  `noindex` rule 6 is removed. Tests: unit (each FR-020 rule), component, Playwright (robots and header).
- **P082-10**: no public bulk download and no public API route (FR-060, FR-103, `001` T195). Tests: unit (guard),
  integration.

## Overview

Today nobody can read a Commise recipe without an account (`001-FR-045`). A friend who gets a shared link meets a
sign-in form. Google cannot see any recipe, so Commise gets no search traffic. And spec 012 promised a signed-out
`/@handle` page that 001 forbids.

_(Amended 2026-11-03, owner rulings, ADR-0082.)_ This feature makes Commise an open library. It opens these to the
web:

- **Public recipes in words the cook can share**, each on its own page with its own address (FR-002, FR-006). There
  are four kinds:
    - a recipe the cook wrote
    - a recipe the cook adapted in their own words, with credit
    - a family or friend recipe, shared with the giver's permission
    - public domain text that passes the gate
- **Facts cards** for every other public recipe. A facts card shows the recipe's facts and a link or a credit, and
  none of the source's words or photos (FR-003, FR-004, FR-014a). Anyone can read one signed out. It can be indexed
  (FR-020). _(Amended 2026-11-03, owner ruling, ADR-0082.)_
- **Creator pages** (`/@handle`, spec 012), showing the cook's open recipes.

[Law] Nobody owns a recipe's facts: the dish name, ingredients, amounts, times, temperatures, yield, servings and the
order of steps (17 U.S.C. §102(b), Feist v. Rural, 499 U.S. 340 (1991), Publications International v. Meredith, 88 F.3d
473 (7th Cir. 1996)). The words and photos around them are protected. So the facts of any recipe can open. A cook
with the right to share the words can open them too. Counsel review is owed before launch (`016-FR-050`).

_(Added 2026-11-03, owner ruling O5, ADR-0082.)_ **Reading a PUBLIC recipe or collection is never paid for.** The owner,
verbatim: "Our competitors rely on making users pay to access any recipe. I want to undercut them and I believe recipes
are like a library and so I want people to find public and creator recipes on our app over all others." No Pro plan or
other paywall ever applies to reading a public recipe or a public collection, signed in or signed out. Pro sells
private capacity and tools, never access. A creator can also list a PRIVATE recipe or collection for sale (O14c). That is the creator's own sale at the creator's price, and 010, 018 and 026 own the payment. It is not a Commise paywall. Only content the creator owns can be sold (O14d, `012-FR-034a`). It is not a public recipe, so a signed-out reader never sees its
content (FR-008). _(Amended 2026-11-03, owner ruling O14, ADR-0082. Was: "a public or creator recipe", with the chef's paid
content called a separate product.)_ Counsel review is owed before launch (`016-FR-050`).

Everything else stays behind sign-in. The app root still opens on sign-in (`001-FR-045a`). Public pages live on
their own routes, and a person reaches them only through a link or a search result.

### What this feature does

- It defines one rule, **open to the web**, for which recipes anyone can read signed out (section A).
- It gives each open recipe a fast, plain page with the whole recipe on it, and no wall in front of the steps.
- It lets search engines find the pages that are worth indexing, with recipe structured data, canonical addresses,
  sitemaps and robots rules. Thin, new and unchecked pages are kept out of search.
- It makes sharing work on web and mobile. A shared link shows a good preview in chat apps. With the app installed,
  the link opens the app. Without it, the link opens the web page.
- It invites a signed-out reader to sign up, honestly, with no tricks.
- It rests on a licence. The cook grants it at the moment they make a recipe public. It takes pages down fast after a
  notice, a deletion or an erasure.

### What this feature does NOT do

- **It adds no third visibility.** A recipe is still private or public (GR-014). "Open to the web" comes from facts
  that already exist, plus the licence and the rights label (`016-FR-015c`). Public means public on the web.
- **It opens no full copy of words the cook did not write.** _(Amended 2026-11-03, owner rulings, ADR-0082.)_ A copy of
  a web page, a book or a paid site keeps its full text private, for the cook and their household. Its public form is
  a facts card. A facts card can be indexed under the same public rule as any page (FR-020). _(Amended 2026-11-03,
  owner ruling, ADR-0082.)_ A page's own stated licence is indexable too (owner ruling O8, FR-014f).
- **It does not ship the Commise version at launch.** Commise does not publish an AI rewrite of another site's recipe
  (FR-014h). That is a launch decision and a later gated pilot, not a legal bar.
- **It adds one signed-out search: the chef directory** (amended 2026-10-29, Q2). A signed-out visitor otherwise
  reads one page at a time, and there is no signed-out feed or recipe search. The directory lists chefs and their
  public work only, never paid content and never linked cards. The sitemap lists addresses only.
- **It does not change the front door.** Opening the app, or the web root, with no link still lands on sign-in.
- **It does not promise that a search engine forgets at once.** We stop serving the page, tell the engines that listen,
  and drop it from our sitemap. We cannot force any engine's index or any chat app's preview cache (FR-074).

### Words used in this spec

| Word                     | Meaning                                                                                                                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Open recipe**          | A recipe that meets the open-to-the-web rule (FR-002). Anyone can read it signed out                                                                                                                                                                                                                  |
| **Indexable**            | An open recipe, a facts card or a creator page that search engines are allowed to index (FR-020). Every other public page says `noindex`                                                                                                                                                              |
| **Public page**          | The signed-out web page for one open recipe or one creator page                                                                                                                                                                                                                                       |
| **Public view**          | The app's read-only screen for an open recipe or a creator page, reached by a link while signed out                                                                                                                                                                                                   |
| **Facts card**           | _(Added 2026-11-03, ADR-0082.)_ The public form of a recipe whose words the cook cannot share. It shows the recipe's facts and a link or a credit, never the source's words or photos. Anyone can read it signed out. It can be indexed (FR-020). It has two kinds: the linked card and the book card |
| **Linked card**          | The facts card for a recipe copied from a web page (FR-014a). It ends with a link to the original                                                                                                                                                                                                     |
| **Book card**            | _(Added 2026-11-03, ADR-0082.)_ The facts card for a recipe from a cookbook, magazine or paid site (FR-004). It credits the book or the site                                                                                                                                                          |
| **Source card**          | _(Amended 2026-11-03.)_ The narrow form of a linked card: the title, the site's name and a link only. It is used only for a site that opted out, a site past its cap, or an excluded site (FR-014e)                                                                                                   |
| **Public domain record** | _(Added 2026-11-03.)_ The curator's record that lets public domain text open (FR-006, `016-FR-015k`)                                                                                                                                                                                                  |
| **Not available**        | The one answer for any address that is not an open recipe, a public facts card, a source card or an active creator page. It never says why                                                                                                                                                            |
| **Share link**           | The canonical address of a public page, plus an opaque share mark (FR-031)                                                                                                                                                                                                                            |
| **Settle period**        | The 72 hours after a recipe first becomes open, or after its checked content changes. During it, the page is open but not indexable                                                                                                                                                                   |
| **Exit event**           | Anything that takes a recipe or a creator page out of the open set, or changes what its page shows (FR-007)                                                                                                                                                                                           |
| **Purge bound**          | How fast an exit event must show on every public surface (FR-061)                                                                                                                                                                                                                                     |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A friend with no account opens a shared recipe (Priority: P1)

Maya made her own lentil soup recipe public. She shares it from her phone to her brother Sam in a chat app. The chat
shows a card with the soup's photo, its title and "A recipe on Commise". Sam has no account and no app. He taps the
link. A web page opens with the whole recipe: the photo, the ingredients with amounts, every step, the times and the
servings. A small "Sign up" control sits in the header. Below the recipe, a short card says what an account adds.
Nothing covers the recipe, and nothing asks him to sign up before he can read it.

**Why this priority**: This is the virality loop the owner named. Without it, every share ends at a sign-in form.

**Independent Test**: As a signed-out browser, open the public page of an open recipe. Every ingredient and every step
is visible. The response sets no cookie. The same address requested with a valid token returns the same bytes.

**Acceptance Scenarios**:

1. **Given** an open recipe, **When** a signed-out visitor opens its share link on the web, **Then** the page shows the
   whole recipe, with no step, ingredient or amount hidden or blurred.
2. **Given** an open recipe, **When** its page is requested with and without a sign-in token, **Then** the two
   responses are the same bytes, and neither sets a cookie (FR-012, FR-101).
3. **Given** each of these: a private recipe, a draft, a deleted recipe, a recipe in review, a not-approved recipe, a
   private book or paid-site recipe, and an address that never existed. **When** a signed-out visitor opens each,
   **Then** each gets the same not-available answer, with the same status, words and preview card (FR-013).
4. **Given** a public recipe copied from a web page, **When** a signed-out visitor opens its share link, **Then** they
   see the linked card: the facts, our ingredient list and a link to the original. They see none of the source's
   method, headnote or photos (FR-003, FR-014a). The page can be indexed (FR-020). _(Amended 2026-11-03, ADR-0082,
   owner ruling O2.)_
   For a site that opted out or is past its cap, they see the source card only (FR-014e).
5. **Given** a phone with the Commise app installed and nobody signed in, **When** the visitor taps the share link,
   **Then** the app opens the public view of that recipe. Closing it lands on sign-in (FR-016).
6. **Given** a phone with the app installed and the visitor signed in, **When** they tap the link, **Then** the app
   opens that recipe with every action a signed-in reader has.
7. **Given** an open recipe that its cook later makes private, **When** Sam opens the old link, **Then** he gets the
   not-available answer within the purge bound (FR-061).

---

### User Story 2 - A cook shares a recipe from web or mobile (Priority: P1)

Maya taps "Share" on her recipe. On her phone the system share sheet opens with the link and the title. On the web,
her browser's share panel opens where it has one, and otherwise the link is copied and she sees "Link copied". The
link she sends is the recipe's canonical address with a share mark on the end.

When she taps "Share" on a private recipe, the control says only she can see it, and that public recipes can be
shared. It does not push her to make it public.

**Why this priority**: The other half of the loop. Sharing has to be one tap, on both platforms. The preview has to
look good in the chat apps people use (user need FR-018 in
[findingRecipes.md](../../docs/research/userNeeds/findingRecipes.md)).

**Independent Test**: Share an open recipe from the web and from each mobile platform. Paste each link into a chat
app and check the preview card. Share a private recipe and check that no link is offered.

**Acceptance Scenarios**:

1. **Given** an open recipe, **When** the owner or any reader taps Share on mobile, **Then** the system share sheet
   opens with the canonical address, a share mark and the title (FR-030).
2. **Given** an open recipe on a browser with a share panel, **When** the reader taps Share, **Then** the panel opens.
   On a browser without one, the link is copied and a "Link copied" message is shown. If the copy fails, the link is shown so it
   can be copied by hand.
3. **Given** a shared link pasted into a chat app, **When** the app builds its preview, **Then** the preview shows the
   recipe's title, a short description and an image. The image comes from its cover photo. With no photo, it is a
   Commise card (FR-033).
4. **Given** a private recipe, a draft or a recipe in review, **When** its owner taps Share, **Then** no link is
   offered. The control says, in neutral words, that only they can see it, with no pre-selected action (FR-032).
5. **Given** a public recipe copied from a web page, **When** a signed-in reader taps Share, **Then** the link opens
   the linked card for everyone, signed in or out (FR-014a). The full copy stays with its owner and their household
   (FR-014c). _(Amended 2026-11-03, ADR-0082.)_
6. **Given** a cook with no network on mobile, **When** they tap Share on an open recipe, **Then** the share sheet
   still opens, because the address does not need the server.

---

### User Story 3 - A cook makes a recipe public and grants the licence (Priority: P1)

Maya publishes her first recipe as Public. Before the publish completes, a short panel says in plain words what Public
means: anyone with the link can read it, even without an account, it can appear in search results, and other cooks
can save their own copy. It says she keeps ownership and gives Commise permission to show it. It links the full terms.
She accepts once. The panel comes back only after the licence changes. In her settings she can turn off "Show my
public recipes in search engines". Her recipes stay readable by link, and search engines are told not to index them.

**Why this priority**: Spec 016 found that nothing gives Commise the right to show a cook's recipe (016, finding 1).
Showing it to the whole web needs that right first. Without this story, nothing in this feature can ship.

**Independent Test**: Publish as Public with no licence on record: the panel appears, and the recipe is not open until
the cook accepts. Accept, then publish a second recipe: no panel. Turn the search setting off: open pages answer
`noindex` and leave the sitemap.

**Acceptance Scenarios**:

1. **Given** a cook who has not accepted the current licence version, **When** they publish a recipe as Public or switch
   one to Public, **Then** the plain-words panel is shown before the change completes (FR-040).
2. **Given** the panel, **When** the cook accepts, **Then** the acceptance is recorded with the licence version, the time
   and the locale, and the recipe goes on through the normal publish path (020's check included).
3. **Given** the panel, **When** the cook declines, **Then** nothing is published as Public. They can keep the recipe as
   a draft. With a free slot, they can keep it private (ADR-0073).
4. **Given** a cook whose accepted licence version is older than the current one, **When** the current one widens what
   Commise can do, **Then** their recipes stop being open until they accept it (FR-041).
5. **Given** a cook who turns the search setting off, **When** any of their open pages is requested, **Then** it answers
   `noindex`, and it leaves the sitemap within an hour. Their pages stay readable by link (FR-043).

---

### User Story 4 - A cook's recipe shows up in a search engine (Priority: P2)

Three days after Maya's soup became open, a search engine crawls it. The page has recipe structured data that matches
what is on the page. It has a canonical address and is listed in the sitemap. Someone searching for lentil soup sees
the photo and the times in the result, and lands on the page.

**Why this priority**: Search is the cheapest long-run channel for recipes. It is not a launch channel, and results
come slowly, so it ranks below sharing.

**Independent Test**: For an indexable recipe, the page carries valid Recipe structured data with a name and an image.
Every value in it is visible on the page. The page is in the sitemap with an accurate last-modified date. A clone, a
thin recipe and a recipe in its settle period each answer `noindex` and are not in the sitemap.

**Acceptance Scenarios**:

1. **Given** an indexable recipe with a photo, **When** its page is rendered, **Then** it carries schema.org Recipe
   structured data with Google's required properties and only values that are visible on the page (FR-023).
2. **Given** a recipe with no ratings, **When** its structured data is built, **Then** it has no rating at all, not a
   rating of zero (`001-FR-013a`).
3. **Given** a recipe whose nutrition is partial or holds user-entered values, **When** its structured data is built,
   **Then** it carries no nutrition (FR-023).
4. **Given** a recipe that became open less than 72 hours ago, **When** a crawler requests it, **Then** it answers
   `noindex` and is not in the sitemap (FR-022).
5. **Given** a clone, **When** a crawler requests it, **Then** it answers `noindex` and links to the recipe it came from
   while that recipe is open (FR-005).
6. **Given** a sandbox or preview host, **When** any crawler requests any page, **Then** it answers `noindex` and its
   robots rules disallow everything (FR-029).

---

### User Story 5 - A signed-out reader signs up without being tricked (Priority: P2)

Sam likes the soup and taps "Save". A sheet explains that saving needs a free account, with "Sign up" and "Sign in".
He signs up. He comes back to the same recipe, and the app asks him to confirm the save he wanted.

**Why this priority**: Sign-ups are the point of the loop for the business. They must come from a fair offer, because
deceptive patterns are law in our markets (EU DSA Article 25), not a preference.

**Independent Test**: Signed out, tap each account action on a public page. Each opens the sign-up sheet. Complete
sign-up and check the visitor lands back on the same recipe with the action offered again. Check that no overlay,
countdown or pre-ticked box appears anywhere.

**Acceptance Scenarios**:

1. **Given** a signed-out visitor on a public page, **When** they read the whole recipe, **Then** no modal, overlay or
   interstitial appears, and the only sign-up prompts are the header control and one inline card after the recipe
   (FR-050).
2. **Given** a signed-out visitor, **When** they tap an account action, **Then** a sheet explains what an account gives,
   with sign up and sign in side by side, and closing it is one tap (FR-051).
3. **Given** a visitor who signs up from that sheet, **When** sign-up completes, **Then** they return to the same recipe
   and the action they tapped is offered again for one confirmation. It is never done silently (FR-052).
4. **Given** a recipe that left the open set while the visitor was signing up, **When** they return, **Then** they see
   the not-available answer and their new account is unaffected.

---

### User Story 6 - A visitor opens a creator's page (Priority: P2)

Maya has a creator profile, `@mayacooks`. Her brother opens `commise.app/@mayacooks` signed out. He sees her avatar,
display name, bio and follower count, and her open recipes in pages. He does not see the recipes she imported from
websites, or anything she keeps private.

**Why this priority**: Spec 012 needs this page signed out, and creator pages give the recipe pages a home. It depends
on 012 being built, so it cannot be P1.

**Independent Test**: Open an active creator page signed out. Only open recipes appear. Open a deactivated or
suspended creator page: it gets the not-available answer.

**Acceptance Scenarios**:

1. **Given** an active creator profile, **When** a signed-out visitor opens `/@handle`, **Then** the page shows the
   profile fields the cook set and their open recipes, at most 24 per page (FR-015).
2. **Given** a creator whose public recipes are all imported, **When** the page is requested, **Then** it lists no
   recipes, says they have none to show yet, and answers `noindex` (FR-025).
3. **Given** a deactivated (`012-FR-004`) or suspended (`012-FR-020`) profile, **When** anyone signed out opens it,
   **Then** they get the not-available answer.
4. **Given** a creator who changed their handle, **When** someone opens the old address within 14 days, **Then** they
   are redirected to the new one. After that, the old address is not available, and the old handle is never given to
   another account (FR-073).

---

### User Story 7 - A cook takes a recipe down, or erases their account (Priority: P2)

Maya deletes her soup. Within minutes the page and the app's public view say not available. The preview card no
longer shows the recipe. The address leaves the sitemap, and the search engines that accept change notices are told.
Later she erases her account. Every public page of hers goes the same way. Her photos and avatar stop being served,
and her handle is retired.

**Why this priority**: A public page that outlives the cook's choice is a privacy failure and a GDPR failure.

**Independent Test**: Trigger each exit event in FR-007 on an indexable recipe. Measure the time until the web page,
the app view, the preview image and the CDN copy all answer not available.

**Acceptance Scenarios**:

1. **Given** an open recipe, **When** any exit event happens, **Then** every public surface answers not available within
   the purge bound (FR-061).
2. **Given** an indexable recipe that is deleted, **When** the exit is processed, **Then** its address leaves the
   sitemap and a removal notice goes to every search engine that accepts change notices (FR-074).
3. **Given** a cook who erases their account, **When** erasure runs, **Then** every page of theirs, every preview image,
   every photo of theirs on a public page, and their avatar stop being served within the purge bound (FR-072).
4. **Given** a public recipe of Maya's that its owner edits, **When** 020 checks the new content, **Then** the page
   keeps showing the last approved version until the new content is allowed, and never shows the new text before that
   (FR-007, `020-FR-064`). _(amended 2026-11-03, owner ruling O10, ADR-0082)_

---

### User Story 8 - Someone reports a public page (Priority: P3)

A publisher sees their recipe copied on a public page. They tap "Report" at the bottom of the page. The notice form
opens without an account. A reviewer decides within 016's time limit. If the recipe is removed, every public surface
reflects it within the purge bound.

**Why this priority**: The notice process belongs to 016. This story only makes sure every public surface leads to it
and obeys its result.

**Independent Test**: From a public page and from the app's public view, follow Report to 016's notice form signed
out. Action a notice and measure the time until the page is not available.

**Acceptance Scenarios**:

1. **Given** any public page or public view, **When** a signed-out visitor taps Report, **Then** 016's notice form opens
   with the page's address filled in (FR-045).
2. **Given** a notice that a reviewer actions, **When** the decision is saved, **Then** the recipe leaves the open set
   and every public surface reflects it within the purge bound (FR-046).

---

### User Story 9 - The team sees whether sharing and search work (Priority: P3)

The operator sees, by week: public page views, shares by platform, share links opened, and sign-ups that started on a
public page, with and without a share mark. Nothing in it can identify a visitor.

**Why this priority**: The business plan cannot tell whether this channel works without these numbers. No targets are
set, because no recipe-app benchmark exists for them.

**Independent Test**: Run a scripted visit, share and sign-up. Each appears once in the weekly counts. No stored event
carries a visitor identifier, an address or a full query string.

**Acceptance Scenarios**:

1. **Given** a signed-out page view, **When** it is counted, **Then** it records the page kind, the platform and whether
   a share mark was present, and nothing that identifies the visitor (FR-080).
2. **Given** a sign-up that started on a public page, **When** the account is created, **Then** it records that fact and
   whether a share mark was present, once (FR-082).
3. **Given** the app's analytics rule that drops every query parameter, **When** share marks are counted, **Then** that
   rule is unchanged (FR-083).

---

### User Story 10 - A scraper cannot take the corpus (Priority: P3)

A bot requests thousands of public pages a minute from one address. After a short burst it gets `429` with a
`Retry-After`. A search engine's verified crawler keeps crawling. No signed-out endpoint returns more than one recipe,
except a creator page, which returns at most 24.

**Why this priority**: The terms do not bind a signed-out scraper, because the scraper never accepted them (016,
finding 2). Only the shape of the surface and the limits protect the corpus.

**Independent Test**: Load-test public pages from one address and check the limit engages. Repeat as a verified
crawler and check it does not. List every signed-out endpoint and check none returns more than one recipe, except the
creator page.

**Acceptance Scenarios**:

1. **Given** one client address requesting public pages far faster than a person reads, **When** it passes the limit,
   **Then** it gets `429` with `Retry-After` (FR-063).
2. **Given** a search engine crawler verified by the engine's published method, **When** it crawls at its normal rate,
   **Then** it is not limited off the site (FR-064).
3. **Given** every signed-out endpoint and page, **When** each is listed, **Then** none returns more than one recipe,
   except a creator page, which returns at most 24 per page (FR-060).

---

### Edge Cases

- **A shared recipe goes into review after an edit.** _(amended 2026-11-03, owner ruling O10, ADR-0082)_ 020 checks the new content. A friend who opens the link
  meanwhile sees the last approved version. That content passed 020's check earlier, so it is not unchecked. The
  friend cannot tell an edit is in review. This avoids the Kitchen Stories failure in user need FR-018. If no approved
  version exists, the friend gets not available, the same answer as for a private recipe.
- **A cook makes an open recipe private, then public again.** It is open again only after 020 allows it. If its
  checked content changed, a new settle period starts.
- **Two people share the same recipe.** Each share has its own share mark. The page and its cache are the same for
  both, because the cache ignores the share mark (FR-062).
- **A link with a stale slug.** The title changed after the link was sent. The address still works and redirects
  permanently to the canonical slug (FR-010).
- **A cook with no creator profile.** Their open recipe has no author name on the page, and its structured data has no
  author. The page never falls back to the name from the sign-in provider (FR-024).
- **A creator renames their handle.** Recipe addresses do not contain the handle, so they do not change.
- **A clone whose original is deleted.** If the clone meets the rule, it stays open by link. Its "adapted from" link
  goes away with the original (`001-FR-005d`).
- **The original cook erases their account.** Clones by others survive with the original cook's attribution stripped
  (`001-FR-005d`). They are noindex anyway.
- **A visitor arrives from an in-app browser** (Instagram, TikTok, Facebook) that does not open universal links. The
  page offers "Open in the app" (FR-036).
- **A visitor installs the app from the page.** On Android, the install referrer carries the recipe address, so the
  app can offer the recipe after sign-up. On iOS no privacy-safe way exists to pass it through an install, so the page
  says "after you install, tap the link again". We never read the clipboard and never fingerprint (FR-038).
- **A chat app cached an old preview.** We cannot clear another company's cache. The preview image address changes
  when the recipe's preview content changes, so a fresh share gets a fresh card, and an exited recipe's image address
  answers not available (FR-034).
- **The recipe service is down.** For a page that is still open, the CDN can serve its last good copy for up to one
  hour. A purge always wins over that copy (FR-065).
- **A recipe description contains a web address.** It is shown as plain text, not a link, so public pages cannot be
  used to sell links (FR-047).
- **A creator page for a cook with a minor's account.** 016 gives a minor no publication surface (`016-FR-009`), so
  they have no open recipe to show.
- **A cook declines a later licence version.** Their recipes stop being open. They stay public to signed-in users only
  if 016 allows display under the version they accepted. 016 decides that, not this feature (FR-041).
- **A search engine indexed a page before its cook turned the search setting off.** The page answers `noindex` from
  then on and leaves the sitemap. The engine drops it on its next crawl.
- **Sandbox Clerk and preview hosts.** No preview host is associated with the app, and every preview answers
  `noindex` (FR-029).
- **A site reaches its cap** _(added 2026-11-03, ADR-0082)_. The cards already public stay. The next card from that
  site shows the source card form, and so does every later one (FR-014e). The cap counts over time, so deleting a card
  does not free a place for a new one.
- **A site opts out after its cards are public.** Each of its cards falls back to the source card form within the
  purge bound (FR-007).
- **A public domain record is corrected.** A corrected record that no longer passes `016-FR-015k` closes the text
  within the purge bound (FR-007). The cook who saved it keeps their copy.
- **A cook turns CC BY off.** New readers see the Commise licence from then on. Copies made while CC BY was on keep
  their CC BY terms, and nobody can recall them (FR-040b).
- **A family recipe is a copied blog post.** 020 still checks it before it is public (`020-FR-001`). A label does
  not skip the check.

## Clarifications

### Session 2026-10-27

- **The ruling.** Owner, verbatim: "Let's add a feature and spec for indexing and sharing as you note." The owner accepted
  these points. Signed-out reading of public recipes that cooks wrote themselves, and of creator pages. Recipe
  structured data. Everything else behind sign-in. The app still opens on sign-in. Imported third-party recipes stay
  private. A shared link opens for a friend with no account.
- **Reading: "imported third-party recipes stay private, as they already are."** This is exact for book and paid-site
  imports, which are private-only. A recipe imported from a public website is public to signed-in users today (C-004),
  so it is not private. This spec reads the ruling as: an imported recipe is never open to the web and never indexed,
  and C-004's signed-in rule for it is unchanged. A signed-out friend sees the source card, which links to the
  original site and copies none of the recipe (FR-003, FR-014). _(Replaced 2026-11-03, owner rulings, ADR-0082.)_
  The 2026-11-03 rulings replace this reading. A signed-out friend now sees the linked card. The source card is kept
  only for a site that opted out or is past its cap (Session 2026-11-03).
- **Reading: clones.** A clone with a substantive edit is partly another cook's work. It opens by link, so sharing
  works, but it is never indexed (FR-005).
- **Reading: Public means on the web.** There is no "public to signed-in users only" choice for a recipe a cook wrote.
  One fewer state is simpler, and the licence moment makes the choice informed. The search setting controls indexing
  only, not who can read (FR-040, FR-043).
- **Reading: one answer for everything not open.** Private, draft, held, deleted, erased and never-existed all get the
  same `404` answer. A separate `410` for deleted pages tells a stranger that a cook deleted a recipe and did not only
  make it private (FR-013).
- **Reading: "ping search engines".** Google retired its sitemap ping endpoint in 2023, and its Indexing API covers
  only job postings and livestreams. So "ping" means: remove the address from our sitemap, answer `404` with `noindex`,
  and send a removal notice through IndexNow to the engines that take it (FR-074).
- **Q1. AI crawlers. RESOLVED 2026-10-27.** The owner chose option B, "Block training only": the robots rules block
  crawlers that only collect AI training data, and allow search and answer crawlers that link back. Robots rules are a
  request that a polite crawler honours, not a control.
- **Q2. What else is outside the ruling. RESOLVED 2026-10-29.** The owner chose "both, but only for public content and
  nothing that's behind a paywall (like a chef selling a collection)". So `018-FR-017`'s chef directory and its search,
  and `012-FR-008`'s public collections on the creator page, are readable signed out, each on its own address, under
  the same rules as public recipes (FR-002 eligibility, rate limits, the content source check). Nothing a chef sells
  is readable signed out: a paid collection, recipe, cookbook or course shows at most its title, cover, price and the
  chef's own description, so a reader can find and buy it, and never its recipes. The directory lists chefs, not
  sites, so it is not the browse-by-site feature `016-FR-030a` forbids.

### Session 2026-10-28

- **The ruling.** Owner, verbatim: "Let's also do the pages for AI recommendation." The aim is that AI answer engines
  can read and cite the public recipe pages. The engines are ChatGPT search, Perplexity, Google's AI Overviews and
  Copilot. This follows Q1: block training-only crawlers, and allow search and answer crawlers.
- **Reading: most of it is already here.** Recipe structured data (FR-023), stable addresses (FR-010), canonical
  tags (FR-026) and sitemaps (FR-027) serve answer engines as they serve search.
  [Google's guide](https://developers.google.com/search/docs/appearance/ai-features) says its AI features need
  nothing beyond normal Search. The amendment adds four things:
    - the whole page without script (FR-011a)
    - a dated crawler list (FR-028a)
    - a fresh `dateModified` (FR-023)
    - measurement that keeps human visits and crawler fetches apart (FR-080a, FR-085a)
- **Reading: no llms.txt here.** A file that lists recipes is a second list beside the sitemap, which FR-060
  forbids. The marketing site's rule is `022-FR-127`.
- **The save route.** `004-FR-053` adds a "Save to Commise" route that the app must open. FR-035 is amended to
  associate it, and nothing else new.

### Session 2026-10-29

- **The rulings.** The owner ruled on recipe rights on 2026-10-29 ([ADR-0077](../../docs/architecture/decisions/0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md)).
  On ownership, verbatim: "we'll need to make sure that we're very, very clear about what chefs own for public recipes
  and don't and who owns the recipes they don't to cover the cases where they copy a public recipe on another site
  without changes." The rest of that ruling is quoted in `016` C-016-005. A recipe imported from someone else's web page
  has exactly two states: private, the full recipe for the cook and their household, or public as a linked card. The
  research behind it is not legal advice, and the card is subject to counsel review.
- **Reading: this closes the gap the 2026-10-27 reading left open.** That reading kept C-004's signed-in rule for an
  `imported_public` recipe "unchanged", so a full copy of a web page stayed readable by every signed-in cook. Now
  other signed-in cooks get the linked card (FR-003, FR-014a). _(Amended 2026-11-03, ADR-0082.)_ Signed-out visitors
  now get the linked card too. The source card is kept only for an opted-out or capped site (FR-014, FR-014e).
- **Reading: the card's list is the owner's list.** The research also suggested short step titles. The owner's list
  does not include them, so the card shows the step count only. The 2026-11-03 rulings keep this list unchanged.
- **Reading: open to the web reads the rights label.** _(Amended 2026-11-03, owner rulings, ADR-0082.)_ This reading
  first kept family recipes and public domain text off the web. The 2026-11-03 rulings open both. For a family or
  friend recipe, the cook's statement must say the giver agreed to sharing "publicly, on Commise and on the web".
  Then it can open (FR-002). Public domain text opens with a record that passes `016-FR-015k` (FR-006).
- **Reading: the ownership line follows the label** (FR-040). This fixes the research's gap G2.

### Session 2026-11-03

- **The rulings.** The owner ruled on recipe rights again on 2026-11-03. ADR-0082 records them ("Recipes are an open
  library: facts, cooks' words and gated public domain open to the web"). It amends ADR-0077, ADR-0072, ADR-0023,
  ADR-0073 and ADR-0052. The rulings, in this spec's terms:
    - **Facts are free, signed out.** The facts of any public recipe can be read by anyone, signed out. The linked card
      (FR-014a) is now the signed-out answer for a copied web page. Its field list does not grow. [Law] Nobody owns a
      recipe's facts (17 U.S.C. §102(b), Feist, Copyright Office Circular 33, Publications International v.
      Meredith). The same holds in the UK, EU, Canada and Australia for bare functional steps.
    - **Words open only with the right to share them.** A recipe opens in full with one of four labels: Written by
      you, Adapted by you, From a family member or friend, or Public domain. A clone of one of those opens too (FR-002).
      [Law] Where a recipe came from is not the test. What we show is.
    - **Family recipes are open.** The giver's permission must cover the open web.
    - **Public domain opens under one gate.** `016-FR-015k` holds the rule. It replaces the earlier "open both" reading
      (authors dead 70 years) (FR-006).
    - **Book and paid-site recipes get a facts card** (FR-004). The cook's full copy stays private.
    - _(Added 2026-11-03, second round, ADR-0082.)_ **Facts cards are indexable** (O2, FR-014g, FR-020). **Every
      indexable page carries our own structured data, one canonical address and a sitemap place** (O3, FR-023,
      FR-026, FR-027). **One canonical page wins for one dish from one source page** (O4, FR-026a). **A public card uses
      no private slot** (O1, FR-014d). **Reading is never paid for** (O5, Overview). Counsel review is owed before
      launch (`016-FR-050`).
    - **The Commise version is not at launch** (FR-014h).
    - **A CC BY 4.0 choice**, opt-in, for a recipe the cook wrote (FR-040a).
- **Reading: visibility stays binary.** A book or paid-site recipe now has the same two states as a copied web page.
  Private is the cook's full copy. Public is the facts card only. This keeps GR-014's binary visibility. It adds no
  third state. "Never public" in older text now reads "never public in full".
- **Reading: the label decides, not the source type.** Public domain text is `imported_public` under the curator
  grant. So is a page with a stated licence (FR-014f). A rule keyed on `imported_public` alone closes both. Every
  rule here reads the rights label (`016-FR-015c`, `016-FR-015d`). Which source type an adapted recipe gets is the
  label Policy's decision, and it is plan work.
- **Reading: the cap is counted over time.** [Law, EU and UK] The database right protects the contents of a site's
  collection, not its words (Directive 96/9/EC Art. 7 and Art. 7(5), UK SI 1997/3032, CV-Online Latvia v Melons,
  C-762/19). Rewording does not cure it. So the per-site cap counts every public card and any later Commise version,
  together and over time (FR-014e). [House rule] It applies to every site from day one, because we cannot tell where a
  site was made. Counsel review is owed before launch (`016-FR-050`).
- **Reading: facts cards are indexable** _(amended 2026-11-03, owner ruling, ADR-0082)_. The earlier `noindex`
  house rule is removed. The founder, verbatim: "Our competitors rely on making users pay to access any recipe. I want
  to undercut them and I believe recipes are like a library and so I want people to find public and creator recipes on
  our app over all others." What stays: the facts-only field list, the per-site and per-source caps counted over time,
  a visible credit and link to the source, and no source prose, headnote or photo. Indexing is not a separate
  permission. It follows the public rule (FR-014g, FR-020). [House rule] Counsel review is owed before launch
  (`016-FR-050`).
- **Reading: no paywall on reading** _(owner ruling O5, 2026-11-03, ADR-0082. Amended 2026-11-03, owner ruling O14)_. No
  Pro or other paywall applies to reading a PUBLIC recipe or a PUBLIC collection, signed in or out. Pro sells private
  capacity and tools, never access. A creator can list PRIVATE recipes and collections for sale (`012-FR-034a`, O14c).
  That is the creator's own sale, run by 010, 018 and 026 (FR-008). Counsel review is owed before launch (`016-FR-050`).
- **Reading: public domain pages are indexable** _(amended 2026-11-03, owner ruling O8, ADR-0082)_. This was a default
  the founder could change. It is now decided (FR-020).
- **Reading: "signed in" was never the legal line.** Signed in and signed out are the same "public" in law. The
  signed-in-only rule on the linked card is removed (FR-014g).
- **Decided on 2026-11-03** _(amended 2026-11-03, owner rulings O6, O7, O8, O12, ADR-0082)_. These were open for the
  founder. They are now settled, and no open business question remains here:
    - O6: an aggregator site gets NO public facts cards (FR-014e).
    - O7: a creator page lists only recipes the cook wrote or adapted, never facts cards (FR-015).
    - O8: a full page shown under its own stated licence is indexable, and so are public domain pages (FR-014f, FR-020).
    - O12: no public bulk download and no public API of the open layers for now (FR-060, FR-103, `016-FR-033`).

### Session 2026-11-04

- **Facts card rating.** The founder ruled on 2026-11-04 that the facts card shows Commise's own rating and rating
  count. It uses the detail page's rating card for another cook's recipe. Comments stay off the card (FR-014a).
- **Facts card unread lines.** The founder ruled on 2026-11-04 that the card leaves out lines it cannot show as facts.
  The count goes to the card as `unreadLineCount`, and the card says how many are on the site or in the book only
  (FR-014b).
- **Save a copy is safe to retry.** The founder ruled on 2026-11-04, "Build it now," that a retry with the same
  idempotency key returns the first copy (FR-005b).

## Requirements _(mandatory)_

### Functional Requirements

#### A. What is open to the web

- **FR-001**: One rule, **open to the web**, MUST decide whether anyone can read a recipe signed out. It MUST be one
  pure Specification with one SQL form, composed with the read rule that already includes 020's hold
  (`isRecipeViewableBy`, `020-FR-018`). Every surface MUST read it, and no surface decides on its own. The surfaces
  are the public page, the app's public view, preview tags, structured data, sitemaps and IndexNow notices. They also
  include the 012 creator page list, the 012 embed widget, and any public endpoint. It is a derived fact, never a
  stored visibility value (GR-014).
  _(Amended 2026-11-03, owner ruling, ADR-0082.)_ The open-to-web Specification MUST import 020's hold Specification
  (`020-FR-057`). So no public route compiles, and none ships, before the hold is in the read rule (`020-FR-062`).
  Every input it cannot read counts as closed (`020-FR-059`). While an edit is checking or in review, a public surface
  MUST NOT serve the new content, and MUST serve the last approved version instead (`020-FR-064`, owner ruling O10,
  2026-11-03, ADR-0082).
- **FR-002**: A recipe is open to the web only when all of these hold:
    1. Its visibility is public.
    2. It is published, not a draft (`001-FR-003b`).
    3. It is not deleted.
    4. The read rule lets an anonymous viewer see it now. A recipe that is checking, in review or not approved under
       020 fails this.
    5. Its rights label (`016-FR-015c`, derived by `016-FR-015d`) is one of these, or it is a clone of a recipe with
       one of these:
        - "Written by you"
        - "Adapted by you", in the cook's own words, with credit. A rewrite of a web page, a cookbook, a magazine or
          a paid site counts. The method must be rewritten, not trimmed (`016-FR-015b`). An AI rewrite is not the
          cook's own words (`016-FR-015i`).
        - "From a family member or friend", where the cook's statement says the giver agreed to sharing "publicly, on
          Commise and on the web". Naming the giver is optional and needs the giver's permission.
        - "Public domain", where its record passes `016-FR-015k` (FR-006)

        _(Amended 2026-11-03, owner rulings, ADR-0082.)_ This rule reads the label, not the source type. It used to
        require `user_created` with "Written by you" or "Adapted by you", and it kept family and public domain recipes
        off the web. Public domain text is `imported_public` under the curator grant, so a source-type test cannot
        open it. [Law] Where a recipe came from is not the test. What we show is. Counsel review is owed before launch
        (`016-FR-050`).

        _(amended 2026-11-03, owner ruling O16, ADR-0082)_ A recipe the cook imported from their own page with "This
        is my recipe, from my site or account" (`004-FR-014a` statement 1a) is "Written by you". Once 020 allows it, it
        is open to the web in full: its own method text, the owner's own photos (each with its photo statement,
        `026-FR-004`), its structured data, and indexing under FR-010a's canonical rule. This rule reads the label and rule 4. It never reads the
        site claim. A claim only clears one hit inside 020 (`020-FR-012g`). Counsel review is owed before launch
        (`016-FR-050`).

    6. Its owner accepted the licence version that covers showing it on the web (FR-040, FR-041).
    7. Its owner's account is active: not suspended, not terminated (`016-FR-020`), not closed and not erased.
    8. No decision under 016 removed or restricted it.
- **FR-003** _(amended 2026-10-29, owner ruling, ADR-0077, and 2026-11-03, owner rulings, ADR-0082)_: A public
  recipe with the label "Copied from a public web page" MUST NOT be open to the web in full and MUST NOT be indexed.
  Its public form is the **linked card** (FR-014a). Every reader other than its owner and the owner's household gets
  that card, signed in or signed out. FR-014f is the one exception. A site that opted out or is past its cap gets the
  source card (FR-014e). This replaces C-004's "Always public with source attribution", which let a full copy of a
  web page go public. The 2026-11-03 change: a signed-out visitor used to get the source card, with no ingredients.
  Now they get the linked card.
    - [Law] `imported_public` means "copied from a publicly reachable page". That page is fully protected. It is the
      opposite of public domain (Berne Art. 5(2), 17 U.S.C. §102).
    - Counsel review is owed before launch (`016-FR-050`).
- **FR-004** _(amended 2026-11-03, owner rulings, ADR-0082)_: A recipe with the label "From a cookbook, magazine or
  paid site" (`016-FR-015c` label 4) has the same two states as a copied web page. Its usual intake channels are
  `imported_physical` and `imported_paid`, but the label decides, not the channel. A photographed family card is
  `imported_physical` and can still carry the family label, and then it follows FR-002 like any recipe. The two
  states are:
    - **Private**: the cook's full copy, for the cook and their household. It never goes public in full.
    - **Public**: the **book card**, a facts card only. Anyone can read it signed out. It can be indexed (FR-020). Its
      structured data follows FR-023. _(Amended 2026-11-03, owner ruling, ADR-0082.)_

    The book card has the linked card's field list (FR-014a) and no prose, headnote or photo from the source (FR-014b).
    In place of the site link it credits the book (title, author, publisher) or the paid site. These rules hold:
    - It obeys a per-source cap counted over time: per book by ISBN or title, and per paid site (FR-014e).
    - It MUST NOT be shown in the book's order, or gathered as a book's collection. No surface lists, browses, filters
      or searches book cards by book or site.
    - Our servers never fetch a paid site (`004-FR-014`).
    - The cook can also publish their own **Adapted by you** version, in their own words with credit. That version is
      judged by FR-002 like any recipe.

    This replaces "private-only, never on any public surface". [Law] The facts are free and the words are not (17
    U.S.C. §102(b), Feist). A paid site's terms bind the cook who accepted them, not Commise. The book card's words
    and the per-source cap are plan work. Counsel review is owed before launch (`016-FR-050`).

- **FR-005**: A clone (`cloned_from_id` set) MUST be judged by FR-002 like any recipe. A clone that is open MUST be
  `noindex` and MUST be left out of sitemaps. While the recipe it came from is open, the clone MUST show an "adapted
  from" link to it. A clone of a linked card or a book card copies only what the card shows (FR-014c). Its public form
  is a facts card too, and it is never open in full. A clone of an open recipe (FR-002 rule 5) can be open. _(Amended
  2026-11-03, ADR-0082.)_ This replaces "a clone of an `imported_public` recipe is never open". A clone of public
  domain text is `imported_public` too, and it opens under rule 5.
- **FR-005b** _(added 2026-11-04, founder ruling)_: A "Save a copy" request MUST be safe to retry. The client MUST send
  an idempotency key with each request. A retry with the same key MUST return the first copy and MUST NOT make a second
  one. This covers the copy in FR-014c. The scope and lifetime of the key are plan work.
- **FR-006** _(amended 2026-11-03, owner rulings, ADR-0082)_: Text imported under the curator grant (ADR-0023 §1, as
  amended by ADR-0082) MUST be open to the web in full only while its **public domain record** passes `016-FR-015k`.
  The label "Public domain" is derived from the grant plus a passing record (`016-FR-015d`). There is no new
  `sourceType` value. Without a passing record the text is a copied page and follows FR-003.
    - **The gate.** `016-FR-015k` is the one authority for the rule. It rolls forward each 1 January. In outline, it has
      three tests. The text was first published 1930 or earlier (as of 2026). Every named author, translator and
      illustrator died 1945 or earlier (as of 2026). No author is recorded as "mort pour la France". For an anonymous, corporate or test-kitchen book, the
      publication test alone is enough. This spec does not restate the years as a rule.
    - **The record.** The curator records it per book or edition. It holds these fields:
        - the first publication year and place
        - each creator, with their role (author, translator or illustrator) and death year, or "no named author"
        - the "mort pour la France" check, per creator
        - the edition used
        - the markets checked
        - who checked, and when
        - the rule version it was judged under

        Where the record is stored is plan work, because ADR-0023's grant is a token scope and not a row.

    - **The old text only.** The page shows the old edition's text. It leaves out modern notes, introductions and a
      modern edition's layout.
    - **The page shows its basis.** For example: "Public domain: first published 1919, author died 1915". The old text
      carries the CC Public Domain Mark. Commise's own added notes on the page are CC0 1.0 (FR-040b).
    - **Indexing.** A public domain page is indexable under FR-020 by default. That is a search-quality choice, not a
      legal bar, and the founder can change it.
    - **Counsel.** Counsel checks the rule table once before the first public domain page, and again each year
      (FR-095).

    This replaces "MUST NOT be open" and "a separate feature". [Law] The gate is stricter than US law needs. The open
    web cannot be gated by market, so one global rule is the safe one (17 U.S.C. §303, §304, EU Term Directive
    2006/116/EC, French CPI L123-10). Counsel review is owed before launch (`016-FR-050`).

- **FR-007**: These are the **exit events**. Each MUST take effect on every public surface within the purge bound
  (FR-061):
    - visibility set to private, or the recipe set back to draft
    - the recipe deleted, or the account closed or erased
    - the checked content or source statement changed, which starts a new 020 check (`020-FR-001`) _(amended 2026-11-03, owner ruling O10, ADR-0082)_. For an edit with an approved earlier version, this one changes the
      page to that version instead of removing it. Without one, it removes the page.
    - a 016 decision that removes or restricts it, or a suspension or termination of the account
    - the owner's licence acceptance no longer covering web display (FR-041)
    - for a creator page, the profile deactivated, suspended or its handle changed
    - _(added 2026-11-03, ADR-0082)_ a public domain record that no longer passes `016-FR-015k`
    - _(added 2026-11-03, ADR-0082)_ a site that opts out, passes its cap or is excluded. Its facts cards fall back
      to the source card form (FR-014e). This one changes the page instead of removing it.
    - _(added 2026-11-03, ADR-0082)_ a change of the recipe's licence choice (FR-040a). This one changes the page.
    - any change to what the page shows, such as an edit to a field that 020 does not check, a new photo order or a
      new rating total. This one refreshes the page instead of removing it.
- **FR-008** _(amended 2026-10-29, owner ruling, Q2)_: The chef directory and its search (`018-FR-017`), and public
  collection pages (`012-FR-008`), MUST be readable signed out, each on its own address, under the same rules as
  public recipes. Nothing a chef sells is readable signed out: a paid item shows at most its title, cover, price and
  the chef's own description, never its recipes or lessons (`026-FR-015`). The directory never lists linked cards.
  A chef's own page is a creator page and follows section B.

#### B. Public pages, the app's public view, and their states

- **FR-010**: Each open recipe MUST have one public page at one canonical address on `commise.app`, on its own route,
  never the app root. The address MUST be built from the recipe's id and a slug from its title. It MUST NOT contain the
  cook's handle, so a handle change never breaks it. A wrong or stale slug MUST redirect permanently to the canonical
  one. Whether the path carries a locale is a plan decision. Either way there is one canonical address per recipe.
- **FR-010a** _(added 2026-10-29, owner ruling Q2 on [026](../026-chef-spaces/spec.md): "Their blog")_: A chef chooses a
  **Home**, their blog or Commise (`026-FR-006`). Home starts as the blog. While Home is the blog, an open recipe that
  has an origin on the chef's claimed site (`004-FR-053a`) MUST follow these rules. _(amended 2026-11-03, owner ruling
  O16, ADR-0082)_ The origin can also come from a single paste or URL import with the owner statement
  (`004-FR-014a` statement 1a). [House rule] The rules below apply only while the cook holds a live claim on that
  origin's domain. An owner import with no live claim follows FR-010, so its canonical address is on `commise.app`.
  Counsel review is owed before launch (`016-FR-050`). The rules:
    - **The canonical address is the blog post.** The page MUST declare its origin address as its canonical address,
      in place of FR-010's address on `commise.app`. Its own address on `commise.app` still exists and still serves the
      page. FR-026's rule about query parameters still holds.
    - **A "Read on [blog name]" link** MUST show near the top of the page, to the origin address.
    - **Only under a live claim.** If the claim on that domain fails or is removed (`026-FR-001`, `026-FR-009`), the
      canonical address MUST return to `commise.app` within the purge bound (FR-061). A site the chef no longer
      controls MUST NOT receive our canonical address.
    - **Sitemaps leave it out.** A page whose canonical address is the blog MUST NOT be listed in our sitemaps
      (FR-027), because a sitemap lists canonical addresses only.
    - **A change is an exit-or-change event.** A change of Home, or of the claim's state, MUST reach every public
      surface within the purge bound, update the sitemaps within FR-027's hour, and send an IndexNow notice
      (FR-029a).
      A recipe with no origin on a claimed site, and every recipe of a chef whose Home is Commise, follows FR-010.
- **FR-011**: The public page MUST show the whole recipe as the cook wrote it. That is the title, photos,
  description, servings, and the prep, cook and total times. It is also the difficulty, if set (`001-FR-001b`), every
  ingredient line with its amount, every step, the tags and the cuisine. With at least one rating, it shows the rating
  total and count. With none, it shows no average (`001-FR-013a`). Partial nutrition is shown with its honest partial
  flag (`001-FR-007a`). No part of the recipe is hidden, cut short or blurred for a signed-out visitor. _(Added
  2026-11-03, ADR-0082.)_ The page MUST show a visible licence line: "Free to read" with the recipe's licence (FR-040a),
  the credit for an adapted, family or clone recipe, or the public domain basis (FR-006). Any `license` value in the
  structured data MUST match that line (FR-023).
- **FR-011a** _(added 2026-10-28, owner ruling)_: The whole recipe, its structured data and its preview tags MUST be
  in the first HTML response, with no script needed to see them. A study from December 2024 found this: "none of the
  major AI crawlers currently render JavaScript". The source is
  [Vercel](https://vercel.com/blog/the-rise-of-the-ai-crawler).
  Public pages MUST NOT carry `noarchive` or `nocache`. Bing states this: "Content tagged NOARCHIVE will not be
  included in Bing Chat answers". It also says `nocache` limits an answer to the address, snippet and title. The
  source is
  [Bing, September 2023](https://blogs.bing.com/webmaster/september-2023/Announcing-new-options-for-webmasters-to-control-usage-of-their-content-in-Bing-Chat).
- **FR-012**: The server's response at a public address MUST always be the signed-out version, the same for every
  viewer, and MUST NOT set a cookie. This holds for an open recipe, a facts card, a source card, a creator page and
  the not-available answer alike. Anything more for a signed-in viewer MUST appear only after the page loads in the
  browser, from the viewer's own session. It MUST never be part of the cached response. That covers their actions
  (save, rate, add to a plan), the owner's note (FR-017), and links into the app (FR-013, FR-014). A cache keyed on the
  path alone (FR-062) is safe only because of this rule.
- **FR-013**: Every address that is not an open recipe, a public facts card, a source card or an active creator page
  MUST get one **not-available** answer: status `404`, `noindex`, the same words ("This recipe is not available"), a
  sign-in link, and a generic Commise preview card. It MUST NOT differ between private, draft, deleted, erased, held,
  in review, not approved, and never existed. _(Amended 2026-11-03, ADR-0082.)_ "Book or paid-site" left this list. A
  private one is private, and a public one is a book card (FR-004). Sometimes a signed-in viewer's own session can read the recipe.
  Then, after the page loads, their browser MUST offer a link to it in the app (FR-012). The server never redirects
  on identity.
- **FR-014** _(amended 2026-11-03, owner rulings, ADR-0082)_: The **linked card** (FR-014a) MUST be the signed-out
  answer for a public recipe copied from a web page, served as a public projection (FR-102). The **source card** MUST
  be the answer only for a site that opted out, is past its cap, or is excluded (FR-014e). The source card shows four
  things: the title, the source site's name, a link to the original, and a sign-up control. Its preview card is a
  Commise card with the title. It MUST NOT show ingredients, steps, the description or any photo. The linked card follows FR-020 for indexing and sitemaps. The source card MUST
  answer `noindex` and MUST NOT appear in any sitemap. The server's response is the same for every viewer (FR-012). After the page loads, the
  owner's browser, or a household member's, MUST offer a link to the full private copy on its in-app route. This
  replaces "the source card is the signed-out answer", which hid the ingredients from signed-out readers. [Law] Signed
  in and signed out are the same "public" in law, and the facts are free (17 U.S.C. §102(b), Feist). Counsel review is
  owed before launch (`016-FR-050`).
- **FR-014a** _(added 2026-10-29, owner ruling, ADR-0077, amended 2026-11-03, owner rulings, ADR-0082)_: The **linked
  card** MUST be what everyone other than the owner and the owner's household sees for a public recipe copied from
  someone else's web page. That includes signed-out visitors. It is a public projection with exactly the fields below
  (FR-102). The 2026-11-03 change is who can read it, not what it shows. Its field list changes only by a dated ruling
  (_amended 2026-11-04_). It shows exactly these, and nothing else:
    - the title
    - servings, prep time, cook time, total time and yield
    - the step count, for example "8 steps on [site]"
    - our own computed nutrition, labelled "Estimated by Commise"
    - Commise's own rating and rating count (`averageRating` and `ratingCount`). The card uses the rating card of the
      detail page for another cook's recipe. Comments stay off the card. _(Added 2026-11-04, founder ruling.)_
    - the ingredients in our normalized form: quantity, unit and our food name
    - the owner's own notes, labelled as theirs, and the owner's own photos
    - "Saved from [site]" and a prominent "Open the full recipe on [site]" link
    - every add-to action: add to a meal plan, add to a grocery list, add to a cart, and AI features that run on
      ingredient data. For a signed-out visitor each action opens the sign-up sheet (FR-051).

    Research by the CLO agent of 2026-10-29 backs this list. It is research, not legal advice, and the card is subject
    to counsel review (`016-FR-050`). The owner's own notes and photos are protected expression the owner contributed,
    so they need the owner's licence (`016-FR-010`, `016-FR-012`). The facts need none.

- **FR-014b**: The linked card MUST NOT show the source's method text, its headnote or description, its photo, its
  ratings, or any of its lines word for word. An ingredient line with no food match (ADR-0045) shows only the
  quantity, unit and ingredient name the parse read, never the raw line, its prep words or its notes. A line the parse
  could not read is left out, and the card says how many lines are on the site only. The card also leaves out a
  hand-typed line bound to no catalogue food, and a line with no name. The API sends the count of all left-out lines as
  `unreadLineCount`. When that count is above 0, the card MUST say "{n} more ingredients are on {site} only", or "in the
  book only" for a book card. When the count is 0, the card MUST say nothing about them. _(Added 2026-11-04, founder
  ruling.)_ With no photo of the owner's own,
  the card shows a neutral placeholder, never the source's photo (`016-FR-027a`).
- **FR-014c**: The owner, and the owner's household where the recipe is shared, MUST see the full private copy, whether
  or not the card is public. A clone or "save my own copy" of a linked card MUST copy only what the card shows, plus the
  link, and never the owner's full copy. A cook who wants the full recipe captures it from the site themselves, through
  their own import, as their own private copy.
- **FR-014d**: There MUST be at most one public linked card per canonical page address (`004` C-001). A later cook's
  import of the same page is their own private copy. When that cook chooses Public, the existing card is offered to
  them instead of a second card. _(Amended 2026-11-03, ADR-0082.)_ The question "who can keep a web import private" is
  answered: any cook, using a slot (001 C-004, ADR-0077 §6), for a recipe kept private with no card. _(Amended
  2026-11-03, owner ruling O1, ADR-0082.)_ A recipe with a public card is a public recipe and uses no slot, even when
  the cook keeps the full text privately. The same rule holds for book cards: one public book card per recipe in one
  book (FR-004). [Law] Merging or linking near-identical recipes is a product choice, not a legal
  problem (Sheldon v. Metro-Goldwyn, 81 F.2d 49 (2d Cir. 1936), Morrissey v. Procter & Gamble, 379 F.2d 675 (1st Cir.
  1967)). Two cooks' texts MUST never be merged into one. Matching on the address alone misses the same recipe at
  another address, and pasted copies. That is a product gap, not a legal one, and it is plan work.
- **FR-014e** _(amended 2026-11-03, owner rulings, ADR-0082)_: A facts card MUST show the source card form (the
  title, the site's name and the link only) in three cases. The add-to actions then stay for the owner only.
    - **The site opted out** (`016-FR-024a`).
    - **The site is past its cap.** Each site has a **per-site cap counted over time** (`016-FR-030a`). It counts every
      public facts card from that site, and any later Commise version (FR-014h), together. It never resets per import,
      and deleting a card does not free a place. A book or paid site has the same cap per source (FR-004). Bulk import
      obeys the same per-source cap (`004`, ADR-0072).
    - **The site is excluded.** _(Amended 2026-11-03, owner ruling O6, ADR-0082.)_ User-recipe aggregator sites (the
      Allrecipes, Chefkoch, Marmiton and Cookpad type) get NO public facts cards. Their recipes are other users' work
      and carry the highest database-right risk. A cook's import from one stays private, or the cook publishes it in
      their own words as "Adapted by you" (FR-002). This replaces "the tightest cap, or no public cards at all", which
      was the founder's choice and is now decided. Edited publishers' collections keep the per-site cap. The list of
      aggregator sites is plan work.

    The cap numbers are plan work. No feature lists, browses or filters public cards by site (FR-014g). The grounds:
    - [Law, EU and UK] The database right protects the contents of a site's collection against repeated and
      systematic taking, and rewording does not cure it (Directive 96/9/EC Art. 7 and Art. 7(5), UK SI 1997/3032,
      CV-Online Latvia v Melons, C-762/19). It most likely sits with aggregators and edited collections (British
      Horseracing Board, C-203/02). It binds from the UK launch for UK-made sites and from the EU launch for EU-made
      ones.
    - [Law, US] One site's selection can carry a thin compilation copyright (17 U.S.C. §103).
    - [House rule] Goodwill toward source sites. We apply the cap to every site from day one, because we cannot tell
      where a site was made.

    This replaces a cap per card on EU grounds alone. Counsel review is owed before launch (`016-FR-050`).

- **FR-014f** _(amended 2026-11-03, owner rulings, ADR-0082)_: A source page can state a licence that allows reuse
  (`016-FR-012b`), for example CC BY. Such a recipe can be shown in full, open to the web, on that licence's terms and
  with its attribution. Both of these must hold:
    - the licence allows commercial use
    - the curator or the fetch recorded the licence

    Otherwise it is a linked card (FR-003). _(Amended 2026-11-03, owner ruling O8, ADR-0082.)_ A page shown under its own
    stated licence is **indexable** under the public rule (FR-020). The earlier `noindex` default is removed. [Law] The
    licence is the grant that lets us show and index it, with its attribution. [Law] Software can
    find a STATED licence (schema.org `license`, a CC mark). It cannot find "no copyright", because every page is
    protected from creation (Berne Art. 5(2), 17 U.S.C. §102, §408). Public domain text under the curator grant now
    follows FR-006. Counsel review is owed before launch (`016-FR-050`).

- **FR-014g** _(amended 2026-11-03, owner rulings O2 and O3, ADR-0082)_: A facts card MUST be indexable under the
  same public rule as any page (FR-020), and MUST carry the structured data of FR-023. The earlier house rule that
  every facts card answers `noindex` with no recipe structured data is removed. The owner chose to undercut paid
  recipe sites and to make public and creator recipes easy to find. What stays: the facts-only field list (FR-014a),
  the per-site and per-source caps counted over time (FR-014e), a visible credit and link to the source, and no source
  prose, headnote or photo (FR-014b). [House rule] Counsel review is owed before launch (`016-FR-050`). A facts card
  is readable signed out (FR-014). "Reachable only signed in" is removed, because signed in is
  not a legal line. A surface MUST NOT list, browse, filter or search facts cards by source site or by book
  (`016-FR-030a`). The owner's fallback needs counsel to ask for it. In it the card hides its ingredient list and keeps
  every add-to action. It says plainly that the ingredients are on the site and still go to the cook's list. The
  research found that hiding them makes no legal difference, so the default shows them. Counsel review is owed before
  launch (`016-FR-050`).
- **FR-014h** _(amended 2026-11-03, owner rulings, ADR-0082)_: At launch, an AI feature MUST NOT rewrite the source's
  method for anyone other than the owner (`016-FR-015i`). Commise does not publish its own version of another site's
  recipe at launch. This is a launch decision and a gate for a later pilot. It is not "the law forbids it". [Law]
  Commise is then the publisher, outside the §512(c) safe harbor and outside DSA Art. 6. Thomson Reuters v. Ross (3d
  Cir., 29 Sep 2026, No. 25-2153) weighs a commercial substitute against fair use. The EU and UK database right still
  applies to rewritten text. A later pilot needs every condition ADR-0082 lists. Among them are US users only, open-web
  blog sources only, a per-site cap shared with facts cards, insurance and counsel sign-off. No spec owns the pilot
  yet. At
  launch a reader gets the facts card and a link, and a cook can publish their own "Adapted by you" version (FR-002).
  `016-FR-015i` (AI text is never "the cook's own words") stays as an honesty rule. Counsel review is owed before
  launch (`016-FR-050`). The owner's notes are text other cooks read, so 020 checks them, and compares them with the
  import page (`020-FR-012b`).
  Every state of the card is a deliverable, with its words and localisation keys, on web and mobile in the same
  release. They are the card signed in and signed out, the book card, and the source card form (opted out, capped
  or excluded). They also include the cook's own view of their public card, and the add-to actions. Its design goes through `staff-ux-engineer`
  SPECIFY. Draft words for it are in `016-FR-015g`. Wherever a reader sees "Copied from a public web page", the words
  MUST add "Nobody owns the ingredient list or the bare steps."
- **FR-015**: An active creator page (`012-FR-006`) MUST be readable signed out. It shows the profile fields the cook
  set (avatar, display name, bio), the follower count, and the cook's open recipes, newest first, at most 24 per page. Public collections are readable signed out too, each on its own address (FR-008, Q2). It MUST NOT list any recipe that is not open, and MUST NOT show who follows the cook (`012-FR-009`).
  _(Amended 2026-11-03, owner ruling O7, ADR-0082.)_ A facts card is not an open recipe. A creator page lists
  the cook's recipes they wrote or adapted (labels "Written by you" and "Adapted by you" in `016-FR-015c`), and their
  clones where the label carries. It never lists facts cards. Family and public domain recipes follow the list rule
  this requirement already states: they are listed because they are open recipes. The ruling excludes facts cards
  only. This was an open question and is now decided. Counsel review is
  owed before launch (`016-FR-050`).
- **FR-016**: On a phone with the app installed, a link to a public page MUST open the app:
    - Signed in: the recipe or creator screen the app already has, with every action a signed-in reader has.
    - Signed out: the **public view**, a read-only screen with the same content and states as the web page, plus
      sign-in and sign-up controls.
    - Closing the public view, or opening the app with no link, MUST land on sign-in (`001-FR-045a`).
    - The owner approved this public view on 2026-10-27 ("Read-only view"), for links only.
    - The public view is a link destination, not a landing screen. It MUST be reachable only through a link. The auth
      gate can gain a member for it, and MUST still have no landing member.
- **FR-017**: After the page loads, the signed-in owner of an open recipe MUST see, from their own session, a note
  that this is how others see it, and a link to edit it (FR-012).
- **FR-018**: A signed-in visitor who opens an in-app recipe address for an open recipe they do not own MUST see the
  recipe. A signed-out visitor at that in-app address MUST be sent to the recipe's public page, not to sign-in.
  So a copied in-app address still works for a friend.
- **FR-019**: Every state below is a deliverable, on web and in the app's public view, with copy and a localisation key
  (NFR-005). `staff-ux-engineer` SPECIFY owns the design of each:
    - loading
    - open recipe, with photo and without
    - open recipe with partial nutrition
    - clone, with its "adapted from" link and without
    - _(added 2026-11-03)_ adapted recipe with its credit, family recipe with and without a named giver, and public
      domain text with its basis line (FR-006)
    - _(added 2026-11-03)_ linked card and book card, signed out and signed in (FR-014a, FR-004)
    - source card, for an opted-out, capped or excluded site (FR-014e)
    - _(added 2026-11-03)_ the licence line, with the Commise licence and with CC BY (FR-011, FR-040a)
    - not available
    - creator page with recipes, with none to show, and with more than one page
    - the owner's own view (FR-017)
    - rate-limited (`429`), with the time to try again
    - the service unavailable, with no stale copy to serve
    - offline, in the app's public view
    - the share control on an open recipe, and on a recipe that cannot be shared
    - share sheet opened, link copied, copy failed
    - the sign-up sheet, and the return after sign-up, with the action offered and with the recipe gone
    - the licence panel with its CC BY choice and photo box (FR-040a), and the search setting

#### C. Search engines

- **FR-020** _(amended 2026-11-03, owner ruling O2, ADR-0082)_: An open recipe or a facts card is **indexable** only
  if all of these hold. Every other public page MUST answer `noindex`, in both the page and the `X-Robots-Tag` header,
  and MUST be left out of sitemaps:
    1. It is not a clone (FR-005).
    2. It is not thin (FR-021).
    3. Its settle period is over (FR-022).
    4. The 020 outcome that allows it was stamped in `blocking` mode, or a person cleared it (`020-FR-016a`,
       `020-FR-019`). An outcome stamped in `shadow` or `paused` mode lets a page open by link, but not be indexed.
    5. Its owner's search setting is on (FR-043).
    6. _(Added 2026-11-03, ADR-0082. Amended 2026-11-03, owner ruling O8, ADR-0082.)_ This rule is removed. A page shown
       under its source's own stated licence (FR-014f) is indexable under rules 1 to 5. It once answered `noindex`
       until the founder decided. The founder has decided.

    _(Amended 2026-11-03, owner ruling O2, ADR-0082.)_ A facts card is not an open recipe, but it is indexable under
    this same rule (FR-014g). Rule 1 does not apply to a card that is the one canonical card for its source page
    (FR-014d). A source card (FR-014e) is never indexable. A facts card that declares another page as its canonical
    page (FR-026a) is left out of sitemaps. Indexing is not a separate permission: it follows the public rule. Every
    open label can be indexable under these rules: written, adapted, family and public domain alike. _(Amended
    2026-11-03, owner ruling O8, ADR-0082.)_ Public domain pages and pages under their own stated licence are indexable.
    This is decided and is no longer the founder's open choice. Counsel review is owed before launch (`016-FR-050`).

- **FR-021**: A **thin** recipe has fewer than two ingredient lines, or no step.
- **FR-022**: The **settle period** MUST be 72 hours, from the moment a recipe first becomes open, and again from each
  time it becomes open after its checked content changed. It gives a notice, a correction or a takedown time to land
  before a search engine copies the page.
- **FR-023**: An indexable recipe with at least one photo MUST carry schema.org `Recipe` structured data. One with no
  photo MUST carry none, because Google requires `name` and `image`. The data MUST hold only values that are visible on
  the page. Each of these MUST be included if it is set:
    - `name`, `image`, `description` and `datePublished`
    - `prepTime`, `cookTime` and `totalTime`, as ISO 8601 durations
    - `recipeYield`, `recipeIngredient` as written, and `recipeInstructions` as steps
    - `recipeCuisine`, and `keywords` from tags
    - `dateModified`, equal to the last change to what the page shows (added 2026-10-28)

    With a rating count of at least one, it MUST include `aggregateRating`, and with none it MUST NOT. If any ingredient
    is unresolved or user-entered, it MUST NOT include `nutrition`.

    _(Added 2026-11-03, owner rulings, ADR-0082.)_ It MUST include `license`, equal to the licence line the page shows
    (FR-011). It holds one of three addresses:
    - the CC BY 4.0 address, for a recipe whose cook chose it (FR-040a)
    - the CC Public Domain Mark address, for public domain text (FR-006)
    - the Commise terms address, otherwise

    An open page with no structured data states its licence with a `rel="license"` link instead.

    _(Added 2026-11-03, owner ruling O3, ADR-0082.)_ An indexable facts card with at least one of the owner's own
    photos MUST carry schema.org `Recipe` data built only from the facts the card shows (FR-014a): `name`, `image` (the
    owner's own photo), the times, `recipeYield`, `recipeIngredient` in our normalized form, our own `nutrition` with
    the existing partial-data rule, and the owner's own notes as `description`. It MUST include `isBasedOn`, pointing
    at the source page (or naming the book or paid site), and MUST show the same credit on the page. It MUST NOT carry
    the source's method, headnote, photo or any raw line, and it carries no `recipeInstructions` because the card shows
    only a step count. A card with no owner photo carries no `Recipe` data (Google needs `image`). Every indexable page
    MUST be signed-out server-rendered HTML with one canonical address (FR-026) and a place in the sitemap (FR-027).
    [House rule] Counsel review is owed before launch (`016-FR-050`).

    _(Added 2026-11-03, owner ruling, ADR-0082.)_ A page shown under its own stated open licence (FR-014f) MUST carry
    `Recipe` data only for what that licence lets us show. Its `license` MUST be the source's own licence address, not
    the Commise terms. Its `author` MUST be the source's author as the licence's attribution names them, and it MUST
    include `isBasedOn`, pointing at the source page. The page MUST show the same attribution and licence line. Where
    the licence covers the text but not the photo, the data MUST NOT include the source's `image`, and a page with no
    other image carries no `Recipe` data. [Law] A CC licence requires the credit, a link to the licence and a note of
    any changes (CC BY 4.0 §3(a)). Counsel review is owed before launch (`016-FR-050`).

- **FR-024**: The structured data's `author`, and the page's author line, MUST come from the cook's active creator
  profile: its display name, and its address as the URL. A cook with no active creator profile MUST have no author
  name on the page and no `author` in the data. The name from the sign-in provider MUST never be used. _(Added
  2026-11-03, ADR-0082.)_ For public domain text, the `author` is the original author from its record (FR-006). A book
  with no named author has no `author`. The cook who saved it is never named as its author. A family recipe names its
  giver only with the giver's permission (FR-002).
- **FR-025**: A creator page is indexable only if it lists at least one indexable recipe and its owner's search
  setting is on. _(Amended 2026-11-03, owner ruling O7, ADR-0082.)_ The page lists only what FR-015 lists, so a facts
  card never counts toward this. An indexable creator page MUST carry schema.org `ProfilePage` data with a `Person` built from the
  profile fields the cook set.
- **FR-026**: Every public page MUST declare its canonical address, and a clone MUST declare its own. Query parameters,
  the share mark included, MUST never change the canonical address.
- **FR-026a** _(added 2026-11-03, owner ruling O4, ADR-0082)_: We MUST NOT publish thin duplicates. Where several
  public pages describe one dish from the same source page, one canonical page wins and the others declare it as their
  canonical address. The model is the existing one: one public card per canonical page address (FR-014d, `004` C-001),
  and a clone stays `noindex` with its own canonical (FR-005, FR-026). Two cooks' texts MUST never be merged. [House
  rule] Which page wins when a card and a cook's own open recipe meet is plan work. Counsel review is owed before
  launch (`016-FR-050`).
- **FR-027**: Sitemaps MUST list every indexable recipe, indexable facts card and creator page, and nothing else, with a last-modified date
  equal to the last change to what the page shows. They MUST be split so no file passes 50,000 addresses, and MUST be
  reachable from a sitemap index. A page that becomes indexable MUST appear within one hour, and one that stops MUST
  leave within one hour.
- **FR-028**: `robots.txt` MUST list the sitemap index, MUST allow the public routes and the link association files, and
  MUST disallow API paths. App routes that are not public MUST answer `noindex` rather than be blocked, so a crawler can
  see the `noindex`. The rules for AI crawlers follow Q1, through FR-028a.
- **FR-028a** _(added 2026-10-28, owner ruling)_: The rules for AI crawlers MUST come from **one crawler list**, kept
  as data in the repository and shared by this host and the marketing site (`022-FR-126`). Each entry holds six
  things: the crawler's name, its operator, its purpose from the operator, the rule, the operator's page, and the date
  that page was read. The rule follows Q1: a crawler that only collects training data is blocked, and a search or
  answer crawler is allowed. The list MUST be re-read against each operator's page every 90 days. A stale entry keeps
  its
  last rule. The check fails only on a pull request that changes the list or the robots output. Every other build
  only warns, so a stale list never blocks an unrelated release. The first list, read on 2026-10-28:

    | Crawler            | Operator     | Purpose, from the operator                                                                                        | Rule            | Source                                                                                                                                       |
    | ------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
    | GPTBot             | OpenAI       | "used to make our generative AI foundation models more useful and safe"                                           | Block           | [OpenAI bots](https://developers.openai.com/api/docs/bots)                                                                                   |
    | OAI-SearchBot      | OpenAI       | "for search"                                                                                                      | Allow           | OpenAI bots, above                                                                                                                           |
    | ChatGPT-User       | OpenAI       | Fetches for a person's request. "not used for crawling the web in an automatic fashion"                           | Allow           | OpenAI bots, above                                                                                                                           |
    | ClaudeBot          | Anthropic    | Paraphrase: training Anthropic's generative AI models                                                             | Block           | [Anthropic](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) |
    | Claude-SearchBot   | Anthropic    | Paraphrase: crawls the web "to improve search result quality for users"                                           | Allow           | Anthropic, above                                                                                                                             |
    | Claude-User        | Anthropic    | "supports Claude AI users"                                                                                        | Allow           | Anthropic, above                                                                                                                             |
    | PerplexityBot      | Perplexity   | "designed to surface and link websites in search results", "not used to crawl content for AI foundation models"   | Allow           | [Perplexity bots](https://docs.perplexity.ai/guides/bots)                                                                                    |
    | Perplexity-User    | Perplexity   | "supports user actions within Perplexity"                                                                         | Allow           | Perplexity bots, above                                                                                                                       |
    | Googlebot          | Google       | Google Search, which includes AI Overviews and AI Mode                                                            | Allow           | Google AI features, above                                                                                                                    |
    | Google-Extended    | Google       | Training of Gemini models, and grounding in Gemini Apps. It "does not impact a site's inclusion in Google Search" | Block           | [Google crawlers](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers)                                        |
    | Bingbot            | Microsoft    | Bing search. Which crawler feeds Copilot was not confirmed from a Microsoft page                                  | Allow           | Plan-time check                                                                                                                              |
    | Applebot-Extended  | Apple        | Lets a site "opt out of their website content being used to train Apple's general purpose foundation models"      | Block           | [Apple](https://support.apple.com/en-us/119829)                                                                                              |
    | CCBot              | Common Crawl | A free "copy of the Internet" for researchers and companies, widely used to train models                          | Block           | [Common Crawl FAQ](https://commoncrawl.org/faq)                                                                                              |
    | Meta-ExternalAgent | Meta         | "training foundation AI models or improving products by indexing content directly"                                | Block           | [Meta crawlers](https://developers.facebook.com/docs/sharing/webmasters/web-crawlers/)                                                       |
    | Bytespider         | ByteDance    | No operator page was found                                                                                        | Plan-time check | None yet                                                                                                                                     |

    A crawler with a mixed purpose that names training, such as Meta-ExternalAgent, is blocked. A crawler with no
    operator page stays a plan-time check until one is found. A crawler not on the list gets the default public rules.
    Robots rules are a request, not a control. FR-063 and FR-064 are the controls.

- **FR-029**: Every non-production host (sandbox, every `pr-{N}` preview, every bare deployment host) MUST answer
  `noindex` on every response and disallow everything in `robots.txt`. No non-production host MUST be associated with
  the app.
- **FR-029a**: When an address becomes indexable, changes, or stops being indexable, a notice MUST go through IndexNow
  to the engines that take it, batched, and retried on failure.

#### D. Sharing, link previews and app links

- **FR-030**: The recipe screen MUST offer Share on web and mobile, for an open recipe, a public facts card, a
  source-card recipe and a creator page (amended 2026-11-03, ADR-0082). On mobile it opens the system share sheet with the share link and the title. On the web it opens the
  browser's share panel where there is one. Otherwise it copies the link and says so. After a failed copy, the link is
  shown so it can be copied by hand.
- **FR-031**: A share link MUST be the canonical address plus an opaque **share mark**. The mark MUST carry no user
  id and no recipe secret. Each share action makes a new mark, stored only with the recipe id, the platform and the day.
  Which cook shared is not recorded. A per-sharer referral reward is a separate feature with its own terms.
- **FR-032**: For a private recipe, a draft, or a recipe in review or not approved, Share MUST offer no link. In neutral
  words, it MUST say that only the owner can see it, and that public recipes can be shared. It has no pre-selected
  action and no prompt to publish.
- **FR-033**: Every public page MUST carry Open Graph and Twitter card tags in the first HTML response, with no
  script needed. The tags carry the title, a short description, the canonical address and the `summary_large_image`
  card type. They also carry a 1200 by 630 image built from the cover photo and the title. With no photo, the image is
  a Commise card. The source card
  uses the title and a Commise card, never the third-party photo. _(Amended 2026-11-03, ADR-0082.)_ A facts card uses
  the title and the owner's own photo, or a Commise card. It never uses the source's photo, and its description is
  never the source's words. A not-available address uses a generic Commise card
  with no recipe detail.
- **FR-034**: Each version of a preview image MUST have its own address, so new content gets a new address. After
  an exit event, the image MUST answer not available within the purge bound.
- **FR-035**: The link association files (Apple's `apple-app-site-association` and Android's `assetlinks.json`) MUST
  be served at their exact well-known paths on `commise.app`, with status `200`, a JSON content type and no redirect.
  The locale redirect MUST NOT touch them. They MUST associate the public recipe and creator routes and nothing else.
  Sign-in, sign-up, the OAuth return path and every other route MUST stay unassociated. If the app captured a sign-in
  return, web sign-in breaks on any phone with the app installed. Android MUST confirm the association automatically,
  with the fingerprints of every release signing key. _Amended 2026-10-28:_ the "Save to Commise" route of
  `004-FR-053` is associated too. Nothing else is added, and the sign-in routes stay unassociated.
- **FR-036**: On mobile web, a public page MUST offer "Open in the app" for visitors whose browser did not open the
  app, such as an in-app browser.
- **FR-037**: On mobile web, a public page MUST show a store's install prompt only while the app is live in that
  store. On iOS Safari it is Apple's Smart App Banner, with the page address as its argument. On Android it is a small
  banner that closes in one tap. Neither covers the recipe or appears as an interstitial. 022 follows the same rule.
- **FR-038**: After an install from a public page on Android, the app MUST read the install referrer and offer the
  recipe after sign-up. On iOS, the page MUST tell the visitor to tap the link again after installing. The app MUST
  NOT read the clipboard or fingerprint a device to carry a link through an install.

#### E. Licence, takedown and moderation

- **FR-040**: The cook makes a recipe public. If they did not yet accept the current licence version, the surface
  they use MUST first show these points in plain words, and link the full terms. Every route to Public counts, and
  none skips the panel. The routes are publishing from the editor, switching a recipe to Public and publishing a clone.
  They also include choosing Public for a bulk import, and the import's one "make the rest public" confirmation
  (ADR-0073 §8). The points are:
    - Anyone with the link can read it, without an account.
    - It can appear in search results.
    - Link previews and search engines can show its title, a short excerpt and its photo.
    - Other cooks can save their own copy, and copies survive deletion (`016-FR-015a`).
    - The ownership line for the recipe's own rights label (`016-FR-015g`). _(Amended 2026-10-29, owner ruling,
      ADR-0077.)_ "You keep ownership of what you wrote" appears only for a recipe the cook wrote or adapted
      (`016-FR-015h`). A clone says "Adapted from [cook]. Their words stay theirs." It never says the cook keeps
      ownership of another cook's words.
    - _(Amended 2026-11-03, owner rulings, ADR-0082.)_ For a recipe whose public form is a facts card (a copied web
      page, a book or a paid site), the second and third points do not apply. The panel says instead: anyone can read
      the facts and the link or credit, signed out. Search engines can index it. The method and photos
      stay with the source. The words come from `016-FR-015g`. A family or friend recipe and public domain text get
      all the points, like any open recipe. This replaces "never open to the web" for those two labels.
    - _(Added 2026-11-03.)_ The cook's own notes and photos on a facts card are the cook's protected expression, so
      the licence covers them (`016-FR-012`). The facts and public domain text need no licence.

    Acceptance MUST be recorded through 016's acceptance record (`016-FR-002`), once per licence version, never per
    recipe. Declining publishes nothing as Public.

- **FR-040a** _(added 2026-11-03, owner rulings, ADR-0082)_: **The CC BY 4.0 choice.** At publish, the cook MUST be
  offered a separate, clear choice to license a recipe to everyone under CC BY 4.0. The offer needs both of these:
    - the recipe's label is "Written by you" (`016-FR-015c`)
    - the cook is an adult (`016-FR-008`)

    The choice takes effect only once 020's outside-copy check allows the recipe (`020-FR-001`). A recipe that 020
    holds, or that a person does not approve, never carries CC BY. 020's result arrives after publish, so the page and
    its markup show CC BY only from that moment.

    It is not offered at v1 on an adapted, family, clone or public domain recipe, or on a facts card.
    _(amended 2026-11-03, owner ruling O16, ADR-0082)_ A verified owner's own-site import with the owner statement is
    "Written by you", so it is offered CC BY once 020 allows it. The cook is the licensor and warrants the work is
    theirs. A claim does not prove that (ADR-0078 §3). These rules hold:
    - **It is opt-in.** The choice is off by default, or asked once with equal buttons. It is never pre-selected and
      never a condition of publishing.
    - **Photos are a separate box.** The cook chooses CC BY for their photos apart from the text. Its default is the
      Commise licence.
    - **The cook is the licensor, not Commise.** The cook warrants the recipe is their own work.
    - **The choice is stored per recipe** with the licence version, for the text and for the photos. The
      recipe's read contract sends both to clients. Storage is plan work.
    - **The page shows it.** The page's licence line (FR-011) and its `license` markup (FR-023) name CC BY 4.0.
    - **Switching back applies to the future only.** A cook can switch a recipe back to the Commise licence. Copies
      made while CC BY was on keep CC BY, and nobody can recall them.
    - **Erasure.** Under CC BY the cook's name was made public. When the cook asks for erasure, Commise MUST take
      reasonable steps to tell other controllers, for example a deletion signal on any feed (GDPR Art. 17(2)).

    [Law] The grant must state each right, its scope, place and duration (French CPI L131-3, UFC-Que Choisir v Twitter,
    TGI Paris, 7 Aug 2018). Unfair-terms law also tests it (UK Consumer Rights Act 2015 Part 2, Australian Consumer
    Law). The grant is drafted to that stricter standard once, beside the cook licence (`016-FR-010`). Counsel review is
    owed before launch (`016-FR-050`).

- **FR-040b** _(added 2026-11-03, owner rulings, ADR-0082)_: **The plain words for the CC BY choice**, for
  `staff-ux-engineer` to refine at SPECIFY and for counsel to confirm. Each gets a localisation key. The words MUST
  say:
    - CC BY lets anyone copy, change and share the recipe, also for money. They must credit the cook.
    - Copies others make cannot be recalled. The grant is "irrevocable as far as the law allows".
    - The cook can ask a re-user to remove their name.
    - The photos have their own choice.

    "As far as the law allows" is there for a reason. [Law] French law gives an author a moral right of withdrawal
    (CPI L121-4). In England a free licence can be revocable for want of consideration. A US author can end a grant
    after 35 years (17 U.S.C. §203). Every open page says "Free to read". Commise's own text on any page (its notes and
    the nutrition text it writes) is CC0 1.0 [House rule]. Commise MUST NOT mark collected facts, ingredient lists or
    cards CC0 as a class. [Law] Facts taken from another site's EU or UK database are not ours to waive (Directive
    96/9/EC). Public domain text carries the CC Public Domain Mark (FR-006). Counsel review is owed before launch
    (`016-FR-050`).

- **FR-041**: A recipe is open only while its owner's accepted licence version covers web display. A later version
  that widens the licence MUST be accepted before the owner's recipes are open under it. 016 decides whether a cook who
  declines can keep recipes public to signed-in users (`016-FR-006`).
- **FR-042**: The licence scope this feature needs MUST be added to 016's licence (`016-FR-010`), not written as a
  second licence: display to anyone without an account, indexing by search engines, previews by link-preview services,
  and structured data built from the recipe (FR-092). _(Amended 2026-11-03, ADR-0082.)_ The CC BY grant of FR-040a
  is not part of that licence. It is the cook's own grant to the public, chosen per recipe. 016's terms MUST NOT forbid
  what a CC licence allows (`016-FR-030`).
- **FR-043**: A cook MUST have one account setting, "Show my public recipes in search engines", on by default. With
  it off, every public page of theirs answers `noindex` and leaves the sitemap within one hour. The pages stay
  readable by link. It is a nullable typed column with its default in code (ADR-0059).
- **FR-044**: The publish surface's words for Public MUST say that Public means anyone, including people without an
  account and search engines, unless the search setting is off. They MUST NOT be hidden behind a link.
- **FR-045**: Every public page and public view MUST carry a "Report" link to 016's notice form, which works without an
  account (`016-FR-016`), with the page address filled in.
- **FR-046**: A 016 decision that removes or restricts a recipe is an exit event (FR-007). It MUST show on every public
  surface within the purge bound. For an urgent case, the operator runbook MUST cover the search engines' own removal
  tools.
- **FR-047**: Public pages MUST render cook-written text as plain text. Web addresses in it MUST NOT become links. The
  only outbound links are Commise's own, and the original site on a source card, which carries `rel="nofollow ugc"`.
  _(Amended 2026-11-03, ADR-0082.)_ The same `rel` goes on three more links: the link to the original on a linked
  card, and the credit on a book card or an adapted recipe. The licence links of FR-023 are Commise's own kind. Credit, source
  and any copyright notice stored with a text MUST be kept with it and never stripped (17 U.S.C. §1202, InfoSoc Art.
  7, CDPA s.296ZG).
- **FR-048**: 020 is the only pre-publication check. This feature adds none. Spam and other harms are handled through
  the settle period (FR-022), plain text (FR-047) and 016's notice process.

#### F. Calls to action

- **FR-050**: A signed-out page MUST show the whole recipe before any sign-up prompt. It MUST have exactly two
  prompts: a small header control ("Sign up", "Sign in") and one inline card after the recipe that says what an
  account gives. It MUST NOT show a modal, an overlay, an interstitial or a countdown. It MUST NOT show a fake limit, a
  pre-ticked box, or words that shame a visitor for saying no.
- **FR-051**: The account actions on a public page are the ones a signed-in reader has on another cook's public
  recipe. A signed-out tap on one MUST open a sign-up sheet. The sheet says what an account gives, puts sign up and sign in side
  by side, and closes in one tap. It MUST NOT appear unless the visitor taps an action.
- **FR-052**: After sign-up or sign-in from a public page, the visitor MUST return to the same page through the app's
  parsed return path (`safeReturnPath`). The action they tapped MUST be offered again for one confirmation, and never
  done silently. `staff-ux-engineer` MUST decide what "Save" means here. A clone is a draft (`001-FR-003b`), which
  cannot be cooked, planned or collected, so "Save" MUST NOT quietly make one.
- **FR-053**: Sign-up MUST stay reachable from sign-in (`001-FR-045a`). A public page links to sign-up directly. Neither
  changes what the app root shows.

#### G. Abuse, scraping, rate limits, caching and CDN

- **FR-060**: Signed-out surfaces MUST serve one recipe per address, and one creator page per address with at most 24
  recipes per page. There MUST be no signed-out search, browse, feed, list, bulk or export endpoint. The sitemap is the
  only list, and it lists addresses only. _(Amended 2026-11-03, ADR-0082.)_ No surface slices public recipes or facts
  cards by source site or book. _(Amended 2026-11-03, owner ruling O12, ADR-0082.)_ There is NO public bulk download and
  NO public API of the open layers for now. This is decided. A later ruling is needed to build one, and it would carry
  only the open layers (Commise's CC0 text, CC BY cooks' recipes, public domain text) with their credit, and never
  facts cards, third-party text, photos or 018's paid content, and never a slice by site. Counsel review is owed
  before launch (`016-FR-050`). A cook's own export of their own recipes is `016-FR-034`, not this.
- **FR-061**: The **purge bound**. The public surfaces are the page, the public view, the preview image, the
  structured data, the CDN copy and the origin cache. _(Amended 2026-11-03, ADR-0082.)_ They also include every facts
  card, the 012 creator page list and the 012 embed widget. The widget's own cache lifetime (`012-FR-027`) MUST fit
  inside this bound. A preview a social platform already copied is outside our control, and is a residual risk. After any
  exit event, every one MUST answer not available, or
  show the new content. It MUST do so within 5 minutes for 95% of events, and within 15 minutes for all. An event that the purge cannot confirm MUST raise an alarm.
- **FR-062**: Public pages MUST be served from a CDN. The cache key MUST be the path alone. It MUST ignore query
  parameters (the share mark included), cookies and the `Authorization` header. This is safe only because the response
  does not depend on who asked (FR-012, FR-101).
- **FR-063**: Each client address MUST be rate-limited at the edge, where the real address is visible, never from a
  header a client can set. A person reading and sharing MUST never reach the limit. A client past it gets `429` with
  `Retry-After`. The per-user throttler cannot do this, because a signed-out caller has no user.
- **FR-064**: Search engine and link-preview crawlers MUST be verified by each engine's published method, never by the
  user-agent string alone. A verified crawler MUST NOT be limited off the site at its normal rate. _Amended
  2026-10-28:_ this covers the allowed answer crawlers of FR-028a. OpenAI and Perplexity publish their crawlers'
  address lists (OpenAI and Perplexity bots pages, FR-028a). A crawler whose operator publishes no method is not
  verified, and is limited like any client.
- **FR-065**: If the origin fails, the CDN can serve the last good copy of a page for at most one hour. A purge MUST
  remove that copy too, so an exited page is never served stale.
- **FR-066**: The plan MUST price the CDN, the edge rules and the rendering with `cfo-1`. This spec states no cost
  figures.

#### H. Privacy and erasure

- **FR-070**: A public page, a public view, a preview card and structured data MUST carry only three things:
    - the recipe's content. For a facts card that is only FR-014a's fields (amended 2026-11-03, ADR-0082). For public
      domain text it includes the basis line from its record (FR-006). A family recipe names its giver only with the
      giver's permission.
    - the creator profile fields the cook set, if they have an active profile
    - the rating total and count

    So they MUST NOT carry the cook's email, the name from the sign-in provider, any internal user id, or a location.
    They MUST NOT carry followers, who rated or cloned the recipe, version history, private collections, or any other
    recipe that is not open.

- **FR-071**: Every image a public surface serves MUST be a derived image with all metadata stripped, GPS included. Its
  address MUST NOT contain a user id. Avatar keys carry the user id today (ADR-0064), so the avatar key or its public
  address MUST change before creator pages ship (FR-093).
- **FR-072**: A cook erases their account. Then every public page of theirs, every preview image, every photo of
  theirs that a public surface served, and their avatar MUST stop being served from the CDN within the purge bound. The plain,
  long-cached photo addresses of ADR-0064 make this a purge, not only a delete.
- **FR-073**: An erased cook's handle MUST never be given to another account, because search engines and old links
  point at it. A renamed handle MUST redirect to the new one for 012's 14 days (`012-FR-005`). After that, it MUST NOT be
  given to another account either.
- **FR-074**: An indexable address stops being indexable. Within one hour it MUST leave the sitemap, and an IndexNow
  removal notice MUST go out. The licence panel and the privacy notice MUST say two things. Search engines and chat
  apps keep their own copies for a while. Commise cannot clear them.
- **FR-075**: Public pages MUST set no cookie and store nothing on a signed-out visitor's device. So they need no
  consent banner.
- **FR-076**: Edge and CDN logs that hold client addresses MUST be kept no longer than 30 days, and used only for abuse
  control and operations.
- **FR-077**: Account closure follows the closure plan. Whatever it decides about a closed account's recipes, the open
  rule reads it (FR-002 item 7), so no separate public-page rule exists for closure.

#### I. Measurement

- **FR-080**: Measurement on public pages MUST store nothing on the visitor's device and MUST make no identifier that
  works across sites. It counts page views by page kind (recipe, creator, linked card, book card, source card, not
  available), platform, and whether a share mark was present. The linked card and book card kinds were added
  2026-11-03 (ADR-0082). The count MUST NOT be kept per source site.
- **FR-080a** _(added 2026-10-28, owner ruling)_: A page view MUST also record its **referrer class**: one value from a
  closed list kept in one place and shared with the marketing site and with attribution (`022-FR-128`,
  `023-FR-002a`). The classes are search, each named answer engine (ChatGPT, Perplexity, Copilot, Gemini, Claude),
  social, chat app, other site and none. Only the class is kept, never the referring address or its query string.
  FR-083's rule is unchanged. A visit from Google's AI Overviews arrives from Google's search host and counts as
  search.
- **FR-081**: The app MUST count share actions by platform, and completed shares where the operating system reports
  completion.
- **FR-082**: An account created after sign-up began on a public page MUST record that fact once, and whether a share
  mark was present. The mark MUST travel through the sign-up link, never through a cookie.
- **FR-083**: The web app's analytics redaction (`analyticsRedaction.ts`) drops every query parameter, on purpose. It
  MUST NOT be loosened for share marks. Share marks MUST be counted through a separate, closed-set event field.
- **FR-084**: Creators see their page views in aggregate only (`012-FR-023`, `FR-024`).
- **FR-085**: Search traffic comes from the search engines' own consoles, read by the operator. No in-product search
  tracking is built.
- **FR-085a** _(added 2026-10-28, owner ruling)_: Fetches by verified answer crawlers (FR-028a, FR-064) MUST be
  counted per crawler, per page kind, per day, from edge logs, and totalled before the logs expire (FR-076). The total
  keeps no client address. Crawler fetches and human page views MUST be reported apart and never added together.
- **FR-086**: No business target is set for views, shares or sign-ups. They are reported weekly from launch. Targets
  come later, from measured data.

#### J. How signed-out reads reach the data

- **FR-100**: Whatever shape the plan picks, a signed-out read MUST NOT add a cookie, a session read, a Clerk request
  authenticator or a WebSocket to any service that adopts the shared CORS policy (ADR-0047). The
  `bearerOnlyPrecondition` guard MUST stay green without a waiver.
- **FR-101**: A signed-out read path MUST NOT read the `Authorization` header, and MUST answer the same bytes with or
  without a credential. Only then can a cache keyed on the path serve it (ADR-0020's first trap).
- **FR-102**: A signed-out response MUST be a **public projection**: an allowlist of fields picked from the
  service-owned schema (GR-015), using `Pick`, never `Omit`, so a new field cannot reach the public by default. It
  MUST carry no owner id. _(Amended 2026-11-03, ADR-0082.)_ The facts card is a second public projection, picked the
  same way, with exactly FR-014a's fields plus the link or credit. It MUST NOT carry the source's method, headnote,
  description, photo or any raw line, even as an unused field. The open recipe's projection carries its licence
  choice and version (FR-040a).
- **FR-103**: A signed-out read MUST go through the open-to-web Specification (FR-001) and nothing else.
  _(Amended 2026-11-03, owner ruling O12, ADR-0082.)_ This includes any later endpoint: no public bulk or API route
  reads the library outside FR-001, and none is built for now (FR-060). A cook's own export is a signed-in route
  (`016-FR-034`), not a signed-out read.
- **FR-104**: If a browser calls a public endpoint directly, CORS credentials MUST stay off (ADR-0047 point 3).
- **FR-105**: The production edge returns `401` to a tokenless call except on its passthrough paths. Any public
  endpoint behind it needs a passthrough for exactly its own path, and nothing wider (FR-094).
- **FR-106**: `staff-architect` MUST choose the shape at PLANNING. Either option MUST keep the last approved version (`020-FR-064`, O10). The options this spec sees:
    - **Option A: a public read-only endpoint, and the web renders from it.** recipe-service gains a read-only route
      outside its auth middleware that serves the public projection. The web renders public pages on the server and
      regenerates them on change. The app's public view calls the same endpoint. Trade-off: signed-out traffic reaches
      recipe-service on a cache miss, so it needs FR-063's limit and FR-105's passthrough.
    - **Option B: snapshots pushed to the CDN.** A worker writes the public projection to the CDN when a recipe enters
      or changes in the open set, and deletes it on every exit event. Web and app read the snapshot. No signed-out
      traffic reaches recipe-service. Trade-off: a missed delete leaves a page up, which is the dangerous direction,
      so it needs a reconciliation sweep that compares the snapshots with the Specification.
    - **Rejected: the web reads with a machine credential.** It adds a secret with broad read power to the web tier,
      and the app's public view still needs a path.
- **FR-107**: Creator pages are served by 012's service, which is not built. Its public endpoints MUST meet FR-100 to
  FR-105 too.

#### K. Changes to other specs

- **FR-090**: 001 MUST be amended, and this feature applies it in the same change: `001-FR-004`, `001-FR-045`,
  `001-FR-045a` (one added clause), C-004's first sentence, User Story 2's opening, and the Dependencies table. The
  front door stays sign-in. _(Amended 2026-11-03, ADR-0082.)_ The 2026-11-03 change amends 001 in the same
  change. It touches `001-FR-004`, `001-FR-005`, `001-FR-045` and C-004 (its first sentence and its three import
  bullets). It also touches the User Story 2 note, the Dependencies row and 001's data model.
- **FR-091**: 012 MUST be amended, and this feature applies it in the same change: the audience scope sentence,
  `012-FR-006`, `012-FR-007`, `012-FR-008`, `012-FR-026` and `012-FR-022`.
- **FR-092**: 016 MUST be amended. These are listed here and applied with 016's own next revision, as 020 did:
    - `016-FR-010`'s scope gains display to people without an account, indexing, link previews and structured data.
    - `016-FR-011`'s point-of-publication statement is the panel in FR-040.
    - `016-FR-030`'s anti-extraction term binds only people who accepted the terms. Signed-out visitors did not. The
      corpus is protected for them by FR-060 to FR-064, and counsel decides whether a site notice adds anything.
    - `016-FR-038` says publication MUST be an act the user takes. FR-040 and FR-044 make Public that act, with its
      reach stated.
    - _(Added 2026-11-03, ADR-0082.)_ These 016 items follow the 2026-11-03 rulings and are applied in 016 itself:
      the public domain gate (`016-FR-015k`), rows 5 and 7 of the rights label table (`016-FR-015c`) and their draft
      words (`016-FR-015g`), `016-FR-012`'s licence rule for protected expression only, `016-FR-030`'s carve-out for
      what a CC licence allows, and the per-site cap counted over time (`016-FR-030a`).
- **FR-093**: ADR-0064 MUST be amended before creator pages ship, so a public avatar address carries no user id
  (FR-071).
- **FR-094**: If the plan picks Option A, ADR-0020 MUST be amended: the edge passthrough gains the public read path, and
  only that path.
- **FR-095**: Counsel MUST confirm, before launch:
    - the licence panel's words and the widened licence (FR-040, FR-042)
    - that the search setting can be on by default (FR-043)
    - whether a site notice on signed-out pages adds any protection against scraping
    - that measurement with no device storage needs no consent in each launch market (FR-080)
    - the 30-day log period (FR-076)
    - the linked card (FR-014a to FR-014g) and the licence panel's ownership lines (FR-040), with 016's recipe rights
      items (`016-FR-050`)
    - _(added 2026-11-03, ADR-0082)_ these items, from the 2026-11-03 rulings:
        - facts cards read signed out, and the book card (FR-003, FR-004, FR-014a), under the EU and UK database right
        - the per-site cap, its numbers and the aggregator list (FR-014e)
        - the public domain rule table (`016-FR-015k`), once before the first public domain page and again each year
          (FR-006)
        - the family permission words that cover the open web (FR-002)
        - showing a page in full under its own stated licence (FR-014f)
        - the CC BY grant and its plain words, to French and UK consumer standards (FR-040a, FR-040b)
        - the US DMCA agent, registered in the company's legal name before launch, because the safe harbor does not
          cover anything before registration. Notice and takedown with counter-notices, and a repeat-infringer policy
          that is actually applied (17 U.S.C. §512(c), §512(i), BMG v. Cox)
        - before serving the EU or UK: an EU legal representative (DSA Art. 13), a GDPR Art. 27 representative, a UK
          GDPR representative, DSA Art. 11 and 12 contact points, and statements of reasons for removal, demotion and
          visibility limits with an "automated: yes/no" flag (DSA Art. 17(1)(a))
        - the UK Online Safety Act duties, Australia's Online Safety Act 2021 s.63C self-assessment, and the UK
          Consumer Rights Act 2015 Part 2 at the UK launch
        - Canada's notice-and-notice (s.41.25, s.41.26, records for six months) and s.31.1, and EU DSM Art. 17
        - store territories. [Law] "US-only" is not a defence. An app listed in EU or UK app stores serves them (DSA
          Recital 8, GDPR Art. 3(2), UK OSA s.4(5) and s.4(6)). One choice is to restrict the store territories and
          record it. The other is to treat the UK as a day-one market for the light duties
- **FR-096** _(amended 2026-11-03, owner rulings, ADR-0082)_: GR-014 MUST be amended: "`public`: readable by any
  authenticated user (`001-FR-004`)" gains "and by anyone signed out, for a recipe open to the web under 021 or a
  public facts card". The amendment covers every open label (written, adapted, family, public domain, and a clone of
  one) and the facts cards. It also corrects AC-014-e: a full copy of a web page, book or paid site is never public in
  full, and its public form is a facts card. _(Applied in GR-014 on 2026-11-03, version 3.6.0.)_
- **FR-097**: Q2 is answered (2026-10-29). `018-FR-017` MUST be amended to say that a chef's paid items are never
  readable signed out (`026-FR-015`, FR-008). The amendment is applied in 018, not here. _(Applied in `018-FR-017` on 2026-10-31.)_
- **FR-098**: 020 needs no change for this feature. This feature reads its stamp and its read rule. (020 did change on
  2026-10-29 for ADR-0077's outside-copy checks, and this feature reads that result the same way.) 020's words "publicly visible" now
  include signed-out readers, which only widens who is protected by its hold. _(Amended 2026-11-03, ADR-0082.)_ 020
  still checks every recipe headed public, family and adapted recipes included. A family recipe can be a copied blog
  post. The CC BY choice reads 020's result (FR-040a). An outside-copy hit does not reject the recipe automatically.
  It holds it for a person, and a person must not publish a confirmed copy (ADR-0074).

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`, with no `any` outside marked test doubles. The open
  rule's inputs and the public page's states are closed unions. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc. The open-to-web Specification and the public
  projection name the pattern they implement. (Principle II)
- **NFR-003**: Every control on a public page and public view MUST have an accessible name queryable by
  `getByRole`/`getByLabel`. (Principles IV & VII)
- **NFR-004**: No state MUST be conveyed by colour alone. (Principle VII)
- **NFR-005**: Every string a visitor or cook reads MUST go through the localisation path. Recipe content is shown as
  written and is never machine-translated.
- **NFR-006**: Every user-facing surface ships on web and mobile in the same release (`docs/CODING_STANDARDS.md` §14).
  The public page is web, and its mobile twin is the public view.
- **NFR-007**: Public recipe pages MUST meet WCAG 2.2 AA. Ingredients and steps are real lists, and the page works with
  a screen reader (user need FR-020 in [findingRecipes.md](../../docs/research/userNeeds/findingRecipes.md)).

### Offline Behavior _(GR-005 declaration)_

- **Offline scope**: none for public pages. The app's public view shows its offline state with no network.
- **Persistence**: none. Nothing about a public page is stored on the device.
- **Sync**: none.
- **Conflict**: none. Share works offline because the address is known without the server.

### Key Entities

- **Open-to-web rule**: the one Specification of FR-002, with its SQL form. Derived, never stored.
- **Indexable rule**: the narrower Specification of FR-020, built on the open rule.
- **Public projection**: the allowlisted fields a signed-out reader receives (FR-102).
- **Licence acceptance**: 016's acceptance record, carrying the version that covers web display.
- **Search setting**: one nullable typed column in identity's settings, default in code (FR-043).
- **Share mark**: an opaque value with its recipe id, platform and day. No user id.
- **Exit event**: one change that takes a page out of the open set or changes it, with the time its purge was confirmed.
- **Facts card projection** _(added 2026-11-03)_: the second public projection, with FR-014a's fields only (FR-102).
  Derived, never stored.
- **Per-source cap ledger** _(added 2026-11-03)_: the count, over time, of public facts cards per site, book or paid
  site (FR-014e). It never goes down. Its shape is plan work.
- **Public domain record** _(added 2026-11-03)_: the curator's record per book or edition (FR-006). Where it is
  stored is plan work.
- **Licence choice** _(added 2026-11-03)_: per recipe, `commise` (the default) or `cc-by-4.0`, with the licence
  version, and a separate choice for the photos (FR-040a).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Zero recipes that are not open are served on any public surface. Checked three ways: a property test over
  every combination of FR-002's inputs, a contract test per surface, and a production canary that requests fixture
  recipes in each non-open state. The inputs include every rights label and a public domain record that passes and
  one that fails (amended 2026-11-03).
- **SC-002**: After an exit event, 95% of public surfaces answer not available within 5 minutes and all within 15
  minutes, measured on every event.
- **SC-003**: 100% of indexable recipes with a photo carry Recipe structured data that has `name` and `image` and
  passes a schema test. Zero carry a value that is not visible on the page, checked by a parity test.
- **SC-004**: Zero public responses set a cookie or change with the viewer, checked by a contract test that requests
  each surface with and without a credential and compares the bytes. The test covers an open recipe, a linked card, a
  book card, a source card, a creator page and the not-available answer. It requests each one as its owner, as another signed-in user, and
  signed out.
- **SC-005**: Zero public responses contain an internal user id or image metadata, checked by a scan of rendered pages,
  structured data, preview tags and served images.
- **SC-006**: Public recipe pages on mobile meet the "good" Core Web Vitals at the 75th percentile: largest contentful
  paint at most 2.5 seconds, interaction to next paint at most 200 milliseconds, and cumulative layout shift at most
  0.1.
- **SC-007**: A signed-out Playwright test and a signed-out Maestro flow read every ingredient and every step of an
  open recipe without dismissing anything. `staff-ux-engineer` EVALUATE finds zero deceptive patterns.
- **SC-008**: The association files associate every public route and zero other routes, checked in CI. On test devices,
  with the app installed, 100% of public links open it.
- **SC-009**: Zero non-production hosts can be indexed, checked by a test against a preview.
- **SC-010**: Zero signed-out endpoints return more than one recipe, except a creator page with at most 24.
- **SC-011**: Zero handles of erased cooks are given to another account.
- **SC-012**: At least 90% of public page requests are served from the CDN over each week.
- **SC-013**: Page views, shares, share links opened and sign-ups from public pages are reported weekly from launch. No
  target is set.
- **SC-014** _(added 2026-10-28)_: Every crawler on the FR-028a list gets the rule the list gives it, checked by a test
  that reads the built `robots.txt` of both hosts. Every entry older than 90 days is reported in each build.
- **SC-015** _(added 2026-10-28)_: 100% of indexable recipe pages show every ingredient and step, and their structured
  data, in a fetch that runs no script.
- **SC-016** _(added 2026-11-03)_: Zero facts cards carry the source's method, headnote, description, photo or a raw
  line, checked by a scan of rendered cards and their projection. _(Amended 2026-11-03, owner ruling, ADR-0082.)_ Every
  indexable facts card carries `Recipe` data built only from its own facts, with `isBasedOn` and a visible credit, and
  no source prose.
- **SC-017** _(added 2026-11-03)_: No site, book or paid site ever has more public facts cards than its cap, checked by
  a test that publishes past the cap and deletes cards to try to free a place.
- **SC-018** _(added 2026-11-03)_: 100% of open pages show a licence line, and every `license` value in their markup
  matches it, checked by a parity test.

## Assumptions

- **Nothing is live.** There is no public corpus yet.
- **016 is planned and not built.** The licence acceptance record comes from 016. Until it exists, no recipe can meet
  FR-002 item 6, so nothing is open. This feature cannot ship ahead of it.
- **012 is planned and not built.** Recipe pages (P1) can ship without it, with no author names. Creator pages (P2)
  ship with 012.
- **020 can run in shadow mode first.** Pages open by link while it does, but none is indexed until outcomes are
  stamped in `blocking` mode (FR-020).
- **The web app runs on Vercel and production services sit behind CloudFront** (ADR-0020). Photos and avatars are on
  the media CDN (ADR-0064).
- **English is the only locale** (`SUPPORTED_LOCALES`). No alternate-language pages are declared until a second locale
  ships.
- **Search results come slowly.** The business plan plans no search volume in its first 24 months. This feature makes
  search possible. It does not promise traffic.
- **The 2026-11-03 rulings are specified, not built** _(added 2026-11-03)_. No code yet reads a rights label, a
  facts card projection, a cap, a public domain record or a licence choice. Each is plan work (see Plan work owed).

## Out of Scope

- Signed-out recipe search, browse, feeds and lists. The chef directory and its search are in scope (FR-008, Q2).
- A chef's paid items on any signed-out page (`026-FR-015`). Public collections are in scope (FR-008, Q2).
- _(Amended 2026-11-03, ADR-0082.)_ A full copy of a web page, book or paid site on any public surface, except a page
  shown under its own stated licence (FR-014f). This replaces "Opening imported recipes, the curator corpus, or any
  recipe a cook did not write". Facts cards, family recipes and gated public domain text are now in scope.
- The Commise version, an AI rewrite of another site's recipe, at launch (FR-014h).
- A public bulk download or API of the library (FR-060, decided no for now by owner ruling O12, 2026-11-03).
- Per-sharer referral rewards, and any reward for sharing.
- Carrying a link through an install on iOS.
- Translated pages and alternate-language tags.
- Ads, video structured data and comments.
- A per-recipe search opt-out. The search setting is per account.
- The marketing site and the waitlist (`specs/022-marketing-site-and-waitlist`).
