/**
 * The JSON-LD strategy: a Recipe node inside a `<script type="application/ld+json">` block.
 *
 * DESIGN PATTERN: **Strategy** (one of the extractors in `recipeExtractors.ts`). It sees only the {@link PageDocument}.
 * The node is read by `pageRecipeCandidate.ts`, whose zod schemas are the Parser at the boundary.
 *
 * ⛔ Hostile-input bounds (blueprint §4): at most {@link MAX_JSON_LD_BLOCKS} blocks, each at most
 * {@link MAX_JSON_LD_BLOCK_BYTES} bytes before `JSON.parse`; the walk is iterative, {@link MAX_WALK_DEPTH} deep and
 * {@link MAX_WALK_NODES} nodes; a block that does not parse is skipped. Parsed objects are never spread or merged.
 */
import {
    MAX_JSON_LD_BLOCK_BYTES,
    MAX_JSON_LD_BLOCKS,
    MAX_WALK_DEPTH,
    MAX_WALK_NODES,
    fitsInBytes,
} from './pageCaps.js';
import type { PageDocument, PageElement } from './pageDocument.js';
import { extractionOf } from './pageRecipeCandidate.js';
import type { RecipeExtraction } from './pageRecipeCandidate.js';
import { isSchemaNode, typeNames } from './schemaNode.js';
import type { SchemaNode } from './schemaNode.js';

const JSON_LD_TYPE = 'application/ld+json';

const isJsonLdScript = (script: PageElement): boolean =>
    (script.attr('type') ?? '').split(';')[0]?.trim().toLowerCase() === JSON_LD_TYPE;

interface Frame {
    readonly value: unknown;
    readonly depth: number;
}

/** The Recipe nodes of one parsed block, in order. Iterative; it does not descend into a Recipe. */
function recipeNodesOf(root: unknown): readonly SchemaNode[] {
    const found: SchemaNode[] = [];
    const stack: Frame[] = [{ value: root, depth: 0 }];
    let visited = 0;

    for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
        visited += 1;

        if (visited > MAX_WALK_NODES) {
            break;
        }

        if (frame.depth > MAX_WALK_DEPTH) {
            continue;
        }

        const { value, depth } = frame;

        if (Array.isArray(value)) {
            const items = value as readonly unknown[];

            for (let index = items.length - 1; index >= 0; index -= 1) {
                stack.push({ value: items[index], depth: depth + 1 });
            }
        } else if (isSchemaNode(value)) {
            if (typeNames(value).includes('Recipe')) {
                found.push(value);
            } else {
                const children = Object.values(value);

                for (let index = children.length - 1; index >= 0; index -= 1) {
                    stack.push({ value: children[index], depth: depth + 1 });
                }
            }
        }
    }

    return found;
}

/** Whether `root` nests no deeper than {@link MAX_WALK_DEPTH}. Iterative: a block under the byte cap can nest 100,000 deep. */
function isShallow(root: unknown): boolean {
    const stack: Frame[] = [{ value: root, depth: 0 }];

    for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
        if (frame.depth > MAX_WALK_DEPTH) {
            return false;
        }

        const { value, depth } = frame;

        if (typeof value === 'object' && value !== null) {
            Object.values(value).forEach((child) => stack.push({ value: child, depth: depth + 1 }));
        }
    }

    return true;
}

/** A block's parsed JSON, or `undefined` when it is over the byte limit, is not JSON, or nests too deeply to read. */
function parsedBlock(script: PageElement): unknown {
    const text = script.rawText();

    if (!fitsInBytes(text, MAX_JSON_LD_BLOCK_BYTES)) {
        return undefined;
    }

    try {
        const parsed = JSON.parse(text) as unknown;

        return isShallow(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Find the recipe in a page's JSON-LD.
 *
 * @param page - The parsed paste.
 * @returns What the JSON-LD holds: `none` when no block has a recipe. Pure.
 */
export function jsonLdRecipe(page: PageDocument): RecipeExtraction {
    const blocks = page.byTag('script').filter(isJsonLdScript).slice(0, MAX_JSON_LD_BLOCKS);

    return extractionOf(blocks.flatMap((block) => recipeNodesOf(parsedBlock(block))));
}
