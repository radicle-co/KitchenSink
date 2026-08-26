# Specification Quality Checklist: Chef Program & Marketplace Monetization

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain — **4 open**: `C-018-003a/b/c` and `C-018-004` (commission against the stack); `C-018-001` and `C-018-002` ✅ resolved. ⚠️ This exceeds `/speckit-specify`'s three-marker generation cap **deliberately** — see Iteration 6
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined — US7's are deferred **by decision**, not omission
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Iteration 1 (2026-08-26)** — two defects found and fixed before this pass was recorded:

1. **Mis-cited cross-feature FRs.** `002-FR-035` (suspension) and `002-FR-042` (impersonation) were both
   wrong — `002-FR-042` is the suspended-user `403`, and impersonation is `002-FR-036`/`002-FR-037`.
   `002`'s own Out-of-Scope prose carries the same mis-citation, which is how it propagated. Corrected at
   every site. This is exactly the class `GR-003` AC-003-a and `cross-feature-FR-index.md` Review Rule 2
   exist to catch.
2. **Implementation detail leaked into `FR-027`** — it named a shipped source module by symbol. Rewritten as
   a governance citation (`GR-014` AC-014-e, `ADR-0023`) that carries the same binding without instructing
   the implementation.

**Iteration 2 (2026-08-26)** — owner ruling + research applied:

- **`C-018-001` RESOLVED — the licensed-copy model.** `FR-029`…`FR-030` written; `FR-029a`…`FR-029c` added.
  A finding emerged while writing it that reduced the governance cost below what the option table estimated:
  the constraint a purchased copy needs (private-only, never publishable, never re-sellable) is **already
  enforced** by the shipped `imported_paid` provenance class, which `GR-014` AC-014-e states "may never be
  public". `GR-014` therefore needs only a **narrow `AC-014-h` exception**, not the major amendment the
  paid-recipe model would have required. `AC-014-d` and the binary-visibility rule stand.
- **`C-018-003` researched and narrowed**, at the owner's direction, into its own dedicated spec section
  (Section H) plus [`research/free-visitor-monetization.md`](../research/free-visitor-monetization.md) —
  a 10-option catalogue across five groups with cited yield figures, scored on yield-at-our-scale, consent
  surface, strategy fit and chef-attributability; a recommendation; and six explicitly rejected options.
  Two new requirements came out of the research rather than the prompt: `FR-058b` (pro-rata vs user-centric
  allocation must be stated, not defaulted) and `FR-062a` (corpus/AI licensing is out of scope, because
  `016-FR-010`'s licence does not cover it).

**Iteration 3 (2026-08-26)** — `C-018-002` RESOLVED, the split ("Amazon Marketplace") seller-of-record model.
`FR-032`…`FR-032d` written, with consequences propagated to `FR-042` (a negative balance is now a **routine**
state, because the buyer guarantee creates one on every refund of an already-paid-out sale), `FR-049`,
`FR-053` and `FR-054`. **Sections D, E, F and G are now complete.**

Two findings from that research are recorded in the clarification so they are not re-litigated: US
marketplace-facilitator laws attach tax collection to the **platform** regardless of the seller of record (so
the chef-as-seller choice buys distance from money transmission and seller-side content liability, and buys
**nothing** on tax); and Amazon takes the buyer-facing refund anyway, which is why `FR-032a` departs from a
pure agency model. The platform-as-seller counterpoint (Amazon KDP, App Store and Play all use it for
**digital** goods) is recorded as a real argument that lost on a specific cost — it would put the platform in
a seller's content-liability posture, which is not the framing `016` is built on.

**Iteration 4 (2026-08-26)** — `C-018-003` **widened on owner direction** ("I think this is too narrow"), and
given the balance of specification effort. The research went from 10 options to **22 across six payer
groups**, and the widening changed the answer rather than merely lengthening it:

- **Two payers were missing from the first shortlist entirely.** **P4, the chef** — seller-funded advertising
  is ~$985M/yr at Etsy, used by 40%+ of sellers, and the acknowledged driver of its take-rate expansion; at
  real marketplace scale the seller is a bigger payer than the visitor. **P5, another business** — Whisk
  (Samsung Food) already sells CPG sponsored placement across ~500M monthly recipe impressions _and_ a B2B
  recipe CMS, on the same asset class this portfolio has built.
- **A second decision surfaced that the spec had been answering by implication**: `FR-014` and `FR-058d`
  forbid any purchased ranking advantage, and the mechanism that contradicts them is the largest revenue line
  in the comparable business. Promoted to `C-018-003b` with three stated positions, because a trade that size
  must not be settled by default. `FR-058d` was amended to say **organic** ranking, with the word flagged as
  load-bearing.
- **Four requirements came out of the research rather than the prompt**: `FR-058e` (the ranking question),
  `FR-058f` (the recognition layer is un-gated and must be built regardless), `FR-062b` (a chef Pro tier may
  sell capability, never placement — otherwise it evades `FR-058e` rather than answering it), and `FR-062c`
  (aggregate-data revenue must clear `016-FR-007` consent and must not expose what `016-FR-032` classes as
  confidential).
- **`FR-061` gained a quantified rationale**: a hard paywall converts ~5× better than freemium, so the
  pressure to tighten the free tier is permanent — which is precisely why the requirement exists.

**Iteration 5 (2026-08-26)** — `C-018-003` **widened a second time**, on the owner's service /
retail-platform / data / conversion-psychology framing. The research went from 10 → 22 → **27 options**, and
from one question to **five**. Five things changed that were not lengthening:

- ⭐ **The retail-platform reading is materially different from the media reading, and it is correct.** Retail
  media earns **60–70% margins** on first-party purchase data vs 5–10% on core retail; Chase and PayPal built
  Financial Media Networks on the same logic. **We hold the signal earlier than a retailer does** —
  pre-basket meal intent, while the ingredient list is still editable. That promotes CPG sponsorship and
  aggregate insight from "later" to the **strategic tier**, delivered through a **clean room** (<48% of retail
  media networks offer one). Added as `FR-062e`, bounded hard.
- ⭐ **Q-D has a concrete, evidenced answer.** A free user is
  `conversion + corpus + liquidity + social proof + referral` — five channels, of which the ~2.1% conversion
  rate is one. **`FR-058i` makes measuring all five a precondition of narrowing the free tier**, because four
  of them shrink with reach. This is the requirement that keeps `C-018-003c` from being decided on one fifth
  of the evidence.
- ⭐ **Referral surfaced as the highest-leverage under-built item** — 3–5× paid-acquisition conversion at ~25%
  lower CAC, k-factor 0.2–0.4 → 0.5–0.8 — and it is **unowned**: `015` explicitly out-of-scopes rewarding
  "referring". `FR-058k` bounds it against `015`'s recognition layer.
- ⚠️ **The FOMO half of the owner's question required a real line, not a hedge.** `015-FR-027` already forbids
  artificial scarcity, countdown timers and false urgency, and **EU DSA Art. 25 prohibits manipulative
  interface design outright** (UCPD alongside; CRD amendments from 19 June 2026; a Digital Fairness Act
  expected). The enforcement guidance makes **truthfulness decisive** — a genuine time-limited offer is
  legitimate; the same notice violates when the urgency is invented or **resets**. `FR-062d` states the test:
  _if the fact would still be true with the counter removed, the counter is honest; if the counter creates the
  fact, it is a dark pattern._ ⭐ And the answer is **not "no"** — the **reverse trial** is the best fit in the
  catalogue and is entirely honest (17–32 day trials convert **45.7% vs 26.8%**), bounded by `FR-058j` so it
  can never be applied retroactively and trip `FR-061`.
- ⚠️ **The two largest conversion levers in the whole evidence base are not gates at all** —
  **experimentation (up to 40×)** and **trial length**. Recorded prominently so the tightening conversation
  does not start at the riskiest lever.
- ⛔ **One hard stop added**: `FR-062f` — allergen, dietary-restriction and household-composition data is
  never inventory, aggregated or not. It is health-adjacent and it is the first thing a creative reading of
  "monetize the data" reaches for.

Six requirements came out of this pass rather than the prompt: `FR-058h` (`C-018-003c`), `FR-058i`
(five-channel measurement), `FR-058j` (reverse-trial bounds), `FR-058k` (referral bounds), `FR-062d`
(pressure-signal truthfulness), `FR-062e` (intent-data boundary) and `FR-062f` (the hard stop). Hazard **H4**
was rewritten around the asset rather than around advertising, and the `010` amendment row now records that
`C-018-003c` may ask `010` to change `010-FR-040`/`010-FR-041`.

**Iteration 6 (2026-08-26)** — owner: _"keep pushing on all dimensions."_ This pass went outside the
monetization frame and found four dimensions the previous five passes did not carry. **Three of the six
findings contradict something the spec had already settled**, which is the point of the pass.

- ⛔ **Section L (Trust, fraud and abuse) did not exist, and `FR-032a` created the need for it.** Choosing the
  buyer guarantee made the platform the party who pays first. Refund/policy abuse has **displaced payment
  fraud as merchants' top-reported threat** (52% "item not received"); card testing is **+175% YoY**; digital
  goods are the _preferred_ target because value is instant and unrecoverable; and self-dealing is a
  laundering rail that `FR-032b`'s agency bounds do not address. Seven requirements added (`FR-075`–`FR-081`),
  including a **rolling reserve** (`FR-039a`) — the control the model needs and did not have.
- ⛔ **Section M (Payment rails) — a 20% commission is not 20%.** A platform store takes **30%** (15% small
  business) **first**, leaving the chef ~50%. `FR-073` requires web-and-mobile parity, so mobile economics are
  not optional. ✅ v1 survives because `016-FR-048` serves the **US only** and App Store §3.1.1(a) expressly
  permits external links in **US storefront** apps. ⚠️ Non-obvious edge: Apple names **buying advertising to
  display in the same app** ("boosts") as IAP-required — which lands directly on `C-018-003b`.
- ⚠️ **`C-018-004` opened, and it challenges a ratified number.** `013-FR-010`'s 20% sits **above every
  comparable creator platform** (Ko-fi 0/5%, BMAC 5%, Substack 10%, Gumroad 10%, Patreon 8–12%, Kajabi/Teachable
  0% + flat fee). Etsy's 25.7% is an _effective_ rate across physical goods, payments and ads — not a content
  commission, and it had been read as one.
- ⛔ **The chef-side power law forced an honesty requirement.** Top 1% capture **~97%** of platform-derived
  revenue; ~4% earn >$100k; ~1.3% reach full-time viability. `FR-003a` now forbids stating or implying typical
  earnings without substantiation — the FTC's active earnings-claims rulemaking is expected to reach
  money-making opportunities generally. ⭐ It also **strengthens the pool case** (`FR-058a-i`): sales pay a
  handful of chefs and nothing to the rest; an attributed pool is the only mechanism here that is not
  winner-take-all by construction.
- ⛔ **A direct contradiction inside this repo was found and resolved rather than averaged.** The owner's
  tightening instinct vs `docs/competitive/02-gap-analysis-and-strategy.md` **D5**, which concludes the
  inverse — _"hold or raise price, and buy the position with a far more generous free tier,"_ with nutrition
  free. Its supporting findings hold (price parity not premium; our pipeline costs more; the category ceiling
  anchors to a failing category; "no forced subscription" is the #9 churn reason → **D23**). **`FR-058h-i`
  applies the correction: nutrition is removed from the candidate gate list.** The reconciliation — less
  unlimited breadth, more depth of the differentiator — is recorded in `C-018-003c`.
- **Two smaller gaps**: `FR-003b` (impersonating a real chef is the application's sharpest fraud, and handle
  uniqueness is not identity truth) and `FR-014a` (an empty directory is a state, and every tempting fix for
  it violates a requirement already written).

**Marker count**: this pass takes the spec to **4** open markers, above `/speckit-specify`'s three-marker
generation cap. That cap governs **initial generation** — it exists so a first draft does not interrogate the
user. Here two of the original three are owner-resolved and the fourth marker is a **newly discovered**
blocking decision on a ratified number. Suppressing it to satisfy a count would hide a real decision, which
is the failure the cap exists to prevent, not the one it would cause.

**Iteration 7 (2026-08-26)** — owner: _"keep going."_ Four more dimensions, and the first one stress-tests a
premise the specification had **accepted without testing**.

- ⛔ **Section N — "why would anyone pay for a recipe when recipes are free?" had never been asked.**
  `001-FR-004` makes every public recipe readable and `001-FR-005` makes it cloneable, and the open web is
  saturated. The premise survives — cookbooks are a **$4bn+** market, the paper segment alone **~$7.7bn (2024)
  → ~$11.8bn (2032)**, roughly **27% of book publishing**, all of it existing _inside_ a world of free
  recipes — **but the answer changes the product**. What people buy is curation, credibility, reliability and
  a voice: a **bounded, opinionated set**, not a recipe. And the highest-converting axis is a **constraint**
  (specialty-diet collections reportedly outsell general ones by **~300%**). ⭐ That is exactly where the
  USDA-nutrition differentiator becomes something a chef can **sell** — a constraint that is
  **machine-verified** rather than author-asserted, which a PDF or a blog structurally cannot offer.
  `FR-087` makes the **collection** the primary sellable unit; `FR-088` requires a stated constraint to be
  **verified, not asserted**, which is a **safety** requirement before a commercial one (an allergen claim on
  a paid product is physical-harm exposure, and `016-FR-051` already applies).
- ⛔ **Section O — a household collision neither spec can see from its own side.** `017-FR-031` scopes meal
  plans to the household; `FR-029a` makes a purchased recipe private to the buyer. **A household meal plan can
  therefore reference a recipe the other members cannot read.** Resolved **household-scoped** (`FR-092`) on
  three grounds, with the consequence stated plainly rather than hidden: **one sale can serve a household of
  six**, so `FR-046` must disclose the scope before a chef prices. `FR-093`–`FR-095` handle portability, seat
  growth, and the `010`/`017-FR-034` seat-count interaction.
- ⛔ **Section P — `FR-058i` was an unenforceable control.** It forbade narrowing the free tier until five
  value channels are measured, and nothing said how any channel is measured. ⚠️ **`FR-098` is the load-bearing
  line**: an unmeasured channel MUST report as **UNMEASURED, never as zero** — a dashboard showing four
  channels and a silent zero looks like five were measured, and `FR-058i` would read satisfied while being
  violated. `FR-097` requires the attribution window and multi-touch rule to be **stated**, because last-touch
  is the default nobody chooses and it systematically under-credits the corpus and social-proof channels —
  precisely the ones a tightening would destroy.
- ⭐ **`FR-005b` narrowed `C-018-003b` usefully.** Etsy reports Star Sellers _"made more in sales and got more
  listing views"_ and that the badge _"can boost the quality score of listings in search"_ — an **earned**
  ranking effect. That is a materially different thing from a **purchased** one, and it is compatible with
  `FR-014` provided the criteria are published and objective. **The real question is not "may ranking vary" but
  "may ranking be BOUGHT."** Recorded failure mode too: Etsy sellers widely describe those thresholds as
  unattainable — a tier nobody can reach is worse than no tier.

**The four remaining markers:**

**The four remaining markers:**

Per the `/speckit-specify` limit of three, a fourth candidate — **chef eligibility and vetting** — was
resolved by informed default instead (Assumption 1: application + human review), on the grounds that
self-declaration would make "chef" a synonym for `012`'s existing free `@handle`, and that human review is
what makes `FR-053`'s seller-identity collection meaningful.

**Blocking status**: `C-018-003a/b/c` and `C-018-004`, plus one recommendation awaiting confirmation
(`FR-092`, household-scoped purchases). Sections A–G and I–P are complete; Section H is the remaining
specification work by owner direction. ⚠️ **Un-gated and buildable now**: `FR-058f` (the recognition layer),
`FR-096`–`FR-099` (the instrumentation `FR-058i` depends on), `FR-062d`/`FR-062e`/`FR-062f` (the boundaries),
all of **Section L** (fraud controls follow from `FR-032a`, not from any open question), and `FR-088`
(constraint verification — a safety requirement before a commercial one).
