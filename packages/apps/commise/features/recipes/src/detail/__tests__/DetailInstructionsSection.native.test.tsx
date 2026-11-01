/**
 * The native recipe page's instructions section: its heading, the row that holds the heading and the owner's Edit, and
 * the section's own spacing.
 *
 * It draws through the design system's Tamagui frames (ADR-0080): the heading is the `sectionTitle` role in `ink` for
 * the scheme it is shown in, the heading row wraps rather than squeezing its Edit, and the section stacks its parts
 * 12 apart. Every expected value is read from the tokens, so a scale or palette change moves this test with it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';

import { makeStepView } from '../../__fixtures__/index.js';
import { idleDetailBodyState } from '../../__fixtures__/cookMarks.js';
import { recipeMessages } from '../../messages.js';
import { DetailInstructionsSection } from '../DetailInstructionsSection.native.js';

const { detail } = recipeMessages.en;

const px = (step: keyof typeof nativeTokens.spacing): string => `${String(nativeTokens.spacing[step])}px`;

const steps = [
    makeStepView({ stepNumber: 1, instruction: 'Whisk the eggs.' }),
    makeStepView({ stepNumber: 2, instruction: 'Fold in the flour.' }),
];

const section = (onEdit: (() => void) | undefined) => (
    <DetailInstructionsSection steps={steps} marks={idleDetailBodyState.marks} onEdit={onEdit} />
);

const owned = () => section(() => undefined);

const heading = (): HTMLElement => screen.getByRole('heading', { name: detail.instructionsHeading });

afterEach(cleanup);

describe('DetailInstructionsSection (native)', () => {
    it('names the section with a heading', () => {
        renderWithTamagui(owned(), 'light');

        expect(heading().textContent).toBe(detail.instructionsHeading);
    });

    it('sets the heading in the sectionTitle role', () => {
        const spec = nativeTokens.type.sectionTitle;
        renderWithTamagui(owned(), 'light');
        const style = getComputedStyle(heading());

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each(['light', 'dark'] as const)('paints the heading in ink in the %s scheme', (scheme) => {
        renderWithTamagui(owned(), scheme);

        expect(resolvedColour(heading(), 'color')).toBe(rgb(rolesFor(scheme).ink));
    });

    it('holds the heading and the owner’s Edit in one row that wraps rather than squeezing', () => {
        renderWithTamagui(owned(), 'light');
        const row = heading().parentElement as HTMLElement;

        expect(row.contains(screen.getByRole('button', { name: detail.editStepsLabel }))).toBe(true);
        expect(resolvedStyle(row, 'flexDirection')).toBe('row');
        expect(resolvedStyle(row, 'flexWrap')).toBe('wrap');
        expect(resolvedStyle(row, 'alignItems')).toBe('center');
        expect(resolvedStyle(row, 'justifyContent')).toBe('space-between');
        expect(resolvedStyle(row, 'gap')).toBe(px(2));
    });

    it('stacks the heading row and the steps space-3 apart', () => {
        renderWithTamagui(owned(), 'light');
        const frame = (heading().parentElement as HTMLElement).parentElement as HTMLElement;

        expect(resolvedStyle(frame, 'gap')).toBe(px(3));
    });

    it('offers no Edit to a cook who does not own the recipe', () => {
        renderWithTamagui(section(undefined), 'light');

        expect(screen.queryByRole('button', { name: detail.editStepsLabel })).toBeNull();
    });
});
