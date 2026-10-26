/**
 * Native component tests for `ImportFlaggedList`, rendered through react-native-web under jsdom. Mirrors
 * `ImportFlaggedList.test.tsx`, plus the native rule that the options pane shows only at the wide container class.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { Text } from 'react-native';

const windowWidth = vi.hoisted(() => ({ current: 390 }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        useWindowDimensions: () => ({ ...actual.useWindowDimensions(), width: windowWidth.current }),
    };
});

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { ImportFlaggedList } from '../ImportFlaggedList.native.js';
import type { ImportFlaggedListProps } from '../props.js';

afterEach(() => {
    cleanup();
    windowWidth.current = 390;
});

function renderList(overrides: Partial<ImportFlaggedListProps> = {}) {
    const onUseSuggestion = vi.fn();
    const onSearch = vi.fn();
    render(
        <ImportFlaggedList
            total={23}
            lines={[
                {
                    key: 'milk',
                    text: '1 1/4 cups milk',
                    recipeTitle: 'Pancakes',
                    matchedFood: 'milk crackers',
                    suggestion: { foodId: 'f-whole', name: 'Whole milk' },
                },
            ]}
            onUseSuggestion={onUseSuggestion}
            onSearch={onSearch}
            {...overrides}
        />,
    );

    return { onUseSuggestion, onSearch };
}

describe('ImportFlaggedList (native)', () => {
    it('heads “23 to check”; a row’s Use and labelled Search report by key', () => {
        const { onUseSuggestion, onSearch } = renderList();

        expect(screen.getByRole('heading', { name: '23 to check' })).toBeTruthy();
        expect(screen.getByText('1 1/4 cups milk · Pancakes')).toBeTruthy();
        expect(screen.getByText('Matched to milk crackers. Our check doubts it.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' }));
        fireEvent.click(screen.getByRole('button', { name: 'Search for a food for 1 1/4 cups milk' }));

        expect(onUseSuggestion).toHaveBeenCalledWith('milk');
        expect(onSearch).toHaveBeenCalledWith('milk');
    });

    it('shows the options pane only at the wide container class', () => {
        renderList({ detail: <Text>the pane</Text> });
        expect(screen.queryByText('the pane')).toBeNull();
        cleanup();

        windowWidth.current = 1194;
        renderList({ detail: <Text>the pane</Text> });
        expect(screen.getByText('the pane')).toBeTruthy();
    });
});
