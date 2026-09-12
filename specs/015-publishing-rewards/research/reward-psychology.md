# 015 — Reward Psychology & Mechanism Research

**Created**: 2026-08-22
**Purpose**: Close [`research-brief.md`](../research-brief.md) §1–§4 with evidence rather than intuition.
**Consumers**: `spec.md` FR-007a, FR-007e, FR-007f–j, FR-010, FR-025–FR-031.

> **Sourcing note.** Effect sizes are quoted only where a primary or well-attributed source states them.
> Where the literature is qualitative, or the source is vendor marketing, it is said so inline. Claims marked
> **INFERENCE** are ours, drawn from the evidence, not stated by any source.

---

## 0. The question this research had to answer

The owner's direction was to build something _"truly compelling and addictive"_ by leveraging _"human
psychology we can leverage and manipulate."_ Taken at face value that names a specific class of mechanic —
streaks, loss-framed counters, leaderboards, variable reinforcement. So the research was pointed at those
mechanics **first**, on their own terms: do they produce durable contribution?

**They largely do not, for this activity** — and three of them are actively counter-indicated here. The
mechanics with the strongest evidence for _sustained_ contribution are the quieter ones. That is the central
finding, and it is convenient rather than inconvenient: the design that performs best is also the one that
survives the inducement hazard and DSA Art. 25.

**Why "addictive" is the wrong target specifically for this feature**, in one line: the engagement mechanics
work by increasing _frequency of a repeatable low-cost action_. Authoring an original recipe is neither
frequent nor low-cost. Pointing a frequency mechanic at it does not produce more recipes — it produces more
**junk** recipes, which is the one outcome that damages the corpus, trips `FR-001`'s anti-inducement control,
and hands a plaintiff the "we deliberately incentivised uploads" narrative described in §6.

---

## 1. What the evidence says works

### 1.1 Symbolic, non-monetary recognition — the strongest result in the set

Restivo & van de Rijt ran a randomised field experiment on Wikipedia: 200 contributors drawn from the top 1%
most productive who had never received a barnstar, split 100/100, treatment group awarded one barnstar.

- Recipients showed **~60% higher productivity**, and were **six times more likely** to receive further
  barnstars from other community members.
- The effect **persisted at three months**.
  ([PLoS ONE 7(3):e34358](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0034358))

Gallus's later natural field experiment on Wikipedia newcomer retention found purely symbolic awards raised
retention with the effect **persisting over the four following quarters**.
([Information, Communication & Society 17(4)](https://www.tandfonline.com/doi/abs/10.1080/1369118X.2014.888459))

**Why this matters more than any other finding**: the reward was _symbolic, non-monetary, unexpected, and
came from a person_. It cost the platform nothing, and it outperformed on the one axis we care about —
durability. This is the evidentiary basis for making recognition the load-bearing currency rather than a
decorative layer on top of the slots.

**The boundary condition, from the same literature — "no praise without effort".** Recognition given without
regard to effort does not carry the effect, and can backfire. Recognition must be **contingent on something
real**.

### 1.2 Endowed progress — a head start measurably raises completion

Nunes & Drèze: a ten-stamp loyalty card with **two stamps pre-filled** was completed at **34%**, versus
**19%** for an eight-stamp card starting empty. Identical work required; only the framing differed — a task
_already begun and incomplete_ rather than _not yet started_.
([Journal of Consumer Research 32(4):504](https://academic.oup.com/jcr/article-abstract/32/4/504/1787425))

**This bears directly on the zero-slot start** (brief §3). A user shown "0 of 50" is at the empty-card
condition. A user shown "3 of 50, earn more by publishing" is at the pre-filled condition — and the evidence
says that roughly **doubles** follow-through. The head start is not merely a fix for the first-publication
toll; it is independently the higher-performing design.

### 1.3 Bounded, permanent, native rewards — Dropbox

Dropbox's referral programme granted **500 MB per referral to both sides, capped at 16 GB**, auto-fulfilled,
permanent. Reported outcomes: signups 100K → 4M over ~15 months, a **permanent ~60% lift** in signups, ~35% of
daily signups referral-sourced. _(Vendor/founder-presentation figures, widely repeated but not independently
audited — treat the direction as sound and the magnitude as marketing.)_
([Viral Loops summary of Houston's 2010 SLL talk](https://viral-loops.com/blog/dropbox-grew-3900-simple-referral-program/))

The transferable design properties, all of which our slot model already shares:

| Property                                 | Dropbox | 015 slots            |
| ---------------------------------------- | ------- | -------------------- |
| Reward is the thing users already wanted | storage | privacy              |
| Permanent, never clawed back             | ✅      | ✅ `FR-007b`         |
| Hard cap                                 | 16 GB   | 50 recipes `FR-007c` |
| Auto-fulfilled, no claim step            | ✅      | ✅                   |

### 1.4 Feedback from a real human who used your work — the Cookpad mechanism

Cookpad's contributor culture is not built on points or rank. Its levers are that contributors **see how many
people used their recipe**, and that cooks **report back** on what they made. Contributors are described as
motivated by feeling _valued by the community_ and by seeing view counts that told them a recipe was useful.
([Harvard D3 platform case](https://d3.harvard.edu/platform-digit/submission/cookpad-spreading-the-joy-of-cooking-worldwide/))

This maps cleanly onto Self-Determination Theory's **competence** (my work is good) and **relatedness** (a
real person used it) — the two needs the SDT literature associates with _sustained_ voluntary contribution, as
against short-run compliance ([Ryan & Deci
2000](https://selfdeterminationtheory.org/SDT/documents/2000_RyanDeci_SDT.pdf)).

**INFERENCE**: "someone actually cooked this" is the single highest-value recognition signal available to us,
it is the closest analogue to the barnstar (human-sourced, effort-contingent, symbolic), and we can source it
from data we already hold.

---

## 2. What the evidence says to avoid

### 2.1 Streaks — counter-indicated, and abandoned by the closest analogue

GitHub **removed** contribution streaks in 2016. The stated concern was that a mechanic rewarding
never-taking-a-day-off is harmful to contributors and thereby to the ecosystem; a 416-day streak means 416
days without a break.
([freeCodeCamp](https://www.freecodecamp.org/news/dont-break-the-chain-why-github-s-streaks-will-be-sorely-missed-by-many-4fff90bc2a38/),
[dear-github#163](https://github.com/dear-github/dear-github/issues/163))

Duolingo's streaks do drive retention, but the critique is consistent and is precisely our failure mode: the
streak measures **app-opens, not learning** — "a 200-day streak of five-minute sessions completed on autopilot
is not the same as 200 days of real study." Streaks also trigger the **abstinence-violation effect**: once
broken, users rage-quit rather than resume.
([The Decision Lab, "Streak Creep"](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification))

**Verdict: exclude.** Two independent reasons. (1) Frequency mismatch — a streak demands a daily repeatable
act, and nobody authors an original recipe daily, so the only way to satisfy a publishing streak is to publish
filler. (2) It is loss-framed, which is the mechanic DSA Art. 25 and the Digital Fairness Act are aimed at
(§6).

### 2.2 Global leaderboards — motivate a few, demotivate the rest

The gamification literature converges: leaderboards showing absolute rank motivate top performers and
demotivate everyone below them, and users' preference for the leaderboard tracks their own position on it.
Relative leaderboards (nearest peers only) fare better than absolute ones.
([Designing Leaderboards for Gamification](https://www.researchgate.net/publication/316651227_Designing_Leaderboards_for_Gamification_Perceived_Differences_Based_on_User_Ranking_Application_Domain_and_Personality_Traits),
[Yu-kai Chou](https://yukaichou.com/advanced-gamification/how-to-design-effective-leaderboards-boosting-motivation-and-engagement/) —
_practitioner source, directionally consistent with the peer-reviewed work, quantities not independently
verified_)

Compounding this: **participation inequality**. Nielsen's 90–9–1 puts content creation at ~1% of users; the
Wikipedia figure he cites is ~99.8–0.2–0.003.
([NN/g](https://www.nngroup.com/articles/participation-inequality/))

**INFERENCE**: with ~1% creating, a global leaderboard is by construction a surface that tells ~99% of users
they are nobody, in exchange for motivating a population small enough to reach individually. The cost/benefit
is not close.

**Verdict: exclude global/absolute rankings.** This resolves the brief's §2 visibility question against
option 2.

### 2.3 Volume-threshold badges — they steer, and they steer at whatever you point them at

Anderson, Huttenlocher, Kleinberg & Leskovec, on Stack Overflow: badges produce **measurable causal steering**
— users increase the badge-targeted action as they approach a threshold — and the effort is **reallocated**
from other valuable actions rather than added on top.
([WWW 2013](https://www.cs.cornell.edu/home/kleinber/www13-badges.pdf))

_(A machine summary of this PDF produced specific post-badge decay figures that we could not verify against
the text; they are deliberately not quoted. The steering and substitution results are the paper's robust,
widely-replicated core.)_

**INFERENCE, and the most actionable finding in this document**: a badge threshold is a **behavioural
instruction**. A badge at "publish 25 recipes" instructs users to publish 25 recipes — not to publish 25
_good_ recipes. Given our completeness floor is deliberately **structural, not qualitative** (`C-015-002`) and
therefore cheap to satisfy, publication-count milestones would reliably manufacture floor-clearing filler.
Milestones must key on **impact** (recipes other people cooked or rated), which is the same instruction
pointed somewhere useful.

### 2.4 Anything peer-vote-scored gets gamed

Stack Overflow's reputation system has documented, categorised fraud — voting rings and five other scenarios
— sustained enough to warrant automated detection.
([arXiv:2111.07101](https://arxiv.org/abs/2111.07101))

**INFERENCE**: any single number that confers standing and is computed from other users' voluntary votes will
be collusion-attacked. Recognition should rest on signals that require _independent_ behaviour from many
users (people cooking a recipe), and standing should be **coarse and monotonic** (a small number of permanent
tiers) rather than a fine-grained score that rewards marginal manipulation.

### 2.5 Overjustification — the risk that the reward itself destroys the behaviour

Expected, salient, contingent extrinsic rewards for behaviour that is _already intrinsically motivated_ reduce
intrinsic motivation; when the reward is withdrawn, engagement can fall **below** its original baseline, and
the extrinsic reward must then be sustained indefinitely to hold the behaviour up (Deci; Lepper — see
[overview](https://en.wikipedia.org/wiki/Overjustification_effect)).

Sharing recipes is intrinsically motivated for a large share of cooks. **This is the most serious systems risk
in the feature**, and it is structural rather than avoidable: private slots are exactly an expected, salient,
contingent extrinsic reward, and they are **finite by design** — they _will_ run out at the ceiling.

**INFERENCE — the handoff requirement.** The slot currency is a **bootstrap, not an engine**. It must hand off
to the durable symbolic layer _before_ it terminates, or the ceiling becomes a motivational cliff: the moment
a contributor stops earning is the moment their reason to contribute was withdrawn. Two consequences flow into
the spec: recognition must accrue **from the first publication** (not unlock late), and it must **keep
accruing past the ceiling**.

---

## 3. §1 — Reward schedule (recommendation)

**Separation of concerns**: the _schedule_ is the motivational instrument; the _rate limit_ is the safety
control. Loading anti-farming into the schedule (harsh diminishing returns) blunts the motivation and is the
weaker of two available tools, because near-duplicate suppression (`FR-006`) and the rate limit already cover
the farming case.

**Recommended schedule — front-loaded, mildly diminishing, terminating at the ceiling:**

| Qualifying publication | Slots granted | Cumulative slots | Cumulative publications |
| ---------------------- | ------------- | ---------------- | ----------------------- |
| 1st – 10th             | 2 each        | 20               | 10                      |
| 11th – 30th            | 1 each        | 40               | 30                      |
| 31st – 70th            | 1 per 2       | 50               | 70                      |

Rationale, mapped to evidence:

- **Front-loading (2 slots early)** buys the strong first-run moment §1.2 argues for, and gets a new
  contributor to a _usable_ amount of privacy (10 private recipes for 5 publications) quickly.
- **Mild diminishing returns** mirrors the Dropbox bounding (§1.3) without making the mid-game feel punitive
  where sustained contributors actually live.
- **Terminates exactly at the `FR-007c` ceiling of 50** — so the schedule and the ceiling are one fact, not
  two that can disagree. The 50-recipe ceiling stops being vestigial.
- **Legible in one table**, which `FR-008` requires (the bargain must be stated before the user acts).

**Recommended earn-rate limit: 3 grants per rolling 24 h, 10 per rolling 7 days.** Writing an original recipe
is slow; 10/week is already exceptional and 50/day is farming. Publication is never blocked — only the grant
is withheld, per `FR-010`. The daily component is deliberately consistent with `004-FR-022`'s existing daily
import allowance.

**Past the ceiling**: slots stop, **recognition does not** — required by §2.5's handoff.

---

## 4. §2 — Status and recognition (recommendation)

**The unifying invariant — the ratchet.** Every reward in this feature is **monotonic**: granted permanently,
never decaying, never rank-relative, never revocable except by the `FR-016` takedown path. One rule, and it
disposes of streaks, leaderboards, decay, demotion, tier loss and every loss-framed counter simultaneously —
each of which the evidence above independently rejects. It is also directly testable, which a principle stated
as a value would not be.

**Recommended mechanics:**

| #   | Mechanic                                                                                                              | Basis  | Evidence                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| R1  | **Cook signal** — the author sees, in aggregate, how many people cooked/saved their published recipe                  | impact | §1.4 Cookpad, §1.1 human-sourced recognition               |
| R2  | **Impact milestones** — permanent, keyed on recipes-cooked-by-others and ratings received, never on publication count | impact | §2.3 (steer at the right target), §1.1 (effort-contingent) |
| R3  | **Contributor standing** — a small ladder of named, permanent tiers, text-labelled                                    | impact | §2.4 (coarse resists gaming), `NFR-004`                    |
| R4  | **Surface owned by `012`** — 015 emits the facts, 012 renders the public profile                                      | —      | resolves brief agenda item 5                               |

**Visibility: public profile, no rankings** (brief §2 option 1). Public, because the barnstar and GitHub
mechanisms work _because_ they are seen (§1.1); no rankings, because §2.2 shows absolute rank is
net-negative across a 1%-creator population. Fits `012-FR-009`'s existing posture (aggregate counts, not
lists).

**Excluded, each on evidence**: streaks (§2.1), global/absolute leaderboards (§2.2), publication-count badges
(§2.3), any fine-grained peer-voted score (§2.4), purchasable or monetised status (already out of scope).

---

## 5. §4 — Reaching premium (recommendation)

Private slots are worthless to an account with unlimited privacy, so exactly one currency reaches premium
today. The instinct is to add more levers. **The evidence says the opposite**: §2.5 warns that stacking
salient extrinsic rewards onto intrinsically motivated behaviour crowds it out, and §1.1 shows one
well-built symbolic currency outperforms. **One strong currency beats three weak ones.**

**The gap this section originally missed** _(added 2026-08-22, owner-raised)_: it treated "reaching premium" as
a question of _which currency_, when the binding problem is _the first step_. Recognition reaches premium in
principle, but it is keyed on **impact** — cooks and ratings — and impact requires an audience a user who has
never published does not have. The free tier's on-ramp is front-loaded slots; a premium user has no equivalent,
so the reward was reachable in theory and unreachable in practice. The same trap catches any free user sitting
on already-earned slots.

Two additions close it, and both are cheap:

- **A first-publication milestone** (`FR-007l`) — recognition for publication number one, no impact required.
  This is a publication-count threshold, which §2.3 otherwise argues against; it is safe **only** because the
  threshold is exactly **one** and therefore cannot be farmed past a single instance. No second
  publication-keyed threshold may exist.
- **A reciprocity signal** (`FR-007m`) — showing a user, privately, how much of the public corpus they have
  used. This is not a reward at all; it is true information, and it is the one lever with any purchase on
  someone who needs no benefit. The literature's caution applies sharply: reciprocity framed as **obligation**
  is a guilt prompt — both the manipulation DSA Art. 25 targets and, per §2.5, exactly the kind of external
  pressure that crowds out the intrinsic motive it is trying to recruit. Framed as gratitude, stated once,
  dismissible, never shown to anyone else, it recruits the motive instead of overriding it.

| Candidate                                                 | Reaches   | Verdict                                    | Reason                                                                                                                                                 |
| --------------------------------------------------------- | --------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cook signal + milestones + standing (R1–R3)               | Both      | **Adopt — primary**                        | §1.1/§1.4; costs nothing; the only lever with durability evidence                                                                                      |
| First-publication milestone (`FR-007l`)                   | Both      | **Adopt — the on-ramp**                    | Without it, impact-keyed recognition is unreachable for anyone who has never published                                                                 |
| Reciprocity signal (`FR-007m`)                            | Both      | **Adopt — reaches users who need nothing** | Appeals to fairness, not benefit; must be gratitude, never debt                                                                                        |
| Early access to new features                              | Both      | **Adopt — secondary**                      | No gaming value, no new public surface, no inducement pressure                                                                                         |
| Contributor input channel (feature input, early feedback) | Both      | **Adopt — secondary**                      | SDT autonomy + relatedness; genuinely premium-relevant; unfarmable                                                                                     |
| Additional import allowance                               | Both      | Defer                                      | Works, but it is quota-for-content — closest of the set to a transactional exchange                                                                    |
| Discovery placement                                       | Both      | **Reject**                                 | Rewards volume, drives junk (§2.3), and is the mechanic most likely to read as "direct financial benefit" (§6)                                         |
| Premium trial days                                        | Free only | **Reject**                                 | Converts contribution toward a monetary-equivalent; blurs reward and paywall; overjustification-adjacent                                               |
| Tips / payouts                                            | Both      | **Reject**                                 | Blocked portfolio-wide (`012-FR-034`, `013-FR-010`); monetary rewards carry the inducement, tax and consumer-law risk this feature was scoped to avoid |
| Household seats                                           | Both      | Not yet                                    | D18 unspecified                                                                                                                                        |

---

## 6. Legal — what a reward programme changes

### 6.1 Inducement (US copyright)

The _Grokster_ rule: one who distributes a product **with the object of promoting its use to infringe**, shown
by clear expression or other affirmative steps to foster infringement, is liable for the resulting
infringement. Liability rests on **purposeful, culpable expression and conduct**.
([Inducement rule](https://en.wikipedia.org/wiki/Inducement_rule))

DMCA §512(c) requires, among other things, that the provider **not receive a financial benefit directly
attributable to the infringing activity** where it has the right and ability to control that activity.
([CRS R43436](https://www.congress.gov/crs_external_products/R/PDF/R43436/R43436.3.pdf))

**Assessment.** The design decisions above are what keep this on the right side of both:

- Rewards are restricted to **self-authored** recipes (`FR-001`) with a per-recipe **attestation**
  (`FR-002`) — the opposite of "affirmative steps to foster infringement".
- Rewards are **non-monetary and non-transferable** (`FR-007`), which keeps them away from the "direct
  financial benefit" prong.
- A takedown **reverses the specific grant** (`FR-016`) and repeat offenders lose eligibility (`FR-018`) —
  affirmative steps _against_ infringement, on the record.
- **This is why discovery placement is rejected** (§5): boosting the reach of rewarded uploads is the one
  candidate that both rewards volume and looks like deriving benefit from the uploads themselves.

**Not legal advice; counsel review is a prerequisite before launch.** The un-analysed exposure flagged in the
brief is now analysed to the level a spec can carry, and the conclusion is that the _shape_ of the programme
is defensible while the _rewarded set_ stays narrow.

### 6.2 Manipulative design (EU)

**DSA Art. 25 applies.** Providers of online platforms "shall not design, organise or operate their online
interfaces in a way that deceives or manipulates the recipients of their service or in a way that otherwise
materially distorts or impairs the ability of the recipients … to make free and informed decisions." Cited
examples include **making it difficult to cancel** and **false-urgency/countdown** patterns.
([DSA Library, Art. 25](https://dsa-library.com/article/25/))

> Directly relevant: an unpublish flow made harder than the publish flow is close to the paradigm Art. 25
> example. `FR-012` already requires one-action unpublish; `FR-029` below makes the symmetry explicit.

**The Digital Fairness Act is coming and names this class of mechanic.** The Commission proposal is expected
**Q4 2026**, covering dark patterns, **addictive design**, and unfair personalisation.
([European Parliament Legislative Train](https://www.europarl.europa.eu/legislative-train/theme-protecting-our-democracy-upholding-our-values/file-digital-fairness-act))
Mechanics deliberately built to be addictive today are the mechanics most likely to require removal within the
lifetime of this feature.

**EU AI Act Art. 5 does _not_ apply here — correcting an earlier assumption.** The prohibition on
manipulative techniques is scoped to **AI systems**; a non-AI reward mechanic falls outside it.
([Art. 5](https://artificialintelligenceact.eu/article/5/)) It would become live only if reward-driven ranking
or personalisation were AI-driven. Recorded so nobody re-imports it as a constraint that binds today, or
assumes it never could.

---

## 7. Residual risks carried into the spec

1. **Overjustification handoff (§2.5)** — the highest-severity systems risk. Recorded in `spec.md`.
2. **Cold-start recognition** — **RESOLVED 2026-08-22** by `FR-007l`'s first-publication milestone.
   Front-loaded slots (§3) were the original answer, but they only ever covered the free tier; a premium user
   had no on-ramp at all, which was the real defect. Recorded because the resolution came from the owner
   spotting the hole, not from this dossier — the evidence was here and the boundary drawn around it was wrong.
3. **The cook signal depends on cook/save events** existing at sufficient volume; on a small corpus most
   published recipes will show zero, which is a _discouraging_ signal. Needs a display rule for the zero case.
4. **Effect sizes are borrowed from other domains.** None of the cited studies is about recipes. The
   directions are well-supported; the magnitudes should be treated as hypotheses to instrument, not forecasts.
