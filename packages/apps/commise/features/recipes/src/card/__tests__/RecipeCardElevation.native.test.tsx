/**
 * The native recipe card's shell draws the sm level of the elevation table whole, in both themes, through `Elevated`.
 * The shell is the box that carries the paper fill, because Android draws elevation only on the filled view, and it
 * is the one box that does not clip (iOS masks a co-located shadow). Written before the move off
 * `nativeTokens.elevation`.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@commise/i18n/react';
import { elevationBoxShadow } from '@commise/ui/testing/elevation-shadow';
import { filledBoxOf } from '@commise/ui/testing/filled-box';
import { rgb, rolesFor, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { render, resolvedStyle } from '@commise/ui/testing/tamagui';

import { makeRecipe } from '../../__fixtures__/index.js';
import { toRecipeCardModel } from '../model.js';
import { RecipeCard } from '../RecipeCard.native.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe.each(['light', 'dark'] as const)('RecipeCard (native), %s theme: its elevation', (scheme) => {
    it.each(['grid', 'row', 'compact'] as const)(
        'lifts the %s shell with the sm level of the table whole (mutant: a literal shadow, or another level)',
        (variant) => {
            systemScheme.current = scheme;
            render(
                <LocaleProvider locale="en">
                    <RecipeCard
                        headingLevel={3}
                        variant={variant}
                        recipe={toRecipeCardModel(makeRecipe({ title: 'Soup' }))}
                    />
                </LocaleProvider>,
            );
            const shell = filledBoxOf(screen.getByText('Soup'), rgb(rolesFor(scheme).paper), 'the card');

            expect(resolvedStyle(shell, 'boxShadow')).toBe(elevationBoxShadow('sm'));
        },
    );
});
