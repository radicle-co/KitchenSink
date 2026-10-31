/**
 * The design-system frame, in a native lane (ADR-0080). A native test lane resolves `DesignSystemFrame` to its
 * `.native` leaf, which mounts the design system's Tamagui provider, so a consumer test that renders a Tamagui
 * component through the shared helpers renders it as the app does. The rows fail if the lane got the web leaf (a
 * Tamagui component then throws for a missing theme) or if the two leaves stop taking the same props.
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { styled, View } from 'tamagui';

import { createFakeRecipeServiceClient } from '@kitchensink/recipe-service-client/testing';

import { makeQuietFoodClient, renderWithFoodClient } from '../renderWithFoodClient.js';
import { renderWithProviders } from '../renderWithProviders.js';
import { renderWithRecipeClient } from '../renderWithRecipeClient.js';
import { DesignSystemFrame } from '../DesignSystemFrame.js';
import type { DesignSystemFrame as NativeDesignSystemFrame } from '../DesignSystemFrame.native.js';

const Swatch = styled(View, { backgroundColor: '$paper' });

afterEach(cleanup);

describe('DesignSystemFrame (native)', () => {
    it('mounts the design system, so a Tamagui component renders', () => {
        render(
            <DesignSystemFrame>
                <Swatch aria-label="swatch" />
            </DesignSystemFrame>,
        );

        expect(screen.getByLabelText('swatch')).toBeTruthy();
    });

    it('is needed: without it a Tamagui component throws for a missing theme', () => {
        expect(() => render(<Swatch aria-label="swatch" />)).toThrow(/Missing theme/u);
    });

    it.each([
        ['renderWithProviders', () => renderWithProviders(<Swatch aria-label="swatch" />)],
        [
            'renderWithRecipeClient',
            () => renderWithRecipeClient(<Swatch aria-label="swatch" />, createFakeRecipeServiceClient()),
        ],
        ['renderWithFoodClient', () => renderWithFoodClient(<Swatch aria-label="swatch" />, makeQuietFoodClient())],
    ] as const)('frames what %s renders', (_name, renderIt) => {
        renderIt();

        expect(screen.getByLabelText('swatch')).toBeTruthy();
    });

    it('takes the same props as the web leaf the compiler checks callers against', () => {
        expectTypeOf<ComponentProps<typeof NativeDesignSystemFrame>>().toEqualTypeOf<
            ComponentProps<typeof DesignSystemFrame>
        >();
    });
});
