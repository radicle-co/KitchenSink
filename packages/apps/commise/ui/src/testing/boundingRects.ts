/**
 * @module @commise/ui/testing/bounding-rects: gives elements a size under jsdom, which lays nothing out.
 *
 * Tamagui's web build, which the native test lane runs, reports a view's `onLayout` and a scroller's
 * `onContentSizeChange` once, when the view mounts, from `getBoundingClientRect`. jsdom answers with an empty rect, so a
 * test that needs a measured size installs this stub BEFORE it renders, and the size is read at mount. A size cannot
 * change afterwards: render again to measure again. (react-native-web's `onLayout` is the other path, driven by
 * `@commise/ui/testing/resize-observer`.)
 *
 * @pattern Test Double (Stub) — `getBoundingClientRect` answers from a rule the test states
 */

/** The size a rule gives an element; `height` defaults to 0. */
export interface StubbedSize {
    readonly width: number;
    readonly height?: number;
}

/**
 * Make `getBoundingClientRect` answer from `sizeOf`.
 *
 * @sideEffect Replaces `Element.prototype.getBoundingClientRect` until the returned function is called.
 * @param sizeOf - The size of an element, or `undefined` to leave it with jsdom's empty rect.
 * @returns A function that restores the original, for the test's `afterEach`.
 */
export function stubBoundingRects(sizeOf: (element: Element) => StubbedSize | undefined): () => void {
    const original = Element.prototype.getBoundingClientRect;

    Element.prototype.getBoundingClientRect = function boundingRect(this: Element): DOMRect {
        const size = sizeOf(this);

        if (size === undefined) {
            return original.call(this);
        }

        const { width, height = 0 } = size;

        return { x: 0, y: 0, top: 0, left: 0, width, height, right: width, bottom: height, toJSON: () => ({}) };
    };

    return () => {
        Element.prototype.getBoundingClientRect = original;
    };
}

/** The widths of a horizontal scroller's three measured views. */
export interface ScrollViewWidths {
    /** The scroller itself (the Tamagui `ScrollView`, found by its `overflow-x`). */
    readonly scroller: number;
    /** The content inside it. */
    readonly content: number;
    /** The box around the scroller and the chevron's column: the scroller's grandparent. Left empty when omitted. */
    readonly box?: number;
}

const isScrollView = (element: Element | null | undefined): boolean =>
    (element as HTMLElement | null | undefined)?.style?.overflowX === 'auto';

/**
 * A rule for {@link stubBoundingRects} that sizes a horizontal `ScrollView`, its content, and the box two levels above it,
 * found by where they sit in the tree.
 *
 * @param widths - The three widths.
 * @returns The rule.
 */
export function scrollViewSizes({
    scroller,
    content,
    box,
}: ScrollViewWidths): (element: Element) => StubbedSize | undefined {
    return (element) => {
        if (isScrollView(element)) {
            return { width: scroller };
        }

        if (isScrollView(element.parentElement)) {
            return { width: content };
        }

        return box !== undefined && isScrollView(element.firstElementChild?.firstElementChild)
            ? { width: box }
            : undefined;
    };
}
