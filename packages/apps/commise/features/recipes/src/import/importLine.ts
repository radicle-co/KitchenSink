/**
 * @module @commise/features-recipes/import — one ingredient line of an imported recipe as the matching surfaces draw it
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`), and the rules over it the wizard, the
 * flagged lines and the options sheet share.
 *
 * ⚠️ PRESENTATIONAL types, declared here on purpose: the server contract that derives a line's state (recipe-service,
 * "What the server contract must add" §1) has not landed, so nothing here mirrors a wire type. The wiring phase maps the
 * contract onto {@link ImportLine}; when it lands, that mapping is the one place the two meet.
 *
 * The rulings this module holds:
 * - Only `default`, `needsChoice` and `noMatch` need a pick. A `checking` line resolves into one of them; a `confident`
 *   line arrives bound and can be changed.
 * - A default is tagged, never chosen: nothing here returns a pick the cook did not make.
 * - The server orders the candidates (default first); the client renders that order and never re-sorts it.
 * - A late check result belongs to a cook's PICK, so it lives inside {@link ImportLineChoice} and cannot exist without
 *   one: the illegal "note with no pick" state is unrepresentable.
 *
 * @pattern Specification — `isOpenLine` is the one predicate every count and every "next line" is built from
 */
import type { RadioListOption } from '@commise/ui/radio-list';

import { fillTemplate } from '../format/fillTemplate.js';
import type { ImportLineMessages } from './messages.js';

/** A food the server offers for a line. At most five, ordered by the server, the default (if any) first. */
export interface ImportCandidate {
    readonly id: string;
    readonly name: string;
    /** The seed default for the line's noun (salt → table salt). Tagged in the list; never preselected. */
    readonly isDefault: boolean;
}

/** What the cook picked for a line: a food, or to keep the line as written with no food. */
export type ImportLinePick =
    { readonly kind: 'food'; readonly foodId: string; readonly name: string } | { readonly kind: 'asWritten' };

/** A cook's pick, and the late check result that may arrive after it without replacing it. */
export interface ImportLineChoice {
    readonly pick: ImportLinePick;
    /** The food a later check suggested, said in one quiet sentence. The pick stays. */
    readonly lateSuggestion?: string;
}

/** What every line carries. */
interface ImportLineBase {
    /** Stable within the recipe. */
    readonly key: string;
    /** The line as the cook's recipe wrote it ("275 g flour"). */
    readonly text: string;
}

/** A line whose state still allows the cook to pick, and which may already hold that pick. */
interface PickableLine extends ImportLineBase {
    readonly choice?: ImportLineChoice;
}

/** One ingredient line, by the state the server derived for it. */
export type ImportLine =
    | (ImportLineBase & {
          readonly state: 'checking';
          /** The food under review, shown with Checking until the check settles. */
          readonly proposal: string;
      })
    | (PickableLine & {
          readonly state: 'confident';
          /** The bound food: an exact name, a curated mapping, or one the check confirmed. */
          readonly food: string;
          /** What Change offers. */
          readonly candidates: readonly ImportCandidate[];
      })
    | (PickableLine & {
          readonly state: 'default';
          /** The line's food word, for the prompt ("Choose the flour you use"). */
          readonly noun: string;
          readonly candidates: readonly ImportCandidate[];
      })
    | (PickableLine & { readonly state: 'needsChoice'; readonly candidates: readonly ImportCandidate[] })
    | (PickableLine & { readonly state: 'noMatch' });

/** A line whose state lets the cook pick (every state but `checking`). */
export type PickableImportLine = Exclude<ImportLine, { readonly state: 'checking' }>;

/** The option-list value of the keep-as-written row. Food rows are prefixed, so no food id can collide with it. */
const AS_WRITTEN_VALUE = 'asWritten';

/** The prefix of a food row's option-list value. */
const FOOD_VALUE_PREFIX = 'food:';

/**
 * Whether a line still needs the cook: a default, needsChoice or noMatch line with no pick. Pure.
 *
 * @param line - The line.
 * @returns `true` while the line waits on a pick.
 */
export function isOpenLine(line: ImportLine): boolean {
    switch (line.state) {
        case 'default':
        case 'needsChoice':
        case 'noMatch':
            return line.choice === undefined;

        case 'checking':
        case 'confident':
            return false;
    }
}

/**
 * How many lines still need the cook. Pure.
 *
 * @param lines - The recipe's lines.
 * @returns The count of open lines.
 */
export function openLineCount(lines: readonly ImportLine[]): number {
    return lines.filter(isOpenLine).length;
}

/**
 * Whether the recipe has nothing to fix (board WizardStates, "Nothing to fix"): every line is matched — bound on arrival,
 * or changed by the cook to another FOOD. A line kept as written is not matched. Pure.
 *
 * @param lines - The recipe's lines.
 * @returns `true` for a non-empty recipe whose every line has a food.
 */
export function isNothingToFix(lines: readonly ImportLine[]): boolean {
    return (
        lines.length > 0 && lines.every((line) => line.state === 'confident' && line.choice?.pick.kind !== 'asWritten')
    );
}

/**
 * The open line to expand next ("choosing a food expands the next open line"): the first open line after `afterKey`,
 * else the first before it. Never `afterKey` itself. Pure.
 *
 * @param lines - The recipe's lines, in order.
 * @param afterKey - The line just handled, or `undefined` to start from the top.
 * @returns The key of the next open line, or `undefined` when none is open.
 */
export function nextOpenLineKey(lines: readonly ImportLine[], afterKey: string | undefined): string | undefined {
    const at = lines.findIndex((line) => line.key === afterKey);
    const after = lines.slice(at + 1).find(isOpenLine);
    const before = at < 0 ? undefined : lines.slice(0, at).find(isOpenLine);

    return (after ?? before)?.key;
}

/**
 * The option-list value of a pick. Pure.
 *
 * @param pick - The cook's pick, if any.
 * @returns The row id the pick checks, or `undefined` for no pick.
 */
export function optionValueOf(pick: ImportLinePick | undefined): string | undefined {
    if (pick === undefined) {
        return undefined;
    }

    return pick.kind === 'asWritten' ? AS_WRITTEN_VALUE : `${FOOD_VALUE_PREFIX}${pick.foodId}`;
}

/**
 * The pick an option-list value stands for. Pure.
 *
 * @param value - A row id from {@link lineOptionsOf}.
 * @param candidates - The line's candidates, to name the food.
 * @returns The pick, or `undefined` for a value that names no row of this line.
 */
export function pickOfOptionValue(value: string, candidates: readonly ImportCandidate[]): ImportLinePick | undefined {
    if (value === AS_WRITTEN_VALUE) {
        return { kind: 'asWritten' };
    }

    if (!value.startsWith(FOOD_VALUE_PREFIX)) {
        return undefined;
    }

    const foodId = value.slice(FOOD_VALUE_PREFIX.length);
    const candidate = candidates.find((each) => each.id === foodId);

    return candidate === undefined ? undefined : { kind: 'food', foodId, name: candidate.name };
}

/**
 * The rows a line's option list shows: its candidates in the server's order, the default tagged, then "Keep … as
 * written" with its hint as the last row of the same list. Pure.
 *
 * @param lineText - The line as written.
 * @param candidates - The line's candidates.
 * @param messages - The line copy.
 * @returns The option list's rows.
 */
export function lineOptionsOf(
    lineText: string,
    candidates: readonly ImportCandidate[],
    messages: ImportLineMessages,
): readonly RadioListOption[] {
    return [
        ...candidates.map((candidate) => ({
            id: `${FOOD_VALUE_PREFIX}${candidate.id}`,
            label: candidate.name,
            ...(candidate.isDefault ? { tag: messages.defaultTag } : {}),
        })),
        {
            id: AS_WRITTEN_VALUE,
            label: fillTemplate(messages.keepAsWritten, { line: lineText }),
            hint: messages.keepHint,
        },
    ];
}
