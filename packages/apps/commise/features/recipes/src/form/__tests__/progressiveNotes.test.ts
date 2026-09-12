/**
 * Unit tests for `progressiveNotes.ts`: the sentences every food list says about what it could not show, and what a
 * remote pick that put no food on its line says (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P5, P6, P8).
 * Their use inside the entry's list is pinned by `entryCombobox.test.ts`; here each sentence is pinned once.
 */
import { describe, expect, it } from 'vitest';

import type { DatabasePart } from '../../hooks/foodSuggestions.model.js';
import type { LineCommitOutcome, RemoteFoodPick } from '../../hooks/lineCommit.js';
import { seedLineKey } from '../lineKey.js';
import { recipeMessages } from '../../messages.js';
import { recipeFormMessages } from '../messages.js';
import {
    remotePickFailureOf,
    sourceDisplayName,
    unsearchedSentenceOf,
    type SourceNaming,
} from '../progressiveNotes.js';

const form = recipeFormMessages.en;
const remote = recipeMessages.en.ingredientRemoteSearch;
const COPY = { form, remote };

const NAMING: SourceNaming = {
    sourceName: (source) => (source === 'usda' ? 'USDA' : undefined),
    formatTime: () => '3:05 PM',
    formatList: (items) => items.join(', '),
};

const PICK: RemoteFoodPick = { kind: 'remoteFood', reference: 'sealed.g', name: 'Garbanzo beans', source: 'usda' };

describe('sourceDisplayName (P5)', () => {
    it('names a source by the register’s name', () => {
        expect(sourceDisplayName('usda', NAMING, COPY)).toBe('USDA');
    });

    it('names a source the register does not name by the fallback, never by its id', () => {
        expect(sourceDisplayName('cnf', NAMING, COPY)).toBe('another food database');
    });
});

describe('unsearchedSentenceOf (L3)', () => {
    const answered = { kind: 'answered', foods: [] } as const;
    const unavailable = { kind: 'unavailable' } as const;

    it.each<[string, DatabasePart, string | undefined]>([
        ['both answered', { authored: answered, catalog: answered }, undefined],
        ['the catalog failed', { authored: answered, catalog: unavailable }, form.ingredientCatalogUnavailable],
        [
            'the cook’s own foods failed',
            { authored: unavailable, catalog: answered },
            form.ingredientAuthoredUnavailable,
        ],
        ['both failed', { authored: unavailable, catalog: unavailable }, form.ingredientDatabaseUnavailable],
    ])('%s', (_case, database, expected) => {
        expect(unsearchedSentenceOf(database, COPY)).toBe(expected);
    });
});

describe('remotePickFailureOf (P8)', () => {
    it.each<[string, LineCommitOutcome, string | undefined]>([
        [
            'no answer, or the line’s commit failed',
            { kind: 'failed' },
            'We couldn’t add Garbanzo beans from USDA. Try again, or choose another food.',
        ],
        [
            'food refused the hit',
            { kind: 'remoteGone' },
            'Garbanzo beans isn’t available any more. Choose another food.',
        ],
        [
            'the source is busy',
            { kind: 'sourceBusy' },
            'Lookups from USDA aren’t available right now. Try again later.',
        ],
        [
            'the cook’s limit',
            { kind: 'limited', retryAt: 0 },
            'You’ve reached your limit for food lookups. You can try again at 3:05 PM.',
        ],
        [
            'it committed',
            { kind: 'committed', key: seedLineKey(1, 0), binding: { ingredientId: 'ing', isUserEntered: false } },
            undefined,
        ],
        ['a commit already in flight', { kind: 'busy' }, undefined],
        ['the recipe changed', { kind: 'conflict' }, undefined],
    ])('%s', (_case, outcome, expected) => {
        expect(remotePickFailureOf(PICK, outcome, NAMING, COPY)).toBe(expected);
    });
});
