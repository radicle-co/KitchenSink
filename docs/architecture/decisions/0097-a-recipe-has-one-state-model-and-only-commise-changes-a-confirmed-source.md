# 0097: A recipe has one state model, and only Commise changes a confirmed source answer

- **Status:** Accepted
- **Date:** 2026-11-19
- **Supersedes:** [ADR-0089](0089-a-pasted-web-link-sets-the-source-and-a-web-copy-stays-private.md) §6: the statement
  stays editable before and after the first publish, and its list of locks. Only Commise changes a confirmed answer
  (Decision 3).
- **Supersedes:** [ADR-0093](0093-imported-recipes-go-public-only-as-a-commise-written-version.md) §8, that sentence
  only: the statement "stays editable, also after the first publish".
- **Supersedes:** [ADR-0095](0095-a-recorded-source-is-kept-and-a-recipe-is-public-only-with-a-statement.md) §3, that
  sentence only: the cook can "state, change or clear" the statement also after the first publish. Also §4, the
  sentences that let the cook correct a book source or replace "From another person". Where an ADR for the
  "From another person" lock is already on the base, it supersedes that sentence, and this ADR supersedes only the book
  sentence.
- **Supersedes:** [ADR-0093](0093-imported-recipes-go-public-only-as-a-commise-written-version.md) §5, for the cook's own
  rewrite only: a paid-site recipe goes public only as a Commise-written page. A cook's own rewrite that passes the
  check can also go public as "Adapted by you" (Decision 2).
- **Supersedes:** [ADR-0072](0072-bulk-recipe-import.md) §9, the Label column of the statement and label table.
- **Supersedes:** [ADR-0077](0077-recipe-rights-label-linked-cards-and-outside-copy-checks.md) §1, the label table and
  its authority bullet (seven labels; one label for book and paid site; the clone label). §2, the rules that an import
  is never relabelled and a rewrite of an import is a new recipe, the line that a family recipe can go public, and the
  table's Label column. Its "Adapted stays `user_created`, with a credit" line is replaced: "Adapted by you" is derived.
- **Supersedes:** [ADR-0082](0082-recipes-are-an-open-library-of-facts-cooks-words-and-gated-public-domain.md) §9, that
  ruling only: an accepted rewording suggestion makes the recipe "Adapted by you".
- **Amends:** [ADR-0095](0095-a-recorded-source-is-kept-and-a-recipe-is-public-only-with-a-statement.md) §2: evidence
  of a web page, book or paid-site source holds a recipe off Public until the rewritten fact is earned.
- **Amends:** [ADR-0082](0082-recipes-are-an-open-library-of-facts-cooks-words-and-gated-public-domain.md) §1 and §5: a
  recipe from another person is private for now.
- **Amends:** [ADR-0023](0023-curator-declared-provenance.md) §1b, the sentence on the current label: the cook's
  one-way downgrade starts only from a confirmed "I wrote this". Where an ADR for the "From another person" lock is
  already on the base and amends it, this ADR narrows the rest.
- **Relates to:** [ADR-0082](0082-recipes-are-an-open-library-of-facts-cooks-words-and-gated-public-domain.md) §9: a
  private bulk import is usable at once, and only going public waits for review. That is the rule here too, and it is
  why the public check runs only on a recipe going public. [ADR-0073](0073-free-tier-private-slots.md) §11: a recipe
  that is not approved becomes private and uses a slot, over the limit if need be. [ADR-0038](0038-authored-food-withdrawal.md):
  the clause-level `Supersedes:` form. [ADR-0058](0058-never-published-drafts-record-no-version.md): the first
  publish. [ADR-0074](0074-content-source-check.md): the public check.
- **Drivers:** owner rulings of 2026-11-19, cited below by their deciding answer.

## Context

Recipe labels grew one feature at a time. The specs and ADRs now state the same facts in different words. Some
names mean two things. Some rules contradict each other. The code stores one fact in three columns. The owner asked for
every label to be inventoried, for the duplicates to go, and for the labels to come from one transition graph with every
state and every valid transition written down. Seven rulings of 2026-11-19 also reverse text in the ADRs above. The
reversed text cannot be edited in place, because an accepted ADR is not edited.

## Decision

1. **The model is the authority.** [The recipe state model](../recipeStateModel.md) defines every axis, value, stored
   form, derived fact, transition, label, refusal reason and retired name. Its value file, `recipeStateModel.json`,
   holds the same values, labels, refusal reasons and retired names for a later guard. Specs and ADRs cite the model and
   do not restate it. The model changes by pull request. This ADR records the decision and the rulings, which do not
   change.
2. **Rulings, as product behaviour.**
    - A paid-site recipe can go public as the cook's own "Adapted by you" version when our review finds the edits
      sufficient. An AI rewrite of it is the Commise-written page (owner, "Both").
    - An Adapted web page or book recipe goes public in its own words after the check (owner, "Yes, after the check").
    - A recipe from another person stays private for now (owner, "Private for now").
    - After a kept AI rewrite, the recipe keeps its source label and shows a line under the steps saying so. It never
      shows "Adapted by you" or the ownership line for those steps (owner, "Source + AI line (Rec.)"). The same holds for
      an accepted rewording suggestion (owner, "Yes, same rule (Rec.)"). A third-party recipe with AI steps goes public
      only as the Commise-written page, and a CC BY grant never covers AI-written steps.
    - The public check runs only on a recipe going public (owner, "No review if private (Rec.)").
    - An Adapted import stays the same recipe (owner, "Same recipe (Rec.)").
    - There is one label per meaning. Book and paid website have one label each. The clone line replaces the old shared
      clone label.
3. **Only Commise changes a confirmed source answer** (owner, "Only we can change a label - not a user"). The cook's
   first answer to a recipe with no answer is the cook's own. An answer is confirmed by an explicit cook act that
   submits it: the source sheet's confirm, the first publish (a private publish included), or a Save of a published
   recipe. A background checkpoint never confirms, so the Source row of a never-published draft stays the cook's to
   change. The citation is part of the locked answer. After the confirm, only Commise changes the origin: the system by
   a rule (the rewritten fact), or staff. A staff change is recorded with who, when, the old and new origin and the
   reason. It never deletes an evidence row and never opens Public by itself. The cook's "clear" is withdrawn.
    - **The one exception** is the cook's one-way downgrade (owner, "Yes, keep it (Rec.)"). A confirmed "I wrote this"
      can still be changed by the cook to a book or a paid website, with a citation, private only, and there is no edge
      back. ADR-0023 §1b narrows to that. The model's origin table has the row.
4. **The paid-site lock.** A paid-website recipe stays `paidSite` when the rewritten fact is earned. "Adapted by you" is
   derived. The one origin it moves to is `book`. The event is the cook asking, with evidence. The actor is Commise:
   staff, or the system for a paid site that Commise knows hosts a cookbook. The guard is that the fact is earned, and
   that either the site hosts a cookbook or the evidence shows the recipe is from one (owner, 2026-11-19, on the paid-site
   lock; and ruling 3).
5. **Origin is a logical value set** (`own`, `webPage`, `book`, `paidSite`, `person`, `publicDomain`, `commiseWritten`,
   `unstated`) until its own ADR replaces the three columns with one field.

## Consequences

- **The code does not match yet.** `sourceIsCorrectable` (`packages/shared/recipe-core/src/sourceRules.ts`),
  `evaluateSourceCorrection` (`packages/services/recipe-service/src/recipes/domain/sourceCorrectionPolicy.ts`) and the
  editor's Source row still let the cook change or clear an answer. A staff correction route does not exist. The model's
  "Enforced on main" column says so for each edge.
- **Follow-up order.** Board P7 comes first: the lock on "From another person". Today a cook can replace it with
  "I wrote this", which leaves no evidence row, so the recipe can then go public. Board P8 follows: the every-answer lock
  and the staff correction route, together, in one plan and one release. No launch build ships the lock without the
  route. P8 keeps the one downgrade open and tests it. Board P4 follows with the difference check and the paid-site
  unlock.
- The lock change flips signed editor and policy tests, so it needs a recorded test change.
- Copy, label keys and the guard that reads the JSON are separate work. The label keys in the JSON are placeholders.
- Nothing is live, so no data moves.

## Alternatives considered

- **Two ADRs, one for the locks and one for the labels.** Rejected: the locks are transitions of the one graph, and two
  ADRs give two places to read it.
- **The model in the ADR body.** Rejected: an accepted ADR is not edited, and the model will change.
- **Lock only the paid site.** Rejected by ruling 3: every confirmed answer is locked.
- **Lock at every saved write.** Rejected: a pasted link would lock about ten seconds after typing stops, with no act by
  the cook. Evidence rows already hold Public, so an earlier lock gains no safety.
