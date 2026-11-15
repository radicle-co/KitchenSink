/**
 * Whether a page agrees with the structured data it carries: the one owner of "does the schema match what the page shows".
 *
 * DESIGN PATTERN: **Specification**, a composite of two named predicates run in order, over a candidate, the tier that read
 * it and the page. The gate (`recipeAcceptance.ts`) stays blind to the page and the strategies stay blind to both; this
 * stage sits between selection and the gate.
 *
 * | #       | Predicate                                                                                                   | Reason                    | Tier     |
 * | ------- | ----------------------------------------------------------------------------------------------------------- | ------------------------- | -------- |
 * | G-EMPTY | no `recipeInstructions` property the page declares holds no text (a paragraph a parser closed early)         | `declaredStepsEmpty`      | microdata |
 * | G-CORR  | the page has a `<body>`, and shows every ingredient line to the end of a visible block and every raw step     | `pageHasNoBody`, `pageDisagreesWithSchema` | JSON-LD |
 *
 * G-CORR exists because a site's JSON-LD is written for a search engine, and some sites let it drift from the card a cook
 * reads: a note cut off a line, a step missing, a base form where the page says "raisins". A recipe whose data the page
 * does not show is a no, never a wrong yes (precision first). It reads each step's RAW text (`schemaSteps`), never the
 * built instruction, so a heading the reader adds can never make a correct page disagree with itself.
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

/** G-CORR over a page's visible text: every ingredient line to a block end, every raw step anywhere. */
function pageShows(candidate: PageCandidate, text: VisibleText): Corroboration {
    const lines = candidate.recipe.ingredientLines.map((line) => ({ run: tokensOf(line), endsBlock: true }));
    const steps = candidate.schemaSteps.map((step) => ({ run: tokensOf(step.text), endsBlock: false }));

    for (const { run, endsBlock } of [...lines, ...steps]) {
        if (run.length === 0) {
            continue;
        }

        const lookup = text.find(run, endsBlock);

        if (lookup === 'overBudget') {
            return refusal('pageTooComplex');
        }

        if (lookup === 'absent') {
            return refusal('pageDisagreesWithSchema');
        }
    }

    return AGREES;
}

/**
 * Judge whether a page agrees with the recipe it carries.
 *
 * @param candidate - The one recipe selected from the page.
 * @param tier - Which strategy read it: JSON-LD is held to the page (G-CORR), microdata to its own markup (G-EMPTY).
 * @param visible - The page's visible text, read at most once (`memoizedVisibleText`).
 * @returns `{ ok: true }`, or the first predicate it fails. Pure.
 */
export function corroborate(
    candidate: PageCandidate,
    tier: ExtractionTier,
    visible: () => VisibleTextResult,
): Corroboration {
    if (tier === 'microdata') {
        return candidate.emptyDeclaredSteps ? refusal('declaredStepsEmpty') : AGREES;
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
