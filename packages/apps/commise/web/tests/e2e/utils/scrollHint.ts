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

/**
 * The chevron sits in a column BESIDE the scroller (`horizontalScrollHint.md` §3.6), never over it: drawn over the
 * scroller it hid the last characters of the chip at the edge. Asserted on rectangles, which is what a reader sees:
 * the chevron's box starts where the scroller's ends (inline-end edge, either direction), and the two do not overlap.
 *
 * @param scroller - The scroll element.
 */
export async function expectChevronBesideScroller(scroller: Locator): Promise<void> {
    const scrollerBox = await scroller.boundingBox();
    const chevronBox = await chevronOf(scroller).boundingBox();

    expect(scrollerBox, 'the scroller is laid out').not.toBeNull();
    expect(chevronBox, 'the chevron takes a column while the content overflows').not.toBeNull();

    const overlap =
        Math.min(scrollerBox!.x + scrollerBox!.width, chevronBox!.x + chevronBox!.width) -
        Math.max(scrollerBox!.x, chevronBox!.x);

    expect(overlap, 'the chevron does not cover the scroller').toBeLessThanOrEqual(0.5);
}

/**
 * Scrolled to the end, the last item is whole inside the scroller and can be pressed: nothing covers it, and nothing
 * clips it.
 *
 * @param scroller - The scroll element.
 * @param lastItem - Its last item (a chip).
 */
export async function expectLastItemWholeAndPressable(scroller: Locator, lastItem: Locator): Promise<void> {
    await scrollTo(scroller, 100000);
    await expect(lastItem).toBeVisible();

    const scrollerBox = await scroller.boundingBox();
    const itemBox = await lastItem.boundingBox();

    expect(scrollerBox).not.toBeNull();
    expect(itemBox).not.toBeNull();
    expect(itemBox!.x, 'the last item is not clipped at the start edge').toBeGreaterThanOrEqual(scrollerBox!.x - 0.5);
    expect(itemBox!.x + itemBox!.width, 'the last item is not clipped at the end edge').toBeLessThanOrEqual(
        scrollerBox!.x + scrollerBox!.width + 0.5,
    );

    // `trial` runs every actionability check, including that nothing else would receive the press, without pressing.
    await lastItem.click({ trial: true });
}
