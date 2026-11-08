/**
 * The Recipes screen no longer suspends (plan `recipesScrollPlan.md`, ADR-0079's precedent): the library read is a STATE
 * the frame switches over, `pending | failed | settled`, so the header the frame owns never unmounts under a fallback.
 * `libraryReadingOf` is the one place that turns TanStack's query result into that state.
 */
import { describe, expect, it } from 'vitest';

import { libraryReadingOf, type LibraryReadingSource } from '../libraryReading.js';

const PAGES = { pages: [{ data: [] }] } as const;

const source = (over: Partial<LibraryReadingSource>): LibraryReadingSource => ({
    status: 'pending',
    data: undefined,
    ...over,
});

describe('libraryReadingOf', () => {
    it('is pending while nothing has arrived, whether fetching or parked offline', () => {
        expect(libraryReadingOf(source({ status: 'pending' }))).toEqual({ kind: 'pending' });
    });

    it('is failed when the read errored and there is nothing to show', () => {
        expect(libraryReadingOf(source({ status: 'error' }))).toEqual({ kind: 'failed' });
    });

    it('is settled with its data once the read succeeded', () => {
        expect(libraryReadingOf(source({ status: 'success', data: PAGES }))).toEqual({ kind: 'settled', data: PAGES });
    });

    it('stays settled when a REFRESH failed but the library on screen is still there (the refresh notice speaks)', () => {
        expect(libraryReadingOf(source({ status: 'error', data: PAGES }))).toEqual({ kind: 'settled', data: PAGES });
    });

    it('stays settled while a new sort loads over the previous library (placeholder data)', () => {
        expect(libraryReadingOf(source({ status: 'success', data: PAGES }))).toMatchObject({ kind: 'settled' });
    });
});
