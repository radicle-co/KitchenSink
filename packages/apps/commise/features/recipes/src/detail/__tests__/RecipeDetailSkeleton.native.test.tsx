/**
 * The native recipe page's LOADING state (D3; `buildSpec.md` §6.7): the caption, spoken politely and shown, over inert
 * placeholder blocks that keep the page's geometry and stay out of the accessibility tree.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
// The detail leaves draw through the design system's Tamagui components (ADR-0080), so the tree renders in its provider.
import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor } from '@commise/ui/testing/system-color-scheme';
import {
    ARIA_HIDDEN_CONTENT,
    render,
    renderWithTamagui,
    resolvedColour,
    resolvedStyle,
} from '@commise/ui/testing/tamagui';

import { RecipeDetailSkeleton } from '../RecipeDetailSkeleton.native.js';

afterEach(cleanup);

describe('RecipeDetailSkeleton (native)', () => {
    it('shows what is loading as a caption, announced politely', () => {
        render(<RecipeDetailSkeleton label="Loading recipe…" />);

        expect(screen.getByText('Loading recipe…')).toBeTruthy();
        expect(screen.getAllByText('Loading recipe…')).toHaveLength(1);
    });

    it('keeps every placeholder block out of the accessibility tree, and the caption in it', () => {
        const { container } = render(<RecipeDetailSkeleton label="Loading recipe…" />);
        const hidden = container.querySelector(ARIA_HIDDEN_CONTENT) as HTMLElement;

        // Blocks are the leaf views: a view with a fill and no children.
        const blocks = Array.from(hidden.querySelectorAll('div')).filter((node) => node.childElementCount === 0);

        expect(blocks.length).toBeGreaterThanOrEqual(6);
        expect(hidden.contains(screen.getByText('Loading recipe…'))).toBe(false);
    });

    it('draws the hero first, at 4:3', () => {
        const { container } = render(<RecipeDetailSkeleton label="Loading recipe…" />);
        const hidden = container.querySelector(ARIA_HIDDEN_CONTENT) as HTMLElement;
        const hero = hidden.firstElementChild as HTMLElement;

        expect(Number.parseFloat(getComputedStyle(hero).aspectRatio)).toBeCloseTo(4 / 3, 2);
    });
});

// The caption is the typed `LiveRegion`: a type role and a colour role, so it follows the scheme and the system text scale.
describe('RecipeDetailSkeleton (native) — the caption', () => {
    it.each(['light', 'dark'] as const)('paints the caption in inkMuted in the %s scheme', (scheme) => {
        renderWithTamagui(<RecipeDetailSkeleton label="Loading recipe…" />, scheme);

        expect(resolvedColour(screen.getByText('Loading recipe…'), 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
    });

    it('sets the caption in the caption role, and grows it with the system text scale', () => {
        const { fontSize } = nativeTokens.type.caption;

        renderWithTamagui(<RecipeDetailSkeleton label="Loading recipe…" />, 'light');
        expect(resolvedStyle(screen.getByText('Loading recipe…'), 'fontSize')).toBe(`${String(fontSize)}px`);
        cleanup();

        renderWithTamagui(<RecipeDetailSkeleton label="Loading recipe…" />, 'light', 2);
        expect(resolvedStyle(screen.getByText('Loading recipe…'), 'fontSize')).toBe(`${String(fontSize * 2)}px`);
    });

    it('keeps the 16 gutter the page has', () => {
        render(<RecipeDetailSkeleton label="Loading recipe…" />);

        const caption = screen.getByText('Loading recipe…');
        let gutter = 0;

        for (let node: HTMLElement | null = caption; node !== null; node = node.parentElement) {
            gutter += Number.parseFloat(getComputedStyle(node).paddingLeft) || 0;
        }

        expect(gutter).toBe(nativeTokens.spacing[4]);
    });
});
