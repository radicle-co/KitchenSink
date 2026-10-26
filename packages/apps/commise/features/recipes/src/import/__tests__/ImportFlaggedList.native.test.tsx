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
    const onChooseAnother = vi.fn();
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
            pending={new Map()}
            failed={new Set()}
            announcement={{ text: '', occurrence: 0 }}
            onUseSuggestion={onUseSuggestion}
            onChooseAnother={onChooseAnother}
            {...overrides}
        />,
    );

    return { onUseSuggestion, onChooseAnother };
}

describe('ImportFlaggedList (native)', () => {
    // REWRITTEN (design session, U7): the second control is "Choose another", named "Choose another food for {line}".
    it('heads “23 to check”; a row’s Use and Choose another report by key', () => {
        const { onUseSuggestion, onChooseAnother } = renderList();

        expect(screen.getByRole('heading', { name: '23 to check' })).toBeTruthy();
        expect(screen.getByText('1 1/4 cups milk · Pancakes')).toBeTruthy();
        expect(screen.getByText('Matched to milk crackers. Our check doubts it.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' }));
        fireEvent.click(screen.getByRole('button', { name: 'Choose another food for 1 1/4 cups milk' }));

        expect(screen.getByRole('button', { name: 'Choose another food for 1 1/4 cups milk' }).textContent).toBe(
            'Choose another',
        );
        expect(onUseSuggestion).toHaveBeenCalledWith('milk');
        expect(onChooseAnother).toHaveBeenCalledWith('milk');
    });

    it('⛔ M5: Use in flight reads busy; neither it nor Choose another sends again', () => {
        const { onUseSuggestion, onChooseAnother } = renderList({
            pending: new Map([['milk', { kind: 'useProposal' }]]),
        });

        const use = screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' });

        expect(use.getAttribute('aria-busy')).toBe('true');
        fireEvent.click(use);
        fireEvent.click(screen.getByRole('button', { name: 'Choose another food for 1 1/4 cups milk' }));

        expect(onUseSuggestion).not.toHaveBeenCalled();
        expect(onChooseAnother).not.toHaveBeenCalled();
    });

    it('shows the options pane only at the wide container class', () => {
        renderList({ detail: <Text>the pane</Text> });
        expect(screen.queryByText('the pane')).toBeNull();
        cleanup();

        windowWidth.current = 1194;
        renderList({ detail: <Text>the pane</Text> });
        expect(screen.getByText('the pane')).toBeTruthy();
    });

    it('⛔ M6: a Use that did not save says so on its row, with Try again naming the line; Try again sends Use again', () => {
        const { onUseSuggestion } = renderList({ failed: new Set(['milk']) });

        expect(screen.getByText('We couldn’t save that choice.')).toBeTruthy();

        const retry = screen.getByRole('button', { name: 'Try again to save the choice for 1 1/4 cups milk' });

        expect(retry.textContent).toBe('Try again');

        fireEvent.click(retry);

        expect(onUseSuggestion).toHaveBeenCalledExactlyOnceWith('milk');
        expect(
            screen.getByRole('button', { name: 'Use Whole milk for 1 1/4 cups milk' }).hasAttribute('disabled'),
        ).toBe(false);
    });

    it('M6: a retry in flight hides the failure, and no failure shows when nothing failed', () => {
        renderList({ failed: new Set(['milk']), pending: new Map([['milk', { kind: 'useProposal' }]]) });

        expect(screen.queryByText('We couldn’t save that choice.')).toBeNull();
        cleanup();

        renderList();
        expect(screen.queryByText('We couldn’t save that choice.')).toBeNull();
    });

    it('⛔ U9: says what the host announces in ONE polite live region', () => {
        renderList({ announcement: { text: 'We couldn’t save the choice for 1 1/4 cups milk.', occurrence: 1 } });

        expect(screen.getAllByText('We couldn’t save the choice for 1 1/4 cups milk.')).toHaveLength(1);
    });
});
