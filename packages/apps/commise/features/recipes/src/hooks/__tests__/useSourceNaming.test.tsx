/**
 * Tests for {@link useSourceNaming}: how every food list names a remote source and says a list of them and a time, in
 * the cook's locale (`docs/design/rowEditorOpenDecisions.md`, S7 list contract P5 and P6). A source is named by the
 * register's short name, else its name, read through `useDataSources`; an unread or unknown source has no name here,
 * so the list says the fallback (`progressiveNotes.ts`), never the raw id. The hook builds its own time format, so
 * every surface says a time the same way; the last case pins that format against a reference built from the locale.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeDataSource } from '../../dataSources/__fixtures__/makeDataSource.js';

const mocks = vi.hoisted(() => ({ useDataSources: vi.fn() }));

vi.mock('@kitchensink/food-service-client/hooks', () => ({ useDataSources: mocks.useDataSources }));
vi.mock('@commise/i18n/react', () => ({ useLocale: () => 'en' }));

import { useSourceNaming } from '../useSourceNaming.js';

const SOURCES = {
    sources: [
        makeDataSource({ id: 'usda', shortName: 'USDA', name: 'USDA FoodData Central' }),
        makeDataSource({ id: 'sfcd', shortName: undefined, name: 'Swiss Food Composition Database' }),
    ],
};

beforeEach(() => {
    mocks.useDataSources.mockReturnValue({ data: SOURCES });
});

describe('useSourceNaming', () => {
    it('names a source by its short name, else its name', () => {
        const { result } = renderHook(() => useSourceNaming());

        expect(result.current.sourceName('usda')).toBe('USDA');
        expect(result.current.sourceName('sfcd')).toBe('Swiss Food Composition Database');
    });

    it.each([
        ['unknown to the register', { data: SOURCES }, 'cnf'],
        ['while the register is unread', { data: undefined }, 'usda'],
    ])('has no name for a source %s', (_case, read, source) => {
        mocks.useDataSources.mockReturnValue(read);
        const { result } = renderHook(() => useSourceNaming());

        expect(result.current.sourceName(source)).toBeUndefined();
    });

    it('says a list in the locale’s words', () => {
        const { result } = renderHook(() => useSourceNaming());

        expect(result.current.formatList(['USDA', 'CNF'])).toBe('USDA and CNF');
        expect(result.current.formatList(['USDA'])).toBe('USDA');
    });

    it.each([
        ['a morning', Date.UTC(2026, 9, 3, 9, 5)],
        ['an afternoon', Date.UTC(2026, 9, 3, 15, 45)],
    ])('says %s time as the locale’s hours and minutes', (_case, epochMs) => {
        const reference = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });
        const { result } = renderHook(() => useSourceNaming());

        expect(result.current.formatTime(epochMs)).toBe(reference.format(epochMs));
        expect(result.current.formatTime(epochMs)).not.toBe(String(epochMs));
    });

    it('is the same object across renders while the register and the locale stand', () => {
        const { result, rerender } = renderHook(() => useSourceNaming());
        const first = result.current;

        rerender();

        expect(result.current).toBe(first);
    });
});
