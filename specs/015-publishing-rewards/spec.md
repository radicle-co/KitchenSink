# Feature Specification: Publishing Rewards

**Feature Branch**: `015-publishing-rewards`
**Created**: 2026-08-21
**Status**: Draft — 3 clarifications open (see Status section)
**Evidence base**: [`research/reward-psychology.md`](./research/reward-psychology.md) · **History**: [`research-brief.md`](./research-brief.md)
**Input**: User description: "create a new feature, using the context from PR 91, on your idea about rewarding users who publish recipes or share them to public as long as it doesn't violate legal stuff"

## Dependencies

| Spec                                                        | Relationship                                                                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Required** — owns recipe visibility (`FR-003`), the public read (`FR-004`) and clone (`FR-005`) paths, and the C-004 policy            |
| [004-recipe-importing](../004-recipe-importing/spec.md)     | **Required** — owns the `sourceType` provenance vocabulary (`FR-011`), attribution (`FR-010`), attestation (`FR-014a`), quota (`FR-022`) |
| [002-user-auth](../002-user-auth/spec.md)                   | **Required** — every surface here is authenticated; account erasure cascades to this feature's records                                   |
| [010-subscriptions](../010-subscriptions/spec.md)           | **Referenced** — reward benefits are expressed as entitlements; this feature grants them without owning the tier model                   |
| [012-creator-profiles](../012-creator-profiles/spec.md)     | **Referenced** — creator-profile eligibility is one benefit this feature may grant; 012 owns the profile itself                          |

---

## Why this feature exists

The competitive review in [`docs/competitive/02-gap-analysis-and-strategy.md`](../../docs/competitive/02-gap-analysis-and-strategy.md)
established two facts that pull against each other:

1. **The public recipe corpus is a strategic asset.** It is the source of discovery, ratings, SEO and the
   creator surface — and the primary competitor deliberately has none, which caps them.
2. **Compelling publication is the wrong way to fill it.** Today `001-FR-003` makes a free-tier user's own
   recipes public with no private option, which is a trust problem, a poor monetisation lever, and exposed
   under GDPR Art. 25(2) (personal data must not, _by default_, be made accessible to an indefinite number of
   people without the individual's intervention).

**This feature resolves the tension by inverting the incentive: publishing is _rewarded_, never _compelled_.**
The corpus fills with willing contributors — who are also the contributors whose content is worth having.

### ⛔ The central hazard this specification is designed around

**A reward for publishing is an inducement to publish, and an inducement to publish content the user does not
own is precisely what creates contributory liability and can forfeit safe-harbour protection.** Paying
attention to this is not a compliance footnote — it is the primary design constraint, and it is why the
eligibility rules below are deliberately narrow. A version of this feature that rewarded _any_ publication
would be actively worse than no feature at all.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Earn by publishing a recipe I wrote (Priority: P1)

A cook who has written their own recipe chooses to publish it publicly. Before they confirm, the system shows
exactly what publishing will earn them and what it means (anyone signed in can read and clone it). They
attest that the recipe is their own work. On publication the benefit is granted immediately and appears in a
running record they can inspect. Nothing about their other recipes changes, and nothing they already had is
taken away.

**Why this priority**: This is the entire feature. It is the only path that is unambiguously safe legally, it
is the only path that grows the corpus with content we have the clearest right to host, and it delivers value
on its own with nothing else built.

**Independent Test**: Author a recipe, publish it, verify the stated benefit is granted, the record shows it,
and the recipe is readable by a second account.

**Acceptance Scenarios**:

1. **Given** a signed-in user who owns an unpublished recipe they authored, **When** they open the publish
   action, **Then** the system states the benefit that will be granted, states that published recipes are
   readable and cloneable by any signed-in user, and requires an explicit authorship attestation before the
   action can be confirmed.
2. **Given** the user confirms publication, **When** the recipe becomes public, **Then** the benefit is
   granted, a record of the grant is created, and the user can see both.
3. **Given** a recipe that does not meet the completeness floor, **When** the user attempts to publish it,
   **Then** publication is permitted but **no benefit is granted**, and the user is told which fields would
   make it eligible.
4. **Given** the user declines the attestation, **When** they attempt to confirm, **Then** publication does not
   proceed and no benefit is granted.

---

### User Story 2 - Unpublish freely, without losing what I earned (Priority: P1)

A user who published a recipe later decides they want it private again. They unpublish it in one action. The
recipe becomes private immediately. **The benefits they already earned are not taken back.** They are not
asked to pay, and they are not warned that they will lose anything, because they will not.

**Why this priority**: Equal to P1 because it is what makes the feature a _reward_ rather than a disguised
lock-in. If earned benefits evaporate on unpublishing, the user is once again coerced into staying public and
every trust and GDPR argument against the current rule reappears in a new costume. The feature is not correct
without this half.

**Independent Test**: Publish an eligible recipe, observe the benefit, unpublish, and verify the recipe is
private and the benefit balance is unchanged.

**Acceptance Scenarios**:

1. **Given** a user who has earned benefits from a published recipe, **When** they unpublish that recipe,
   **Then** the recipe becomes private, the benefit balance is unchanged, and no warning of forfeiture is
   shown at any point in the flow.
2. **Given** a user has unpublished a previously rewarded recipe, **When** they publish that same recipe
   again, **Then** no second benefit is granted for it.
3. **Given** a user with zero published recipes, **When** they use the product, **Then** every function that
   was available to them before publishing anything remains available.

---

### User Story 3 - Content I have no right to publish cannot earn (Priority: P1)

A user imports a recipe from a food blog, or digitises a page from a cookbook they own. They may keep it, cook
from it, plan with it and organise it. Where the provenance rules permit publication at all, publishing it
earns **nothing**. Where the provenance rules forbid publication, the option is not offered and the reason is
stated.

**Why this priority**: This is the anti-inducement control, and it is P1 because the feature is net-negative
without it. It must ship in the same release as User Story 1 — never after.

**Independent Test**: Import a recipe from a URL, attempt to publish, and verify that no benefit is granted;
digitise a cookbook page and verify publication is refused with a stated reason.

**Acceptance Scenarios**:

1. **Given** a recipe whose provenance is an imported public web source, **When** the user publishes it,
   **Then** the recipe publishes with its attribution intact and **no benefit is granted**, and the user is
   told why.
2. **Given** a recipe whose provenance is a physical copy or a paid source, **When** the user opens the
   publish action, **Then** publication is refused with the reason stated, and no benefit is granted.
3. **Given** a recipe cloned from another user's public recipe, **When** the cloner publishes it, **Then** no
   benefit is granted to the cloner.

---

### User Story 4 - A takedown removes the reward it earned (Priority: P2)

A rightsholder reports that a published recipe infringes their work. The recipe is unpublished. The benefit
that specific recipe earned is reversed, and the user is told what happened and how to appeal. A user who
repeatedly earns benefits from content that is taken down loses access to the programme.

**Why this priority**: P2 rather than P1 because the programme can launch safely without it only if launch
volume is small and takedowns are handled by hand. It becomes mandatory before any growth push, and it is what
keeps the incentive honest over time.

**Independent Test**: Publish an eligible recipe, record the grant, process a takedown against it, and verify
the recipe is unpublished and the specific grant is reversed while unrelated grants are untouched.

**Acceptance Scenarios**:

1. **Given** a published recipe that earned a benefit, **When** a valid takedown is actioned against it,
   **Then** the recipe is unpublished, that grant is reversed, unrelated grants are unaffected, and the user is
   notified with the reason and an appeal path.
2. **Given** a user who has had grants reversed for takedowns more than the permitted number of times,
   **When** they attempt to publish for reward again, **Then** they remain able to publish but are no longer
   eligible to earn, and they are told so.
3. **Given** a recipe with an unresolved takedown notice against it, **When** the reward grant would otherwise
   be made, **Then** the grant is withheld until the notice is resolved.

---

### User Story 5 - See that my recipe was actually cooked (Priority: P2)

A cook who published a recipe later opens it and sees that other people have made it — an aggregate count, and
the ratings it has received. Over time, that impact accrues into permanent milestones and a contributor
standing that appears on their profile. None of it can go down.

**Why this priority**: P2 to ship, P1 in importance — this is the only reward currency that reaches premium
users, and the only one with evidence of _durable_ effect. It is P2 solely because User Stories 1–3 are
shippable without it and it depends on cook/save events existing at volume. It MUST ship before the free-tier
slot schedule approaches its ceiling for any meaningful cohort, per `FR-007j`.

**Independent Test**: Publish an eligible recipe from account A, cook/save it from accounts B and C, and verify
account A sees an aggregate count of 2, sees no identifying information about B or C, and that the count and
any milestone earned never decrease.

**Acceptance Scenarios**:

1. **Given** a user with a published recipe that others have cooked, **When** they view it, **Then** they see
   an aggregate count and the ratings received, and **no** individual identity or visitor identifier.
2. **Given** a user who reaches an impact milestone, **When** the milestone is granted, **Then** it is
   permanent, carries a text label, and is never reduced by later inactivity or by another user overtaking
   them.
3. **Given** a free user who has reached the 50-recipe ceiling and can no longer earn slots, **When** they
   publish another qualifying recipe, **Then** no slot is granted and recognition continues to accrue.
4. **Given** any user, **When** they view any reward surface, **Then** no reward is shown as expiring, at
   risk, decaying, or lost, and no ranking against other users is shown.

---

### User Story 6 - I already keep everything private, and I still want to publish one (Priority: P2)

A user who has no need for slots — a premium account with unlimited privacy, or a free account that has
already earned all it needs — has never published. Nothing in the slot economy speaks to them. They see, in
their own account, an honest account of what they have taken from the public corpus, and an invitation to add
to it. Their first publication is recognised in its own right, immediately, without waiting for anyone else to
cook it.

**Why this priority**: This closes the structural gap that private slots cannot reach. Recognition is keyed on
**impact**, and impact requires an audience a first-time publisher does not yet have — so without this story a
user with unlimited privacy has a reward available in principle and **no route to it**. They are also
plausibly our best contributors: more engaged, more recipes, more likely to be serious cooks.

**Independent Test**: With a premium account holding only private recipes, verify the account can see its own
corpus usage, publishes one authored recipe, and receives recognition immediately — with no slot granted and
no difference in recognition from a free account doing the same.

**Acceptance Scenarios**:

1. **Given** a user who has never published, **When** they view their own account, **Then** they may see an
   aggregate of how many publicly published recipes they have cooked or saved, stated as fact, and **never**
   as a debt, an obligation, a balance owed, or a deficit.
2. **Given** any user regardless of tier, **When** they complete their **first** qualifying publication,
   **Then** recognition is granted immediately for that milestone alone, without requiring any other user to
   have cooked it.
3. **Given** a premium user and a free user who have published identical qualifying recipes, **When** their
   recognition is compared, **Then** it is identical — recognition MUST NOT differ by tier.
4. **Given** a premium user publishes a qualifying recipe, **When** the grant is evaluated, **Then** no
   private slot is granted (they have unlimited privacy) and this MUST NOT be presented to them as having
   earned nothing.

---

### Edge Cases

- **A user publishes the same recipe under three slightly different titles.** Near-duplicate publications by
  the same author MUST earn at most once; the later ones publish without reward and say why.
- **A user publishes, unpublishes and republishes the same recipe repeatedly.** A recipe earns at most one
  grant in its lifetime, regardless of how many times it is published.
- **A user publishes 200 recipes in an hour.** Grants are subject to a per-period cap; publication itself is
  not blocked, but grants beyond the cap are not made and the user is told when the cap resets.
- **A published recipe is edited after it earned.** The grant stands. Editing a published recipe never
  re-triggers a grant and never reverses one.
- **A recipe is deleted after it earned.** The grant stands (deletion is not a violation); the recipe leaves
  the corpus.
- **A user erases their account.** Every publication record and grant record for that user is erased with it;
  benefits are not transferable and simply cease.
- **The benefit being granted is one the user already holds** (e.g. they are already premium). The grant is
  still recorded, and applies when the overlapping entitlement ends.
- **A user attests authorship falsely and is later found out.** Handled as a takedown (User Story 4); the
  attestation record is what makes the case reviewable.
- **A published recipe has been cooked by nobody.** The zero state MUST NOT be presented as failure. On a
  small corpus most published recipes will legitimately sit at zero for a long time, and a discouraging zero
  is worse than no signal at all.
- **A user reaches the 50-recipe ceiling and keeps publishing.** Slots stop; recognition continues
  (`FR-007j`). The user is told the ceiling is reached and what lifts it, once — not on every subsequent
  publication.
- **A user's standing is derived from impact on a recipe that is later taken down.** The takedown reverses the
  grant for that recipe (`FR-016`); impact accrued from it MUST NOT continue to count toward standing.
- **Two users collude to cook each other's recipes.** Standing is coarse and monotonic by design (`FR-007h`)
  precisely so that marginal manipulation buys nothing; fine-grained scores are what reward collusion.
- **A recipe becomes ineligible between the eligibility check and the confirm** (e.g. provenance is corrected
  in another session). The confirm re-evaluates eligibility; the stale check never grants.

## Requirements _(mandatory)_

### Functional Requirements

**Eligibility — the anti-inducement core**

- **FR-001**: Only a recipe whose provenance records the publishing user as its **author** MAY earn a reward.
  Recipes imported from a public web source, from a physical copy, from a paid source, or cloned from another
  user MUST NOT earn a reward under any circumstances. Publication itself is governed by the existing
  visibility policy and is **not** changed by this feature; only _earning_ is restricted here.
- **FR-002**: Publication for reward MUST require an explicit, per-recipe authorship attestation recorded at
  the moment of publication, retained for the life of the publication, and available to a compliance reviewer.
  A blanket terms-level acceptance MUST NOT substitute for it.
- **FR-003**: Eligibility MUST be decided by a **single authoritative rule**, so that the eligibility a user is
  shown before confirming, the eligibility applied at confirmation, and the eligibility reported afterwards can
  never disagree.
- **FR-004**: Eligibility MUST be re-evaluated at the moment of confirmation. A grant MUST NOT be made on the
  basis of an earlier evaluation.
- **FR-005**: A recipe MUST earn **at most one** reward grant in its lifetime, regardless of how many times it
  is published, unpublished or republished.
- **FR-006**: Near-duplicate recipes published by the same user MUST earn at most one grant between them. The
  later publication MUST succeed and MUST state that no grant was made and why.

**Rewards — what is granted**

- **FR-007**: Rewards MUST be **non-monetary, non-transferable, and carry no cash value**. This feature MUST
  NOT create a balance that can be withdrawn, exchanged, gifted or sold. A private-recipe slot (`FR-007a`) is a
  **capability grant**, not a spendable balance: it cannot be moved between accounts or converted to anything.

**Reward currency 1 — private-recipe slots (free tier)** _(owner decision, 2026-08-22)_

- **FR-007a** _(schedule defined 2026-08-22; zero start re-affirmed by owner after review of the
  endowed-progress evidence)_: A free account MUST start with **zero** private-recipe slots, and each
  qualifying publication MUST grant slots according to this schedule:

    | Qualifying publication | Slots granted | Cumulative slots | Cumulative publications |
    | ---------------------- | ------------- | ---------------- | ----------------------- |
    | 1st – 10th             | 2 each        | 20               | 10                      |
    | 11th – 30th            | 1 each        | 40               | 30                      |
    | 31st – 70th            | 1 per 2       | 50               | 70                      |

    The schedule is **front-loaded** (a new contributor reaches a usable amount of privacy quickly) and
    **mildly diminishing** (sustained contributors are not punished, while bulk publication is not the fast
    path). It MUST terminate at exactly the `FR-007c` ceiling of 50, so that the schedule and the ceiling are a
    single fact that cannot disagree. Rationale and evidence:
    [`research/reward-psychology.md`](./research/reward-psychology.md) §3.

- **FR-007a-i**: The full schedule MUST be legible to the user before they publish — the current position, the
  slots the next publication will grant, and the ceiling. A user MUST NOT have to infer the rate from
  observed grants.
- **FR-007b**: A slot grant MUST be **permanent**. It MUST NOT be revoked when the earning recipe is
  unpublished, when the recipe is edited or deleted, when a subscription lapses, or through the passage of
  time. The **only** reversal permitted is `FR-016`'s takedown path, and it reverses only the grant earned by
  the recipe that was taken down. _(This supersedes the earlier per-period-cap framing: a permanent grant
  cannot be "consumed" or "freed", so the question of whether an unpublished recipe frees cap room is moot.)_
- **FR-007c**: A free account MUST NOT hold more than **50** private recipes in total, regardless of how many
  slots it has earned. Once the ceiling is reached, further slot grants MUST NOT be made, publication MUST
  still succeed, and the user MUST be told the ceiling is reached and what lifts it.
- **FR-007d**: Privacy that is **mandated by provenance** MUST NOT consume a slot. A recipe that is
  private-only for every tier under C-004 — imported from a physical copy or a paid source — is private
  because policy requires it, not because the user spent an earned slot, and MUST NOT count against `FR-007c`'s
  ceiling. Charging a user a slot for privacy they never chose would re-create the coercion this feature exists
  to remove.

**Reward currency 2 — status and recognition (both tiers)** _(owner decision, 2026-08-22)_

- **FR-007e** _(mechanics defined 2026-08-22)_: The system MUST also recognise qualifying publications
  through non-consumable **status and recognition**, available to **both** free and premium accounts. This is
  the only reward currency that reaches premium users, for whom private slots have no value. It comprises
  exactly three mechanics, `FR-007f` – `FR-007h`. Rationale and evidence:
  [`research/reward-psychology.md`](./research/reward-psychology.md) §4.

- **FR-007f — the cook signal**: An author MUST be able to see, **in aggregate**, how many people have cooked
  or saved each of their published recipes. This is the primary recognition mechanic: it is evidence that a
  real person used their work, which is the signal with the strongest evidence for sustained voluntary
  contribution. It MUST remain aggregate-only per `012-FR-024` — no individual identity, and no visitor
  identifier, is exposed to the author. **The counter MUST NOT be displayed at all until the recipe has at
  least one cook** (`C-015-019`). A zero shown from the moment of publication is an absence presented as a
  number, which on a young corpus is what most authors would see for weeks; suppressing it makes the first
  cook an event rather than a decrement from nothing. A view count MUST NOT be substituted as a stand-in,
  because views reward publication volume and would reintroduce the steering problem `FR-007g` exists to
  avoid.

- **FR-007g — impact milestones**: The system MUST grant permanent, non-consumable milestones keyed on
  **impact** — recipes cooked by other people, and ratings received — and MUST NOT grant any milestone keyed
  on **publication count**, with exactly one exception — `FR-007l`'s first-publication milestone, whose
  threshold of one cannot be farmed. A milestone threshold is a behavioural instruction, and the completeness floor
  (`C-015-002`) is deliberately structural rather than qualitative and therefore cheap to satisfy; a
  publication-count milestone would instruct users to manufacture floor-clearing filler. Milestones MUST carry
  a text label, never colour alone (`NFR-004`).

- **FR-007h — contributor standing**: The system MUST express a user's standing as a **small ladder of named,
  permanent tiers** derived from `FR-007g`'s impact signals — never as a fine-grained score, and never as a
  rank relative to other users. Coarse and monotonic standing resists the collusion attacks that fine-grained
  peer-voted scores reliably attract. Standing MUST be **publicly visible on the user's creator profile**
  (`C-015-018`), because public visibility is the half of the recognition mechanism that carries the effect —
  a standing only its owner can see is a private note, not recognition. It MUST be displayed **without any
  rank, position, percentile or comparison to another user** (`FR-026`), and the profile surface itself is
  owned by `012` (`FR-032`).

- **FR-007i — the ratchet principle** _(governing invariant)_: Every reward this feature grants MUST be
  **monotonic** — permanent once granted, never decaying with time, never reduced by inactivity, never
  relative to another user's standing, and never revocable except by `FR-016`'s takedown path. **No surface may
  display a reward as at risk, expiring, or lost.** This single invariant is what forecloses streaks,
  leaderboards, tier demotion, decaying scores and every loss-framed counter at once, each of which the
  research rejects independently. It is the testable form of "this is a reward, not a lock-in".

- **FR-007j — the handoff**: Recognition (`FR-007f` – `FR-007h`) MUST begin accruing from the **first**
  qualifying publication and MUST **continue accruing after the `FR-007c` ceiling is reached**, when slots have
  stopped. Private slots are a finite bootstrap that will run out by design; if recognition unlocked late or
  stopped at the ceiling, the moment a contributor stopped earning would be the moment their reason to
  contribute was withdrawn. See the recorded risk on overjustification below.

- **FR-007l — the first-publication on-ramp**: The system MUST grant recognition for a user's **first**
  qualifying publication, to every tier, immediately and independently of any impact signal. This is a
  deliberate and **narrow** carve-out from `FR-007g`'s prohibition on publication-count milestones: a
  threshold of exactly **one** cannot drive volume, because it can be reached only once. It exists because
  impact-keyed recognition requires an audience a first-time publisher does not have, which would otherwise
  leave every user — and every premium user permanently — with a reward they cannot begin to earn. No second
  publication-keyed milestone MUST exist at any threshold.

- **FR-007m — the reciprocity signal**: A user MUST be able to see, **in their own account only**, an
  aggregate of how much they have used the public corpus — the recipes published by other people that they
  have cooked, saved or cloned. This reaches a user for whom slots are worthless, because it appeals to
  fairness rather than to a benefit they do not need. It MUST be presented as **fact and as gratitude**, and
  MUST NOT be framed as a debt, a deficit, an imbalance, an obligation, a ratio, or anything a user could be
  behind on. It MUST NOT be repeated as a recurring prompt (`FR-031`), MUST NOT appear on any surface visible
  to another user, and MUST be dismissible. An invitation to publish alongside it is permitted; an implication
  that the user owes one is not.

- **FR-007n — recognition parity across tiers**: Recognition (`FR-007e` – `FR-007h`, `FR-007l`) MUST be
  identical for free and premium accounts, earned by the same acts on the same thresholds. Tier MUST NOT
  affect standing, milestones, or the cook signal. A premium user who publishes MUST NOT be told they earned
  nothing merely because no slot applies to them; what they earned is recognition, and that is what MUST be
  stated.

- **FR-007k — reaching premium**: Beyond `FR-007e`, the system MAY grant **early access to new features** and
  **eligibility for a contributor input channel**. It MUST NOT grant **discovery placement** for a user's own
  recipes as a reward, MUST NOT grant premium trial time as a reward, and MUST NOT grant anything monetary or
  monetary-equivalent. Discovery placement is rejected on two independent grounds: it rewards volume and so
  drives low-quality publication, and boosting the reach of rewarded uploads is the candidate most likely to
  read as a "financial benefit directly attributable" to them under the safe-harbour analysis.
- **FR-008**: The system MUST state the specific benefit a publication will grant **before** the user confirms,
  together with a plain statement of what publishing means: any signed-in user may read and clone the recipe.
- **FR-009**: Every grant and every reversal MUST be recorded in an append-only record that the owning user can
  inspect, showing what was granted, for which recipe, and when.
- **FR-010** _(rate defined 2026-08-22)_: Grants MUST be subject to a per-user **earn-rate limit** of **3
  grants per rolling 24 hours and 10 grants per rolling 7 days**, so that a large volume of publications in a
  short window cannot convert directly into the full `FR-007c` ceiling. Reaching the limit MUST NOT block
  publication; it MUST withhold the grant and state when earning resumes. _(This is a rate limit, not the
  lifetime cap: the lifetime ceiling is `FR-007c`'s 50 recipes.)_
  **The rate limit is the anti-farming control and the schedule is the motivational instrument — the two MUST
  NOT be conflated.** Loading anti-farming into the schedule (harsh diminishing returns) blunts the incentive
  where sustained contributors live, and is redundant against `FR-006`'s near-duplicate suppression. The daily
  component is deliberately consistent with `004-FR-022`'s existing daily import allowance. Rationale:
  [`research/reward-psychology.md`](./research/reward-psychology.md) §3.
- **FR-011**: A recipe MUST meet a stated **completeness floor** to be eligible. A recipe below the floor MUST
  still be publishable, MUST NOT earn, and the user MUST be told which fields would make it eligible.

**Non-coercion — what makes this a reward and not a lock-in**

- **FR-012**: Unpublishing MUST be available at any time, in one action, and MUST NOT reverse any grant already
  made. No surface may warn, imply or state that unpublishing forfeits earned benefits.
- **FR-013**: No core function MUST be conditioned on having published anything. A user who never publishes
  MUST retain every capability available to them before this feature existed.
- **FR-014**: The reward MUST NOT be the restoration of a capability the user would otherwise have. Rewards are
  **additive only**; this feature MUST NOT be implemented by removing something and selling it back.

**Non-manipulation — the constraints that keep this compelling rather than coercive**

> These are engineering constraints, not a values statement. The feature's central hazard is **inducement**
> (`FR-001`): the harder a mechanic pushes toward publication, the more pressure it puts on the one control
> that stops users publishing work they do not own. A mechanic that overrides judgment is precisely a mechanic
> that produces infringing uploads. DSA Art. 25 additionally prohibits interface designs that materially
> distort a user's ability to make free and informed decisions, and the Digital Fairness Act — proposal
> expected Q4 2026 — names addictive design directly. Evidence and citations:
> [`research/reward-psychology.md`](./research/reward-psychology.md) §2 and §6.

- **FR-025**: The system MUST NOT implement **streaks**, consecutive-period counters, or any mechanic whose
  value is lost by not acting within a period. Authoring an original recipe is a low-frequency, high-effort
  act; a streak pointed at it can only be satisfied by filler, and the closest analogue in the industry
  removed the mechanic for harm to contributors.
- **FR-026**: The system MUST NOT display **global or absolute rankings** of users against one another.
  Content creation follows a severe participation inequality, so an absolute ranking is a surface that tells
  the overwhelming majority of users they are nobody in order to motivate a minority small enough to reach
  individually.
- **FR-027**: The system MUST NOT use **artificial scarcity, countdown timers, false urgency, or
  limited-time framing** on any surface that asks a user to publish. The decision to publish is
  irreversible in effect — other users may have cloned it — and MUST be made unhurried.
- **FR-028**: Reward messaging MUST be **truthful and complete at the moment of the decision**: what is
  granted, what is not, and what publishing means. It MUST NOT overstate a benefit, imply a benefit that is
  not granted, or defer a material term to a surface the user has already passed.
- **FR-029**: The **unpublish** flow MUST be at least as easy to find and complete as the **publish** flow —
  no additional steps, no additional confirmations, no friction the publish path does not carry. An asymmetry
  here is the paradigm case of the interface pattern DSA Art. 25 prohibits.
- **FR-030**: Recognition MUST NOT be purchasable, giftable, or obtainable by any means other than the
  qualifying activity. A purchasable status signal is not a status signal.
- **FR-031**: This feature MUST NOT introduce notifications whose purpose is to prompt publication in order to
  gain or avoid losing a reward. Notifying a user that their work was _used_ (`FR-007f`) is recognition;
  prompting them that they are falling behind is the loss-framing `FR-007i` forbids.

**Boundary with creator profiles (012)**

- **FR-032**: This feature MUST own the **earning and the record** — eligibility, grants, impact signals and
  standing — and MUST NOT own the **public surface** that renders them. The creator profile belongs to `012`.
  Two specifications MUST NOT both own a creator profile. Where `012` has not shipped, standing is recorded
  and shown to the owning user, and becomes publicly visible when `012` provides the surface.

**Compliance and takedown**

- **FR-015**: A published recipe MUST carry its attribution wherever it is displayed, per the existing
  attribution rules.
- **FR-016**: When a publication is removed following a valid infringement notice, the recipe MUST be
  unpublished and the grant made for **that recipe** MUST be reversed. Unrelated grants MUST be unaffected.
- **FR-017**: A grant MUST be withheld while an unresolved infringement notice stands against the recipe, and
  released or cancelled when the notice is resolved.
- **FR-018**: A user whose grants are reversed for infringement more than a stated number of times MUST lose
  eligibility to earn. They MUST retain the ability to publish, to keep existing content, and to appeal.
- **FR-019**: The user MUST be notified of any reversal or loss of eligibility, with the reason and an appeal
  path.
- **FR-020**: Publication MUST remain an explicit, per-recipe, opt-in act. This feature MUST NOT introduce any
  bulk-publish, publish-by-default, or publish-on-import behaviour.

**Data and lifecycle**

- **FR-021**: A user's publication records and grant records MUST be erased when that user erases their
  account, and MUST NOT survive in any form that identifies them.
- **FR-022**: The record of an attestation MUST be retained for as long as the publication it supports, and
  MUST be erasable with the account per FR-021.

**Presentation**

- **FR-023**: Every surface introduced by this feature MUST ship on **both** web and mobile in the same
  release, per the portfolio parity rule.
- **FR-024**: Every user-facing string introduced by this feature MUST be localized through the shared
  localization path; no hard-coded user-visible literals.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript MUST compile with `strict: true`; no `any` used outside explicitly
  marked test doubles. (Constitution Principle I)
- **NFR-002**: All exported functions and interfaces MUST carry JSDoc documentation. (Principle II)
- **NFR-003**: Any UI component MUST expose an accessible name queryable via `getByRole`/`getByLabel`
  in Playwright tests. (Principles IV & VII)
- **NFR-004**: Color MUST NOT be the sole conveyor of state; icon or text label pairing required. (Principle VII)
- **NFR-005**: The attestation and the statement of what publishing means MUST be legible to a screen reader
  and MUST NOT rely on a modal that can be dismissed without being read by assistive technology.

### Key Entities

- **Publication**: The record that a specific recipe was made public by its owner at a specific time. Holds the
  authorship attestation, the eligibility decision made at that moment and its reason, and the current state
  (published, unpublished by owner, removed on notice).
- **Reward Grant**: An append-only record that a benefit was granted for a specific publication — what was
  granted, when, and whether it has since been reversed and why. Never transferable, never a balance that can
  be withdrawn.
- **Impact Signal**: The aggregate, non-identifying count of how many people cooked or saved a published
  recipe, and the ratings it received. The input to milestones and standing. Never resolves to an individual.
- **Contributor Standing**: A user's current named tier, derived from impact signals. Monotonic — it has a
  highest-ever value and no mechanism to fall. Recorded here, rendered by `012`.
- **Eligibility Decision**: The evaluated outcome of the eligibility rule for a recipe at a point in time —
  eligible, or ineligible with a stated reason. Shown before confirmation and re-evaluated at confirmation.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A user can go from opening a recipe they authored to a confirmed public publication in under
  60 seconds, including reading what they will earn and completing the attestation.
- **SC-002**: 100% of published recipes that earned a reward have a recorded authorship attestation. A
  publication with a grant and no attestation is a defect, not a data-quality issue.
- **SC-003**: 0% of rewards are granted for recipes whose provenance is imported or cloned, measured
  continuously rather than sampled.
- **SC-004**: A user can unpublish a recipe in one action, and their benefit balance after unpublishing is
  identical to before, in 100% of cases.
- **SC-005**: The share of the public corpus contributed by users who published voluntarily rises, while the
  share of users who report their recipes were made public without their intent falls to zero.
- **SC-006**: A takedown against a rewarded publication results in the recipe being unpublished and its grant
  reversed within one business day of the notice being actioned.
- **SC-007**: No user loses a capability they held before this feature shipped.
- **SC-008**: 0% of reward surfaces display a reward as expiring, at risk, decaying, or lost, and 0% display a
  ranking of one user against another — verified by assertion, not by review.
- **SC-009**: A user can state, without opening help, how many slots their next publication will earn and what
  the ceiling is.
- **SC-010**: The unpublish flow requires no more steps than the publish flow, measured as a count.
- **SC-011**: Among free users who reach the `FR-007c` ceiling, contribution does not fall below their
  pre-ceiling rate — the test that `FR-007j`'s handoff worked rather than merely being specified.
- **SC-012**: 0% of granted milestones are keyed on publication count, with the single deliberate exception of
  `FR-007l`'s first-publication milestone.
- **SC-013**: The share of **premium** accounts that have published at least one recipe rises. This is the
  test that the feature reaches users for whom private slots are worthless — the half the slot economy cannot
  reach by construction.
- **SC-014**: Recognition granted to a free account and a premium account for identical qualifying
  publications is identical in 100% of cases.
- **SC-015**: 0% of reciprocity-signal surfaces present corpus usage as a debt, deficit, imbalance or ratio,
  and none recurs after dismissal.

## Assumptions

- **The privacy gate is being removed in parallel.** This feature assumes a free-tier user can keep their own
  recipes private without paying — the change recommended as D4a in the competitive gap analysis. If that does
  not land, see the clarification below: rewarding publication while also charging for privacy would apply two
  simultaneous pressures to publish and would worsen, not improve, the Art. 25(2) position.
- **Rewards are non-monetary.** Monetary rewards, revenue share and payouts are out of scope and remain blocked
  portfolio-wide: `012-FR-034` states 012 must not compute revenue splits, hold balances or initiate
  disbursement, and `013-FR-010` is blocked on marketplace payments. Non-monetary benefits are the only
  currently buildable currency and also carry materially lower inducement, tax and consumer-law risk.
- **There are two reward currencies, doing different jobs** _(decided 2026-08-22)_: **private-recipe slots**
  for the free tier (direct, tangible, and something the contributor already wanted) and **status/recognition**
  for both tiers (the psychological lever, and the only one that reaches premium). Import allowance and
  creator-profile eligibility — the currencies assumed in the first draft — are **no longer the primary
  mechanism**; import allowance is deferred and creator-profile surface ownership moved to `012` (`FR-032`).
  The research pass **inverted the emphasis**: recognition is now the load-bearing currency and slots are the
  bootstrap, because purely symbolic recognition is the only mechanic in the evidence base with demonstrated
  _durable_ effect, while the slot supply is finite by construction. **Recognition is also the only currency
  that can reach a user who already has all the privacy they need** (`C-015-020`) — every premium account, and
  eventually every engaged free one.
- **Imported public recipes remain publishable but never rewardable.** This preserves attribution-carrying
  public content already permitted by the existing visibility policy while removing any incentive to import
  other people's work in order to earn.
- **Infringement notices are actioned by a human.** This feature consumes the outcome of a takedown process; it
  does not adjudicate claims.
- **A registered takedown agent and repeat-infringer policy exist by the time User Story 4 ships.** These are
  prerequisites for the safe-harbour posture this feature depends on and are tracked outside this spec.

## Out of Scope

- Monetary rewards, tips, payouts, revenue share, or any withdrawable balance.
- Adjudicating infringement claims, or any automated infringement detection.
- Changing the recipe visibility policy itself — owned by 001 and its C-004 rules.
- Changing subscription tiers or pricing — owned by 010.
- Creator profiles, follower graphs and discovery ranking — owned by 012.
- Rewarding any activity other than publishing a recipe (rating, cloning, commenting, referring).
- Monetising the status layer, or making recognition purchasable.

**Excluded on evidence, and now requirements rather than omissions** _(2026-08-22)_ — each is forbidden by a
numbered requirement, so the exclusion is testable rather than merely intended:

- **Streaks and consecutive-period counters** (`FR-025`).
- **Global and absolute leaderboards / user-versus-user rankings** (`FR-026`). This closes the question the
  first draft left open. The owner's direction — leverage the psychology social media and GitHub use — is
  honoured by making recognition **public** (`FR-007h`), which is the half of the GitHub mechanism that
  carries the effect; rankings are the half the evidence says is net-negative across a population where ~1% of
  users create content.
- **Publication-count milestones** (`FR-007g`) — they instruct users to publish more, not better.
- **Fine-grained peer-voted scores** (`FR-007h`).
- **Discovery placement, premium trial time, and anything monetary as a reward** (`FR-007k`).
- **Purchasable status** (`FR-030`).

---

## Clarifications

### Session 2026-08-22 — RESOLVED by owner

- **C-015-001 — Q1 answered: REPLACE.** Free users get privacy; the free-tier privacy _prohibition_
  (`001-FR-003`) goes away and publication becomes a rewarded opt-in. **Rewards apply to BOTH tiers**, are
  never monetary, and are meant to work through the same psychology social media and GitHub use.
- **C-015-002 — Q2 answered: structural completeness.** A recipe earns only if it has a title, at least one
  ingredient with a resolved quantity, at least one step, servings, and at least one time field. Objective and
  testable, with no human in the loop. The bar can be raised later without breaking anything already granted.
- **C-015-003 — Q3 is MOOT, and resolved in the non-coercive direction.** The old question ("do grants for
  unpublished recipes still consume the per-period cap?") assumed a consumable balance. **A slot grant is
  permanent** (`FR-007b`), so nothing is consumed and nothing is freed. What survives from the old cap is a
  separate **earn-rate limit** (`FR-010`), which is a different control with a different purpose.
- **C-015-004 — Free accounts start at ZERO private slots** (`FR-007a`), and are ceilinged at **50 private
  recipes** (`FR-007c`).
- **C-015-005 — Privacy mandated by provenance never costs a slot** (`FR-007d`). A cookbook scan or paid-source
  recipe is private because C-004 requires it. Spending a user's earned slot on privacy they did not choose
  would re-create the coercion this feature exists to remove. _(Derived by this spec from C-015-004, not
  stated by the owner — flag for confirmation.)_
- **C-015-006 — Two currencies, not one.** Private slots reach the free tier; status and recognition reach
  everyone, and are the **only** lever that reaches premium, for whom slots are worthless.

### Session 2026-08-22 (part 2) — resolved by research

Evidence base: [`research/reward-psychology.md`](./research/reward-psychology.md).

- **C-015-007 — the reward schedule is defined** (`FR-007a`): front-loaded (2 slots each for the first ten
  publications), mildly diminishing, terminating at exactly the 50-recipe ceiling. The schedule is the
  motivational instrument; `FR-010`'s rate limit (3/day, 10/week) is the anti-farming control. Conflating the
  two blunts the incentive where sustained contributors live.
- **C-015-008 — "status and recognition" is three mechanics, not a badge system** (`FR-007f`–`FR-007h`): the
  **cook signal** (aggregate evidence a real person made your recipe), **impact milestones** keyed on cooks and
  ratings, and a **coarse permanent standing ladder**. Purely symbolic, human-sourced recognition is the
  mechanic with the strongest evidence for durable contribution — stronger than any quota or points system.
- **C-015-009 — milestones key on impact, never on publication count** (`FR-007g`). A threshold is a
  behavioural instruction, and our completeness floor is structural rather than qualitative and therefore cheap
  to clear; a publication-count threshold would reliably manufacture filler.
- **C-015-010 — the ratchet principle** (`FR-007i`): every reward is monotonic — permanent, non-decaying,
  never rank-relative, never displayed as at risk. One invariant that forecloses streaks, leaderboards,
  demotion and loss-framing simultaneously, and is testable where a values statement would not be.
- **C-015-011 — leaderboards are REJECTED, closing the question the first draft left open** (`FR-026`).
  Public recognition is adopted; public _ranking_ is not. Rankings motivate a small top tier and demotivate
  everyone below, and with ~1% of users creating content that trade is not close.
- **C-015-012 — streaks are REJECTED** (`FR-025`). Frequency mismatch (nobody authors an original recipe
  daily, so a streak can only be fed with filler) and loss-framing. The closest industry analogue removed the
  mechanic over contributor harm.
- **C-015-013 — one strong currency beats three weak ones for premium** (`FR-007k`). Recognition plus early
  access and a contributor input channel; discovery placement, premium trial time and anything monetary are
  rejected. Stacking further extrinsic levers onto intrinsically motivated behaviour is what causes the
  crowding-out recorded below.
- **C-015-014 — 015 owns the earning, 012 owns the surface** (`FR-032`). Resolves the standing question of
  whether the contribution profile is 015 or 012: it is 012, fed by 015.
- **C-015-015 — EU AI Act Art. 5 does NOT bind this feature**, correcting an assumption made in session. Its
  manipulation prohibition is scoped to **AI systems**. **DSA Art. 25 does bind**, and the Digital Fairness
  Act (proposal expected Q4 2026) names addictive design directly. `FR-025`–`FR-031` are written against those
  two, not against the AI Act.
- **C-015-016 — the inducement analysis flagged as missing is now done** to the level a spec can carry
  ([`research/reward-psychology.md`](./research/reward-psychology.md) §6). Conclusion: the programme's shape is
  defensible while the rewarded set stays narrow and non-monetary — which is what `FR-001`, `FR-002`, `FR-007`,
  `FR-016` and `FR-018` already enforce. It is **also the reason discovery placement is rejected**, since
  boosting the reach of rewarded uploads is the candidate most likely to read as a financial benefit
  attributable to them. Counsel review remains a launch prerequisite.

### Session 2026-08-22 (part 3) — the three research questions answered by owner

- **C-015-017 — the zero-slot start STANDS** (`FR-007a`). The owner reviewed the endowed-progress evidence
  (a pre-filled head start raised completion 34% vs 19% in the canonical study) and **re-affirmed 0 starting
  slots**. This is a deliberate decision taken with the counter-evidence in hand, not an oversight: the
  reciprocity bargain is kept at its cleanest — privacy is earned, never given. **Do not re-open it in a
  future session on the basis of the endowed-progress finding; that argument has been made and declined.**
  The recorded risk below is therefore **accepted**, not outstanding, and its two consequences — a partial
  Art. 25(2) answer and the sensitive-first-recipe case — are live and known.
- **C-015-018 — contributor standing is PUBLIC on the creator profile** (`FR-007h`). Public, because
  recognition that only its owner can see is not recognition; **without rank or comparison**, because
  `FR-026` forbids that independently. Surface owned by `012` (`FR-032`).
- **C-015-019 — the cook counter is HIDDEN until the first cook** (`FR-007f`). No zero state is ever
  rendered, and a view count is explicitly not substituted in its place, since views reward volume and would
  reintroduce the steering problem `FR-007g` exists to prevent.

### Session 2026-08-22 (part 4) — incentivising users who already have privacy

- **C-015-020 — the slot economy cannot reach a user who already has privacy, and recognition alone did not
  either.** Raised by the owner: private-holding users — every premium account, and any free account sitting
  on earned slots — must be incentivised to publish too. Recognition was already specified to reach both tiers
  (`C-015-006`), but it is keyed on **impact**, and impact requires an audience a first-time publisher does
  not have. The result was a reward that reached premium users in principle with **no route to it in
  practice**; the free tier's on-ramp is front-loaded slots, which are worth nothing to them. Three
  requirements close it:
    - **`FR-007l`** — the first qualifying publication is recognised on its own, for every tier, with no impact
      required. A narrow carve-out from `FR-007g`, safe because a threshold of one cannot be farmed.
    - **`FR-007m`** — an honest, private, non-recurring account of what the user has taken from the public
      corpus. This is the only lever that speaks to someone who needs no benefit, because it appeals to fairness
      rather than reward. Bounded hard against debt, deficit and obligation framing — the difference between
      reciprocity and a guilt prompt is exactly the difference between `FR-007m` and a dark pattern.
    - **`FR-007n`** — recognition is identical across tiers, and a premium publisher is never told they earned
      nothing merely because no slot applies.
    - Tested by `SC-013`–`SC-015`; covered by **User Story 6**.

### ⚠️ Recorded risk — the zero-slot start re-introduces a first-publication toll

`FR-007a` means a free user's **first authored recipe cannot be private**. To earn any privacy at all they must
first publish something publicly. This is materially better than the paywall it replaces — the price is one
publication rather than money, and it is payable immediately — but it is **not** the same as "free users get
privacy," and it should be understood as a **reciprocity gate**, not an absence of one.

Two specific consequences to weigh before implementation:

1. **GDPR Art. 25(2) is only partly addressed.** The Article is about the _default_, and the default here is
   still public for a new user's own content. The mitigation is that intervention no longer requires payment —
   but it does still require an act of publication.
2. **The sensitive-first-recipe case has no path.** A user whose first authored recipe is the one they least
   want public (a family recipe they typed themselves — `user_created`, so C-004's private-only classes do not
   cover it) must publish something else first. `FR-007d` protects cookbook _scans_, not typed-in family
   recipes.

**Status: PRICED AND ACCEPTED (2026-08-22).** The mitigations were researched, evidenced and put to the
owner as Q1; the owner re-affirmed the zero start with the evidence in hand (`C-015-017`). This risk is
therefore **an accepted consequence of a deliberate decision**, not an open item — and it must not be quietly
re-opened as though it were a defect.

### ⚠️ Recorded risk — overjustification, and the cliff at the ceiling

**This is the highest-severity systems risk in the feature and it is structural, not a defect to fix.**

Expected, salient, contingent extrinsic rewards for behaviour that is _already intrinsically motivated_ are
shown to reduce intrinsic motivation; when the reward is withdrawn, engagement can settle **below** its
original baseline, and the reward must then be sustained indefinitely to hold the behaviour up. Sharing
recipes is intrinsically motivated for many cooks. Private slots are exactly such a reward — and they are
**finite by design**: they terminate at the `FR-007c` ceiling.

So the feature contains a scheduled moment where its primary free-tier incentive stops permanently. If nothing
durable has taken over by then, the ceiling is not a cap — it is a **cliff**, and the most engaged free
contributors hit it first.

`FR-007j` is the mitigation: recognition must start at the first publication and must keep accruing past the
ceiling, so the handoff from bootstrap to durable motivation happens while the contributor is still engaged.
`SC-011` is the test that it actually worked. **This is the reason User Story 5 cannot be deferred
indefinitely**, notwithstanding its P2 label.

_Evidence: [`research/reward-psychology.md`](./research/reward-psychology.md) §2.5._

### Session 2026-08-21 — superseded

The three questions raised on 2026-08-21 (replace-vs-coexist, eligibility floor, cap consumption) are all
resolved above. Their original option tables are retained in git history.

---

## Related: feature 016 shares this feature's D4a assumption

[016-legal-compliance-framework](../016-legal-compliance-framework/spec.md) was created 2026-08-22 (C-016-003)
and its amendment to `001-FR-005b` **removes the premium gate on making a clone private**, citing D4a and this
feature's `C-015-001` as the authority for doing so. Three consequences for 015:

- **D4a is now load-bearing for two features, not one.** If it does not land, 016's amendment to `001-FR-005`
  is stranded alongside this feature's premise.
- **016 owns the takedown process this feature's `FR-016`–`FR-018` consume.** That was previously an
  assumption ("a registered takedown agent and repeat-infringer policy exist by the time User Story 4
  ships"); it now has a specification behind it — `016-FR-016`–`FR-026` — and `016-FR-023` explicitly
  propagates an actioned notice into this feature's reward ledger, which is the same coupling from the other
  side.
- **The inducement gap this feature's research brief flagged is now recorded.** `016-FR-029a` forbids pricing
  or gating a paid tier on access to imported third-party content, for exactly the §512(c)(1)(B)
  direct-financial-benefit reason the brief raised.

---

## Status: READY FOR `/speckit-plan`

Every open question is closed. The four areas the previous session left open were resolved with evidence
([`research/reward-psychology.md`](./research/reward-psychology.md)), and the three forks that evidence could
not settle alone were put to the owner and answered (`C-015-017` – `C-015-019`). **No `[NEEDS CLARIFICATION]`
markers and no UNDEFINED values remain.**

| Area                                                                 | State                             |
| -------------------------------------------------------------------- | --------------------------------- |
| Privacy model, slot permanence, 50-recipe ceiling, eligibility floor | ✅ Decided (session 1)            |
| Reward schedule — slots per publication, earn-rate limit             | ✅ Decided (`FR-007a`, `FR-010`)  |
| Status & recognition — what it is, where it appears, who sees it     | ✅ Decided (`FR-007e`–`FR-007h`)  |
| Incentives that reach premium                                        | ✅ Decided (`FR-007k`)            |
| Anti-manipulation constraints                                        | ✅ Decided (`FR-025`–`FR-031`)    |
| Ownership boundary with 012                                          | ✅ Decided (`FR-032`)             |
| Zero-slot start                                                      | ✅ Priced, accepted (`C-015-017`) |

### ⛔ Blocking a launch decision — not this spec's to resolve, and not closed by planning

These were carried in from the competitive analysis and remain open. `/speckit-plan` can proceed; **shipping
cannot**, and the last one is the hardest:

- **D4a / D4b** — un-gating privacy from the paywall, and making `imported_public` private-by-default. This
  feature assumes D4a lands; if it does not, rewarding publication _while_ charging for privacy applies two
  simultaneous pressures and worsens the Art. 25(2) position rather than improving it.
- **D5** — re-pricing. Removing the privacy paywall removes the free tier's only current paywall lever.
- **D24** — registered takedown agent and repeat-infringer policy. `FR-016`–`FR-018` consume a takedown
  process that does not yet exist for the main recipe corpus.
- **The ToS content licence** — still missing portfolio-wide. We have no stated right to display a user's
  recipe or to permit others to clone it, and this feature depends on both entirely.
- **Counsel review of the inducement posture** — the analysis in
  [`research/reward-psychology.md`](./research/reward-psychology.md) §6 is as far as a specification can
  responsibly go.
