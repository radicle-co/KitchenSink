/**
 * @module @commise/features-recipes/ingredientMatching — what a list of matched lines says in its ONE polite live
 * region when its lines change under the cook (staff-ux U9, WCAG 4.1.3): never one region per row. It compares the
 * snapshot the host last announced with the one it holds now and words what moved:
 *
 * - a line still being checked that has resolved — matched, needing a choice, or its options failing;
 * - a late review note on the cook's pick;
 * - a send that failed (M6).
 *
 * A pick the cook just made, a line that opened and a count are not said here: the cook did the first two, and each
 * host words its own counts. The host keeps the snapshot (a presentational leaf holds none) and joins this to its counts.
 *
 * Pure and platform-agnostic.
 *
 * @pattern Presentation Model — a list's change, worded once for every host of both flows
 */
import { fillTemplate } from '../format/fillTemplate.js';
import { isOpenLine, lineTextOf, type MatchLine } from './matchLine.js';
import type { MatchCopy } from './matchLineView.js';

/** What a list held when it was last announced, or holds now. */
export interface ListSnapshot {
    readonly lines: readonly MatchLine[];
    /** The lines whose last send failed. */
    readonly failed: ReadonlySet<string>;
}

/** Whether a line is still being checked with nothing bound. Pure. */
const isUnboundChecking = (line: MatchLine): boolean => line.state === 'checking' && line.binding === undefined;

/** What a checked line resolved into, as a sentence; `undefined` while it is still being checked. Pure. */
const resolvedOf = (line: MatchLine, text: string, copy: MatchCopy): string | undefined => {
    if (isUnboundChecking(line)) {
        return undefined;
    }

    if (line.state === 'optionsFailed') {
        return fillTemplate(copy.line.announce.optionsFailed, { line: text });
    }

    const pick = line.binding?.pick;

    if (pick?.kind === 'food') {
        return fillTemplate(copy.line.announce.matched, { line: text, food: pick.name });
    }

    return isOpenLine(line) ? fillTemplate(copy.line.announce.needsChoice, { line: text }) : undefined;
};

/** A line's late review note's food, if it carries one. Pure. */
const noteFoodOf = (line: MatchLine | undefined): string | undefined =>
    line?.binding?.boundBy === 'cook' ? line.binding.reviewNote?.suggestedFood : undefined;

/** What changed on one line, as sentences, in order. Pure. */
const changesOfLine = (
    line: MatchLine,
    previous: MatchLine | undefined,
    before: ListSnapshot,
    after: ListSnapshot,
    copy: MatchCopy,
): readonly string[] => {
    const text = lineTextOf(line.line);
    const resolved = previous !== undefined && isUnboundChecking(previous) ? resolvedOf(line, text, copy) : undefined;
    const noteFood = noteFoodOf(line);
    const note =
        noteFood !== undefined && noteFood !== noteFoodOf(previous)
            ? fillTemplate(copy.line.announce.lateSuggestion, { line: text, food: noteFood })
            : undefined;
    const failed =
        after.failed.has(line.key) && !before.failed.has(line.key)
            ? fillTemplate(copy.line.announce.pickFailed, { line: text })
            : undefined;

    return [resolved, note, failed].filter((sentence): sentence is string => sentence !== undefined);
};

/**
 * What changed between two snapshots of a list, as whole sentences in the recipe's order, or `''` when nothing worth
 * saying changed. Pure.
 *
 * @param before - What the list held when it was last announced.
 * @param after - What it holds now.
 * @param copy - The localised copy.
 * @returns The sentences, joined by a space.
 */
export function lineChangesOf(before: ListSnapshot, after: ListSnapshot, copy: MatchCopy): string {
    const previous = new Map(before.lines.map((line) => [line.key, line]));

    return after.lines.flatMap((line) => changesOfLine(line, previous.get(line.key), before, after, copy)).join(' ');
}
