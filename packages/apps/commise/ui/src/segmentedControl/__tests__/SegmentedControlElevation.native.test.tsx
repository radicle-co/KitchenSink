/**
 * The selected segment draws the sm level of the elevation table whole, in both themes, through `Elevated`, and an
 * unselected one draws no shadow at all (fields absent, not zero). The `Elevated` is the face inside the segment's
 * `Pressable`, which owns the press, the role and the name, so a press still selects it, in both forms. Written before
 * the move off `nativeTokens.elevation`.
 */
import { cleanup, screen } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { elevationBoxShadow } from '../../testing/elevationShadow.js';
import { renderWithTamagui, resolvedStyle } from '../../testing/tamaguiTesting.native.js';
import { systemScheme } from '../../testing/systemColorScheme.js';
import { SegmentedControl } from '../SegmentedControl.native.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('../../testing/systemColorScheme.js');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

/** The face of a segment: the `Elevated` that carries its fill and shadow, inside the pressable role element. */
const faceOf = (segment: HTMLElement): HTMLElement => {
    const face = segment.firstElementChild;

    if (!(face instanceof HTMLElement)) {
        throw new Error('The segment has no face view');
    }

    return face;
};

const PLACES = [
    { id: 'mine', label: 'My recipes' },
    { id: 'collections', label: 'Collections' },
] as const;

describe.each(['light', 'dark'] as const)('SegmentedControl (native), %s theme: its elevation', (scheme) => {
    // Mutant: a literal shadow, or every tab lifted.
    it('lifts only the selected tab, with the sm level of the table whole', () => {
        systemScheme.current = scheme;
        renderWithTamagui(
            <SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={vi.fn()} />,
            scheme,
        );

        expect(resolvedStyle(faceOf(screen.getByRole('tab', { name: 'My recipes' })), 'boxShadow')).toBe(
            elevationBoxShadow('sm'),
        );
        expect(['', 'none']).toContain(
            resolvedStyle(faceOf(screen.getByRole('tab', { name: 'Collections' })), 'boxShadow'),
        );
    });

    it('lifts only the checked radio of a view switch', () => {
        systemScheme.current = scheme;
        renderWithTamagui(
            <SegmentedControl form="view" label="View" segments={PLACES} value="collections" onChange={vi.fn()} />,
            scheme,
        );

        expect(resolvedStyle(faceOf(screen.getByRole('radio', { name: 'Collections' })), 'boxShadow')).toBe(
            elevationBoxShadow('sm'),
        );
        expect(['', 'none']).toContain(
            resolvedStyle(faceOf(screen.getByRole('radio', { name: 'My recipes' })), 'boxShadow'),
        );
    });
});

describe('SegmentedControl (native): a segment is one accessible control that a press selects', () => {
    it('keeps each tab focusable as one element with its name and selected state, and a press selects it', () => {
        const onSelect = vi.fn();
        renderWithTamagui(
            <SegmentedControl form="route" label="Recipes" segments={PLACES} current="mine" onSelect={onSelect} />,
            'light',
        );
        const mine = screen.getByRole('tab', { name: 'My recipes' });
        const other = screen.getByRole('tab', { name: 'Collections' });

        expect(mine.getAttribute('aria-selected')).toBe('true');
        expect(other.getAttribute('aria-selected')).toBe('false');
        expect(mine.getAttribute('tabindex')).toBe('0');
        expect(other.getAttribute('tabindex')).toBe('0');

        fireEvent.click(other);

        expect(onSelect).toHaveBeenCalledWith('collections');
    });

    it('keeps each radio focusable as one element with its name and checked state, and a press selects it', () => {
        const onChange = vi.fn();
        renderWithTamagui(
            <SegmentedControl form="view" label="View" segments={PLACES} value="mine" onChange={onChange} />,
            'light',
        );
        const mine = screen.getByRole('radio', { name: 'My recipes' });
        const other = screen.getByRole('radio', { name: 'Collections' });

        expect(mine.getAttribute('aria-checked')).toBe('true');
        expect(other.getAttribute('aria-checked')).toBe('false');
        expect(mine.getAttribute('tabindex')).toBe('0');
        expect(other.getAttribute('tabindex')).toBe('0');

        fireEvent.click(other);

        expect(onChange).toHaveBeenCalledWith('collections');
    });
});
