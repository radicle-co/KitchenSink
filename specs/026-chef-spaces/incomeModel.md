# Chef Spaces: value proposition and income model

This file is the reasoning behind [`spec.md`](./spec.md). Every figure comes from
[`research/creatorIncome.md`](./research/creatorIncome.md), read on 2026-10-29, unless it says otherwise. Each figure
carries its source type: [P] is the company's own page, [S] is a secondary source. [D] is arithmetic on sourced
figures. It is not a forecast. GAP means no public number exists. Each GAP has a target and a test.

## 1. What a food blogger has today, and what they fear

- **Ads pay most of the bills.** In one survey of 803 blogs, ads were 42% of income and affiliate links 10% [S, RankIQ,
  biased toward high earners]. A small 2025 survey of 187 bloggers puts food and recipe ad RPM at $36.81 per 1,000
  pageviews [S, self-reported].
- **The ad networks take a modest cut and the bar to join is low.** Raptive pays creators 75% and needs 25,000
  monthly pageviews, down from 100,000 in October 2025 [P, raptive.com/fbp]. Journey by Mediavine needs 1,000
  sessions in 30 days [P]. So most bloggers we want already have an ad partner.
- **Search traffic is at risk, but how much is not measured.** Creators interviewed by Fortune report drops of 30% to
  80% [S, anecdotal]. Raptive's own data says nearly 60% of sites hit by the 2023 update recovered by June 2025 [P,
  not independent]. The honest pitch is "depend less on Google", not "Google is dead".
- **Lock-in is a real fear.** Yummly closed around 2024-12-20 with no bulk export reported [S]. Substack and Beehiiv
  market a free list export.
- **They already work in a recipe plugin.** WP Recipe Maker has 50,000+ active installs [P, wordpress.org].
- **Readers dislike the page ads force on them.** That is need 1 in our user-needs research (FR-001, CK-005). A
  quantified reader survey on ads and stories is GAP.

## 2. The value proposition

**For a blogger, phase 1: "Keep your blog. Add a place where readers cook your recipes, and send them back to you."**

| What the blogger gets                                                            | Why it matters to them                                                                                      | Where it is specified  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------- |
| Their recipes on Commise as their own work, with no retyping                     | WP Recipe Maker cards and sitemaps already hold the data                                                    | 026-FR-001 to FR-005   |
| Search engines still credit the blog (canonical to the blog)                     | Their ad income lives on the blog. We do not take that traffic                                              | 026-FR-006             |
| A "Read on [blog]" link and a "Cook this in Commise" card for the blog           | Traffic goes both ways                                                                                      | 026-FR-006, FR-013     |
| A recipe page with nothing in the way                                            | The page a reader wants and a blog cannot afford to give                                                    | 026-FR-011, FR-012     |
| A listing in the chef directory and public collection pages, readable signed out | Readers find the chef without an account. Paid items show only title, cover, price and description (021 Q2) | 026-FR-010, FR-015     |
| Email sign-ups to their own list provider, exportable any time                   | The list is the asset they own                                                                              | 026 section C          |
| Numbers a blog cannot see: cooks, saves, plan adds and list adds                 | It shows which recipes people actually make, not only which they open                                       | 026-FR-030             |
| A full export and the right to leave                                             | The answer to the Yummly fear                                                                               | 026-FR-009, 017 export |
| A nutrition panel from USDA data, as an estimate                                 | Bloggers pay for this today. Nutrifox price is GAP (acquisition idea B3)                                    | 009, idea B3           |

**Phase 2: "Earn on Commise without ads."** Digital cookbooks, a chef club, tips, courses, affiliate links and a
sponsor line. A share of Pro revenue for the recipes Pro members cook is deferred to the royalties and chef-payments
work (owner ruling Q4, 2026-10-29).

**Phase 3: "Move home when it pays."** The chef switches the canonical address to Commise and gets a redirect list.
Whether Commise sends email for chefs is decided after phase 2 (owner ruling Q3, 2026-10-29).

The bet is the order. Phase 1 costs the blogger nothing and risks nothing they earn today. Phase 2 has to beat their
blog's RPM for the same readers before phase 3 makes sense. SC-004 tests exactly that.

## 3. The income lines

| Line                         | Benchmark from the research                                                                                                         | Proposed for Commise                                                               | Status                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| **Pro pool** (pay for cooks) | YouTube gives creators 55% of watch-page ad revenue and 45% of the Shorts pool [P]. Medium pays by member reading time, formula GAP | A stated share of Pro revenue, split by Pro members' cooks, per member first (Q4)  | Deferred to the royalties work (Q4)         |
| **Digital cookbook**         | KDP ebook royalty 70% (after VAT and delivery) or 35% [P]. Gumroad keeps 10% + $0.50 [P]. Print royalty 10% to 15% [S]              | 018's sellable collection, purchased as the sold version with a PDF or EPUB to keep (amended 2026-11-03, ADR-0082 §9, 026-FR-043, FR-044) | Phase 2. The cut is set with royalties (Q6) |
| **Single recipe**            | No benchmark found                                                                                                                  | Allowed by 018-FR-029. The weaker unit                                             | Phase 2                                     |
| **Chef club** (monthly)      | Substack keeps 10% [P, via search summary], Patreon 10%, Beehiiv and Ghost 0% before card fees [P]                                  | New recipes arrive as copies each month, plus member courses (Q5)                  | Phase 2 (owner ruling Q5)                   |
| **Courses**                  | Teachable 0% to 7.5% plus plan fee, Kajabi 0% plus plan fee and 2.7% to 2.9% processing [P]                                         | 013. Its 20%/80% split is open as C-018-004                                        | Phase 2                                     |
| **Tips**                     | YouTube fan funding: creators keep 70% [P]                                                                                          | 012-FR-031                                                                         | Phase 2                                     |
| **Affiliate links**          | Amazon pays Kitchen 4.5%, Home 3%, Grocery 1% [P]                                                                                   | The chef's own links, marked as affiliate (026-FR-047). Commise takes nothing      | Phase 2. Needs only the disclosure rule     |
| **Sponsor line**             | Food creators charge about $180 a sponsored social post, nano creators $100 to $500 a blog post [S, vendor]                         | One labelled line per recipe, no tracking (Q7)                                     | Phase 2 (owner ruling Q7)                   |
| **Display ads**              | RPM $36.81 [S]. Networks pay 70% to 75% [P, S]                                                                                      | Refused by 018 (Q8)                                                                | Refused (owner ruling Q8)                   |

Two notes on the table:

- **Commise sets this market.** No recipe app publishes creator pay terms except Chefadora, whose share is GAP [P].
  So we cannot copy a rate. We can only state ours clearly.
- **Affiliate links cost us nothing and pay the chef today.** It is the fastest phase 2 line, because it needs no
  money to pass through Commise.

## 4. The fee stack

Selling inside the mobile app costs more than selling on the web. Apple takes 15% under $1M of proceeds a year and 30%
above [P]. In the US, UK, EEA, Australia and Japan, Google takes 10% plus a 5% billing fee on subscriptions [P].
It takes 20% plus 5% on other new transactions [P]. Patreon says creators must raise iOS prices about 43% to cover Apple's 30% [P,
via search summary].

The worked example below is [D], arithmetic on those rates for a $20 digital cookbook. It ignores tax, card fees on
the web, and Apple's US link-out terms, which are still unset (ADR-0075).

| Where it is bought             | Store fee   | Commission at 10% of the price | Commission at 20% of the price | Chef keeps at 10% | Chef keeps at 20% |
| ------------------------------ | ----------- | ------------------------------ | ------------------------------ | ----------------- | ----------------- |
| Web (card fee not counted)     | $0          | $2.00                          | $4.00                          | $18.00            | $16.00            |
| iPhone, Small Business Program | $3.00 (15%) | $2.00                          | $4.00                          | $15.00            | $13.00            |
| Android, other transaction     | $5.00 (25%) | $2.00                          | $4.00                          | $13.00            | $11.00            |

The benchmarks for a creator platform's own cut are 0% to 10% [P]. At 20% on top of a store fee, the chef keeps 55% to
65% of the price. That is why Q6 asks for the rate against the stack, as `018-FR-082` already requires.

## 5. How big the Pro pool can be

This is [D], arithmetic on the plan price, not a forecast of members. Pro is $99.99 a year (010). It treats every
member as paying through Apple. Web and Android members differ. Under the Small Business Program's 15%, one member
brings about $84.99 a year, or about $7.08 a month. That program applies only under $1M of proceeds a year [P].
10,000 members bring about $850,000, so 15% holds. 100,000 members bring about $8.5M, so the row uses Apple's
standard 30% ($69.99 a year, about $5.83 a month). Apple charges 15% on a subscription after its first year, so the
true figure for that row sits between the two rates.

| Pro members | Net Pro revenue a month [D] | Pool at 5% [D] | Pool at 10% [D] | Pool at 20% [D] |
| ----------- | --------------------------- | -------------- | --------------- | --------------- |
| 1,000       | $7,083                      | $354           | $708            | $1,417          |
| 10,000      | $70,825                     | $3,541         | $7,083          | $14,165         |
| 100,000     | $583,250                    | $29,163        | $58,325         | $116,650        |

To compare with blog ads: at an RPM of $36.81 [S], $708 a month is the ad income of about 19,200 pageviews a month [D].
That is a small blog's traffic. The pool only competes with ads once Pro is large, so phase 1 has to win chefs on
reach and tools, not money.

What makes a pool fair to the long tail: 018 records that creator revenue follows a steep power law (`018-FR-058a-i`).
A per-member split ("user-centric") pays each chef only from the members who cooked their recipes. A pooled split pays
by share of all cooks, which favors the biggest chefs. Our recommendation is per member.

## 6. Owner questions, with trade-offs

The owner answered all nine on 2026-10-29. Each question keeps its trade-offs and the recommendation made before the
answer, followed by the ruling.

**Q1. The copy check finds a chef's recipe on their own claimed page. Does a person still look (A), or does the claim
clear that one hit (B)?**

A blogger's "I wrote this" import is already their own recipe (ADR-0077 §2). The outside-copy check then finds the
blog post, and `020-FR-012g` sends that hit to a person. The site claim in section A is the proof that 020 and 016 say
012 owes.

- A changes nothing in 020. A person sees the hit with the claim beside it. It costs one staff review for every recipe a
  blogger brings in, so 400 blog recipes are 400 reviews, and the chef waits for each.
- B clears only the hit on the recipe's own origin page, under a live claim. Every other part of the check still runs.
  A hit on any other page, a model item or a photo signal still goes to a person. The claim proves control of the
  site, not authorship, so a guest post or a copied recipe on the chef's own blog can pass. The per-recipe statement,
  the rights label and takedown are the controls for that case, as for any "I wrote this" recipe.
- **Recommendation: B.** A blogger will not wait weeks for staff to approve their own posts. Counsel reviews B
  before build, since it lets a claimed site lower our checking for one kind of hit.
- **Owner ruling, 2026-10-29:** "Claim clears own-site hit". Option B, with counsel review before build.

**Q2. Does Home start as the blog or as Commise?**

- Blog first keeps the chef's search traffic and ad income safe. It is the "layer" promise.
- Commise first grows our search presence faster, but it competes with the chef in search for their own recipes.
- **Recommendation: the blog.** A chef who fears losing search traffic will not join.
- **Owner ruling, 2026-10-29:** "Their blog".

**Q3. Does Commise send email for chefs, or connect only to their provider?**

- Connecting (Kit, Mailchimp, Beehiiv) is cheaper and leaves delivery, bounces and CAN-SPAM's sender duties with the
  provider. Kit is free up to 10,000 subscribers and Beehiiv up to 2,500 [P].
- Sending makes the list live inside Commise, which helps phase 3, but every chef's complaints land on our sending
  reputation. CAN-SPAM makes the advertiser and the sender both liable, at up to $53,088 per email [P, FTC].
- **Recommendation: connect only in phases 1 and 2. Decide sending after phase 2 shows chefs staying.**
- **Owner ruling, 2026-10-29:** "Connect only, for now". Decide on sending after phase 2.

**Q4. What share of Pro revenue goes to the pool, and from when?**

- The table in section 5 shows the sizes. The share is a cost against the plan's margin, which `cfo-1` has to price.
- A small share from launch is a strong story ("Commise pays the cooks whose recipes you cook"). Waiting until Pro is
  large means the first chefs see nothing.
- **Which recipes earn.** The draft rule paid only "Written by you". An "Adapted by you" recipe credits someone else's
  recipe, so paying for it rewards light edits to other people's work, which is 018's hazard H3. Paying it too can
  bring in more chefs who adapt classics. The recommendation is "Written by you" only, and the owner can widen it.
- **Recommendation: announce a fixed share and publish the rule. Once 018's ledger ships, start paying it. `cfo-1`
  sets the number.** The share itself is GAP until then. Test: offer it to the SC-001 cohort and record how many name it as a
  reason to join.
- **Owner ruling, 2026-10-29: DEFERRED.** "Let's mark this as something to resolve when we tackle the royalties and
  paying chefs work - it's going to require a lot of thought". There is no share and no rule for which recipes earn
  yet. This section is input to that work.

**Q5. A chef club: yes or no?**

- Members get each new recipe as a private copy and member courses. It is the Substack and Patreon shape, which
  creators know.
- 012 retired paid follows. A club is not a paid follow, because it delivers copies and creates no paywalled recipe,
  but it sits close. A recipe in the club cannot also be public (`018-FR-029c`).
- _(Note 2026-11-03, owner ruling, ADR-0082 §9.)_ The copies above are replaced. A member reads the club's current
  recipes while the membership runs and keeps nothing after leaving (`026-FR-045`). Whether the club is 018's creator
  subscription is OPEN (`018` FQ-018-4).
- **Recommendation: yes, in phase 3, after cookbooks prove that people pay a chef here.**
- **Owner ruling, 2026-10-29:** "Yes, earlier". The club is in phase 2, beside digital cookbooks.

**Q6. The commission, against the store stack?**

- Section 4 shows that 20% on top of a store fee leaves the chef 55% to 65%. Creator platforms take 0% to 10% [P].
- **Recommendation: 10% on every product, and nothing on affiliate links.** It matches Substack [P, via search summary], Patreon and
  Gumroad. `cfo-1` checks the margin.
- **Owner ruling, 2026-10-29: DEFERRED.** "Decide with royalties". The commission is set in the royalties and
  chef-payments work. 013's 20% stays a draft.

**Q7. Can a chef sell a labelled sponsor line?**

- For: it is chef-sold, needs no ad network, no third-party script and no tracking, and food creators already sell
  sponsorships [S].
- Against: it is still an ad on the recipe page, and need 1 is about the page around the recipe.
- **Recommendation: yes, as one text-and-logo line under the method, labelled, never above the ingredients.**
- **Owner ruling, 2026-10-29:** "Yes, as described".

**Q8. Do display ads stay refused?**

- For reopening: ads are the largest income line for bloggers today, and networks pay 70% to 75% at an RPM near $37
  [S, P]. A chef asking "where are my ads?" has a real point.
- Against: ads over the recipe are part of need 1, the widest complaint in our research. 018's research found that
  display ads pay least at our scale and carry the largest consent cost (`018` H.3). The recipe-first page is the one
  thing a blog cannot copy.
- **Recommendation: keep them refused. The chef keeps their own ads on their own blog, and Home = blog sends readers
  there.**
- **Owner ruling, 2026-10-29:** "Keep refused". No display ads, chef corners included.

**Q9. Which corner features need chef standing?**

- **Recommendation: phase 1 features for any creator, money features for chefs only.** Phase 1 is how we find the
  chefs, so it cannot wait on admission.
- **Owner ruling, 2026-10-29:** "Money features only". Phase 1 is open to any creator.

## 7. Targets and tests

| Measure                                       | Evidence | Target                               | Test                                                 |
| --------------------------------------------- | -------- | ------------------------------------ | ---------------------------------------------------- |
| Bloggers who claim a site in the first beta   | GAP      | 20 in 60 days, each with 10+ recipes | Outreach to the creator list. Kill rule below 5      |
| Clicks back to the blog per 100 views         | GAP      | Reported to every chef               | 026-FR-030                                           |
| Chef revenue per 1,000 views against blog RPM | GAP      | Equal within 12 months of phase 2    | Chefs who opt in share RPM. Compare monthly (SC-004) |
| Share of chefs who name the pool as a reason  | GAP      | Recorded, no target                  | Ask the SC-001 cohort                                |
| Readers bothered by ads and stories           | GAP      | No target                            | Ask the owner of the Lebovitz survey for the results |
