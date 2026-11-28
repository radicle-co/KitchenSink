/**
 * The source-statement sheet's purposes (ADR-0100): which answers each one offers, where the lock note shows, which wording
 * version a write records, and what the sheet draws for each. The oracle is the designer's D1 and D3 and qse's batch 4: the
 * recorded wording is the text the cook saw, so a note that was shown makes a v2 and one that was not stays v1.
 */
import { describe, expect, it } from 'vitest';

import { recipeActionMessages } from '../messages.js';
import { sheetViewOf } from '../sourceStatementSheetModel.js';
import {
    answersFor,
    confirmsAt,
    initialSheet,
    answerLocks,
    statementAnswerOf,
    statementWriteOf,
    type StatementAnswer,
    type StatementSurface,
} from '../sourceStatement.js';

const { sourceStatement: m } = recipeActionMessages.en;
const shared = { source: { invalid: 'invalid', ownSite: 'own site' }, failure: 'failed' } as const;
const FIELDS = {
    link: 'https://example.com/a',
    bookTitle: 'The Sunday Roast Book',
    paidSite: 'Sam’s Kitchen',
} as const;

describe('answersFor: the answers each purpose offers (designer D1, D3)', () => {
    it.each<[StatementSurface, readonly StatementAnswer[]]>([
        ['editor', ['authored', 'publicWeb', 'paidSite', 'book', 'fromPerson', 'publishPrivately']],
        ['recipePage', ['authored', 'publicWeb', 'paidSite', 'book', 'fromPerson']],
        ['recipePageOwn', ['authored', 'book', 'paidSite']],
        ['firstAnswer', ['book', 'paidSite', 'fromPerson']],
        ['change', ['authored', 'publicWeb', 'paidSite', 'book', 'fromPerson']],
        ['downgrade', ['book', 'paidSite']],
    ])('%s offers exactly its answers, in order', (surface, expected) => {
        expect([...answersFor(surface)].sort((a, b) => a.localeCompare(b))).toEqual(
            [...expected].sort((a, b) => a.localeCompare(b)),
        );
    });

    it('never offers a refused answer to a confirmed "I wrote this": no web page, no person', () => {
        for (const surface of ['recipePageOwn', 'downgrade'] as const) {
            expect(answersFor(surface)).not.toContain('publicWeb');
            expect(answersFor(surface)).not.toContain('fromPerson');
        }
    });

    it('never offers "I wrote this" in the downgrade, and never "Publish privately" outside the editor’s publish', () => {
        expect(answersFor('downgrade')).not.toContain('authored');

        for (const surface of ['recipePage', 'recipePageOwn', 'firstAnswer', 'change', 'downgrade'] as const) {
            expect(answersFor(surface)).not.toContain('publishPrivately');
        }
    });
});

describe('answerLocks: the one rule for whether confirming an answer locks it (designer D1)', () => {
    // Written out by hand, never derived from `confirmsAt`: a cell is the rule's own claim. `confirmed` is the recipe's source.
    const table: ReadonlyArray<readonly [StatementAnswer, StatementSurface, boolean, boolean]> = [
        ...(['editor', 'recipePage', 'recipePageOwn', 'downgrade'] as const).flatMap((surface) => [
            ['publicWeb', surface, false, true] as const,
            ['book', surface, false, true] as const,
        ]),
        ...(['firstAnswer', 'change'] as const).flatMap((surface) => [
            ['publicWeb', surface, false, false] as const,
            ['book', surface, false, false] as const,
        ]),
        ...(['editor', 'recipePage', 'recipePageOwn', 'firstAnswer', 'change', 'downgrade'] as const).flatMap(
            (surface) => [
                ['publicWeb', surface, true, true] as const,
                ['book', surface, true, true] as const,
                ['paidSite', surface, false, true] as const,
                ['paidSite', surface, true, true] as const,
                ['fromPerson', surface, false, true] as const,
                ['fromPerson', surface, true, true] as const,
                ['authored', surface, false, false] as const,
                ['authored', surface, true, false] as const,
                ['publishPrivately', surface, false, false] as const,
                ['publishPrivately', surface, true, false] as const,
            ],
        ),
    ];

    it.each(table)('%s on %s, recipe confirmed %s: locks %s', (answer, surface, recipeConfirmed, expected) => {
        expect(answerLocks({ answer, surface, recipeConfirmed })).toBe(expected);
    });

    it('covers every answer on every surface, confirmed or not', () => {
        const keys = new Set(table.map(([answer, surface, confirmed]) => `${answer}|${surface}|${String(confirmed)}`));

        expect(keys.size).toBe(6 * 6 * 2);
    });

    it('the acts that confirm are Publish, Make public and the downgrade, and not an answer on a draft', () => {
        const surfaces: readonly StatementSurface[] = [
            'editor',
            'recipePage',
            'recipePageOwn',
            'firstAnswer',
            'change',
            'downgrade',
        ];

        expect(surfaces.filter(confirmsAt)).toEqual(['editor', 'recipePage', 'recipePageOwn', 'downgrade']);
    });
});

describe('statementAnswerOf and statementWriteOf pair every answer with one statement kind', () => {
    it.each(['authored', 'publicWeb', 'paidSite', 'book', 'fromPerson'] as const)('%s round-trips', (answer) => {
        const statement = statementWriteOf(answer, FIELDS, 'en', false).statement;

        expect(statement).toBeDefined();
        expect(statement && statementAnswerOf(statement.kind)).toBe(answer);
    });
});

describe('statementAnswerOf: the sheet answer a stored statement kind came from', () => {
    it.each([
        ['authored', 'authored'],
        ['public_web', 'publicWeb'],
        ['paid_site', 'paidSite'],
        ['book', 'book'],
        ['fromPerson', 'fromPerson'],
    ] as const)('%s is the %s answer', (kind, answer) => {
        expect(statementAnswerOf(kind)).toBe(answer);
    });
});

describe('statementWriteOf: the recorded wording is the text the cook saw', () => {
    it.each([
        ['book', 'statementBook'],
        ['publicWeb', 'statementPublicWeb'],
        ['fromPerson', 'statementFromPerson'],
    ] as const)('%s records v2 when the lock note was shown and v1 when it was not', (answer, key) => {
        expect(statementWriteOf(answer, FIELDS, 'en', true).statement).toMatchObject({
            wording: { version: `${key}.v2`, locale: 'en' },
        });
        expect(statementWriteOf(answer, FIELDS, 'en', false).statement).toMatchObject({
            wording: { version: `${key}.v1`, locale: 'en' },
        });
    });

    it('a paid website and "I wrote this" have one version, whether the note was shown or not', () => {
        for (const shown of [false, true]) {
            expect(statementWriteOf('paidSite', FIELDS, 'en', shown).statement).toMatchObject({
                wording: { version: 'statementPaidSite.v1' },
            });
            expect(statementWriteOf('authored', FIELDS, 'en', shown).statement).toMatchObject({
                wording: { version: 'statementAuthored.v1' },
            });
        }
    });
});

describe('sheetViewOf: what each purpose draws', () => {
    const view = (surface: StatementSurface, over: { recipeConfirmed?: boolean } = {}) =>
        sheetViewOf({
            surface,
            state: initialSheet(),
            messages: m,
            shared,
            recipeConfirmed: over.recipeConfirmed === true,
        });

    it('the downgrade carries its body, and the row modes carry none (designer boards)', () => {
        expect(view('downgrade').body).toBe(m.bodyDowngrade);
        expect(view('firstAnswer').body).toBeUndefined();
        expect(view('change').body).toBeUndefined();
        expect(view('editor').body).toBe(m.body);
        expect(view('recipePage').body).toBe(m.body);
    });

    it('the row modes say Confirm and Cancel, and the downgrade its own Confirm', () => {
        expect([view('firstAnswer').confirmLabel, view('firstAnswer').dismissLabel]).toEqual([
            m.confirmAnswer,
            m.dismissAnswer,
        ]);
        expect([view('change').confirmLabel, view('change').dismissLabel]).toEqual([m.confirmAnswer, m.dismissAnswer]);
        expect([view('downgrade').confirmLabel, view('downgrade').dismissLabel]).toEqual([
            m.confirmDowngrade,
            m.dismissAnswer,
        ]);
    });

    it('draws the lock note after the hint, in the same block, exactly where answerLocks says', () => {
        const options = (surface: StatementSurface, confirmed = false) =>
            Object.fromEntries(view(surface, { recipeConfirmed: confirmed }).options.map((o) => [o.id, o.hint]));

        expect(options('firstAnswer').paidSite).toBe(`${m.hintPaidSite} ${m.lockNote}`);
        expect(options('firstAnswer').fromPerson).toBe(`${m.hintPerson} ${m.lockNote}`);
        expect(options('firstAnswer').book).toBe(m.hintPrivate);
        expect(options('firstAnswer', true).book).toBe(`${m.hintPrivate} ${m.lockNote}`);
        expect(options('downgrade').book).toBe(`${m.hintPrivate} ${m.lockNote}`);
        expect(options('change').authored).toBe(m.hintAuthored);
    });
});
