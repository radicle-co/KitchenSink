/**
 * `headerSourceProps` hands the header exactly the "copied from" facts a collection has, and OMITS the rest: the
 * header's props are optional under `exactOptionalPropertyTypes`, so a key present with `undefined` is a type error
 * and, at runtime, would read as "stated" to a `'x' in props` check.
 */
import { describe, expect, it } from 'vitest';

import { headerSourceProps } from '../collectionHeaderSource.js';

describe('headerSourceProps', () => {
    it('is empty for a collection that is not a copy and was never pulled', () => {
        expect(headerSourceProps({})).toEqual({});
        expect(Object.keys(headerSourceProps({ sourceCollectionName: undefined, lastPulledAt: undefined }))).toEqual(
            [],
        );
    });

    it('carries every fact the collection states, under the header prop it names', () => {
        expect(
            headerSourceProps({
                sourceCollectionName: 'Weeknights',
                sourceOwnerDisplayName: 'Ana',
                sourceOwnerUsername: 'ana',
                sourceCollectionId: 'col_1',
                lastPulledAt: '2026-10-01T10:00:00.000Z',
            }),
        ).toEqual({
            sourceCollectionName: 'Weeknights',
            sourceOwnerDisplayName: 'Ana',
            sourceOwnerUsername: 'ana',
            sourceCollectionId: 'col_1',
            lastPulledAt: '2026-10-01T10:00:00.000Z',
        });
    });

    it('carries only the facts stated, so a copy whose owner left keeps its name and id', () => {
        expect(headerSourceProps({ sourceCollectionName: 'Weeknights', sourceCollectionId: 'col_1' })).toEqual({
            sourceCollectionName: 'Weeknights',
            sourceCollectionId: 'col_1',
        });
    });

    it('keeps an empty string: the owner stated it, even though it shows nothing', () => {
        expect(headerSourceProps({ sourceOwnerDisplayName: '' })).toEqual({ sourceOwnerDisplayName: '' });
    });
});
