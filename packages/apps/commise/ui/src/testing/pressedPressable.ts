/**
 * @module @commise/ui/testing/pressed-pressable: the one test double for a `Pressable` that is pressed.
 *
 * react-native-web's `Pressable` does not toggle `pressed` from jsdom events, so a test that wants the pressed branch
 * of a style or child function stands in for it with a `View` that renders that branch. Test files each wrote their own
 * stand-in and the copies had drifted (one forgot `accessibilityRole`, one `aria-checked`); this is the one for a test
 * that only needs the pressed branch painted. It keeps the role, label, `aria-checked`, `aria-selected` and
 * `aria-expanded` a query reads, and turns `onPress` into a click so a test can still press it.
 *
 * A test whose mock must RECORD the props it was given (to assert on `onPress`, `disabled` and the like) keeps its own
 * `Pressable` mock: a stand-in that renders the real component whenever nothing is pressed cannot do that.
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
 * A held press also calls the `Pressable`'s `onPressIn` once it is mounted, as a finger would. `PressScale` tracks the
 * pressed flag from press-in and press-out and hands it to its children itself, so its pressed branch shows only once
 * that call lands.
 *
 * @pattern Test Double (Stub) — a `View` that renders a `Pressable`'s pressed branch
 */
import { createElement, useLayoutEffect, type ComponentProps } from 'react';
import type { GestureResponderEvent, Pressable as PressableType } from 'react-native';

type PressableProps = ComponentProps<typeof PressableType>;

/** The slice of `react-native` the stand-in needs. */
type NativeModule = Pick<typeof import('react-native'), 'View' | 'Pressable'>;

/**
 * A `Pressable` that renders its `pressed` branch while `isPressed()` is true and is the real one otherwise. It keeps
 * the role, label, checked and selected state a query reads, and calls `onPressIn` while held.
 *
 * @param actual - The real `react-native` module, from `importOriginal`.
 * @param isPressed - Read on every render: whether the press is held.
 * @returns A component to put in the mock factory as `Pressable`.
 */
export function pressedPressable(actual: NativeModule, isPressed: () => boolean = () => true) {
    return (props: PressableProps) => {
        const held = isPressed();
        const { onPressIn } = props;

        useLayoutEffect(() => {
            if (held) {
                // No handler reads the event: a press-in only says the press began.
                onPressIn?.({} as GestureResponderEvent);
            }
        }, [held, onPressIn]);

        if (!held) {
            return createElement(actual.Pressable, props);
        }

        const state = { pressed: true };

        return createElement(
            actual.View,
            {
                role: props.role ?? (props.accessibilityRole as ComponentProps<NativeModule['View']>['role']),
                'aria-label': props['aria-label'] ?? props.accessibilityLabel,
                'aria-checked': props['aria-checked'],
                'aria-selected': props['aria-selected'],
                'aria-expanded': props['aria-expanded'],
                // react-native-web's `View` forwards `onClick` to the DOM; React Native's own `View` type has no such prop.
                ...({ onClick: props.onPress } as object),
                style: typeof props.style === 'function' ? props.style(state) : props.style,
            },
            (typeof props.children === 'function' ? props.children(state) : props.children) as never,
        );
    };
}
