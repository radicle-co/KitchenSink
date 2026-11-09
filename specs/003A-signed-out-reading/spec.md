# Feature Specification: Signed-out Reading of Public Recipes

**Feature Branch**: `docs/im-spec003a` (single-branch directive. The spec directory is
`specs/003A-signed-out-reading`. The owner named the feature 003A. It is not part of `003-usda-food-data`.)
**Created**: 2026-11-09
**Status**: Draft. Planned. Not built. Eight owner questions are open, each with a default (see "Open questions for the
owner").
**Input**: Owner order, 2026-11-09: write the spec and the plan for signed-out reading of public recipes. Owner legal
ruling, 2026-11-03 (ADR-0082): the facts of any dish (ingredients, amounts, times, yield, step order) are public and
readable signed out. In the EU and UK, a per-site cap applies, counted over time.

## How this spec relates to 021

Spec [021](../021-public-discovery-and-sharing/spec.md) already says what signed-out reading is: who can read what, the
facts card, the page states, the prompts, the cache and purge rules, privacy, and measurement. It has no plan, and none
of its staff runs had happened. **003A is 021's first delivery slice.** It delivers 021 User Story 1, on web and native. In that story a friend
with no account opens a shared recipe. It also delivers 021 section J, which says how a signed-out read reaches the
data.

So this spec does not restate 021. It cites 021 requirements as `021-FR-NNN` (GR-003). Its own requirements cover only
what 021 left to the plan, plus the gaps the 2026-11-09 staff runs found:

- the read path and its contract
- how a signed-out read gets food names and nutrition
- how the open-to-web rule runs while three of its inputs do not exist yet
- the public address, app links and the app's public view
- per-address rate limits, caching and purge on the two systems that serve the page
- where an author's account standing comes from

Where 003A and 021 disagree, 021 wins, except where this spec records a sequencing decision and says so.

## Dependencies

| Spec or decision                                                                                                    | Relationship                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [021-public-discovery-and-sharing](../021-public-discovery-and-sharing/spec.md)                                     | **Parent.** Owns the rules. 003A delivers its US1 and section J, and the parts of sections B, D, F, G, H and I that US1 needs                                                                                 |
| [020-content-source-check](../020-content-source-check/spec.md) and ADR-0074                                        | **Required input, not built.** The hold Specification (`020-FR-057`) is a required input of the open-to-web rule (`021-FR-001`). It exists on no branch. Until it ships, every recipe reads as held           |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md)                                         | **Required input, not built.** The rights label (`016-FR-015c`) and the licence acceptance (`021-FR-040`) decide whether a recipe opens in full. Neither is in code. Until they ship, no recipe opens in full |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)                                                         | **Required.** Owns the front door (`001-FR-045a`), visibility (`001-FR-003`), drafts (`001-FR-003b`) and clones (`001-FR-005`). 003A changes none of them                                                     |
| ADR-0082                                                                                                            | **Governs.** Recipes are an open library of facts, cooks' words and gated public domain                                                                                                                       |
| [ADR-0020](../../docs/architecture/decisions/0020-cloudfront-edge-and-internal-alb-hostnames.md)                    | **Governs, amended by this feature's ADR.** Prod-only CloudFront. A URL-only recipe behaviour is "a NEW decision". 003A adds a public path that passes through with caching disabled                          |
| [ADR-0047](../../docs/architecture/decisions/0047-shared-cors-policy.md)                                            | **Governs, unchanged.** Every adopter stays bearer-only. No browser calls the public endpoint                                                                                                                 |
| [ADR-0040](../../docs/architecture/decisions/0040-test-principals-containment-and-purge.md)                         | **Governs, amended.** A signed-out read must not hold catalog roots, or a stranger can make a test principal's root un-purgeable                                                                              |
| [ADR-0081](../../docs/architecture/decisions/0081-account-suspension-is-enforced-from-a-signed-token-mark.md)       | **Governs.** Suspension travels in each user's own token, so recipe-service cannot see an author's standing on an anonymous read. 003A needs its own source for it (FR-012)                                   |
| [ADR-0029](../../docs/architecture/decisions/0029-authored-foods-substances-only.md) §4 and owner ruling 2026-11-08 | **Relied on.** A public published recipe can hold no private food (`publicFoodsPolicy.ts` and a database trigger). That is what makes a food read with no user safe                                           |
| ADR-0003, ADR-0004, ADR-0033, ADR-0060                                                                              | **Constrain, not contradicted.** No new ALB rule or ALB. No new VPC Lambda or NAT consumer. Works on `pr-{N}` previews. Deployed tests run only while the sandbox is up                                       |
| [ADR-0056](../../docs/architecture/decisions/0056-native-navigation-react-navigation-7.md)                          | **Governs.** Native links go through React Navigation 7 once signed in. The signed-out public view is an auth gate state, not a route                                                                         |
| GR-003, GR-005, GR-014, GR-015                                                                                      | **Govern.** Cross-feature ids, the offline declaration, binary visibility, service-owned wire types                                                                                                           |

## Overview

Today nobody can read a Commise recipe without an account. A friend who gets a shared link meets a sign-in form. The
recipe API answers only a signed-in user on every route except the internal ones. A second gap sits behind that one.
recipe-service forwards the reader's own credential to food, and a stranger has none. So a stranger's read shows every
ingredient as "not loaded".

003A builds the whole signed-out read path, end to end, on web and native:

- one public, read-only recipe endpoint that answers the same bytes to everyone
- a way for that endpoint to get food names and nutrition with no user credential, which can never return a private
  food
- a way for that endpoint to learn whether the recipe's author is active, which fails closed
- the signed-out web page at a public address, rendered on the server, with no cookie
- the app's read-only public view, opened by a tapped link while signed out
- the prompts to sign up. They appear only after a reader taps an account action
- per-address rate limits, a cache that forgets a removed recipe within 5 minutes, link previews and measurement

**Two features that are not built decide what a reader sees when 003A ships.** 021 rules that no
recipe opens before 020's hold is in the read rule (`021-FR-001`). It also rules that no recipe opens in full before its
cook accepts the licence (`021-FR-002` rule 6). So 003A ships **dark**: every input it cannot read counts as closed, and every
public address answers "not available" until 016 and 020 supply their readings. No code changes on the day they do.
Open question Q1 asks the owner whether to light a facts-only form earlier.

### What this feature does

- It turns 021's open-to-web rule into one Specification that takes each of its inputs as a required, typed reading.
  An input that has no producer yet reads `unknown`, and `unknown` is closed.
- It serves two public forms, the full recipe and the facts card (`021-FR-014a`), and the one not-available answer
  (`021-FR-013`).
- It reads food names and nutrition for a public recipe without any user's credential.
- It opens a shared link in the app on a phone with the app. Without the app, the link opens on the web
  (`021-FR-016`).
- It invites a signed-out reader to sign up only after they tap "Save a copy" or "Rate", and brings them back to the
  same recipe (`021-FR-050` to `021-FR-053`).

### What this feature does NOT do

- It does not change the front door. Opening the app or the web root with no link still lands on sign-in
  (`001-FR-045a`).
- It does not build the hold (020), the rights label or the licence acceptance (016), the per-source cap or the
  aggregator list (`021-FR-014e`), or the public domain record (`021-FR-006`). It only reads their results.
- It does not make pages indexable. Every public page says `noindex` until 021 section C (sitemaps, the settle period
  and IndexNow removal) ships (FR-017).
- It adds no share action and no share mark (021 US2, `021-FR-030`, `021-FR-031`). It accepts a share mark in a link and
  ignores it, except to count it.
- It adds no creator page, chef directory, collection page, embed widget, licence panel, report form or takedown flow.
- It adds no signed-out search, list, feed, bulk or export route (`021-FR-060`).
- It adds no plain "Save". In 003A the signed-out actions are only the ones a signed-in reader has today: "Save a copy"
  and "Rate this recipe" (FR-020).

### Words used in this spec

021's words apply (**open recipe**, **facts card**, **linked card**, **book card**, **source card**, **not available**,
**exit event**, **purge bound**, **share mark**). 003A adds these:

| Word                   | Meaning                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public read**        | A read of one recipe by someone who sends no credential. It goes through the open-to-web rule and nothing else                                    |
| **Public form**        | What a public read returns: the full recipe, a facts card, a source card, or not available                                                        |
| **Reading**            | One input to the open-to-web rule, as its producer reports it: `open`, `closed`, or `unknown`. A feature that is not built yet produces `unknown` |
| **Ship dark**          | The state in which every reading that 016 and 020 own is `unknown`, so every public read answers not available                                    |
| **Public view**        | The app's read-only screen for one public recipe, reached by a tapped link while signed out (`021-FR-016`)                                        |
| **Author standing**    | Whether a recipe's owner is active, suspended, closed or erased, as known to the service that serves the public read                              |
| **Public-reader call** | recipe-service asks food for names and nutrition for no user. The call sees catalog and promoted foods only                                       |

## User Scenarios & Testing _(mandatory)_

Every story is tested on web and native unless it says otherwise. While the feature ships dark, an open page can be
proven only at the component and integration tiers, with the readings set by the test. The deployed tier proves the
dark state: not available, no cookie, the same bytes with and without a credential (see the plan's test matrix).

### User Story 1 - A friend with no account reads a shared recipe on the web (Priority: P1)

A cook sends a link to a public recipe. The friend has no account and no app. They tap the link in a chat app. They see
the whole recipe at once, with nothing in front of it, and they can cook from it.

**Why this priority**: It is the virality loop the owner asked for (021 US1). Every other story hangs off this read.

**Independent Test**: With the readings set open, request the public address with no credential. The first HTML holds
the whole recipe. The response sets no cookie. The same request with a credential returns the same bytes.

**Acceptance Scenarios**:

1. **Given** an open recipe, **When** a signed-out visitor opens its public address, **Then** they see the whole recipe
   before any prompt (`021-FR-011`, `021-FR-050`). That is the title, the photos, the facts, and the ingredients with
   amounts and food names. It is also the steps, the nutrition, the rating total and count, and the licence line.
2. **Given** a public recipe whose rights label makes it a facts card, **When** it is opened signed out, **Then** the page
   shows only `021-FR-014a`'s fields, with "{n} steps on {site}" and a link to the source in place of the steps
   (`021-FR-014b`).
3. **Given** the same address, **When** it is requested with and without a credential, **Then** both responses are byte
   for byte the same, and neither sets a cookie (`021-FR-012`, `021-FR-075`, `021-FR-101`).
4. **Given** the address has a share mark or any other query string, **When** it is opened, **Then** the page is the same
   and the cache entry is the same (`021-FR-062`).
5. **Given** the address has the wrong slug, **When** the recipe is open, **Then** it redirects permanently to the right
   slug. **When** the recipe is not open, **Then** it answers not available, and the title is never revealed (FR-014).
6. **Given** an open full recipe whose food data is partly unavailable at that moment, **When** it is opened, **Then**
   each line still shows the cook's own words, and the page says nutrition is missing for {count} ingredients. The
   next render after food recovers replaces the page (FR-008).
7. **Given** the feature ships dark, **When** any public address is opened, **Then** the page answers not available.

---

### User Story 2 - A friend opens the link on a phone (Priority: P1)

The same friend taps the link on a phone. If the app is installed and they are signed out, the app opens a read-only
public view of the recipe. If they close it, they land on sign-in. If they are signed in, the app opens its normal
recipe screen. If the app is not installed, the web page opens.

**Why this priority**: Most shared links are opened on a phone (021 US1). Shipping web without native breaks the
cross-platform rule.

**Independent Test**: On a device with the app installed and signed out, open a public address. The public view shows.
Close it. Sign-in shows. Repeat signed in: the recipe screen shows.

**Acceptance Scenarios**:

1. **Given** the app is installed and the person is signed out, **When** they tap a public recipe link, **Then** the app
   opens the public view for that recipe, with no tab bar and no other destination (`021-FR-016`).
2. **Given** the public view is open, **When** the person closes it or presses Back, **Then** they land on sign-in.
   Pressing Back again leaves the app.
3. **Given** the person is signed in, **When** they tap the link, **Then** the app opens its own recipe screen for that
   recipe, with every action a reader has.
4. **Given** the app is not installed, **When** the link is tapped, **Then** the web page opens (US1).
5. **Given** the device is offline, **When** the public view opens, **Then** it says the person is offline and offers
   Try again. Nothing is read from or written to the device about the recipe.
6. **Given** a sign-in, sign-up or OAuth return link, **When** it is tapped on a phone with the app, **Then** it opens in
   the browser, never the app (`021-FR-035`).

---

### User Story 3 - A signed-out reader never sees what is not public (Priority: P1)

A stranger tries addresses: a private recipe, a draft, a deleted recipe, a recipe of a suspended cook, a recipe in
review, a random id. Every one gives the same answer, which never says why. No public page carries anything about the
cook beyond their public profile.

**Why this priority**: A leak here is a privacy breach on the open web, and the cache spreads it.

**Independent Test**: For each closed case, request the public address and the public endpoint. Each answer is the
same not-available page and the same `404` body. No response carries an owner id, a private food, a rater, a comment or
a version number.

**Acceptance Scenarios**:

1. **Given** any recipe that the open-to-web rule does not admit, or an id that never existed, or an id that is not a
   recipe id, **When** it is requested signed out, **Then** the answer is the one not-available answer (`021-FR-013`).
2. **Given** any public form, **When** its response is inspected, **Then** it carries only `021-FR-070`'s fields. It
   carries no owner id, no clone source id, no version number, no rater, no comment, no impact count and no other
   recipe (FR-005).
3. **Given** a public recipe, **When** its food data is read, **Then** no private food's name, nutrition or existence can
   appear. This holds when the data is wrong too (FR-009).
4. **Given** an author whose standing is suspended, closed, erased or unknown, **When** their recipe is requested signed
   out, **Then** it is not available (FR-012).
5. **Given** a public read, **When** it is served, **Then** no `recipe_viewed` event names a user, and no rating by any
   user is shown (FR-005).

---

### User Story 4 - A signed-out reader taps an account action (Priority: P2)

A signed-out reader taps "Save a copy" or "Rate this recipe". A sheet says what a free account gives, with sign up and
sign in side by side. It closes in one tap. After they sign up or sign in, they land back on the same recipe, and the
action they tapped is offered again for one confirmation. It is never done silently.

**Why this priority**: It turns a reader into a cook, honestly (021 US5). It comes after the read works.

**Independent Test**: Signed out, tap "Save a copy". The sheet opens. Sign up. The same recipe shows with a confirmation
that says the copy becomes the person's own draft. Confirm. A draft copy exists. Repeat and choose "Not now": no copy
exists.

**Acceptance Scenarios**:

1. **Given** a signed-out reader, **When** the page loads, **Then** it shows exactly two prompts: a small header control
   and one end card after the recipe. No modal, overlay, interstitial, countdown or fake limit appears
   (`021-FR-050`).
2. **Given** a signed-out reader, **When** they tap "Save a copy" or "Rate this recipe", **Then** the sign-up sheet opens,
   titled with the action they tapped, and lists only what an account gives today (`021-FR-051`, FR-020).
3. **Given** the reader signs up or signs in from the sheet, **When** they return, **Then** they are on the same recipe
   through the app's parsed return path, and the action is offered once for confirmation (`021-FR-052`).
4. **Given** a return path whose action value is not one of the known actions, **When** it is parsed, **Then** no
   confirmation is offered and nothing is done (FR-021).
5. **Given** the recipe stopped being open while the reader signed up, **When** they return, **Then** they see not
   available and "Your account is ready", with a way to Home.

---

### User Story 5 - A scraper is stopped and a reader never is (Priority: P2)

Someone requests thousands of recipe addresses from one network. They are slowed, then refused with a clear message.
A person reading and sharing never hits the limit. A verified search or link-preview crawler is not cut off.

**Why this priority**: Opening the read path invites scraping (021 US10, `016-FR-030`).

**Independent Test**: In production, send requests from one address past the limit. They get `429` with `Retry-After`.
A second address is unaffected. On a preview, the limit is absent, and that is recorded (see the plan).

**Acceptance Scenarios**:

1. **Given** one client address past the limit, **When** it requests a public page or the public endpoint, **Then** it
   gets `429` with `Retry-After`, and the page says when to try again without blaming the reader (`021-FR-063`).
2. **Given** a signed-out read, **When** it reaches recipe-service, **Then** it is not counted against the per-user
   throttle, and one scraper cannot exhaust a bucket shared by every signed-out reader (FR-016).
3. **Given** a crawler verified by its operator's published method, **When** it crawls at its normal rate, **Then** it is
   not limited off the site. A crawler that cannot be verified is limited like anyone (`021-FR-064`).

---

### User Story 6 - A cook takes a recipe out of public view (Priority: P2)

A cook makes a public recipe private, sets it back to draft, or deletes it, or their account is suspended, closed or
erased. Within 5 minutes, every public surface answers not available.

**Why this priority**: The open web copies what we serve. The purge bound is the promise that makes opening safe.

**Independent Test**: On the deployed sandbox with the readings open (once 016 and 020 ship), open a public page, make
the recipe private, and poll. The page answers not available within 5 minutes.

**Acceptance Scenarios**:

1. **Given** an open recipe, **When** any exit event in `021-FR-007` happens, **Then** the web page, the public view, the
   preview image and the structured data answer not available or show the new content within 5 minutes, for every
   event (FR-013).
2. **Given** an exit event, **When** a cache layer cannot be purged in time, **Then** no cache keeps the page longer than
   5 minutes, so no purge has to succeed for the bound to hold (FR-013).
3. **Given** the origin is failing, **When** a cached page reaches the end of its life, **Then** the old page is not
   served past the bound (`021-FR-065`).

---

### User Story 7 - A shared link shows a good preview (Priority: P3)

When a cook pastes a public link into a chat app, the preview shows the title, a short description and an image.

**Why this priority**: It makes sharing work, but a missing preview does not block reading.

**Independent Test**: Fetch a public address with a link-preview crawler's user agent. The first HTML holds the Open
Graph and Twitter card tags with no script needed.

**Acceptance Scenarios**:

1. **Given** an open recipe, **When** its address is fetched, **Then** the first HTML carries the `021-FR-033` tags and a
   1200 by 630 image built from the cook's cover photo and the title, or a Commise card with no photo.
2. **Given** a facts card, **When** it is fetched, **Then** the description is never the source's words, and the image is
   never the source's photo.
3. **Given** a not-available address, **When** it is fetched, **Then** the preview is a generic Commise card with no
   recipe detail.

---

### User Story 8 - The team sees whether signed-out reading works (Priority: P3)

The team sees public page views by page kind, platform, referrer class and whether a share mark was present, and sign-ups
that started on a public page. Nothing is stored on the visitor's device.

**Why this priority**: It tells the owner whether the loop works, and it must not cost a consent banner.

**Independent Test**: Open a public page signed out. A page view is counted with its kind and referrer class. No cookie
or local storage entry is written.

**Acceptance Scenarios**:

1. **Given** a signed-out page view, **When** it is counted, **Then** it records only `021-FR-080` and `021-FR-080a`'s
   fields, never the referring address, and the existing analytics redaction is not loosened (`021-FR-083`).
2. **Given** an account created after the sign-up sheet opened on a public page, **When** it is created, **Then** that
   fact is recorded once, with whether a share mark was present, carried through the sign-up link and never a cookie
   (`021-FR-082`).

### Edge Cases

- **A recipe changes between two reads.** The page serves whatever the last render saw, for at most the cache life
  (FR-013). 020's "last approved version" rule (`020-FR-064`) applies once 020 ships. Until then nothing is open.
- **Food is down.** A full recipe shows each line's own words and no nutrition. A facts card shows the unavailable
  state, because it has no line text to fall back on (FR-008). Food's outage never shows a wrong name or amount. The
  next render after food recovers replaces the page.
- **A line is bound to a food that food no longer knows.** It shows the cook's own words, like any line food cannot
  answer.
- **The author-standing source is down.** The standing reads `unknown`, and the recipe is not available until it answers
  (FR-012). This is the safe direction.
- **A random UUID.** Not available, through the same code path as a private recipe, so timing does not separate the two
  more than a small, accepted amount (FR-014).
- **An id that is not a UUID.** Not available, never a `400` that tells a prober the id was malformed.
- **A link opened in an in-app browser** that cannot open the app. The page offers "Open in the app" inline on mobile web
  (`021-FR-036`).
- **A signed-in visitor on the web.** The page itself is the same bytes. After it loads, signed-in extras (the owner
  note `021-FR-017`, working actions) appear only for a visitor who already has a session cookie, so a signed-out
  visitor's browser is never given one (FR-018).
- **Cook marks on the public page.** Ticks live in memory only and are lost on reload, because nothing can be stored on
  the device (`021-FR-075`).
- **The native app receives a link while the public view is already open.** It replaces the view with the new recipe.
- **A link arrives while signed out and the person then signs in from the public view.** The app opens the recipe's
  normal screen after sign-in, with the pending action offered once (US4).
- **A second locale ships later.** The public address has no locale (FR-015), so shared links keep working. Which
  language the page's own words use then is open question Q3.
- **Previews (`pr-{N}`).** They have no CloudFront and no WAF, so no rate limit runs there. Every non-production public
  page sends `noindex` regardless (FR-017).

## Clarifications

No clarification session ran. The spec makes informed defaults and records the decisions that only the owner can
take under "Open questions for the owner". The 021 Sessions of 2026-10-27 to 2026-11-04 were read first, and nothing
settled there is asked again.

## Requirements _(mandatory)_

### Functional Requirements

#### A. The open-to-web rule, run with inputs that do not exist yet

- **FR-001**: The open-to-web rule (`021-FR-001`, `021-FR-002`) MUST be one pure Specification. It
  MUST take each of its inputs as a **required** typed reading: the hold (`021-FR-002` rule 4), the rights label (rule
  5), the licence acceptance (rule 6), the author standing (rule 7), any 016 restriction (rule 8), and, for facts cards,
  the per-source cap (`021-FR-014e`). A missing producer MUST be a compile error, never a default. _Sequencing
  decision:_ `021-FR-001` also asks for one SQL form. 003A reads one recipe by id, so no query needs the SQL form yet.
  The first slice that reads a set (the sitemap or a creator page list) MUST add it, and a test MUST hold the two
  forms equal. Building it now would be a second copy of the rule with no reader to keep it honest.
- **FR-002**: A reading MUST be `open`, `closed` or `unknown`. `unknown` MUST mean closed (`020-FR-059`). A reading can
  be a fixed value only where the missing feature makes the closed state impossible, and the plan MUST name each such
  case and its reason. A reading that 016 or 020 owns is never fixed open,
  except where that feature's closed state cannot happen yet. The plan names the one such case (rule 8).
- **FR-003**: Until 016 and 020 supply their readings, the rule MUST admit nothing. The feature ships dark. Lighting any
  form earlier is a change to the Specification itself, reviewed like any rule change, never a configuration switch
  (open question Q1).
- **FR-004**: The rule MUST decide the public form: full, facts card, source card, or not available. Which fields each
  form carries is a separate decision (FR-005), tested separately.

#### B. The public read and its contract

- **FR-005**: The public read MUST return a **public projection** owned by recipe-service and copied to its schema
  package (GR-015). Each form MUST be built by picking fields from the service's schemas, never by omitting fields. It
  MUST carry no owner id, clone source id, version number, binding provenance, impact count, rater, comment or viewer
  rating. A facts card MUST carry exactly `021-FR-014a`'s fields and nothing from `021-FR-014b`'s list, not even as an
  unused field. A client MUST read an unknown form as not available, so the set of forms can grow.
- **FR-006**: The public read MUST answer the same bytes with or without a credential. It MUST NOT read the
  `Authorization` header, a cookie or a session, and MUST NOT run the user authentication path (`021-FR-100`,
  `021-FR-101`). A guard MUST fail the build on any such read.
- **FR-007**: Every closed case MUST give one fixed not-available answer, with one status and one body. A malformed id
  MUST give the same answer.
- **FR-008**: When food data cannot be read in time, a full recipe MUST still show, with each line's own words, no
  invented name or amount, and a count of lines missing nutrition. A facts card has no line text to fall back on, so
  when its food names cannot be read it MUST show the unavailable state. When the author standing cannot be read, the
  answer MUST be the unavailable state (FR-012). The API answer is never cached (FR-013). The web page MUST render a
  degraded or unavailable answer as a normal page, never as an error, so that the next render replaces it. An error
  render keeps the last good copy, which can outlive an exit event.
- **FR-009**: The public read MUST get food names and nutrition with no user's credential, through a public-reader call
  that can see catalog and promoted foods only. A private food MUST be absent from its answers by construction, not by a
  filter that a later change can skip. The call MUST NOT mark any food as held (ADR-0040). The credential it uses
  MUST grant no read of any recipe, and MUST NOT sit on the web tier (`021-FR-106` rejected that).
- **FR-010**: The public read MUST NOT record a view by a user or read impact signals. Measurement goes through FR-022.
- **FR-011**: The public endpoint MUST answer only on its canonical versioned path, with no deprecated alias (ADR-0011).
  It is 021 FR-106 Option A's route, which the web server and the native app call. It is not a public API product
  (`021-FR-060`, owner ruling O12): it answers one recipe per id, lists nothing, is not documented for third parties, and
  is rate-limited like a page.

#### C. Author standing

- **FR-012**: The public read MUST know whether the recipe's owner is active. It MUST NOT trust a user's own token for
  another user (ADR-0081). A suspension, closure or erasure MUST take the recipe out within the purge bound. When the
  standing cannot be read, it MUST be `unknown`, and the recipe is not available. The plan chooses the source.
  _Conflict found:_ account erasure lets a cook donate recipes, which stay public under a pseudonymous handle. Rule 7
  says an erased author's recipe is not open. Until the owner rules (open question Q8), an erased author's recipes are
  not available, which is the safe direction.

#### D. Caching, purge and rate limits

- **FR-013**: A cache layer MUST NOT keep a public page, a preview image or structured data longer than 5 minutes. The
  public API answer MUST NOT be cached at all. So every exit event (`021-FR-007`) shows within 5 minutes even if no purge runs. This meets and tightens
  `021-FR-061` (5 minutes for 95%, 15 minutes for all). A later design that caches longer MUST add a confirmed purge and
  an alarm, and MUST amend this requirement.
- **FR-014**: A redirect from a wrong slug to the right one MUST happen only for an open recipe. Otherwise the answer is
  not available, so no closed recipe's title leaks.
- **FR-015**: The public address MUST be on `commise.app`, on its own route, with the recipe id and a readable slug, and
  with no locale segment. The cache key MUST be the path alone (`021-FR-062`). The address is a one-way door.
- **FR-016**: Signed-out traffic MUST be rate-limited per client address at the edge of each system that serves it: the
  web host and the API distribution (`021-FR-063`). It MUST NOT count against the per-user throttle, and it MUST NOT
  fall into a bucket that every signed-out reader shares. A rate-limit answer MUST NOT set a cookie or run a challenge
  that sets one.
- **FR-017**: Every public page MUST say `noindex` until 021 section C ships, because a page must not be indexable before
  the removal machinery (`021-FR-074`) exists. Every non-production public page MUST say `noindex` always. The page still
  carries its canonical link and its structured data (`021-FR-023`).

#### E. Web and native surfaces

- **FR-018**: The public web page MUST be rendered on the server, from the public read only. No browser MUST call the
  public endpoint. The page and its route MUST be outside the sign-in middleware, so no session handshake or cookie can
  reach the response. Signed-in extras MUST load after the page, and only for a visitor who already has a session.
- **FR-019**: The link association files MUST associate the public recipe route and nothing else (`021-FR-035`). The
  native app MUST open a public recipe link as the public view when signed out and as its own recipe screen when signed
  in. The public view MUST be a state of the auth gate that exists only with its link, so the gate still has no landing
  state (`001-FR-045a`).
- **FR-020**: The signed-out account actions MUST be exactly the ones a signed-in reader has today on another cook's
  public recipe: "Save a copy" and "Rate this recipe". The page and the sheet MUST NOT show or promise an action that
  does not exist. "Save" alone MUST NOT appear, and a save MUST NOT add the recipe to a collection, because a free
  cook's collection is public (open question Q5).
- **FR-021**: The pending action MUST travel in the parsed return path as one value from a closed set. A value outside
  the set MUST do nothing. The action MUST NOT be stored on the device.
- **FR-022**: Measurement MUST follow `021-FR-080` to `021-FR-083`, with nothing stored on the visitor's device and no
  identifier that works across sites.
- **FR-023**: Every state in `021-FR-019` that applies to US1 and US2 MUST be designed and built on web and native, with
  copy and a localisation key: loading (native), full, facts card, source card, not available, food data partly
  unavailable, offline (native), unavailable, rate-limited, the owner note and the signed-in visitor.
- **FR-024**: Cook marks on a public page or view MUST be kept in memory only.
- **FR-025**: Comments MUST NOT appear on a public page or view, because they name the people who wrote them
  (`021-FR-070`). Open question Q6 asks the owner to confirm.
- **FR-026**: A public photo MUST be a derived image with its metadata stripped (`021-FR-071`). Until a stripped
  full-size image exists, the public forms carry the thumbnail only, and a photo with no thumbnail is left out. The
  original upload MUST never be served, because it can carry GPS data.
- **FR-027**: A signed-out visitor at the in-app recipe address MUST be sent to the public address only when the public
  read answers that the recipe is open. Otherwise today's sign-in redirect, with its return path, MUST stay. _Sequencing
  note on `021-FR-018`:_ while the feature ships dark, every public read is not available, so an unconditional redirect
  would cut off the path a signed-out visitor uses today to sign in and read a public recipe.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001 (Principle I)**: Each reading and each public form is a member of a discriminated union, so every switch over
  them fails to compile until it handles a new member. Every public response is validated by its zod schema at the
  service boundary.
- **NFR-002 (Principle IV)**: Each unit is test-first, with unit and integration tiers for every non-UI unit, a component
  test for every state, a Playwright test and a Maestro flow for every story, LOCAL e2e for the SQL form of the rule and
  the food read, and a manual k6 scenario for the public read.
- **NFR-003 (Principle VII)**: Every public surface meets WCAG 2.2 AA, works at 320 CSS px with no horizontal scroll, and
  uses only the house type scale and tokens.
- **NFR-004 (Principle VIII)**: Web and native ship together. The native public view is designed for the phone, not
  ported from the web layout (`staff-ux-engineer` §3.6).
- **NFR-005 (Principle IX)**: The rule is a Specification, the forms are projections, the food credential is a Strategy
  inside the existing gateway, the address is a Value Object with one parser, and the native gate is a State. The
  plan's pattern register lists them.
- **NFR-006 (Performance)**: A cached public page answers in under 1 second at the 95th percentile. A public read that
  misses every cache answers in under 2 seconds at the 95th percentile, food included, or degrades by FR-008.

### Offline Behavior _(GR-005 declaration)_

A signed-out public page or view is network-only. Nothing about it is stored on the device (`021-FR-075`). Offline, the
native public view shows the offline state with Try again. The web page is served by the network or not at all.

### Key Entities

- **Public recipe view**: the public projection. One of four forms. It holds no user id.
- **Reading**: one input to the open-to-web rule, `open`, `closed` or `unknown`, with its producer.
- **Author standing**: active, suspended, closed, erased or unknown, per recipe owner, as recipe-service knows it.
- **Public recipe address**: the recipe id and its slug. One parser serves the web route, the middleware exclusion, the
  native gate, the native link config and the association files.
- **Public-reader credential**: a short-lived token recipe-service signs for food and for identity. It names no user
  and no recipe. It grants only the public food read and the author-standing read.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: With the readings open, a signed-out visitor sees the whole open recipe in the first response, with no
  prompt in front of it, on web and in the app, in 100% of test runs.
- **SC-002**: Across every closed case in US3, the signed-out answer is identical, and no public response carries any
  field outside its form's allowlist. The allowlist tests fail on any added field.
- **SC-003**: After any exit event, every public surface answers not available or shows the new content within 5
  minutes, for every event.
- **SC-004**: A cached public page loads in under 1 second for 95% of requests, and an uncached one in under 2 seconds.
- **SC-005**: A visitor's browser holds no cookie and no stored entry from Commise after reading a public page.
- **SC-006**: No person reading and sharing at a normal pace meets the rate limit. A single address sending far beyond
  that pace is refused within one minute.
- **SC-007**: A signed-out reader who taps an account action and signs up returns to the same recipe with the action
  offered once, in 100% of test runs, and the action never happens without their confirmation.
- **SC-008**: While the feature ships dark, every public address answers not available, and the deployed tier proves it.

## Assumptions

- Recipe ids are UUIDs, so they cannot be enumerated in practice. The rate limit, not the id, is the control.
- The web app is served by Vercel and the recipe API by CloudFront in production only (ADR-0020). Previews have neither
  CloudFront nor WAF.
- One locale (`en`) ships today.
- A free cook's collections are public by default, which is why a signed-out "Save" must not touch a collection.
- Today's signed-in reader actions on another cook's public recipe are "Save a copy" and "Rate this recipe". "Start
  cooking" and "Add to plan" wait for 008 and 006.
- The plan prices the edge rules and rendering with `cfo-1` (`021-FR-066`). This spec states no cost figures.

## Out of Scope

- 021 section C (search engines, sitemaps, IndexNow, the settle period), section E (licence moment, takedown, reports),
  creator pages, the chef directory, collections, the embed widget, the share action and share marks (021 US2).
- The producers of the hold (020), the rights label and the licence acceptance (016), the per-source cap and the
  aggregator list (`021-FR-014e`), and the public domain record (`021-FR-006`).
- A private "Save" bookmark (open question Q5).
- Any signed-out list, search, feed, bulk or export route (`021-FR-060`).

## Open questions for the owner

Each has a default the plan builds, so none blocks the build.

- **Q1. Light a form before 016 and 020 ship?** 021 FR-001 (your 2026-11-03 ruling) says nothing opens before the hold
  is in the read rule, and 021 FR-002 rule 6 says nothing opens in full before the cook accepts the licence. Options:
  (I0) ship dark until both land. This is the default. (I1) open a facts-only form for recipes a cook wrote in the
  editor: title, servings, times, step count, our nutrition, rating, and the ingredients with amounts, with no photo, no
  description and no step text. Facts need no licence (ADR-0082), so this waives only the hold for facts. (I2) open
  the full page for recipes written in the editor. Not recommended: it puts cooks' words on the open web under terms
  they never accepted, and a recipe pasted into the editor is "written in the editor" too.
- **Q2. Are catalog food names public data?** If yes, food can serve a credential-free read of catalog and promoted
  foods, and recipe-service does not need to sign a token (plan, research R2). The default keeps food closed to
  strangers and adds the signed public-reader call.
- **Q3. The public address and its language.** The default is `https://commise.app/recipe/{id}/{slug}`, with no locale,
  so a link never changes when a second locale ships. Which language do the page's own words use then: the
  reader's browser language, or the recipe's?
- **Q4. A rate-limit exemption from the web server to the API.** Vercel's server fetches come from shared addresses. The
  default sends a header that lifts only the API's per-address limit and grants no read. Is that within your FR-106
  rule against a machine credential on the web tier, or must the web server live with the limit? What "no" costs: the
  page renders then share the WAF's per-address buckets, so the API limit must be set high enough for all of Vercel's
  renders together. That limit then also applies to each phone, which makes the native limit much weaker.
- **Q5. What "Save" means.** In 003A there is no plain "Save", only "Save a copy" (a draft the reader owns) and "Rate".
  The UX recommendation for later is a private bookmark: always private, uses no slot, shows "No longer available" if
  the cook removes the recipe. It is a new entity and a one-way door, so it needs your ruling.
- **Q6. Comments on the full public page.** The facts card already shows none (Session 2026-11-04). The default hides
  them on the full page too, because they name the people who wrote them. Confirm.
- **Q7. `noindex` until 021 section C.** The default keeps every public page out of search until the removal machinery
  exists. Your 2026-11-03 ruling makes pages indexable; this only orders the two. Confirm.
- **Q8. Recipes an erased cook donated.** The erasure flow lets a cook donate recipes, which stay public under a
  pseudonymous handle. 021 FR-002 rule 7 says a recipe whose owner is erased is not open. The two conflict. The default
  keeps donated recipes off the open web until you rule. Options: (a) donated recipes are open, and rule 7 reads
  "erased with donation" as active, or (b) donated recipes stay readable only to signed-in readers.
