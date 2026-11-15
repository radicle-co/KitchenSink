/**
 * The microdata strategy: a Recipe written as `itemscope` / `itemtype` / `itemprop` attributes on the page's own markup.
 *
 * DESIGN PATTERN: **Strategy** (one of the extractors in `recipeExtractors.ts`). Hand-written over {@link PageDocument}:
 * the one JS microdata library was last released in 2020, which is a stated reason not to depend on it.
 *
 * Each item becomes a plain node shaped like a JSON-LD one (`@type`, and every property as a list of values), so the same
 * reader in `pageRecipeCandidate.ts` serves both strategies. A value comes from the attribute the element type names
 * (`meta` content, `time` datetime, `link` and `a` href, `img` src, `data` value) and otherwise from its text blocks.
 *
 * ⛔ At most {@link MAX_RECIPES_PER_PAGE} recipe items are read. The walk is iterative, {@link MAX_WALK_DEPTH} deep and
 * {@link MAX_WALK_NODES} elements, per recipe, and the text of one property is read from at most that many nodes. An item is built
 * on a prototype-less object, so a property named `__proto__` or `constructor` is plain data.
 */
import { MAX_RECIPES_PER_PAGE, MAX_WALK_DEPTH, MAX_WALK_NODES } from './pageCaps.js';
import type { PageDocument, PageElement } from './pageDocument.js';
import { extractionOf } from './pageRecipeCandidate.js';
import type { RecipeExtraction } from './pageRecipeCandidate.js';
import { typeNames } from './schemaNode.js';
import type { SchemaNode } from './schemaNode.js';

/** An item under construction: property name to the values it has so far. */
type Item = Record<string, unknown[]>;

/** The attribute that holds an element's value, by tag. */
const VALUE_ATTRIBUTE: Readonly<Record<string, string>> = {
    meta: 'content',
    time: 'datetime',
    link: 'href',
    a: 'href',
    area: 'href',
    img: 'src',
    audio: 'src',
    video: 'src',
    source: 'src',
    embed: 'src',
    iframe: 'src',
    track: 'src',
    object: 'data',
    data: 'value',
    meter: 'value',
};

const words = (text: string | undefined): readonly string[] => (text ?? '').split(/\s+/u).filter((word) => word !== '');

function newItem(element: PageElement): Item {
    const item: Item = Object.create(null) as Item;
    const id = element.attr('itemid');

    item['@type'] = [...words(element.attr('itemtype'))];

    if (id !== undefined && id.trim() !== '') {
        item['@id'] = [id.trim()];
    }

    return item;
}

/** What an element that is a property (and not an item) holds. */
function valueOf(element: PageElement): string | readonly string[] {
    const attribute = VALUE_ATTRIBUTE[element.tag];
    const stated = attribute === undefined ? undefined : element.attr(attribute);

    if (stated !== undefined) {
        return stated;
    }

    const blocks = element.blocks();

    return blocks.length === 1 ? (blocks[0] ?? '') : blocks;
}

interface Frame {
    readonly element: PageElement;
    readonly depth: number;
    readonly item: Item;
}

/** The properties of the item `root` declares, in document order. */
function itemOf(root: PageElement): Item {
    const rootItem = newItem(root);
    const stack: Frame[] = [];
    let visited = 0;

    const pushChildren = (element: PageElement, depth: number, item: Item): void => {
        const children = element.children();

        for (let index = children.length - 1; index >= 0; index -= 1) {
            const child = children[index];

            if (child !== undefined) {
                stack.push({ element: child, depth, item });
            }
        }
    };

    pushChildren(root, 1, rootItem);

    for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
        visited += 1;

        if (visited > MAX_WALK_NODES) {
            break;
        }

        if (frame.depth > MAX_WALK_DEPTH) {
            continue;
        }

        const { element, depth, item } = frame;
        const names = words(element.attr('itemprop'));
        const isItem = element.attr('itemscope') !== undefined;
        const inner = isItem ? newItem(element) : item;

        for (const name of names) {
            (item[name] ??= []).push(isItem ? inner : valueOf(element));
        }

        // An item with no property name is a separate item, not part of this one.
        if (!isItem || names.length > 0) {
            pushChildren(element, depth + 1, inner);
        }
    }

    return rootItem;
}

const isRecipeItem = (element: PageElement): boolean =>
    words(element.attr('itemtype')).some((type) => typeNames({ '@type': type }).includes('Recipe'));

/**
 * Find the recipe in a page's microdata.
 *
 * @param page - The parsed paste.
 * @returns What the microdata holds: `none` when no `itemscope` is a Recipe. Pure.
 */
export function microdataRecipe(page: PageDocument): RecipeExtraction {
    const roots = page.withAttribute('itemscope').filter(isRecipeItem).slice(0, MAX_RECIPES_PER_PAGE);

    return extractionOf(roots.map((root): SchemaNode => itemOf(root)));
}
