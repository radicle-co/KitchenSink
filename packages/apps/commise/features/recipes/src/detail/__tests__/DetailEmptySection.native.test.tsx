/**
 * An empty section of the native recipe page (build spec §6.7), the mirror of `DetailEmptySection.tsx`: its line, and
 * for the owner the ghost action that opens the editor at that section.
 *
 * It draws through the design system's `Text` (ADR-0080): the line in the `body` role and `inkMuted` for the scheme it
 * is shown in, with the action under it, space-2 apart at the start of the line, and space-2 above and below. Every
 * expected value is read from the tokens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import { renderedRoot, renderWithTamagui, resolvedColour, resolvedStyle } from '@commise/ui/testing/tamagui';

import { DetailEmptySection } from '../DetailEmptySection.native.js';

const TEXT = 'No steps yet.';
const ACTION = 'Add steps';

const px = (step: keyof typeof nativeTokens.spacing): string => `${String(nativeTokens.spacing[step])}px`;

afterEach(cleanup);

describe('DetailEmptySection (native)', () => {
    it('sets the line in the body role', () => {
        const spec = nativeTokens.type.body;
        renderWithTamagui(<DetailEmptySection text={TEXT} actionLabel={ACTION} onAction={undefined} />, 'light');
        const style = getComputedStyle(screen.getByText(TEXT));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight)}px`);
    });

    it.each(['light', 'dark'] as const)('paints the line in inkMuted in the %s scheme', (scheme) => {
        renderWithTamagui(<DetailEmptySection text={TEXT} actionLabel={ACTION} onAction={undefined} />, scheme);

        expect(resolvedColour(screen.getByText(TEXT), 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
    });

    it('offers the owner the action, which opens the editor at the section', () => {
        const onAction = vi.fn();
        renderWithTamagui(<DetailEmptySection text={TEXT} actionLabel={ACTION} onAction={onAction} />, 'light');

        fireEvent.click(screen.getByRole('button', { name: ACTION }));

        expect(onAction).toHaveBeenCalledTimes(1);
    });

    it('offers another cook no action, only the line', () => {
        renderWithTamagui(<DetailEmptySection text={TEXT} actionLabel={ACTION} onAction={undefined} />, 'light');

        expect(screen.getByText(TEXT)).toBeTruthy();
        expect(screen.queryByRole('button', { name: ACTION })).toBeNull();
    });

    it('stacks the line and the action space-2 apart at the start of the line, with space-2 above and below', () => {
        const { container } = renderWithTamagui(
            <DetailEmptySection text={TEXT} actionLabel={ACTION} onAction={() => undefined} />,
            'light',
        );
        const block = renderedRoot(container);

        expect(resolvedStyle(block, 'gap')).toBe(px(2));
        expect(resolvedStyle(block, 'alignItems')).toBe('flex-start');
        expect(resolvedStyle(block, 'paddingTop')).toBe(px(2));
        expect(resolvedStyle(block, 'paddingBottom')).toBe(px(2));
    });
});
