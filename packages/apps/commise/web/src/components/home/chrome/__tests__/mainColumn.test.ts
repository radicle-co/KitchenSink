import { describe, expect, it } from 'vitest';

import { mainColumnOf } from '../mainColumn';

/** An element whose box is `rect`, standing in for the laid-out `<main>` (jsdom lays nothing out). */
const mainAt = (rect: Partial<DOMRect>): HTMLElement => {
    const main = document.createElement('main');
    main.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        toJSON: () => ({}),
        ...rect,
    });

    return main;
};

/**
 * The column `<main>` is, measured, as the viewport px outside it: no sidebar width is stated anywhere (issue 508).
 */
describe('mainColumnOf', () => {
    it('is the whole viewport before there is a `<main>`', () => {
        expect(mainColumnOf(null, 1024)).toStrictEqual({ left: 0, right: 0 });
    });

    it('is the whole viewport where `<main>` spans it, as below the width the sidebar shows', () => {
        expect(mainColumnOf(mainAt({ left: 0, right: 600 }), 600)).toStrictEqual({ left: 0, right: 0 });
    });

    it('is the box beside a 256 wide sidebar at 1024', () => {
        expect(mainColumnOf(mainAt({ left: 256, right: 1024 }), 1024)).toStrictEqual({ left: 256, right: 0 });
    });

    it('follows a collapsed sidebar, whatever width it has', () => {
        expect(mainColumnOf(mainAt({ left: 72, right: 1024 }), 1024)).toStrictEqual({ left: 72, right: 0 });
    });

    it('counts a side panel on the right the same way', () => {
        expect(mainColumnOf(mainAt({ left: 256, right: 700 }), 1024)).toStrictEqual({ left: 256, right: 324 });
    });

    it('never goes negative when `<main>` overflows the viewport on either side', () => {
        expect(mainColumnOf(mainAt({ left: -40, right: 1100 }), 1024)).toStrictEqual({ left: 0, right: 0 });
    });
});
