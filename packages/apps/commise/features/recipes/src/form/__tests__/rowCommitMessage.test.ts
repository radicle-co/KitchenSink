/**
 * Unit tests for `rowCommitMessage.ts` — what a row says once a pick on it settles: politely on success (§4 "Entry,
 * selected", `docs/design/rowEditorOpenDecisions.md` item 1, `ingredientSpecialization.md` §S2), and the failure the
 * row shows and says assertively (items 1 and 4). A remote pick's own outcomes say what P8 names
 * (`docs/design/rowEditorOpenDecisions.md`, S7 list contract), and its caption names the source it adds from.
 */
import { describe, expect, it } from 'vitest';

import { FoodResolutionStatus } from '@kitchensink/recipe-core';

import type { SettledRowCommit } from '../../hooks/useIngredientRowEditor.js';
import { recipeMessages } from '../../messages.js';
import type { LineBinding } from '../lineBinding.js';
import { seedLineKey } from '../lineKey.js';
import { recipeFormMessages } from '../messages.js';
import {
    failureAt,
    rowBusyText,
    rowCommittedMessage,
    rowPendingSentence,
    rowPickFailedMessage,
    rowSettledView,
    type RowCommitCopy,
} from '../rowCommitMessage.js';

const COPY: RowCommitCopy = {
    form: recipeFormMessages.en,
    added: recipeMessages.en.ingredientPickerStatus.added,
    details: recipeMessages.en.ingredientDetails,
    remote: recipeMessages.en.ingredientRemoteSearch,
};

/** How the rows name a source and say a time. */
const NAMING = {
    sourceName: (source: string) => (source === 'usda' ? 'USDA' : undefined),
    formatTime: () => '3:05 PM',
    formatList: (items: readonly string[]) => items.join(', '),
};
const details = recipeMessages.en.ingredientDetails;

const binding = (over: Partial<LineBinding> = {}): LineBinding => ({
    ingredientId: 'ing_1',
    isUserEntered: false,
    name: 'beef brisket',
    resolutionStatus: FoodResolutionStatus.RESOLVED,
    ...over,
});

describe('rowCommittedMessage', () => {
    it('a matched food: its nutrition now counts', () => {
        expect(rowCommittedMessage(binding(), 'beef brisket', COPY)).toBe(
            'beef brisket is matched. Its nutrition now counts.',
        );
    });

    it('a line the read has not stated a status for is the seed’s RESOLVED', () => {
        const { resolutionStatus: _status, ...unstated } = binding();

        expect(rowCommittedMessage(unstated, 'beef brisket', COPY)).toBe(
            'beef brisket is matched. Its nutrition now counts.',
        );
    });

    it('a variant: the food and its parts, comma-joined as a screen reader speaks them (§S2)', () => {
        const variant = {
            id: 'var_flat',
            parts: [
                { attribute: 'cut', text: 'flat half' },
                { attribute: 'grade', text: 'select' },
            ],
        };

        expect(rowCommittedMessage(binding({ variant }), 'beef brisket', COPY)).toBe(
            'Matched: beef brisket, flat half, select. Nutrition is counted now.',
        );
    });

    it('UNRESOLVED: it names the glyph the cook uses to choose (item 1)', () => {
        expect(
            rowCommittedMessage(binding({ resolutionStatus: FoodResolutionStatus.UNRESOLVED }), 'chickpeas', COPY),
        ).toBe('Added chickpeas. It could be more than one food. Use its “Choose a match” line to choose one.');
    });

    it('a declaration claims no match: it says only that the line was added', () => {
        expect(
            rowCommittedMessage(binding({ isUserEntered: true, resolutionStatus: undefined }), 'grandma’s mix', COPY),
        ).toBe('Added grandma’s mix');
    });

    it.each([FoodResolutionStatus.PENDING, FoodResolutionStatus.PENDING_VERIFICATION, FoodResolutionStatus.NOT_FOUND])(
        '%s claims no match either',
        (resolutionStatus) => {
            expect(rowCommittedMessage(binding({ resolutionStatus }), 'saffron', COPY)).toBe('Added saffron');
        },
    );
});

describe('rowPickFailedMessage', () => {
    it('in Change food it says the line still uses its food (item 4)', () => {
        expect(rowPickFailedMessage({ changing: true, food: 'beef brisket', text: 'brisket flat' }, COPY)).toBe(
            'The change didn’t save. This ingredient still uses beef brisket.',
        );
    });

    it('on a row that names no food, or a declared one, it quotes the typed text (item 1)', () => {
        expect(rowPickFailedMessage({ changing: false, food: 'Kale', text: '  curly kale ' }, COPY)).toBe(
            'We couldn’t add “curly kale”. Try again, or use it as written.',
        );
    });
});

describe('rowSettledView — what a settled commit makes its row say, by the surface it came from', () => {
    const KEY = seedLineKey(1, 0);
    const APPENDED = seedLineKey(1, 1);
    const LINE = { kind: 'line', key: KEY } as const;
    const TRAILING = { kind: 'newLine' } as const;
    const FLAT = { id: 'var_flat', parts: [{ attribute: 'cut', text: 'flat half' }] };
    const committed = (over: Partial<LineBinding> = {}, key = KEY) =>
        ({ kind: 'committed', key, binding: binding(over) }) as const;
    const row = { food: 'beef brisket', changing: false, text: '' };
    const settled = (over: Partial<SettledRowCommit>): SettledRowCommit => ({
        origin: { kind: 'entry' },
        pick: { kind: 'name', text: 'brisket' },
        target: LINE,
        outcome: committed(),
        ...over,
    });
    const SILENT = { polite: '', failure: undefined };

    it('nothing settled: nothing said', () => {
        expect(rowSettledView(undefined, () => row, COPY, NAMING)).toEqual(SILENT);
    });

    it('an entry pick that committed: the matched sentence, politely', () => {
        expect(rowSettledView(settled({}), () => row, COPY, NAMING)).toEqual({
            polite: 'beef brisket is matched. Its nutrition now counts.',
            failure: undefined,
        });
    });

    it('an entry pick that failed in Change food: the row shows that it keeps its food (item 4)', () => {
        const view = rowSettledView(
            settled({ outcome: { kind: 'failed' } }),
            () => ({ ...row, changing: true }),
            COPY,
            NAMING,
        );

        expect(view).toEqual({
            polite: '',
            failure: { at: LINE, text: 'The change didn’t save. This ingredient still uses beef brisket.' },
        });
    });

    it.each([
        ['created', 'Saved to your foods, and this ingredient now uses it.'],
        ['reused', 'You already had a food with that name — this ingredient now uses it.'],
    ] as const)('an authored food that committed (%s) says so; created and reused differ', (outcome, sentence) => {
        // The same pick either way: what differs is the fact the form recorded, never the pick's shape.
        const pick = { kind: 'catalogFood', foodId: 'food_mine', name: 'saffron' } as const;

        expect(
            rowSettledView(settled({ origin: { kind: 'authoredFood', outcome }, pick }), () => row, COPY, NAMING)
                .polite,
        ).toBe(sentence);
    });

    it('a shortlist pick that committed says the row is matched, as an entry pick does (row 7)', () => {
        const view = rowSettledView(settled({ origin: { kind: 'shortlist' } }), () => row, COPY, NAMING);

        expect(view).toEqual({ polite: 'beef brisket is matched. Its nutrition now counts.', failure: undefined });
    });

    it('a shortlist pick that failed says nothing at the row: the panel says it (row 7)', () => {
        expect(
            rowSettledView(
                settled({ origin: { kind: 'shortlist' }, outcome: { kind: 'failed' } }),
                () => row,
                COPY,
                NAMING,
            ),
        ).toEqual(SILENT);
    });

    it('an authored food that failed says nothing at the row: the Sheet keeps it, with the draft', () => {
        expect(
            rowSettledView(
                settled({ origin: { kind: 'authoredFood', outcome: 'created' }, outcome: { kind: 'failed' } }),
                () => row,
                COPY,
                NAMING,
            ),
        ).toEqual(SILENT);
    });

    it.each([
        ['add', details.statusAdded.replace('{parts}', 'flat half')],
        ['edit', details.statusChanged.replace('{parts}', 'flat half')],
    ] as const)('a details pick in %s mode names the parts it bound', (mode, sentence) => {
        const view = rowSettledView(
            settled({
                origin: { kind: 'details', mode },
                pick: { kind: 'catalogVariant', foodVariantId: 'var_flat' },
                outcome: committed({ variant: FLAT }),
            }),
            () => row,
            COPY,
            NAMING,
        );

        expect(view.polite).toBe(sentence);
    });

    it('Remove details says the details went', () => {
        const view = rowSettledView(
            settled({
                origin: { kind: 'details', mode: 'edit' },
                pick: { kind: 'catalogFood', foodId: 'food_brisket', name: 'beef brisket' },
            }),
            () => row,
            COPY,
            NAMING,
        );

        expect(view.polite).toBe(details.statusRemoved);
    });

    it('a details write the server refused: the row shows saveRejected, with no Retry (§S12 row 11)', () => {
        const view = rowSettledView(
            settled({ origin: { kind: 'details', mode: 'add' }, outcome: { kind: 'failed' } }),
            () => row,
            COPY,
            NAMING,
        );

        expect(view.failure).toEqual({ at: LINE, text: details.saveRejected });
    });

    it('a conflict says nothing at the row: the editor shows its conflict view', () => {
        expect(rowSettledView(settled({ outcome: { kind: 'conflict' } }), () => row, COPY, NAMING)).toEqual(SILENT);
    });

    it('a row that has gone says nothing', () => {
        expect(rowSettledView(settled({}), () => undefined, COPY, NAMING)).toEqual(SILENT);
    });

    // P8: a remote pick's failures, said at the field it was made on.
    it.each<[string, SettledRowCommit['outcome'], string]>([
        ['failed', { kind: 'failed' }, 'We couldn’t add Garbanzo beans from USDA. Try again, or choose another food.'],
        ['refused by food', { kind: 'remoteGone' }, 'Garbanzo beans isn’t available any more. Choose another food.'],
        ['refused as busy', { kind: 'sourceBusy' }, 'Lookups from USDA aren’t available right now. Try again later.'],
        [
            'refused for the cook’s limit',
            { kind: 'limited', retryAt: 0 },
            'You’ve reached your limit for food lookups. You can try again at 3:05 PM.',
        ],
    ])('an entry remote pick that %s: the row shows what P8 says', (_case, outcome, text) => {
        const view = rowSettledView(
            settled({
                pick: { kind: 'remoteFood', reference: 'sealed.g', name: 'Garbanzo beans', source: 'usda' },
                outcome,
            }),
            () => row,
            COPY,
            NAMING,
        );

        expect(view).toEqual({ polite: '', failure: { at: LINE, text } });
    });

    describe('the trailing row (B8, §2d: the F1 loop)', () => {
        /** The trailing field still holds "chickpeas"; the appended row reads "Chickpeas, canned". */
        const rowOf = (target: Parameters<Parameters<typeof rowSettledView>[1]>[0]) =>
            target.kind === 'newLine'
                ? { food: '', changing: false, text: 'chickpeas' }
                : target.key === APPENDED
                  ? { food: 'Chickpeas, canned', changing: false, text: '' }
                  : undefined;

        it('a pick that committed speaks for the row it appended', () => {
            const view = rowSettledView(
                settled({ target: TRAILING, outcome: committed({ name: 'Chickpeas, canned' }, APPENDED) }),
                rowOf,
                COPY,
                NAMING,
            );

            expect(view).toEqual({
                polite: 'Chickpeas, canned is matched. Its nutrition now counts.',
                failure: undefined,
            });
        });

        it('an appended line that landed UNRESOLVED names the glyph the cook chooses with (item 1)', () => {
            const view = rowSettledView(
                settled({
                    target: TRAILING,
                    outcome: committed({ resolutionStatus: FoodResolutionStatus.UNRESOLVED }, APPENDED),
                }),
                rowOf,
                COPY,
                NAMING,
            );

            expect(view.polite).toBe(
                recipeFormMessages.en.ingredientAddedNeedsChoice.replaceAll('{name}', 'Chickpeas, canned'),
            );
        });

        it('a pick that failed shows at the trailing field, quoting what it still holds (item 1)', () => {
            const view = rowSettledView(
                settled({ target: TRAILING, outcome: { kind: 'failed' } }),
                rowOf,
                COPY,
                NAMING,
            );

            expect(view).toEqual({
                polite: '',
                failure: { at: TRAILING, text: 'We couldn’t add “chickpeas”. Try again, or use it as written.' },
            });
        });

        it('a food made from the trailing row says it was saved and used', () => {
            const view = rowSettledView(
                settled({
                    origin: { kind: 'authoredFood', outcome: 'created' },
                    target: TRAILING,
                    pick: { kind: 'catalogFood', foodId: 'food_mine', name: 'saffron' },
                    outcome: committed({}, APPENDED),
                }),
                rowOf,
                COPY,
                NAMING,
            );

            expect(view.polite).toBe('Saved to your foods, and this ingredient now uses it.');
        });
    });
});

describe('failureAt — the field a settled failure shows at', () => {
    const KEY = seedLineKey(1, 0);
    const OTHER = seedLineKey(1, 1);
    const atRow = { polite: '', failure: { at: { kind: 'line', key: KEY }, text: 'It failed.' } } as const;
    const atTrailing = { polite: '', failure: { at: { kind: 'newLine' }, text: 'It failed.' } } as const;

    it('shows at its own row, and nowhere else', () => {
        expect(failureAt(atRow, { kind: 'line', key: KEY })).toBe('It failed.');
        expect(failureAt(atRow, { kind: 'line', key: OTHER })).toBeUndefined();
        expect(failureAt(atRow, { kind: 'newLine' })).toBeUndefined();
    });

    it('a trailing failure shows at the trailing field, and at no row', () => {
        expect(failureAt(atTrailing, { kind: 'newLine' })).toBe('It failed.');
        expect(failureAt(atTrailing, { kind: 'line', key: KEY })).toBeUndefined();
    });

    it('nothing failed: nothing shows', () => {
        expect(failureAt({ polite: 'Added.', failure: undefined }, { kind: 'newLine' })).toBeUndefined();
    });
});

describe('rowBusyText — what a pick in flight is doing (§S13 P11)', () => {
    it.each([
        [{ kind: 'name', text: 'saffron' } as const, recipeFormMessages.en.ingredientEntryAddingByName],
        [
            { kind: 'catalogFood', foodId: 'f', name: 'Saffron' } as const,
            recipeFormMessages.en.ingredientEntryAddingFromCatalog,
        ],
        [
            { kind: 'catalogVariant', foodVariantId: 'v' } as const,
            recipeFormMessages.en.ingredientEntryAddingFromCatalog,
        ],
    ])('%o', (pick, text) => {
        expect(rowBusyText(pick, COPY, NAMING)).toBe(text);
    });

    it('a remote pick names the source it adds from, through the register (P8)', () => {
        expect(
            rowBusyText({ kind: 'remoteFood', reference: 'r', name: 'Garbanzo', source: 'usda' }, COPY, NAMING),
        ).toBe('Adding from USDA');
        expect(rowBusyText({ kind: 'remoteFood', reference: 'r', name: 'Garbanzo', source: 'cnf' }, COPY, NAMING)).toBe(
            'Adding from another food database',
        );
    });

    it('nothing in flight, or a declaration, which looks nothing up: no caption', () => {
        expect(rowBusyText(undefined, COPY, NAMING)).toBeUndefined();
        expect(rowBusyText({ kind: 'declared', text: 'grandma’s mix' }, COPY, NAMING)).toBeUndefined();
    });
});

describe('rowPendingSentence (the row sentence after a refused save or Next, R7)', () => {
    const row = { refused: true, pending: true, changing: false, text: '  saffron ', food: 'Beef brisket' };

    it.each([
        ['no refusal', { ...row, refused: false }],
        ['refused, but this row holds nothing pending', { ...row, pending: false }],
    ])('%s: none', (_case, input) => {
        expect(rowPendingSentence(input, recipeFormMessages.en)).toBeUndefined();
    });

    it('a row that names no food: the trimmed text, and clear the box', () => {
        expect(rowPendingSentence(row, recipeFormMessages.en)).toBe(
            '“saffron” isn’t in the recipe yet. Choose a food for it, or clear the box.',
        );
    });

    it('a row in Change food: Cancel keeps the food it still uses', () => {
        expect(rowPendingSentence({ ...row, changing: true }, recipeFormMessages.en)).toBe(
            '“saffron” isn’t in the recipe yet. Choose a food for it, or press Cancel to keep Beef brisket.',
        );
    });
});
