/**
 * A recipe's steps, read from schema.org `recipeInstructions`.
 *
 * `recipeInstructions` is any of: one string, a list of strings, `HowToStep`s (`text`, else `name`), `HowToSection`s
 * (their `itemListElement`) and an `ItemList`. They are read in order into a flat list of steps.
 *
 * The recipe model has no sections, so a section's name ("For the glaze") is a step's HEADING: written at the start of the
 * section's first step as `For the glaze: Whisk.` Nothing is invented: no section name means no heading, and a section with
 * no steps adds nothing. The walk is `boundedWalk`: iterative, and capped in depth and nodes. A walk a cap cut short is reported, never used.
 *
 * A HowToStep's own `name` ("Scramble the egg") rides beside the text, never in it: a name is a heading only where the
 * page SHOWS it (the corroboration stage asks), because many sites keep a name in their data that no cook ever sees.
 */
import { boundedWalk } from './boundedWalk.js';
import { textBlocks } from './pageDocument.js';
import { tokensOf } from './pageTokens.js';
import { asList, field, isList, isSchemaNode, textOf, typeNames } from './schemaNode.js';
import type { SchemaNode } from './schemaNode.js';

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

/** The steps of one `recipeInstructions` value, and whether a walk cap left part of it unread. */
export interface InstructionRead {
    readonly steps: readonly SchemaStep[];
    /** Whether the node or depth cap cut the walk short: the steps are then PART of the method, and no recipe is read from them. */
    readonly truncated: boolean;
}

type Emit = (text: string | undefined, section: Section | undefined, name?: string) => void;

/** A node that is a section or list walks into its items (a `HowToSection` opens a labelled section); any other is one step. */
function nodeFrames(node: SchemaNode, section: Section | undefined, emit: Emit): readonly Frame[] {
    const items = asList(field(node, 'itemListElement'));
    const text = textOf(field(node, 'text'));
    const name = textOf(field(node, 'name'));
    const types = typeNames(node);

    if (!types.some((type) => LIST_TYPES.has(type)) && (items.length === 0 || text !== undefined)) {
        emit(text ?? name, section, text === undefined ? undefined : name);

        return [];
    }

    const inner: Section | undefined =
        name !== undefined && types.includes('HowToSection') ? { label: name, parent: section, used: false } : section;

    return items.map((item) => ({ value: item, section: inner }));
}

/**
 * Read `value` as a list of steps.
 *
 * @param value - The JSON-LD or microdata `recipeInstructions`.
 * @returns The steps in order, each on one line with markup removed (empty when `value` holds none), and whether a walk
 *   cap cut the walk short. Pure.
 */
export function instructionSteps(value: unknown): InstructionRead {
    const steps: SchemaStep[] = [];

    const emit: Emit = (text, section, name) => {
        if (text !== undefined) {
            const heading = takeLabel(section);

            steps.push({
                text,
                ...(heading === undefined ? {} : { heading }),
                ...(name === undefined || !isUsefulName(name, text) ? {} : { name }),
            });
        }
    };

    const { truncated } = boundedWalk<Frame>([{ value, section: undefined }], ({ value: current, section }, depth) => {
        if (typeof current === 'string') {
            // A lone string is the whole method, broken at its line breaks; a string inside a list is one step.
            (depth === 0 ? textBlocks(current) : [textOf(current)]).forEach((text) => {
                emit(text, section);
            });

            return [];
        }

        if (isList(current)) {
            return current.map((item) => ({ value: item, section }));
        }

        // A tip is advice, not a step: it is skipped with everything under it.
        return isSchemaNode(current) && !typeNames(current).includes(TIP_TYPE)
            ? nodeFrames(current, section, emit)
            : [];
    });

    return { steps, truncated };
}
