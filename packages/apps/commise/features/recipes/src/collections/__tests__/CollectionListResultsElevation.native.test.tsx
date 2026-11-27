/**
 * A collection card in the native list draws the sm level of the elevation table whole, in both themes, through
 * `Elevated`, on the box that carries the paper fill (Android draws elevation only on a filled view). Written before
 * the move off `nativeTokens.elevation`.
 */
import { LocaleProvider } from '@commise/i18n/react';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { elevationBoxShadow } from '@commise/ui/testing/elevation-shadow';
import { filledBoxOf } from '@commise/ui/testing/filled-box';
import { rgb, rolesFor, systemScheme } from '@commise/ui/testing/system-color-scheme';
import { render, resolvedStyle } from '@commise/ui/testing/tamagui';
import { makeCollection } from '@kitchensink/recipe-core/testing';

import { CollectionListResults } from '../CollectionListResults.native.js';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

const noop = () => undefined;

describe.each(['light', 'dark'] as const)('CollectionListResults (native), %s theme: its card elevation', (scheme) => {
    // Mutant: a literal shadow, or another level.
    it('lifts each collection card with the sm level of the table whole', () => {
        systemScheme.current = scheme;
        render(
            <LocaleProvider locale="en">
                <CollectionListResults
                    collections={[makeCollection({ id: 'col_1', name: 'Weeknight Dinners', visibility: 'private' })]}
                    total={1}
                    onSelect={noop}
                    search={{ value: '', onChange: noop }}
                    firstRun={{ hasRecipes: true, onAddRecipe: noop }}
                />
            </LocaleProvider>,
        );
        const card = filledBoxOf(screen.getByText('Weeknight Dinners'), rgb(rolesFor(scheme).paper), 'the card');

        expect(resolvedStyle(card, 'boxShadow')).toBe(elevationBoxShadow('sm'));
    });
});
