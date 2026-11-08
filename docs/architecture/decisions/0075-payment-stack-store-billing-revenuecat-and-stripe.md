# 0075: Payment stack: store billing, RevenueCat and Stripe

- **Status:** Accepted
- **Date:** 2026-10-27
- **Relates to:** Spec 010 (subscriptions): `FR-042i` and owner input O-9, which this ADR answers. Spec 016
  (legal and compliance): `016-FR-042`, `016-FR-050`. [ADR-0073](0073-free-tier-private-slots.md): what a paid plan
  sells. [ADR-0018](0018-per-sender-webhook-dedup-tables.md): the webhook dedup table that Stripe's events use.
  [ADR-0024](0024-llm-spend-ceiling-reserve-then-settle.md): the AI spend ceiling, which is not a cook's allowance.

## Context

Commise sells two paid plans, Pro and Pro with AI, on the web, on iPhone and on Android. Every app must know at every
moment what a cook has paid for. Spec 010 left one question open as O-9: how do cooks pay on mobile? The store
rules changed in 2025 and 2026, so the answer was not obvious.

The owner decided on 2026-10-27. This ADR records the decision and the facts behind it. The facts come from the
payment decision brief of 2026-10-27. Each one carries the page it was read from. A fact marked "reported"
comes from a secondary source.

### What the research found

- **Most subscription money comes through the stores.** Web purchases are 3.2% of revenue worldwide and 4.9% in
  North America, across 115,000+ apps on RevenueCat
  ([RevenueCat State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps)). This data
  comes from apps that are mostly mobile first. Commise has a full web app, so its web share can be higher. We will
  only know after launch.
- **The store fee is already at its lowest rate.** Apple's Small Business Program charges 15% up to $1M of proceeds
  a year ([Apple](https://developer.apple.com/app-store/small-business-program/)).
  Google charges 10% plus a 5% billing fee on subscriptions. This holds in the US, the EU, the UK and Australia. Source:
  [Google Play service fees](https://support.google.com/googleplay/android-developer/answer/112622?hl=en).
- **A web-only iPhone app is not allowed for us.** A recipe app is not a "reader app"
  ([Apple reader apps](https://developer.apple.com/support/reader-apps)).
  Guideline 3.1.3(b) has one rule for web purchases. The items must also be sold in the app: "those items are also
  available as in-app purchases within the app"
  ([Apple guidelines](https://developer.apple.com/app-store/review/guidelines/)).
  So every mobile option keeps in-app purchase.
- **The web provider barely changes the total cost at the market mix.** For 100,000 registered users at 5%
  conversion, all on Pro, every "store plus web provider" stack costs between $6,945 and $7,010 a month, which is
  15.5% to 15.7% of revenue. This is derived arithmetic on the sourced fees, and it is scenario input, not a
  forecast. The merchant-of-record premium is $1 to $132 a month across the whole grid.
- **A web link for US iPhone buyers is not proven.** Apple lets a US-storefront app link to an outside purchase with
  no entitlement ([Guideline 3.1.1(a)](https://developer.apple.com/app-store/review/guidelines/)). Apple's US rate
  for it is not settled. A court sent the rate back on 11 December 2025
  ([Fenwick](https://www.fenwick.com/insights/publications/ninth-circuit-largely-upholds-ruling-in-epic-v-apple),
  reported). Apple proposed 15%, or 5% for Small Business, on 13 August 2026
  ([mjtsai](https://mjtsai.com/blog/2026/08/17/), reported). The one controlled test found fewer buyers.
  The in-app plus web variant kept 86 cents per in-app dollar at a 15% store fee
  ([RevenueCat Dipsea test](https://www.revenuecat.com/blog/growth/iap-vs-web-purchases-conversion-test)).
  The vendor ran the test. It covers one app. Its web price was discounted 30%.
  Our break-even is a loss of 4.0% of iPhone proceeds. That figure is derived arithmetic.
- **Tax is the duty that does not depend on size.** An overseas seller must register for UK VAT at its first UK
  sale ([gov.uk](https://www.gov.uk/vat-registration)).
  The EU's 10,000 euro threshold applies only to a seller based in one EU state.
  So a US seller probably has no threshold
  ([EU one-stop shop](https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en)).
  That reading is ours, and the tax adviser must confirm it.
  In the US, most states require registration at $100,000 in sales or 200 transactions into the state.
  The sources disagree on the exceptions (reported).

## Decision

### 1. Mobile sales use the stores

iPhone sales use App Store in-app purchase. Android sales use Google Play Billing. This holds in every market.
Commise enrols in Apple's Small Business Program first. A cook who bought on a store cancels and restores on that
store (`016-FR-042`).

### 2. RevenueCat joins every purchase into one entitlement record

RevenueCat verifies App Store and Google Play receipts, handles their notifications, and syncs web purchases. It keeps
one entitlement per app user ID. The app user ID is the Clerk user ID on all three platforms. Source:
[RevenueCat identity](https://www.revenuecat.com/docs/customers/identifying-customers).
The entitlement record
answers "does this cook have Pro, Pro with AI, or nothing, right now?" no matter where the cook paid.

### 3. The web sells through Stripe Billing, connected by RevenueCat's Stripe Billing integration

The seller of record changes in two steps.

- **At first, Commise is the seller.** Web sales go to US buyers only. Commise handles US sales tax with Stripe Tax.
  Commise also answers refunds and chargebacks. A dispute costs $15
  ([Stripe pricing](https://stripe.com/pricing)).
- **Then Stripe becomes the seller.** Commise asks Stripe for Managed Payments now. It is switched on once Stripe
  confirms our product is eligible. Stripe then handles tax in 80+ countries. Source:
  [Stripe Managed Payments](https://stripe.com/managed-payments).
  In RevenueCat's Stripe integration, you turn Managed Payments on with one option.
  The option reads "Use Managed Payments when available". It adds no RevenueCat fee. Source:
  [RevenueCat Managed Payments](https://www.revenuecat.com/docs/web/integrations/stripe/stripe-managed-payments).
- **Web sales widen to other countries only after Managed Payments is live.** RevenueCat's page says an ineligible
  product "will proceed in non-managed payments mode", which makes Commise the seller again, tax included. So
  Managed Payments must be active on live sales, and every price must have an eligible tax code, before any
  non-US buyer is let in.
- **Paddle through RevenueCat is the fallback.** Stripe can say no to Managed Payments.
  Then Commise uses Paddle as merchant of record
  ([RevenueCat Paddle](https://www.revenuecat.com/docs/web/integrations/paddle)).
  Commise asks for Paddle's price on a $9.99 plan first. Its page says "contact us for bespoke pricing" under $10
  ([Paddle pricing](https://www.paddle.com/pricing)).
  The other fallback is to stay a US-only seller.

### 4. The US "pay on the web" link on iPhone is built behind a remote switch and kept off

The link opens Commise's web checkout from the iPhone app, on the US storefront only. The switch is off. It turns on
only after both of these happen.

- Apple's US rate for the link is settled.
- Our own test shows a loss of no more than about 4% of iPhone proceeds.

If Apple sets 15%, or the Supreme Court rules for Apple on contempt, the link stays off. The Supreme Court took
Apple's appeal on 30 June 2026 (reported by
[MacRumors](https://www.macrumors.com/2026/06/30/apple-epic-games-supreme-court/)). Link-outs on Android, in the EU and elsewhere are not built.
At 10% plus card fees they cost more than in-app purchase on monthly plans.
They save about one point on annual plans.
One point does not pay for a second flow.
It also does not pay for Google's program duties.
Google adds a $2.85 install fee. Source:
[Google](https://support.google.com/googleplay/android-developer/answer/16470497?hl=en).

### 5. A cook changes or cancels only on the platform where they bought

This is a limit of every stack, not a choice
([RevenueCat identity](https://www.revenuecat.com/docs/customers/identifying-customers)). A cook who bought Pro on
iPhone cannot upgrade to Pro with AI on the web without cancelling on iPhone first. The subscription page and the
account screen show where each cook pays. The product blocks a second purchase for a cook who already has an active
entitlement, so nobody pays twice across channels.

### 6. Compliance duties stay with Commise in every stack

No option makes Commise compliant by itself. Commise builds these parts (`016-FR-050`):
the paywall wording, the consent step, the trial disclosure and the "where do I cancel" screen.
It also builds the cross-channel "one trial per person ever" check. Apple and Google track trial eligibility per store account, so a web trial and an iPhone trial need
Commise's own check.

## Consequences

**Accepted:**

- **RevenueCat takes 1% of tracked revenue above $2,500 a month.** The first $2,500 is free. Above it, RevenueCat
  charges "1% of your MTR tracked (before store commission and taxes)" on all of it, for example "$2,600 ... $26"
  ([RevenueCat account docs](https://www.revenuecat.com/docs/welcome/set-up-revenuecat/account-management),
  [pricing](https://www.revenuecat.com/pricing/)). Across the research grid this is $0 to $894 a month.
- **Store fees are the main cost.** About 95% of revenue goes through the stores at the market mix. The total
  payment cost is about 15.5% of revenue. This is much more than the roughly 9% an earlier financial model assumed,
  because that model guessed a 60% web share.
- **A cook can change or cancel only on the platform of purchase.** A cook who wants to move between plans across
  platforms must cancel on one and buy on the other. This is a support and design cost.
- **Web sales carry US sales tax duties until Managed Payments is live.** Commise is the seller, so it owes the
  registration, collection and filing. Stripe Tax Basic calculates tax only.
  It costs 0.5% per transaction, only where Commise is registered. Source:
  [Stripe Tax](https://stripe.com/tax/pricing).
  Filing help (Tax Complete) starts at $90 a month.
  That covers 2 registrations, 200 transactions a month and 4 filings a year (same page). At the market mix, web sales
  stay small, so registration in a US state is unlikely at launch. The tax adviser confirms this. Web sales outside
  the US wait for Managed Payments, so no UK or EU registration duty starts.
- **Managed Payments has lock-in.** A card is authorised only for Managed Payments, and charging it elsewhere needs
  fresh consent from the cook. Until the box is ticked, cards stay in Commise's own Stripe account.
- **The entitlement source gains a second writer.** RevenueCat joins the Stripe webhook as a writer of the
  entitlement. The identity service design in spec 010's plan must be extended for it. That design is owed.
- **Existing designs stay valid for web.** Stripe Checkout, the Customer Portal and the Stripe webhook design in the
  010 plan still apply to web sales.

**Accepted risks, with the open questions that bound them:**

- Stripe has not confirmed that a recipe and meal-planning subscription is eligible for Managed Payments. It has not
  stated whether Billing's 0.7% fee stacks on the 3.5% Managed Payments fee. It has not stated whether a
  card-required 14-day trial works with Managed Payments. Whether Checkout can be limited to US billing addresses is
  also unconfirmed.
- The tax conclusions, the California automatic renewal law, the EU withdrawal button, Germany's cancellation button
  and the UK subscription regime from January 2027 all need a lawyer and a tax adviser before launch. Several of
  these rest on law-firm summaries.
- The conversion evidence is vendor run. It is the reason the web link stays off until Commise has its own test.

## Alternatives

**Build the entitlement layer ourselves.** Rejected. We must build four things.
The first is Apple server notifications, which retry at 1, 12, 24, 48 and 72 hours.
The second is Google real-time notifications, each needing a follow-up API call.
The third is Google's three-day acknowledgement rule.
The fourth is one entitlement table. Sources:
[Apple](https://developer.apple.com/documentation/appstoreservernotifications/responding-to-app-store-server-notifications),
[Google](https://developer.android.com/google/play/billing/rtdn-reference). No published effort estimate exists, and
every part of it is on-call work. RevenueCat is free until $2,500 a month and costs 1% after that. A small team does
better to rent it. Adapty (free to $5k, then 1%) and Qonversion (free to $7k, then 0.8%) do the same job. They were
not chosen because RevenueCat has the documented Stripe, Paddle and Managed Payments paths that this decision needs.

**Paddle first.** Rejected as the first choice. Paddle charges "5% + 50 cents per Checkout transaction", about 10% on
a $9.99 plan, and its page invites contact for bespoke pricing under $10. A live checkout domain needs Paddle's
approval. Managed Payments through Stripe costs about the same, keeps the most doors open, and has no extra
RevenueCat fee. Paddle stays as the fallback.

**A web-only setup.** Rejected. Apple's guideline 3.1.3(b) requires in-app purchase as well for an app like ours, so
a web-only iPhone app is not an option. Even a web-first design is a bound only. The Dipsea web-only variant had
18.1% initial conversion against 27.0% for in-app purchase only, and the web-only variant belongs to a reader app.

**Plaid.** Rejected. Plaid is not a payment processor: "Plaid does not function as the payment processor"
([Plaid Auth](https://plaid.com/docs/auth/)). It links bank accounts only.
Bank debit through Stripe (0.8%, capped at $5) was also rejected.
A failed payment costs $4 and a dispute costs $15. Source:
[Stripe local methods](https://stripe.com/pricing/local-payment-methods).
On a $9.99 plan that wipes out the saving.

**Link-outs on every store.** Rejected for now. See decision 4.

**Clerk Billing.** Rejected. It works on the web only.
Its docs say "NO Apple IAP / Google Play Billing integration".
It has no tax support and takes USD only. Source:
[Clerk Billing](https://clerk.com/docs/billing/overview).

## Revisit triggers

Revisit this decision when any of these happens.

- Stripe refuses Managed Payments, or any of our prices falls back to non-managed mode. Use Paddle through
  RevenueCat, or stay a US-only seller.
- Commise's measured web share of revenue is far above 4.9%, say a third or more. Re-run the cost grid. The
  merchant-of-record premium grows, and RevenueCat Web Billing or a self-seller Stripe setup gets more attractive.
- Apple's US link-out rate is set and our test shows a loss of no more than about 4% of iPhone proceeds. Turn the
  link on in the US.
- Apple's US rate is set at 15%, or the Supreme Court rules for Apple. Leave the link off, and consider removing it.
- Apple proceeds approach $1M a year. Above it Apple takes 30% in a subscriber's first paid year
  ([Apple subscriptions](https://developer.apple.com/app-store/subscriptions/)). Reconsider the hybrid link and the
  push for annual plans on the web.
- Google's US fees are struck down. Re-check Android link-out.
- The EU, UK, Canada or Australia open before Managed Payments is live. Block those countries at web checkout, or
  register for VAT or GST first.
- Managed Payments card lock-in is judged unacceptable. Start as a US-only seller and ask Stripe how to move
  subscriptions later.
- RevenueCat's price or terms change, or its monthly bill passes the cost of owning the entitlement layer.
