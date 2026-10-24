/**
 * @module @commise/features-recipes — a cook's marks on one recipe, and how they are stored (blueprint A13,
 * `docs/design/uiOverhaul/buildSpec.md` §6.3, the first slice of 008 FR-035).
 *
 * Two marks, with two rules:
 * - **checked lines** — any number; a tap toggles one;
 * - **the current step** — at most ONE, a place marker rather than a completion record. A tap on another step moves
 *   it; a second tap on the same step clears it.
 *
 * The stored form holds the line keys and the step number and nothing else of the recipe, so a browser keeps no recipe
 * content at rest. A stored value that cannot be read is read as no marks: it is a convenience, never worth an error.
 *
 * @pattern State + Command — a pure reducer over a discriminated union of commands
 */
import { z } from 'zod';

/** One recipe's marks. */
export interface CookMarks {
    /** The keys (`ingredientId`) of the lines the cook has checked. */
    readonly lines: ReadonlySet<string>;
    /** The 1-based number of the step the cook is on, if they marked one. */
    readonly currentStep: number | undefined;
}

/** What a cook can do to their marks. */
export type CookMarkCommand =
    | { readonly kind: 'toggleLine'; readonly line: string }
    | { readonly kind: 'toggleStep'; readonly step: number }
    | { readonly kind: 'clear' };

/** No marks. One shared object, so an untouched recipe's snapshot is reference-stable. */
export const EMPTY_COOK_MARKS: CookMarks = Object.freeze({ lines: new Set<string>(), currentStep: undefined });

/**
 * Apply one command. Pure: the state given is never changed.
 *
 * @param state - The marks now.
 * @param command - What the cook did.
 * @returns The marks after it.
 */
export function applyCookMark(state: CookMarks, command: CookMarkCommand): CookMarks {
    switch (command.kind) {
        case 'toggleLine': {
            const lines = new Set(state.lines);

            if (lines.has(command.line)) {
                lines.delete(command.line);
            } else {
                lines.add(command.line);
            }

            return { lines, currentStep: state.currentStep };
        }

        case 'toggleStep':
            return {
                lines: state.lines,
                currentStep: state.currentStep === command.step ? undefined : command.step,
            };

        case 'clear':
            return EMPTY_COOK_MARKS;
    }
}

/**
 * Whether any mark is set — the condition for offering "Clear checks". Pure.
 *
 * @param state - The marks.
 * @returns `true` when a line is checked or a step is current.
 */
export function hasCookMarks(state: CookMarks): boolean {
    return state.lines.size > 0 || state.currentStep !== undefined;
}

/** The stored form: line keys and a step number, nothing else. */
const storedCookMarks = z.strictObject({
    lines: z.array(z.string()),
    step: z.number().int().positive().nullable(),
});

/**
 * The stored form of a recipe's marks. Pure.
 *
 * @param state - The marks.
 * @returns Their JSON.
 */
export function serializeCookMarks(state: CookMarks): string {
    return JSON.stringify({ lines: [...state.lines], step: state.currentStep ?? null });
}

/**
 * Read a stored value back. Pure.
 *
 * @param raw - The stored value, or `null` when nothing is stored.
 * @returns The marks it holds, or {@link EMPTY_COOK_MARKS} for nothing or anything unreadable.
 */
export function parseCookMarks(raw: string | null): CookMarks {
    if (raw === null || raw === '') {
        return EMPTY_COOK_MARKS;
    }

    let json: unknown;

    try {
        json = JSON.parse(raw);
    } catch {
        return EMPTY_COOK_MARKS;
    }

    const parsed = storedCookMarks.safeParse(json);

    if (!parsed.success) {
        return EMPTY_COOK_MARKS;
    }

    return { lines: new Set(parsed.data.lines), currentStep: parsed.data.step ?? undefined };
}

/** The namespace every cook-marks key starts with. The version is in it so a later shape can never misread this one. */
const KEY_PREFIX = 'cook.v1.';

/**
 * The storage key for one cook's marks on one recipe. Pure.
 *
 * @param subject - The signed-in cook's id; empty while no cook is known.
 * @param recipeId - The recipe.
 * @returns `cook.v1.{subject}.{recipeId}`.
 */
export function cookMarksKey(subject: string, recipeId: string): string {
    return `${KEY_PREFIX}${subject}.${recipeId}`;
}

/**
 * Whether a storage key holds cook marks — any cook's, or one cook's. Pure.
 *
 * @param key - A storage key.
 * @param subject - A cook, to ask whether the key is theirs; absent to ask whether it is cook marks at all.
 * @returns Whether the key is in that namespace.
 */
export function isCookMarksKeyOf(key: string, subject?: string): boolean {
    return key.startsWith(subject === undefined ? KEY_PREFIX : `${KEY_PREFIX}${subject}.`);
}
