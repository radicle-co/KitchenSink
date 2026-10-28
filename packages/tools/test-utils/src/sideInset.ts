/**
 * How far an element sits in from the screen's left edge, in px: the left padding and left margin of every ancestor up
 * to the document body. jsdom has no layout, so this reads what the styles ask for. It is how a test proves a title is
 * inset ONCE: the large title insets its own sides, so a screen that also pads around it moves the title in twice.
 *
 * @param element - The element to measure from.
 * @returns The summed left padding and margin of its ancestors, in px.
 */
export const sideInsetOf = (element: HTMLElement): number => {
    let total = 0;

    for (let node = element.parentElement; node !== null && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);

        total += (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.marginLeft) || 0);
    }

    return total;
};
