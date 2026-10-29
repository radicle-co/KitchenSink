# Feature Specification: Subscriptions & Monetization

**Feature Branch**: `010-subscriptions`
**Created**: 2026-04-14
**Last updated**: 2026-10-28
**Status**: Product decisions revalidated — implementation/test gate blocked pending V-Model regeneration and test execution.
2026-10-27: the three plans are **Free, Pro and Pro with AI**, and the paid plans are called "Pro" everywhere
(owner rulings 2026-10-26 and 2026-10-27). AI credits come in three levels, held by Free, Pro and Pro with AI: 3, 30
and 300 uses a month. See the [plan register](#plan-register) and the
[owner inputs still needed](#owner-inputs-still-needed). **Nothing links to a subscription page until this feature
ships** (`FR-042j`).
2026-10-28: the household is rebalanced (owner ruling: "Let's plan that for the household then"). Pro shares the
household's content, not the payer's personal Pro, and an optional household upgrade gives every member full Pro
(`FR-041j`). Retention and recovery work is added: grace periods per store (`FR-043`, `FR-043b`), the trial timeline,
lifecycle messages through 014, a monthly-to-yearly offer, a one-time discount, the trial checklist and the "what you
keep" screen. Two questions are open: [O-13](#o-13) and [O-14](#o-14).
**Input**: Split from `001-commise-recipe-app` — free/Pro tier definitions, feature gating, upgrade prompts, and subscription lifecycle.

## Dependencies

| Spec                                                                                                    | Relationship                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [002-user-auth](../002-user-auth/spec.md)                                                               | **Required** — subscription tier is a property of the authenticated user                                                                                              |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md)                                             | **Referenced** — gates private recipe visibility (001-FR-003)                                                                                                         |
| [004-recipe-importing](../004-recipe-importing/spec.md)                                                 | **Referenced** — gates clone-to-private for imported recipes (004-FR-011)                                                                                             |
| [005-ai-integration](../005-ai-integration/spec.md)                                                     | **Referenced** — gates AI generation and instruction optimization (005-FR-016, 005-FR-019); AI credits by plan (005-FR-015a to FR-015f)                               |
| [016-legal-compliance-framework](../016-legal-compliance-framework/spec.md)                             | **Required**: subscription disclosures and cancellation (016-FR-040–FR-044); counsel items (016-FR-050)                                                               |
| [ADR-0073](../../docs/architecture/decisions/0073-free-tier-private-slots.md)                           | **Required**: free cooks hold 50 private recipes; a downgrade never makes a private recipe public                                                                     |
| [ADR-0024](../../docs/architecture/decisions/0024-llm-spend-ceiling-reserve-then-settle.md)             | **Referenced**: the platform's monthly AI spend ceiling, which is not a cook's credits (`FR-041d`)                                                                    |
| [ADR-0075](../../docs/architecture/decisions/0075-payment-stack-store-billing-revenuecat-and-stripe.md) | **Required**: store billing, RevenueCat and Stripe sell the plans (`FR-042i`)                                                                                         |
| [006-meal-planning](../006-meal-planning/spec.md)                                                       | **Referenced** — gates AI meal suggestions, auto-generation, waste optimization (006-FR-025, 006-FR-026, 006-FR-027)                                                  |
| [007-grocery-lists](../007-grocery-lists/spec.md)                                                       | **Referenced** — gates online ordering (007-FR-031) and the Pro pantry (007-FR-034 to 007-FR-040, added 2026-10-27)                                                   |
| [009-nutrition-planning](../009-nutrition-planning/spec.md)                                             | **Referenced** — gates trainer nutrition planning (009-FR-038)                                                                                                        |
| [017-recime-parity](../017-recime-parity/spec.md)                                                       | **Required, amended 2026-10-28**: Pro shares the household's content, and the household upgrade covers every member (`017-FR-034` to `FR-034m`, `FR-041j`)            |
| [014-notification-service](../014-notification-service/spec.md)                                         | **Required, added 2026-10-28**: the trial notice, renewal notices and billing recovery go out by email, push and in-app (`014-FR-046` onward)                         |
| [008-cooking-mode](../008-cooking-mode/spec.md)                                                         | **Referenced, added 2026-10-28**: the store rating prompt after a finished recipe (`008-FR-036`) sits beside these prompts, and never shares a session with a paywall |
| [023-referrals-and-growth-measurement](../023-referrals-and-growth-measurement/spec.md)                 | **Referenced**: referral reward time reaches the cook through the plans and the store rails (`023-FR-027`)                                                            |

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Free and Pro Subscription Tiers (Priority: P3)

New users start on a free tier that provides core functionality: creating, viewing, editing, and deleting their own recipes (public by default, with up to 50 private, ADR-0073); sharing and cloning recipes; basic recipe importing; basic meal planning (manual assignment only); grocery list generation (without online ordering); and cooking mode. Pro features (private recipe visibility, AI recipe generation, AI meal plan optimization, food waste optimization, online grocery ordering, nutrition planning for clients, and AI instruction optimization) require a paid subscription.

**Why this priority**: The monetization model must be designed early but can be built incrementally. The free tier must deliver enough value to hook users without giving away the Pro differentiators.

**Independent Test**: Can be tested by verifying a free-tier user can access all basic features and sees appropriate upgrade prompts when attempting Pro features.

**Acceptance Scenarios**:

1. **Given** a new user signs up, **When** their account is created, **Then** they are on the free tier with access to all basic features. New recipes are public by default, and the cook can hold up to 50 private recipes ([ADR-0073](../../docs/architecture/decisions/0073-free-tier-private-slots.md)). _(Amended 2026-10-26.)_
2. **Given** a free-tier user holds 50 private recipes, **When** they try to make another private, **Then** the system refuses with the out-of-slots reason (`001-FR-003`). The free ways forward come first. The paid plans appear only while the subscription page is live (`FR-042j`). _(Amended 2026-10-26.)_
3. **Given** a free-tier user whose small AI allowance is used up, **When** they attempt to use AI recipe generation, **Then** they see a preview or teaser of the feature. The prompt to upgrade appears only while the subscription page is live (`FR-042j`). _(Amended 2026-10-26.)_
4. **Given** a free-tier user, **When** they attempt to use food waste optimization in meal planning, **Then** they are prompted to upgrade, but only while the subscription page is live (`FR-042j`). _(Amended 2026-10-26.)_
5. **Given** a user upgrades to a paid plan, **When** they use that plan's features, **Then** the features are available at once, with no private-recipe limit. _(Amended 2026-10-26: "premium" is now one of the paid plans in the [plan register](#plan-register).)_
6. **Given** a paid-plan user, **When** their subscription lapses, **Then** they keep all their data and every private recipe stays private. Nothing is made public or deleted ([ADR-0073 §4](../../docs/architecture/decisions/0073-free-tier-private-slots.md)). Paid features are locked until renewal. A cook who holds more than 50 private recipes cannot make a new recipe private until they hold fewer than 50. _(Amended 2026-10-26. Was: imported recipes stay public and no new recipe can go private until renewal.)_

---

### User Story 6 - The subscription page (Priority: P3)

A cook who meets a paid feature can open one page that explains the plans honestly, lets them choose one, and lets
them come back to exactly where they were. A subscriber uses the same page to see their plan, change it, or cancel
it. User Stories 2 to 5 live in [`tasks.md`](./tasks.md), so this story takes the number 6 to match its tasks.

**Why this priority**: The page is where money changes hands. Consumer law and the app stores regulate it. A dark
pattern here is a legal problem, not only a design problem (`016-FR-040` to `FR-044`).

**Independent Test**: Turn the switch on (`FR-042j`). Open the page from the recipe editor with unsaved changes. Close
it, and check that the changes are still there. Then check each state in `FR-042g`.

**Acceptance Scenarios**:

1. **Given** a cook has unsaved changes in the recipe editor, **When** they choose the paid-plan link in the publish dialog, **Then** the page opens as a modal over the editor. **When** they close it, **Then** every change is still there.
2. **Given** the page is open, **Then** it shows each plan's price, billing period, renewal terms, trial terms and contents. This comes before any payment step. No plan is chosen for the cook.
3. **Given** the page is open, **Then** "Not now" and the close control are always visible and look as strong as the buy buttons.
4. **Given** a cook leaves for checkout, **When** checkout ends in any way, **Then** the cook comes back to the screen they started from. Their work is intact.
5. **Given** a subscriber opens the page, **Then** it shows their plan, the next renewal date and amount, and a Cancel control. Cancelling takes no more steps than subscribing took.
6. **Given** a subscriber chooses another plan, **Then** the page states when the change takes effect and what they pay. It does this before they confirm.
7. **Given** paid features are hidden for the cook (`account.paidFeatures` is `hidden`), **Then** no entry point to the page is shown anywhere.
8. **Given** the device is offline, **Then** the page says so and offers no purchase.

---

### Edge Cases

- What happens when a Pro user downgrades — do they lose access to AI-generated recipes they already saved?
  _(Answered 2026-10-26: no. A saved recipe is the cook's recipe. A downgrade removes the ability to make new AI
  content, never content already saved. Private recipes stay private ([ADR-0073 §4](../../docs/architecture/decisions/0073-free-tier-private-slots.md)).)_
- A cook pays on one platform and opens the app on the other. The plan follows the account, not the device.
- A cook starts checkout, then closes the tab. On web the editor draft lives in `sessionStorage`
  ([ADR-0057](../../docs/architecture/decisions/0057-editor-device-draft-and-outbox-format.md)), so a closed tab loses
  what the server does not hold. Checkout returns to the same tab so the normal path keeps the draft (`FR-042a`).
- A cook runs out of AI credits in the middle of a month. They see a plain stop with the reset date (`FR-041e`).
- The platform AI ceiling is reached while a cook still has credits. The cook keeps their credits (`FR-041d`).
- A purchase is pending (bank check, slow store confirmation). The page shows a pending state and grants nothing until
  the payment is confirmed.
- A cook changes plan twice in one billing period. Each change shows its own effective date and amount before
  confirmation.

## Requirements _(mandatory)_

### Functional Requirements

**Subscription & Monetization**

- **FR-040**: System MUST provide a free tier with access to: recipe CRUD, sharing/cloning, basic importing, manual meal planning, grocery list generation, and cooking mode. Free-tier users may create unlimited public recipes; no recipe count cap applies. New recipes are public by default, and a free cook can hold up to 50 private recipes (`001-FR-003`). _(Amended 2026-10-26, owner ruling, [ADR-0073](../../docs/architecture/decisions/0073-free-tier-private-slots.md). Was: "All free-tier recipes are public by default; private visibility is not available on the free tier.")_
- **FR-041** _(amended 2026-10-26, owner ruling)_: System MUST provide two paid tiers, each billed **monthly or yearly** at the cook's choice, with a small discount for yearly billing:
    - **Pro**, **$9.99/month** or **$99.99/year**: private recipe visibility with no slot limit
      ([ADR-0073 §1](../../docs/architecture/decisions/0073-free-tier-private-slots.md)) and trainer nutrition planning.
      It also has a pantry with use-by dates, reminders and "use it up" suggestions (`007-FR-034` to `007-FR-040`), and
      household coverage (`FR-041j`). It includes a monthly AI allowance of 30 uses (`005-FR-015a`). Those uses pay for
      every AI feature except AI food waste optimization, including auto-generated meal plans (`006-FR-026`). _(Clarified
      2026-10-27: one call to the model is one use on every plan.)_
    - **Pro with AI**, **$19.99/month** or **$199.99/year**: everything in Pro, plus a larger monthly **AI allowance**
      of 300 uses (`005-FR-015a`) for AI recipe generation, AI meal suggestions, auto-generated meal plans and AI
      instruction optimization. It also has AI food waste optimization (`006-FR-027`), which only this plan has.
      _(Amended 2026-10-27, owner ruling, Pro match: "Pro stays at $99.99 a year, and Free keeps its 50 private recipes
      (ADR-0073 unchanged). Pro matches Samsung Food+'s $59.99 features." Pro gains the pantry and AI meal plans. Pro
      with AI keeps 300 uses and AI waste optimization. Was: auto-generated meal plans were Pro with AI only.)_ New
      subscribers to **either** tier receive a **14-day free trial** before the first charge. A Pro with AI trial
      carries a smaller allowance of 100 uses (`FR-041h`). Online grocery ordering is not a benefit of either tier until
      a store partner exists. _(Was: one Pro tier at $6.99/month or $59.99/year.)_
    - **Pro Household** (a working name, and the final words belong to `staff-ux-engineer`), **$14.99/month** or
      **$149.99/year** _(added 2026-10-28, owner ruling: "Let's plan that for the household then")_: the household
      upgrade of Pro. Every active member of the payer's household, up to 6 accounts, gets full Pro, each with Pro's
      own 30 uses a month (`017-FR-034l`). The price is about 50% above Pro, as AnyList prices its household plan
      against its one-person plan ([AnyList Premium](https://www.anylist.com/premium)). New subscribers get the same
      14-day trial, under the one-trial rule (`FR-041h`). Whether Pro with AI gets a household version is open:
      [O-13](#o-13).
- **FR-042**: System MUST gate Pro features with clear upgrade prompts that preview the feature value for free-tier users. Prompts follow a three-tier hierarchy: (1) contextual inline teaser at the feature entry point, (2) modal/bottom-sheet on active invocation, (3) pricing page accessible from any CTA and from account settings.
- **FR-043**: System MUST retain all user data and non-Pro functionality if a Pro subscription lapses. Existing private recipes remain private after downgrade (`FR-043a`). A lapsed cook who holds fewer than 50 private recipes can make another private. _(Amended 2026-10-26, ADR-0073 §4. Was: "the lapsed user cannot create new private recipes until they renew.")_ After a failed renewal payment, Pro access stays for the grace period of the rail the cook bought on (`FR-043b`). _(Amended 2026-10-28. Was: "A **7-day grace period** applies after a failed payment before Pro access is removed." Apple offers only 3, 16 or 28 days, so one figure could not hold on every rail. 010's plan, tasks, V-Model and product-spec still say 7 days, in T-005, REQ-028, AC-034 and D-3. They change when the V-Model is regenerated.)_
- **FR-043b** _(added 2026-10-28)_: Every rail MUST use its own payment recovery tools, with these settings:

    | Rail        | Grace period, with Pro access kept                                                                                        | After the grace period                                                                                                     | Source                                                                                                                                                                                           |
    | ----------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
    | App Store   | Billing Grace Period of **16 days**, set to "Only Paid to Paid Renewals", so a free period gets none                      | Apple keeps retrying billing for up to 60 days, with no access. A success restores Pro                                     | [Apple grace period](https://developer.apple.com/help/app-store-connect/manage-subscriptions/enable-billing-grace-period-for-auto-renewable-subscriptions)                                       |
    | Google Play | Grace period of **7 days**                                                                                                | Account hold for the rest of 60 days, which is 53 days, with no access. Grace and hold together must total 30 days or more | [Android lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions)                                                                                                   |
    | Web, Stripe | Smart Retries at Stripe's default, "8 tries within 2 weeks". The subscription stays past due, and RevenueCat keeps access | The subscription is cancelled when the retries run out, and RevenueCat revokes access. Automatic card updates are on       | [Stripe Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries), [RevenueCat grace periods](https://www.revenuecat.com/docs/subscription-guidance/how-grace-periods-work) |
    - _Why these lengths._ Apple's choices are 3, 16 or 28 days. 3 days is shorter than a cook takes to notice an
      email. 28 days on a monthly plan is close to a free month. 16 days is about half a month. Google sets no fixed
      list, so 7 days matches the first week of Stripe's retry window. Stripe's default of about 2 weeks is close to
      Apple's 16 days, so the three rails behave alike.
    - _Why recovery matters._ "Nearly a third of all subscription cancellations on Google Play are involuntary billing
      failures", against 14% on the App Store (RevenueCat, State of Subscription Apps 2026, via the 2026-10-28
      brainstorm, [RevenueCat](https://www.revenuecat.com/state-of-subscription-apps/)).
    - **No grace on a trial's first charge.** A failed first charge after a trial MUST NOT give more free Pro, or it
      would work as a second trial (`FR-041h`). Apple's setting covers paid-to-paid renewals only. On Google Play and
      Stripe, the plan finds how RevenueCat or our own gate ends access at once for that case. If a rail cannot, the
      extra days are recorded and reported, not hidden.
    - **The cook is told, and told how to fix it.** In the grace period the app shows a banner on web and mobile:
      the payment failed, Pro stays until a stated date, and where to update the payment method. The link goes to
      the rail where the cook pays: the App Store, Google Play, or the Stripe customer portal (`FR-042i`). The same
      message goes out through 014 at the failure, half way through the grace period, and one day before it ends
      (`014-FR-052`). The banner never threatens data loss, because nothing is lost (`FR-043a`).
    - Weekly products are not sold, so Apple's 6-day weekly cap does not apply.
    - **Plan target**: half or more of payments that enter billing retry are recovered. Read monthly from RevenueCat
      from month 2. There is no kill rule, since these settings cost nothing but a few days of access.
    - The banner and the messages go through `staff-ux-engineer` DESIGN and SPECIFY at plan time.

- **FR-043a** _(added 2026-10-26, [ADR-0073 §4](../../docs/architecture/decisions/0073-free-tier-private-slots.md))_: On
  a downgrade or a lapse, every private recipe MUST stay private. Nothing is made public or deleted on a billing
  event. A cook who holds more than 50 private recipes is over the limit: they keep every recipe, and they cannot
  make a new recipe private until they hold fewer than 50. A cook under the limit can. A book or paid-site recipe
  never goes public, so its slot is freed only by deleting it, and the refusal copy says so. The subscription page
  states this before a downgrade is confirmed (`FR-042h`).
- **FR-044**: System MUST make a user's subscription tier readable by **every** service, not only the identity service, by publishing it into the Clerk session token as a signed claim (`public_metadata`), using the same mechanism that already carries admin `scopes`/`permissions`. The claim MUST be refreshed when the tier changes, and every consumer MUST **fail closed** — treat an absent or unreadable claim as `free`, never as Pro. _(**DRAFT**, added 2026-08-02.)_

    **Why this is a requirement and not an implementation note.** `accounts.subscription_tier` already ships
    (`text`, `notNull`, default `'free'`, with an `updateSubscriptionTier` DAO method), but it is **not** a
    token claim: `@kitchensink/clerk-verify` reads only `scopes` and `permissions` from signed
    `public_metadata`, and the sole cross-service account endpoint (`/api/v1/internal/account`) is
    **erasure-only**. So identity can gate on tier today and **no other service can**. Without this,
    `@RequirePremium()` is enforceable only inside the identity service, which is not where most gated
    features live.

    **What it unblocks** — all entitlement gating, none of which needs marketplace payments:
    `001-FR-003` (only Pro users may set their own recipes **private** — the gate lives in the recipe
    service, not identity); `013` course access control; and
    the three rows feature 006 deferred (`006-FR-025`, `006-FR-026`, `006-FR-027`), which were parked
    citing exactly this missing mechanism. **Staleness is the design question to settle**: a signed claim
    is only as fresh as the token, so define the maximum tolerated lag between a tier change and enforcement,
    and whether downgrade requires forced token refresh or revocation.

    > ⚠️ **Amended 2026-10-27.** The claim now publishes the cook's **effective** plan, not only their own purchase.
    > It also counts the promotional entitlement of a referral reward (`023-FR-027e`) and household coverage
    > (`017-FR-034b`). One computation produces it, and it fails closed to Free. The design is owed in this spec's
    > plan, with `staff-architect`.
    >
    > ⚠️ **Amended 2026-10-28.** The computation has two outputs: the cook's **own plan** (own purchase, referral
    > reward, household upgrade) and the **household plan** (`017-FR-034b`). A personal gate reads the first and a
    > household gate reads the second, never the other way round.

**Plans and AI credits** _(added 2026-10-26, owner ruling: "there are three subscription plans now" and "the
subscriptions have two levels of AI credits". Answered 2026-10-27: the three plans are Free, Pro and Pro with AI, and
the paid plans are called "Pro" everywhere.)_

- **FR-041a**: The product MUST offer exactly three plans: **Free**, **Pro** and **Pro with AI** (owner, 2026-10-27).
  Free counts as the third plan. _(Amended 2026-10-28: those are the three plans for one cook. **Pro Household** is
  the optional household upgrade of Pro (`FR-041`, `017-FR-034l`). It adds no fourth level of AI credits, because each
  covered member gets Pro's level.)_ The three levels of AI credits belong to these three plans. Free gets a small
  monthly allowance of 3 uses, Pro gets 30 uses, and Pro with AI gets the full allowance of 300 uses (owner,
  2026-10-27, answers O-2). `005-FR-015c` and `005-FR-015d` state the amounts and the 90-day review.
- **FR-041a1**: The paid plans MUST be called "Pro" and "Pro with AI" in every string, on both platforms. The name
  "Premium" is retired (owner, 2026-10-27). Specs and ADRs now say "Pro". "Premium" survives only in quoted rulings and
  in strings the app ships today, and those strings MUST change to "Pro" when this feature ships: "See Premium",
  "Get Premium", "About Premium", and the editor's "needs Premium" copy. Code names such as `isPremium`, the `premium`
  role and `@RequirePremium()` are a separate rename that belongs to T-040. _(2026-10-28: the household upgrade's
  name also starts with "Pro", per this rule.)_
- **FR-041b**: The plan register is the one place that says which plan includes which feature. Other specs say
  "Pro" or "a paid plan" and link to the register. They do not restate plan contents. The entitlement model MUST
  be able to name each plan and each AI credit level. A single paid flag cannot say "Pro, but not Pro with AI". Today every
  entitlement mechanism is single-tier: the `premium` role, `hasPaidFeatures(roles)` (GR-012 AC-012-c),
  `account.paidFeatures` (`granted`, `upsell`, `hidden`), the one tier claim of `FR-044`, and `@RequirePremium()`.
  The design of that change is open for `staff-architect` ([plan §4](./plan.md#4-feature-gating-map)).
- **FR-041c**: Each plan's AI credit level MUST come from the plan register. A credit is one AI use, counted as
  `005-FR-015a` defines. Free has the small level (3 uses), Pro has the middle level (30 uses), and Pro with AI has the full level (300 uses). A cook with no
  credits left sees the next plan up as the way to more, only while the subscription page is live (`FR-042j`). While it is
  not live, the cook sees no AI upsell. Own keys (`005-FR-015`) are for Pro and Pro with AI only, never Free (owner,
  2026-10-27, answers O-7). A Pro or Pro with AI cook uses their keys only after the plan's uses run out (30 for Pro, 300 for Pro with AI).
- **FR-041d**: A cook's AI credits and the platform's AI spend ceiling are two different limits, and the product
  MUST keep them apart.
    - The ceiling is [ADR-0024](../../docs/architecture/decisions/0024-llm-spend-ceiling-reserve-then-settle.md)'s
      $100 a month, prod only. It protects the business. The owner treats it as temporary.
    - Credits are the product limit that a plan sells. They are counted per cook.
      _(Amended 2026-10-27: inside a covered household they are one pool for the household, `FR-041j` and
      `017-FR-034c`. The pool resets on the payer's billing date. Amended 2026-10-28: there is no household pool. A
      household action draws on the covering payer's own uses, and every other use is the cook's own
      (`017-FR-034c`, `017-FR-034m`).)_
    - A ceiling denial MUST NOT use a cook's credits. ADR-0024 already refunds the full reservation for a call with no
      billed answer.
    - The cook sees two different messages. Out of credits: "This month's AI uses are gone. They come back on
      {date}." Ceiling reached: "AI is not available right now. Your uses are not affected." The final words belong
      to `staff-ux-engineer` and go through the localization path.
    - A parse or match line from a paste or a bulk import is not a credit use. When the ceiling denies it, the
      owner's budget-spent rule applies: the line keeps the CRF answer and every food goes to the cook to choose
      (ADR-0024 §3, ADR-0071 §9, ADR-0072 §10).
    - The $100 ceiling stays until launch funding exists (owner, 2026-10-27). It cannot carry many paying cooks'
      credits, or every Free cook's small allowance. So ADR-0024 now holds a go-live plan: a separate operating-AI
      budget sized to expected spend, with alarms, and paid-credit headroom so a paying cook who has uses left is
      never refused. Before Pro with AI is sold, that plan MUST be built and the ceiling MUST be amended to fit it.
      That is a dated owner ruling, so it is amended in the ADR, not edited quietly. Until then a paying cook who is
      denied sees the ceiling message above and keeps their uses (owner, 2026-10-27, answers O-8).
- **FR-041e**: When a cook has no credits left, AI MUST stop with a plain message that gives the reset date. The one
  exception is a Pro or Pro with AI cook who has added a key and turned on automatic use (`005-FR-015b`). For that cook, AI
  goes on with the first working key, with no further prompt, and the screen says which account pays. If a higher
  plan exists and the page is live, the message can name it once, with an equal "Not now". There is no countdown, no
  repeated prompt and no pressure copy.
- **FR-041f**: What happens to unused credits on an upgrade, a downgrade, a lapse or a new period MUST be stated on
  the subscription page before the cook confirms. The rule (owner, 2026-10-27, answers O-6) is:
    - An upgrade gives the new plan's full allowance at once: 30 uses for Pro, 300 for Pro with AI. The allowance is
      fresh on upgrade.
    - On a downgrade or a lapse, the uses left last until the paid period ends.
    - Unused uses never roll over.
    - Uses reset on the cook's billing date (`005-FR-015a`).
- **FR-041h** _(owner, 2026-10-27, answers O-11)_: The trial follows these rules:
    - A person gets **one trial, ever**. It is one trial across every paid plan, not one per plan. _(Amended
      2026-10-28: "both paid plans" became "every paid plan", since Pro Household is one more.)_ A second account,
      a changed plan or a returning cook does not earn another.
    - **A card is required** to start a trial. The trial renews into the paid plan unless the cook cancels first.
      (The owner chose this over a no-card trial.)
    - The cook MUST get a clear notice before the first charge, with the date and the amount. The notice goes out
      early enough to cancel in time. The exact lead time goes to counsel with `016-FR-050`. _(Amended 2026-10-28.)_
      Until counsel answers, the lead time is **3 days before the first charge**, on day 11 of a 14-day trial.
      Commise sends it on every rail, by email, push where allowed and in-app (`014-FR-052`). Why Commise sends its
      own:
        - No Apple or Google page we opened says the store warns a cook before a trial converts. Apple's
          subscriptions page names only price increases as a change it tells customers about
          ([Apple](https://developer.apple.com/app-store/subscriptions/)). Google's page describes messages for
          declined payments and price changes only
          ([Android](https://developer.android.com/google/play/billing/lifecycle/subscriptions)). So the store notice
          is unverified, and the promise on the timeline cannot rest on it (`FR-042b`).
        - On the web, Stripe also sends its own reminder: "we send a reminder 7 days before a trial ends", with a
          cancel link ([Stripe](https://docs.stripe.com/billing/subscriptions/trials/manage-trial-compliance)).
          It stays on, because Stripe ties it to card network rules for trials. So a web cook gets both.
        - California's own trial notice applies only to a trial "lasting for more than 31 days", sent "at least 3
          days before and at most 21 days before" it ends ([Bus. & Prof. Code §17602](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17602), as amended by AB 2863). A 14-day
          trial is not in it. The 3-day lead time matches that law's floor, so a longer trial (a 30-day creator code
          is still under 31 days) would not need a second rule.
        - The lead time is one constant. The paywall timeline and the scheduler read the same value.
    - Cancelling MUST be as easy as subscribing (`FR-042e`).
    - The terms MUST meet the US Restore Online Shoppers' Confidence Act (ROSCA) and the California automatic
      renewal law. The EU withdrawal button applies where the cook has a withdrawal right (`FR-042f`). Counsel
      confirms the wording (`016-FR-050`).
    - A Pro with AI trial gives 100 uses (`005-FR-015c`).
- **FR-041i** _(owner, 2026-10-27, answers O-10)_: Plan changes take effect as follows:
    - An upgrade takes effect at once, and the price difference is pro-rated.
    - A downgrade takes effect at the end of the paid period.
    - Monthly to yearly takes effect at once, with credit for the unused time.
    - Yearly to monthly takes effect at the yearly renewal.
    - _(Added 2026-10-28.)_ On the App Store, timing comes from each product's level in its subscription group. An
      upgrade is immediate with a prorated refund, a downgrade waits for renewal, and a crossgrade between different
      durations waits for renewal ([Apple](https://developer.apple.com/app-store/subscriptions/)). A monthly and a
      yearly product at the same level would make monthly to yearly a crossgrade at renewal, which breaks the rule
      above. So each plan's yearly product MUST rank one level above its monthly product. If App Review or the plan
      finds that ranking wrong, every surface states the renewal date instead, and this list records the App Store
      exception. On Google Play the upgrade uses the `CHARGE_PRORATED_PRICE` replacement mode, and a downgrade uses
      `DEFERRED` ([Android](https://developer.android.com/google/play/billing/subscriptions)). Stripe prorates at once.
      `staff-architect` sets the full level order at plan time, Pro Household included.
- **FR-041g**: A paid plan sells private recipes with no limit. It sells nothing else about privacy. ADR-0073 stands: a
  free cook holds 50 private recipes, and a **draft never uses a private slot** (`001-FR-003b`). The design branch's
  "private room" model, where a draft counts against private room after 30 days (its `015-FR-007d`, `FR-007o`,
  `FR-007p` and `FR-007q`), is **retired** (owner, 2026-10-27). A merge MUST NOT bring it back, in this spec, in 015,
  in 016's `FR-029a` or in 001's draft note.

- **FR-041j** _(owner, 2026-10-27, replaced 2026-10-28, owner ruling: "Let's plan that for the household then")_: A
  paid plan MUST reach a household in two ways, and only these two (`017-FR-034` to `FR-034m`).
    - **Shared content.** While an active member holds Pro or Pro with AI, every active member gets the paid features
      of the household's meal plans, grocery lists, pantry and shared collections (`017-FR-034a`). Free members are
      included (`017-FR-034d`).
    - **Personal features stay with the payer.** Each member's own library follows that member's own plan. A Free
      member keeps 50 private recipes. Unlimited private recipes, the paid bulk allowance, own keys, trainer
      nutrition planning and personal AI uses never come from another member's plan.
    - **The household upgrade** (Pro Household, `FR-041`) gives every member full Pro, with Pro's 30 uses each
      (`017-FR-034l`).
    - AI uses for a household action draw on the covering payer's own allowance. There is no separate household pool
      (`017-FR-034c`, `017-FR-034m`).
    - A household holds at most 6 accounts, the payer included. The plan register holds the number.
    - Two Free cooks can form a household (`017-FR-034k`, answered yes on 2026-10-28).
    - Each cook's plan computation has two outputs, the cook's own plan and the household plan. The claim of
      `FR-044` publishes both (`017-FR-034b`).
    - When the household upgrade ends, `FR-043a` applies to each member.
    - App Store Family Sharing stays off (`017-FR-034i`).

    _(Was, 2026-10-27: "Every active member gets the covering plan's features", with one AI pool per household, and
    Free households open.)_

- **FR-041k** _(added 2026-10-28)_: A monthly payer MUST be offered a switch to yearly once, after their first
  monthly renewal succeeds. The offer is one card, shown once per person, in the app.
    - It states both prices for a year and the date the switch takes effect. For Pro that is $99.99 a year instead
      of $119.88 for twelve months ($9.99 × 12). The date follows `FR-041i` for the rail the cook bought on.
    - It has an equal "Not now". After "Not now" it never comes back, and the switch stays on the subscription page.
    - It is not shown during a grace period, an account hold, a cancellation, or the same session as another
      prompt in this spec.
    - It is not a discount. It uses the ruled yearly price.
    - _Why_: yearly plans keep 28% of payers at 12 months and monthly plans keep 8% (RevenueCat, State of
      Subscription Apps 2026, via the 2026-10-28 brainstorm,
      [RevenueCat](https://www.revenuecat.com/state-of-subscription-apps/)). That is a category figure, not a
      Commise result. **Plan target**: 10% of prompted monthly payers switch within 30 days. Read after 30 prompts or
      at month 6, whichever is first. If 1 or fewer of 30 switch, the card stops and the option stays on the page.
    - The card goes through `staff-ux-engineer` DESIGN and SPECIFY at plan time, on web and mobile.

- **FR-041l** _(added 2026-10-28, owner ruling 2026-10-27: "One-time discount")_: A cook who declined the trial
  MUST be offered one discount, once per person, ever.
    - **Who.** A cook who was shown the trial, chose "Not now", has never started a trial and has never paid.
    - **When.** At the first value moment at least 7 days after that "Not now". The wait stops the app from teaching
      cooks that declining earns a discount. The value moments are: a finished library import (`017-FR-016`), the
      first household meal plan shared with another member (`017-FR-030`), and the refusal of a 51st private recipe
      (`FR-043a`). `staff-ux-engineer` may narrow the list at DESIGN.
    - **What.** One offer, on one plan and one billing period. The amount is open: [O-14](#o-14).
    - **Honest.** It states the discounted price, the period it covers, the price after it, that it renews, and how
      to cancel (`FR-042b`). It has an equal "Not now". There is no countdown, no timer and no "today only"
      (`FR-042d`). Once shown, it stays open on the subscription page for 30 days, with that end date as a plain date.
    - **Not a trial.** It charges at once and gives no free time, so `FR-041h` stands. Taking it ends the cook's
      trial eligibility, because a paying cook never gets a trial later.
    - **Once per person across every rail.** Apple and Google cannot see each other's offers, so Commise keeps its
      own record that the person was offered it and whether they took it. It is the same kind of check as the
      one-trial check (ADR-0075 §6). The mechanism per rail:
        - App Store: the introductory offer is the free trial, and "Customers can redeem one introductory offer per
          subscription group". Promotional offers are for "existing and previously subscribed customers". So the
          discount is an offer code for new subscribers
          ([Apple](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes)).
        - Google Play: a developer-determined offer, where "You solely decide the business logic"
          ([Google](https://support.google.com/googleplay/android-developer/answer/12154973)).
        - Web: a Stripe promotion code with `restrictions.first_time_transaction`, issued one per cook
          ([Stripe](https://docs.stripe.com/billing/subscriptions/coupons)).
    - _Why_: 23% of freemium conversions come after week 6 (RevenueCat, State of Subscription Apps 2026, via the
      2026-10-28 brainstorm). **Plan target**: 5% of cooks offered it take it within its 30 days. Read after 200
      offers. Under 1% after 200, it stops.
    - The offer goes through `staff-ux-engineer` DESIGN and SPECIFY at plan time, on web and mobile.

**The subscription page** _(added 2026-10-26, owner ruling: hide "See Premium" until this feature ships, and record
the page's UX and legal requirements)_

- **FR-042a**: The subscription page MUST open as a modal over the screen the cook was on. Closing it MUST return the
  cook to that screen with nothing lost. That also holds for the checkout round trip: when checkout ends in payment,
  cancellation or failure, the cook returns to the screen they started from. On web the editor draft lives in
  `sessionStorage` ([ADR-0057](../../docs/architecture/decisions/0057-editor-device-draft-and-outbox-format.md)), so
  it survives a same-tab round trip but not a closed tab. Checkout MUST therefore return in the same tab. This spec
  states the outcome, not the mechanism.
- **FR-042b**: Before any payment step, the page MUST show for each plan:
    - the price and the billing period, for monthly and for yearly.
    - the trial length and the date of the first charge.
    - that the plan renews automatically until the cook cancels, and the renewal amount.
    - how to cancel.
    - what the plan includes, including its AI credit level, and what it does not include.
    - _(Added 2026-10-28.)_ For a plan with a trial, a **trial timeline** of three dated steps: today, when Pro
      starts, the reminder day, 3 days before the charge (`FR-041h`), and the charge day, with the amount. The dates
      are the cook's real dates. The reminder step says how the reminder comes: by email always, and by push if the
      cook allows it. The promise is kept by `014-FR-052`, so the step never shows a date the scheduler does not use.
      _Why_: Blinkist's trial timeline "led to a 23% lift in trial signups" and "reduced customer complaints by 55%"
      ([Growth.Design](https://growth.design/case-studies/trial-paywall-challenge)). That is one company's result,
      not a Commise uplift. **Plan target**: trial starts at or above 8.9% of installs, RevenueCat's median for
      above-average prices (via the 2026-10-28 brainstorm). Read at day 30 of the soft launch. The timeline goes
      through `staff-ux-engineer` DESIGN and SPECIFY at plan time, on web and mobile.

    This is `016-FR-040`. The cook passes through it on the way to payment. It is not a link they have to find.

- **FR-042c**: Nothing that adds cost is chosen for the cook. No plan is pre-selected, no add-on is pre-ticked, and
  no upgrade is bundled into a decline. If one billing period is shown first, both prices stay visible.
- **FR-042d**: The page MUST NOT use deceptive patterns. "Not now" and the close control are visible at all times and
  look as strong as the buy buttons. Decline copy is neutral, with no confirmshaming. There is no fake urgency: no
  timers, no "today only" and no false scarcity. After "Not now", the same prompt does not come back in the same
  session. Basis: EU DSA Article 25, EDPB Guidelines 03/2022, and the FTC's 2022 staff report "Bringing Dark Patterns
  to Light". The `staff-ux-engineer` agent refuses these patterns, it does not weigh them.
- **FR-042e**: Cancelling MUST be as easy as subscribing. The Cancel control is on the same page, it takes no more
  steps than subscribing took, and the result is confirmed in writing (`016-FR-041`). No retention offer MUST stand between the
  cook and the cancel action. A store purchase routes the cook to the store's own
  cancel flow (`016-FR-042`).
- **FR-042f**: Where a market gives a withdrawal right, the page MUST state it at purchase (`016-FR-043`). In the EU
  and UK a consumer has 14 days to withdraw from a distance contract. How that right applies to an app subscription
  is a question for counsel: whether it counts as digital content or a digital service, and what consent and
  acknowledgement end the right early. v1 serves the US only (`016-FR-048`). So this is
  built as a seam under `016-FR-048b`, and the wording goes to counsel (`016-FR-050`).
- **FR-042g**: The page MUST design and build every state, each with its copy and its localization key:
    - loading, and an error that offers a retry.
    - offline: says so and offers no purchase. A plan list that already loaded stays on screen.
    - purchase pending: grants nothing until the payment is confirmed.
    - purchase failed: says what failed and what to do, and charges nothing.
    - purchase restored: the plan follows the account to a new device.
    - already subscribed: shows the current plan, renewal date and amount, payment method and Cancel.
    - trial active: shows the trial end date and the first charge. Pro Household's trial says who is covered.
    - past due, inside the grace period of the cook's rail, with the fix link (`FR-043b`). _(Amended 2026-10-28.
      Was: "inside the 7-day grace period".)_
    - account hold or billing retry after the grace period, with no Pro access and the same fix link (`FR-043b`).
    - trial timeline, before a trial starts (`FR-042b`).
    - trial checklist, during a trial (`FR-042l`).
    - monthly-to-yearly offer (`FR-041k`) and the one-time discount (`FR-041l`).
    - just cancelled: the "what you keep" screen (`FR-042m`).
    - cancelled, still active until the end of the paid period.
    - plan change, upgrade or downgrade (`FR-042h`).
    - entitlement unreadable: fails closed to Free (`FR-044`), and says the app cannot check the plan now.
    - hidden: no entry point at all (`FR-042j`).
- **FR-042h**: Before the cook confirms a plan change, the page MUST state when it takes effect and what the cook
  pays. The rule is `FR-041i`: an upgrade takes effect at once with the difference pro-rated, and a downgrade takes
  effect at the end of the paid period ([plan §7](./plan.md#7-key-decisions)). A downgrade also states what changes. Private recipes stay private
  (`FR-043a`). AI credits follow `FR-041f`.
- **FR-042i**: On mobile, the purchase follows the store rules for the market. Status checked 2026-10-26, for counsel
  to confirm (`016-FR-050`):
    - Apple: since the court order of 30 April 2025, App Review Guideline 3.1.1(a) lets an app on the US storefront
      link to an outside purchase with no entitlement. Outside the US, a digital subscription still uses in-app
      purchase (Guideline 3.1.1).
    - Google Play: the US external links and alternative billing programs are open, and Google charges service fees
      on those purchases from 1 October 2026.

    v1 serves the US only (`016-FR-048`). The owner answered [O-9](#owner-inputs-still-needed) on 2026-10-27, and
    [ADR-0075](../../docs/architecture/decisions/0075-payment-stack-store-billing-revenuecat-and-stripe.md) records the decision. It sets these rules:

    - iPhone sales use App Store in-app purchase. Android sales use Google Play Billing. Restore and cancel on a
      store purchase MUST route to the store (`016-FR-042`).
    - The web app sells through Stripe Billing. RevenueCat joins the App Store, Google Play and web purchases into
      one entitlement record per cook. The Clerk user ID is RevenueCat's app user ID on all three platforms.
    - At first, web sales go to US buyers only, with Commise as the seller. Commise handles US sales tax with Stripe
      Tax. Stripe Managed Payments, where Stripe is the seller, is switched on once Stripe confirms our product is
      eligible. Web sales widen to other countries only after that. Paddle, through RevenueCat, is the fallback if
      Managed Payments is refused.
    - The US "pay on the web" link inside the iPhone app is built behind a remote switch and kept **off**. It turns
      on only when Apple's US rate is settled and our own test shows a loss of no more than about 4% of iPhone
      proceeds.
    - A cook can change or cancel a subscription only on the platform where they bought it. The subscription page
      and the account screen MUST show where each cook pays.

- **FR-042j**: Every entry point to the subscription page MUST stay hidden until this feature ships, behind **one
  switch**. The switch is read in one place and shared by web and mobile. It is separate from the paid-features gate:
  `PAID_FEATURES_GATE_SANDBOX` and `PAID_FEATURES_GATE_PROD` decide whether a cook without a paid role sees an upsell
  or nothing (`account.paidFeatures`). The switch decides whether a link to a subscription page exists. Nobody but the
  owner flips the two gate variables, and this feature never flips them. The switch is owed: it does not exist yet.
  Today "See Premium" only closes the sheet on both platforms (parity audit
  [H1](../../docs/design/uiOverhaul/parityAudit2026-10-17.md)).

    | `account.paidFeatures` | Switch off (today, until 010 ships)                                                                                                                | Switch on (010 shipped)                                                         |
    | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
    | `granted`              | Paid features work. No upsell. No link to manage a plan.                                                                                           | Paid features work. Account settings link to manage the plan.                   |
    | `upsell`               | A sheet states the plain fact and offers only a close control. No "See Premium", no "About Premium", no Pro way forward in the slots-full refusal. | Sheets show the paid-plan link and an equal "Not now". The link opens the page. |
    | `hidden`               | No sheet, no badge, no mention of a paid plan.                                                                                                     | The same. The page cannot be reached.                                           |

- **FR-042k**: The switch MUST cover every entry point. Today these are:
    - `RecipeUpsellSheet`, web and native, with its "See Premium" button. The recipe editor opens it when the cook
      chooses Private under the Pro rule (`RecipeVisibilityField`'s `onPremiumRequired`, wired by
      `usePrivateChoice` and `useGatedPrivate`). This is the "See Premium" the publish step shows.
    - The slots-full refusal in `RecipeVisibilityField`, web and native: its "Get Premium" way forward
      (`wayPremium`) and its "About Premium" link (`aboutPremium`).
    - `CollectionUpsellSheet`, web and native.
    - The Home `SubscriptionNudge`, web and native.
    - account settings (tier 3 of `FR-042`).
    - the AI paid-plan gate and the out-of-credits screen (`005-FR-015a`).
    - _(Added 2026-10-28.)_ The monthly-to-yearly card (`FR-041k`), the one-time discount (`FR-041l`), the trial
      timeline (`FR-042b`), the grace-period banner (`FR-043b`), the trial checklist where a step leads to the page
      (`FR-042l`), and the Pro Household card and coverage notices (`017-FR-034l`).

    A new entry point MUST read the same switch. A guard that finds every caller is part of the build (T-035).
    Copy that only states a fact, such as "needs Premium" in the editor, is not a link. Whether that fact names a plan
    the cook cannot buy yet is a `staff-ux-engineer` question for T-035.

- **FR-042l** _(added 2026-10-28, owner: "add the pro checklist")_: During a trial, the app MUST show a short "get the
  most from your trial" checklist, on web and mobile.
    - The four steps: import your library (`017-FR-016`), set up the pantry with one use-by date (`007-FR-034`),
      invite your household (`017-FR-032`), and make a meal plan (006).
    - A step is ticked from real state, never from a tap on the list. A household of one shows the invite step. A
      member already in a household of two or more does not.
    - It can be dismissed for good with one tap. It goes away when the trial ends or is cancelled. It is never shown
      again after that.
    - It states facts only, such as the trial's end date. There is no countdown, no "only N days left" pressure and no
      reward for finishing.
    - Every state is designed, each with its copy and its localization key: not started, partly done, all done (a
      short done state, then gone), dismissed, loading, error (the list hides and blocks nothing), and offline (the
      last known ticks, read-only).
    - On mobile it is translated, not ported. `staff-ux-engineer` places it by reach and states a disposition for
      each element that differs from web (CLAUDE.md, staff-ux §3.6).
    - _Why_: the median trial-to-paid rate for 10 to 16 day trials is 35.4% (RevenueCat, State of Subscription Apps
      2026, via the 2026-10-28 brainstorm). A cook who never tries the pantry, the household or meal plans sees only
      the private-recipe limit. There is no published effect for a checklist, so this is a target and a test.
      **Plan target**: trialists who finish 2 of 4 steps convert above 35.4%. Read at day 45 of the soft launch. If
      finishers and others show no gap after 100 trials, the checklist is removed.
    - It goes through `staff-ux-engineer` DESIGN and SPECIFY at plan time.

- **FR-042m** _(added 2026-10-28, owner: "Do the idea about what a cook keeps too")_: After a cancellation is
  complete, the app MUST show a "what you keep" screen once. It is never a step before the cancellation.
    - **When.** On the web, after the cancel is confirmed on the subscription page. For a store purchase, the cancel
      happens in the store (`016-FR-042`), so the screen shows on the next app open after RevenueCat reports it. A
      trial cancel gets it too.
    - **What it says**, using the cook's real facts:
        - Pro stays until the end of the paid period, on a stated date. For a trial: no charge is made, and Pro stays
          until the trial's end date.
        - Every recipe stays. Every private recipe stays private. Nothing is made public or deleted (`FR-043a`,
          [ADR-0073 §4](../../docs/architecture/decisions/0073-free-tier-private-slots.md)).
        - If the cook holds more than 50 private recipes, they keep every one, and after the end date they cannot
          make a new recipe private until they hold fewer than 50. The screen states their count.
        - How to export everything at any time, with a link to the library export (`GET /api/v1/account/export`,
          `017-FR-018`).
        - AI uses left last until the end date (`FR-041f`).
        - If the cook pays for a household: on the end date the household's shared Pro features stop, and the upgrade
          too if it was on. Members get their own notice 7 days before (`017-FR-034d`).
    - **One optional question**: why the cook left. A short list plus "Other" with optional text. Nothing is
      pre-selected. Skip is as strong as Send. The answer changes nothing about the cancellation.
    - **No offer.** No discount, no "are you sure", no plan switch prompt and no resubscribe button. Closing the
      screen does nothing to the cancellation. The written confirmation goes out by email as well (`016-FR-041`,
      `014-FR-052`).
    - **Why it is lawful.** It comes after the cancel, so nothing stands between the cook and Cancel (`FR-042e`).
      California allows a save offer in an online cancel only beside a "click to cancel" button
      ([Bus. & Prof. Code §17602](https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=BPC&sectionNum=17602), as amended by AB 2863), and this screen makes no offer at all. ROSCA requires
      "simple mechanisms for a consumer to stop recurring charges"
      ([15 U.S.C. 8403](https://www.law.cornell.edu/uscode/text/15/8403)). EU DSA Article 25 names "making the
      procedure for terminating a service more difficult than subscribing to it". Counsel confirms (`016-FR-050`).
    - **The reason is personal data.** It is stored with the account, erased with it, and reported only in
      aggregate.
    - Every state is designed: the facts with and without a household, over and under 50 private recipes, a trial
      cancel, offline (the facts still show, and the answer is sent later), and a failed send (the answer is
      dropped, never retried in a loop).
    - _Why_: Blinkist found "33% of cancellations are done right after users start their trial"
      ([Growth.Design](https://growth.design/case-studies/trial-paywall-challenge)), one company's result. The reasons
      are product data Commise does not have yet. **Plan target**: a reason from 30% of cancels. Read after 50
      cancels.
    - It goes through `staff-ux-engineer` DESIGN and SPECIFY at plan time, on web and mobile.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel` in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)

### Key Entities

- **Subscription**: Tracks a user's plan (free/Pro), billing cycle, and feature access permissions. _(Amended
  2026-10-26: the plan is one of the plans in the [plan register](#plan-register), not free or Pro.)_
- **Plan**: One row of the [plan register](#plan-register). It has a name, a monthly and a yearly price, a trial, a
  private-recipe limit and an AI credit level.
- **AI credit allowance**: A cook's AI uses for the current period, set by their plan (`005-FR-015a`). It is not the
  platform spend ceiling of ADR-0024 (`FR-041d`).

## API Contract & Input Validation (GR-015 / GR-016)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15 / §15.4 / §15.5](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[`GR-018`](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) ·
[`GR-019`](../governance-rules.md#gr-019-identifier-integrity--no-sentinels) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md) ·
[ADR-0017](../../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md). Full
bindings: [`plan.md` §3.0](./plan.md#30-contract-ownership-and-drift-gr-015) and
[`plan.md` §3.0a](./plan.md#30a-input-validation-gr-016--this-plan-already-stated-the-rules-sharpest-case), which
this section summarises and must not contradict. **This section applies existing portfolio rules and mints NO new
FR** (GR-003). GR-015 decides who **authors** the contract; GR-016 decides where that zod **runs**.

⛔ **010 straddles the rule, and getting the two halves backwards is the expensive mistake in this feature.** The
inbound Stripe webhook body is **STRIPE's** shape — validated at our boundary with **our own** zod, allowed its own
types, and given **NO** OpenAPI document. Our `/api/v1/billing/*` request and response shapes are **OURS** and live
in `@kitchensink/schema-identity`. One request carries one of each.

### Contract ownership (GR-015)

| Role                                      | Binding for 010                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- |
| Owning service (**authors** the zod)      | `@kitchensink/identity-service` — `packages/services/identity/src/billing/*.schema.ts`        |
| Stripe webhook handler                    | `@kitchensink/identity-webhooks` — **not** the ECS API                                        |
| Schema package (**generated**, committed) | `@kitchensink/schema-identity` — `packages/schemas/identity`, extended, **never hand-edited** |
| Consuming client                          | the identity consumer named by **002's own OPEN item** — see the note below                   |
| Consuming apps                            | `@commise/web` (the primary billing surface), `@commise/mobile` (store purchase, `FR-042i`)   |
| Entitlement guard                         | a **shared** package under `packages/shared/*` — never an import of the identity service      |

⚠️ **The consuming client is still 002's question, and 010 does not pre-empt it.** 002's plan carries its own 🟠
**OPEN**: either introduce `packages/clients/identity`, or have `@commise/features-account` import
`@kitchensink/schema-identity` directly and remain the only consumer. **No `packages/clients/identity` exists
today.** Whichever lands, the client obligation below is unchanged — it is about who **authors** a wire shape, not
which directory it lives in.

✅ **Ownership is decided, not TBD** (ADR-0017, 2026-08-12): the entitlement is a **column on identity's `accounts`
row** (`subscription_tier` already ships), so a separate billing service would be a **second writer** to it — the
single-writer discipline the food service holds for USDA data, inverted. The Clerk `public_metadata` claim path
`FR-044` depends on is identity's too. **No new deployable is created**, and a **schema package is per SERVICE, not
per feature** — there is no `@kitchensink/schema-billing`.

⛔ **The Stripe webhook belongs in `@kitchensink/identity-webhooks`**: it is an **unauthenticated third-party
callback** that must **not** sit behind Clerk's `AuthMiddleware`, needs the **raw request body**, must **answer while
the API is scaled down**, and writes its idempotency rows into **that** database, alongside Clerk's. ⚠️ Into its
**own** table: per [ADR-0018](../../docs/architecture/decisions/0018-per-sender-webhook-dedup-tables.md) Stripe gets
`stripe_webhook_events` and the shipped svix `webhook_events` is untouched — same name, different columns, different
sender, and one shared table would have to relax the `identity_id text NOT NULL` that GR-019 leans on. ⛔ **`@RequirePremium()` / `PlanGuard` live in a SHARED package** reading the entitlement
as a **claim from the signed Clerk session token** — every gated route lives in some _other_ service, and
`packages/tools/repoGuards/__tests__/appServiceDependency.test.ts` already forbids an app importing a service package.

**The service MUST** author every checkout, portal and subscription-status request/response shape — **and the
webhook endpoint's own response** — as **zod in the service** at `src/billing/*.schema.ts`, **beside the controller
it serves**; validate its own requests with **that same zod**; and keep every `*.schema.ts` importing **only `zod`
and other `*.schema.ts` files** — notably **no Stripe SDK type**, which would drag a third-party shape into a
contract we publish. `@kitchensink/schema-identity` exports the **zod**, the **`z.infer` types**, a
**`CONTRACT_HASH`**, a **barrel**, and a **DERIVED `openapi.yaml`**.

⛔ **Three properties of that package that look wrong and are not** — do not "correct" them: it is a literal file
**COPY** (zod are **runtime values**, so they cannot be derived from themselves, and every package exports raw
`./src/*.ts`, so there is no bundle-into-`dist` path); turbo wires it with `$TURBO_ROOT$` **`inputs`**, **NOT**
`dependsOn` (that edge closes the cycle `client → schema → service → client`, and ordering was never the requirement
because the generated files are **committed**); and `openapi.yaml` is **DERIVED OUTPUT** for `oasdiff`, docs and
integrators, **NEVER a codegen input** — through JSON Schema you lose `readonly`, branded and template-literal
types, and discriminated unions flatten.

**The CLIENT's obligation — separately mandatory.** Mandating only the service half is exactly how the client half
got skipped portfolio-wide (276 + 144 lines of independently declared client wire types, agreeing with nothing).

- **No billing wire shape is declared anywhere outside the schema package** — including **type-only** declarations,
  and including `packages/apps/**` feature packages (GR-015 §15-b.4). Both the **type and the runtime zod** come
  from `@kitchensink/schema-identity`.
- ⚠️ **The `SubscriptionStatus` shape and the plan/entitlement enum are the load-bearing case.** Every gated surface
  across 001, 004, 005, 006, 007, 009, 012 and 013 branches on them; a client that re-declares that enum can drift
  by one member and **fail open** — showing a Pro feature to a free user, or the reverse — with `typecheck`
  green. Imported, never re-declared.
- A divergent consumer shape (a paywall banner model, a plan-comparison row) is **DERIVED** with
  `Pick` / `Omit` / `Partial`. Reference: `packages/apps/commise/features/recipes/src/filters/model.ts`.
- ⚠️ **CLIENT WORK IS ITS OWN DELIVERABLE, with its own tasks** (GR-017 §17-e.12): schema-package additions, typed
  client methods, **response validation on receipt**, and the **contract-skew guard**. "The paywall will add the
  type" is a **contract fork, not a task**.

**Drift gates** — inherited from GR-015 §15-c, all three: the turbo `inputs` rebuild, the **regenerate-and-diff CI
gate**, and the **`CONTRACT_HASH` boot assertion** — the last one especially load-bearing here, since a released
mobile binary pinned to an older entitlement shape is exactly how a paywall silently misbehaves in production.

⛔ **THE THIRD-PARTY EXCEPTION (GR-015 §15-d) — Stripe is an API we do NOT serve. NEVER converge it.** Its inbound
webhook body **MUST** be validated at our boundary with **our own** zod, **after** signature verification and
**before** any field drives a write; the adapter **MAY declare its own types**, and our normalized
`SubscriptionStatus` **deliberately differs** from Stripe's subscription object; and **NO OpenAPI document is
written for Stripe**. Its shapes are **never** folded into `@kitchensink/schema-identity` as though we owned them.
`packages/clients/usda` is the reference implementation and must never be "converged" — **deleting a Stripe
boundary schema is a security and correctness regression**, because this is the path that decides who has paid.

### Input validation — where that zod RUNS (GR-016)

- **One mechanism, one `400`.** Every checkout, portal and subscription-status input — body, path params, query
  params — is parsed by identity's own authored zod via `createZodDto` plus **`nestjs-zod`'s** `ZodValidationPipe`.
  ⚠️ **Billing lands in the one service where this has already gone wrong**: under Nest's **OWN** `ValidationPipe` a
  `createZodDto` DTO validates **NOTHING while looking correctly wired**, which is exactly what happened to
  identity's `PATCH /users/me`. **The only way to observe it is a test that posts a known-bad body to a real billing
  route and asserts the `400`.**
- **`z.strictObject()` for every mutating body** (GR-017 §17-c, ruled 2026-08-12) — `POST /api/v1/billing/checkout`
  and `/portal` reject unknown keys. ⚠️ **Stripe's inbound body is the opposite case**: it is **their** shape, it
  gains fields without telling us, so its boundary schema tolerates unknown keys **deliberately** while still
  rejecting a missing or wrong-typed field it depends on.
- **Signature-verified is NOT shape-verified.** Signature verification authenticates the **sender** and says nothing
  about the **shape**, so each of the six routed events — `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`,
  `customer.subscription.trial_will_end` — is schema-validated **after** the signature check and **before** any
  field drives a write. Both controls, in that order, never one instead of the other.
- **⚠️ An entitlement decision must never branch on an unparsed field.** A webhook body whose `status` was never
  checked against the enum can **fail open** and grant Pro with `typecheck` green. The enum is validated at the
  boundary and mapped **explicitly**; an unrecognised value is a **rejection plus an alarm**, never a default. Every
  consumer **fails closed** — an absent or unreadable entitlement claim is `free` (`FR-044`).
- **⛔ GR-018 IN FULL, for the Stripe webhook — and instinct gets this backwards.** There is **ONE rejection path**
  producing **one** structured shape whose **`reason`** names the cause. A **signature failure and a shape failure
  are EQUALLY invalid** and MUST NOT have two **code paths** — they differ **only** in `reason`, and the status is
  derived from that `reason` by **one complete lookup**. ⚠️ **CORRECTED 2026-08-12 — this bullet previously said an
  invalid payload "is answered **`2xx`**" full stop, and that is only half of §18-a's table.** The three dispositions
  are: a **shape** failure behind a **valid** signature ⇒ **`2xx` (200)**, because Stripe retries on ANY non-2xx for
  72 hours and a body that cannot parse today cannot parse on any redelivery; a **signature** failure ⇒
  **non-2xx (`401`)**, because it is an **authentication** failure and because the cause may be **our own stale
  signing secret** — transient, operator-fixable, and rescued precisely by the retry window a `2xx` would throw
  away; and a **valid** body ⇒ its normal success. The shipped reference is `WEBHOOK_REJECTION_STATUS` in
  `packages/services/identity-webhooks/src/common/handlerPipeline.ts` (`shape → 200`, `signature → 401`) as a
  **complete `Record`**, so adding a reason cannot compile until its retry disposition is decided. **Either**
  rejection is recorded in **(1)** the response body, **(2)** structured logs with its `reason`, **(3)** a
  **per-`reason` counter**, and **(4)** an **alarm** on that counter. **Reject the content, accept the delivery —
  but never accept an unauthenticated one.** ⚠️ This does **not** generalize to our own callers:
  `/api/v1/billing/*` returns the `400`/`403` GR-016 §16-a.3 requires, because our clients do not blind-retry and a
  `2xx` would hide a fixable bug.
    - ✅ **The `tasks.md` contradiction this bullet used to record is RESOLVED (2026-08-12).** It previously read:
      _"010's `tasks.md` currently asserts 'invalid signatures return `400`' — the exact inversion."_ T-014 has since
      been corrected twice — first off the `400`, then off an over-correction that answered **`2xx` for both
      causes** — and now states all three dispositions with the `reason → status` lookup. Nothing here contradicts
      the rule any longer, so do not "re-fix" T-014 back toward a single status.
    - **A rejected event is NOT recorded as a row** (GR-018 §18-d / GR-019). An invalid payload has **no trustworthy
      identifier** — not even a `stripe_event_id` worth keying on — so recording it would
      force the writer to invent an id, which is precisely the sentinel GR-019 forbids. The **log line and the
      counter are load-bearing**, not a consolation prize.
- **Requests are validated in the service; responses are validated ON RECEIPT by the consumer.** ⛔ Server-side
  **response** validation is **DEFERRED by owner decision** (GR-016 §16-g) and **MUST NOT be "completed"**. The
  Stripe-side parse is **input to us** and is unaffected — do not conflate them.
- **⛔ The storage floor — an ASSERTION, never a derivation — and 010 has the TIGHTEST real bounds of these five
  features, with a thin margin.** `stripe_webhook_events.stripe_event_id` is `VARCHAR(255)`, `event_type` is
  `VARCHAR(100)`, and `status` is `VARCHAR(20)` — ⚠️ **`'processing'` is 10 characters, so the margin is thin** and
  a longer status string is a failed `INSERT` on the money path. Meanwhile the `accounts` additions are declared
  **`varchar` with no length**, which is unbounded in PostgreSQL and therefore **not yet a floor**: ⚠️ **a length
  must be declared before it can be asserted against**. No zod is generated from the storage schema, **no storage
  type enters a wire schema**, and **no Stripe SDK type enters one either**; enforcement is the per-service parity
  test of GR-017 §17-d, its mapping asserted complete **in both directions**.
    - ⚠️ **010's data model uses TypeORM-style `@Column()` decorators while the rest of the portfolio — including the
      `accounts` table it extends and the `webhook_events` table it sits beside — is Drizzle.** That inconsistency is **flagged, not
      silently resolved**: it is a data-model decision for the owner, and it changes what the parity test reads.
- **Non-HTTP ingress.** Beyond the webhook, any retry queue, DLQ replay or reconciliation job this feature adds
  parses its payload against an authored zod **before acting on it** — a pipe reaches none of them, and these are
  the paths that re-drive money-relevant writes. An invalid payload is completed or dead-lettered **once**, with its
  `reason`, and the DLQ depth is alarmed (GR-018 §18-c).
- **No request-derived value reaches `sql.raw()`.**

## Plan register

This table is the one place that says what each plan includes (`FR-041b`). Every other spec links here. The plans
are Free, Pro and Pro with AI (owner, 2026-10-27). "Premium" is the retired name for a paid plan (`FR-041a1`).

> **Pro match (owner ruling, 2026-10-27).** "Pro stays at $99.99 a year, and Free keeps its 50 private recipes
> (ADR-0073 unchanged). Pro matches Samsung Food+'s $59.99 features." Three changes follow, and this table records
> them:
>
> - Pro gains a pantry with use-by dates, reminders and simple "use it up" suggestions. They use no AI (`007-FR-034` to
>   `007-FR-040`). AI-driven waste optimization stays Pro with AI only (`006-FR-027`).
> - AI meal plans are in Pro and Pro with AI (`006-FR-026`). A Pro cook spends their 30 monthly uses on them. One call
>   to the model is one use (`005-FR-015a`). Pro with AI keeps 300 uses and AI waste optimization.
> - Household sharing was already specced in 017. The household row below was checked against `017-FR-034` to `FR-034k`
>   and `FR-041j` on 2026-10-27. All of them say up to 6 accounts, the payer included. All of them say one Pro or Pro
>   with AI subscription covers its household. They match, so nothing changed. A covered member gets the pantry features
>   and AI meal plans through `017-FR-034a`.

> **Household balance (owner ruling, 2026-10-28).** "Let's plan that for the household then". This replaces the
> 2026-10-27 household rows:
>
> - One Pro or Pro with AI subscription shares the household's meal plans, grocery lists, pantry and shared
>   collections with every member, up to 6 accounts (`017-FR-034a`).
> - Personal Pro stays with the payer. Each member's own library follows that member's own plan (`FR-041j`).
> - AI uses for household actions come from the payer's own uses (`017-FR-034c`, `017-FR-034m`).
> - The optional household upgrade, Pro Household, gives every member full Pro (`017-FR-034l`).
> - Two Free cooks can form a household (`017-FR-034k`).

| Plan          | Status              | Price                                          | Private recipes                                   | AI credits                                                                              | Also                                                                                                                    |
| ------------- | ------------------- | ---------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Free          | Recorded 2026-10-27 | None                                           | Up to 50 (ADR-0073). Earned slots add to it (015) | 3 single-call uses a month, the first credit level. Reviewed at 90 days (`005-FR-015d`) | Everything in `FR-040`                                                                                                  |
| Pro           | Recorded 2026-10-26 | $9.99 a month or $99.99 a year. 14-day trial   | No limit                                          | 30 uses a month, the middle credit level. Resets on the billing date                    | The Pro rows below, AI meal plans included                                                                              |
| Pro with AI   | Recorded 2026-10-26 | $19.99 a month or $199.99 a year. 14-day trial | No limit                                          | 300 uses a month, the second credit level. 100 in the trial. Resets on the billing date | Everything in Pro, and AI waste optimization                                                                            |
| Pro Household | Recorded 2026-10-28 | $14.99 a month or $149.99 a year. 14-day trial | No limit, for every member                        | 30 uses a month for each member, Pro's level. Each resets on the payer's billing date   | Full Pro for every member, up to 6 accounts (`017-FR-034l`). A household version of Pro with AI is open ([O-13](#o-13)) |

| Feature                                                    | FR                           | Plan that includes it                                                                                                                                     |
| ---------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| More than 50 private recipes                               | `001-FR-003`                 | Pro, Pro with AI                                                                                                                                          |
| Private `imported_public` recipe, after a substantive edit | `001-FR-003`, ADR-0073 §1    | Pro, Pro with AI                                                                                                                                          |
| AI recipe generation                                       | `005-FR-016`                 | Free, Pro and Pro with AI, using credits                                                                                                                  |
| AI instruction optimization                                | `005-FR-019`                 | Free, Pro and Pro with AI, using credits                                                                                                                  |
| AI meal suggestions                                        | `006-FR-025`                 | Free, Pro and Pro with AI, using credits                                                                                                                  |
| Auto-generated meal plans                                  | `006-FR-026`                 | Pro and Pro with AI, using credits. One model call is one use (amended 2026-10-27, Pro match)                                                             |
| Food waste optimization                                    | `006-FR-027`                 | Pro with AI only, using credits. This is the AI kind. The rule-based pantry suggestions are a separate row                                                |
| Pantry use-by dates, reminders and "use it up" suggestions | `007-FR-034` to `007-FR-040` | Pro, Pro with AI. Rule-based, never AI, and not a credit use. Free keeps the 7-day "already have" pantry (added 2026-10-27, Pro match)                    |
| Own AI keys, several, in an order the cook sets            | `005-FR-015`                 | Pro, Pro with AI. Never Free                                                                                                                              |
| Bulk import allowance                                      | ADR-0072 §8                  | Free 200 recipes a rolling day. Paid plans 1,000 a rolling day                                                                                            |
| Trainer nutrition planning                                 | `009-FR-038`                 | Pro, Pro with AI                                                                                                                                          |
| AI recipe swap suggestions                                 | `009-FR-039`                 | Free, Pro and Pro with AI, using credits. Inferred: 009 calls it AI                                                                                       |
| Online grocery ordering                                    | `007-FR-031`                 | No plan, until a store partner exists                                                                                                                     |
| Every import channel                                       | `004-FR-028`, `016-FR-029a`  | Every plan. A paid plan never sells access to imported content (`016-FR-029a` guardrails)                                                                 |
| Ingredient parse and match checks                          | ADR-0071, ADR-0072           | Every plan. Not a credit use (`FR-041d`)                                                                                                                  |
| The content source check                                   | `020`                        | Every plan. Not a credit use                                                                                                                              |
| Shared Pro features on household content                   | `017-FR-034a`, `FR-041j`     | Pro, Pro with AI, held by any member. AI meal plans, the Pro pantry and shared collections for every member, up to 6 accounts (amended 2026-10-28)        |
| Household AI actions                                       | `017-FR-034c`, `017-FR-034m` | Use the covering payer's own uses. There is no household pool (amended 2026-10-28)                                                                        |
| Personal Pro for every member                              | `017-FR-034l`                | Pro Household only. Personal Pro never comes from another member's Pro or Pro with AI (added 2026-10-28)                                                  |
| Shared household plans, lists, aisle categories and pantry | `017-FR-030`, `017-FR-034k`  | Every plan, Free included (answered 2026-10-28)                                                                                                           |
| Billing grace period                                       | `FR-043b`                    | Pro, Pro with AI and Pro Household. 16 days on the App Store, 7 days on Google Play, Stripe's retry window on the web (added 2026-10-28)                  |
| Referral reward time                                       | `023-FR-020`, `023-FR-022`   | Any plan earns it. A cook who does not pay gets 30 days of Pro features with no extra AI uses. A payer gets 30 more days of their own plan (`023-FR-024`) |

## Owner inputs still needed

Other specs link to this section and its anchors. Most items are now answered. The answers are the rulings of
2026-10-27 and 2026-10-28. The numbers are kept so existing links work. O-13 and O-14, added 2026-10-28, are open.

- <a id="o-2"></a>**O-2. The two levels of AI credits. Answered 2026-10-27.** Free gets 3 single-call uses a month.
  Pro gets 30 uses a month (owner, 2026-10-27, see `005-FR-015a`). Pro with AI gets 300 uses a month. The Pro with AI trial gets 100 uses. The design boards' "50 uses" was a
  placeholder and is replaced. See `FR-041a` and `005-FR-015c`.
- <a id="o-4"></a>**O-4. What one use is. Answered 2026-10-27.** A use is one AI call made on the cook's request,
  whatever it produces (a plan or a recipe). Parse, match and review calls are operating cost and are never a use.
  See `005-FR-015a`.
- <a id="o-5"></a>**O-5. When credits reset. Answered 2026-10-27.** Uses reset on the cook's billing date. A yearly
  plan resets on the same day each month. A Free cook resets on the day the account was created. There is no
  calendar-month reset. See `005-FR-015a`.
- <a id="o-6"></a>**O-6. Credits on a change. Answered 2026-10-27.** See `FR-041f`.
- <a id="o-7"></a>**O-7. Own key without credits. Answered 2026-10-27.** Own keys are for Pro and Pro with AI only.
  A cook may add several keys and set the order they are tried. A Pro or Pro with AI cook falls back to keys only after
  the allowance runs out. See `FR-041c` and `005-FR-015`.
- <a id="o-8"></a>**O-8. The ceiling and paying cooks. Answered 2026-10-27.** The $100 ceiling stays until launch
  funding. The go-live plan is in ADR-0024: a separate operating-AI budget with alarms, and headroom so a paying cook
  with uses left is never refused. See `FR-041d`.
- <a id="o-9"></a>**O-9. Mobile billing. RESOLVED 2026-10-27.** The question was web checkout through an outside link
  on US mobile, or store in-app purchase on iOS and Android, and for which markets. The answer: in-app purchase on
  both stores, Stripe Billing on the web, and RevenueCat joining them. The US "pay on the web" link on iPhone is
  built behind a remote switch and kept off. See `FR-042i` and [ADR-0075](../../docs/architecture/decisions/0075-payment-stack-store-billing-revenuecat-and-stripe.md).
- <a id="o-10"></a>**O-10. Plan change timing. Answered 2026-10-27.** See `FR-041i`.
- <a id="o-11"></a>**O-11. Trial rules. Answered 2026-10-27.** One trial per person ever, with a card required. See
  `FR-041h`.
- <a id="o-12"></a>**O-12. Free households. Answered 2026-10-28: yes.** Two Free cooks can share plans, lists,
  aisle categories and the pantry as a household. A paying member adds the shared Pro features. See `017-FR-034k`.
- <a id="o-13"></a>**O-13. A household version of Pro with AI. Open, added 2026-10-28.** [NEEDS CLARIFICATION: does
  Pro with AI get a household upgrade, as Pro does? Recommended: not at launch. Today a Pro with AI payer already
  shares Pro with AI's shared features and 300 uses for household actions (`017-FR-034a`, `017-FR-034c`). A household
  upgrade that gave each of 6 members 300 uses could cost up to about $62.10 a month (6 × 300 × $0.0345), against
  about $29.99 at Pro Household's 50% rule. One shared 300-use allowance costs at most about $10.35, but that is
  today's model, not an upgrade. A household that wants personal AI for everyone can take Pro Household, and any
  member can add their own Pro with AI. Revisit at the 90-day credit review (`005-FR-015d`), with real use data.]
- <a id="o-14"></a>**O-14. The one-time discount's amount. Open, added 2026-10-28.** [NEEDS CLARIFICATION: what is
  the one discount offered to a cook who declined the trial (`FR-041l`)? Recommended: the first year of Pro yearly at
  $59.99, then $99.99 a year. $59.99 is Samsung Food+'s yearly price, the anchor the Pro match ruling already uses.
  The yearly period fits because yearly plans keep 28% of payers at 12 months against 8% for monthly (RevenueCat
  2026). Prices are owner rulings, so this needs one.]

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-005**: 80% of free-tier users engage with at least 3 core features (recipe creation, search, sharing) within their first week.
- **SC-006**: Pro conversion rate of at least 5% of active free-tier users within the first 3 months.
- **SC-007** _(added 2026-10-28)_: 100% of trials get the pre-charge notice by email at least 3 days before the
  first charge (`FR-041h`). A miss is a compliance defect, not an experiment.
- **SC-008** _(added 2026-10-28)_: Half or more of payments that enter billing retry are recovered, read monthly
  from month 2 (`FR-043b`).
- **SC-009** _(added 2026-10-28)_: Trial starts reach 8.9% of installs by day 30 of the soft launch (`FR-042b`).
- **SC-010** _(added 2026-10-28)_: No surface in this spec puts a prompt, an offer or a question between the cook and
  Cancel. Checked at every EVALUATE (`FR-042e`, `FR-042m`).

These targets come from category data in the 2026-10-28 brainstorm. They are plan targets with a test, not a
predicted Commise result.

## Assumptions

- The free tier is designed as a conversion funnel — features are gated to demonstrate Pro value, not to cripple the free experience.
- **Household coverage is in scope (amended 2026-10-27, owner ruling).** The owner ruled on 2026-10-27: "Include the
  other recommendations in either new features or expanding existing features." That accepts the recommendation
  "Include household sharing in Pro at no extra cost". So one Pro or Pro with AI subscription covers its household
  (`FR-041j`, and `017-FR-034` onward). There is no separate family plan and no paid seat. _(Amended 2026-10-28,
  owner ruling: "Let's plan that for the household then". Pro now shares the household's content, not the payer's
  personal Pro, and Pro Household is an optional household upgrade at one price for the household. There is still
  no price per member.)_ _(Was: "Family plan is out
  of scope for v1. Family/household multi-seat subscriptions are a future consideration only. No FR, no
  architecture, and no task covers family plans in this release. A dedicated spec change is required before any
  family-plan work begins." This amendment is that spec change.)_
- **Web sells through Stripe. The phone apps sell through the stores.** Stripe Checkout and the Stripe Customer Portal are web-only. iPhone sales use App Store in-app purchase and Android sales use Google Play Billing. RevenueCat joins the three into one entitlement record per cook ([O-9](#owner-inputs-still-needed), `FR-042i`, [ADR-0075](../../docs/architecture/decisions/0075-payment-stack-store-billing-revenuecat-and-stripe.md)). _(Was: mobile users are deep-linked to web checkout and in-app purchase is out of scope for v1. Reversed 2026-10-27.)_
- Imported, attributed recipes are always public regardless of subscription tier, in compliance with source Terms of Service.
- **Marketplace payments are out of scope for v1 — but entitlement gating is NOT.** Keep these separate;
  conflating them over-blocks downstream work.
    - **In scope / available**: gating any feature on the caller's subscription tier. `FR-040` … `FR-044`
      cover it, and `FR-044` is what makes it enforceable outside the identity service.
    - **Out of scope**: anything that moves money **to a creator** — one-time payments (tips), per-item
      purchases, creator-defined subscription tiers, revenue splitting, and payouts.

    **Downstream requirements that depend on the deferred half**, surfaced by the 2026-08-02 spec sweep:
    - `012-creator-profiles` `012-FR-031`–`034` (DRAFT) — tip jar and creator-earnings surface. (An
      earlier revision also listed premium recipes and paid follows; both are **withdrawn** — recipe
      visibility is binary private/public and owned by 001, so 012 has no gated content to sell.)
    - `013-cooking-school` `013-FR-010` — "Revenue share: platform 20%, educator 80% (pro tier: 15%/85%
      via 010)", with course revenue "disbursed via 010's payout model".

    Entitlement **gating** is not blocked by this. Gating the Pro tier's own features — private recipe
    visibility (`001-FR-003`), AI generation, meal suggestions — needs only `FR-044`, and 013's course
    access control gates on the learner's entitlement the same way.

    Marketplace payments need their own spec — in 010 or a dedicated payments feature — including the
    money-transmission and tax posture that splitting third-party revenue implies (e.g. Stripe Connect, 1099
    reporting). **Do not plan creator compensation against 010 as it stands.**
