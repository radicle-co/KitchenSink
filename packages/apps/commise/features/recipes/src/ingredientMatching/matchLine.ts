/**
 * @module @commise/features-recipes/ingredientMatching — ONE matched ingredient line, as both flows that let a cook
 * choose its food draw it: after Paste a list in the editor, and in a bulk import's review wizard and flagged lines
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25). The rules over it
 * that every count, every "next line" and every row read live here, once.
 *
 * ⛔ These are VIEW shapes, named for what they render, not the server's wire. The server will derive a line's
 * `matchState`, `candidates[]`, `boundBy` and `reviewNote` (the spec's "What the server contract must add" §1); that
 * contract is not merged, and a client never redeclares a wire shape (ADR-0014). The wiring phase maps the wire onto
 * {@link MatchLine} through one Adapter, which is where the spec's five `boundBy` values fold into three (`exact` and
 * `curated` are `server`; `autoBest` is `review`), and where `optionsFailed` — a client load state, not a server one —
 * is set. The types do NOT prove a bound food is one of the line's candidates; that Adapter owes the check.
 *
 * The rulings this module holds:
 * - Only `default`, `needsChoice` and `noMatch` need a pick, and only while NOTHING is bound. Whether a line is bound is
 *   an explicit {@link LineBinding}, never inferred from whether a choice exists: a default the server bound in bulk
 *   "Save lines as written" is bound and keeps its Default tag, and is not the cook's choice.
 * - A `checking` line resolves into another state; a `confident` line arrives bound and can be changed.
 * - A late review result belongs to the COOK's pick, so a {@link ReviewNote} exists only on a cook's binding: the
 *   illegal "note on a line the cook did not pick" cannot be written.
 * - The server orders the candidates (the default may be anywhere); nothing here re-sorts them.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Specification — `isOpenLine` is the one predicate every count, every "next line" and every focus move is
 *     built from
 */

/** A line as the cook wrote it: its leading measure, drawn heavier, and the words after it. */
export interface LineText {
    /** The amount and unit the line starts with ("2 cups"), or `''` when it states none ("eggs"). */
    readonly measure: string;
    /** The rest of the line ("milk"). */
    readonly words: string;
}

/** One food a line could be. The server orders them, at most five; nothing marks a selection. */
export interface FoodChoice {
    /** The food's id: what a pick sends. */
    readonly id: string;
    readonly name: string;
    /** The food most cooks mean by this noun (a seed default). It is tagged, and NEVER chosen for the cook. */
    readonly isDefault: boolean;
    /** A catalog variant's parts, drawn under the name ("unsweetened"). */
    readonly detailParts?: readonly [string, ...string[]];
}

/** What is bound to a line: a food, or the line kept as written with no food. */
export type LinePick =
    { readonly kind: 'food'; readonly foodId: string; readonly name: string } | { readonly kind: 'asWritten' };

/** A review result that finished after the cook's pick: the food it suggests, and why ("See why" shows the reason). */
export interface ReviewNote {
    readonly suggestedFood: string;
    readonly reason: string;
}

/**
 * What the host is sending for ONE line: a pick from its list (a food, or the line kept as written), a food the cook
 * found through Search for a food, or Use this on a line still being checked (and a flagged line's "Use {food}"). While
 * it is in flight the control that started it reads busy and the line refuses a second press, so a double tap cannot
 * send two. Where the pick came from is stated, never inferred: a food found through Search may also be a candidate,
 * and it is Search, not that row, that reads busy.
 *
 * ⚠️ The host raises it INSIDE the press handler (`onPick`, `onUseProposal`, the picker's choice), in the same event,
 * so the next render already refuses a second press; a send raised a render later leaves a window for a double tap.
 */
export type PendingSend =
    | { readonly kind: 'pick'; readonly pick: LinePick }
    | { readonly kind: 'searchPick' }
    | { readonly kind: 'useProposal' };

/** The lines whose send is in flight (the host's pending map, or a set of its keys). */
export interface SendingLines {
    readonly has: (key: string) => boolean;
}

/** Who bound a line: the cook, the server (an exact name, a curated mapping, or a bulk default), or the review. */
export type BoundBy = 'cook' | 'server' | 'review';

/** What is bound to a line, and by whom. Only the cook's binding can carry a late review note. */
export type LineBinding =
    | {
          readonly boundBy: 'cook';
          readonly pick: LinePick;
          /** A review that finished after the pick and suggests another food. The pick stays. */
          readonly reviewNote: ReviewNote | undefined;
      }
    | { readonly boundBy: 'server' | 'review'; readonly pick: LinePick };

/** What every line carries. */
interface LineBase {
    /** Stable among the lines. */
    readonly key: string;
    readonly line: LineText;
}

/** One ingredient line, by the state the server derived for it (and `optionsFailed`, the client's). */
export type MatchLine =
    | (LineBase & {
          readonly state: 'checking';
          /** The food under review, shown with its tag until the review settles. */
          readonly proposal: string;
          readonly binding: LineBinding | undefined;
      })
    | (LineBase & {
          readonly state: 'confident';
          /** What Change offers. */
          readonly candidates: readonly FoodChoice[];
          /** A confident line always arrives bound. */
          readonly binding: LineBinding;
      })
    | (LineBase & {
          readonly state: 'default';
          /** The line's food word, as the prompt says it ("milk"). */
          readonly noun: string;
          readonly candidates: readonly FoodChoice[];
          readonly binding: LineBinding | undefined;
      })
    | (LineBase & {
          readonly state: 'needsChoice';
          readonly candidates: readonly FoodChoice[];
          readonly binding: LineBinding | undefined;
          /**
           * The AI check did not run for this line because the month's budget is spent (the wire reason
           * `reviewBudgetSpent`, owner ruling 2026-10-26): the line is matched without it and the cook chooses. Absent for a
           * line the check ran for. `resetsAt` is when the check comes back (ISO 8601), absent if the server sent none.
           */
          readonly budgetSpent?: { readonly resetsAt: string | undefined };
      })
    | (LineBase & { readonly state: 'noMatch'; readonly binding: LineBinding | undefined })
    | (LineBase & {
          /** The line's options did not load. A client load state; it offers Try again, Search and Keep as written. */
          readonly state: 'optionsFailed';
          readonly binding: undefined;
      });

/** The counts every summary and progress line states. */
export interface MatchCounts {
    /** Lines that need the cook's pick ({@link isOpenLine}). */
    readonly choose: number;
    /** Lines still being checked, with nothing bound. */
    readonly checking: number;
    /** Lines bound to a food, by anyone. */
    readonly matched: number;
}

/**
 * Where focus goes once a pick lands: the next open line, whose list takes it on its first control (Search, else its
 * first option, else Keep as written), or the host's own destination.
 */
export type PickFocus = { readonly kind: 'line'; readonly key: string } | { readonly kind: 'done' };

/** The option id of the keep-as-written pick. Food ids are prefixed, so no food id can collide with it. */
const AS_WRITTEN_ID = 'asWritten';

/** The prefix of a food pick's option id. */
const FOOD_ID_PREFIX = 'food:';

/**
 * The line as the cook wrote it, as one string: the measure, a space, the words. Pure.
 *
 * @param line - The line.
 * @returns The line's text.
 */
export function lineTextOf(line: LineText): string {
    return line.measure === '' ? line.words : `${line.measure} ${line.words}`;
}

/**
 * Whether a line still needs the cook: a default, needsChoice or noMatch line with nothing bound. Pure.
 *
 * @param line - The line.
 * @returns `true` while the line waits on a pick.
 */
export function isOpenLine(line: MatchLine): boolean {
    switch (line.state) {
        case 'default':
        case 'needsChoice':
        case 'noMatch':
            return line.binding === undefined;

        case 'checking':
        case 'confident':
        case 'optionsFailed':
            return false;
    }
}

/**
 * Whether a line is still being checked with nothing bound. A checking line the cook picked for is the cook's. Pure.
 *
 * @param line - The line.
 * @returns `true` while the review decides and the cook has not.
 */
function isCheckingLine(line: MatchLine): boolean {
    return line.state === 'checking' && line.binding === undefined;
}

/**
 * The counts a summary or progress line states, from the same predicates the rows read. Pure.
 *
 * @param lines - The lines.
 * @returns How many need a pick, are being checked, and are bound to a food.
 */
export function matchCountsOf(lines: readonly MatchLine[]): MatchCounts {
    return {
        choose: lines.filter(isOpenLine).length,
        checking: lines.filter(isCheckingLine).length,
        matched: lines.filter((line) => line.binding?.pick.kind === 'food').length,
    };
}

/**
 * Whether a set of lines has nothing to fix: every line arrived matched and still names a food — bound on arrival, or
 * changed by the cook to another food. A line kept as written is not matched, and lines the cook picked one by one were
 * fixed, not "nothing to fix". Bulk import's wizard says so for a recipe (board WizardStates). Pure.
 *
 * @param lines - The recipe's lines.
 * @returns `true` for a non-empty recipe of confident lines that each name a food.
 */
export function isNothingToFix(lines: readonly MatchLine[]): boolean {
    return lines.length > 0 && lines.every((line) => line.state === 'confident' && line.binding.pick.kind === 'food');
}

/**
 * The open line to expand next ("choosing a food expands the next open line"): the first open line after `afterKey`;
 * when none follows, the search RESTARTS FROM THE TOP and answers the first open line before it, because an open line
 * above the one just handled is still the next one the cook must choose for. Never `afterKey` itself, and never a line
 * whose send is in flight: it is still unbound, so still open, and expanding it again would let a second pick be sent
 * while the first is in flight. Pure.
 *
 * @param lines - The lines, in order.
 * @param afterKey - The line just handled, or `undefined` to start from the top.
 * @param sending - The lines whose send is in flight.
 * @returns The key of the next open line, or `undefined` when none is open.
 */
export function nextOpenLineKey(
    lines: readonly MatchLine[],
    afterKey: string | undefined,
    sending: SendingLines,
): string | undefined {
    const waiting = (line: MatchLine): boolean => isOpenLine(line) && !sending.has(line.key);
    const at = lines.findIndex((line) => line.key === afterKey);
    const after = lines.slice(at + 1).find(waiting);
    const before = at < 0 ? undefined : lines.slice(0, at).find(waiting);

    return (after ?? before)?.key;
}

/**
 * Where focus goes once a pick is made (staff-ux 2026-10-25): the next open line, which the host expands and whose list
 * takes the request on its first control; or `done` when nothing is left open, which each host sends to its own place
 * (the wizard's Next recipe). A line whose send is in flight is never the next line. Pure.
 *
 * @param lines - The lines, as they stand once the pick is made.
 * @param pickedKey - The line the cook just picked for.
 * @param sending - The lines whose send is in flight, the one just picked included.
 * @returns Where focus goes.
 */
export function pickFocusOf(lines: readonly MatchLine[], pickedKey: string, sending: SendingLines): PickFocus {
    const next = nextOpenLineKey(lines, pickedKey, sending);

    return next === undefined ? { kind: 'done' } : { kind: 'line', key: next };
}

/**
 * A pick's option id: one id space for the foods and the keep row, so a held or pending pick can be matched to its row.
 * Pure.
 *
 * @param pick - The pick.
 * @returns Its id.
 */
export function optionIdOf(pick: LinePick): string {
    return pick.kind === 'asWritten' ? AS_WRITTEN_ID : `${FOOD_ID_PREFIX}${pick.foodId}`;
}

/**
 * The foods a line offers, in the server's order. Pure.
 *
 * @param line - The line.
 * @returns Its candidates; none for a line with no options.
 */
export function candidatesOf(line: MatchLine): readonly FoodChoice[] {
    switch (line.state) {
        case 'confident':
        case 'default':
        case 'needsChoice':
            return line.candidates;

        case 'checking':
        case 'noMatch':
        case 'optionsFailed':
            return [];
    }
}
