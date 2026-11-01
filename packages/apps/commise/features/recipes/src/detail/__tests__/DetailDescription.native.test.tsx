/**
 * The native recipe page's description: four lines with a More / Less toggle below the two-column layout when the text
 * is long, the whole text from it, and nothing at all for an empty description.
 *
 * It draws through the design system's `Text` (ADR-0080): the `readingBody` role, in `ink` for the scheme it is shown
 * in, with its toggle under it, space-1 apart at the start of the line. Every expected value is read from the tokens.
 *
 * The clamp is read as the `-webkit-line-clamp` the web build writes for `numberOfLines`, which jsdom holds. That
 * proves the text asks for four lines; only a device shows that the fifth is cut.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import {
    renderedRoot,
    rendersNothing,
    renderWithTamagui,
    resolvedColour,
    resolvedStyle,
} from '@commise/ui/testing/tamagui';

import { recipeMessages } from '../../messages.js';
import { isLongDescription } from '../detailFacts.js';
import { DetailDescription } from '../DetailDescription.native.js';

const { detail } = recipeMessages.en;

const LONG = 'A slow braise that fills the kitchen with the smell of rosemary and garlic. '.repeat(6).trim();
const SHORT = 'Quick and bright.';

interface Shown {
    readonly description?: string;
    readonly expanded?: boolean;
    readonly twoColumns?: boolean;
    readonly onToggle?: () => void;
}

const description = ({ description = LONG, expanded = false, twoColumns = false, onToggle = vi.fn() }: Shown = {}) => (
    <DetailDescription description={description} expanded={expanded} twoColumns={twoColumns} onToggle={onToggle} />
);

/** The line clamp the text asks for, or `''` when it asks for none. */
const clampOf = (element: HTMLElement): string => getComputedStyle(element).getPropertyValue('-webkit-line-clamp');

afterEach(cleanup);

describe('DetailDescription (native)', () => {
    it('uses a description long enough to need the toggle', () => {
        expect(isLongDescription(LONG)).toBe(true);
        expect(isLongDescription(SHORT)).toBe(false);
    });

    it('draws nothing for an empty description', () => {
        const { container } = renderWithTamagui(description({ description: '' }), 'light');

        expect(rendersNothing(container)).toBe(true);
    });

    it('sets the text in the readingBody role', () => {
        const spec = nativeTokens.type.readingBody;
        renderWithTamagui(description(), 'light');
        const style = getComputedStyle(screen.getByText(LONG));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each(['light', 'dark'] as const)('paints the text in ink in the %s scheme', (scheme) => {
        renderWithTamagui(description(), scheme);

        expect(resolvedColour(screen.getByText(LONG), 'color')).toBe(rgb(rolesFor(scheme).ink));
    });

    it('clamps a long description to four lines with More under it', () => {
        renderWithTamagui(description(), 'light');

        expect(clampOf(screen.getByText(LONG))).toBe('4');
        expect(screen.getByRole('button', { name: detail.descriptionMore })).toBeTruthy();
    });

    it('shows the whole text with Less under it once expanded', () => {
        renderWithTamagui(description({ expanded: true }), 'light');

        expect(clampOf(screen.getByText(LONG))).toBe('');
        expect(screen.getByRole('button', { name: detail.descriptionLess })).toBeTruthy();
    });

    it('flips the disclosure from its toggle', () => {
        const onToggle = vi.fn();
        renderWithTamagui(description({ onToggle }), 'light');

        fireEvent.click(screen.getByRole('button', { name: detail.descriptionMore }));

        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('shows the whole text and no toggle in the two-column layout', () => {
        renderWithTamagui(description({ twoColumns: true }), 'light');

        expect(clampOf(screen.getByText(LONG))).toBe('');
        expect(screen.queryByRole('button', { name: detail.descriptionMore })).toBeNull();
    });

    it('offers no toggle for a short description', () => {
        renderWithTamagui(description({ description: SHORT }), 'light');

        expect(screen.queryByRole('button', { name: detail.descriptionMore })).toBeNull();
    });

    it('stacks the text and its toggle space-1 apart at the start of the line', () => {
        const { container } = renderWithTamagui(description(), 'light');
        const block = renderedRoot(container);

        expect(resolvedStyle(block, 'gap')).toBe(`${String(nativeTokens.spacing[1])}px`);
        expect(resolvedStyle(block, 'alignItems')).toBe('flex-start');
    });
});
