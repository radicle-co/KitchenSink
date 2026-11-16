import { describe, expect, it } from 'vitest';

import { PUBLIC_CONFIRMATION_FOR_API_WRITERS } from '@kitchensink/recipe-core';

import type { RecipeStatementInput } from '../../recipes.schema.js';
import { attestationRowsOf, publicConfirmationDutyOf } from '../statementAttestation.js';

const AUTHORED = {
    kind: 'authored',
    wording: { version: 'statementAuthored.v1', locale: 'en' },
} as const satisfies RecipeStatementInput;
const WEB = {
    kind: 'public_web',
    citation: 'https://www.allrecipes.com/recipe/1/soup/',
    wording: { version: 'statementPublicWeb.v1', locale: 'en' },
} as const satisfies RecipeStatementInput;
const BOOK = {
    kind: 'book',
    citation: 'Joy of Cooking',
    wording: { version: 'statementBook.v1', locale: 'fr-CA' },
} as const satisfies RecipeStatementInput;
const PERSON = {
    kind: 'fromPerson',
    wording: { version: 'statementFromPerson.v1', locale: 'en' },
} as const satisfies RecipeStatementInput;
const CONFIRM = PUBLIC_CONFIRMATION_FOR_API_WRITERS;

describe('publicConfirmationDutyOf — when a write must carry the passive Public confirmation', () => {
    const DRAFT_PRIVATE = { status: 'draft', visibility: 'private' } as const;
    const DRAFT_PUBLIC = { status: 'draft', visibility: 'public' } as const;
    const LIVE_PRIVATE = { status: 'published', visibility: 'private' } as const;
    const LIVE_PUBLIC = { status: 'published', visibility: 'public' } as const;

    it.each([
        // [name, before, after, required, recordedWhenSupplied]
        ['a create that is published and public', undefined, LIVE_PUBLIC, true, true],
        [
            'a create that is a public DRAFT (the cook chose Public; nothing is live)',
            undefined,
            DRAFT_PUBLIC,
            false,
            true,
        ],
        ['a create that is published and private', undefined, LIVE_PRIVATE, false, false],
        ['a create that is a private draft', undefined, DRAFT_PRIVATE, false, false],
        ['a publish of a public draft', DRAFT_PUBLIC, LIVE_PUBLIC, true, true],
        ['a publish of a private draft that stays private', DRAFT_PRIVATE, LIVE_PRIVATE, false, false],
        ['a move to public of a published private recipe', LIVE_PRIVATE, LIVE_PUBLIC, true, true],
        ['a move to public of a private draft (the editor’s Public choice)', DRAFT_PRIVATE, DRAFT_PUBLIC, false, true],
        [
            'a save of a recipe that is already published and public (nothing changes state)',
            LIVE_PUBLIC,
            LIVE_PUBLIC,
            false,
            false,
        ],
        ['a save of a public draft that stays a draft', DRAFT_PUBLIC, DRAFT_PUBLIC, false, false],
        ['a move to private of a published public recipe', LIVE_PUBLIC, LIVE_PRIVATE, false, false],
        ['a re-draft of a published public recipe', LIVE_PUBLIC, DRAFT_PUBLIC, false, false],
    ] as const)('%s', (_name, before, after, required, recorded) => {
        expect(publicConfirmationDutyOf({ before, after, authoredInWrite: false })).toEqual({
            required,
            recordedWhenSupplied: recorded,
        });
    });
});

describe('publicConfirmationDutyOf — an explicit "I wrote this" in the same write', () => {
    const DRAFT_PUBLIC = { status: 'draft', visibility: 'public' } as const;
    const LIVE_PRIVATE = { status: 'published', visibility: 'private' } as const;
    const LIVE_PUBLIC = { status: 'published', visibility: 'public' } as const;

    it.each([
        ['a create that is published and public', undefined, LIVE_PUBLIC],
        ['a publish of a public draft', DRAFT_PUBLIC, LIVE_PUBLIC],
        ['a move to public of a published private recipe', LIVE_PRIVATE, LIVE_PUBLIC],
    ] as const)('%s owes no separate confirmation, and still records one it was sent', (_name, before, after) => {
        expect(publicConfirmationDutyOf({ before, after, authoredInWrite: true })).toEqual({
            required: false,
            recordedWhenSupplied: true,
        });
    });

    it('does not make a write that stays private record a confirmation', () => {
        expect(publicConfirmationDutyOf({ before: LIVE_PRIVATE, after: LIVE_PRIVATE, authoredInWrite: true })).toEqual({
            required: false,
            recordedWhenSupplied: false,
        });
    });
});

describe('attestationRowsOf — exactly which rows a write leaves', () => {
    const STATEMENT_ROW = (choice: string, version: string, locale: string, action: string) => ({
        mode: 'explicit',
        choice,
        wordingVersion: version,
        locale,
        action,
    });
    const CONFIRM_ROW = (action: string) => ({
        mode: 'implicit',
        choice: 'publicConfirm',
        wordingVersion: 'publicConfirm.v1',
        locale: 'en',
        action,
    });

    it.each([
        ['authored', AUTHORED, 'authored', 'statementAuthored.v1', 'en'],
        ['public_web', WEB, 'publicWeb', 'statementPublicWeb.v1', 'en'],
        ['book', BOOK, 'book', 'statementBook.v1', 'fr-CA'],
        ['fromPerson', PERSON, 'fromPerson', 'statementFromPerson.v1', 'en'],
    ] as const)(
        'records a %s statement as one explicit row naming its wording and locale',
        (_kind, statement, choice, version, locale) => {
            for (const action of ['create', 'update', 'setVisibility'] as const) {
                expect(
                    attestationRowsOf({ action, statement, publicConfirmation: undefined, recordsConfirmation: false }),
                ).toEqual([STATEMENT_ROW(choice, version, locale, action)]);
            }
        },
    );

    it('records NO statement row for a web statement that carries no wording (the Source row), and still the confirmation', () => {
        const { wording: _none, ...wordless } = WEB;

        for (const action of ['create', 'update', 'setVisibility'] as const) {
            expect(
                attestationRowsOf({
                    action,
                    statement: wordless,
                    publicConfirmation: undefined,
                    recordsConfirmation: false,
                }),
            ).toEqual([]);
            expect(
                attestationRowsOf({ action, statement: wordless, publicConfirmation: CONFIRM, recordsConfirmation: true }),
            ).toEqual([CONFIRM_ROW(action)]);
        }
    });

    it('records a cleared statement (null) as an explicit row with no wording and no locale', () => {
        expect(
            attestationRowsOf({
                action: 'update',
                statement: null,
                publicConfirmation: undefined,
                recordsConfirmation: false,
            }),
        ).toEqual([{ mode: 'explicit', choice: 'cleared', wordingVersion: null, locale: null, action: 'update' }]);
    });

    it('records NOTHING for an absent statement and no confirmation', () => {
        expect(
            attestationRowsOf({
                action: 'update',
                statement: undefined,
                publicConfirmation: undefined,
                recordsConfirmation: false,
            }),
        ).toEqual([]);
    });

    it('records a supplied confirmation as one implicit row only when the duty says it is recorded', () => {
        expect(
            attestationRowsOf({
                action: 'create',
                statement: undefined,
                publicConfirmation: CONFIRM,
                recordsConfirmation: true,
            }),
        ).toEqual([CONFIRM_ROW('create')]);
        expect(
            attestationRowsOf({
                action: 'create',
                statement: undefined,
                publicConfirmation: CONFIRM,
                recordsConfirmation: false,
            }),
        ).toEqual([]);
    });

    it('records nothing when the duty says record but no confirmation was supplied', () => {
        expect(
            attestationRowsOf({
                action: 'setVisibility',
                statement: undefined,
                publicConfirmation: undefined,
                recordsConfirmation: true,
            }),
        ).toEqual([]);
    });

    it('leaves BOTH rows from one request, the statement first', () => {
        expect(
            attestationRowsOf({
                action: 'setVisibility',
                statement: AUTHORED,
                publicConfirmation: CONFIRM,
                recordsConfirmation: true,
            }),
        ).toEqual([
            STATEMENT_ROW('authored', 'statementAuthored.v1', 'en', 'setVisibility'),
            CONFIRM_ROW('setVisibility'),
        ]);
    });

    it('records a cleared statement together with a confirmation, in that order', () => {
        expect(
            attestationRowsOf({
                action: 'update',
                statement: null,
                publicConfirmation: CONFIRM,
                recordsConfirmation: true,
            }),
        ).toEqual([
            { mode: 'explicit', choice: 'cleared', wordingVersion: null, locale: null, action: 'update' },
            CONFIRM_ROW('update'),
        ]);
    });
});
