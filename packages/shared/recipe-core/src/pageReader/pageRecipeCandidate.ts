/**
 * A recipe read from a page, and the one place that turns a schema.org Recipe node into one.
 *
 * DESIGN PATTERN: **Value Object**. A {@link PageRecipe} is frozen and has no identity beyond its fields, and a
 * {@link RecipeExtraction} is a union (a TypeScript discriminated union with an exhaustive `switch` IS the Visitor), so a
 * caller handles every outcome or does not compile. JSON-LD and microdata both end here, so a rule about a field (what a
 * `recipeYield` means, how a time is read) has ONE home.
 *
 * ⛔ A value the page does not state is ABSENT, never made up: the import holds such an item for the cook (ADR-0072 §3).
 * No image is read: fetching one is a server fetch, and photos are protected (ADR-0082).
 *
 * The shape is recipe-core's own and plain on purpose. `@kitchensink/schema-recipe` depends on this package, so this
 * package cannot import its `importRecipeSchema`; the caller parses a {@link PageRecipe} with it, which is the check that
 * a recipe's size and step limits hold.
 */
import { recipeCuisineSchema, recipeDescriptionSchema } from '../recipeRequestBounds.js';
import { MAX_RECIPES_PER_PAGE } from './pageCaps.js';
import { collapseBracketGroups } from './collapseBracketGroups.js';
import { instructionOf, instructionSteps } from './instructionSteps.js';
import type { SchemaStep } from './instructionSteps.js';
import { creditOf, imageRefsOf } from './pageEvidence.js';
import type { PageCredit } from './pageEvidence.js';
import { durationMinutes } from './isoDuration.js';
import { servingsOf } from './recipeYield.js';
import { readCooksMeasure } from '../parsing/measureReader.js';
import { asList, field, isSchemaNode, scalar, textOf } from './schemaNode.js';
import type { SchemaNode } from './schemaNode.js';

/** One step of a read recipe. */
export interface PageRecipeStep {
    readonly instruction: string;
}

/** A recipe as a page states it. Assignable to the service's `ImportRecipe` when its limits hold. */
export interface PageRecipe {
    readonly title: string;
    readonly description?: string;
    readonly cuisine?: string;
    readonly servings?: number;
    readonly prepTimeMinutes?: number;
    readonly cookTimeMinutes?: number;
    readonly totalTimeMinutes?: number;
    readonly ingredientLines: readonly string[];
    readonly steps: readonly PageRecipeStep[];
}

/** Which strategy read a recipe: the page's JSON-LD, or its microdata. The gate's thresholds are held per tier. */
export type ExtractionTier = 'jsonLd' | 'microdata';

/** One recipe node, read. Not yet judged: the gate (`recipeAcceptance.ts`) decides whether it can be sent. */
export interface PageCandidate {
    readonly title: string;
    /** Its identity for de-duplication: `@id`, else `url`, else name. */
    readonly key: string;
    readonly recipe: PageRecipe;
    /** The addresses the recipe node itself names (`url`, `mainEntityOfPage`), for selection and source detection. */
    readonly links: readonly string[];
    /** Who the node credits. */
    readonly credit: PageCredit;
    /** The image addresses as written, to be resolved against the canonical address. Never fetched. */
    readonly imageRefs: readonly string[];
    /** The steps as the structured data states them, raw: what the page is asked to agree with, never the built text. */
    readonly schemaSteps: readonly SchemaStep[];
    /** Whether a `recipeInstructions` property the page declares holds no text (a paragraph a parser closed early). */
    readonly emptyDeclaredSteps: boolean;
}

/** What one strategy found on a page: nothing, or every candidate it read, in page order. */
export type RecipeExtraction =
    | { readonly kind: 'none' }
    | { readonly kind: 'candidates'; readonly tier: ExtractionTier; readonly candidates: readonly PageCandidate[] };

const NONE: RecipeExtraction = Object.freeze({ kind: 'none' });

/** A string the node states, trimmed, or `undefined`. */
function rawString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The addresses a node names for itself: `url`, then `mainEntityOfPage` (a string, or a node with an `@id` or a `url`). */
function linksOf(node: SchemaNode): readonly string[] {
    const page = scalar(field(node, 'mainEntityOfPage'));
    const pageLink = isSchemaNode(page)
        ? (rawString(scalar(field(page, '@id'))) ?? rawString(scalar(field(page, 'url'))))
        : rawString(page);

    return [rawString(scalar(field(node, 'url'))), pageLink].flatMap((link) => (link === undefined ? [] : [link]));
}

/** R2: whether a line is a heading for the lines under it: it ends in a colon and states no amount ("FILLING:"). */
function isHeadingLine(line: string): boolean {
    const last = line.charAt(line.length - 1);

    return (last === ':' || last === '\uFF1A') && readCooksMeasure(line).quantity.kind === 'absent';
}

/** R5: one trailing comma off an ingredient line (some pages write every line that way). */
function withoutTrailingComma(line: string): string {
    return line.endsWith(',') ? line.slice(0, -1).trimEnd() : line;
}

/** R1: a title without a trailing " Recipe", when something is left ("Best Chili Recipe" is "Best Chili"). */
function titleWithoutRecipe(name: string): string {
    const suffix = ' recipe';
    const stem =
        name.length > suffix.length && name.toLowerCase().endsWith(suffix)
            ? name.slice(0, -suffix.length).trimEnd()
            : '';

    return stem === '' ? name : stem;
}

/** The lines of a list-valued field, one level of nesting flattened (microdata gives a list of blocks). */
function linesOf(value: unknown): readonly string[] {
    return asList(value)
        .flatMap((item) => (Array.isArray(item) ? (item as readonly unknown[]) : [item]))
        .flatMap((item) => {
            const text = textOf(item);
            const line = text === undefined ? undefined : withoutTrailingComma(collapseBracketGroups(text));

            return line === undefined || line === '' || isHeadingLine(line) ? [] : [line];
        });
}

/** The first non-blank cuisine, in its one canonical spelling. */
function cuisineOf(value: unknown): string | undefined {
    for (const item of asList(value)) {
        const text = textOf(item);
        const parsed = text === undefined ? undefined : recipeCuisineSchema.safeParse(text);

        if (parsed?.success === true) {
            return parsed.data;
        }
    }

    return undefined;
}

/** `key: value` only when the value is stated. */
function stated<K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } {
    return value === undefined ? {} : ({ [key]: value } as { readonly [P in K]?: V });
}

function candidateOf(node: SchemaNode): PageCandidate | undefined {
    const name = textOf(field(node, 'name'));

    if (name === undefined) {
        return undefined;
    }

    const ingredientLines = linesOf(field(node, 'recipeIngredient') ?? field(node, 'ingredients'));
    const steps = instructionSteps(field(node, 'recipeInstructions'));

    if (ingredientLines.length === 0 && steps.length === 0) {
        return undefined;
    }

    const id = rawString(scalar(field(node, '@id')));
    const links = linksOf(node);
    const key =
        id !== undefined
            ? `id:${id}`
            : rawString(scalar(field(node, 'url'))) !== undefined
              ? `url:${links[0] ?? ''}`
              : `name:${name}`;
    const description = textOf(field(node, 'description'));
    const title = titleWithoutRecipe(name);
    const recipe: PageRecipe = {
        title,
        ...stated(
            'description',
            description !== undefined && recipeDescriptionSchema.safeParse(description).success
                ? description
                : undefined,
        ),
        ...stated('cuisine', cuisineOf(field(node, 'recipeCuisine'))),
        ...stated('servings', servingsOf(field(node, 'recipeYield'))),
        ...stated('prepTimeMinutes', durationMinutes(scalar(field(node, 'prepTime')))),
        ...stated('cookTimeMinutes', durationMinutes(scalar(field(node, 'cookTime')))),
        ...stated('totalTimeMinutes', durationMinutes(scalar(field(node, 'totalTime')))),
        ingredientLines: Object.freeze(ingredientLines),
        steps: Object.freeze(steps.map((step) => Object.freeze({ instruction: instructionOf(step, false) }))),
    };

    return {
        title,
        key,
        recipe: Object.freeze(recipe),
        links: Object.freeze(links),
        credit: creditOf(node),
        imageRefs: Object.freeze(imageRefsOf(node)),
        schemaSteps: Object.freeze(steps.map((step) => Object.freeze(step))),
        emptyDeclaredSteps: asList(field(node, 'recipeInstructions')).some(
            (declared) => !isSchemaNode(declared) && textOf(declared) === undefined,
        ),
    };
}

/**
 * Every recipe in a list of Recipe nodes, in page order.
 *
 * A node with no title, or with neither ingredients nor steps, is not a recipe and is passed over. The same recipe written
 * twice (a block repeated, or a node in `@graph` and again on its own) counts once, by its `@id`, else its `url`, else its
 * name (two with different `@id`s and one name stay two). Nothing is judged here: which candidate the page is about is
 * `selectCandidate`'s, and whether it can be sent is `acceptRecipe`'s.
 *
 * @param nodes - Recipe nodes: JSON-LD objects, or microdata items shaped like them.
 * @param tier - The strategy that read them.
 * @returns The candidates, or `none` when there is no recipe node. Pure.
 */
export function extractionOf(nodes: readonly SchemaNode[], tier: ExtractionTier): RecipeExtraction {
    const seen = new Set<string>();
    const candidates: PageCandidate[] = [];

    for (const node of nodes.slice(0, MAX_RECIPES_PER_PAGE)) {
        const candidate = candidateOf(node);

        if (candidate !== undefined && !seen.has(candidate.key)) {
            seen.add(candidate.key);
            candidates.push(Object.freeze(candidate));
        }
    }

    return candidates.length === 0
        ? NONE
        : Object.freeze({ kind: 'candidates', tier, candidates: Object.freeze(candidates) });
}
