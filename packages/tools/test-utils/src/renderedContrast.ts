/**
 * @module @commise/test-utils/renderedContrast — measure the WCAG contrast of what a component ACTUALLY rendered.
 *
 * `./contrast.js` answers "what is the ratio between these two colours?". This module answers the question a
 * component test actually has: "what is the ratio a reader experiences on THIS leaf, as it just rendered?" —
 * which is the only form that keeps failing when someone edits the component.
 *
 * The two platforms need two readers, because they carry colour differently:
 *
 *  - **web** — {@link utilityContrast}. jsdom loads no stylesheet, so a Tailwind utility cannot be read back
 *    out as a computed colour. The tempting workaround — `expect(className).toContain('text-slate')` — proves
 *    a spelling, not a ratio: it passes just as happily if the palette re-themes slate to near-white. So the
 *    `text-*` and `bg-*` utilities are looked up in the shared {@link palette} FROM the className the
 *    component really rendered, and both halves stay load-bearing (change the class and the lookup moves,
 *    re-theme the token and the ratio moves).
 *  - **native** — {@link computedContrast}. React-native-web compiles each style object to atomic CSS, which
 *    jsdom DOES compute, so the leaf's colour is read straight off the DOM.
 *
 * Alpha compositing is explicit and required in both. Commise paints most of its chips and glass on
 * TRANSLUCENT surfaces (`bg-seafoam/10`, `rgba(61,139,133,0.1)`), and a ratio measured against the raw token
 * scores the text against opaque seafoam — which no reader ever sees.
 *
 * `variant` exists because a HOVER state is a state like any other: a chip whose resting pair passes and
 * whose `hover:bg-…` tint pushes it back under the floor is still an inaccessible chip, and that is exactly
 * the defect this module first caught.
 *
 * Every function here is pure apart from reading the DOM, which {@link computedContrast} documents.
 */
import { parse } from 'culori';
import { palette } from '@commise/ui';

import { compositeOver, contrastRatio } from './contrast.js';

/**
 * A `text-…` / `bg-…` utility with an optional leading variant and an optional `/NN` opacity suffix —
 * `bg-coral/10`, `text-slate`, `hover:bg-coral/25`.
 */
const COLOR_UTILITY = /^(?:([a-z-]+):)?(text|bg)-([a-z-]+?)(?:\/(\d{1,3}))?$/;

/** The CSS notation jsdom reports for "no background painted here". */
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** How to read a class list: which surface the element is painted over, and which variant state to measure. */
export interface UtilityContrastOptions {
    /** The opaque colour BEHIND the element's own translucent background. Defaults to white. */
    readonly surface?: string;
    /** A Tailwind variant to prefer, e.g. `'hover'`. Utilities without it are the fallback. */
    readonly variant?: string;
}

/** How to read a rendered native leaf: the opaque colour its (possibly translucent) background sits on. */
export interface ComputedContrastOptions {
    /** The opaque colour BEHIND the element's own background. Defaults to white. */
    readonly surface?: string;
}

/**
 * Find the `text-*` or `bg-*` utilities in `className` that name a PALETTE colour, preferring the ones
 * carrying `variant` when a variant is requested.
 *
 * Type utilities that share the prefix (`text-body-sm`, `text-caption`) resolve to no palette entry and are
 * skipped, which is what lets one regex serve both roles. Pure.
 */
function candidates(
    className: string,
    prefix: 'text' | 'bg',
    variant: string | undefined,
): readonly { readonly name: string; readonly alphaPercent: string | undefined }[] {
    const all = className
        .split(/\s+/)
        .map((token) => COLOR_UTILITY.exec(token))
        .filter((match): match is RegExpExecArray => match !== null && match[2] === prefix)
        .map((match) => ({ variant: match[1], name: match[3] as string, alphaPercent: match[4] }))
        .filter(({ name }) => name in palette);

    // A requested variant WINS where it exists; otherwise the state inherits the base utility.
    const scoped = all.filter((candidate) => candidate.variant === variant);

    return scoped.length > 0 ? scoped : all.filter((candidate) => candidate.variant === undefined);
}

/** The palette colour a resolved utility names, with its `/NN` suffix applied as hex alpha. Pure. */
function colorOf({ name, alphaPercent }: { name: string; alphaPercent: string | undefined }): string {
    const color = palette[name as keyof typeof palette];

    return alphaPercent === undefined ? color : `${color}${toHexAlpha(Number.parseInt(alphaPercent, 10) / 100)}`;
}

/**
 * The element's FOREGROUND colour, which must be present exactly once.
 *
 * @throws Error when the class list carries no palette-coloured `text-*` utility, or more than one at the
 *   same variant level (an ambiguous measurement is worse than none — it would silently measure whichever
 *   came first).
 */
function foreground(className: string, variant: string | undefined): string {
    const found = candidates(className, 'text', variant);

    if (found.length !== 1) {
        throw new Error(
            `Expected exactly ONE palette-coloured \`text-*\` utility in "${className}", found ${found.length}.`,
        );
    }

    return colorOf(found[0] as { name: string; alphaPercent: string | undefined });
}

/**
 * The element's BACKGROUND, flattened onto `surface`.
 *
 * Zero `bg-*` utilities is the ordinary case, not an error: a bare text button paints no background of its
 * own, so the colour behind it IS the surface. (A misspelt utility lands here too — and measuring it against
 * the surface is still correct, because a misspelt utility paints nothing either.)
 *
 * @throws Error when more than one palette-coloured `bg-*` utility applies at the same variant level.
 */
function background(className: string, variant: string | undefined, surface: string): string {
    const found = candidates(className, 'bg', variant);

    if (found.length > 1) {
        throw new Error(
            `Expected at most ONE palette-coloured \`bg-*\` utility in "${className}", found ${found.length}.`,
        );
    }

    return found.length === 0
        ? surface
        : compositeOver(colorOf(found[0] as { name: string; alphaPercent: string | undefined }), surface);
}

/**
 * The WCAG contrast ratio between a rendered element's `text-*` colour and its `bg-*` colour, with the
 * background's alpha flattened onto the surface it is painted over. Pure.
 *
 * @param className - The element's ACTUAL rendered class list (read it off the DOM, never re-spell it).
 * @param options - The backdrop and the variant state to measure. Defaults to the resting state over white,
 *   which is what every Commise card resolves to under its glass.
 * @returns The ratio, 1..21.
 */
export function utilityContrast(className: string, options: UtilityContrastOptions = {}): number {
    const { surface = palette.white, variant } = options;

    return contrastRatio(
        compositeOver(foreground(className, variant), surface),
        background(className, variant, surface),
    );
}

/**
 * The WCAG contrast ratio between a rendered NATIVE leaf's computed text colour and the surface behind it —
 * the react-native-web mirror of {@link utilityContrast}.
 *
 * The foreground is read from the DOM (so re-theming a token, or pointing a `StyleSheet` entry at a different
 * palette key, moves the measurement), while the surface is stated by the caller, because a native leaf's
 * tint usually lives on an ancestor `View` that jsdom will not attribute to the text node. Any background the
 * element paints on ITSELF is composited over `surface` first.
 *
 * @sideEffect Reads computed style from the DOM.
 * @param element - The rendered element whose text colour is being measured.
 * @param options - The opaque colour behind the element. Defaults to white.
 * @returns The ratio, 1..21.
 * @throws Error when the element has no computed colour (it was never rendered, or carries no colour style).
 */
export function computedContrast(element: Element, options: ComputedContrastOptions = {}): number {
    const { surface = palette.white } = options;
    const style = window.getComputedStyle(element);

    // An unrendered or unstyled leaf reports an EMPTY (or otherwise unreadable) colour. Left alone that
    // reaches culori as `undefined` and surfaces as an inscrutable "cannot read 'alpha'", which reads like a
    // tooling bug rather than what it is: a test measuring an element it never actually rendered.
    if (parse(style.color) === undefined) {
        throw new Error('Expected the element to carry a computed `color`; measuring nothing proves nothing.');
    }

    const backdrop =
        style.backgroundColor === TRANSPARENT || parse(style.backgroundColor) === undefined
            ? surface
            : compositeOver(style.backgroundColor, surface);

    return contrastRatio(compositeOver(style.color, backdrop), backdrop);
}

/** An 0..1 alpha as the two hex digits an `#RRGGBBAA` colour carries. Pure. */
function toHexAlpha(alpha: number): string {
    return Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0');
}
