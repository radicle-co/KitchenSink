/**
 * The native Data sources card (plan R55, design §S16), rendered through react-native-web under jsdom.
 *
 * The native leaf hands a link to the OS (`Linking.openURL`), which dispatches any scheme it is given, so the address
 * gate is the boundary here: a source whose address is not http(s) gets no tap target at all. React Native has no
 * language per span, so the credit cannot carry its `lang` on this platform (recorded in §S16); it is still shown word
 * for word.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// `accessibilityLanguage` is iOS's; react-native-web maps only its own `lang`, so under jsdom the prop would vanish and
// no test could see it. This forwards it to `lang` the way VoiceOver consumes it, and changes nothing else.
vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();
    const { createElement } = await import('react');
    const Text = (props: { accessibilityLanguage?: string }) =>
        createElement(actual.Text, { ...props, lang: props.accessibilityLanguage } as never);

    return { ...actual, Text };
});

import { CIQUAL_SOURCE, SWISS_SOURCE, makeDataSource } from '../__fixtures__/makeDataSource.js';
// Explicit `.native.js` — tsc and the native config's resolver both map it to the `.native.tsx` leaf.
import { DataSourceCard } from '../DataSourceCard.native.js';

afterEach(cleanup);

describe('DataSourceCard (native)', () => {
    it('heads the card with the short name, then shows the full name and the publisher', () => {
        render(<DataSourceCard source={makeDataSource()} onOpen={vi.fn()} />);

        expect(screen.getByRole('heading', { name: 'USDA' })).toBeTruthy();
        expect(screen.getByText('FoodData Central')).toBeTruthy();
        expect(screen.getByText('U.S. Department of Agriculture, Agricultural Research Service')).toBeTruthy();
    });

    it('heads a source with no short name by its name, shown once', () => {
        render(<DataSourceCard source={SWISS_SOURCE} onOpen={vi.fn()} />);

        expect(screen.getByRole('heading', { name: 'Swiss Food Composition Database' })).toBeTruthy();
        expect(screen.getAllByText('Swiss Food Composition Database')).toHaveLength(1);
    });

    it('labels the edition, the licence and the credit, and shows the credit word for word', () => {
        render(<DataSourceCard source={CIQUAL_SOURCE} onOpen={vi.fn()} />);

        expect(screen.getByText('Edition')).toBeTruthy();
        expect(screen.getByText('License')).toBeTruthy();
        expect(screen.getByText('Credit')).toBeTruthy();
        expect(screen.getByText('Anses. 2025. Table de composition nutritionnelle des aliments Ciqual.')).toBeTruthy();
    });

    it('gives the credit its own language, which VoiceOver reads it in (SC 3.1.2)', () => {
        render(<DataSourceCard source={CIQUAL_SOURCE} onOpen={vi.fn()} />);

        const credit = screen.getByText('Anses. 2025. Table de composition nutritionnelle des aliments Ciqual.');

        expect(credit.getAttribute('lang')).toBe('fr');
    });

    it('opens the licence in the system browser, through the injected adapter, by its accessible name', async () => {
        const onOpen = vi.fn();
        render(<DataSourceCard source={makeDataSource()} onOpen={onOpen} />);

        await userEvent.click(screen.getByRole('link', { name: 'CC0 1.0 Universal, license for USDA' }));

        expect(onOpen).toHaveBeenCalledWith('https://creativecommons.org/publicdomain/zero/1.0/');
    });

    it('opens the source’s website by its accessible name', async () => {
        const onOpen = vi.fn();
        render(<DataSourceCard source={makeDataSource()} onOpen={onOpen} />);

        await userEvent.click(screen.getByRole('link', { name: 'Source website, USDA' }));

        expect(onOpen).toHaveBeenCalledWith('https://fdc.nal.usda.gov/');
    });

    it('says the values were converted only for a source the service marks converted', () => {
        render(<DataSourceCard source={CIQUAL_SOURCE} onOpen={vi.fn()} />);
        expect(screen.getByText('We converted some of its values to the units this app uses.')).toBeTruthy();

        cleanup();

        render(<DataSourceCard source={makeDataSource({ converted: false })} onOpen={vi.fn()} />);
        expect(screen.queryByText('We converted some of its values to the units this app uses.')).toBeNull();
    });

    it('offers no tap target for an address the OS must never be handed', () => {
        const onOpen = vi.fn();
        render(
            <DataSourceCard
                source={makeDataSource({ licenceUrl: 'intent://scan/#Intent;end', homepage: 'tel:+15551234567' })}
                onOpen={onOpen}
            />,
        );

        expect(screen.queryAllByRole('link')).toHaveLength(0);
        expect(screen.getByText('CC0 1.0 Universal')).toBeTruthy();
        expect(onOpen).not.toHaveBeenCalled();
    });
});
