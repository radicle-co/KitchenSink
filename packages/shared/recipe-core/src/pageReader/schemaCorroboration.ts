/**
 * Whether a page agrees with the structured data it carries: the one owner of "does the schema match what the page shows".
 *
 * DESIGN PATTERN: **Specification**, a composite of two named predicates run in order, over a candidate, the tier that read
 * it and the page. The gate (`recipeAcceptance.ts`) stays blind to the page and the strategies stay blind to both; this
 * stage sits between selection and the gate.
 *
 * | #       | Predicate                                                                                                                         | Reason                                     | Tier      |
 * | ------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------- |
 * | G-EMPTY | no `recipeInstructions` property the page declares holds no text (a paragraph a parser closed early)                               | `declaredStepsEmpty`                       | microdata |
 * | G-CORR  | the page has a `<body>`, and its visible card is the schema both ways: every line and step, and no line or step the schema lacks  | `pageHasNoBody`, `pageDisagreesWithSchema` | both      |
 *
 * G-CORR exists because a site's structured data is written for a search engine, and some sites let it drift from the card
 * a cook reads: a note cut off a line, a step or an ingredient missing, a base form where the page says "raisins". It is
 * two-way (`VisibleText.shows`): each ingredient line is a whole visible line (it starts and ends where a visible block
 * does, so "flour" is not "2 cups flour"), the steps are read in order, a list the lines sit in has no line the schema
 * leaves out, and the recipe CARD (the smallest element holding every line and step read) has no list item the schema
 * leaves out, so a schema missing a line, an ingredient group or a second method is caught as surely as a page missing
 * one. A list built of paragraphs rather than list items is checked per list only. Text a cook cannot
 * see (a template, a `noscript`, a `textarea`, anything `hidden`, an inline `display:none`, a closed `<details>`, a `<meta>`)
 * is no part of the page; text hidden by a CSS class is, because a paste has no stylesheet to say so. A line or step with no
 * letter or digit never agrees. A recipe whose data the page does not show is a no, never a wrong yes (precision first). It
 * reads each step's RAW text (`schemaSteps`), never the built instruction, so a heading the reader adds can never make a
 * correct page disagree with itself.
 *
 * The same page text answers R3: a step's `name` is a heading only where the page shows it ({@link withShownStepNames}).
 */
import { instructionOf } from './instructionSteps.js';
import type { ExtractionTier, PageCandidate, PageRecipe } from './pageRecipeCandidate.js';
import { tokensOf } from './pageTokens.js';
import type { VisibleText, VisibleTextResult } from './visiblePageText.js';

/** Why the page and its structured data are not taken together as one recipe. */
export type CorroborationReason =
    | 'declaredStepsEmpty'
    | 'pageHasNoBody'
    | 'pageDisagreesWithSchema'
    /** The page is too big, too deep or too repetitive to check a recipe against. */
    | 'pageTooComplex';

/** The stage's answer. */
export type Corroboration = { readonly ok: true } | { readonly ok: false; readonly reason: CorroborationReason };

const AGREES: Corroboration = Object.freeze({ ok: true });

const refusal = (reason: CorroborationReason): Corroboration => Object.freeze({ ok: false, reason });

/** G-CORR over a page's visible text: the card the cook reads is the ingredient lines and the steps, no more and no less. */
function pageShows(candidate: PageCandidate, text: VisibleText): Corroboration {
    const ingredients = candidate.recipe.ingredientLines.map(tokensOf);
    const steps = candidate.schemaSteps.map((step) => tokensOf(step.text));

    // Ingredients are whole lines, one visible block each (or several, joined): "flour" is not "2 cups flour". Both lists
    // are one card, so a list in it that neither reads (a group the schema leaves out) differs.
    const lookup = text.shows([
        { runs: ingredients, wholeBlocks: true },
        { runs: steps, wholeBlocks: false },
    ]);

    if (lookup === 'overBudget') {
        return refusal('pageTooComplex');
    }

    return lookup === 'differs' ? refusal('pageDisagreesWithSchema') : AGREES;
}

/**
 * Judge whether a page agrees with the recipe it carries.
 *
 * @param candidate - The one recipe selected from the page.
 * @param tier - Which strategy read it: microdata is also held to its own markup (G-EMPTY); both are held to the page (G-CORR).
 * @param visible - The page's visible text, read at most once (`memoizedVisibleText`).
 * @returns `{ ok: true }`, or the first predicate it fails. Pure.
 */
export function corroborate(
    candidate: PageCandidate,
    tier: ExtractionTier,
    visible: () => VisibleTextResult,
): Corroboration {
    if (tier === 'microdata' && candidate.emptyDeclaredSteps) {
        return refusal('declaredStepsEmpty');
    }

    const page = visible();

    if (page.kind === 'noBody') {
        return refusal('pageHasNoBody');
    }

    return page.kind === 'tooComplex' ? refusal('pageTooComplex') : pageShows(candidate, page.text);
}

/**
 * R3 under D5: the recipe with each step's own name written in front of it, for the names the page shows.
 *
 * @param candidate - The candidate that passed {@link corroborate}.
 * @param visible - The page's visible text, as for {@link corroborate}.
 * @returns `candidate.recipe` itself when no name is shown; otherwise a recipe whose steps carry the names the page shows
 *   (a name the page does not show is dropped, and so is every name on a page that cannot be read). Pure.
 */
export function withShownStepNames(candidate: PageCandidate, visible: () => VisibleTextResult): PageRecipe {
    const named = candidate.schemaSteps.some((step) => step.heading === undefined && step.name !== undefined);
    const page = named ? visible() : undefined;

    if (page?.kind !== 'ok') {
        return candidate.recipe;
    }

    const shown = candidate.schemaSteps.map(
        (step) =>
            step.heading === undefined &&
            step.name !== undefined &&
            page.text.find(tokensOf(step.name), false) === 'found',
    );

    return shown.some(Boolean)
        ? Object.freeze({
              ...candidate.recipe,
              steps: Object.freeze(
                  candidate.schemaSteps.map((step, index) =>
                      Object.freeze({ instruction: instructionOf(step, shown[index] === true) }),
                  ),
              ),
          })
        : candidate.recipe;
}
