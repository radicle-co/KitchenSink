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
 * leaves out but its furniture ({@link isCardFurniture}: outside the read lines and beside no read list, an unnumbered
 * item with no leading amount that comes after the lines, or before them is a meta fact), so a schema missing a line,
 * an ingredient group or a second method is caught as surely as a page missing one. The per-card rule counts only list
 * items (`<li>`), so it does not see three kinds of line unless the schema reads a sibling of theirs: a table row
 * (`<tr>`, as in an ingredient or nutrition table), a paragraph or a `<br>`-separated line, and anything outside the
 * card, such as an ingredient group a theme renders after the card element. ⚠️ Nor does it see an omitted ingredient
 * group after the read lines when no line of it opens with an amount ("Salt to taste"), nor one after them nested a
 * level deeper than the read lists: accepted risks of the furniture policy, each pinned by a test. Text a cook cannot
 * see (a template, a `noscript`, a `textarea`, anything `hidden`, an inline `display:none`, a closed `<details>`, a
 * `<meta>`) is no part of the page; text hidden by a CSS class is, because a paste has no stylesheet to say so. A line
 * or step with no letter or digit never agrees. A recipe whose data the page does not show is a no, never a wrong yes
 * (precision first). It reads each step's RAW text (`schemaSteps`), never the built instruction, so a heading the
 * reader adds can never make a correct page disagree with itself.
 *
 * The same page text answers R3: a step's `name` is a heading only where the page shows it ({@link withShownStepNames}).
 */
import { readCooksMeasure } from '@kitchensink/recipe-core/parsing/measure-reader';

import { CARD_META_LABELS, type CardMetaKind, DURATION_JOINS, DURATION_WORDS } from './cardMetaLabels.js';
import { instructionOf } from './instructionSteps.js';
import type { ExtractionTier, PageCandidate, PageRecipe } from './pageRecipeCandidate.js';
import { namesAMeasure, tokensOf } from './pageTokens.js';
import type { CardItem, VisibleText, VisibleTextResult } from './visiblePageText.js';
import { YIELD_COUNT_WORDS } from './yieldCountWords.js';

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

/** A meta fact: its label, the text before its first colon (ASCII or full-width), bounded so the test is linear, and its value. */
const META_FACT = /^([^:\uFF1A]{1,40})[:\uFF1A]\s*(\S.*)$/su;

/** Whether `token` is part of a number: a run of digits, or the `.`, `,`, `/` or `-` that `tokensOf` keeps inside one. */
const isNumberPart = (token: string): boolean => /^\d/u.test(token) || ['.', ',', '/', '-'].includes(token);

/** Whether `tokens` are numbers and these words alone, with one number at least. */
const isNumbersWith = (tokens: readonly string[], words: ReadonlySet<string>): boolean =>
    tokens.some((token) => /^\d/u.test(token)) && tokens.every((token) => isNumberPart(token) || words.has(token));

/** Whether `value` is a number with at most one yield count word after it: "6", "4-6 people", "6 slices". */
function isCount(value: string): boolean {
    const tokens = tokensOf(value);
    const last = tokens.at(-1);
    const number = last !== undefined && YIELD_COUNT_WORDS.has(last) ? tokens.slice(0, -1) : tokens;

    return number.length > 0 && number.every(isNumberPart);
}

const DURATION_TOKENS: ReadonlySet<string> = new Set([...DURATION_WORDS, ...DURATION_JOINS]);

/** The value shape each label kind takes: a duration with one unit at least, a count, or text with no amount or measure. */
const VALUE_SHAPES: Readonly<Record<CardMetaKind, (value: string) => boolean>> = {
    time: (value) => {
        const tokens = tokensOf(value);

        return isNumbersWith(tokens, DURATION_TOKENS) && tokens.some((token) => DURATION_WORDS.has(token));
    },
    count: isCount,
    text: (value) => readCooksMeasure(value).quantity.kind === 'absent' && !namesAMeasure(value),
};

/**
 * Whether `text` is a meta fact: a label on the closed list ({@link CARD_META_LABELS}) and a value of the shape that label
 * takes. "Prep Time: 10 minutes" is one, "Prep Time: 2 eggs", "Calories: 2 eggs" and "Category: Flour 200 g" are not.
 */
function isMetaFact(text: string): boolean {
    const [, label, value] = META_FACT.exec(text) ?? [];
    const kind = label === undefined ? undefined : CARD_META_LABELS.get(label.trim().toLowerCase());

    return kind !== undefined && value !== undefined && VALUE_SHAPES[kind](value);
}

/**
 * The card's furniture: an unread list item of the card that is no part of the recipe the schema left out. An item is
 * never furniture when it is between the first line the schema reads and the last (an equipment list, an omitted
 * group), when its list sits beside a list the schema reads (a group the schema left out), when it is numbered (a
 * second method) or when it opens with an amount (an ingredient). Past those checks:
 * - an item after the last read line is furniture (notes, nutrition, related recipes);
 * - an item before the first read line is furniture only when it is a meta fact: a label on the closed list and a value
 *   of that label's shape ({@link isMetaFact}). Any other item there, a link ("Jump to recipe") included, may be an
 *   omitted group ("One onion", "Eggs: 2", "Мука: 200 г"), so the card is refused. A jump-link list is not tolerated: the
 *   reader's tree is not a browser's, so where a link goes cannot be vouched for (issue #349).
 * Any doubt is no.
 */
function isCardFurniture(item: CardItem): boolean {
    if (
        item.position === 'between' ||
        item.besideReadList ||
        item.ordered ||
        readCooksMeasure(item.text).quantity.kind !== 'absent'
    ) {
        return false;
    }

    return item.position === 'after' || isMetaFact(item.text);
}

/** G-CORR over a page's visible text: the card the cook reads is the ingredient lines and the steps, no more and no less. */
function pageShows(candidate: PageCandidate, text: VisibleText): Corroboration {
    const ingredients = candidate.recipe.ingredientLines.map(tokensOf);
    const steps = candidate.schemaSteps.map((step) => tokensOf(step.text));

    // Ingredients are whole lines, one visible block each (or several, joined): "flour" is not "2 cups flour". Both lists
    // are one card, so a list in it that neither reads (a group the schema leaves out) differs.
    const lookup = text.shows(
        [
            { runs: ingredients, wholeBlocks: true },
            { runs: steps, wholeBlocks: false },
        ],
        isCardFurniture,
    );

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
    const named = candidate.schemaSteps.some((step) => step.name !== undefined);
    const page = named ? visible() : undefined;

    if (page?.kind !== 'ok') {
        return candidate.recipe;
    }

    const shown = candidate.schemaSteps.map(
        (step) => step.name !== undefined && page.text.find(tokensOf(step.name), false) === 'found',
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
