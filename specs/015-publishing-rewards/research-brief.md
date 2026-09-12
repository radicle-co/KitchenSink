# 015 Publishing Rewards — Research Brief

**Status**: ⚠️ **SUPERSEDED for §1, §2 and §4 (2026-08-22)** — those sections are closed; the decisions now
live in [`spec.md`](./spec.md) and the evidence in
[`research/reward-psychology.md`](./research/reward-psychology.md). §3 is **partly** closed and survives as
open question **Q1** in the spec. Read this file for the reasoning that led to the questions; read `spec.md`
for what was decided.
**Created**: 2026-08-22 · **Superseded**: 2026-08-22
**Spec**: [`spec.md`](./spec.md) · **Checklist**: [`checklists/requirements.md`](./checklists/requirements.md)
**Origin**: [`docs/competitive/02-gap-analysis-and-strategy.md`](../../docs/competitive/02-gap-analysis-and-strategy.md) §3 (P2) and the ReciMe teardown

---

## Read this first — where we got to

**The idea.** Fill the public recipe corpus by _rewarding_ publication instead of _compelling_ it. Today
`001-FR-003` makes a free-tier user's own recipes public with no private option, which is a trust problem, a
weak monetisation lever, and exposed under GDPR Art. 25(2). Rewarding publication inverts the pressure: the
corpus fills with willing contributors, who are also the contributors worth having.

**The hazard the whole design turns on.** A reward for publishing is an **inducement** to publish, and inducing
people to publish content they do not own is exactly what creates contributory liability and can forfeit
safe-harbour protection. This is why `FR-001` restricts _earning_ to recipes the user authored — imported,
digitised, paid-source and cloned recipes may still publish where C-004 allows, they simply earn nothing.
**A version of this feature that rewarded any publication would be worse than no feature at all.** Every option
below must be tested against this.

### Decided — do not reopen without cause

| #   | Decision                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Replace, not coexist.** The free-tier privacy prohibition goes; publication becomes a rewarded opt-in. Rewards apply to **both tiers**. Never monetary.                              |
| 2   | **Eligibility floor = structural completeness.** Title, ≥1 ingredient with a resolved quantity, ≥1 step, servings, ≥1 time field.                                                      |
| 3   | **Free accounts start at 0 private slots.** A slot grant is **permanent** — never revoked for unpublishing, downgrade, or time. Only a takedown reverses the specific grant it earned. |
| 4   | **Free accounts ceiling at 50 private recipes**, however many slots are earned.                                                                                                        |
| 5   | **Two currencies**: private slots (free tier) and status/recognition (both tiers).                                                                                                     |
| 6   | Only recipes the publishing user **authored** may earn.                                                                                                                                |

---

## §1 — The reward schedule (✅ RESOLVED — `FR-007a`, `FR-010`)

> **Resolved**: front-loaded, mildly diminishing, terminating at the 50-recipe ceiling (2 slots each for
> publications 1–10, 1 each for 11–30, 1 per 2 for 31–70). Rate limit 3/day and 10/week. The schedule is the
> motivational instrument, the rate limit is the anti-farming control — deliberately not conflated.
> Evidence: [`research/reward-psychology.md`](./research/reward-psychology.md) §3. Original framing below.

**Question**: how many private slots does one qualifying publication grant, and how fast may they be earned?

`FR-007a` and `FR-010` both currently say UNDEFINED. Nothing can be planned or built until this is answered.

**Sub-questions:**

- **Linear or diminishing?** 1 slot per publication all the way to 50 is simple and legible. Diminishing
  returns (1 slot each for the first 10, then 1 per 3) resists farming but is harder to explain and weakens the
  incentive exactly where sustained contributors live.
- **Front-loaded?** A larger grant for the first publication buys a strong first-run moment and directly
  mitigates §3's problem. Costs anti-farming strength.
- **What earn-rate limit?** Per day, per week, or a rolling window? The purpose is to stop someone converting
  a burst of low-effort publications straight into the 50-recipe ceiling. Note it interacts with the existing
  import quota (`004-FR-022`), which is already specified as a per-user daily product allowance.
- **Does the ratio hold at the ceiling?** At 50 private recipes a free user stops earning slots. Do they keep
  earning _status_? (Almost certainly yes — otherwise the incentive dies for the most engaged free users.)

**Research to do**: how comparable products calibrate contribution-for-capability exchanges. Dropbox's
refer-for-space is the closest structural analogue (bounded, permanent, diminishing); Stack Overflow's
reputation-for-privilege ladder is the closest _behavioural_ one and is well documented.

---

## §2 — What "status and recognition" actually means (✅ RESOLVED — `FR-007e`–`FR-007h`)

> **Resolved**: three mechanics — the **cook signal** (aggregate evidence a real person made your recipe),
> **impact milestones** keyed on cooks and ratings rather than publication count, and a **coarse permanent
> standing ladder**. Visibility answered as **option 1, public profile with no rankings**: leaderboards are
> now forbidden by `FR-026`. Surface ownership goes to `012` (`FR-032`). Evidence:
> [`research/reward-psychology.md`](./research/reward-psychology.md) §4 and §2.2. Original framing below.

**Question**: `FR-007e` is a placeholder. What is the thing?

The owner's framing: _"leveraging human psychology that social media and GitHub leverages."_ GitHub does not
give contributors quota — it gives them a **profile that says who they are**: a contribution graph, star
counts, follower counts, a pinned set of work.

**Candidate mechanics, unranked:**

| Mechanic                       | Notes                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Public contribution profile    | Published recipes, aggregate stats. Closest to the GitHub analogue. Overlaps heavily with `012-creator-profiles` — decide whether this _is_ 012 or feeds it. |
| Ratings received (not given)   | Uses the shipped `001-FR-013` rating system. Quality signal rather than volume signal, which is the right incentive.                                         |
| Milestones / badges            | Permanent, non-consumable, cheap. Risk: badge inflation makes them meaningless.                                                                              |
| Contribution graph / streaks   | Strong habit lever. Also the most criticised mechanic in the genre — streaks punish absence and can drive junk contributions.                                |
| Featured / editorial placement | Highest-value recognition, but requires curation effort we may not have.                                                                                     |
| Follower counts                | Owned by `012-FR-013`–`FR-016`. Do not duplicate.                                                                                                            |

**Hard constraints it must fit** — these already exist and are not negotiable here:

- `012-FR-009`: follower **lists** must not be publicly visible; only the aggregate count.
- `012-FR-024`: analytics must be aggregated-only — no individual visitor identity or IP stored or surfaced.
- `NFR-004`: colour is never the sole conveyor of state; any badge or tier needs a text label.

**The visibility question, unresolved.** How much of a user's standing should other people see? Three
positions were drafted and never chosen:

1. **Public profile, no rankings** — identity and social proof without zero-sum competition. Fits 012's
   posture.
2. **Public profile + leaderboards** — strongest pull, and the most direct social-media lever. Also the single
   biggest driver of farming behaviour, and the hardest thing to walk back once shipped.
3. **Private to the user** — safest, but removes the actual mechanism. GitHub's graph works _because_ it is
   public.

The first draft of the spec put leaderboards in **Out of Scope**; that exclusion has been lifted to "open" but
not decided. **Decide this before writing `FR-007e`** — it determines the entire surface.

---

## §3 — The zero-slot start (⚠️ PARTLY RESOLVED — survives as spec question **Q1**)

> **Priced, not decided.** The mitigation "a small starting grant (1–3 slots)" now has direct evidence behind
> it: the endowed-progress effect roughly doubled completion in the canonical study (34% vs 19%) purely by
> pre-filling progress. That makes a head start the _higher-performing_ design as well as the fix for the
> first-publication toll — but it reverses the owner's explicit "start with 0" decision, so it is put back as
> **Q1** rather than taken unilaterally. Evidence:
> [`research/reward-psychology.md`](./research/reward-psychology.md) §1.2. Original framing below.

**The problem, recorded in the spec's risk note.** A free user's first authored recipe cannot be private. To
get any privacy they must first publish. That is far better than the paywall it replaces — the price is one
publication, payable immediately, not money — but it is a **reciprocity gate**, not an absence of one, and two
consequences follow:

1. **GDPR Art. 25(2) is only partly addressed.** The Article is about the _default_, and the default for a new
   user's own content is still public. What improved is that intervention no longer costs money.
2. **The sensitive-first-recipe case has no path.** Someone whose first authored recipe is a family recipe they
   typed in themselves (`user_created` — so C-004's private-only classes do not cover it, and `FR-007d` does
   not protect it) must publish something else first.

**Mitigations to price:**

- A small starting grant (1–3 slots) — kills the problem outright at a modest cost to the reciprocity signal.
- First N recipes private regardless of slots.
- A one-time "keep this private" allowance, granted on request rather than by default.
- Nothing — accept it, and make the exchange legible in the UI so it reads as a bargain rather than a wall.

**This is a deliberate owner decision, not a defect.** It is recorded so the next session prices it rather
than inherits it silently.

---

## §4 — Do two currencies reach far enough? (✅ RESOLVED — `FR-007k`)

> **Resolved, against the instinct.** Not by adding levers: recognition (which reaches everyone) plus early
> access and a contributor input channel. Discovery placement, premium trial time and anything monetary are
> **rejected** — discovery placement on two independent grounds, behavioural and legal. Stacking extrinsic
> rewards onto intrinsically motivated behaviour is what triggers the crowding-out now recorded as a risk in
> the spec. Evidence: [`research/reward-psychology.md`](./research/reward-psychology.md) §5 and §2.5.
> Original framing below.

**The owner's words: "I feel like we also might need more incentives — and not just for free tier people."**

**The structural gap.** Private slots are worthless to a premium user who already has unlimited privacy. So of
the two currencies, exactly one reaches premium — status. If status turns out to be weak, premium users have
no reason to contribute at all, and premium users are plausibly our _best_ contributors (more engaged, more
recipes, more likely to be serious cooks).

**Candidate additional incentives, to be evaluated against the inducement hazard:**

| Candidate                            | Reaches   | Inducement risk | Notes                                                                                                          |
| ------------------------------------ | --------- | --------------- | -------------------------------------------------------------------------------------------------------------- |
| Additional import allowance          | Both      | Low             | Already-specified quota (`004-FR-022`) varies by tier; easy to extend. Was the first draft's primary currency. |
| Early access to new features         | Both      | Very low        | Cheap, no new surface, no gaming value.                                                                        |
| Creator-profile eligibility          | Both      | Low             | Owned by `012`. Natural fit if 012 ships.                                                                      |
| Discovery placement for your recipes | Both      | **High**        | Directly rewards volume and is the classic driver of low-quality posting. Handle carefully.                    |
| Household seats                      | Both      | Low             | Only meaningful once household exists (D18, not specified).                                                    |
| Premium trial days                   | Free only | Medium          | Converts contribution into a paid-tier taste. Blurs the reward/paywall line.                                   |
| Tips eligibility                     | Both      | Medium          | Blocked portfolio-wide: `012-FR-034` and `013-FR-010` — no payout surface exists.                              |
| Nutrition depth / AI credits         | Both      | Low             | Depends on how D5's free/paid split lands.                                                                     |

**Open sub-questions:**

- Is there a **premium-specific** reward that is not just "more of what you already bought"?
- Should the two currencies be **linked** (status unlocks slots) or **independent**?
- Is there a **non-reward** motivator we are ignoring — reciprocity, identity, altruism — that needs no
  mechanic at all beyond making contribution visible?

---

## Research agenda — ✅ COMPLETED 2026-08-22

> Items 1, 3, 4 and 5 are done and written up in
> [`research/reward-psychology.md`](./research/reward-psychology.md). Item 2 (recipe/UGC platforms) was
> covered for **Cookpad**, which turned out to be the most valuable single find — its contributor culture rests
> on impact feedback rather than points, and that became `FR-007f`. Allrecipes, Food.com and Tasty were not
> reached and remain the one genuine gap; they are unlikely to change any decision above, since the mechanism
> question they would inform is already answered by stronger evidence.

### Original agenda

1. **Contribution-incentive mechanics that actually worked**, with evidence: Stack Overflow reputation,
   GitHub profile/graph, Dropbox refer-for-space, Wikipedia barnstars, Strava segments, Duolingo streaks. What
   drove sustained quality contribution versus volume farming, and what did each get wrong.
2. **Where recipe/UGC platforms have tried this** — Allrecipes, Cookpad (very strong contributor culture worth
   studying closely), Food.com, Tasty community. Cookpad is the most directly comparable and the least studied
   by us.
3. **Farming and gaming post-mortems** — how reward systems in UGC products were abused, and which controls
   held.
4. **Legal re-check on inducement specifically.** Everything so far has been about _hosting_ third-party
   content. A reward programme changes the analysis: it is closer to the inducement line (_Grokster_) than to
   passive hosting, and §512(c)(1)(B)'s "direct financial benefit … right and ability to control" prong
   deserves a fresh look now that we are deliberately incentivising uploads. **This was not analysed when the
   spec was written.**
5. **Whether §2's public-profile surface is 012 or 015.** Two specs must not both own a creator profile.

---

## Blockers and dependencies carried in

- **D4a / D4b** (`docs/competitive/02-gap-analysis-and-strategy.md`) — un-gating privacy from the paywall and
  making `imported_public` private-by-default. C-015-001 assumes D4a lands; if it does not, this feature
  inverts from a fix to an aggravation.
- **D5** — re-pricing. Removing the privacy paywall removes the free tier's only current paywall lever.
- **D24** — registered DMCA agent + repeat-infringer policy. `FR-016`–`FR-018` consume a takedown process that
  does not yet exist for the main recipe corpus.
- ⚠️ **Corrected 2026-08-22**: the licence gap below is **pre-existing**, not created by 015 — `001-FR-004`
  and `001-FR-005` already ship public read and clone. 015 amplifies it through inducement. The **takedown**
  process hard-blocks **US4 only**. Original wording retained below for the record.
- **The ToS content licence** — still missing portfolio-wide. We have no stated right to display or permit
  cloning of a user's recipe, which this feature depends on entirely.

---

## Session-restart checklist — superseded

> The restart path is now: read [`spec.md`](./spec.md) **Status**, answer **Q1–Q3**, then `/speckit-plan`.
> The original checklist follows for the record.

1. Read this file, then `spec.md`'s **Clarifications** and **Status** sections.
2. Confirm C-015-005 with the owner (derived by the spec, not stated by them).
3. Work §1 → §2 → §3 → §4 in order; §2's visibility decision gates the most downstream work.
4. Re-run the quality checklist; `FR-007a`, `FR-007e` and `FR-010` all carry UNDEFINED markers that must clear.
5. Only then `/speckit-clarify` or `/speckit-plan`.
