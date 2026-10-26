/**
 * Unit tests for `lineAnnouncement.ts`: what a list of matched lines says in its ONE polite live region when its lines
 * change under the cook (staff-ux U9, WCAG 4.1.3), never one region per row. The host keeps the snapshot it last
 * announced and hands the old and new one in; this decides the words. It says:
 *
 * - a line still being checked that has resolved — matched, needing a choice, or its options failing;
 * - a late review note on the cook's pick ("Our check suggested…");
 * - a pick that failed (M6).
 *
 * Nothing else: a pick the cook just made, a line that opened, and a count are not this module's to say.
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import {
    cookPicked,
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeFoodChoice,
    makeNeedsChoiceLine,
    makeOptionsFailedLine,
    MILKS,
} from '../__fixtures__/matchLines.js';
import { lineChangesOf, pickFailedAnnouncementOf, type ListSnapshot } from '../lineAnnouncement.js';
import type { MatchLine } from '../matchLine.js';
import { matchLineMessages } from '../messages.js';

const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const NONE: ReadonlySet<string> = new Set();
const SKIM = MILKS[0] ?? makeFoodChoice({ id: 'skim', name: 'Skim milk' });

const snapshot = (lines: readonly MatchLine[], failed: ReadonlySet<string> = NONE): ListSnapshot => ({ lines, failed });

describe('lineChangesOf', () => {
    it('says nothing when nothing changed', () => {
        const lines = [makeCheckingLine(), makeDefaultLine()];

        expect(lineChangesOf(snapshot(lines), snapshot(lines), copy)).toBe('');
    });

    it('a checking line that resolved to a match says what it matched', () => {
        const after = makeConfidentLine({
            key: 'cream',
            line: { measure: '1/2 cup', words: 'heavy cream' },
            binding: { boundBy: 'review', pick: { kind: 'food', foodId: 'hc', name: 'Heavy whipping cream' } },
        });

        expect(lineChangesOf(snapshot([makeCheckingLine()]), snapshot([after]), copy)).toBe(
            'Check finished for 1/2 cup heavy cream: matched to Heavy whipping cream.',
        );
    });

    it('a checking line that resolved to a choice says it needs one', () => {
        const after = makeNeedsChoiceLine({ key: 'cream', line: { measure: '1/2 cup', words: 'heavy cream' } });

        expect(lineChangesOf(snapshot([makeCheckingLine()]), snapshot([after]), copy)).toBe(
            'Check finished for 1/2 cup heavy cream: choose a food.',
        );
    });

    it('a checking line whose options then failed says so', () => {
        const after = makeOptionsFailedLine({ key: 'cream', line: { measure: '1/2 cup', words: 'heavy cream' } });

        expect(lineChangesOf(snapshot([makeCheckingLine()]), snapshot([after]), copy)).toBe(
            'Check finished for 1/2 cup heavy cream: we couldn’t load the options.',
        );
    });

    it('a line the cook picked for while it was checking is not announced when its check settles', () => {
        const picked = makeCheckingLine({ binding: cookPicked(SKIM) });

        expect(lineChangesOf(snapshot([picked]), snapshot([picked]), copy)).toBe('');
    });

    it('⛔ a late review note on the cook’s pick is said once, when it arrives', () => {
        const before = makeDefaultLine({ binding: cookPicked(SKIM) });
        const after = makeDefaultLine({
            binding: cookPicked(SKIM, { suggestedFood: 'Whole milk', reason: 'The recipe is a custard.' }),
        });

        expect(lineChangesOf(snapshot([before]), snapshot([after]), copy)).toBe(
            'For 2 cups milk, our check suggested Whole milk. Your choice stays.',
        );
        expect(lineChangesOf(snapshot([after]), snapshot([after]), copy)).toBe('');
    });

    it('⛔ a pick that failed is said when it fails, and not again while it stays failed', () => {
        const lines = [makeDefaultLine()];

        expect(lineChangesOf(snapshot(lines), snapshot(lines, new Set(['milk'])), copy)).toBe(
            'We couldn’t save the choice for 2 cups milk.',
        );
        expect(lineChangesOf(snapshot(lines, new Set(['milk'])), snapshot(lines, new Set(['milk'])), copy)).toBe('');
    });

    it('several changes are said in the recipe’s order, as whole sentences', () => {
        const before = [makeCheckingLine(), makeDefaultLine()];
        const after = [
            makeNeedsChoiceLine({ key: 'cream', line: { measure: '1/2 cup', words: 'heavy cream' } }),
            makeDefaultLine(),
        ];

        expect(lineChangesOf(snapshot(before), snapshot(after, new Set(['milk'])), copy)).toBe(
            'Check finished for 1/2 cup heavy cream: choose a food. We couldn’t save the choice for 2 cups milk.',
        );
    });

    it('a line new to the list is not a change of a checking line', () => {
        expect(lineChangesOf(snapshot([]), snapshot([makeConfidentLine()]), copy)).toBe('');
    });
});

describe('pickFailedAnnouncementOf', () => {
    it('says the failure for a line given only as text, in the words lineChangesOf uses for a matched line', () => {
        const line = makeDefaultLine({ key: 'milk', line: { measure: '1 1/4 cups', words: 'milk' } });
        const said = lineChangesOf(snapshot([line]), snapshot([line], new Set(['milk'])), copy);

        expect(pickFailedAnnouncementOf('1 1/4 cups milk', copy)).toBe(said);
        expect(said).not.toBe('');
    });
});
