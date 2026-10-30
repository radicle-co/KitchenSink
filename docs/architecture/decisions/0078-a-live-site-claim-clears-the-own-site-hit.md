# 0078: A live site claim clears the hit on a recipe's own origin page, and nothing else

- **Status:** Accepted
- **Date:** 2026-10-29
- **Amends:** [ADR-0077](0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md) §4, its false-positive rule
  for a blogger who imports their own posts. §4 said a hit on a page the cook calls their own "goes to a person", and
  that 012 owes a way to prove a site is yours. The proof now comes from 026's site claim, and a live claim clears that
  one hit. Every other part of §4 stands: the order of the checks, the web search for method sentences, its own
  budget, and the rule that an outside hit never blocks.
- **Relates to:** spec [020](../../../specs/020-content-source-check/spec.md) `020-FR-012g`, the rule this ADR
  records. Spec [026](../../../specs/026-chef-spaces/spec.md) `026-FR-001`, `FR-002` and `FR-005`: the claim, what it
  proves, and the clearing rule. Spec [016](../../../specs/016-legal-compliance-framework/spec.md) `FR-014`, the
  per-item attestation, and `FR-050`, the counsel list. [ADR-0074](0074-content-source-check.md) §2: only rules block,
  a model never clears a recipe, and a person decides what is left.
- **Drivers:** owner ruling, 2026-10-29, on 026 Q1: "Claim clears own-site hit". Option B, with counsel review before
  build. The ruling rests on a research note by the CLO agent of the same day, held outside the repository. It is
  research, not legal advice. The rule is subject to counsel review before it is built.

## Context

ADR-0077 §4 compares a recipe headed public with the page it was imported from. A blogger who imports their own posts
matches that page exactly, so they look like a copier. §4 sent every such hit to a person. It also named the missing
piece: a way to prove a site is yours, owed by 012.

Spec 026 builds that piece. A chef proves they control a website by a DNS record, a meta tag or a plugin token
(`026-FR-001`). The claim is checked again on a schedule, and a site has at most one live claim.

A claim proves control of a site. It does not prove that the chef wrote each recipe on it. A guest post, or a recipe
copied from elsewhere onto the chef's blog, passes a claim. `026-FR-002` says so, and it keeps the per-recipe
statement.

## Decision

### 1. A live claim clears one hit, and only that hit

When a recipe headed public matches its own import page, and that page is on a domain where the cook holds a live
claim, the match does not count as a copy. The check records that a claim cleared it, and which claim.

The clearing is narrow on purpose:

- **Own origin page only.** The matched page must be the page this recipe was imported from (ADR-0077 §4, step 1),
  on the claimed domain. A hit on any other page of the same site is not cleared by this rule.
- **Every other signal still goes to a person.** A hit on another site, a hit from the web search, a model item, and a
  photo signal all behave as ADR-0074 §2 and ADR-0077 §4 say. The claim touches none of them.
- **Rules still block.** The rule-based detectors still block. The claim is not a rule-based detector's input.

### 2. The claim is read as it stands

- **A claim that fails later** does not reopen a recipe the claim already cleared. The decision was true when it was
  made, and the recipe has not changed.
- **A new check after an edit** (`020-FR-001`) reads the claim as it stands then. A failed claim clears nothing.
- **Without a live claim**, a hit on a page the cook says is their own goes to a person, with the cook's statement
  shown. The statement never counts against the cook on its own. This is ADR-0077 §4 as it was written.

### 3. A claim is not authorship

The clearing removes one false alarm. It does not make the recipe the chef's. The controls for a guest post or a copy
on the chef's blog are the per-recipe statement (`004-FR-014a`), the rights label (`016-FR-015c` to `FR-015j`) and
takedown (`016-FR-016` to `FR-022`), as for any "I wrote this" recipe.

### 4. Counsel reviews this before it is built

`020-FR-012g` carries the same warning. The rule is in the spec and in this ADR, and it is not to be implemented
until counsel has confirmed it (`016-FR-050`).

## Consequences

- A blogger who claims their site and brings in their posts is not sent to a person for matching their own pages.
- The reviewer queue loses one predictable false positive.
- The check reads one more input, the claim, so its outcome record gains a field naming the claim that cleared a hit.
- The claim becomes part of what the content check depends on. A bad claim check would clear hits it should not.
- A copy that sits on a claimed domain passes this one hit, and is caught only by the other signals and by takedown.

## One-way doors

- **The outcome field that names the clearing claim.** It is part of the record a reviewer and an appeal read. Adding
  it later loses the evidence for every earlier clearing.
- **"Does not reopen."** Once a recipe is cleared and public, reopening it on a later claim failure would hide a
  public recipe from its readers, and that is a notice-and-action decision (`016-FR-016` and after), not a silent one.

## Residual risks

- **A claim proves control, not authorship.** A chef can claim a site, then import a copy of a competitor's recipe
  that a guest posted there. The own-origin hit clears. The per-recipe statement, the other signals and takedown are
  the only controls. Counsel confirms that this is enough.
- **A claim can be taken over.** If a domain changes hands, the new owner holds the claim until the next scheduled
  check. A recipe cleared in that window stays cleared. 026 has no plan yet, so the check interval is not set.
- **The own-origin page is trusted.** The matched page is the one we fetched at the chef's request. A page that
  changed after the claim is not re-read by this rule.

## Alternatives

- **Keep every own-site hit going to a person (ADR-0077 §4 as written).** Safe, and it queues every blogger's
  import for a person. At bulk-import volumes that is the cost 026 exists to remove.
- **Let a claim clear every hit for the chef.** A claim is not authorship, and it would clear a copy of someone else's
  page. Rejected.
- **Clear the hit on the cook's word alone ("this is my own page").** That is the loophole the check exists to catch.
  Rejected.
- **Let the model judge whether the page is the chef's.** ADR-0074 §2: a model never clears a recipe.
