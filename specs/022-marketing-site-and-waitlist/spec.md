# Feature Specification: Marketing Site and Waitlist

**Feature Branch**: `docs/spec021-022` (single-branch directive. The spec directory is
`specs/022-marketing-site-and-waitlist`.)
**Created**: 2026-10-27
**Status**: Draft (two open owner questions, Q1 and Q2 below)
**Input**: Owner, 2026-10-27: "Include the other recommendations in either new features or expanding existing
features." The recommendations included a marketing site with a pricing page and a waitlist. Mindset, same day:
"assume that we can do this and figure out how."

## Dependencies

| Spec or decision                                                                                        | Relationship                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)                                             | **Required.** `001-FR-045a` keeps the `commise.app` root as sign-in. This site never changes that. A link from sign-in to this site is a listed amendment (FR-090)              |
| [010-subscriptions](../010-subscriptions/spec.md)                                                       | **Required.** Its [plan register](../010-subscriptions/spec.md#plan-register) is the one authority for plans, prices and limits (`010-FR-041b`). The pricing page reads it      |
| [005-ai-integration](../005-ai-integration/spec.md)                                                     | **Required.** Owns what one AI use is (`005-FR-015a`). The pricing page shows the counts from 010's register, in 005's words                                                    |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md)                             | **Required, amendments listed.** Owns the legal documents and their versions (`016-FR-003`) and consent records (`016-FR-007`). Owns the age floor (`016-FR-008`) and group G   |
| [021-public-discovery-and-sharing](../021-public-discovery-and-sharing/spec.md)                         | **Sibling.** Shares the store badge and smart banner rule (`021-FR-037`) and the no-device-storage measurement rule (`021-FR-080`). Its public pages are the recipe half of SEO |
| [ADR-0075](../../docs/architecture/decisions/0075-payment-stack-store-billing-revenuecat-and-stripe.md) | **Required.** Store billing on mobile, Stripe on the web. This site takes no payment. It sends people to sign up                                                                |
| [beta-exit-criteria.md](../beta-exit-criteria.md) §2.3, §2.4 and §4.4                                   | **Satisfies.** A marketing site, a pricing page consistent with 010, the waitlist mechanism, and a published privacy policy                                                     |
| [v1-launch-plan.md](../v1-launch-plan.md) §8                                                            | **Feeds.** Its open item, the beta invite mechanism, draws its invitees from this waitlist                                                                                      |
| [userNeeds synthesis](../../docs/research/userNeeds/synthesis.md)                                       | **Feeds.** Its "questions only real research can answer", question 6 above all, set the interview aims (section E)                                                              |
| `GR-003` FR Identifier Namespace                                                                        | **Governs.** Every cross-feature reference here is written `{feature}-FR-{NNN}`                                                                                                 |

**Plan-time dependencies.** These run before any of this feature is built. None of them has run for this spec.

- **`staff-ux-engineer` DESIGN, then SPECIFY**, for every page and every email, at phone, tablet and desktop widths.
  The pages are home, product pages, pricing, FAQ, legal, the waitlist form and its states, and the consent choice.
  The emails are the confirmation, the welcome, the beta invite, the interview invite and the goodbye after
  unsubscribe. Every state in FR-019 is a deliverable.
- **`staff-ux-engineer` DISCOVER**, for the interview study: method, screener, discussion guide and consent form
  (section E).
- **`staff-architect` PLANNING**, for where the site lives once Q1 is answered, how it reads 010's register, and which
  email and list service it uses.
- **`cmo-1`**, for copy and the claims register (FR-070). **`clo`**, for the items in FR-095. **`ts-1`**, for the
  tracking plan. **`cfo-1`**, for interview incentives.

## Overview

Today a person who types `commise.app` meets a sign-in form, with nothing that says what Commise is (`001-FR-045a`,
an accepted consequence). There is no pricing page, no place to join a waitlist, and no public page for the privacy
policy that each app store asks for. The beta exit list needs a marketing site and a pricing page that matches 010
(`beta-exit-criteria.md` §4.4). The beta itself needs a waitlist to invite people from (§2.3).

This feature adds a small, fast marketing site:

- Pages that say what Commise does, honestly, with screenshots of the real app.
- A pricing page for Free, Pro and Pro with AI, built from 010's plan register, so it can never disagree with the app.
- A FAQ, and the legal pages, readable by anyone.
- A waitlist with double opt-in, where each purpose is a separate choice.
- An opt-in route from the waitlist into research interviews.
- App store badges, smart app banners, and the basics of search.
- Its own measurement, which stores nothing on a visitor's device unless they agree.

### What this feature does NOT do

- **It does not change the app's front door.** The `commise.app` root stays sign-in. The site lives on its own host
  (Q1).
- **It takes no payment.** A visitor who wants Pro signs up, then pays in the app or on the web subscription page that
  010 owns (ADR-0075).
- **It makes no claim the product cannot back.** Every claim comes from the claims register (FR-070).
- **It is not the app.** It has no sign-in, no session and no Clerk. The only link to the app is to sign up or sign in.
- **It runs no paid-ad pixels at launch.** The business plan's paid test is Apple Ads, which measures in the app, not
  on the web.

### Words used in this spec

| Word                 | Meaning                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Site**             | The marketing site this feature adds, on the host Q1 picks                                                        |
| **Plan register**    | 010's table of plans, prices and limits. The one authority for every number on the pricing page                   |
| **Waitlist entry**   | One email address with its consents, locale, confirmation state and dates. It belongs to a person with no account |
| **Confirmed**        | An entry whose owner clicked the link in the confirmation email (double opt-in)                                   |
| **Purpose**          | One reason we email someone: beta and launch news, or a research interview invite. Each needs its own consent     |
| **Suppression list** | A keyed hash of each address that unsubscribed, kept so we never email it again                                   |
| **Claims register**  | The list of every product claim the site makes, each with its source and owner                                    |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - A visitor learns what Commise is and how to get it (Priority: P1)

Jo hears about Commise and searches for it. In a few lines, the site's home page says what Commise helps a cook do. It
shows screenshots from the real app on a phone and on a computer. Jo taps "Get the app". On an iPhone the App Store
opens. On a computer, both store badges show, with a QR code. Before the app is live in a store, its badge does not
show, and Jo can join the waitlist instead.

**Why this priority**: Without it, nobody who hears about Commise can find out what it is without making an account.

**Independent Test**: Open the site on a phone and on a computer. Each claim on the home page has an entry in the
claims register. Each store badge shows only while the app is live in that store. The page sets no cookie before
consent.

**Acceptance Scenarios**:

1. **Given** a first visit, **When** the home page loads, **Then** it says what Commise does and shows screenshots of
   the current app, with no claim that is missing from the claims register (FR-070).
2. **Given** the app is live in the App Store and not yet in Google Play, **When** the page renders, **Then** only the
   App Store badge shows, and Android visitors are offered the waitlist (FR-050).
3. **Given** a visitor on iOS Safari, **When** a page loads, **Then** Apple's Smart App Banner shows while the app is
   live in the App Store, and no other banner covers the page (FR-051).
4. **Given** a visitor who wants to sign in, **When** they tap "Sign in", **Then** they reach the app's sign-in page
   on `commise.app`.

---

### User Story 2 - A visitor compares plans on the pricing page (Priority: P1)

Jo opens Pricing. Three plans sit side by side: Free, Pro, and Pro with AI. Each shows its price by month and by year,
and its private recipe limit. Each also shows its AI uses per month, its bulk import allowance per day, and what else
it adds. The trial
is stated plainly: 14 days, a card needed, one trial per person, and how to cancel before it renews. Every number comes
from 010's plan register. During the beta, the page says billing has not started.

**Why this priority**: The beta exit list requires it. A web price that differs from the app's price is a
consumer-law problem as well as a trust problem.

**Independent Test**: Change one number in the plan register's source. After the next build, the pricing page shows
the new number. If any number on the page is not in the register, a test fails.

**Acceptance Scenarios**:

1. **Given** the plan register, **When** the pricing page is built, **Then** every plan, price, limit and trial rule on
   it comes from the register's one machine-readable source, and a test fails on any number that does not (FR-030).
2. **Given** a paid plan, **When** it is shown, **Then** its renewal terms, its trial terms and how to cancel are on the
   same page, next to the price, never only in a linked document (FR-033).
3. **Given** billing is not yet live, **When** the page renders, **Then** it says so plainly, and says beta testers
   are not charged (FR-034).
4. **Given** a visitor outside the US, **When** they read a price, **Then** the page says their app store can show a
   different local price, with tax where the law requires it (FR-032).
5. **Given** a visitor who taps "Try Pro free", **When** they continue, **Then** they reach the app's sign-up, and pay
   later through 010's subscription page. The site takes no payment (FR-035).

---

### User Story 3 - A visitor joins the waitlist with double opt-in (Priority: P1)

Before launch, Jo enters an email address on the waitlist form. One box, unticked, asks whether Jo wants beta and
launch news, which is the purpose of the list. A second box, also unticked, asks whether Jo is open to a research
interview. A third line asks Jo to confirm being 16 or older. Jo submits and sees "Look for our email". The email has
one button. Jo taps it and sees "You are on the list". Every later email has a one-click unsubscribe.

**Why this priority**: The beta needs a list to invite from (`beta-exit-criteria.md` §2.3), and consent-based email
is law in our markets.

**Independent Test**: Join with a new address, an address already on the list, and a confirmed address. Each gets the
same screen. Only an unconfirmed address gets a confirmation email, and only within the send limit. No other email
goes to an unconfirmed address.

**Acceptance Scenarios**:

1. **Given** the form, **When** it loads, **Then** every consent box is unticked, each names one purpose, and the
   privacy notice is linked beside them (FR-040).
2. **Given** any address, new, waiting or confirmed, **When** it is submitted, **Then** the visitor sees the same "Look
   for our email" screen, so the form never shows whether an address is on the list (FR-042).
3. **Given** a new or unconfirmed address, **When** it is submitted, **Then** one confirmation email is sent, within the
   per-address and per-client limits (FR-043).
4. **Given** a confirmation link, **When** it is used within 7 days, **Then** the entry is confirmed and its consent
   record is kept. A used or expired link shows a page that offers a new one (FR-041).
5. **Given** an entry that is never confirmed, **When** 30 days pass, **Then** it is deleted (FR-046).
6. **Given** any email after confirmation, **When** the person taps unsubscribe, **Then** they are unsubscribed in one
   step, and receive no more email within 2 days (FR-044).
7. **Given** a person who does not confirm being 16 or older, **When** they submit, **Then** no entry is made, and the
   page says why (FR-047).

---

### User Story 4 - A waitlist member takes part in a research interview (Priority: P2)

Jo ticked the interview box. A short screener asks how Jo cooks, plans and shops, with no health or allergy questions.
A researcher invites Jo to a 30-minute video call. Before it starts, Jo reads and accepts a consent form. It says what
is recorded, who sees it, how long it is kept, and that Jo can stop at any time. Jo gets the thank-you gift that was
promised. The findings go into the user-needs database as interview evidence.

**Why this priority**: The user-needs database is desk research only. Its own synthesis says six questions need real
research, and question 6, "which of these problems do people pay to solve", decides the business.

**Independent Test**: Opt in, complete the screener, accept the consent form, and withdraw. The recording and notes are
deleted, and the waitlist entry is untouched.

**Acceptance Scenarios**:

1. **Given** a confirmed entry with the interview purpose, **When** the screener is sent, **Then** it asks no question
   about health, allergy, religion or another special category (FR-061).
2. **Given** a screened participant, **When** an interview is scheduled, **Then** they accept a consent form before it
   starts, and they are 18 or older (FR-062).
3. **Given** a participant who withdraws, **When** they ask, **Then** their recording, notes and screener answers are
   deleted, and their waitlist entry stays as it was (FR-063).
4. **Given** finished interviews, **When** the findings are written, **Then** they go into
   `docs/research/userNeeds/` as interview evidence, with no name or contact detail (FR-065).

---

### User Story 5 - The operator invites a batch from the waitlist to the beta (Priority: P2)

The beta has a seat cap (`beta-exit-criteria.md` §2.3). The operator picks a batch of confirmed entries with the beta
news purpose. The batch mostly follows the order they confirmed, plus any people the interview quotas need. Each gets an invite email
with a single-use sign-up link to the app.

**Why this priority**: The beta needs it, but the invite gate itself belongs to the v1 launch plan's open item.

**Independent Test**: Invite a batch of 10. Each gets one email with a link that works once. Accepting one creates an
account through the app's normal sign-up, and the entry is deleted within 30 days.

**Acceptance Scenarios**:

1. **Given** confirmed entries with the beta news purpose, **When** the operator invites a batch, **Then** only those
   entries are invited, and no invite goes past the seat cap (FR-080).
2. **Given** an invite link, **When** it is used, **Then** sign-up happens in the app, through 016's terms acceptance,
   and the link stops working (FR-081).
3. **Given** a person who creates an account, **When** 30 days pass, **Then** their waitlist entry is deleted (FR-046).

---

### User Story 6 - Anyone reads the legal pages and the FAQ without an account (Priority: P2)

Jo wants to read the privacy notice before joining. It is one tap from every page, and it is the same versioned
document the app shows. The FAQ answers common questions. One example: what happens to a cook's recipes after they leave? The
notice form for reporting content works without an account.

**Why this priority**: Each app store asks for a public privacy policy and support link, and 016's notice form must
work without an account (`016-FR-016`).

**Independent Test**: Open each legal page signed out. Each shows a version and an effective date, and matches the
version the app shows.

**Acceptance Scenarios**:

1. **Given** any page of the site, **When** a visitor looks at the footer, **Then** it links the terms, the privacy
   notice, the community rules, the content licence summary, the notice form, the accessibility statement and the
   measurement choice (FR-020).
2. **Given** a legal page, **When** it renders, **Then** it shows 016's current version and effective date, from the
   same source the app reads (FR-021).
3. **Given** the FAQ, **When** it states a fact about the product, **Then** the fact has an entry in the claims register
   (FR-070).

---

### User Story 7 - A visitor chooses whether to allow measurement (Priority: P2)

Jo opens the site. Nothing is stored on Jo's device. Page views are counted in a way that needs no consent. Some measurement
stores something on the device. If the site ever uses it, a choice appears first. "Allow" and "Do not allow" are the
same size and weight. Jo picks "Do not allow", and the site works the same.

**Why this priority**: The owner asked for the site's own analytics, with consent. Deceptive consent screens are law in
our markets, not a preference.

**Independent Test**: Load the built site in a clean browser. No cookie or local storage is set before a choice. With a
Global Privacy Control signal, the site treats the visitor as having said no.

**Acceptance Scenarios**:

1. **Given** a first visit, **When** any page loads, **Then** nothing is written to the device, and page views are
   counted with no identifier (FR-100).
2. **Given** measurement that stores something on the device, **When** it is turned on, **Then** a choice appears first,
   with saying no as easy as saying yes, and no box ticked in advance (FR-101).
3. **Given** a browser that sends a Global Privacy Control signal, **When** the site loads, **Then** it treats the
   visitor as having said no (FR-102).
4. **Given** a visitor who said yes, **When** they open the measurement choice from the footer, **Then** they can take
   it back in one step (FR-101).

---

### User Story 8 - A search engine finds the site (Priority: P3)

Someone searches for "recipe app that keeps my recipes". The site's pages have clear titles, descriptions and
canonical addresses, a sitemap and Organization data. The pages are fast on a phone.

**Why this priority**: Brand search matters at launch, and these basics cost little. Broad search traffic comes from
021's recipe pages, not from here.

**Independent Test**: Every page has a unique title and description and a canonical address on the site's one host.
The sitemap lists every page. Preview hosts answer `noindex`.

**Acceptance Scenarios**:

1. **Given** each page, **When** it renders, **Then** it has a unique title, a description, one canonical address and
   Open Graph tags (FR-110).
2. **Given** a preview host, **When** a crawler requests any page, **Then** it answers `noindex` (FR-113).

---

### Edge Cases

- **Someone signs up a stranger's address.** The stranger gets one confirmation email, never a second within the send
  limit, and nothing more unless they confirm. The form shows the same screen either way.
- **A bot floods the form.** Per-client limits slow it. A hidden field and a minimum time to submit stop simple bots.
  A challenge appears only on signs of abuse, and it sets no tracking cookie (FR-043).
- **A person unsubscribes, then joins again.** The suppression list blocks email to the address. Joining again asks for
  a fresh confirmation, which lifts the block for that address.
- **A person asks for their data to be deleted.** They have no account, so they ask through the link in any email or
  the contact address. We delete the entry within one month, and keep only the suppression hash, so we never email
  them again (FR-045).
- **The confirmation email lands in spam.** The "Look for our email" screen says to look in spam, and offers to resend
  within the send limit.
- **A plan changes in the register after launch.** The pricing page changes at its next build. A test fails the build
  if the page and the register disagree.
- **A price experiment runs in the app.** See Q2. The page never shows a price lower than some visitors are offered.
- **The app is live in one store only.** Only that badge shows. Visitors on the other platform are offered the
  waitlist (FR-050).
- **A visitor arrives at `commise.app` expecting this site.** They see sign-in. Q1 proposes one plain link from
  sign-in to the site (FR-090).
- **A waitlist member already made an account another way.** At the next invite batch the operator matches the
  entry to the account. The entry is then deleted within 30 days of the account being created.
- **A visitor under 16.** They cannot join. A teen of 13 to 15 can still use the app where 016's age floor allows,
  through the app's own sign-up (`016-FR-008`).

## Clarifications

### Session 2026-10-27

- **The ruling.** Owner, verbatim: "Include the other recommendations in either new features or expanding existing
  features." The recommendations included a marketing site with a pricing page and a waitlist.
- **Reading: the site sells nothing.** A visitor signs up in the app and pays through 010 (ADR-0075). This keeps the
  site free of sessions, Clerk and payment data.
- **Reading: the register is the only source of numbers.** 010 says its plan register is "the one place that says what
  each plan includes" (`010-FR-041b`). A pricing page with its own copy of the numbers is the drift DRY forbids, so the
  page is built from the register's source (FR-030).
- **Reading: one age for the waitlist.** The digital-consent age differs by country, from 13 to 16. The waitlist uses
  16 everywhere, which is the highest. It is simpler than asking for a country, and it asks for less data.
- **Q1. Where the site lives. RESOLVED 2026-10-27.** The owner chose option A, `www.commise.app` now. It deploys on
  its own, with no Clerk and no app middleware, and its cookies stay host-only. The `commise.app` root stays sign-in
  (`001-FR-045a`). `commise.com` can point to it later with permanent redirects.
- **Q2. Prices during a price experiment. RESOLVED 2026-10-27.** No in-app price test is planned. The owner set Pro
  at $99.99 a year from a feature comparison against the $59.99 plans, not from a test. The pricing page shows the one
  standard price. If a test is ever proposed, option B (standard price on the page, a lower offer to some new customers
  in the app, with `clo` sign-off) is the rule.

## Requirements _(mandatory)_

### Functional Requirements

#### A. Where the site lives and what it is

- **FR-001**: The site MUST live on the host Q1 picks. The `commise.app` root MUST stay the app's sign-in
  (`001-FR-045a`), whatever the answer.
- **FR-002**: The site MUST have no sign-in, no session and no Clerk code. Its only links into the app are to sign up
  and to sign in.
- **FR-003**: Every cookie the site sets MUST be host-only, never set for the whole `commise.app` domain. A
  domain-wide cookie rides every request to the app and its services.
- **FR-004**: The site MUST deploy on its own, apart from the app. A copy change MUST NOT need an app release.
- **FR-005**: The site MUST load no third-party script before consent, except the store's own Smart App Banner tag,
  which is a page tag, not a script.
- **FR-006**: The site is web only, by nature. It MUST work well on phones first, because most visitors arrive on one.
  This is a recorded waiver of `docs/CODING_STANDARDS.md` §14.1 lockstep: the app's twin of this site is its store
  listing, which `staff-ux-engineer` and `gmm-1` own.

#### B. Pages and their states

- **FR-010**: The site MUST have a home page, product pages for the main jobs the app does, a pricing page, a FAQ, the
  legal pages, the waitlist, and a contact and support page.
- **FR-011**: Product pages MUST show only features that are in the current release. A feature that is coming MUST be
  labelled as coming, with no date unless engineering has set one.
- **FR-012**: Screenshots MUST come from the current app, in the new UI only, on phone and on a larger screen.
- **FR-013**: Every page MUST meet WCAG 2.2 AA.
- **FR-019**: Every state below is a deliverable, with copy and a localisation key. `staff-ux-engineer` SPECIFY owns
  the design of each:
    - each page at phone, tablet and desktop widths
    - the waitlist form: empty, with a field error, sending, sent ("Look for our email"), and rate-limited
    - the confirmation page: confirmed, link used, link expired, and resend sent
    - the unsubscribe page: done, and the delete-my-data choice
    - the measurement choice: first shown, and changed later from the footer
    - the pricing page: billing live, and billing not yet live
    - store badges: both live, one live, none live
    - each email: confirmation, welcome, beta invite, interview invite and goodbye after unsubscribe

#### C. Legal pages

- **FR-020**: Every page MUST link, in its footer, to the terms, the privacy notice, the community rules, the content
  licence summary (`021-FR-040`), 016's notice form, the accessibility statement, and the measurement choice.
- **FR-021**: Each legal page MUST show the version and effective date that 016 records (`016-FR-003`), from the same
  source the app reads. There MUST be one copy of each document, never one for the site and one for the app.
- **FR-022**: The privacy policy address and the support address MUST be stable public pages, because each app store
  listing points at them.
- **FR-023**: The privacy notice MUST name the email and list service and any measurement service as processors
  (`016-FR-039`).

#### D. Pricing

- **FR-030**: Every plan, price, limit and trial rule on the pricing page MUST come from the plan register's one
  machine-readable source. For each of Free, Pro and Pro with AI, the page MUST show:
    - the monthly and yearly price
    - the private recipe limit
    - AI uses per month, and in the trial
    - the bulk import allowance per day
    - own AI keys, and the other features the register gives that plan

    If any number on the page is not in the register, a test MUST fail the build. Where the register lives in code is a plan decision. The 010 table and the code source MUST be held
    equal by a test, so neither can drift.

- **FR-031**: The page MUST use the plan names Free, Pro and Pro with AI. It MUST never say "Premium"
  (`010-FR-041a1`).
- **FR-032**: Prices MUST be shown in US dollars, with a note that a visitor's app store can show a different local
  price, with tax where the law requires it.
- **FR-033**: Next to each paid price, the page MUST state the trial length, that a card is needed, that there is one
  trial per person, that the plan renews until cancelled, and how to cancel. These MUST NOT sit only in a linked
  document (016 group G).
- **FR-034**: Until billing is live, the page MUST say that paid plans start at launch and that beta testers are not
  charged.
- **FR-035**: Each plan's button MUST lead to the app's sign-up. A paid plan's button MUST say that payment happens in
  the app or on the web subscription page after sign-up (010, ADR-0075).
- **FR-036**: The page MUST NOT pre-select a plan, invent a discount, show a fake countdown, or compare with a
  competitor unless the claims register backs the comparison.
- **FR-037**: While a price experiment runs, the page follows Q2.

#### E. The waitlist

- **FR-040**: The waitlist form MUST ask for an email address only. It MUST show one unticked box per purpose: beta and
  launch news, and research interviews. It MUST link the privacy notice beside the boxes. The person MUST tick at
  least the beta and launch news box to join.
- **FR-041**: Joining MUST use double opt-in. A confirmation email with one link is sent. Until the link is used, the
  entry is not confirmed. The link works once, and for 7 days. Nothing else is sent to an unconfirmed address.
- **FR-042**: Every submission MUST get the same response and the same timing, whether the address is new, waiting,
  confirmed or suppressed. The form MUST never show whether an address is on the list.
- **FR-043**: Confirmation emails MUST be limited per address and per client address, so the form cannot be used to
  flood someone's inbox. The form MUST resist bots with a hidden field, a minimum time to submit and per-client
  limits. A challenge appears only on signs of abuse, and MUST set no tracking cookie.
- **FR-044**: Every email after confirmation MUST carry a one-click unsubscribe, in the message and in its headers, and
  MUST stop within 2 days of the request. It MUST carry the sender's postal address where the law requires one.
- **FR-045**: A person MUST be able to ask for their entry to be deleted, from any email or the contact address,
  without an account. The deletion MUST be done within one month. After an unsubscribe or a deletion, only a keyed
  hash of the address stays on the suppression list, so it is never emailed again.
- **FR-046**: An unconfirmed entry MUST be deleted 30 days after it was made. A confirmed entry MUST be deleted 30 days
  after its owner creates an account, or 12 months after public launch, whichever comes first.
- **FR-047**: The form MUST ask the person to confirm being 16 or older. Without it, no entry is made.
- **FR-048**: Each entry MUST keep its consent record: which purposes, the wording version shown, when, and the locale.
  It MUST NOT keep the client address beyond the send limit's window.
- **FR-049**: Email from the site MUST NOT track opens or clicks, unless the person agreed to measurement. The sending
  domain MUST pass SPF, DKIM and DMARC.
- **FR-049a**: The plan MUST pick a list service that does double opt-in, suppression, per-purpose consent records and
  deletion by API, with a data processing agreement and a region counsel approves. It MUST check Clerk's waitlist
  mode against these needs first. 016's statement-of-reasons email needs a sender too, so the plan MUST weigh one
  sender for both.

#### F. Research interviews

- **FR-060**: Interviews MUST draw only on confirmed entries that ticked the interview purpose.
- **FR-061**: The screener MUST be short. It MUST NOT ask about health, allergy, religion or any other special category
  (`016-FR-036`).
- **FR-062**: A participant MUST be 18 or older. Before each session, they MUST accept a consent form that says what is
  recorded, who sees it, how long it is kept, how to withdraw, and what thank-you gift they get.
- **FR-063**: Recordings, notes and screener answers MUST be stored apart from the waitlist, kept no longer than the
  consent form says, and deleted on withdrawal. Withdrawing from research MUST NOT change the waitlist entry.
- **FR-064**: Recruitment MUST aim to reach the groups the user-needs evidence barely reaches: older cooks, low-income
  households, non-English speakers, and blind and low-vision cooks. It MUST aim at the synthesis's open questions,
  question 6 first.
- **FR-065**: Findings MUST go into `docs/research/userNeeds/` as interview evidence, under its README's rules, with no
  name or contact detail.
- **FR-066**: The thank-you gift MUST be set with `cfo-1` and checked by `clo`. It MUST NOT depend on what the person
  says.

#### G. Claims and content

- **FR-070**: A claims register MUST exist in the repository before launch, owned by `cmo-1`. Each claim on the site
  names its source there: a shipped feature, a spec, or a cited study. A claim with no entry MUST NOT be published.
- **FR-071**: The site MUST NOT claim allergy or diet safety, "the only app with AI meal plans", household sharing
  before 010 and 017 settle it, a number of AI uses the register does not set, or "no ads" as a promise for all time.
- **FR-072**: Site copy MUST be plain words, and every string MUST go through the localisation path.

#### H. App store badges and banners

- **FR-050**: A store badge MUST appear only while the app is live in that store, or as Apple's pre-order badge while
  a pre-order is open. Badges MUST use each store's official artwork and follow its badge rules.
- **FR-051**: On iOS Safari, the site MUST use Apple's Smart App Banner while the app is live in the App Store. On
  Android, a small banner that closes in one tap. No banner MUST cover content or appear as an interstitial. This is
  the same rule as `021-FR-037`.
- **FR-052**: Store links MUST carry campaign values the stores define for install counts: Apple's campaign tokens and
  Google Play's referrer. They MUST NOT need a cookie.
- **FR-053**: On a computer, the site MUST show both live badges and a QR code that opens the right store on a phone.

#### I. Beta invitations

- **FR-080**: The operator MUST be able to invite a batch of confirmed entries with the beta news purpose. The batch
  follows confirmation order, plus people the interview quotas need. No invite MUST go past the seat cap.
- **FR-081**: An invite MUST carry a single-use link to the app's sign-up. Sign-up runs through 016's terms acceptance,
  like any sign-up. How the app gates beta sign-up is the v1 launch plan's open item (§8), and this site only feeds it.

#### J. Search basics

- **FR-110**: Each page MUST have a unique title, a description, one canonical address on the site's host, and Open
  Graph tags.
- **FR-111**: The site MUST have a sitemap and a `robots.txt` that lists it.
- **FR-112**: The home page MUST carry schema.org `Organization` and `WebSite` data. It MUST NOT carry app rating data
  unless the ratings are real and Google's rules allow them.
- **FR-113**: Every preview host MUST answer `noindex`.
- **FR-114**: Pages MUST meet the "good" Core Web Vitals on phones (SC-005).

#### K. Measurement

- **FR-100**: By default, measurement MUST store nothing on the visitor's device and make no identifier. It counts page
  views by page, channel and campaign. Campaign values come from the landing address and are kept only for that page
  view. This is the same rule as `021-FR-080`.
- **FR-101**: Measurement that stores anything on the device, or shares data with an ad platform, MUST wait for consent.
  The choice MUST make saying no as easy as saying yes, with no box ticked in advance. The visitor MUST be able to
  change it from the footer at any time.
- **FR-102**: A Global Privacy Control signal MUST count as no.
- **FR-103**: The funnel MUST count: page views, waitlist submissions, confirmations, unsubscribes, interview opt-ins,
  store badge taps, sign-up taps, invites sent and invites accepted. No business target is set. They are reported
  weekly.
- **FR-104**: A waitlist entry can keep the channel it came from, as one value from a closed list. The privacy notice
  MUST say so.

#### L. Changes to other specs

- **FR-090**: `001-FR-045a` MUST gain one clause, once Q1 is answered: the sign-in page can carry one plain link to the
  site ("What is Commise?"). A link is not an interstitial, and the root stays sign-in. This is listed here, and
  applied to 001 after the owner answers Q1.
- **FR-091**: 016 MUST be amended, listed here and applied with 016's next revision:
    - `016-FR-007`'s consent records MUST cover people with no account: waitlist and interview consents.
    - `016-FR-003`'s rendering of any version MUST be public, so the site can show it.
    - The privacy notice MUST cover the waitlist, the interviews and the suppression list.
- **FR-092**: 010 MUST be amended: its plan register MUST have one machine-readable source that the pricing page and
  the in-app subscription page both read, held equal to the 010 table by a test (FR-030).
- **FR-095**: Counsel MUST confirm, before launch:
    - the waitlist's consent wording, the age of 16, and the retention periods (FR-040, FR-046, FR-047)
    - that a keyed hash on the suppression list is lawful to keep (FR-045)
    - the postal address rule for email (FR-044)
    - that measurement with no device storage needs no consent in each launch market (FR-100)
    - the interview consent form and the thank-you gift (FR-062, FR-066)
    - the accessibility statement (FR-020)
    - Q2, if the owner picks B

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`, with no `any` outside marked test doubles.
  (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc. (Principle II)
- **NFR-003**: Every control MUST have an accessible name queryable by `getByRole`/`getByLabel`. (Principles IV & VII)
- **NFR-004**: No state MUST be conveyed by colour alone. (Principle VII)
- **NFR-005**: Every visitor-facing string, the emails included, MUST go through the localisation path. English is the
  only locale today. Alternate-language tags come with the second locale.
- **NFR-006**: The site follows FR-006's recorded waiver of §14.1 lockstep.

### Offline Behavior _(GR-005 declaration)_

- **Offline scope**: none. The site is online only.
- **Persistence**: none on the device, before consent.
- **Sync**: none.
- **Conflict**: none.

### Key Entities

- **Waitlist entry**: an email address, its purposes, its consent record, its locale, its confirmation state and its
  dates. Personal data of a person with no account.
- **Confirmation link**: single use, 7 days, tied to one entry.
- **Suppression record**: a keyed hash of an address that unsubscribed or asked for deletion.
- **Interview record**: screener answers, consent, session notes and recording, stored apart from the waitlist.
- **Invite**: a single-use sign-up link sent to one entry in one batch.
- **Plan register source**: the one machine-readable form of 010's register (FR-092).
- **Claims register entry**: one claim, its source and its owner.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: 100% of plans, prices, limits and trial rules on the pricing page match the plan register, checked on
  every build.
- **SC-002**: Zero emails other than the confirmation go to an unconfirmed address, and zero unconfirmed entries live
  past 30 days.
- **SC-003**: 100% of emails after confirmation carry a one-click unsubscribe, and 100% of unsubscribes take effect
  within 2 days.
- **SC-004**: Zero cookies or other device storage are set before consent, checked by a scan of the built site in a
  clean browser on every build.
- **SC-005**: Pages on phones meet the "good" Core Web Vitals at the 75th percentile: largest contentful paint at most
  2.5 seconds, interaction to next paint at most 200 milliseconds, and cumulative layout shift at most 0.1.
- **SC-006**: `staff-ux-engineer` EVALUATE finds zero WCAG 2.2 AA failures and zero deceptive patterns.
- **SC-007**: The form's responses for new, waiting, confirmed and suppressed addresses are the same, checked by a test
  that compares status, body and timing.
- **SC-008**: 100% of deletion requests from people with no account are done within one month.
- **SC-009**: Zero site claims lack an entry in the claims register, checked before each release.
- **SC-010**: At least 12 interviews are done before the beta exit review, with at least two people from each group in
  FR-064 where recruitment reaches them. Twelve is where Guest, Bunce and Johnson (2006) saw themes stop growing.
- **SC-011**: The funnel counts in FR-103 are reported weekly from the day the site opens. No target is set.

## Assumptions

- **Nothing is live.** There is no waitlist and no site yet.
- **The beta has no billing** (`v1-launch-plan.md` §5). The pricing page shows plans before billing starts (FR-034).
- **016 is planned and not built.** The legal documents, their versions and the consent record come from 016. The site
  cannot open its waitlist before the privacy notice exists (`beta-exit-criteria.md` §2.4).
- **No email service exists today.** 014 rules out email. The plan picks one (FR-049a).
- **English is the only locale** (`SUPPORTED_LOCALES`).
- **The founder can be the only researcher at first.** The study design from `staff-ux-engineer` DISCOVER has to fit
  that.

## Out of Scope

- Taking payment on the site.
- A blog, a content system, or a press kit beyond one contact line.
- Waitlist referral rewards, positions or "move up the list" games.
- Paid-ad pixels and retargeting.
- Recipe pages, creator pages and their search rules (021).
- Pages in a second language.
