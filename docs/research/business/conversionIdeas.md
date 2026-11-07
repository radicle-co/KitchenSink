## Conversion, retention and revenue per install: ideas beyond the current plan

This brainstorm lists 32 ideas that are not in the business plan yet, and ranks the best 12. The top idea is not a growth trick. It closes a gap: spec 014 rules email and mobile push out of scope (A-005), but 010-FR-041h needs a notice before the first trial charge.

Written 2026-10-28 for the owner's question: "brainstorm on what we can do beyond our current plan to maximize success in obtaining downloads and subscriptions." This file covers conversion, retention and revenue per install. Acquisition is covered by a separate brief.

Tags: [P] primary page opened, [S] secondary page opened, [D] my arithmetic on cited inputs, [R] owner ruling, [M] method choice. "No evidence" means no published effect was found, so the idea carries a plan target and a test, never an uplift.

### 1. Rules every idea was checked against

These rulings and spec rules limit what can be done. Each idea below says which ones it touches.

| Rule                                                              | Where                       | What it rules out or limits                                                                                                                                                |
| ----------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One trial per person, ever, card required                         | 010-FR-041h [R]             | Free win-back months, founding-member months and longer trials either break this or need a ruling. Spec 023 already has a model: reward time "is not a trial" (023-FR-025) |
| No retention offer between the cook and Cancel                    | 010-FR-042e                 | No save offers inside our cancel flow. A message after the cancel is confirmed is fine                                                                                     |
| No timers, no "today only", no prompt again in the same session   | 010-FR-042d, 022-FR-036     | Seasonal and launch offers may state a real end date. They may not count down                                                                                              |
| Prices are ruled                                                  | Owner rulings [R]           | Intro prices, lifetime, student and regional prices all need a price ruling. Tests change the display, the order and the copy, not the price                               |
| No AI uses as rewards, $100 AI ceiling until launch (ADR-0024 §6) | 023-FR-024, 010-FR-041d [R] | A lifetime plan or a gift cannot carry platform AI                                                                                                                         |
| No reward tied to a review                                        | 023-FR-034                  | The rating prompt uses only the native API, with no incentive                                                                                                              |
| US only at v1                                                     | 016-FR-048                  | Regional pricing ranks last                                                                                                                                                |
| The in-app link to web checkout stays off                         | 010-FR-042i [R]             | A web funnel must start on the marketing site (022), never inside the iPhone app                                                                                           |
| The front door is sign-in                                         | 001-FR-045a [R]             | A guest mode would reverse a ruling. It is not proposed                                                                                                                    |
| Email and mobile push are out of scope                            | 014 A-005                   | Every reminder idea below needs this changed first (idea 1)                                                                                                                |

### 2. Already in the plan, so not counted

These are in the business plan (not published), `priceEvaluation.md` section 4.2 or the specs. They are not repeated as ideas.

- The trial offer in onboarding, with a clear "continue free".
- Activation targets: first saved recipe in under 3 minutes, a plan, list or cooking action in 7 days.
- The 50-recipe private cap as the real paywall.
- Household sharing in Pro, up to 6 accounts.
- Yearly plan shown first, shown as $8.33 a month.
- The "capture and nutrition in one app" anchor against a two-app stack.
- Trainers as a named segment, and a 10-trainer beta test.
- 30-day trials on creator and referral codes, and the referral program in spec 023.
- Import from other apps as the first thing a new cook sees, and full export.
- A Van Westendorp price survey, for information only.
- Sign in with Apple and Google One Tap (owner rulings, 2026-10-13).
- The out-of-credits message that names the next plan once (010-FR-041e).

### 3. The owner's direct question: start the trial at onboarding, or at the first capped action?

Both, in that order. Keep the onboarding offer as planned, and design a second offer for the cooks who said "Not now".

The data points both ways. Adapty reports that "89.4% of trial starts happen on Day 0" ([Adapty SOIS 2026](https://adapty.io/state-of-in-app-subscriptions/)) [S]. RevenueCat reports that a third of conversions come on day 0, but 23% of freemium conversions come after week 6 ([RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps/), via `conversionStudy.md`) [P].

So the onboarding offer catches the largest group. The later group needs a second moment tied to real value, such as a finished library import or the 50th private recipe. That second moment is idea 6. It must follow 010-FR-042d: once per session, and an equal "Not now".

### 4. How the ideas are ranked

The ranking is a judgment ordering, not a combined score. No uplift numbers are added together.

Three things set the order [M]:

1. **The size of the funnel stage the idea touches.** In the business plan's funnel model (not published), the two biggest drops are sign-up to trial, and the first yearly renewal.
2. **The share of installs it reaches.** An idea that touches every payer beats one that touches only lapsed payers.
3. **Founder hours.** S is up to 30 hours, M is 30 to 120 hours, L is over 120 hours [M].

**Volume limits every test.** Early install volumes are small. An A/B test on trial starts needs about 3,500 cooks per arm to see a 23% relative lift on an 8% base [D: 16 × 0.08 × 0.92 ÷ 0.0184²]. That takes months. So each test below uses a fast leading signal and names its read date.

### 5. The ideas

#### Idea 1. Add an email and push channel, starting with the trial-ending notice

- **What it is.** Amend 014 so it can send email and mobile push, not only in-app messages. The first message is the notice before a trial's first charge. Then come the reminders in ideas 3, 10 and 11.
- **Why it works.** 010-FR-041h requires "a clear notice before the first charge, with the date and the amount", sent early enough to cancel. Today no channel can carry it outside the app. Stripe can "Send a reminder email 7 days before a free trial ends" ([Stripe](https://docs.stripe.com/billing/subscriptions/trials/manage-trial-compliance)) [P]. That covers web trials only. Whether Apple and Google send their own pre-charge notice was not verified in this pass. Do not assume they do. On growth, Phiture's Headspace work with "push, in-app, and Email channels" reported "+109% uplift in week 1 retention" against a control group ([Phiture](https://phiture.com/success-stories/headspace-retention/)) [S, vendor case].
- **Effort and cost.** M. Transport fees are a GAP (pricing pages not opened). Expected small next to AI spend.
- **Expected effect and test.** No Commise uplift is claimed. Plan target: 100% of trials get the notice at least 2 days before the charge. Test: send it to every beta trial. Kill rule: none. This is a compliance floor, not an experiment.
- **Legal risk.** Lowers risk. ROSCA requires "simple mechanisms for a consumer to stop recurring charges" ([15 U.S.C. 8403 via Cornell LII](https://www.law.cornell.edu/uscode/text/15/8403)) [S]. Marketing email needs its own consent, separate from the notice.
- **Spec.** Amend 014 (A-005) and 010-FR-041h. Or a new lifecycle-messaging spec.

#### Idea 2. Show the trial as a timeline on the paywall, and keep the promise

- **What it is.** The paywall draws three steps: "Today: full Pro", "Day 12: we remind you", "Day 14: first charge of $99.99, unless you cancel". Then the reminder is sent on day 12 through idea 1.
- **Why it works.** In the Blinkist case, "this simple demonstration of transparency led to a 23% lift in trial signups" and "reduced customer complaints by 55%" ([Growth.Design](https://growth.design/case-studies/trial-paywall-challenge)) [S, one company]. It targets the biggest drop in the funnel. RevenueCat also finds that 35.7% of 14-day trial cancellations happen on day 0 ([RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps/)) [P]. A trusted reminder removes the reason to cancel at once.
- **Effort and cost.** S once idea 1 exists. $0 cash.
- **Expected effect and test.** Plan target: trial starts per paywall view at or above 8.9%, RevenueCat's median for above-average prices (`conversionStudy.md`) [P]. Read at day 30 of the soft launch. Ship it to everyone, because an A/B test is too slow at this volume. Kill rule: if trial-to-paid falls below 30% by day 45, review the reminder copy, not the timeline.
- **Legal risk.** Lowers risk. It discloses the terms before billing, which ROSCA requires.
- **Spec.** 010-FR-042b (add the timeline as a required state).

#### Idea 3. Ask for push permission in context: "Remind me before my trial ends?"

- **What it is.** Ask for notification permission right after a trial starts, framed as the reminder from idea 2. Ask again only at a later real need, such as a pantry use-by date.
- **Why it works.** Headspace asked free trialists "to opt-in to remind them of their free trial ending" and saw "+118.35% uplift in push opt-ins in the German language segment of free trialists" ([Phiture](https://phiture.com/success-stories/headspace-inapps/)) [S]. Blinkist saw push opt-in go "from 6%" to "74%" with the same framing ([Growth.Design](https://growth.design/case-studies/trial-paywall-challenge)) [S]. The Food and Drink baseline is 40% on iOS and 32.8% on Android ([OneSignal](https://onesignal.com/mobile-app-benchmarks-2024)) [S].
- **Effort and cost.** S. $0 cash.
- **Expected effect and test.** Plan target: iOS opt-in among trial starters at or above 40%. Read after 200 prompts. Kill rule: under 30% after 200 prompts, change the copy and the moment.
- **Legal risk.** Low. The system dialog is the consent. No pre-ticked choices.
- **Spec.** 014 amendment (idea 1). New onboarding copy for `staff-ux-engineer`.

#### Idea 4. Recover failed payments before they become churn

- **What it is.** Turn on every rail's payment-recovery tool, and add an in-app "update your payment method" banner during the grace period.
    - Apple Billing Grace Period of 16 or 28 days.
    - Google Play grace period and account hold.
    - Stripe Smart Retries and automatic card updates.
- **Why it works.** RevenueCat: "Nearly a third of all subscription cancellations on Google Play are involuntary billing failures", against 14% on the App Store ([RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps/)) [P]. Apple: "There won't be any interruption to the subscriber's days of paid service or to your revenue if Apple recovers the subscription within the grace period" ([Apple](https://developer.apple.com/help/app-store-connect/manage-subscriptions/enable-billing-grace-period-for-auto-renewable-subscriptions)) [P]. Stripe's default is "8 tries within 2 weeks" ([Stripe](https://docs.stripe.com/billing/revenue-recovery/smart-retries)) [P].
- **A spec defect this finds.** 010-FR-043 sets a 7-day grace period. Apple offers only "3, 16, or 28 days" [P]. Google's account hold is "60 days minus any grace period duration" ([Android](https://developer.android.com/google/play/billing/lifecycle/subscriptions)) [P]. So 010-FR-043 cannot hold on every rail. It should state the grace per rail.
- **Effort and cost.** S. Store settings plus one banner on web and mobile. $0 cash.
- **Expected effect and test.** Plan target: at least half of payments in billing retry recovered. Read monthly from RevenueCat from month 2. Kill rule: none. The tools have no downside except a few days of access during retry.
- **Legal risk.** Low. The banner must not threaten data loss. 010-FR-043a keeps every recipe on a lapse.
- **Spec.** 010-FR-043 (amend the grace period per rail).

#### Idea 5. Offer monthly payers a switch to yearly after their second renewal

- **What it is.** After a monthly payer's second charge, show one card: "Switch to yearly and pay $99.99 instead of $119.88 a year." 010-FR-041i already lets the switch take effect at once, with credit for unused time.
- **Why it works.** Yearly plans keep 28% of payers at 12 months, monthly plans keep 8% (RevenueCat 2026, via `conversionStudy.md`) [P]. Monthly payers who survive two renewals have shown intent.
- **Effort and cost.** S. $0 cash.
- **Expected effect and test.** Plan target: 10% of prompted monthly payers switch within 30 days. Read after 100 prompts. Kill rule: under 3% after 100 prompts, stop the card and keep the option on the page.
- **Legal risk.** Low if both prices and the effect date are shown (010-FR-042h). Shown once, with an equal "Not now".
- **Spec.** 010 (new FR under FR-041i).

#### Idea 6. A second-chance offer at real value moments

- **What it is.** For cooks who declined the onboarding offer, show the trial again once, at a moment of real value:
    - a finished library import,
    - the 50th private recipe,
    - a household invite,
    - the first AI meal plan from Free's 3 uses.
- **Why it works.** 23% of freemium conversions come after week 6 (RevenueCat 2026, via `conversionStudy.md`) [P]. A RevenueCat guest author warns: "If a paywall appears before context is established, it feels jarring" ([RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps/)) [P].
- **Effort and cost.** S to M. $0 cash.
- **Expected effect and test.** Plan target: trials started at value moments reach 20% of all trial starts by month 3. Read monthly. Kill rule: under 5% by month 3, keep only the cap moment.
- **Legal risk.** Medium if overdone. DSA Article 25(3)(b) names "repeatedly requesting that the recipient of the service make a choice where that choice has already been made" ([DSA Art. 25, secondary text](https://www.eu-digital-services-act.com/Digital_Services_Act_Article_25.html)) [S]. So: once per moment, never in the same session after "Not now".
- **Spec.** 010-FR-042 (the prompt hierarchy).

#### Idea 7. Ask for a store rating at a success moment, and reply to reviews

- **What it is.** Call the native rating API after a cook finishes a recipe in cooking mode, or after a third planned week. Reply to store reviews every week.
- **Why it works.** Apple: "Individual ratings inform your app's summary rating, which is displayed on your product page and in search results." Apple allows "up to three times in a 365-day period" and advises asking "when they've completed an action, level, or task" ([Apple](https://developer.apple.com/app-store/ratings-and-reviews/)) [P]. On Google, a reviewer gets "a push notification and an email notification" when you reply ([Google](https://support.google.com/googleplay/android-developer/answer/138230)) [P].
- **Effort and cost.** S. $0 cash.
- **Expected effect and test.** Plan target: store rating of 4.5 or more on both stores by month 3. Read monthly. Kill rule: if the rating falls after a prompt change, move the moment.
- **Legal risk.** Low if done plainly. Google says the app "shouldn't ask the user any questions before or while presenting the rating button" and should not use a button to trigger it ([Android](https://developer.android.com/guide/playcore/in-app-review)) [P]. The FTC bans "incentives conditioned on the writing of consumer reviews expressing a particular sentiment" ([FTC](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)) [P]. No "Do you like Commise?" gate.
- **Spec.** 008 (cooking mode end) and 006. New FR.

#### Idea 8. A trial checklist that walks the cook through Pro's value

- **What it is.** During the 14-day trial, a dismissible card with three steps:
    - add 5 pantry items with use-by dates,
    - invite one household member,
    - make one AI weekly plan.
- **Why it works.** No evidence: target plus test. The median trial-to-paid for 10 to 16 day trials is 35.4% (RevenueCat 2026, via `conversionStudy.md`) [P]. Pro's own additions are the pantry, household and AI plans, so a cook who never tries them sees only the cap.
- **Effort and cost.** M. $0 cash. AI plan uses come from the trial allowance.
- **Expected effect and test.** Plan target: trialists who finish 2 of 3 steps convert above 35.4%. Read at day 45 of the soft launch. Kill rule: no gap between finishers and others after 100 trials, remove the card.
- **Legal risk.** Low. Dismissible, no pressure copy.
- **Spec.** 010 (trial state, FR-042g). Touches 007 and 017.

#### Idea 9. Ask "who do you cook for?" and invite the household during the trial. Rule free household lists

- **What it is.** Onboarding asks one question about household size. During the trial the cook can invite members, who are covered by Pro. Separately, the owner rules 017-FR-034k, which recommends that two Free cooks can share plans and lists.
- **Why it works.** Family plans were 18% of Duolingo's paid subscribers, and Duolingo wrote that promoting its Family Plan "we believe will further increase subscriber retention" (Duolingo shareholder letter, cited in the business plan, not published) [P, a belief]. 017-FR-034k says "each invite is a free growth loop". No evidence on conversion: target plus test.
- **Effort and cost.** S to M. Household is already specified. $0 cash.
- **Expected effect and test.** Plan target: 25% of trials add a member (the plan's month-6 target for payers, moved earlier). Read at day 45. Kill rule: under 10%, stop asking in onboarding.
- **Legal risk.** Low. An invite is sent by the cook. 023-FR-030 already blocks household referral rewards.
- **Spec.** 017-FR-034k (owner ruling needed). Onboarding copy is new.

#### Idea 10. A weekly plan ritual: a reminder on the cook's chosen day, with one-tap "repeat last week"

- **What it is.** After a cook plans a first week, offer an opt-in reminder on a day and time they choose. The reminder opens the planner with "repeat last week" and "use a template" ready.
- **Why it works.** Spec 006 states that "Re-planning from scratch every week is the main reason users abandon meal planners" (006 User Story 3) [spec claim, not market data]. Duolingo found that "learners who reach a streak of just 7 days are 3.6 times more likely to complete their course" ([Duolingo](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)) [P, correlation]. No recipe-app evidence.
- **Effort and cost.** M. Needs idea 1. $0 cash.
- **Expected effect and test.** Plan target: monthly payers still paying at month 3 of 31% or better (the RevenueCat median, gate G9). Leading signal: weeks with a planned meal per active household, read weekly from week 4. Kill rule: under 1 planned week a month among reminder users after 8 weeks, change the day default and copy.
- **Legal risk.** Low. Opt-in, easy to turn off, no guilt copy.
- **Spec.** 006 (new FR) and 014.

#### Idea 11. "Your year in Commise" 30 days before the yearly renewal

- **What it is.** A recap sent 30 days before a yearly renewal. It lists recipes saved, meals planned, meals cooked and pantry items used in time. It also states the renewal date and amount, with a cancel link and a "switch to monthly" option.
- **Why it works.** No evidence: target plus test. Spotify's Wrapped pages give reach, not conversion ([Spotify](https://newsroom.spotify.com/2025-wrapped/)) [P]. It is ranked because the first yearly renewal is the second-biggest drop: about 72% of yearly payers leave (RevenueCat 2026: 28% of yearly payers stay at 12 months, via `conversionStudy.md`) [P].
- **Effort and cost.** M. $0 cash.
- **Expected effect and test.** Plan target: first yearly renewal at or above 28% (gate G8). The real read is month 13, which is too slow. Leading signal: recap opens and "manage plan" taps in months 1 to 3 with beta and test accounts. Kill rule: if cancel taps from the recap exceed renewals in the first 50 recaps, rewrite it.
- **Legal risk.** Lowers risk. A renewal notice with the amount and a cancel path fits ROSCA. California's own reminder rules were not confirmed at a primary page in this pass. Counsel confirms (016-FR-050).
- **Spec.** 010 (new FR) and 014.

#### Idea 12. After a cancel is confirmed, keep the door open and ask one question

- **What it is.** After a cancel is confirmed, never before it, show what stays and one optional question:
    - recipes stay, and private recipes stay private,
    - the paid period's end date,
    - equal options to switch plan (Pro with AI to Pro, yearly to monthly),
    - one optional reason question.
      The same single question goes to cooks who cancel a trial on day 0.
- **Why it works.** 010-FR-042e forbids an offer between the cook and Cancel. DSA Article 25(3)(c) names "making the procedure for terminating a service more difficult than subscribing to it" [S]. A screen after the cancel respects both. Blinkist found "33% of cancellations are done right after users start their trial" ([Growth.Design](https://growth.design/case-studies/trial-paywall-challenge)) [S]. The reasons are product data we do not have.
- **Effort and cost.** S. $0 cash. Store purchases cancel in the store (016-FR-042), so this screen shows on return to the app.
- **Expected effect and test.** Plan target: a reason from 30% of cancels. Read after 50 cancels. Kill rule: none. It is a learning tool.
- **Legal risk.** Low if it comes only after the cancel is confirmed and nothing is pre-selected.
- **Spec.** 010-FR-042e and FR-042g (add a "just cancelled" state).

#### Idea 13. Win-back offers for lapsed payers

- **What it is.** Use the store tools to offer a lapsed payer one free month, then the ruled price. Apple has win-back offers, Google has developer-determined offers, and the web can use a Stripe coupon.
- **Why it works.** Apple shows win-back offers to "lapsed subscribers" in their Manage Subscription page, and "within your app on the win-back offer sheet on iOS 18". The developer sets "Time Since Last Subscribed" and "Wait Between Offers" ([Apple](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-win-back-offers)) [P]. Google lets you "limit an offer to past subscribers who have previously canceled" ([Google](https://support.google.com/googleplay/android-developer/answer/12154973)) [P]. RevenueCat's calculator shows a default benchmark of "Monthly reactivation: 15.8%, Annual: 7.0%" for Media and Entertainment, not food ([RevenueCat](https://www.revenuecat.com/reactivation-calculator)) [P, wrong category].
- **Effort and cost.** S to M. Revenue forgone: one month of list price per redeemed offer.
- **Expected effect and test.** Plan target: 5% of lapsed payers come back within 60 days of an offer. Read from month 4. Kill rule: under 2% after 100 offers, stop.
- **Legal risk.** Low on format. Needs a ruling: is a free win-back month a second trial under 010-FR-041h? It can follow 023-FR-025's "not a trial" model. A discount instead of a free month needs a price ruling.
- **Spec.** 010 (new FR). Owner ruling needed.

#### Idea 14. Put the cook's own counted numbers on the paywall

- **What it is.** The paywall shows facts about this cook, for example "48 of 50 private recipes used" or "212 recipes imported". Only counted facts, never estimates.
- **Why it works.** No evidence: target plus test. The cap is the real paywall (business plan, not published), so showing where the cook stands makes the value concrete.
- **Effort and cost.** S. $0 cash.
- **Expected effect and test.** Plan target: trial starts per cap-moment view above the onboarding rate. Read after 200 cap views. Kill rule: no difference, drop it.
- **Legal risk.** Low if every number is a real count. No "you will lose" framing, because nothing is lost on a lapse (010-FR-043a).
- **Spec.** 010-FR-042b.

#### Idea 15. Test the display inside the ruled prices

- **What it is.** Test how plans are shown, never what they cost:
    - per-person household cost ("$1.39 a month each for a household of 6" [D: $99.99 ÷ 12 ÷ 6]),
    - whether Pro with AI sits beside Pro or behind a link,
    - the order of the plan cards.
- **Why it works.** RevenueCat Experiments can test "The number and mix of products offered" and "Paywall imagery, copy, layout, and more", with "up to 4 variants" ([RevenueCat](https://www.revenuecat.com/docs/tools/experiments-v1)) [P]. No published effect for these changes in recipe apps.
- **Effort and cost.** S. RevenueCat Experiments is on its Pro plan, free up to $2,500 a month of tracked revenue ([RevenueCat pricing](https://www.revenuecat.com/pricing/)) [P].
- **Expected effect and test.** Read trial starts per paywall view, the fastest signal. Two arms only. Kill rule: no arm ahead after 1,000 views per arm, keep the simpler one.
- **Legal risk.** Low. 010-FR-042c: no plan pre-selected. The per-person figure must say it assumes 6 members.
- **Spec.** 010 and 022-FR-037.

#### Idea 16. A founding-member offer to the waitlist at launch

- **What it is.** Waitlist members who subscribe yearly in the launch month get extra months of Pro as reward time. The end date is stated plainly, with no countdown.
- **Why it works.** No evidence: target plus test. The business plan sets a waitlist target (not published). They are the warmest audience the business will have.
- **Effort and cost.** S to M. Uses 023's reward ledger. Revenue forgone: the extra months.
- **Expected effect and test.** Plan target: 5% of verified waitlist entries pay in launch month. Read at day 30 after launch. Kill rule: under 2%, do not repeat the offer for later cohorts.
- **Legal risk.** Medium. A real end date is allowed. A timer or "today only" is not (010-FR-042d). Needs a ruling on extra free time against 010-FR-041h.
- **Spec.** 023 and 010. Owner ruling needed.

#### Idea 17. Gift subscriptions sold on the web

- **What it is.** Sell a 12-month Pro gift on the website through Stripe as a one-time payment at the ruled $99.99. It does not renew. The recipient gets reward time through RevenueCat. Promote it in November and December.
- **Why it works.** A direct competitor sells this: "A gift subscription is a full year of Plan to Eat for $49" ([Plan to Eat](https://www.plantoeat.com/pricing/)) [P]. Stripe Checkout supports one-time payments ("Accept one-time payments") ([Stripe](https://docs.stripe.com/api/checkout/sessions/create)) [P]. Effect on revenue: GAP.
- **Effort and cost.** M. Stripe fees only.
- **Expected effect and test.** Plan target: gifts equal to 5% of December new payers. Read in January. Kill rule: under 1%, drop the seasonal push and keep the page.
- **Legal risk.** Low. A one-time payment with no renewal is not a negative option. State that it does not renew. Gift-card laws may apply. Counsel confirms.
- **Spec.** New spec, or 010 plus 022.

#### Idea 18. A pantry "used in time" counter

- **What it is.** The pantry counts items used before their use-by date, and shows a monthly line: "You used 14 items before their date this month." No dollar claims until we can measure them.
- **Why it works.** The cost of waste is real. ReFED: "In 2024, the average American spent over $760 on food that went uneaten" ([ReFED](https://refed.org/food-waste/consumer-food-waste)) [S]. That figure is context only. Commise must not claim it saves a dollar amount without its own data. Effect on retention: no evidence, target plus test.
- **Effort and cost.** S to M, after the 007 pantry. $0 cash.
- **Expected effect and test.** Plan target: pantry users open the pantry at least weekly. Read at month 3. Kill rule: under 10% of pantry users see the recap, fold it into idea 11.
- **Legal risk.** Medium for any savings claim. Counted facts only.
- **Spec.** 007 (FR-034 to FR-040).

#### Idea 19. A written "your library is yours" guarantee

- **What it is.** On the pricing page and in the app, promise in writing:
    - export of everything at any time, in a file Commise can read back (already planned),
    - recipes kept on a lapse (010-FR-043a, already a rule),
    - a stated notice period and export window if Commise ever shuts down.
- **Why it works.** No evidence on conversion: target plus test. The business plan's thesis is that cooks switch for trust after apps close. Yummly closed on 20 Dec 2024 (`conversionStudy.md`) [S].
- **Effort and cost.** S. Copy and a policy page.
- **Expected effect and test.** Test it on the Paprika switcher page before launch, as the plan's waitlist test already runs. Kill rule: no gain in sign-ups per visit after 500 visits, keep it only in the FAQ.
- **Legal risk.** The promise binds. Breaking it later would be a deceptive claim. Counsel reviews the wording.
- **Spec.** 022 and 016.

#### Idea 20. A cooking log with a weekly "cooked at home" streak and built-in freezes

- **What it is.** Cooking mode ends with "Mark as cooked". The cook sees weeks in a row with at least one home-cooked meal. Two freezes are built in. There is no streak-loss alert and no guilt copy.
- **Why it works.** Duolingo: streak animations "increased the likelihood a brand new learner was still using Duolingo 7 days later by +1.7%", and two freezes "increased the relative number of active learners on Duolingo every day by +0.38%" ([Duolingo](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)) [P]. A weekly rhythm fits cooking better than a daily one [Inference].
- **Effort and cost.** M. $0 cash.
- **Expected effect and test.** Plan target: day-30 activity above the Food and Drink 7.9% baseline ([OneSignal](https://onesignal.com/mobile-app-benchmarks-2024)) [S]. Read at day 45. Kill rule: no gap between log users and others, keep the log and drop the streak.
- **Legal risk.** Medium. Loss-framed streak pressure can "materially distort" choices under DSA Article 25(1) [S]. Keep it positive and never tie it to the paywall.
- **Spec.** 008 (new FR).

#### Idea 21. Social proof on the paywall, from real data only

- **What it is.** Show the store rating once it is solid, and short quotes from real cooks who agreed to be quoted.
- **Why it works.** No evidence opened: target plus test.
- **Effort and cost.** S. $0 cash.
- **Expected effect and test.** Two arms with idea 15. Kill rule: same as idea 15.
- **Legal risk.** High if faked. The FTC bans reviews "by someone who does not exist, such as AI-generated fake reviews" [P]. Consent and real names or initials only.
- **Spec.** 010 and 022.

#### Idea 22. A web onboarding funnel that starts on commise.app

- **What it is.** Creator and social traffic lands on a short web flow: three questions, sign up, Stripe checkout for US buyers, then download. Web checkout is already ruled.
- **Why it works.** Revenue per install rises because Stripe's fee is far below the 15% store fee. RevenueCat: "Web revenue accounts for 3.2% globally, but 4.9% in North America", and "41% of top-performing apps (Tier 5) generate web revenue vs. just 1.3% of hobby apps" ([RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps/)) [P, correlation].
- **Effort and cost.** L. Stripe and RevenueCat fees.
- **Expected effect and test.** Plan target: web payers reach 10% of new payers by month 6. Read monthly. Kill rule: under 3% by month 6, keep only the plain pricing page.
- **Legal risk.** Medium. It must start on the web, not inside the iPhone app (010-FR-042i). The same ROSCA disclosures apply.
- **Spec.** 022 and 010.

#### Idea 23. Pause as an equal choice on the subscription page

- **What it is.** Show "Pause" next to "Cancel" with equal weight, never in front of it. Google Play has a native pause. Stripe can pause billing. Apple has none.
- **Why it works.** Google: "users can choose to pause their subscription for a period of time between one week and three months" ([Android](https://developer.android.com/google/play/billing/lifecycle/subscriptions)) [P]. Google's help page says "annual subscriptions and free trials cannot be paused" ([Google](https://support.google.com/googleplay/android-developer/answer/12154973)) [P], which conflicts with the developer page. No effect data.
- **Effort and cost.** S on Play, M for web. No iPhone equivalent, so it breaks parity.
- **Expected effect and test.** Plan target: 10% of Android monthly cancels choose pause instead. Read after 50 Android cancels. Kill rule: under 3%, remove it.
- **Legal risk.** Medium. It must not stand between the cook and Cancel (010-FR-042e).
- **Spec.** 010. Ruling needed on parity (CODING_STANDARDS section 14).

#### Idea 24. Three onboarding questions that pick the first action

- **What it is.** Ask three questions: who you cook for, your main goal (plan, save money, eat better), and where your recipes live now. The answers route the cook to the right first action, such as an import, a plan or a list.
- **Why it works.** No evidence for recipe apps. OneSignal reports "24% higher install-to-purchase conversion rates" from onboarding messages, without saying against what ([OneSignal](https://onesignal.com/mobile-app-benchmarks-2024)) [S, weak].
- **Effort and cost.** M. $0 cash.
- **Expected effect and test.** Plan target: day-7 activation of 35% (the plan's target). Read at day 30. Kill rule: questions skipped by more than half, cut to one.
- **Legal risk.** Low. Answers are personal data, so the privacy notice must name them.
- **Spec.** New onboarding spec (none exists today).

#### Idea 25. Seasonal planners

- **What it is.** Ready-made plan templates for real dates: Thanksgiving, holiday baking, back-to-school lunches, a January reset.
- **Why it works.** No evidence opened: target plus test.
- **Effort and cost.** S per season, mostly content. Templates exist in 006.
- **Expected effect and test.** Plan target: 10% of active cooks apply a seasonal template in its season. Read 2 weeks after the date. Kill rule: under 3%, stop making them.
- **Legal risk.** Low. Dates are real, so no fake urgency.
- **Spec.** 006 (templates).

#### Idea 26. A client pack and a referral fee for dietitians and trainers

- **What it is.** A dietitian or trainer buys a pack of Pro codes for clients, or earns a fee on clients who subscribe with their code. This goes past the plan's 10-trainer test.
- **Why it works.** Trainer meal-plan tools cost $240 to $720 a year (`priceEvaluation.md`) [P, D]. Apple offer codes allow "a maximum of 1 million redemptions per app, per quarter" and can go to "new, active, and expired" subscribers ([Apple](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes)) [P]. Effect: GAP.
- **Effort and cost.** M to L. The fee is cash, which 023-FR-035 forbids for consumer referrals. A professional fee needs its own ruling.
- **Expected effect and test.** Plan target: 3 paying clients per professional in 60 days, the plan's trainer rule. Kill rule: the same as the plan's.
- **Legal risk.** Medium. Paid endorsements need disclosure.
- **Spec.** 009 (trainer plans) and 023. Owner ruling needed.

#### Idea 27. A lifetime "Library" plan with no platform AI

- **What it is.** A one-time price for unlimited private recipes and the non-AI Pro features, with no platform AI uses. It is aimed at cooks who refuse subscriptions, such as Paprika users.
- **Why it works.** RevenueCat: "One in four apps offer a lifetime plan" ([RevenueCat SOSA 2026](https://www.revenuecat.com/state-of-subscription-apps/)) [P]. Pestle sells lifetime at $39.99 to $49.99 (`conversionStudy.md`) [S].
- **Effort and cost.** M. The risk is that it eats yearly plans and carries server cost forever.
- **Expected effect and test.** Needs a price ruling first. Then read the share of lifetime among first 200 payers. Kill rule: if yearly share falls below 53%, remove it.
- **Legal risk.** Low. "Lifetime" must be defined, for example the life of the service.
- **Spec.** 010. Price ruling needed.

#### Idea 28. Apple's Retention Messaging in the App Store cancel sheet

- **What it is.** A message shown when an iPhone cook cancels in App Store settings, for example a reminder of what Pro includes.
- **Why it works, and why it ranks low.** RevenueCat measured "22 million recorded messages across 309 apps". The median save rate was 17%, but "Early data shows no clear effect on cancellation rates", and cooks "accepted only about 1.1% of promotional offers" ([RevenueCat](https://www.revenuecat.com/blog/growth/apple-retention-messaging-benchmarks)) [P].
- **Effort and cost.** S. Access is by request to Apple.
- **Expected effect and test.** Not recommended now. Revisit if Apple's own data shows an effect.
- **Legal risk.** Needs a ruling. It appears inside Apple's cancel flow, which may conflict with 010-FR-042e.
- **Spec.** 010.

#### Idea 29. An introductory price instead of the trial, for some channels

- **What it is.** A discounted first year, sold as Apple's introductory offer, for channels where a trial converts badly.
- **Why it ranks low.** Apple: "each person is only eligible to redeem one introductory offer per subscription group" ([Apple](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions)) [P]. The free trial already uses that slot, so this replaces the trial. It also shows a price that is not ruled.
- **Effort and cost.** S to build. High in rulings.
- **Expected effect and test.** Not recommended unless trial starts fall below 4.4% of downloads, `priceEvaluation.md`'s flip signal.
- **Legal risk.** Low on format. The renewal price must be shown.
- **Spec.** 010. Price ruling needed.

#### Idea 30. Student or educator pricing

- **What it is.** A lower yearly price for verified students or cooking teachers (spec 013).
- **Why it ranks low.** No evidence opened. Neither store verifies students, so a paid verification service would be needed. It needs a price ruling.
- **Effort and cost.** M plus a verification fee (GAP).
- **Expected effect and test.** Not recommended at v1.
- **Legal risk.** Low.
- **Spec.** 010 and 013. Price ruling needed.

#### Idea 31. Home-screen widgets for the grocery list and tonight's meal

- **What it is.** iOS and Android widgets that show the shopping list and today's planned meal.
- **Why it ranks low.** No evidence opened. Web has no widget, so it strains the cross-platform rule.
- **Effort and cost.** M to L.
- **Expected effect and test.** Plan target: widget users keep day-30 activity above non-users. Read at day 45 after launch.
- **Legal risk.** Low.
- **Spec.** 006 and 007. Parity ruling needed.

#### Idea 32. Regional pricing

- **What it is.** Prices set per country by buying power.
- **Why it ranks last.** v1 serves the US only (016-FR-048). Revisit when a market opens.
- **Effort and cost.** S in the stores.
- **Expected effect and test.** None at v1.
- **Legal risk.** Each market's consumer law applies (016-FR-048b).
- **Spec.** 010 and 016. Price ruling needed.

### 6. The top 12, ranked by expected revenue per install per founder-hour

The order is a judgment, built from the funnel stage, the reach and the hours in section 4. No uplifts are combined.

| Rank | Idea                                                   | Stage it touches                   | Reach               | Effort | Why it ranks here                                                                                                           |
| ---- | ------------------------------------------------------ | ---------------------------------- | ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 1    | 4. Recover failed payments                             | All payers and every renewal       | Every payer         | S      | Billing failures are 31% of Play cancels and 14% of App Store cancels [P]. Settings, not features. Also fixes a spec defect |
| 2    | 1. Email and push channel, trial notice first          | Trials, then every later reminder  | Every trial         | M      | Required for 010-FR-041h. Every reminder idea depends on it                                                                 |
| 3    | 2. Trial timeline on the paywall                       | Sign-up to trial, the biggest drop | Every paywall view  | S      | +23% trial sign-ups and 55% fewer complaints in one published case [S]                                                      |
| 4    | 3. Push permission framed as the trial reminder        | Trials                             | Every trial         | S      | Opt-in up 118% in one published case [S]. Unlocks ideas 10, 11 and 18                                                       |
| 5    | 5. Monthly to yearly switch                            | Monthly payers                     | Monthly payers      | S      | Yearly keeps 28% at 12 months, monthly 8% [P]                                                                               |
| 6    | 6. Second-chance offer at value moments                | Sign-ups who declined at first     | Most sign-ups       | S to M | 23% of freemium conversions come after week 6 [P]                                                                           |
| 7    | 7. Rating prompt at a success moment                   | Store page, before install         | Every store visitor | S      | Ratings show "in search results" [P]. Overlaps acquisition                                                                  |
| 8    | 9. Household invite in the trial, free household lists | Trials                             | Every trial         | S to M | Built already. Needs one ruling (017-FR-034k)                                                                               |
| 9    | 12. Door-open screen after cancel                      | Every cancel                       | Every cancel        | S      | Legal-safe, and the only source of churn reasons                                                                            |
| 10   | 10. Weekly plan ritual                                 | Active payers in months 1 to 6     | Planners            | M      | Targets monthly survival (gate G9). Evidence is a correlation [P]                                                           |
| 11   | 13. Win-back offers                                    | Lapsed payers                      | Small at first      | S to M | Store-native. Needs a "not a trial" ruling                                                                                  |
| 12   | 11. Yearly renewal recap                               | Yearly payers at month 12          | Every yearly payer  | M      | Aims at the second-biggest drop. No evidence: target plus test                                                              |

Ideas 8, 14 and 15 come next. They are cheap but depend on volume to read.

**What to do this month.** Ideas 4, 2 and 3 are small and touch the two largest stages. Idea 1 is the dependency for 2, 3, 10, 11 and 18, so its spec amendment should start now.

### 7. Considered and refused

These were weighed and left out.

| Idea                                                     | Why it is out                                                                                                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A save offer before the Cancel button                    | Forbidden by 010-FR-042e and DSA Article 25(3)(c)                                                                                                                                                                           |
| A countdown on a launch or seasonal offer                | Forbidden by 010-FR-042d and 022-FR-036                                                                                                                                                                                     |
| AI uses as rewards, or a lifetime plan with platform AI  | Forbidden by 023-FR-024 and the $100 ceiling [R]                                                                                                                                                                            |
| Guest mode before sign-up                                | Reverses 001-FR-045a [R]                                                                                                                                                                                                    |
| Weekly plans                                             | Adapty says "Weekly plans convert 1.7 to 7.4x better than annual", but weekly trial plans keep 5.5% at day 380 ([Adapty](https://adapty.io/state-of-in-app-subscriptions/)) [S]. Not a ruled price, and it would hurt trust |
| A rating prompt behind a "Do you like Commise?" question | Google forbids asking questions before the dialog [P]                                                                                                                                                                       |

### 8. Legal status checked, and what was not confirmed

- **ROSCA.** Three duties: disclose all material terms before taking billing details, get express informed consent, and provide simple mechanisms to stop charges ([Cornell LII](https://www.law.cornell.edu/uscode/text/15/8403)) [S, host of official text].
- **FTC negative option rule.** The FTC's own pages confirm the 2024 rule was vacated. On 11 March 2026 the FTC asked for comment on an advance notice that lists options including "adopting provisions of the vacated 2024 Rule" ([FTC](https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-seeks-public-comment-response-advance-notice-proposed-rulemaking-regarding-negative-option)) [P]. The court and date of the vacatur were not confirmed on an opened page.
- **FTC fake reviews rule.** In force since August 2024 [P]. It bans fake reviews and incentives tied to sentiment.
- **EU DSA Article 25.** Bans interfaces that deceive or manipulate. It names more prominence for one choice, repeated requests, and harder cancel than subscribe [S]. v1 is US only, but 010 adopts it as a house rule.
- **California automatic renewal law.** The Attorney General's page says "California law requires companies to clearly explain and get your approval before signing you up for something that automatically renews" ([California OAG](https://oag.ca.gov/consumers/general/free-trial-offers)) [P]. The details of the 2024 amendments (AB 2863) were not confirmed: the official site refused the fetch. Counsel confirms them under 016-FR-050.
- **New state rules.** A law firm lists "NYC and Louisiana Enact New Regulatory Requirements" for auto-renewals in July 2026 ([Kelley Drye](https://www.kelleydrye.com/viewpoints/blogs/ad-law-access/automatic-renewals)) [S, title only]. Counsel should add them to 016-FR-050.

### 9. Gaps

- Whether Apple and Google send their own notice before a trial converts. Verify before relying on it.
- A Food and Drink benchmark for reactivation, push-driven retention or trial checklists.
- The cost of an email and push transport (pricing pages not opened).
- The text of California's AB 2863 and the FTC vacatur decision.
- Any recipe-app evidence for streaks, recaps or onboarding questions.

The fastest way to close most gaps is Commise's own first three cohorts, read on the leading signals named above.

### Next steps

| Action                                                                                   | Owner                              | When                    |
| ---------------------------------------------------------------------------------------- | ---------------------------------- | ----------------------- |
| Rule on 017-FR-034k (free household lists) and on "a free win-back month is not a trial" | Owner                              | By 26 Nov 2026          |
| Draft the 014 amendment for email and push, with the trial notice as its first message   | Founder with `staff-architect`     | Before billing is built |
| Amend 010-FR-043 to state the grace period per rail                                      | Founder                            | With the 010 plan       |
| Design the trial timeline, the push ask and the after-cancel screen                      | `staff-ux-engineer` (SPECIFY)      | Before billing is built |
| Price the reward time in ideas 13 and 16                                                 | `cfo-1`                            | Before launch           |
| Confirm California, NYC and Louisiana renewal rules                                      | Counsel via 016-FR-050, with `clo` | Before launch           |

Confidence: Medium on the platform facts (vendor docs opened). Low on effect sizes, which come from single-company cases outside recipes. Commise's first three cohorts would raise it.

### Sources

Pages opened for this brainstorm:

- [Apple: set up win-back offers](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-win-back-offers)
- [Apple: introductory offers](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-introductory-offers-for-auto-renewable-subscriptions)
- [Apple: billing grace period](https://developer.apple.com/help/app-store-connect/manage-subscriptions/enable-billing-grace-period-for-auto-renewable-subscriptions)
- [Apple: subscription offer codes](https://developer.apple.com/help/app-store-connect/manage-subscriptions/set-up-subscription-offer-codes)
- [Apple: ratings and reviews](https://developer.apple.com/app-store/ratings-and-reviews/)
- [Android: in-app review](https://developer.android.com/guide/playcore/in-app-review)
- [Android: subscription lifecycle](https://developer.android.com/google/play/billing/lifecycle/subscriptions)
- [Google Play Console help: subscriptions and offers](https://support.google.com/googleplay/android-developer/answer/12154973)
- [Google Play Console help: reply to reviews](https://support.google.com/googleplay/android-developer/answer/138230)
- [Stripe: Smart Retries](https://docs.stripe.com/billing/revenue-recovery/smart-retries)
- [Stripe: revenue recovery](https://docs.stripe.com/billing/revenue-recovery)
- [Stripe: trial compliance](https://docs.stripe.com/billing/subscriptions/trials/manage-trial-compliance)
- [Stripe: Checkout sessions](https://docs.stripe.com/api/checkout/sessions/create)
- [RevenueCat: State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps/)
- [RevenueCat: Apple Retention Messaging benchmarks](https://www.revenuecat.com/blog/growth/apple-retention-messaging-benchmarks)
- [RevenueCat: reactivation calculator](https://www.revenuecat.com/reactivation-calculator)
- [RevenueCat: iOS subscription offers](https://www.revenuecat.com/docs/subscription-guidance/subscription-offers/ios-subscription-offers)
- [RevenueCat: Experiments](https://www.revenuecat.com/docs/tools/experiments-v1)
- [Adapty: State of In-App Subscriptions 2026](https://adapty.io/state-of-in-app-subscriptions/)
- [Growth.Design: Blinkist trial paywall case](https://growth.design/case-studies/trial-paywall-challenge)
- [Duolingo: how the streak builds habit](https://blog.duolingo.com/how-duolingo-streak-builds-habit/)
- [Phiture: Headspace retention](https://phiture.com/success-stories/headspace-retention/)
- [Phiture: Headspace in-app messages](https://phiture.com/success-stories/headspace-inapps/)
- [OneSignal: Mobile App Benchmarks 2024](https://onesignal.com/mobile-app-benchmarks-2024)
- [ReFED: consumer food waste](https://refed.org/food-waste/consumer-food-waste)
- [Plan to Eat: pricing and gifts](https://www.plantoeat.com/pricing/)
- [Spotify: 2025 Wrapped](https://newsroom.spotify.com/2025-wrapped/)
- [Cornell LII: 15 U.S.C. 8403](https://www.law.cornell.edu/uscode/text/15/8403)
- [FTC: negative option advance notice, March 2026](https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-seeks-public-comment-response-advance-notice-proposed-rulemaking-regarding-negative-option)
- [FTC: final rule banning fake reviews](https://www.ftc.gov/news-events/news/press-releases/2024/08/federal-trade-commission-announces-final-rule-banning-fake-reviews-testimonials)
- [DSA Article 25, secondary text](https://www.eu-digital-services-act.com/Digital_Services_Act_Article_25.html)
- [California OAG: free trial offers](https://oag.ca.gov/consumers/general/free-trial-offers)
- [Kelley Drye: automatic renewals blog](https://www.kelleydrye.com/viewpoints/blogs/ad-law-access/automatic-renewals)

Repo and plan inputs: the owner's rulings and the business plan (not published), `priceEvaluation.md`, `conversionStudy.md`, and specs 006, 007, 008, 010, 014, 016, 017, 022 and 023.
