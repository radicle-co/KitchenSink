/**
 * A recipe's steps, read from schema.org `recipeInstructions`.
 *
 * `recipeInstructions` is any of: one string, a list of strings, `HowToStep`s (`text`, else `name`), `HowToSection`s
 * (their `itemListElement`) and an `ItemList`. They are read in order into a flat list of steps.
 *
 * The recipe model has no sections, so a section's name ("For the glaze") is a step's HEADING: written at the start of the
 * section's first step as `For the glaze: Whisk.` Nothing is invented: no section name means no heading, and a section with
 * no steps adds nothing. The walk is ITERATIVE and bounded by {@link MAX_WALK_DEPTH} and {@link MAX_WALK_NODES}.
 *
 * A HowToStep's own `name` ("Scramble the egg") rides beside the text, never in it: a name is a heading only where the
 * page SHOWS it (the corroboration stage asks), because many sites keep a name in their data that no cook ever sees.
 */
import { MAX_WALK_DEPTH, MAX_WALK_NODES } from './pageCaps.js';
import { textBlocks } from './pageDocument.js';
import { tokensOf } from './pageTokens.js';
import { asList, field, isSchemaNode, textOf, typeNames } from './schemaNode.js';

/** One step as the page's structured data states it. `text` is the raw text, which is what the page must agree with. */
export interface SchemaStep {
    readonly text: string;
    /** The section label this step spent, written in front of it always. */
    readonly heading?: string;
    /** The step's own name, offered as a heading only where the page shows it (see {@link instructionOf}). */
    readonly name?: string;
}

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

/** A tip is advice, not a step: it is skipped with everything under it. */
const TIP_TYPE = 'HowToTip';

/** A label that already ends in a colon, ASCII or full-width, takes a space only. */
function labelled(label: string, text: string): string {
    const last = label.charAt(label.length - 1);

    return last === ':' || last === '\uFF1A' ? `${label} ${text}` : `${label}: ${text}`;
}

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

/** Whether `tokens` appear in `of` in order, with other tokens allowed between them. */
function isSubsequence(tokens: readonly string[], of: readonly string[]): boolean {
    let next = 0;

    for (const token of of) {
        if (token === tokens[next]) {
            next += 1;
        }
    }

    return next === tokens.length;
}

/**
 * R3: whether a step's name is worth offering as a heading. Not an ordinal ("Step 1", "Krok 1": one word and one integer),
 * not without letters, and not a repeat of the text (its words, in order, are no subsequence of the text's words: "Prep
 * salmon" says nothing "Prep the salmon" does not).
 */
function isUsefulName(name: string, text: string): boolean {
    const tokens = tokensOf(name);
    const isNumber = (token: string): boolean => token.charAt(0) >= '0' && token.charAt(0) <= '9';
    const isOrdinal = tokens.length === 2 && tokens.filter(isNumber).length === 1;

    return !isOrdinal && !tokens.every(isNumber) && !isSubsequence(tokens, tokensOf(text));
}

/** A heading in front of a text: `Heading: text`. */
export function instructionOf(step: SchemaStep, nameShown: boolean): string {
    const heading = step.heading ?? (nameShown ? step.name : undefined);

    return heading === undefined ? step.text : labelled(heading, step.text);
}

/**
 * Read `value` as a list of steps.
 *
 * @param value - The JSON-LD or microdata `recipeInstructions`.
 * @returns The steps in order, each on one line with markup removed. Empty when `value` holds none. Pure.
 */
export function instructionSteps(value: unknown): readonly SchemaStep[] {
    const steps: SchemaStep[] = [];
    const stack: Frame[] = [{ value, depth: 0, section: undefined }];
    let visited = 0;

    const emit = (text: string | undefined, section: Section | undefined, name?: string): void => {
        if (text !== undefined) {
            const heading = takeLabel(section);

            steps.push({
                text,
                ...(heading === undefined ? {} : { heading }),
                ...(name === undefined || !isUsefulName(name, text) ? {} : { name }),
            });
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
        } else if (isSchemaNode(current) && typeNames(current).includes(TIP_TYPE)) {
            continue;
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
                const name = textOf(field(current, 'name'));

                emit(text ?? name, section, text === undefined ? undefined : name);
            }
        }
    }

    return steps;
}
