/**
 * Native component tests for the recipe-source (provenance) line, rendered via react-native-web under jsdom.
 *
 * The native leaf has a failure mode the web leaf does not: it hands the URL to the OS
 * (`Linking.openURL`), which will happily dispatch `tel:`, `sms:`, an app deep link, or an Android
 * `intent:` — so the scheme gate is not a nicety here, it is the boundary. These tests assert that the OS
 * is never asked to open anything that did not pass the gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Linking } from 'react-native';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { RecipeSourceLine } from '../RecipeSourceLine.native.js';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('RecipeSourceLine (native) — absent source', () => {
    it('renders NOTHING when the recipe has neither a URL nor an attribution', () => {
        const { container } = render(<RecipeSourceLine />);

        expect(container.innerHTML).toBe('');
    });

    it('renders NOTHING when the only source is a URL that must not be opened', () => {
        const { container } = render(<RecipeSourceLine sourceUrl="intent://scan/#Intent;scheme=zxing;end" />);

        expect(container.innerHTML).toBe('');
    });
});

describe('RecipeSourceLine (native) — attribution without a usable URL', () => {
    it('renders the attribution as plain text, with no link', () => {
        render(<RecipeSourceLine sourceAttribution="Grandma’s cookbook" />);

        expect(screen.getByText('Source')).toBeTruthy();
        expect(screen.getByText('Grandma’s cookbook')).toBeTruthy();
        expect(screen.queryByRole('link')).toBeNull();
    });

    it('does not offer a tap target for a scheme the OS must never be handed', () => {
        const openURL = vi.spyOn(Linking, 'openURL').mockResolvedValue(true);

        render(<RecipeSourceLine sourceUrl="tel:+15551234567" sourceAttribution="A Cookbook" />);

        expect(screen.getByText('A Cookbook')).toBeTruthy();
        expect(screen.queryByRole('link')).toBeNull();
        expect(openURL).not.toHaveBeenCalled();
    });
});

describe('RecipeSourceLine (native) — a linkable source', () => {
    it('labels the tap target with the verified host, never with the untrusted attribution', () => {
        render(<RecipeSourceLine sourceUrl="https://evil.example/x" sourceAttribution="Serious Eats" />);

        // A recipe must not be able to label the thing you tap with a site it does not point at.
        expect(screen.getByRole('link').textContent).toBe('evil.example');
        expect(screen.getByText('Serious Eats')).toBeTruthy();
    });

    it('hands the OS the PARSED href when tapped, never the raw string', async () => {
        const openURL = vi.spyOn(Linking, 'openURL').mockResolvedValue(true);

        render(<RecipeSourceLine sourceUrl="  HTTPS://Example.COM/Recipes  " />);
        await userEvent.click(screen.getByRole('link'));

        expect(openURL).toHaveBeenCalledTimes(1);
        expect(openURL).toHaveBeenCalledWith('https://example.com/Recipes');
    });

    it('survives an OS that refuses to open the link', async () => {
        // `Linking.openURL` REJECTS when no handler exists (or the user dismisses the chooser). An unhandled
        // rejection is a redbox in dev and a floating promise in production; the cook must simply stay on
        // the recipe. Asserted through the REAL default adapter, not the injected seam, because the
        // absorbing `.catch` lives in the adapter.
        vi.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));

        render(<RecipeSourceLine sourceUrl="https://example.com/recipe" />);
        await userEvent.click(screen.getByRole('link'));

        expect(screen.getByRole('link')).toBeTruthy();
    });

    it('delegates the open through its injected adapter, so the effect is one named seam', async () => {
        const onOpen = vi.fn();

        render(<RecipeSourceLine sourceUrl="https://example.com/recipe" onOpen={onOpen} />);
        await userEvent.click(screen.getByRole('link'));

        expect(onOpen).toHaveBeenCalledWith('https://example.com/recipe');
    });
});
