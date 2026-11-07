/**
 * @module @commise/ui/testing/tamagui — test helpers for components styled with Tamagui, under the native test lane.
 *
 * The lane runs Tamagui's WEB build, which paints a theme colour as a CSS variable (`var(--paper)`) and defines the
 * variable twice over: the theme's rule (`:root .t_dark { --paper: var(--t1) }`) points at a value defined at the root
 * (`--t1: #…`). jsdom resolves neither. It also drops a shorthand whose value is a variable (`border-color: var(…)`),
 * so the computed border colour falls back to React Native Web's reset. {@link resolvedColour} therefore reads what
 * the element's own class rules DECLARE, shorthands included, and follows the variables from the element's nearest
 * theme class the way a browser would, so a test can assert the colour a role really has, and its contrast.
 *
 * @pattern Interpreter — evaluates Tamagui's class rules and theme variables over jsdom's CSSOM, as a browser would
 */
import { act, fireEvent, render as renderBare, type RenderOptions, type RenderResult } from '@testing-library/react';
import { formatRgb } from 'culori';
import { vi } from 'vitest';
import type { JSX, ReactElement, ReactNode } from 'react';

import { DesignSystemProvider } from '../tamagui/DesignSystemProvider.native.js';
import { DesignSystemTheme } from '../tamagui/DesignSystemTheme.native.js';
import type { ColorSchemeName } from '../theme/themeFor.js';

/** The colour properties a test reads. */
export type ColourProperty = 'backgroundColor' | 'color' | 'borderTopColor';

/** A style property a test reads, by its camel-case name (`minHeight`, `borderTopLeftRadius`). */
export type StyleProperty = Extract<keyof CSSStyleDeclaration, string>;

const VARIABLE = /^var\(--([\w-]+)\)$/u;

/** The shorthand that also sets a longhand, for the longhands Tamagui writes as a shorthand. */
const SHORTHAND_OF: Readonly<Record<string, string>> = {
    'border-top-color': 'border-color',
    'border-top-width': 'border-width',
    'border-bottom-width': 'border-width',
    'border-top-left-radius': 'border-radius',
    'border-top-right-radius': 'border-radius',
    'border-bottom-left-radius': 'border-radius',
    'border-bottom-right-radius': 'border-radius',
    'padding-left': 'padding-inline',
    'padding-right': 'padding-inline',
    'padding-top': 'padding-block',
    'padding-bottom': 'padding-block',
};

function declaredNames(property: StyleProperty): readonly string[] {
    const longhand = property.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
    const shorthand = SHORTHAND_OF[longhand];

    return shorthand === undefined ? [longhand] : [shorthand, longhand];
}

/**
 * Testing Library's `render`, inside the design system's provider and in the scheme the device reports, so a
 * component built on Tamagui renders as it does in the app. A test fakes the scheme with
 * `@commise/ui/testing/system-color-scheme`. A `wrapper` the caller passes sits inside the provider, and a `rerender`
 * keeps both. This is Testing Library's own "custom render" pattern: a test imports `render` from here instead.
 *
 * @param ui - The tree.
 * @param options - Testing Library's render options.
 * @returns The render result.
 * @sideEffect Mounts into the document.
 */
export function render(ui: ReactElement, options: RenderOptions = {}): RenderResult {
    const { wrapper: Inner, ...rest } = options;
    const wrapper = ({ children }: { readonly children: ReactNode }): JSX.Element => (
        <DesignSystemProvider>{Inner === undefined ? children : <Inner>{children}</Inner>}</DesignSystemProvider>
    );

    return renderBare(ui, { ...rest, wrapper });
}

/** The attribute on the hidden config marker Tamagui's web build renders beside every provider. */
const CONFIG_MARKER = 'data-tamagui-config-revision';

/**
 * A selector for what a tree hides from assistive technology. Tamagui's web build renders a hidden config marker with
 * `aria-hidden` beside every provider, which a device does not draw, so a count of hidden elements leaves it out.
 */
export const ARIA_HIDDEN_CONTENT = `[aria-hidden="true"]:not([${CONFIG_MARKER}])`;

/** Whether an element is one Tamagui's web build adds around a tree: its hidden config marker or a box-less wrapper. */
function isTamaguiFrame(element: Element): boolean {
    return (
        element.hasAttribute(CONFIG_MARKER) ||
        (element instanceof HTMLElement && element.style.display === 'contents') ||
        element.classList.contains('_dsp_contents')
    );
}

function firstBox(container: Element): Element | undefined {
    for (const child of Array.from(container.children)) {
        if (!isTamaguiFrame(child)) {
            return child;
        }

        const inner = child.hasAttribute(CONFIG_MARKER) ? undefined : firstBox(child);

        if (inner !== undefined) {
            return inner;
        }
    }

    return undefined;
}

/**
 * The first element a tree rendered, stepping over what Tamagui's web build adds around it: a hidden config marker
 * and theme wrappers set to `display: contents`, which draw no box. A device draws neither, so a test that reads "the
 * row is the root" reads it through this. Pure.
 *
 * @param container - The element the tree rendered into.
 * @returns The first element that draws a box.
 */
export function renderedRoot(container: Element): Element {
    const root = firstBox(container);

    if (root === undefined) {
        throw new Error('renderedRoot: the tree rendered no element');
    }

    return root;
}

/**
 * Whether a tree rendered nothing, past what Tamagui's web build adds around it: no element that draws a box, and no
 * text. Pure.
 *
 * @param container - The element the tree rendered into.
 * @returns `true` when nothing inside draws a box.
 */
export function rendersNothing(container: Element): boolean {
    return firstBox(container) === undefined && (container.textContent ?? '').trim() === '';
}

/**
 * Render a tree inside the design system's Tamagui provider, in one scheme, whatever the device reports. For a test of
 * a primitive that asserts both schemes without faking the device.
 *
 * @param ui - The tree.
 * @param scheme - The scheme to render in.
 * @param textScale - The system text scale, 1 unless a test sets it.
 * @returns The render result.
 * @sideEffect Mounts into the document.
 */
export function renderWithTamagui(ui: ReactElement, scheme: ColorSchemeName, textScale = 1): RenderResult {
    return renderBare(
        <DesignSystemTheme scheme={scheme} textScale={textScale}>
            {ui}
        </DesignSystemTheme>,
    );
}

/**
 * The theme names an element is under, most specific first: its nearest Tamagui theme class and that theme's parents
 * (`t_light_inverse` is `['light_inverse', 'light']`). A sub-theme states only the keys it changes, so a variable is
 * looked up down this chain, as Tamagui's own merge does.
 */
function themeChainOf(element: Element): readonly string[] {
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
        const match = /(?:^|\s)t_((?:light|dark)(?:_[A-Za-z0-9]+)*)(?=\s|$)/u.exec(node.className);

        if (match?.[1] !== undefined) {
            const parts = match[1].split('_');

            return parts.map((_part, index) => parts.slice(0, parts.length - index).join('_'));
        }
    }

    throw new Error('The element is not inside a Tamagui theme; render it with renderWithTamagui.');
}

function styleRules(): readonly CSSStyleRule[] {
    return [...document.styleSheets].flatMap((sheet) =>
        [...sheet.cssRules].filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule),
    );
}

/** Whether a selector is a theme's own rule: Tamagui writes a sub-theme's with a `:not(#t_theme_full_name)` guard. */
const ownsTheme = (selector: string, theme: string): boolean =>
    selector === `:root .t_${theme}` || selector === `:root .t_${theme}:not(#t_theme_full_name)`;

/** The value a variable has under an element's themes: the nearest theme's own rule first, then its parents, then the root. */
function variableValue(name: string, themes: readonly string[]): string {
    const selectors = (rule: CSSStyleRule): readonly string[] => rule.selectorText.split(',').map((s) => s.trim());
    const declared = (rule: CSSStyleRule): string => rule.style.getPropertyValue(`--${name}`).trim();
    const rules = styleRules();
    const inTheme = themes
        .map((theme) =>
            rules.find(
                (rule) => selectors(rule).some((selector) => ownsTheme(selector, theme)) && declared(rule) !== '',
            ),
        )
        .find((rule) => rule !== undefined);
    const atRoot = rules.find((rule) => selectors(rule).includes(':root') && declared(rule) !== '');
    const found = inTheme ?? atRoot;

    if (found === undefined) {
        throw new Error(`No Tamagui theme defines --${name} under ${themes.join(', ')}.`);
    }

    return declared(found);
}

/** The value the element's inline style declares for a property, which wins over its class rules as in a browser. */
function declaredInline(element: Element, property: StyleProperty): string | undefined {
    if (!(element instanceof HTMLElement)) {
        return undefined;
    }

    const declared = declaredNames(property)
        .map((name) => element.style.getPropertyValue(name).trim())
        .filter((value) => value !== '');

    return declared.at(-1);
}

/**
 * The number of the element's classes a selector is made of, or 0 when the selector names anything else. A variant
 * repeats its class (`._b-1._b-1`) to win on specificity, so the count is the selector's specificity among the
 * element's own rules.
 */
function ownClassSpecificity(selector: string, classes: ReadonlySet<string>): number {
    const names = selector.trim().split('.').slice(1);

    return selector.trim().startsWith('.') && names.length > 0 && names.every((name) => classes.has(name))
        ? names.length
        : 0;
}

/**
 * The value the element's own class rules declare for a property, as a browser picks it: the most specific rule, and
 * the last of those. `undefined` when no rule of the element's declares it.
 */
function declaredOnClasses(element: Element, property: StyleProperty): string | undefined {
    const classes = new Set(element.classList);
    const winner = styleRules()
        .map((rule, order) => ({ rule, order, specificity: ownClassSpecificity(rule.selectorText, classes) }))
        .filter(({ specificity }) => specificity > 0)
        .flatMap(({ rule, order, specificity }) =>
            declaredNames(property)
                .map((name) => rule.style.getPropertyValue(name).trim())
                .filter((value) => value !== '')
                .map((value) => ({ value, order, specificity })),
        )
        .sort((a, b) => a.specificity - b.specificity || a.order - b.order)
        .at(-1);

    return winner?.value;
}

/**
 * The value an element has for one style property, with every Tamagui variable resolved: a theme colour from the
 * element's nearest theme, a size, space or radius token from the root.
 *
 * @param element - The element.
 * @param property - The property, by its camel-case name.
 * @returns The value, or the computed value as it is when no variable is involved. An edge width no style sets is
 *     `0px`, as React Native draws it.
 * @throws Error when a variable is defined by no theme, so a misspelt token cannot read as a value.
 */
export function resolvedStyle(element: Element, property: StyleProperty): string {
    const themes = themeChainOf(element);
    const computed = getComputedStyle(element)[property];
    let value =
        declaredInline(element, property) ??
        declaredOnClasses(element, property) ??
        // React Native draws no edge it is not given; jsdom answers its own default width for an undeclared border.
        (/^border\w*Width$/u.test(property) ? '0px' : undefined) ??
        (typeof computed === 'string' ? computed : '');

    for (let hops = 0; hops < 8; hops += 1) {
        const variable = VARIABLE.exec(value);

        if (variable?.[1] === undefined) {
            return value;
        }

        value = variableValue(variable[1], themes);
    }

    throw new Error(`The ${property} variables of the element do not end in a value.`);
}

/**
 * The frame `PressScale` wraps a control's `Pressable` in: the control's parent, which carries the press scale and the
 * width. The scale reaches the DOM as Tamagui's `_s-compose` class, so a parent without it is refused rather than read.
 *
 * @param control - The pressable control, found by its role.
 * @returns The frame.
 * @throws Error when the control's parent is not a press-scale frame.
 */
export function pressFrameOf(control: Element): HTMLElement {
    const frame = control.parentElement;

    if (frame === null || !frame.classList.contains('_s-compose')) {
        throw new Error('The control is not inside a PressScale frame.');
    }

    return frame;
}

/**
 * The press scale `PressScale` draws a control at: `1` at rest, `0.98` while held.
 *
 * @param control - The pressable control, found by its role.
 * @returns The scale, as Tamagui writes it.
 */
export function pressScaleOf(control: Element): string {
    return getComputedStyle(pressFrameOf(control)).getPropertyValue('--t-scale-x').trim();
}

/**
 * The colour an element paints for one property, with every Tamagui theme variable resolved.
 *
 * @param element - The element.
 * @param property - The colour property.
 * @returns The colour as `rgb(…)`.
 * @throws Error when a variable is defined by no theme, so a misspelt token cannot read as a colour.
 */
export function resolvedColour(element: Element, property: ColourProperty): string {
    const value = resolvedStyle(element, property);

    return formatRgb(value) ?? value;
}

/**
 * Fire a scroll event on a scroll view and settle the timer it starts. React Native Web's (and so Tamagui's)
 * `ScrollView` reports the END of a scroll 100 ms later on a timer; on a real one it fires after the file's environment
 * is torn down and sets state with no `window` (`ReferenceError: window is not defined`, an unhandled error that exits
 * the lane with every test green). The timers are faked for the event, flushed inside `act` while the DOM is there, and
 * real timers are restored.
 *
 * ⚠️ It ends with real timers on, so it THROWS when the test has already faked its timers, rather than switch them off
 * without a word. A test that fakes its own timers fires the event and flushes them itself.
 *
 * @param node - The scroll view's node.
 * @param init - The event's init, as `fireEvent.scroll` takes it (`{ target: { scrollTop: 240 } }`).
 * @sideEffect Dispatches the event, runs the pending timers and switches timers back to real ones.
 * @throws Error when timers are already faked.
 */
export function fireScrollAndSettle(node: Element, init?: Parameters<typeof fireEvent.scroll>[1]): void {
    if (vi.isFakeTimers()) {
        throw new Error(
            'fireScrollAndSettle: fake timers are already on, and it would turn them off. Fire the event and flush your own timers.',
        );
    }

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
        fireEvent.scroll(node, init);
        act(() => {
            vi.runOnlyPendingTimers();
        });
    } finally {
        vi.useRealTimers();
    }
}
