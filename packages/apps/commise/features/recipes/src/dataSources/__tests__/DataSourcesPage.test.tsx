// @vitest-environment jsdom
/**
 * The web Data sources page frame (design §S16): the heading and both intro sentences show at once, whatever state the
 * read below them is in, so a loading or failed read never leaves the page without its title.
 *
 * Pinned back bar (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §6): with a way back, the page sits in the
 * `PushedPageFrame`, so Back is in the pinned bar below 840 and the header's eyebrow carries it from 840. jsdom applies no
 * stylesheet, so both copies are in its tree and what is asserted is the structure and the classes that carry the
 * breakpoint: the bar is `nav:hidden`, the eyebrow is `hidden nav:inline-flex`. A browser shows exactly one at each width
 * (`tests/e2e/dataSources.spec.ts`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { expectOneBackInBarAndOneInHeader } from '@commise/test-utils';

import { DataSourcesPage } from '../DataSourcesPage.js';

afterEach(cleanup);

const BACK_NAME = 'Back to Profile';

describe('DataSourcesPage (web)', () => {
    it('heads the page with a level-one heading', () => {
        render(<DataSourcesPage headingFocusSignal={0}>{null}</DataSourcesPage>);

        expect(screen.getByRole('heading', { level: 1, name: 'Data sources' })).toBeTruthy();
    });

    // §9.2: Data sources is reached from Profile, and goes back to it.
    it('goes back to Profile through a link whose plain click is the app’s own navigation', async () => {
        const onPress = vi.fn();

        render(
            <DataSourcesPage
                headingFocusSignal={0}
                back={{ label: 'Back to Profile', parent: 'Profile', href: '/en/profile', onPress }}
            >
                {null}
            </DataSourcesPage>,
        );

        const back = expectOneBackInBarAndOneInHeader(BACK_NAME).eyebrow;

        expect(back.getAttribute('href')).toBe('/en/profile');

        await userEvent.click(back);

        expect(onPress).toHaveBeenCalledOnce();
    });

    describe('with a way back, on the pinned bar', () => {
        const props = { label: 'Back to Profile', parent: 'Profile', href: '/en/profile', onPress: vi.fn() };

        it('has one Back in the pinned bar, gone from 840, and the header’s eyebrow, shown from it', () => {
            render(
                <DataSourcesPage headingFocusSignal={0} back={props}>
                    {null}
                </DataSourcesPage>,
            );

            expectOneBackInBarAndOneInHeader(BACK_NAME);
        });

        it('sits in the pinned-page frame', () => {
            const { container } = render(
                <DataSourcesPage headingFocusSignal={0} back={props}>
                    {null}
                </DataSourcesPage>,
            );

            expect(container.querySelector('[data-pushed-page]')).not.toBeNull();
        });

        it('reaches Profile from the bar’s Back as well', async () => {
            const onPress = vi.fn();

            render(
                <DataSourcesPage headingFocusSignal={0} back={{ ...props, onPress }}>
                    {null}
                </DataSourcesPage>,
            );
            await userEvent.click(expectOneBackInBarAndOneInHeader(BACK_NAME).bar);

            expect(onPress).toHaveBeenCalledOnce();
        });
    });

    it('has no back link when the host offers none', () => {
        const { container } = render(<DataSourcesPage headingFocusSignal={0}>{null}</DataSourcesPage>);

        expect(screen.queryByRole('link', { hidden: true })).toBeNull();
        // No Back means no bar: the frame is only for a page with somewhere to go back to.
        expect(container.querySelector('[data-pushed-page]')).toBeNull();
    });

    it('states where the numbers come from, and the rule for a food no database lists exactly', () => {
        render(<DataSourcesPage headingFocusSignal={0}>{null}</DataSourcesPage>);

        expect(
            screen.getByText('The nutrition figures in this app come from these public food databases.'),
        ).toBeTruthy();
        expect(
            screen.getByText(
                'When no database lists a food exactly, we use the figures for a similar or more general food.',
            ),
        ).toBeTruthy();
    });

    // A retry that took Try again away advances the signal: focus goes to the heading instead of the page (SC 2.4.3),
    // and never away from a control the person moved to (`focusIfLost`).
    it('focuses the heading when the signal advances and focus was lost, and leaves a chosen control alone', () => {
        const { rerender } = render(
            <DataSourcesPage headingFocusSignal={0}>
                <input aria-label="elsewhere" />
            </DataSourcesPage>,
        );
        const heading = screen.getByRole('heading', { level: 1, name: 'Data sources' });

        expect(document.activeElement).toBe(document.body);
        rerender(
            <DataSourcesPage headingFocusSignal={1}>
                <input aria-label="elsewhere" />
            </DataSourcesPage>,
        );
        expect(document.activeElement).toBe(heading);

        const elsewhere = screen.getByRole('textbox', { name: 'elsewhere' });

        elsewhere.focus();
        rerender(
            <DataSourcesPage headingFocusSignal={2}>
                <input aria-label="elsewhere" />
            </DataSourcesPage>,
        );
        expect(document.activeElement).toBe(elsewhere);
    });

    it('renders the read’s state below the intro', () => {
        render(
            <DataSourcesPage headingFocusSignal={0}>
                <p>the read’s state</p>
            </DataSourcesPage>,
        );

        const intro = screen.getByText('The nutrition figures in this app come from these public food databases.');
        const state = screen.getByText('the read’s state');

        expect(intro.compareDocumentPosition(state) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});
