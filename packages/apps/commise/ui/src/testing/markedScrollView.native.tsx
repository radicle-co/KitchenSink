/**
 * @module @commise/ui/testing/marked-scroll-view — a test double for Tamagui's `ScrollView` that marks its element, for
 * suites that must say "this control sits in a scroll region whose first tap lands".
 *
 * jsdom has no layout, so whether a card can be scrolled to cannot be measured; a suite asserts the structure instead: the
 * control is inside the marked region, and the mark carries the region's `keyboardShouldPersistTaps`. Use it from a
 * `tamagui` mock factory through a dynamic import (`vi.mock` is hoisted above static imports):
 *
 * ```ts
 * vi.mock('tamagui', async (importOriginal) => {
 *     const { withMarkedScrollView } = await import('@commise/ui/testing/marked-scroll-view');
 *
 *     return withMarkedScrollView(await importOriginal<{ ScrollView: ComponentType<{ keyboardShouldPersistTaps?: string }> }>());
 * });
 * ```
 *
 * @pattern Test Double (Spy) — wraps the real `ScrollView` and records one prop on a marker element around it
 */
import { createElement, type ComponentType } from 'react';

/** The part of a module this double needs: a `ScrollView` that reads `keyboardShouldPersistTaps`. */
export interface HasScrollView {
    readonly ScrollView: ComponentType<{ readonly keyboardShouldPersistTaps?: string }>;
}

/**
 * The module with its `ScrollView` wrapped in a marker. Pure.
 *
 * @param actual - The real module, from `importOriginal`.
 * @returns The same members, with `ScrollView` marked `data-scroll-region`.
 */
export function withMarkedScrollView<T extends HasScrollView>(actual: T): T {
    return {
        ...actual,
        ScrollView: (props) =>
            createElement(
                'div',
                { 'data-scroll-region': props.keyboardShouldPersistTaps ?? 'never' },
                createElement(actual.ScrollView, props),
            ),
    };
}
