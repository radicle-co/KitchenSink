/**
 * `expectOneBackInBarAndOneInHeader` is the assertion every framed web page leans on, so it must FAIL for the markup it
 * exists to catch: a second Back in the bar, a bar that is not `nav:hidden`, an eyebrow that shows below 840, and a page
 * with no bar at all. A helper that passed for any of them would make every page test that uses it a green that proves nothing.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { expectOneBackInBarAndOneInHeader } from '../pinnedBackBar.js';

afterEach(cleanup);

const BAR = 'fixed nav:hidden';
const EYEBROW = 'hidden nav:inline-flex';

const page = (options: { bar?: string; eyebrow?: string; barLinks?: number } = {}) => (
    <div>
        <div data-condensed="false" className={options.bar ?? BAR}>
            {Array.from({ length: options.barLinks ?? 1 }, (_, index) => (
                <a key={index} href="/back" aria-label="Back to Home">
                    ‹
                </a>
            ))}
        </div>
        <header>
            <a href="/back" aria-label="Back to Home" className={options.eyebrow ?? EYEBROW}>
                Home
            </a>
        </header>
    </div>
);

describe('expectOneBackInBarAndOneInHeader', () => {
    it('returns the bar’s Back and the eyebrow for a correctly framed page', () => {
        render(page());
        const { bar, eyebrow } = expectOneBackInBarAndOneInHeader('Back to Home');

        expect(bar.closest('[data-condensed]')).not.toBeNull();
        expect(eyebrow.closest('[data-condensed]')).toBeNull();
    });

    it('fails for two Backs in the bar', () => {
        render(page({ barLinks: 2 }));

        expect(() => expectOneBackInBarAndOneInHeader('Back to Home')).toThrow();
    });

    it('fails for a bar that stays on from 840', () => {
        render(page({ bar: 'fixed' }));

        expect(() => expectOneBackInBarAndOneInHeader('Back to Home')).toThrow();
    });

    it('fails for an eyebrow that shows below 840', () => {
        render(page({ eyebrow: 'nav:inline-flex' }));

        expect(() => expectOneBackInBarAndOneInHeader('Back to Home')).toThrow();
    });

    it('fails for an eyebrow that never shows', () => {
        render(page({ eyebrow: 'hidden' }));

        expect(() => expectOneBackInBarAndOneInHeader('Back to Home')).toThrow();
    });

    it('fails for a page with no bar', () => {
        render(
            <header>
                <a href="/back" aria-label="Back to Home" className={EYEBROW}>
                    Home
                </a>
            </header>,
        );

        expect(() => expectOneBackInBarAndOneInHeader('Back to Home')).toThrow();
    });
});
