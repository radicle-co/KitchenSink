# Feature Specification: Referrals and Growth Measurement

**Feature Branch**: `docs/spec023-expansions` (single-branch directive. The spec directory is
`specs/023-referrals-and-growth-measurement`. `.specify/feature.json` is not pointed here, because another session
uses it.)
**Created**: 2026-10-27
**Status**: Draft. Two owner questions are open (marked below). Every user-facing surface needs `staff-ux-engineer`
DESIGN and SPECIFY before it is built.
**Input**: Owner rulings, 2026-10-27: "Include the other recommendations in either new features or expanding existing
features." And: "assume that we can do this and figure out how." The recommendations come from the business plan
draft of 2026-10-27. Its go-to-market section covers referral in 8.4.7 and the launch plan in 8.5. That draft is not
yet in the repository. So this spec cites it by section and repeats each figure it uses.

## Dependencies

| Spec or decision                                                                                        | Relationship                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [010-subscriptions](../010-subscriptions/spec.md)                                                       | **Required.** Owns the plans and the [plan register](../010-subscriptions/spec.md#plan-register). Also owns the one-trial rule (`010-FR-041h`), plan changes (`010-FR-041i`), lapse (`010-FR-043a`) and the tier claim (`010-FR-044`).         |
| [ADR-0075](../../docs/architecture/decisions/0075-payment-stack-store-billing-revenuecat-and-stripe.md) | **Required.** App Store, Google Play and Stripe sell the plans, and RevenueCat joins them into one entitlement per cook. Reward time reaches the cook through these rails (section D)                                                          |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md)                             | **Required, items owed.** Owns consent records (`016-FR-007`), consent withdrawal (`016-FR-035`) and the age basis (`016-FR-008`). Also owns market switches (`016-FR-048`) and the counsel list (`016-FR-050`). Section I lists what is owed. |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)                                             | **Referenced, not edited.** The signed-out front door is sign-in (`001-FR-045a`), and every feature ships to web and mobile together (`001-FR-044a`). Attribution and invite codes must survive that front door                                |
| [017-recime-parity](../017-recime-parity/spec.md)                                                       | **Referenced.** The household (`017-FR-030` onward). A household member never earns a referral reward for someone in the same household (FR-030)                                                                                               |
| [018-chef-program-marketplace](../018-chef-program-marketplace/spec.md)                                 | **Governs.** `018-FR-058k`: a referral reward is never anything in 015's recognition layer                                                                                                                                                     |
| [ADR-0024](../../docs/architecture/decisions/0024-llm-spend-ceiling-reserve-then-settle.md)             | **Governs.** The $100 monthly AI ceiling stands until launch funding. No reward is AI uses (FR-024)                                                                                                                                            |
| [ADR-0073](../../docs/architecture/decisions/0073-free-tier-private-slots.md)                           | **Required.** At the end of reward time, private recipes stay private. The 50-slot rule returns (FR-026).                                                                                                                                      |
| [beta-exit-criteria](../beta-exit-criteria.md) and [v1-launch-plan](../v1-launch-plan.md)               | **Referenced.** Beta needs product analytics and a waitlist. This spec specifies both                                                                                                                                                          |
| [User-needs synthesis](../../docs/research/userNeeds/synthesis.md)                                      | **Referenced.** Its question 6, "Which of these problems do people pay to solve", is what the interviews in section G aim at                                                                                                                   |
| `GR-003` FR Identifier Namespace                                                                        | **Governs.** Cross-feature references are written `{feature}-FR-{NNN}`. The cross-feature FR index needs entries for this spec. Its owner adds them (this change does not edit that file)                                                      |

## Overview

The business plan grows Commise on organic channels first, because paid ads return about $0.72 for every $1 at median
conversion (business plan section 8.4.2). No channel's volume is known. So three things must exist before launch:

1. **Measurement.** Installs and sign-ups are counted by source, and each source's funnel is read against set
   thresholds, during a soft launch with a fixed start and end date.
2. **Referral.** A cook invites a friend, and both get 30 days of Pro. It costs revenue forgone, not cash.
3. **Recruitment.** A waitlist before beta, and an in-app opt-in to talk to the team, so 15 to 20 cooks can be
   interviewed before launch.

The owner asked us to solve the constraints, not list them. Each constraint below has a stated answer:

- **iPhone cannot carry a referral code through the App Store without fingerprinting.** So the code reaches the
  account in four honest ways: web sign-up, a universal link opened after install, a one-tap paste control, or typing
  it (FR-018). Android carries it through the Play Install Referrer.
- **Store payers cannot be given free time by a server flag.** So reward time is applied on the rail the cook pays
  through (FR-027). A cook who does not pay gets a RevenueCat promotional entitlement. A Google Play payer gets a
  deferral, and so does a Stripe payer. An App Store payer accepts an Apple promotional offer with one tap.
- **Google Play promo codes give trials, not free time.** So Android rewards use the deferral API for payers and a
  RevenueCat grant for everyone else. Promo codes are not used.
- **AI uses cannot be a reward while the $100 ceiling stands.** So reward time never raises a cook's AI allowance
  above their own plan (FR-024).
- **Attribution must not track.** So it uses only first-party data and Apple's and Google's own privacy-preserving
  frameworks. There is no App Tracking Transparency prompt, because nothing here is tracking (FR-045).

### What this feature does NOT do

- It does not buy installs. The paid-ads budget is the owner's decision. This spec measures whatever is spent.
- It does not add an advertising SDK, a mobile measurement partner that fingerprints devices, or any ad network pixel.
- It does not make recipe pages public or build the marketing site. Both wait on owner rulings that the business plan
  lists (section 8.11.1, items 1 and 2).
- It does not run the interviews. The interview guide, scheduling and synthesis are a research process. This spec
  builds the product hooks only.

### Words used in this spec

| Word                 | Meaning                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Source**           | Where a sign-up came from, from one closed list (FR-004). Every account has exactly one first-touch source. `unknown` is an honest value                     |
| **Signal**           | One piece of evidence about the source: a UTM parameter, a campaign token, an install referrer, an Apple Ads token, an invite code, or the cook's own answer |
| **Funnel stage**     | Install, sign-up, activation, trial start, paid by day 35, and retention. Defined in FR-008                                                                  |
| **Activation**       | A recipe saved, imported or written, plus one meal plan, grocery list or cooking-mode action, within 7 days of sign-up (FR-008)                              |
| **Soft launch**      | Months 1 to 3 after billing goes live, with no press. It has a start date and an end date recorded before it starts (FR-012)                                 |
| **Inviter**          | The cook who shares an invite                                                                                                                                |
| **Friend**           | The person who signs up through an invite                                                                                                                    |
| **Invite code**      | A short, public, non-secret code tied to the inviter. It attributes a sign-up. It never unlocks anything by itself                                           |
| **Reward**           | 30 days of Pro, recorded once in the reward ledger and applied on the cook's billing rail                                                                    |
| **Reward time**      | Days of Pro features that a reward gives a cook who is not paying. It is not a trial, needs no card, and never renews or charges                             |
| **Qualified**        | A friend who meets every rule in FR-021. The inviter's reward is earned at that moment                                                                       |
| **Research contact** | A cook or waitlist member who agreed to be contacted for an interview. It is a consent purpose under `016-FR-007`                                            |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Every sign-up is counted by its source (Priority: P1)

The founder posts a short video on TikTok with a tracked link. The founder also runs a $1,000 Apple Ads test and asks
two creators to share their own links. A week later, the founder sees the installs and sign-ups from each one. The
count covers iPhone, Android and web. No person is tracked across other companies' apps.

**Why this priority**: Every channel's volume is GAP in the business plan. The soft launch exists to measure them. If
the first 30 days count sources wrong, the next 60 days of decisions rest on nothing. The business plan says so for
days 1 to 30 (section 8.5.5): "Fix tracking before spending more".

**Independent Test**: Sign up once through each source on each platform. Use six sources: a web UTM link, an App Store
campaign link, an Apple Ads test campaign, a Play referrer link, an invite link, and no link. Each
account shows the right first-touch source. The no-link account shows `unknown` or the cook's own answer. No App Tracking
Transparency prompt appears.

**Acceptance Scenarios**:

1. **Given** a visitor opens `commise.app/?utm_source=tiktok&utm_campaign=launch1`, **When** they are redirected to
   sign-in and then go to sign-up and finish, **Then** the account's source is `organic_social`, platform `tiktok`,
   campaign `launch1`.
2. **Given** an Android user taps a Play Store link carrying a referrer string with UTM parameters, **When** they
   install and sign up, **Then** the app reads the install referrer once and the account carries that source.
3. **Given** an iPhone user installs from an Apple Ads search ad, **When** they sign up, **Then** the app sends Apple's
   attribution token once and the account's source is `apple_ads` with the campaign Apple returns.
4. **Given** an iPhone user installs from an App Store campaign link with no ad, **When** they sign up, **Then** the
   account's source is `unknown` unless another signal exists, and the install is counted in App Store Connect's
   campaign report in aggregate only.
5. **Given** a sign-up with no signal, **When** the optional "How did you hear about Commise?" question is shown,
   **Then** the cook can answer from a closed list or skip it, and sign-up never waits on it.
6. **Given** any platform, **When** the app runs, **Then** it never shows the App Tracking Transparency prompt, never
   reads the advertising identifier, and never derives a device identifier.

---

### User Story 2 - The soft launch ends on its set date with a decision for each channel (Priority: P1)

On day 30, day 60 and day 90 of the soft launch, the founder opens one dashboard. For each source it shows installs,
sign-ups, activation, trial starts, paid by day 35 and retention, next to the business plan's benchmarks. Each paid or
tested channel shows one of four states: scale, keep, stop, or not enough data.

**Why this priority**: The business plan's gate is concrete (section 8.0, call 3). Pool the Apple Ads installs from months 1
to 3. If 4.5% or more of them pay by day 35, paid ads scale. Without a dashboard that reads that number honestly,
the gate is a guess.

**Independent Test**: Load a fixture of cohorts with known rates. The dashboard shows each stage, hides cells under the
privacy floor, and shows the decision state that the decision rule (FR-014) gives for each channel.

**Acceptance Scenarios**:

1. **Given** a channel whose paid-by-day-35 share has a 95% interval entirely at or above its threshold, **When** the
   dashboard is read, **Then** that channel shows "scale".
2. **Given** a channel whose interval is all below its threshold, **When** the dashboard is read, **Then** it shows
   "stop".
3. **Given** a channel with fewer installs than the floor, or an interval that crosses the threshold, **When** the
   dashboard is read, **Then** it shows "not enough data", never "stop".
4. **Given** a cell with fewer than 10 people, **When** the dashboard is read, **Then** the number is hidden.
5. **Given** the soft launch end date is in the past, **When** anyone tries to move it, **Then** the change needs a recorded
   owner ruling, and the dashboard shows the original date and the ruling.

---

### User Story 3 - A cook invites a friend and both get 30 days of Pro (Priority: P2)

A Free cook taps "Invite a friend" and shares a link by text. The friend opens it, signs up, saves a recipe and plans a
dinner. At sign-up, the friend gets 30 days of Pro. Once the friend is active, the inviter gets 30 days of Pro. Neither
of them enters a card.

**Why this priority**: Referral is one of the five organic channels the plan relies on (section 8.4.2). It costs
revenue forgone, about $8.33 to $9.99 of list price a month per reward, not cash (section 8.4.7). The plan turns it on
in days 61 to 90, after measurement works, so it is P2.

**Independent Test**: An inviter shares a link. A new person signs up through it on each platform and activates. Both
accounts show Pro features for 30 days, then return to Free with every private recipe still private.

**Acceptance Scenarios**:

1. **Given** a signed-in cook, **When** they open "Invite a friend", **Then** they see their link, their code, what both
   people get, when, the yearly cap, that the reward is not cash, and that it adds no AI uses.
2. **Given** a friend who opens the link and signs up on the web, **When** the account is created, **Then** the
   invite is recorded on the account and the friend's 30 days start once their email is verified and the one-person
   check passes.
3. **Given** a friend who installs the iPhone app after opening the link, **When** they reach sign-up, **Then** the
   app offers a one-tap paste control and a field to type the code, and sign-up never needs either.
4. **Given** a friend who signs up but does not activate within 30 days, **When** the window ends, **Then** the
   inviter earns nothing and the inviter's screen says so without naming the friend.
5. **Given** a friend who activates, **When** they qualify, **Then** the inviter's reward is earned and applied on the
   inviter's billing rail (User Story 4).
6. **Given** reward time is ending, **When** 3 days are left, **Then** the cook gets an in-app notice that it ends on a
   date, that nothing will be charged, and what happens to private recipes.
7. **Given** an inviter with 12 rewards in the last 12 months, **When** they open the invite screen, **Then** it says
   the cap is reached. It gives the date of the next possible reward. Invites still work for the friend.

---

### User Story 4 - The reward reaches the cook however they pay (Priority: P2)

An inviter pays for Pro on Android. Another pays on iPhone. A third pays on the web. A fourth is on Free. Each friend
qualifies on the same day. Each inviter gets the same value. A payer gets 30 more days of their plan. A cook who does not pay
gets 30 days of Pro features.

**Why this priority**: A reward that works only for Free cooks punishes the cooks most likely to recommend us. The
stores make this hard, so the rule for each rail must be decided before build.

**Independent Test**: Grant a reward to one test account on each rail. The Android payer's next charge moves 30 days
later with no action. The web payer's next charge moves 30 days later. The iPhone payer sees a "Claim your free month"
card and accepts it with one tap. The Free cook has 30 days of Pro features. Nobody is charged early or twice.

**Acceptance Scenarios**:

1. **Given** a cook with no active paid plan, **When** a reward is earned, **Then** a RevenueCat promotional
   entitlement gives Pro features for 30 days, on every platform, with no store action.
2. **Given** a cook paying through Google Play, **When** a reward is earned, **Then** the server defers the next charge
   by 30 days and the account screen shows the new date.
3. **Given** a cook paying through Stripe, **When** a reward is earned, **Then** the next charge moves 30 days later and
   the account screen shows the new date.
4. **Given** a cook paying through the App Store, **When** a reward is earned, **Then** the reward waits as "Ready to
   claim", and the iPhone app shows a card that opens Apple's offer sheet. On the web or Android the same cook sees
   "Open Commise on your iPhone to claim".
5. **Given** a cook with reward time running, **When** they buy a plan, **Then** the remaining days are not lost. They
   are moved onto the new paid rail by the rule for that rail.
6. **Given** a rail call fails, **When** the reward cannot be applied, **Then** the reward stays earned, the cook sees
   "We are adding your free month" and the server retries. A reward is never applied twice.

---

### User Story 5 - People can join a waitlist before beta (Priority: P2)

Before beta, a person who sees a Commise video can leave an email to be invited. They open a link in an email to finish. They can also
tick a box to say they are open to a talk with the team.

**Why this priority**: Beta recruits from a waitlist (`beta-exit-criteria.md` and the business plan's section 8.5.1).
It must exist before beta opens, so it is needed early, but it is a small surface.

**Independent Test**: Join the waitlist with a UTM link and reply to the email link. Then create an account with the same email.
The account inherits the source and the research consent, and the waitlist row is deleted.

**Acceptance Scenarios**:

1. **Given** a visitor on the waitlist page, **When** they submit an email, **Then** a verification email is sent. Nothing
   is stored as consent before they open its link.
2. **Given** an unconfirmed entry, **When** 7 days pass, **Then** it is deleted.
3. **Given** a verified entry that opted in to research contact, **When** staff open the research list, **Then** the
   entry appears with its answers and no other personal data.
4. **Given** a verified entry, **When** the person creates an account with the same verified email, **Then** the
   entry's source and consent move to the account with a notice, and the waitlist row is deleted.
5. **Given** any waitlist email, **When** the person taps unsubscribe, **Then** the entry is deleted at once.

---

### User Story 6 - A cook can offer to talk to the team (Priority: P2)

An active cook sees a small card: "Help shape Commise. Talk to us for 30 minutes." They tap it, read what it means,
answer four short questions and agree. Later they change their mind and withdraw in settings.

**Why this priority**: The business plan asks for 15 to 20 interviews before launch, aimed at the question of which
problems people pay to solve (section 8.5.1). Real interviews are the only thing that turns our desk research into
`S` evidence (`docs/research/userNeeds/README.md`).

**Independent Test**: Opt in from the card, see the consent record in settings, withdraw, and see that the cook is gone
from the staff research list.

**Acceptance Scenarios**:

1. **Given** an active cook whose recorded age basis is 18 or older, **When** they open the card, **Then** they see
   what contact means, what the thank-you is, how long the data is kept and how to withdraw.
2. **Given** a cook under 18 or with no adult age basis, **When** the app decides whether to show the card, **Then**
   it is never shown.
3. **Given** a cook who agrees, **When** they submit, **Then** a consent record for "research contact" is stored with
   the wording version and the time.
4. **Given** a cook who dismisses the card, **When** they use the app later, **Then** it never comes back. The opt-in
   stays reachable in settings.
5. **Given** a cook who withdraws, **When** staff open the research list, **Then** the cook is not in it.

---

### Edge Cases

- **The invite link lands on the sign-in page.** `001-FR-045a` sends signed-out visitors to sign-in. The invite code and
  every UTM parameter must survive the redirect to sign-in and the step from sign-in to sign-up. A code lost there is a
  reward lost.
- **The friend already has an account.** The landing page says invites are for new people. The friend is not told
  anything about the inviter's account, and the inviter learns nothing.
- **The friend erased an old account and signs up again.** The one-person check of `010-FR-041h` decides. If that check
  cannot tell, the cap of 12 rewards a year bounds the loss. No erased person's data is kept for this purpose beyond
  what the trial check already keeps.
- **The inviter shares their own code with their own second account.** The one-person check refuses the second
  account's reward, and the inviter earns nothing from it.
- **The friend joins the inviter's household.** A household member already gets Pro through a paying household
  (`017-FR-034a`). At the moment the friend qualifies, they must not be in the inviter's household. Otherwise the
  inviter earns no reward (FR-030).
- **The inviter erases their account before the friend qualifies.** The friend keeps their own reward. The inviter's
  reward is never earned, and the friend is not told why.
- **The friend erases their account after qualifying.** The inviter keeps the reward already earned. The ledger keeps
  no friend identity after erasure.
- **An App Store payer never taps "Claim".** The reward stays ready to claim with no expiry. If they stop paying before
  they claim, it becomes reward time automatically.
- **A cook has reward time and then cancels a store plan.** Reward time and the paid period run side by side in
  RevenueCat. The account screen shows both end dates.
- **A Stripe or Play deferral succeeds but the reply is lost.** The next attempt reads the subscription's current
  charge date first. If the deferral already landed, it does nothing.
- **A market needs consent for attribution.** The market's switch can say that consent is needed. Without that
  consent, the account gets no attribution record, and the source counts as `unknown` (FR-046).
- **A creator posts an invite link publicly with no disclosure.** The share text includes the disclosure by default.
  The invite screen tells cooks to keep it in any public post (FR-033).
- **Two signals disagree.** An Apple Ads token says `apple_ads` and the cook also typed an invite code. The invite code
  wins, because it is the most specific signal. The rule is a fixed order (FR-006).
- **The dashboard is read on day 31 for cohort 1.** Day-35 paid is not mature yet. The cell shows "not mature" until
  day 35 is past for every install in it.
- **The soft launch has very low volume.** Every channel stays at "not enough data". That is a valid result. The plan's
  own fallback applies: every cohort pays $99.99 and the price test does not start (business plan section 8.5.3).

## Requirements _(mandatory)_

### Functional Requirements

#### A. Attribution of installs and sign-ups

- **FR-001**: The system MUST record, for each account, one first-touch source, the signals that produced it, the
  platform of sign-up, and the time. It is written once, during sign-up or within 24 hours after, and never rewritten
  after that.
- **FR-002** (web): The web app MUST read `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` and an invite code
  from the first page a visitor lands on. It MUST keep them in first-party session storage only. It MUST carry them
  through the redirect to sign-in and the move from sign-in to sign-up (`001-FR-045a`). The app sends them to the
  server once, at account creation. No third-party cookie, pixel or tag is used.
- **FR-003** (store links): Every link from our web pages, emails and posts to a store MUST carry a source.
    - App Store links carry the App Store Connect campaign parameters: `pt`, the provider token, and `ct`, a campaign
      token of at most 30 characters. App Store Connect reports these in aggregate. A campaign shows after 5 first-time
      downloads. Source: [Apple, manage campaigns](https://developer.apple.com/help/app-store-connect/view-app-analytics/manage-campaigns).
      They never reach the app, so they are reported beside our data, not joined to accounts.
    - Google Play links carry a `referrer` string holding the UTM parameters and any invite code.
- **FR-004**: The source MUST be one value from a closed list, kept in one place. Adding a value is a change to this
  spec. The values are:
    - stores and ads: `app_store_search`, `apple_ads`, `play_store_search`, `google_ads`,
    - people and posts: `organic_social` (with a platform), `creator` (with a creator code), `referral`, `press`,
      `product_hunt`,
    - web and lists: `web_search`, `web_direct`, `waitlist`,
    - fallbacks: `self_reported` (with the answer) and `unknown`.
- **FR-005** (mobile signals): On the first open after install, the app MUST read each signal its platform offers,
  once:
    - **Android**: the Play Install Referrer: the referrer string, the click time and the install-begin time
      ([Android Install Referrer](https://developer.android.com/google/play/installreferrer/library)). The data is
      available for 90 days after install, so it is read on first open, not later.
    - **iPhone, Apple Ads**: the AdServices attribution token, sent once to our server, which asks Apple's attribution
      service for the campaign. This needs no App Tracking Transparency prompt.
    - **iPhone, other ad networks**: AdAttributionKit, with conversion values that encode the funnel stage reached
      (sign-up, activation, trial start, paid). It works on iOS 17.4 and later. It gives aggregate postbacks with no
      user-level data. It needs no tracking prompt. Source:
      [Apple ad attribution](https://developer.apple.com/app-store/ad-attribution/). Set it up only for the first
      approved non-Apple ad campaign.
    - **Both**: a universal link or app link opened after install, carrying a campaign or invite code.
- **FR-006**: When signals disagree, the source MUST follow one fixed order: invite code, then Apple Ads token, then
  install referrer, then web UTM, then universal link campaign, then the cook's own answer, then `unknown`. The order
  lives in one pure function.
- **FR-007**: A sign-up with no signal can show one optional question, "How did you hear about Commise?", with closed
  choices that map to the source list and a "Skip" with equal weight. It is shown once, never blocks sign-up, and its
  answer is recorded as `self_reported`.

#### B. Funnel, dashboard and the soft launch

- **FR-008**: The funnel stages MUST be defined once, as follows (business plan section 8.6):
    - **Install**: first open of the app. On the web there is no install, so the web funnel starts at sign-up.
    - **Sign-up**: account created.
    - **Activation**: a recipe saved, imported or written, plus one meal plan, grocery list or cooking-mode action,
      within 7 days of sign-up. The business plan marks this definition as proposed. Changing it is a change here.
    - **Trial start**: the 14-day trial started (`010-FR-041h`).
    - **Paid by day 35**: paying, counted from install, or from sign-up on the web. Paid status comes from RevenueCat.
    - **Retention**: opened the app on day 1, day 7 and day 30, and paid retention at each renewal.
- **FR-009**: Stage events MUST be derived on the server from records that already exist wherever they can be: account
  creation, recipe saves, plans, lists, cooking sessions and RevenueCat events. A client event is added only where no
  server record exists: first open, and the day-1, day-7 and day-30 opens.
- **FR-010**: The system MUST provide a soft-launch dashboard for staff, on the web only, gated by a dedicated staff
  scope. It shows each stage by source, platform and install-week cohort, and the business plan's benchmarks beside
  them:
    - paid by day 35: P10 0.3%, ReciMe-equivalent 0.51%, median 2.1%, top quartile 4.5% (business plan section 8.6),
    - day 1, 7 and 30 activity for Food and Drink: 22.9%, 18.9% and 7.9%,
    - beta's internal targets for day 1, 7 and 28 retention: 35%, 18% and 10% (`beta-exit-criteria.md`),
    - the share of Free cooks who reach the 50-slot cap, and imports per active user (section 8.5.2, readings 4 and 5).
- **FR-011**: Any dashboard cell that counts fewer than 10 people MUST be hidden, and a total MUST NOT let a hidden cell
  be worked out by subtraction.
- **FR-012**: The soft launch MUST have a start date and an end date, recorded before it starts, in one place the
  dashboard reads. Moving the end date needs a recorded owner ruling, and the dashboard shows both dates and the
  ruling. The dates are [NEEDS CLARIFICATION: the owner sets the calendar start and end of the soft launch. The plan
  says months 1 to 3 after billing goes live, with public launch in month 4].
- **FR-013**: The thresholds MUST come from the business plan and be stored with their source:

    | Channel or reading              | Threshold                                                                      | Source                   |
    | ------------------------------- | ------------------------------------------------------------------------------ | ------------------------ |
    | Apple Ads, pooled months 1 to 3 | Scale at 4.5% or more paid by day 35. Below it, stay a capped test or stop     | Section 8.0, call 3      |
    | Creator posts                   | Keep at or under $2.19 per install, the Apple Ads cost per install             | Sections 8.4.1 and 8.5.5 |
    | Referral                        | Keep while reward cost per referred payer is under $84, the iOS cost per payer | Sections 8.4.1 and 8.4.7 |
    | Referral share-action rate      | Reported against 4.64%, a top-quartile reference (weak source)                 | Section 8.4.1            |
    | Organic installs a month        | Reported against 75 (typical) and about 2,688 (top decile, both price arms)    | Sections 8.5.3 and 8.10  |
    | Every cohort's paid by day 35   | Reported against the band in FR-010 and the proposed target of 2.0%            | Section 8.5.2            |

    The organic decision is the owner's at month 6, as the plan says. The dashboard reports. It does not decide.

- **FR-014**: A channel's decision state MUST follow one rule, so a small sample never kills a channel:
    - Below a floor of 100 installs, the state is "not enough data". The state is the same before day 35 is past for
      every install counted.
    - Above the floor, the rule reads the 95% Wilson interval. A lower bound at or above the threshold gives "scale".
      An upper bound below the threshold gives "stop". Anything else gives "keep".
    - The rule is a pure function. The dashboard shows the interval beside the state.
- **FR-015**: The dashboard MUST show three checkpoints, day 30, day 60 and day 90, each with the question the business
  plan asks at that point (section 8.5.5): do the funnel events fire correctly, which content converts, and is cohort 1
  ready for public launch.

#### C. Referral

- **FR-016**: Every signed-in cook, on any plan, MUST be able to invite from a screen reachable in two taps from
  settings and from the share menu of a recipe. The screen shows a link, a code, a share button and a summary of the
  rules. The program can be switched off per market (`016-FR-048`), and while it is off no entry point shows.
- **FR-017**: An invite code MUST be short, use no characters that are easy to confuse, and be public and non-secret.
  A cook can replace their code. The old code then stops attributing new sign-ups. A code never unlocks anything. The
  server decides every reward from the rules below.
- **FR-018**: The invite code MUST be able to reach the friend's account in each of these ways, and in no way that
  identifies a device:
    - **Web sign-up**: the code rides FR-002's path into the account.
    - **App installed**: the link opens the app through a universal link or app link, which carries the code.
    - **Android, app not installed**: the landing page sends the friend to Google Play with the code in the
      `referrer` string. The app reads it on first open (FR-005).
    - **iPhone, app not installed**: the landing page shows the code, a "Copy code" button and the App Store button.
      In the app, sign-up offers Apple's system paste control. It reads the clipboard only on the friend's tap.
      Sign-up also offers a field to type the code.
    - **Late entry**: a friend can add a code in settings up to 7 days after sign-up.
- **FR-019**: The landing page for an invite MUST work signed out and MUST NOT name the inviter unless the inviter chose
  to show their display name on invites. It states what the friend gets and the rules in plain words.
- **FR-020**: The friend's reward MUST be 30 days of Pro. It starts once the friend's email is verified and the friend
  passes the one-person check (FR-028).
- **FR-021**: A friend is **qualified**, and the inviter's reward is earned, at the moment all of these hold:
    - the friend's account was created through the invite, or the code was added within FR-018's 7 days,
    - the friend passes the one-person check,
    - the friend reached activation (FR-008) within 30 days of sign-up,
    - at that moment, the friend is not in the inviter's household (FR-030),
    - the inviter's account still exists and is under the yearly cap (FR-029).
- **FR-022**: The inviter's reward MUST be applied by section D. A payer gets 30 more days of their own plan. A cook
  who does not pay gets 30 days of Pro features.
- **FR-023**: The inviter's screen MUST show counts, not people: invites that signed up, waiting to become active,
  rewards earned, rewards applied and rewards ready to claim. A friend's name shows only by that friend's own choice
  to show it to their inviter.
- **FR-024**: No reward is AI uses, and no reward raises a cook's AI allowance above their own plan. Reward time for a
  cook who does not pay carries Free's AI allowance (3 uses). It uses the separate plan and credit levels that
  `010-FR-041b` already requires the entitlement model to name. A paying cook's deferred month keeps their own plan's
  allowance, because it is the plan they pay for, moved later. While ADR-0024's $100 ceiling stands, no copy can
  promise AI uses as a reward. When the owner amends the ceiling for launch, this rule is revisited by a change here.
- **FR-025**: Reward time MUST NOT be a trial. It needs no card, never renews, never charges, and does not use the
  one lifetime trial of `010-FR-041h`. A friend who ends reward time can still start their trial later.
- **FR-026**: When reward time ends, the cook returns to their own plan. Every private recipe stays private. A cook with
  more than 50 falls under the over-limit rule of `010-FR-043a`. The invite screen and the 3-day notice say this
  before it happens.

#### D. How a reward reaches each billing rail

- **FR-027**: One reward ledger MUST record each reward once: who, why (friend reward, inviter reward, research thanks),
  the days, the state and the rail used. Applying a reward is a Command on that record, and the rail is chosen by the
  cook's billing state at that moment:

    | Cook's billing state              | Mechanism                                                                                                                                                                                                                                                                                                                                                        | Cook action       |
    | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
    | No active paid plan, any platform | RevenueCat promotional entitlement with an end time 30 days after the current end of any reward time. It is "purely a RevenueCat concept" and does not touch a store ([RevenueCat entitlements API](https://www.revenuecat.com/docs/api-v1/entitlements))                                                                                                        | None              |
    | Paying through Google Play        | `purchases.subscriptionsv2.defer` by 30 days. Google says billing "can be deferred by as little as one day and up to a year per API call". The user is not charged. Source: [Google Play](https://developer.android.com/google/play/billing/manage-purchases).                                                                                                   | None              |
    | Paying through Stripe             | Move the next charge 30 days later with Stripe's trial mechanism, with no proration. Stripe calls `trial_end` a legacy parameter and points to its Trial Offer API, so the plan picks one ([Stripe trials](https://docs.stripe.com/billing/subscriptions/trials))                                                                                                | None              |
    | Paying through the App Store      | A free promotional offer of one month, accepted through StoreKit in the app. Promotional offers are "for existing and previously subscribed customers" and the customer accepts them in the app ([Apple promotional offers](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-promotional-offers-for-auto-renewable-subscriptions)) | One tap on iPhone |
    - A coupon with `duration=once` is not used on Stripe, because on a yearly plan it gives a free year.
    - Google Play promo codes are not used. They give "a free trial of between 3 and 90 days", not free time on an
      active plan. Source: [Google Play promo codes](https://support.google.com/googleplay/android-developer/answer/6321495).
    - Apple offer codes for existing subscribers are the fallback. They replace promotional offers only after a failed
      plan-time check (FR-027d).
      "Existing subscribers can only redeem codes that are an upgrade from or at the same level as their current
      subscription". Source: [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/).

- **FR-027a**: Each rail's adapter MUST be idempotent. It reads the subscription's current state before it acts, and
  does nothing for a reward that already landed. A rail failure leaves the reward earned and retried, never lost and
  never doubled.
- **FR-027b**: A reward that is "Ready to claim" on the App Store MUST NOT expire while the account exists. If the cook
  stops paying before claiming, the server applies it as reward time instead.
- **FR-027c**: When a cook with reward time running buys a plan, the server MUST move the remaining days onto the new
  rail by the table above, and end the promotional entitlement. On the App Store the remaining days become a reward
  ready to claim.
- **FR-027d**: Two facts MUST be verified at plan time, because only forum answers support them. First, does a free
  Apple promotional offer, bought by an active subscriber, start at the next renewal? Second, can a free one-month offer
  attach to a yearly product? If either answer is no, the App Store row uses offer codes instead.
- **FR-027e**: The effective plan a cook has MUST be computed in one place, from their own RevenueCat entitlement, any
  promotional entitlement and any household coverage (`017-FR-034b`). It feeds the tier claim of `010-FR-044` and
  fails closed to Free.

#### E. Fraud and abuse limits

- **FR-028**: The one-person check MUST be the same check that enforces one trial per person ever (`010-FR-041h`,
  ADR-0075 §6). A person who has had an account, a trial or a paid plan is not new, and earns no friend reward and no
  inviter reward. This spec adds no second identity check.
- **FR-029**: An inviter MUST earn at most 12 rewards in any rolling 12 months. At 30 days each, the most one cook can
  receive in a year is about one year of Pro, $119.88 at the Pro monthly list price.
- **FR-030**: An inviter MUST NOT earn a reward for a friend who is an active member of the inviter's household at the
  moment the friend qualifies.
- **FR-031**: The system MUST NOT use device fingerprinting, IP address and user-agent matching, probabilistic
  matching, or any identifier derived from the device, for referral or for attribution. Apple's rule reads: "you may not
  derive data from a device for the purpose of uniquely identifying it". Source:
  [Apple user privacy](https://developer.apple.com/app-store/user-privacy-and-data-use/). The limits above bound abuse.
- **FR-032**: Staff MUST be able to see referral counts per inviter and revoke rewards that broke the rules, from the
  staff tooling, with each action attributed to the staff member. A revoked reward that is already applied on a store
  rail is not clawed back from the store. It is recorded.

#### F. Disclosure, store rules and tax

- **FR-033**: The share text MUST include a disclosure by default, for example "Join Commise with my link and we both
  get a free month of Pro." The invite screen MUST tell the cook to keep a disclosure in any public post. The FTC's
  Endorsement Guides require disclosure of a connection that "might materially affect the weight or credibility" of an
  endorsement. The advertiser must also take steps so that people disclose. Source:
  [16 CFR 255.5](https://www.law.cornell.edu/cfr/text/16/255.5). Final wording is `clo`'s.
- **FR-034**: A reward MUST NEVER be tied to a review, a rating, a social post's content or any sentiment. The invite
  flow MUST NOT ask for a review. No store review prompt can show in the same session as a reward grant. The FTC rule
  bans incentives for reviews that require a positive or negative sentiment. Source:
  [FTC Q&A on 16 CFR Part 465](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers).
  Apple guideline 5.6.3 forbids manipulating "charts, search, reviews, or referrals". Google forbids rewards for
  ratings or reviews. Source: [Google Play](https://support.google.com/googleplay/android-developer/answer/9898684).
- **FR-035**: A reward MUST be non-cash, non-transferable and not exchangeable for money. The program terms MUST be a
  versioned document (`016-FR-003`), shown before a cook's first invite, and changeable with notice. Ending the program
  never takes back a reward already earned.
- **FR-036**: The yearly cap (FR-029) keeps one cook's reward value at about $119.88 at list. Whether that value
  creates any tax reporting or sales tax duty is a question for the tax adviser and counsel (section I). Cash and gift
  cards are not used as rewards, so no tax form is collected from cooks.

#### G. Waitlist and interview recruitment

- **FR-037**: Before beta, the system MUST offer a waitlist. On the web it is a form that takes an email, captures the
  source by FR-002, and sends a verification email. The form lives on [NEEDS CLARIFICATION: the marketing site's host is
  an open owner decision (business plan section 8.11.1, item 2). The signed-out root of commise.app is sign-in
  (`001-FR-045a`), so the form cannot sit there]. On the stores, interest is captured by App Store pre-orders and
  Google Play pre-registration, which notify people without giving us their data.
- **FR-038**: A waitlist entry MUST be stored as consent only after the email is verified. An unverified entry is
  deleted after 7 days. A verified entry is deleted at the first of three events: unsubscribe, 30 days after an unused
  beta invite, or 12 months after verification. A waitlist entry has no account, so this deletion path is its
  own and does not rely on account erasure.
- **FR-039**: When a person creates an account with the verified email of a verified waitlist entry, the entry's
  source and research consent MUST move to the account with an in-app notice, and the entry MUST be deleted.
- **FR-040**: The system MUST offer an opt-in to talk to the team: a dismissible card shown once, after activation, and
  an entry in settings. It is never shown during onboarding and never as a modal. It is shown only to accounts whose
  age basis (`016-FR-008`) is 18 or older.
- **FR-041**: Before the cook agrees, the opt-in MUST explain five things:
    - what contact means: an email from the team about a 30-minute call,
    - the thank-you (FR-043),
    - that a recording needs a separate consent at the call,
    - how long the data is kept: until withdrawn, or 12 months,
    - how to withdraw.

    Agreeing records a consent for the purpose "research contact" (`016-FR-007`), with the wording version and time. Withdrawal is in settings (`016-FR-035`) and takes
    effect at once.

- **FR-042**: The opt-in can ask up to four screening questions with closed answers: how often they cook, household
  size, which recipe apps they use, and which platform. It MUST NOT ask about diet, allergies, health or religion,
  because those are special-category data (`016-FR-036`).
- **FR-043**: The thank-you for a completed interview MUST be 3 months of Pro, applied through the reward ledger
  (section D) by a staff action. It MUST NOT depend on what the cook said.
- **FR-044**: Staff MUST be able to see the research list (opted-in cooks and waitlist entries, with screener answers
  and contact email only) from the staff tooling, gated by the same staff scope as FR-010. The list supports picking a
  spread across segments. Scheduling happens outside the product.

#### H. Privacy, consent and erasure

- **FR-045**: Nothing in this feature is tracking in Apple's sense. Apple defines tracking as: "linking user or device
  data collected from your app with ... other companies' apps, websites, or offline properties for targeted
  advertising or advertising measurement". Source:
  [Apple user privacy](https://developer.apple.com/app-store/user-privacy-and-data-use/). So the app
  MUST NOT request App Tracking Transparency. It MUST NOT read the advertising identifier on iOS or Android. It MUST
  NOT share account-level data with an ad network. A change that needs ATT is a change to this spec.
- **FR-046**: The attribution record is personal data. Its purpose is product measurement. The privacy notice MUST say
  so. Each market can switch the record off (`016-FR-048b`). A market can need consent. Without that consent, no
  record is written and the source counts as `unknown`. The soft launch runs in the US only, as web billing does
  (ADR-0075 §3).
- **FR-047**: Account erasure MUST delete the attribution record, the invite code, research consent, screener answers,
  and every reward ledger row's link to the person. Counts already added to aggregates stay, with no identity. Otherwise
  the attribution record is deleted 14 months after sign-up. By then the earliest cohort's first annual renewal is
  read. `identity-db`'s erasure coverage test MUST fail for any user-keyed table this feature adds that
  erasure misses.
- **FR-048**: This feature MUST NOT add a third-party SDK that collects a device identifier, fingerprints, or sends
  account-level data off our systems. Which analytics store holds the stage events is a plan-time decision for
  `staff-architect`, under this rule.

#### I. Changes to other specs (owed, not applied here)

This change does not edit 001, 016 or the cross-feature FR index. These items are recorded for their owners:

- **016-FR-050 gains six counsel items**:
    - **Referral terms and the FTC.** The disclosure wording for share text, and what monitoring of public posts is
      enough under 16 CFR 255.5. **What breaks**: without it, an undisclosed public post is our liability.
    - **Apple guideline 3.1.1.** It says apps "may not use their own mechanisms to unlock content or functionality,
      such as license keys". Reward time is granted by our server and no code unlocks it. Counsel and App Review
      agree on this reading before launch. **What breaks**: App Review can disagree. Then the "no active paid plan" row on
      iPhone moves to Apple offer codes. Those start a renewing subscription, so `010-FR-041h`'s card and notice rules
      apply.
    - **Tax on reward value.** Whether non-cash Pro time worth up to $119.88 a year per cook creates information
      reporting or sales tax duties. **What breaks**: a duty we did not plan for.
    - **Attribution consent outside the US.** Whether reading the install referrer and storing UTMs needs consent
      under ePrivacy rules before any EU or UK market opens. **What breaks**: attribution without a lawful basis.
    - **Research recruitment.** The consent wording, the 12-month retention and the thank-you. **What breaks**: a
      research contact list kept without a valid consent.
    - **Waitlist.** The verification email and the retention limits in FR-038. **What breaks**: marketing email sent
      without consent.
- **001-FR-045a**: no wording change. Its sign-in front door must carry invite codes and UTMs to sign-up (FR-002).
  Its owner checks that the redirect keeps query parameters.
- **010**: `010-FR-044`'s claim publishes the effective plan of FR-027e, which now includes promotional entitlements
  and household coverage. The design is owed in 010's plan, and the 2026-10-27 household amendment there records it.
- **Cross-feature FR index**: entries for this spec are owed under `GR-003`.

### User-facing states _(every one is designed by `staff-ux-engineer` before build)_

Each state ships on web and mobile in the same release (`001-FR-044a`), with its copy and its localization key. The
dashboard and the research list are staff tooling and web only.

| Surface               | States                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invite screen         | First visit with the rules summary. Ready (link, code, share). Cap reached, with the next date. Program off in this market. Offline (link shown, sharing waits). Error |
| Invite progress       | Empty. Signed up, waiting to become active. Earned. Applied. Ready to claim (App Store). Adding your free month (retrying). Not earned (friend did not activate)       |
| Invite landing (web)  | Valid code. Code replaced or unknown. Your own code. You already have an account. Signed in already. Market not served                                                 |
| Code entry in the app | Empty. Paste control. Valid. Not valid. Not eligible (not a new person). Too late (after 7 days)                                                                       |
| Reward notices        | Reward time started. 3 days left, nothing will be charged. Reward time ended. Next charge moved to a date                                                              |
| Claim on iPhone       | Ready to claim. Apple sheet cancelled. Apple sheet failed. Claimed. Shown on web or Android: open the iPhone app to claim                                              |
| Source question       | Shown once. Answered. Skipped                                                                                                                                          |
| Waitlist              | Empty. Email not valid. Sent, check your email. Verified. Already on the list. Unsubscribed. Error                                                                     |
| Talk to the team      | Card. Opt-in form. Agreed. Dismissed. Withdrawn. Not shown (under 18)                                                                                                  |
| Soft-launch dashboard | Loading. Not mature. Not enough data. Hidden cell. Scale. Keep. Stop. Error                                                                                            |

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`, with no `any` outside marked test doubles. Source,
  funnel stage, reward reason, reward state, rail and decision state are closed unions. (Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc. The source order (FR-006), the qualification
  rule (FR-021), the rail choice (FR-027) and the decision rule (FR-014) are pure modules that name the pattern they
  implement. (Principle II)
- **NFR-003**: Every surface MUST expose accessible names queryable by `getByRole`/`getByLabel`. (Principles IV and VII)
- **NFR-004**: Colour MUST NOT be the only way a state is shown, including the dashboard's decision states. (Principle
  VII)
- **NFR-005**: Every cook-facing string, including share text and email, MUST go through the localization path.
- **NFR-006**: No deceptive pattern on any surface. The invite card, the source question and the research card each
  have a dismiss with equal weight, and none repeats after it is dismissed. (CLAUDE.md, `staff-ux-engineer` rule 3)

### Offline Behavior _(GR-005 declaration)_

- **Offline scope**: the invite screen shows the cook's link and code from the last load. Sharing uses the OS share
  sheet, which works offline for apps that queue messages. Claiming, code entry and the opt-in need a connection.
- **Persistence**: the first-open signals (FR-005) are read once and kept on the device until sign-up sends them. No
  other new device storage.
- **Sync**: signals are sent with the sign-up request. A sign-up made offline waits in the existing outbox
  (ADR-0057) with its signals.
- **Conflict**: the first-touch source is written once (FR-001), so a second device cannot overwrite it.

### Key Entities

- **Attribution Record**: one per account. First-touch source, signals, platform, sign-up time. Deleted at erasure or
  after 14 months.
- **Funnel Stage Event**: one stage reached by one account, derived from server records where possible.
- **Soft Launch**: the start date, end date, thresholds with their sources, and any owner ruling that moved a date.
- **Invite Code**: a cook's current public code and its replaced codes.
- **Referral**: one friend's sign-up through one invite, its qualification state and its deadline.
- **Reward**: one entry in the reward ledger. Who, why, days, state (earned, applying, applied, ready to claim,
  revoked) and the rail used.
- **Waitlist Entry**: an email with its verification state, source, research consent and screener answers. Not an
  account.
- **Research Consent**: a consent record for "research contact" under `016-FR-007`, with screener answers.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In the first 30 days of the soft launch, at least 95% of sign-ups on Android and web carry a source other
  than `unknown`. iPhone is reported separately, because most iPhone installs have no account-level signal by design.
- **SC-002**: Every account in a fixture of known sources is attributed to the right source on every platform, with
  zero App Tracking Transparency prompts and zero reads of an advertising identifier.
- **SC-003**: The dashboard's decision state matches the decision rule (FR-014) on every fixture cohort, including the
  boundaries of the interval.
- **SC-004**: Zero rewards are applied twice, and zero earned rewards are lost, across a test that fails each rail's
  call once and replays it.
- **SC-005**: A reward reaches each of the four billing states in the FR-027 table, and the next charge date or end
  date moves by exactly 30 days.
- **SC-006**: The soft launch ends on its recorded date, or on a date set by a recorded owner ruling. It never slides
  without one.
- **SC-007**: At least 15 cooks or waitlist members with a valid research consent are on the research list before
  public launch, spread across at least three household sizes and both mobile platforms.
- **SC-008**: Account erasure leaves no attribution record, invite code, research consent or reward link to the
  person, checked by the erasure coverage test.

## Assumptions

1. **The soft launch is US only.** Web billing starts US only (ADR-0075 §3), and the attribution consent question for
   other markets is a counsel item (section I).
2. **30 days for both people.** The business plan's design gives one free month to the inviter and the friend
   (section 8.4.7). 30 days is used so the reward is the same length on every rail.
3. **The friend's reward comes at sign-up, the inviter's at activation.** Giving the friend value early helps them
   activate. Making the inviter wait for activation is what makes fake friend accounts worthless.
4. **Reward cost is priced by `cfo-1`.** The plan prices it at $8.33 to $9.99 of list price a month before store fees
   (section 8.4.7).
5. **The activation definition is the plan's proposal.** It is used as written until real cohorts suggest a better
   one.
6. **Apple Ads is the only paid channel in the soft launch.** So AdAttributionKit waits for the approval of a second paid
   channel (FR-005).

## Plan-time dependencies

- **`staff-ux-engineer`**: DESIGN and SPECIFY for every surface in the states table, on phone, tablet and desktop,
  before any of it is built. EVALUATE before it is called done.
- **`staff-architect`**: the effective-plan computation across identity, RevenueCat and the household (FR-027e), the
  reward ledger and its rail adapters, and where stage events live (FR-048).
- **`ts-1` with `da-1`**: the event schema for FR-008 and FR-009, and the dashboard's queries.
- **`clo`**: the counsel items in section I.
- **`cfo-1`**: the reward cost and the thank-you cost.
- **`dpo-1`**: the retention periods in FR-047, FR-038 and FR-041.

## Out of Scope

- Paid acquisition beyond measuring it. Budget levels are the owner's.
- Public recipe pages, SEO and the marketing site. Each waits on an owner ruling.
- A mobile measurement partner, ad network SDKs and any cross-company identity.
- Creator revenue share and payouts. Those wait on 018.
- The interview process itself: the guide, scheduling, recording and synthesis.
- The price test. It is a job for RevenueCat Experiments, once volume allows it (business plan section 8.5.3).
