/**
 * The native recipe page's footer facts: where the recipe came from, and the way to its version history.
 *
 * It lays out with Tamagui (ADR-0080): its blocks sit space-1 apart at the start of the line, so the ghost action
 * hugs its words instead of stretching across the page. Every expected value is read from the tokens.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

import { nativeTokens } from '@commise/ui/native';
import { renderedRoot, renderWithTamagui, resolvedStyle } from '@commise/ui/testing/tamagui';

import { recipeMessages } from '../../messages.js';
import { DetailFooter } from '../DetailFooter.native.js';

const { detail } = recipeMessages.en;

const recipe = { sourceUrl: undefined, sourceAttribution: 'Grandma’s card' };

afterEach(cleanup);

describe('DetailFooter (native)', () => {
    it('says where the recipe came from', () => {
        renderWithTamagui(<DetailFooter recipe={recipe} onViewVersions={undefined} />, 'light');

        expect(screen.getByRole('heading', { name: detail.sourceHeading })).toBeTruthy();
        expect(screen.getByText('Grandma’s card')).toBeTruthy();
    });

    it('opens the version history from its action', () => {
        const onViewVersions = vi.fn();
        renderWithTamagui(<DetailFooter recipe={recipe} onViewVersions={onViewVersions} />, 'light');

        fireEvent.click(screen.getByRole('button', { name: detail.versionHistory }));

        expect(onViewVersions).toHaveBeenCalledTimes(1);
    });

    it('offers no version history when the page has none', () => {
        renderWithTamagui(<DetailFooter recipe={recipe} onViewVersions={undefined} />, 'light');

        expect(screen.queryByRole('button', { name: detail.versionHistory })).toBeNull();
    });

    it('stacks its blocks space-1 apart at the start of the line', () => {
        const { container } = renderWithTamagui(
            <DetailFooter recipe={recipe} onViewVersions={() => undefined} />,
            'light',
        );
        const footer = renderedRoot(container);

        expect(resolvedStyle(footer, 'gap')).toBe(`${String(nativeTokens.spacing[1])}px`);
        expect(resolvedStyle(footer, 'alignItems')).toBe('flex-start');
    });
});
