/**
 * Unit tests for `pasteMatchView.ts`, what the editor's paste flow shows AROUND its matched lines
 * (`docs/design/uiRefreshWorkshop5/redesignCanvas/ingredientMatching.md`, owner rulings 2026-10-25): the summary, the
 * notices and the 1194 / web side pane.
 *
 * REWRITTEN when the paste and import builds were reconciled. The line cases — the options, the open, collapsed and
 * settled lines, the prompts and every accessible name — moved with the line itself to the neutral
 * `ingredientMatching/` module and are now `ingredientMatching/__tests__/matchLineView.test.ts` and `matchLine.test.ts`,
 * where both flows read them. What stays here is paste's own: the summary leaves out a count of 0 and joins its parts
 * with a no-break space before each dot; the notices; the pane's place and steps.
 */
import { describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import { makeDefaultLine } from '../../ingredientMatching/__fixtures__/matchLines.js';
import { matchLineMessages } from '../../ingredientMatching/messages.js';
import { recipeFormMessages } from '../messages.js';
import { pasteMatchNoticeOf, pasteMatchPaneViewOf, pasteMatchSummaryOf, quotaBodyOf } from '../pasteMatchView.js';

const m = recipeFormMessages.en;
const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const ONLINE = { online: true, pending: undefined } as const;
const milkLine = () => makeDefaultLine();

describe('pasteMatchSummaryOf', () => {
    it('says how many lines were added, then the counts in the spec’s order', () => {
        const summary = pasteMatchSummaryOf({ added: 8, choose: 4, checking: 1, matched: 3 }, m, 'en');

        expect(summary.added).toBe('Added 8 lines');
        expect(summary.counts).toBe('4 need your choice\u00A0· 1 being checked\u00A0· 3 matched');
        expect(summary.rule).toBe('Matched lines are ready, and you can change them. Nothing else is chosen for you.');
    });

    it('leaves out a count of 0, and a single line is singular', () => {
        const summary = pasteMatchSummaryOf({ added: 1, choose: 1, checking: 0, matched: 0 }, m, 'en');

        expect(summary.added).toBe('Added 1 line');
        expect(summary.counts).toBe('1 needs your choice');
    });

    it('all matched: only the matched count', () => {
        expect(pasteMatchSummaryOf({ added: 3, choose: 0, checking: 0, matched: 3 }, m, 'en').counts).toBe('3 matched');
    });
});

describe('quotaBodyOf', () => {
    it('says when matching starts again, in the cook’s locale and time zone', () => {
        const resetsAt = '2026-10-26T04:00:00.000Z';
        const time = new Intl.DateTimeFormat('en', { timeStyle: 'short', timeZone: 'America/New_York' }).format(
            new Date(resetsAt),
        );

        expect(time).toBe('12:00 AM');
        expect(quotaBodyOf(resetsAt, m, 'en', 'America/New_York')).toBe(
            `You’ve added a lot today. Matching starts again at ${time}. These lines are kept as written, and you can choose foods for them then.`,
        );
    });
});

describe('pasteMatchPaneViewOf', () => {
    it('says which open line it shows, out of how many, and heads it with the line', () => {
        const view = pasteMatchPaneViewOf(milkLine(), { index: 1, count: 4 }, ONLINE, m, copy);

        expect(view.position).toBe('Open line 2 of 4');
        expect(view.heading).toBe('2 cups milk');
        expect(view.label).toBe('Choose a food');
        expect(view.open.prompt).toBe('Choose the milk you use');
        expect(view.open.list.optionsName).toBe('Food for 2 cups milk');
    });

    it('in the middle, both Previous and Next can be used', () => {
        const view = pasteMatchPaneViewOf(milkLine(), { index: 1, count: 4 }, ONLINE, m, copy);

        expect([view.previous.disabled, view.next.disabled]).toEqual([false, false]);
        expect([view.previous.label, view.next.label]).toEqual(['Previous', 'Next open line']);
    });

    it('the first line cannot go back, and the last cannot go on', () => {
        expect(pasteMatchPaneViewOf(milkLine(), { index: 0, count: 4 }, ONLINE, m, copy).previous.disabled).toBe(true);
        expect(pasteMatchPaneViewOf(milkLine(), { index: 3, count: 4 }, ONLINE, m, copy).next.disabled).toBe(true);
    });

    it('a single open line can go neither way', () => {
        const view = pasteMatchPaneViewOf(milkLine(), { index: 0, count: 1 }, ONLINE, m, copy);

        expect([view.previous.disabled, view.next.disabled]).toEqual([true, true]);
    });
});

describe('pasteMatchNoticeOf', () => {
    it('offline, on a device: choices are saved on this device', () => {
        expect(pasteMatchNoticeOf({ kind: 'offline', keep: 'disk' }, m, 'en')).toBe(
            'You’re offline. Your choices are saved on this device. Search and the check start again when you’re back online.',
        );
    });

    it('⛔ offline, on web: choices are kept in this tab, never claimed to be on the device (D7)', () => {
        expect(pasteMatchNoticeOf({ kind: 'offline', keep: 'tabSession' }, m, 'en')).toBe(
            'You’re offline. Your choices are kept in this tab. Search and the check start again when you’re back online.',
        );
    });

    it('the daily limit: says when matching starts again', () => {
        const notice = { kind: 'quota', resetsAt: '2026-10-26T04:00:00.000Z', timeZone: 'America/New_York' } as const;

        expect(pasteMatchNoticeOf(notice, m, 'en')).toBe(quotaBodyOf(notice.resetsAt, m, 'en', notice.timeZone));
        expect(pasteMatchNoticeOf(notice, m, 'en')).toContain('12:00 AM');
    });
});
