/**
 * A recipe's steps, read from schema.org `recipeInstructions`.
 *
 * `recipeInstructions` is any of: one string, a list of strings, `HowToStep`s (`text`, else `name`), `HowToSection`s
 * (their `itemListElement`) and an `ItemList`. They are read in order into a flat list of steps.
 *
 * The recipe model has no sections, so a section's name ("For the glaze") is written at the start of the section's first
 * step as `For the glaze: Whisk.` Nothing is invented: no section name means no label, and a section with no steps adds
 * nothing. The walk is ITERATIVE and bounded by {@link MAX_WALK_DEPTH} and {@link MAX_WALK_NODES}.
 */
import { MAX_WALK_DEPTH, MAX_WALK_NODES } from './pageCaps.js';
import { textBlocks } from './pageDocument.js';
import { asList, field, isSchemaNode, textOf, typeNames } from './schemaNode.js';

/** A named section whose label goes in front of the first step read from it or from a section inside it. */
interface Section {
    readonly label: string;
    readonly parent: Section | undefined;
    used: boolean;
}

interface Frame {
    readonly value: unknown;
    readonly depth: number;
    readonly section: Section | undefined;
}

const LIST_TYPES: ReadonlySet<string> = new Set(['HowToSection', 'ItemList']);

/** The label for a step read inside `section`: its own, or the nearest unlabelled one's. Every enclosing section is then spent. */
function takeLabel(section: Section | undefined): string | undefined {
    let label: string | undefined;

    for (let next = section; next !== undefined; next = next.parent) {
        if (label === undefined && !next.used) {
            label = next.label;
        }

        next.used = true;
    }

    return label;
}

/**
 * Read `value` as a list of step texts.
 *
 * @param value - The JSON-LD or microdata `recipeInstructions`.
 * @returns The steps in order, each on one line with markup removed. Empty when `value` holds none. Pure.
 */
export function instructionSteps(value: unknown): readonly string[] {
    const steps: string[] = [];
    const stack: Frame[] = [{ value, depth: 0, section: undefined }];
    let visited = 0;

    const emit = (text: string | undefined, section: Section | undefined): void => {
        if (text !== undefined) {
            const label = takeLabel(section);

            steps.push(label === undefined ? text : `${label}: ${text}`);
        }
    };

    for (let frame = stack.pop(); frame !== undefined; frame = stack.pop()) {
        visited += 1;

        if (visited > MAX_WALK_NODES) {
            break;
        }

        if (frame.depth > MAX_WALK_DEPTH) {
            continue;
        }

        const { value: current, depth, section } = frame;

        if (typeof current === 'string') {
            // A lone string is the whole method, broken at its line breaks; a string inside a list is one step.
            (depth === 0 ? textBlocks(current) : [textOf(current)]).forEach((text) => {
                emit(text, section);
            });
        } else if (Array.isArray(current)) {
            const items = current as readonly unknown[];

            for (let index = items.length - 1; index >= 0; index -= 1) {
                stack.push({ value: items[index], depth: depth + 1, section });
            }
        } else if (isSchemaNode(current)) {
            const items = asList(field(current, 'itemListElement'));
            const text = textOf(field(current, 'text'));
            const isList = typeNames(current).some((type) => LIST_TYPES.has(type));

            if (isList || (items.length > 0 && text === undefined)) {
                const name = textOf(field(current, 'name'));
                const inner: Section | undefined =
                    name !== undefined && typeNames(current).includes('HowToSection')
                        ? { label: name, parent: section, used: false }
                        : section;

                for (let index = items.length - 1; index >= 0; index -= 1) {
                    stack.push({ value: items[index], depth: depth + 1, section: inner });
                }
            } else {
                emit(text ?? textOf(field(current, 'name')), section);
            }
        }
    }

    return steps;
}
