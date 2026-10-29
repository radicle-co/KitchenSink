# CFO Analysis: AI and infra cost at 100,000 registered users

Prepared 2026-10-27. Rough model. Every guess is labelled. The script that produced every number is
kept privately and is not published.

## Executive summary

- **Free credits are cheap if one use is one model call.** At 100k users, Free credits of 3 / 5 / 10 uses a month
  cost about **$450 / $750 / $1,500 a month**. That is 0.7% / 1.1% / 2.3% of revenue at 5% conversion.
- **They get expensive if one use can be a whole weekly meal plan.** If one "use" writes seven full recipes, a use
  costs about 8x more ($0.12 instead of $0.015). Ten free credits could then cost about $25,000 a month in the stress
  case. What one use is (owner input O-4) matters more than the number of credits.
- **Pro with AI makes a lot of money per subscriber.** An average subscriber (25 uses) costs about $0.37 a month in
  AI. Gross margin is 80–90% in every channel except Apple at 30%.
- **The allowance that keeps 70% for a cook who uses every credit** depends on the cost per use:
    - **base shape:** about **130 uses** in the worst allowed channel (app store at 15%, annual plan), and 300 on web
      monthly.
    - **meal-plan-heavy shape:** about **17 uses** in the worst channel, and 38 on web.
- **Recommendation:**
    - **Pro with AI: 50 uses a month.** Count a full weekly auto-plan as one use per recipe it writes.
    - **Free: 3 uses a month,** for single-call features only (generate, optimize, suggest).
- **Apple at 30% breaks the 70% target on its own.** At 30% (first paid year, if we are not in the Small Business
  Program), neither paid plan reaches 70%, even with no AI at all. Enrol in the program, or use web checkout (O-9).
- **The $100/month AI ceiling in ADR-0024 will refuse paying cooks.** Base AI spend at 100k users is about
  **$2,900 a month**. The ceiling is one pool shared by every call site and every cook. It would be used up in about
  the first day of each month, and paying cooks would then be refused (O-8). Prod also has no Bedrock consumer
  deployed yet, so the ceiling has never run.
- **Infra is small.** About **$1,200 a month** in the base case ($700–$3,500), which is **$0.012 per registered user**
  and $0.04 per monthly active user.
- **Overall gross margin is 77% / 85% / 87% at 2% / 5% / 10% conversion,** after store and Stripe fees, AI and
  infra. People, support, marketing and legal are not included. We have no figures for those.

**Confidence: Medium on cost per call and infra prices.** Both come from AWS's own price list and our own bill.
**Low on usage.** Nothing is live, so every usage figure is a guess.

---

## Corrections to the brief

1. **Nova Micro is not the only model in use.** The shipped parse leg calls **Nova 2 Lite**
   (`packages/shared/recipe-core/src/spend/spendArithmetic.ts`, `NOVA_2_LITE_MODEL_ID`, "the model the SHIPPED parse
   leg calls"). September's bill confirms it: $185 of the $259 Bedrock spend was Nova 2 Lite and Nova Lite. Nova Micro
   was $0.87. Nova Micro is the verification gate's model. Nova Lite is the 020 content check's model.
2. **The pr-91 blend understates the parse cost.** $252.96 / 1,293,729 calls = **$0.000196 a call**. That blend is
   mostly Nova Lite and Nova Micro calls. CloudWatch shows the shipped Nova 2 Lite call averages 2,318 input and 34
   output tokens (267,032 calls, 619M input tokens, 9.1M output, Aug 25 – Sep 30). Priced at Nova 2 Lite rates, with
   25% of input as cache reads, that is **$0.000715 a call**, 3.6x the blend. **This model uses $0.000715.**
3. **RDS is db.t4g.small, not micro.** Both prod and sandbox instances are db.t4g.small, 100 GB. Prod is gp2, sandbox
   gp3 (`aws rds describe-db-instances`).

---

## 1. Assumptions

| #   | Assumption                                                                                                        | Value (low / base / high)                                               | Type                                       |
| --- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| A1  | Registered users                                                                                                  | 100,000                                                                 | Given                                      |
| A2  | Monthly active share                                                                                              | 20% / **30%** / 45%                                                     | Guess                                      |
| A3  | Paid conversion, of registered users                                                                              | 2% / **5%** / 10%                                                       | Given (SC-006 base)                        |
| A3a | SC-006 read literally ("5% of active free users") gives about 1,500 paid at 30% active                            | inside the 2% case                                                      | Sourced (spec 010)                         |
| A4  | Paid split, Pro : Pro with AI                                                                                     | **60 : 40**                                                             | Guess                                      |
| A5  | Annual share of subscribers                                                                                       | **40%**                                                                 | Guess                                      |
| A6  | Payment channel mix (company total only)                                                                          | **60% Stripe web / 40% app store at 15%**                               | Guess; O-9 is open                         |
| A7  | Model for cook-facing AI                                                                                          | Nova 2 Lite / **Claude Haiku 4.5** / Haiku 4.5 + big meal plans         | Guess (not chosen yet)                     |
| A8  | Tokens per use (in / out), base: generation 1,500/1,200; suggestion set 2,500/1,500; optimization 2,000/1,000     | see §2                                                                  | Guess                                      |
| A9  | Tokens per use, high: generation 3,000/2,500; weekly plan writes 7 recipes 5,000/12,000; optimization 4,000/2,000 | see §2                                                                  | Guess                                      |
| A10 | Mix of uses, base: 50% generation, 30% suggestions, 20% optimization (high: 40/40/20)                             |                                                                         | Guess                                      |
| A11 | Overhead for retries, validation and failed calls                                                                 | ×1.25                                                                   | Guess                                      |
| A12 | A saved AI recipe is parsed and matched like an import                                                            | base: 50% of generations; high: every generation and all 7 plan recipes | Guess                                      |
| A13 | Platform AI per imported recipe: 20 parse calls, 12 verifications, 1 text check, 1.5 photos                       | $0.0170 uncached                                                        | Measured shape + sourced prices            |
| A14 | Parse cache hit rate                                                                                              | 50% / **30%** / 0%                                                      | Guess                                      |
| A15 | Recipes imported per active user a month                                                                          | 1.5 / **3** / 6                                                         | Guess                                      |
| A16 | Bulk-import tail (recipes a month)                                                                                | 15k / **30k** / 90k                                                     | Guess (one cook at 1,000/day is 30k alone) |
| A17 | Free users who use AI in a month × share of their credits used                                                    | 8%×50% / **15%×70%** / 25%×90%                                          | Guess                                      |
| A18 | Average uses by a Pro with AI cook                                                                                | 10 / **25** / 60                                                        | Guess                                      |
| A19 | AI trials started a month (share of registered) × trial allowance                                                 | **2% × 10 uses**                                                        | Guess (trial allowance is O-2)             |
| A20 | Requests per active user, photos, logs (drives infra)                                                             | see §5                                                                  | Guess                                      |
| A21 | All prices are us-east-1 on-demand list prices, read 2026-10-27                                                   |                                                                         | Sourced (see Sources)                      |

---

## 2. Cost of one AI use

Prices per 1M tokens, from the AWS Price List API (us-east-1, `us.` geo profile, read 2026-10-27):

| Model            | Input  | Output | Note                                                        |
| ---------------- | ------ | ------ | ----------------------------------------------------------- |
| Nova Micro       | $0.035 | $0.14  | Matches our bill: $0.69 for 19.6M input tokens in September |
| Nova Lite        | $0.06  | $0.24  | Matches our bill                                            |
| Nova 2 Lite      | $0.33  | $2.75  | Global profile $0.30 / $2.50. Matches our bill              |
| Claude Haiku 4.5 | $1.10  | $5.50  | Global profile $1.00 / $5.00                                |

Cost of a single call, before overhead (A8 base / A9 high):

| Use                      | Nova Micro | Nova Lite | Nova 2 Lite | Haiku 4.5 | Haiku 4.5, high shape |
| ------------------------ | ---------- | --------- | ----------- | --------- | --------------------- |
| Recipe generation        | $0.0002    | $0.0004   | $0.0038     | $0.0083   | $0.0171               |
| Meal-plan suggestion set | $0.0003    | $0.0005   | $0.0050     | $0.0110   | $0.0715 (7 recipes)   |
| Optimization             | $0.0002    | $0.0004   | $0.0034     | $0.0077   | $0.0154               |

**Blended cost of one use** (mix A10, ×1.25 overhead, plus parse and match of saved AI recipes, A12):

| Model            | Base shape              | High shape             |
| ---------------- | ----------------------- | ---------------------- |
| Nova Micro       | $0.0040                 | $0.069                 |
| Nova Lite        | $0.0042                 | $0.070                 |
| Nova 2 Lite      | **$0.0088** (low case)  | $0.091                 |
| Claude Haiku 4.5 | **$0.0149** (base case) | **$0.116** (high case) |

In the high shape, parsing and matching the seven written recipes is a large part of the cost. That is why the
models end up close together there.

Platform AI per imported recipe (A13): 20 × $0.000715 parse + 12 × $0.000187 verification + $0.00025 text
check + 1.5 × $0.00014 photo = **$0.0170 uncached**, **$0.0119 base** (30% cache hits).

---

## 3. Uses per month (guess)

| Who                                 | Low      | Base      | High      | Note                                            |
| ----------------------------------- | -------- | --------- | --------- | ----------------------------------------------- |
| Free user, per registered free user | 0.04 × N | 0.105 × N | 0.225 × N | N = free credits. Most free users are inactive  |
| Free user who uses AI that month    | 0.5 × N  | 0.7 × N   | 0.9 × N   | Free users tend to use what they are given      |
| Pro with AI subscriber              | 10       | 25        | 60        | Average, not allowance. Heavy cooks hit the cap |
| Trial user (AI trial)               | 10       | 10        | 10        | Trial allowance is O-2                          |

---

## 4. AI cost per user per month, and total at 100k users (5% conversion)

| Line                                          | Low ($0.0088/use) | Base ($0.0149/use) | High ($0.116/use) |
| --------------------------------------------- | ----------------- | ------------------ | ----------------- |
| Pro with AI cook, 25 uses                     | $0.22             | **$0.37**          | $2.90             |
| Pro with AI cook, 60 uses                     | $0.53             | $0.90              | $6.97             |
| Pro cook (no AI uses; platform share only)    | $0.014            | $0.014             | $0.061            |
| Free cook, 3 credits                          | $0.0011           | **$0.0047**        | $0.078            |
| Platform AI (imports, checks), per registered | $0.0038           | **$0.0143**        | $0.061            |
| **Blended AI per registered user (Free = 3)** |                   | **$0.029**         |                   |

Base totals at 100k (5%, Free = 3): Pro with AI $746 + free credits $447 + trials $299 + platform $1,429 =
**$2,921 a month**. At 2% it is $2,487; at 10% it is $3,644. Platform AI is the largest line, and it
grows with imports, not with credits.

---

## 5. Infra at 100k users

**Today (Cost Explorer, read-only):**

| Month          | Total   | Bedrock | Non-AI            | Note                                                       |
| -------------- | ------- | ------- | ----------------- | ---------------------------------------------------------- |
| July 2026      | $243.52 | $0      | $240.70           | Excluding $2.82 tax                                        |
| August 2026    | $600.31 | $60.52  | $525.38           | CloudWatch Container Insights $164 (since fixed), previews |
| September 2026 | $496.99 | $258.91 | $221.35           | Bedrock was the pr-91 runaway                              |
| October 1–26   | $232.37 | ~$0     | ~$268 for 30 days |                                                            |

The steady cost, without AI, is about **$220–270 a month** for prod and sandbox together. From October's tags and the
running tasks, prod is about $150 of that: RDS ~$34, ALB ~$16, 4 Fargate tasks ~$63, public IPv4, NAT and small items.

**What could not be separated:**

- **Tags before 19 September.** `Environment` became a cost tag only on 2026-09-19, so July, August and most of
  September have no tag split.
- **Old and new tag names.** Since then prod appears under both `global` (the old tag) and `production`.
- **Untagged spend.** About $136 of October's $232 is untagged: ECS, VPC public IPv4, ECR, CloudWatch and Secrets.
- **Armoury.** It tags `STAGE`, which is not an active cost tag, so it cannot be split out. It is serverless (Lambda
  and API Gateway only), and those lines are a few dollars at most. Treat **~$5 a month** as its upper bound.

**At 100k registered users:**

- **Load (guess):** 30k monthly active, about 9k daily active, about 150 API calls each a day. That is about 1.35M
  requests a day, ~16 a second on average and ~80 at peak. About 1 TB a month of CDN traffic, mostly photos.

| Item                        | Low                     | Base                                | High                                    | What changes                                  |
| --------------------------- | ----------------------- | ----------------------------------- | --------------------------------------- | --------------------------------------------- |
| Fargate                     | $108 (6 tasks)          | $180 (10 tasks)                     | $360 (20 tasks)                         | 2+ tasks per service, autoscaling             |
| RDS                         | $234 t4g.large Multi-AZ | **$315 m7g.large Multi-AZ, 300 GB** | $853 m7g.xlarge Multi-AZ + read replica | **Biggest step: today's $34**                 |
| ALB (one shared)            | $22                     | $28                                 | $46                                     | Load units only                               |
| CloudFront                  | $10                     | $72                                 | $345                                    | Past the free 1 TB / 10M requests             |
| Public IPv4 ($3.65 each)    | $44                     | $58                                 | $110                                    | One per task                                  |
| Lambda, SQS, S3, NAT        | $30                     | $60                                 | $150                                    | Parse and import workers                      |
| CloudWatch                  | $30                     | $60                                 | $200                                    | Logs. Container Insights once cost $164 alone |
| Secrets, ECR, Route 53, KMS | $15                     | $20                                 | $30                                     |                                               |
| Sandbox (non-prod)          | $100                    | $150                                | $250                                    | Mostly flat                                   |
| **AWS subtotal**            | **$594**                | **$945**                            | **$2,344**                              |                                               |
| Clerk Pro                   | $25                     | $25                                 | $425                                    | 50k retained users included; $0.02 each above |
| Vercel Pro                  | $20                     | $60                                 | $250                                    | $20 a seat with $20 usage credit              |
| Sentry                      | $29                     | $100                                | $300                                    | Team plan $26–29 for 50k errors               |
| Email (SES)                 | $20                     | $64                                 | $160                                    | $0.10–0.16 per 1,000                          |
| App store developer fees    | $10                     | $10                                 | $10                                     | Apple $99/yr; Google one-time $25             |
| **Total infra**             | **$698**                | **$1,204**                          | **$3,489**                              |                                               |
| **Per registered user**     | $0.007                  | **$0.012**                          | $0.035                                  |                                               |
| **Per monthly active user** | $0.035                  | **$0.040**                          | $0.078                                  |                                               |

Clerk stays at $25 in the base case: it bills retained users (users who come back a day after signing up), and 50,000
are included. It moves only if more than 50k users return each month.

---

## 6. Margin per paid plan

- **Gross** is the monthly list price; for annual plans, the annual price ÷ 12.
- **Fee:** Stripe is 2.9% + $0.30 per charge plus Billing at 0.7%. The app store is 15% or 30%.
- **The conservative view loads the paid cook with all infra and platform AI.** That is $1,204 + $1,429 spread over
  5,000 paid cooks, **$0.53 each**. The "own share" view charges the paid cook only its per-user share, $0.026.
- **AI uses:** Pro with AI is costed at 25 base uses ($0.37).

| Plan / period / channel                 | Gross  | Fee   | Margin, own share | Margin, paid carries all infra |
| --------------------------------------- | ------ | ----- | ----------------- | ------------------------------ |
| Pro monthly, Stripe web                 | $9.99  | $0.66 | 93%               | 88%                            |
| Pro monthly, store 15%                  | $9.99  | $1.50 | 85%               | 80%                            |
| Pro monthly, Apple 30% (year 1)         | $9.99  | $3.00 | **70%**           | **65%**                        |
| Pro annual, Stripe web                  | $8.33  | $0.32 | 96%               | 90%                            |
| Pro annual, store 15%                   | $8.33  | $1.25 | 85%               | 79%                            |
| Pro with AI monthly, Stripe web         | $19.99 | $1.02 | 93%               | 90%                            |
| Pro with AI monthly, store 15%          | $19.99 | $3.00 | 83%               | 81%                            |
| Pro with AI monthly, Apple 30% (year 1) | $19.99 | $6.00 | **68%**           | **66%**                        |
| Pro with AI annual, Stripe web          | $16.67 | $0.62 | 94%               | 91%                            |
| Pro with AI annual, store 15%           | $16.67 | $2.50 | 83%               | 80%                            |
| Pro with AI annual, Apple 30% (year 1)  | $16.67 | $5.00 | **68%**           | **65%**                        |

**Company view at 5% conversion** (A4–A6 mix, Free = 3, monthly figures):

| Line         | Amount    |
| ------------ | --------- |
| Revenue      | $65,302   |
| Fees         | $5,899    |
| AI           | $2,921    |
| Infra        | $1,204    |
| Gross margin | **84.7%** |

At 2% conversion it is $26,121 revenue and 76.8% margin; at 10%, $130,603 and 87.3%.

---

## 7. Free credits and the Pro with AI allowance

**Free credits, cost per month at 100k (95,000 free users):**

| Credits | Low (Nova 2 Lite, low use) | **Base (Haiku, base use)** | High (meal-plan-heavy, high use) | Base as % of revenue at 2% / 5% / 10% |
| ------- | -------------------------- | -------------------------- | -------------------------------- | ------------------------------------- |
| 0       | $0                         | **$0**                     | $0                               | 0%                                    |
| 3       | $100                       | **$447**                   | $7,450                           | 1.7% / 0.7% / 0.3%                    |
| 5       | $167                       | **$745**                   | $12,416                          | 2.9% / 1.1% / 0.6%                    |
| 10      | $334                       | **$1,489**                 | $24,833                          | 5.7% / 2.3% / 1.1%                    |

The high column puts every guess at its worst at the same time. It shows what happens if a free "use" can be a full
weekly plan. It is not a forecast.

**Pro with AI allowance that keeps gross margin at or above 70%, even for a cook who uses every credit.** This is the
conservative view, with $0.53 of infra and platform AI per paid cook.

| Channel / period      | AI budget per cook | Uses, base ($0.0149) | Uses, high ($0.116) | Uses, Nova 2 Lite ($0.0088) |
| --------------------- | ------------------ | -------------------- | ------------------- | --------------------------- |
| Stripe web, monthly   | $4.45              | 298                  | 38                  | 506                         |
| Stripe web, annual    | $3.85              | 258                  | 33                  | 437                         |
| Store 15%, monthly    | $2.47              | 166                  | 21                  | 281                         |
| **Store 15%, annual** | **$1.97**          | **132**              | **17**              | 224                         |
| Apple 30%, year 1     | below zero         | none                 | none                | none                        |

- **Recommendation: 50 uses a month, and define a weekly auto-plan as one use per recipe it writes (O-4).** At the
  base cost, 50 uses keeps 70% in every allowed channel with room to spare: 50 × $0.0149 = $0.75 against a $1.97
  budget.
- **If O-4 keeps a whole weekly plan as one use, cap the allowance near 20** until the cost per use is measured.
- The average cook uses about 25 uses, so the plan's average margin stays at 80–90% either way.
- **Trial allowance:** 10 uses costs about $0.15 a trial at the base cost.

---

## 8. The three assumptions that move the answer most

1. **What one use costs** (model × tokens × what counts as a use, A7–A12). It swings 13x: $0.0088 to $0.116. It
   decides both the free-credit cost and the allowance. Measure it as soon as one feature runs on prod.
2. **How many free users use their credits** (A17). It swings about 6x and applies to 95,000 users. Base is 15% of
   free users using 70% of their credits.
3. **Payment channel** (A6 and O-9). Apple at 30% removes the 70% margin on both plans, even with no AI. The Small
   Business Program (15%, needs enrolment and under $1M proceeds a year) or web checkout restores it.
   Conversion (2–10%) changes total profit a lot, but changes the per-plan and free-credit answers very little.

---

## Scenario analysis (company, monthly)

| Scenario | Probability (guess) | Outcome                                                                                     |
| -------- | ------------------- | ------------------------------------------------------------------------------------------- |
| Low      | 25%                 | 2% conversion, base costs, Free = 3: $26.1k revenue, 77% gross margin                       |
| Base     | 50%                 | 5% conversion, base costs, Free = 3: $65.3k revenue, 85% gross margin                       |
| Stress   | 25%                 | 5% conversion, high cost per use, high free use, Free = 10: AI about $30k+, margin near 35% |

## Risks

- **The $100 ADR-0024 ceiling** is about 3% of base AI spend at this size. When it runs out, every call site is
  refused, paying cooks included (O-8). Raise it, or give paid allowances their own pool, before Pro with AI is sold.
- **The bulk-import tail.** Bulk import allows 1,000 recipes per cook per rolling day. One cook at the cap for a month
  is about $360 of platform AI at $0.012 a recipe, and that cook may be on Free.
- **Runaways.** pr-91 spent $252.96 in 19 days with no cook using it. Non-prod has no ceiling (ADR-0024 §3).
- **Store commission.** Apple moves to 30% in the first paid year once proceeds pass $1M, or for anyone not in the
  Small Business Program.
- **Not counted:** people, support, chargebacks and refunds, sales tax handling, legal, marketing, and the 020 review
  staff time.

## Recommended actions

1. **Before Pro with AI is sold:** settle O-4 (what one use is, especially the weekly plan) and O-8 (ceiling vs paying
   cooks). Bring in `cpo-1` for O-4 and `cto-1` for the ceiling design.
2. **Start Free at 3 uses and Pro with AI at 50.** Review both after the first month of measured cost per use.
3. **Enrol in Apple's Small Business Program,** or decide O-9 in favour of web checkout. Ask `clo` to confirm the store
   rules.
4. **Measure cost per use on prod.** Use the `callSite` metric, one figure per feature.
5. **Fix the cost tags.** Retag the untagged ECS, VPC and ECR spend and the old `global` tag, so prod's true cost is
   visible. That would raise confidence in §5.

Confidence: **Medium** on prices and infra. **Low** on usage. Measured cost per use and the first month of real
usage would raise both.

---

## Sources

- AWS Price List API, us-east-1, read 2026-10-27 with `aws pricing get-products` (offer files):
    - Bedrock (Nova Micro, Nova Lite, Nova 2 Lite): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/us-east-1/index.json
    - Bedrock, Claude Haiku 4.5 (Marketplace and service listings): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/us-east-1/index.json and https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockService/current/us-east-1/index.json
    - Fargate ($0.04048 per vCPU-hour, $0.004445 per GB-hour): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonECS/current/us-east-1/index.json
    - RDS PostgreSQL (t4g.small $0.032/h; t4g.large Multi-AZ $0.258/h; m7g.large Multi-AZ $0.337/h; m7g.xlarge Multi-AZ $0.674/h): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/us-east-1/index.json
    - CloudFront ($0.085 per GB for the first 10 TB, $0.01 per 10k HTTPS requests): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonCloudFront/current/index.json
    - Public IPv4 ($0.005 per hour): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/current/us-east-1/index.json
    - SES ($0.10 per 1,000 recipients, à la carte): https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonSES/current/us-east-1/index.json
- CloudFront free 1 TB and 10M requests: https://aws.amazon.com/cloudfront/pricing/pay-as-you-go
- SES Essentials plan at $0.16 per 1,000 for new accounts (third-party): https://dev.classmethod.jp/en/articles/ses-pricing-plans-price-list-api-sesv2-api/
- Clerk Pro $25/mo, 50,000 retained users included, $0.02 then $0.018 above 100k (fetched 2026-10-27): https://clerk.com/pricing
- Stripe 2.9% + $0.30 (third-party; Stripe's own page was not read): https://www.nerdwallet.com/article/small-business/stripe-fees
- Stripe Billing 0.7% (third-party): https://www.withorb.com/blog/stripe-billing-pricing
- Apple 15% Small Business Program, 30% first paid year otherwise (third-party): https://www.revenuecat.com/blog/engineering/app-store-fees
- Google Play 15% on subscriptions from day one: https://appleinsider.com/articles/21/10/21/google-play-drops-all-subscription-commissions-to-15-from-day-one
- Vercel Pro $20 a seat with $20 usage credit: https://vercel.com/docs/plans/pro-plan. Overage rates (third-party): https://temps.sh/blog/vercel-pricing-2026-pro-plan-explained
- Sentry Team $26–29 for 50k errors (third-party): https://cubeapm.com/pricing-calculator/sentry/ and https://last9.io/blog/sentry-pricing/
- Our own bill: `aws ce get-cost-and-usage` for 2026-07-01 to 2026-10-27, grouped by SERVICE, Environment tag and Bedrock usage type. Calls per model: CloudWatch `AWS/Bedrock` Invocations, InputTokenCount and OutputTokenCount.
- Repo: `specs/010-subscriptions/spec.md` (plans, O-2 to O-11, SC-006), `specs/005-ai-integration/spec.md` (FR-015a–f),
  `docs/architecture/decisions/0024-llm-spend-ceiling-reserve-then-settle.md`, `specs/020-content-source-check/plan.md`,
  `packages/shared/recipe-core/src/spend/spendArithmetic.ts`.

Price caveat: list prices change. Prices read from the API were current on 2026-10-27. Prices from third-party sites
may be older.
