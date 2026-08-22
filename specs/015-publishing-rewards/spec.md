# Feature Specification: Publishing Rewards

**Feature Branch**: `015-publishing-rewards`
**Created**: 2026-08-21
**Status**: Draft
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
  NOT create a balance that can be withdrawn, exchanged, gifted or sold.
- **FR-008**: The system MUST state the specific benefit a publication will grant **before** the user confirms,
  together with a plain statement of what publishing means: any signed-in user may read and clone the recipe.
- **FR-009**: Every grant and every reversal MUST be recorded in an append-only record that the owning user can
  inspect, showing what was granted, for which recipe, and when.
- **FR-010**: Grants MUST be subject to a per-user, per-period cap. Reaching the cap MUST NOT block
  publication; it MUST withhold the grant and state when the cap resets.
- **FR-011**: A recipe MUST meet a stated **completeness floor** to be eligible. A recipe below the floor MUST
  still be publishable, MUST NOT earn, and the user MUST be told which fields would make it eligible.

**Non-coercion — what makes this a reward and not a lock-in**

- **FR-012**: Unpublishing MUST be available at any time, in one action, and MUST NOT reverse any grant already
  made. No surface may warn, imply or state that unpublishing forfeits earned benefits.
- **FR-013**: No core function MUST be conditioned on having published anything. A user who never publishes
  MUST retain every capability available to them before this feature existed.
- **FR-014**: The reward MUST NOT be the restoration of a capability the user would otherwise have. Rewards are
  **additive only**; this feature MUST NOT be implemented by removing something and selling it back.

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

## Assumptions

- **The privacy gate is being removed in parallel.** This feature assumes a free-tier user can keep their own
  recipes private without paying — the change recommended as D4a in the competitive gap analysis. If that does
  not land, see the clarification below: rewarding publication while also charging for privacy would apply two
  simultaneous pressures to publish and would worsen, not improve, the Art. 25(2) position.
- **Rewards are non-monetary.** Monetary rewards, revenue share and payouts are out of scope and remain blocked
  portfolio-wide: `012-FR-034` states 012 must not compute revenue splits, hold balances or initiate
  disbursement, and `013-FR-010` is blocked on marketplace payments. Non-monetary benefits are the only
  currently buildable currency and also carry materially lower inducement, tax and consumer-law risk.
- **The benefit currency is drawn from existing entitlements** — for example additional import allowance under
  the existing per-user quota, or eligibility for a creator profile. This feature grants entitlements; it does
  not invent a new one.
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
- Leaderboards, public rankings, or any surface that displays one user's earnings to another.

---

## Clarifications

### Session 2026-08-21 — OPEN, awaiting owner decision

The three questions below are **unresolved**. Each is recorded here rather than guessed, because each lacks a
defensible default and each changes the shape of the feature. **Q1 blocks `/speckit-plan`** — the feature's
premise depends on it. Q2 and Q3 block implementation but not planning.

> **Q1: Does this feature replace the current privacy paywall, or sit alongside it?**
>
> **Context**: `001-FR-003` currently makes free-tier users' own recipes public with no private option, and
> `010-FR-041` sells private visibility as a premium capability. This feature's entire rationale is that
> publication should be _pull_ (rewarded) rather than _push_ (compelled).
>
> **What we need to know**: Is the free-tier privacy prohibition being lifted in the same release?
>
> | Option | Answer                                                                       | Implications                                                                                                                                                                    |
> | ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | A      | **Replace** — free users get privacy; publishing becomes the rewarded opt-in | Cleanest incentive, resolves the GDPR Art. 25(2) exposure, removes the trust problem. Removes the free tier's current paywall lever, so `010` must re-price in the same change. |
> | B      | **Alongside** — privacy stays premium and publishing also earns              | Two simultaneous pressures to publish. Worsens the Art. 25(2) position and muddies the reward signal. Cheapest to ship; hardest to defend.                                      |
> | C      | **Sequence** — ship rewards first, lift the privacy gate in a later release  | Lets the reward mechanics be validated before the pricing change, but leaves the coercive default in place meanwhile, which is the risk being fixed.                            |
> | Custom | Provide your own answer                                                      |                                                                                                                                                                                 |

> **Q2: What is the eligibility floor for a published recipe to earn?**
>
> **Context**: `FR-011` requires a stated completeness floor, but the height of that bar is the difference
> between a corpus worth having and a farm for junk publications.
>
> **What we need to know**: What must a recipe contain to be reward-eligible?
>
> | Option | Answer                                                                                                                       | Implications                                                                                                                                             |
> | ------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | A      | **Structural completeness only** — title, ≥1 ingredient with a resolved quantity, ≥1 step, servings, at least one time field | Objective, testable, no human in the loop, cheap. Gameable by a determined farmer, but the per-period cap bounds the damage.                             |
> | B      | **Structural plus a photo**                                                                                                  | Materially raises quality and makes farming costlier. Excludes legitimate text-only contributors and interacts with the "don't copy source photos" rule. |
> | C      | **Structural plus a community signal** — earns only after N distinct views or a first rating                                 | Best corpus quality; delays gratification, which weakens the incentive, and creates a cold-start problem for new users.                                  |
> | Custom | Provide your own answer                                                                                                      |                                                                                                                                                          |

> **Q3: Does an unpublished-but-rewarded recipe keep counting toward the per-period cap?**
>
> **Context**: `FR-005` gives a recipe one grant for life and `FR-012` forbids clawback on voluntary
> unpublishing. A user could publish, earn, unpublish, and repeat with new recipes.
>
> **What we need to know**: Should grants for recipes that are no longer public still consume the cap?
>
> | Option | Answer                                                                        | Implications                                                                                                                                        |
> | ------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
> | A      | **Yes** — the cap counts grants made, regardless of current publication state | Simplest and unambiguous; a user cannot cycle content to earn faster. Slightly penalises someone who genuinely changed their mind.                  |
> | B      | **No** — the cap counts currently-public rewarded recipes                     | Rewards sustained contribution rather than one-off publication. Creates a soft pressure to stay public, which is in tension with `FR-012`'s intent. |
> | Custom | Provide your own answer                                                       |                                                                                                                                                     |
