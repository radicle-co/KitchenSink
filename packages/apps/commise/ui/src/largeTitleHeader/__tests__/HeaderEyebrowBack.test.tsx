/**
 * The web `HeaderEyebrowBack`: the "‹ {parent}" eyebrow Back, drawn from 840 and `display: none` below it, where the
 * pinned `CondensedTitleBar` owns Back (`docs/design/uiRefreshWorkshop5/pinnedBackBar.md` §5, §6). It is its own leaf so
 * the settled header and the states with no header (collection loading and failed) draw ONE element.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { HeaderEyebrowBack } from '../HeaderEyebrowBack.js';

afterEach(cleanup);

const back = { label: 'Back to Collections', parent: 'Collections', href: '/en/collections', onPress: vi.fn() };

describe('HeaderEyebrowBack (web)', () => {
    it('is a real link named "Back to {parent}", with the parent drawn beside the chevron', () => {
        render(<HeaderEyebrowBack back={back} />);

        const link = screen.getByRole('link', { name: 'Back to Collections', hidden: true });

        expect(link.getAttribute('href')).toBe('/en/collections');
        expect(link.textContent).toContain('Collections');
    });

    it('⛔ is display none below 840 and inline-flex from it, so the bar’s Back is the only one below', () => {
        render(<HeaderEyebrowBack back={back} />);

        const link = screen.getByRole('link', { name: 'Back to Collections', hidden: true });

        expect(link.className).toMatch(/(^|\s)hidden(\s|$)/u);
        expect(link.className).toContain('nav:inline-flex');
        expect(link.className).not.toMatch(/(^|\s)inline-flex/u);
        // Hidden with `display: none`, never `aria-hidden`: a visible eyebrow must stay in the accessibility tree.
        expect(link.closest('[aria-hidden="true"]')).toBeNull();
    });

    it('goes back on a press', () => {
        const onPress = vi.fn();
        render(<HeaderEyebrowBack back={{ ...back, onPress }} />);

        fireEvent.click(screen.getByRole('link', { name: 'Back to Collections', hidden: true }));

        expect(onPress).toHaveBeenCalledTimes(1);
    });
});
