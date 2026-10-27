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
 *
 * REWRITTEN for the UI fix pass (2026-10-25), seen red first:
 * - U4: the summary says the counts in the owner's order and words ("3 matched · 4 to choose · 1 being checked", commit
 *   7b62777fc) and joins them with the rule as ONE paragraph; it was "4 need your choice · 1 being checked · 3 matched"
 *   on a line of its own.
 * - M4: the pane counts over ALL the recipe's lines ("Line 3 of 5") and steps to the previous and next OPEN line, so a
 *   line it shows keeps its place once chosen; it counted only the open lines.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { recipeMessages } from '../../messages.js';
import {
    cookPicked,
    makeCheckingLine,
    makeConfidentLine,
    makeDefaultLine,
    makeNeedsChoiceLine,
    makeNoMatchLine,
    MILKS,
} from '../../ingredientMatching/__fixtures__/matchLines.js';
import type { MatchLine } from '../../ingredientMatching/matchLine.js';
import { matchLineMessages } from '../../ingredientMatching/messages.js';
import { recipeFormMessages } from '../messages.js';
import {
    noAiCheckBodyOf,
    paneStepsOf,
    pasteMatchNoticeFor,
    pasteMatchNoticeOf,
    pasteMatchPaneViewOf,
    pasteMatchSummaryOf,
    quotaBodyOf,
} from '../pasteMatchView.js';

const m = recipeFormMessages.en;
const copy = { line: matchLineMessages.en, details: recipeMessages.en.ingredientDetails };
const ONLINE = { online: true, pending: undefined, failed: false } as const;
const NOTHING_SENT: ReadonlySet<string> = new Set();
const SKIM = MILKS[0] ?? MILKS[1];

/** eggs (matched), milk, cream (checking), bread, spice mix: three open lines among five. */
const RECIPE: readonly MatchLine[] = [
    makeConfidentLine(),
    makeDefaultLine(),
    makeCheckingLine(),
    makeNeedsChoiceLine(),
    makeNoMatchLine(),
];

describe('pasteMatchSummaryOf', () => {
    it('says how many lines were added, then ONE paragraph: the counts in the owner’s order, then the rule', () => {
        const summary = pasteMatchSummaryOf({ added: 8, choose: 4, checking: 1, matched: 3 }, m, 'en');

        expect(summary.added).toBe('Added 8 lines');
        expect(summary.paragraph).toBe(
            '3 matched\u00A0· 4 to choose\u00A0· 1 being checked. Matched lines are ready, and you can change them. Nothing else is chosen for you.',
        );
    });

    it('leaves out a count of 0, and a single line is singular', () => {
        const summary = pasteMatchSummaryOf({ added: 1, choose: 1, checking: 0, matched: 0 }, m, 'en');

        expect(summary.added).toBe('Added 1 line');
        expect(summary.paragraph.startsWith('1 to choose. ')).toBe(true);
    });

    it('all matched: only the matched count, then the rule', () => {
        expect(pasteMatchSummaryOf({ added: 3, choose: 0, checking: 0, matched: 3 }, m, 'en').paragraph).toBe(
            '3 matched. Matched lines are ready, and you can change them. Nothing else is chosen for you.',
        );
    });

    it('⛔ every count 0 (every line kept as written): the rule alone, never a stray ". "', () => {
        expect(pasteMatchSummaryOf({ added: 2, choose: 0, checking: 0, matched: 0 }, m, 'en').paragraph).toBe(
            'Matched lines are ready, and you can change them. Nothing else is chosen for you.',
        );
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

describe('paneStepsOf — the pane’s place among ALL the lines, and its steps to the open ones (M4)', () => {
    it('counts the shown line over every line of the recipe', () => {
        expect(paneStepsOf({ lines: RECIPE, shownKey: 'bread', sending: NOTHING_SENT })).toMatchObject({
            position: 4,
            total: 5,
        });
    });

    it('steps to the previous and the next OPEN line, over settled and checking lines', () => {
        expect(paneStepsOf({ lines: RECIPE, shownKey: 'bread', sending: NOTHING_SENT })).toMatchObject({
            previousKey: 'milk',
            nextKey: 'spice',
        });
    });

    it('does not wrap: nothing before the first open line, nothing after the last', () => {
        expect(paneStepsOf({ lines: RECIPE, shownKey: 'milk', sending: NOTHING_SENT }).previousKey).toBeUndefined();
        expect(paneStepsOf({ lines: RECIPE, shownKey: 'spice', sending: NOTHING_SENT }).nextKey).toBeUndefined();
    });

    it('⛔ a shown line chosen in the pane keeps its place, and its steps stay right', () => {
        const chosen = RECIPE.map((line) =>
            line.key === 'bread' ? makeNeedsChoiceLine({ binding: cookPicked(SKIM) }) : line,
        );

        expect(paneStepsOf({ lines: chosen, shownKey: 'bread', sending: NOTHING_SENT })).toEqual({
            position: 4,
            total: 5,
            previousKey: 'milk',
            nextKey: 'spice',
        });
    });

    it('never steps to a line whose choice is still being sent', () => {
        expect(paneStepsOf({ lines: RECIPE, shownKey: 'spice', sending: new Set(['bread']) }).previousKey).toBe('milk');
    });

    it('a key not among the lines is a host error, said at once', () => {
        expect(() => paneStepsOf({ lines: RECIPE, shownKey: 'gone', sending: NOTHING_SENT })).toThrow(RangeError);
    });
});

describe('pasteMatchPaneViewOf', () => {
    it('says which line it shows out of every line, and heads it with the line', () => {
        const view = pasteMatchPaneViewOf({ lines: RECIPE, shownKey: 'milk', sending: NOTHING_SENT }, ONLINE, m, copy);

        expect(view.position).toBe('Line 2 of 5');
        expect(view.heading).toBe('2 cups milk');
        expect(view.label).toBe('Choose a food');
        expect(view.open.prompt).toBe('Choose the milk you use');
        expect(view.open.list.optionsName).toBe('Food for 2 cups milk');
    });

    it('in the middle, both Previous and Next can be used', () => {
        const view = pasteMatchPaneViewOf({ lines: RECIPE, shownKey: 'bread', sending: NOTHING_SENT }, ONLINE, m, copy);

        expect([view.previous.disabled, view.next.disabled]).toEqual([false, false]);
        expect([view.previous.label, view.next.label]).toEqual(['Previous', 'Next open line']);
    });

    it('the first open line cannot go back, and the last cannot go on', () => {
        const at = (shownKey: string) =>
            pasteMatchPaneViewOf({ lines: RECIPE, shownKey, sending: NOTHING_SENT }, ONLINE, m, copy);

        expect(at('milk').previous.disabled).toBe(true);
        expect(at('spice').next.disabled).toBe(true);
    });

    it('a single open line can go neither way', () => {
        const view = pasteMatchPaneViewOf(
            { lines: [makeConfidentLine(), makeDefaultLine()], shownKey: 'milk', sending: NOTHING_SENT },
            ONLINE,
            m,
            copy,
        );

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

/**
 * ADDED for the AI budget spent (owner ruling 2026-10-26; board ImportPasteNoAiCheck, `import.paste.noAiCheck`): the
 * notice above the ingredient list says this month's check is used up and when it comes back. {date} is
 * `reviewResetsAt` as a day and month in the cook's locale.
 *
 * ⛔ The instant is the first of next month at 00:00 UTC (the spend period's end, ADR-0024), so the date is read in UTC:
 * read in a zone west of UTC it would say "31 October" and name a day before the period ends.
 */
describe('noAiCheckBodyOf', () => {
    const resetsAt = '2026-11-01T00:00:00.000Z';
    const originalZone = process.env['TZ'];

    afterEach(() => {
        if (originalZone === undefined) {
            delete process.env['TZ'];
        } else {
            process.env['TZ'] = originalZone;
        }
    });

    it('says this month’s check is used up and when it comes back, day first in en-GB', () => {
        expect(noAiCheckBodyOf(resetsAt, m, 'en-GB')).toBe(
            'This month’s AI check is used up, so these foods were matched without it, your matches from before included. Confirm or change each one. The check comes back on 1 November.',
        );
    });

    it('puts the month first in en-US', () => {
        expect(noAiCheckBodyOf(resetsAt, m, 'en-US')).toContain('The check comes back on November 1.');
    });

    it('⛔ names the 1st for a cook west of UTC, where the local time is still 31 October', () => {
        process.env['TZ'] = 'America/Los_Angeles';

        expect(noAiCheckBodyOf(resetsAt, m, 'en-GB')).toContain('The check comes back on 1 November.');
    });
});

describe('pasteMatchNoticeFor', () => {
    const spent = makeNeedsChoiceLine({ budgetSpent: { resetsAt: '2026-11-01T00:00:00.000Z' } });
    const base = { quota: undefined, offline: false, keep: 'disk', timeZone: 'UTC', lines: [spent] } as const;

    it('is the AI-check notice when a line was matched without the check', () => {
        expect(pasteMatchNoticeFor(base)).toEqual({ kind: 'noAiCheck', resetsAt: '2026-11-01T00:00:00.000Z' });
    });

    it('is none when no line carries the fact, or the server sent no date', () => {
        expect(pasteMatchNoticeFor({ ...base, lines: [makeNeedsChoiceLine()] })).toBeUndefined();
        expect(
            pasteMatchNoticeFor({ ...base, lines: [makeNeedsChoiceLine({ budgetSpent: { resetsAt: undefined } })] }),
        ).toBeUndefined();
    });

    it('the daily limit and being offline each outrank it: the notice is a status, so one fact at a time', () => {
        expect(pasteMatchNoticeFor({ ...base, quota: { resetsAt: '2026-10-26T04:00:00.000Z' } })).toMatchObject({
            kind: 'quota',
        });
        expect(pasteMatchNoticeFor({ ...base, offline: true })).toEqual({ kind: 'offline', keep: 'disk' });
    });

    it('offline with no lines yet says nothing', () => {
        expect(pasteMatchNoticeFor({ ...base, offline: true, lines: [] })).toBeUndefined();
    });
});

describe('pasteMatchNoticeOf — the AI check', () => {
    it('words the notice with the date', () => {
        expect(pasteMatchNoticeOf({ kind: 'noAiCheck', resetsAt: '2026-11-01T00:00:00.000Z' }, m, 'en-GB')).toBe(
            noAiCheckBodyOf('2026-11-01T00:00:00.000Z', m, 'en-GB'),
        );
    });
});
