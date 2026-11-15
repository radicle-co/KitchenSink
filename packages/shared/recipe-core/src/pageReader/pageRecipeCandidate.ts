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
import { PARSE_JOB_LINE_MAX_CHARS, MAX_PARSE_JOB_LINES } from '../parsing/parseJobText.js';
import { recipeCuisineSchema, recipeDescriptionSchema, recipeTitleSchema } from '../recipeRequestBounds.js';
import { instructionSteps } from './instructionSteps.js';
import { durationMinutes } from './isoDuration.js';
import { servingsOf } from './recipeYield.js';
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

/** Why a recipe was found but cannot be sent. */
export type UnusableReason = 'titleTooLong' | 'tooManyIngredientLines' | 'ingredientLineTooLong';

/** What one strategy found on a page. */
export type RecipeExtraction =
    | { readonly kind: 'none' }
    | {
          readonly kind: 'found';
          readonly recipe: PageRecipe;
          /** The addresses the recipe node itself names (`url`, `mainEntityOfPage`), for source detection. */
          readonly links: readonly string[];
      }
    | { readonly kind: 'several'; readonly titles: readonly string[] }
    | { readonly kind: 'unusable'; readonly reason: UnusableReason };

/** One recipe node, read: its identity for de-duplication, and either the recipe or why it cannot be one. */
type Candidate =
    | {
          readonly ok: true;
          readonly title: string;
          readonly key: string;
          readonly recipe: PageRecipe;
          readonly links: readonly string[];
      }
    | { readonly ok: false; readonly title: string; readonly key: string; readonly reason: UnusableReason };

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

/** The lines of a list-valued field, one level of nesting flattened (microdata gives a list of blocks). */
function linesOf(value: unknown): readonly string[] {
    return asList(value)
        .flatMap((item) => (Array.isArray(item) ? (item as readonly unknown[]) : [item]))
        .flatMap((item) => textOf(item) ?? []);
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

function candidateOf(node: SchemaNode): Candidate | undefined {
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
    const refusal: UnusableReason | undefined = !recipeTitleSchema.safeParse(name).success
        ? 'titleTooLong'
        : ingredientLines.length > MAX_PARSE_JOB_LINES
          ? 'tooManyIngredientLines'
          : ingredientLines.some((line) => line.length > PARSE_JOB_LINE_MAX_CHARS)
            ? 'ingredientLineTooLong'
            : undefined;

    if (refusal !== undefined) {
        return { ok: false, title: name, key, reason: refusal };
    }

    const description = textOf(field(node, 'description'));
    const recipe: PageRecipe = {
        title: name,
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
        steps: Object.freeze(steps.map((instruction) => Object.freeze({ instruction }))),
    };

    return { ok: true, title: name, key, recipe: Object.freeze(recipe), links };
}

/**
 * What a list of Recipe nodes, in page order, comes to.
 *
 * A node with no title, or with neither ingredients nor steps, is not a recipe and is passed over. The same recipe written
 * twice (a block repeated, or a node in `@graph` and again on its own) counts once, by its `@id`, else its `url`, else its
 * name. One recipe is `found` (or `unusable` when it breaks a limit); more than one is `several`, and the cook is asked
 * which, with no round trip.
 *
 * @param nodes - Recipe nodes: JSON-LD objects, or microdata items shaped like them.
 * @returns The outcome. Pure.
 */
export function extractionOf(nodes: readonly SchemaNode[]): RecipeExtraction {
    const seen = new Set<string>();
    const candidates: Candidate[] = [];

    for (const node of nodes) {
        const candidate = candidateOf(node);

        if (candidate !== undefined && !seen.has(candidate.key)) {
            seen.add(candidate.key);
            candidates.push(candidate);
        }
    }

    const [only, ...others] = candidates;

    if (only === undefined) {
        return NONE;
    }

    if (others.length > 0) {
        return Object.freeze({
            kind: 'several',
            titles: Object.freeze(candidates.map((candidate) => candidate.title)),
        });
    }

    return only.ok
        ? Object.freeze({ kind: 'found', recipe: only.recipe, links: Object.freeze(only.links) })
        : Object.freeze({ kind: 'unusable', reason: only.reason });
}
