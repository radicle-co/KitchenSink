/**
 * The JSON-LD strategy: a Recipe node inside a `<script type="application/ld+json">` block.
 *
 * DESIGN PATTERN: **Strategy** (one of the extractors in `recipeExtractors.ts`). It sees only the {@link PageDocument}.
 * The node is read by `pageRecipeCandidate.ts`, whose zod schemas are the Parser at the boundary.
 *
 * ⛔ Hostile-input bounds (blueprint §4): at most {@link MAX_JSON_LD_BLOCKS} blocks (more make the page `tooComplex`), each at most
 * {@link MAX_JSON_LD_BLOCK_BYTES} bytes before `JSON.parse`; the walk is `boundedWalk`, {@link MAX_WALK_DEPTH} deep and
 * `MAX_WALK_NODES` nodes, and a block over the byte limit, a block that does not parse, a block nested deeper or a walk that hits the node cap makes the page `tooComplex` (a blank block holds nothing and is passed over). Parsed objects are never spread or merged.
 */
import { boundedWalk } from './boundedWalk.js';
import { MAX_JSON_LD_BLOCK_BYTES, MAX_JSON_LD_BLOCKS, MAX_WALK_DEPTH, fitsInBytes } from './pageCaps.js';
import type { PageDocument, PageElement } from './pageDocument.js';
import { TOO_COMPLEX, extractionOf } from './pageRecipeCandidate.js';
import type { RecipeExtraction } from './pageRecipeCandidate.js';
import { childrenOf, isSchemaNode, typeNames } from './schemaNode.js';
import type { SchemaNode } from './schemaNode.js';

const JSON_LD_TYPE = 'application/ld+json';

const isJsonLdScript = (script: PageElement): boolean =>
    (script.attr('type') ?? '').split(';')[0]?.trim().toLowerCase() === JSON_LD_TYPE;

/** What one block's walk found: its Recipe nodes, in order, and whether a cap cut the walk short. */
interface BlockWalk {
    readonly nodes: readonly SchemaNode[];
    readonly truncated: boolean;
}

/** The Recipe nodes of one parsed block, in order. It does not descend into a Recipe. */
function recipeNodesOf(root: unknown): BlockWalk {
    const nodes: SchemaNode[] = [];

    const { truncated } = boundedWalk([root], (value) => {
        if (isSchemaNode(value) && typeNames(value).includes('Recipe')) {
            nodes.push(value);

            return [];
        }

        return childrenOf(value);
    });

    return { nodes, truncated };
}

interface DepthFrame {
    readonly value: unknown;
    readonly depth: number;
}

/** Whether `root` nests no deeper than {@link MAX_WALK_DEPTH}. Iterative: a block under the byte cap can nest 100,000 deep. */
function isShallow(root: unknown): boolean {
    const stack: DepthFrame[] = [{ value: root, depth: 0 }];

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

/** A block as read: its JSON, or why it gives none. */
type ParsedBlock =
    | { readonly kind: 'json'; readonly value: unknown }
    /** Blank: it holds nothing, so it cannot hold the page's recipe. */
    | { readonly kind: 'empty' }
    /** Over the byte limit, nested deeper than {@link MAX_WALK_DEPTH}, or not JSON: unread, so the page is only partly read. */
    | { readonly kind: 'unread' };

const EMPTY: ParsedBlock = { kind: 'empty' };
const UNREAD: ParsedBlock = { kind: 'unread' };

function parsedBlock(script: PageElement): ParsedBlock {
    const text = script.rawText();

    if (!fitsInBytes(text, MAX_JSON_LD_BLOCK_BYTES)) {
        return UNREAD;
    }

    if (text.trim() === '') {
        return EMPTY;
    }

    try {
        const value = JSON.parse(text) as unknown;

        return isShallow(value) ? { kind: 'json', value } : UNREAD;
    } catch {
        // A block that does not parse may be the page's own recipe: the page is not read whole.
        return UNREAD;
    }
}

/**
 * Find the recipe in a page's JSON-LD.
 *
 * @param page - The parsed paste.
 * @returns What the JSON-LD holds: `none` when no block has a recipe, and `tooComplex` when there are more blocks than the cap, a block is over the byte limit, does not parse or nests past
 *   the depth cap, or a walk hit the node cap, because a recipe (or a second one) may lie in what was not read. Pure.
 */
export function jsonLdRecipe(page: PageDocument): RecipeExtraction {
    const scripts = page.byTag('script').filter(isJsonLdScript);
    const blocks = scripts.slice(0, MAX_JSON_LD_BLOCKS).map(parsedBlock);

    // A block past the cap, or one too big, too deep or not JSON to read, may hold the page's own recipe.
    if (scripts.length > MAX_JSON_LD_BLOCKS || blocks.some((block) => block.kind === 'unread')) {
        return TOO_COMPLEX;
    }

    const walks = blocks.flatMap((block) => (block.kind === 'json' ? [recipeNodesOf(block.value)] : []));

    return walks.some((walk) => walk.truncated)
        ? TOO_COMPLEX
        : extractionOf(
              walks.flatMap((walk) => walk.nodes),
              'jsonLd',
          );
}
