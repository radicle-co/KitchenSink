import { expect, type Locator } from '@playwright/test';

/**
 * Locators for the design-system `HorizontalScroller` (`@commise/ui/horizontal-scroller`), whose chevron is
 * decorative and so has no role to find it by: it is the `aria-hidden` next sibling of the scroll element. Reading
 * its opacity is the only way to tell it shows, because `toBeVisible` treats `opacity: 0` as visible.
 */

/** The scroll element around some content a spec can find by role (the nearest ancestor that scrolls sideways). */
export function scrollerAround(content: Locator): Locator {
    return content.locator('xpath=ancestor::*[contains(@class, "overflow-x-auto")][1]');
}

/** The chevron of a scroll element. */
export function chevronOf(scroller: Locator): Locator {
    return scroller.locator('xpath=following-sibling::*[@aria-hidden="true"]');
}

/**
 * Wait for the chevron to settle shown or hidden, past its 150 ms fade.
 *
 * @param chevron - The chevron.
 * @param state - Whether it should show.
 */
export async function expectChevron(chevron: Locator, state: 'shown' | 'hidden'): Promise<void> {
    await expect
        .poll(() => chevron.evaluate((element) => getComputedStyle(element).opacity), {
            message: `the chevron should be ${state}`,
        })
        .toBe(state === 'shown' ? '1' : '0');
}

/** Scroll an element to a distance from its start edge, the way a reader's drag would. */
export async function scrollTo(scroller: Locator, left: number): Promise<void> {
    await scroller.evaluate((element, to) => element.scrollTo({ left: to, behavior: 'instant' }), left);
}

/** Whether an element's content is wider than its box. */
export function overflows(scroller: Locator): Promise<boolean> {
    return scroller.evaluate((element) => element.scrollWidth - element.clientWidth > 1);
}
