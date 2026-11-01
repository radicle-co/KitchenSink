/**
 * The native Data sources loading state (design §S16): the caption is spoken politely and shown, and the placeholder
 * cards stay out of the accessibility tree.
 *
 * The caption is a typed live region (ADR-0080 §8): the design-system Text in the `meta` role, so it grows with the
 * system text size, size and leading together, to the 2× cap. Its colour is a Tamagui theme variable, so the scheme
 * test reads it through `resolvedColour`, where it used to read jsdom's computed colour of a React Native style.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { role, roleDark } from '@commise/ui/colors';
import { nativeTokens } from '@commise/ui/native';
import { rgb, rolesFor, systemScheme } from '@commise/ui/testing/system-color-scheme';

// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DataSourcesSkeleton } from '../DataSourcesSkeleton.native.js';
import { dataSourcesMessages } from '../messages.js';
import { ARIA_HIDDEN_CONTENT, render, renderWithTamagui, resolvedColour } from '@commise/ui/testing/tamagui';

vi.mock('react-native', async (importOriginal) => {
    const { withSystemScheme } = await import('@commise/ui/testing/system-color-scheme');

    return withSystemScheme(await importOriginal<typeof import('react-native')>());
});

afterEach(() => {
    cleanup();
    systemScheme.current = null;
});

describe('DataSourcesSkeleton (native)', () => {
    it('shows and politely announces the caption', () => {
        render(<DataSourcesSkeleton />);

        const caption = screen.getByText('Loading data sources…');

        expect(caption.closest('[aria-live="polite"]')).not.toBeNull();
    });

    it('hides the three placeholder cards from assistive technology', () => {
        const { container } = render(<DataSourcesSkeleton />);

        const hidden = container.querySelector(ARIA_HIDDEN_CONTENT);

        expect(hidden?.children).toHaveLength(3);
        expect(hidden?.contains(screen.getByText('Loading data sources…'))).toBe(false);
    });

    it('sets the caption in the meta role, and grows it with the system text size to the 2× cap', () => {
        const spec = nativeTokens.type.meta;
        renderWithTamagui(<DataSourcesSkeleton />, 'light', 3.1);
        const style = getComputedStyle(screen.getByText(dataSourcesMessages.en.loading));

        expect(style.fontFamily).toContain(spec.fontFamily);
        expect(style.fontSize).toBe(`${String(spec.fontSize * 2)}px`);
        expect(style.lineHeight).toBe(`${String(spec.lineHeight * 2)}px`);
    });
});

describe.each(['light', 'dark'] as const)('DataSourcesSkeleton (native) — the %s scheme', (scheme) => {
    it('captions in inkMuted and fills each placeholder card with surfaceMuted (D15)', () => {
        systemScheme.current = scheme;
        const colours = scheme === 'dark' ? roleDark : role;
        const { container } = render(<DataSourcesSkeleton />);
        const caption = screen.getByText(dataSourcesMessages.en.loading);
        const cards = container.querySelectorAll(`${ARIA_HIDDEN_CONTENT} > div`);

        expect(resolvedColour(caption, 'color')).toBe(rgb(rolesFor(scheme).inkMuted));
        expect(cards).toHaveLength(3);
        expect(getComputedStyle(cards[0] as Element).backgroundColor).toBe(rgb(colours.surfaceMuted));
    });
});
