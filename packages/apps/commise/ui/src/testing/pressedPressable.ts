/**
 * @module @commise/ui/testing/pressed-pressable: the one test double for a `Pressable` that is pressed.
 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events, so a test that wants the pressed branch
 * of a style or child function stands in for it with a `View` that renders that branch. Seven test files each wrote
 * their own stand-in and the copies had drifted (one forgot `accessibilityRole`, one `aria-checked`); this is the one.
 *
 * Use it from a `react-native` mock FACTORY through a dynamic import (see `systemColorScheme.ts` for why):
 *
 * ```ts
 * const press = vi.hoisted(() => ({ pressed: false }));
 *
 * vi.mock('react-native', async (importOriginal) => {
 *     const { pressedPressable } = await import('@commise/ui/testing/pressed-pressable');
 *     const actual = await importOriginal<typeof import('react-native')>();
 *
 *     return { ...actual, Pressable: pressedPressable(actual, () => press.pressed) };
 * });
 * ```
 *
 * @pattern Test Double (Stub) — a `View` that renders a `Pressable`'s pressed branch
 */
import { createElement, type ComponentProps } from 'react';
import type { Pressable as PressableType } from 'react-native';

type PressableProps = ComponentProps<typeof PressableType>;

/** The slice of `react-native` the stand-in needs. */
interface NativeModule {
    readonly View: unknown;
    readonly Pressable: unknown;
}

/**
 * A `Pressable` that renders its `pressed` branch while `isPressed()` is true and is the real one otherwise. It keeps
 * the role, label, checked and selected state a query reads. Pure.
 *
 * @param actual - The real `react-native` module, from `importOriginal`.
 * @param isPressed - Read on every render: whether the press is held.
 * @returns A component to put in the mock factory as `Pressable`.
 */
export function pressedPressable(actual: NativeModule, isPressed: () => boolean = () => true) {
    return (props: PressableProps) => {
        if (!isPressed()) {
            return createElement(actual.Pressable as typeof PressableType, props);
        }

        const state = { pressed: true };

        return createElement(
            actual.View as never,
            {
                role: (props.role ?? props.accessibilityRole) as never,
                'aria-label': props['aria-label'] ?? props.accessibilityLabel,
                'aria-checked': props['aria-checked'],
                'aria-selected': props['aria-selected'],
                style: typeof props.style === 'function' ? props.style(state) : props.style,
            },
            (typeof props.children === 'function' ? props.children(state) : props.children) as never,
        );
    };
}
