/**
 * jsdom gaps that `@radix-ui/react-dropdown-menu` requires.
 *
 * ⛔ POLYFILLS, NOT BEHAVIOUR. Every one of these is a browser API jsdom does not implement at all, and
 * Radix's menu calls them on the open path — so without them the menu silently never opens and every
 * assertion fails with "unable to find role menu", which reads like a component defect and is not one.
 *
 * ⚠️ Deliberately NOT stubbed to observable values. `getBoundingClientRect` returning zeroes is jsdom's own
 * behaviour and is left alone: a test that depended on real geometry would be asserting layout in a renderer
 * that does no layout, and would pass or fail for reasons unrelated to the code under test. Positioning is
 * Playwright's job, where there is a real box.
 */
if (typeof Element !== 'undefined') {
    // Pointer capture: `MenuItem` calls `hasPointerCapture` while deciding whether a pointerup is a
    // selection or the tail of a drag. jsdom implements none of the three.
    Element.prototype.hasPointerCapture ??= (): boolean => false;
    Element.prototype.setPointerCapture ??= (): void => undefined;
    Element.prototype.releasePointerCapture ??= (): void => undefined;
    // Roving focus scrolls the newly-highlighted item into view.
    Element.prototype.scrollIntoView ??= (): void => undefined;
}

// `@radix-ui/react-popper` observes the trigger and content to keep them aligned.
globalThis.ResizeObserver ??= class {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
} as unknown as typeof ResizeObserver;

globalThis.DOMRect ??= class {
    public constructor(
        public readonly x = 0,
        public readonly y = 0,
        public readonly width = 0,
        public readonly height = 0,
    ) {}
    public readonly top = 0;
    public readonly left = 0;
    public readonly right = 0;
    public readonly bottom = 0;
    public static fromRect(): DOMRect {
        return new DOMRect();
    }
    public toJSON(): unknown {
        return {};
    }
} as unknown as typeof DOMRect;
