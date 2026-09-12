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
 * {@link ringContrast} is the third reader, and it exists because a FOCUS RING is not a border: Tailwind draws
 * `ring-*` as a spread box-shadow OUTSIDE the border box, so its backdrop is the surface the control sits on
 * and never the control's own fill. Scoring it like a border is how a focus indicator measures "fine" while
 * being invisible on the page.
 *
 * Every function here is pure apart from reading the DOM, which {@link computedContrast} documents.
 */
import { parse } from 'culori';
import { palette } from '@commise/ui/colors';

import { compositeOver, contrastRatio } from './contrast.js';

/**
 * A `text-…` / `bg-…` / `border-…` / `ring-…` utility with an optional leading variant and an optional `/NN`
 * opacity suffix — `bg-coral/10`, `text-slate`, `hover:bg-coral/25`, `border-mist`,
 * `focus-visible:ring-seafoam`.
 *
 * Sizing, side and geometry variants fall out naturally: `border-2`, `border-b-2`, `ring-2` and
 * `ring-offset-2` all carry digits, which `[a-z-]+?` cannot match, and `border-border` / `ring-inset` name no
 * palette entry — so none of them is mistaken for a colour.
 */
const COLOR_UTILITY = /^(?:([a-z-]+):)?(text|bg|border|ring)-([a-z-]+?)(?:\/(\d{1,3}))?$/;

/** The CSS notation jsdom reports for "no background painted here". */
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** How to read a class list: which surface the element is painted over, and which variant state to measure. */
export interface UtilityContrastOptions {
    /** The opaque colour BEHIND the element's own translucent background. Defaults to white. */
    readonly surface?: string;
    /** A Tailwind variant to prefer, e.g. `'hover'`. Utilities without it are the fallback. */
    readonly variant?: string;
    /**
     * Which foreground to measure. `'text'` (the default) is the label. `'border'` measures the element's
     * OUTLINE instead — an unchecked checkbox or an outlined control has no label of its own, and its border
     * is the whole of what makes it perceivable. Compare a border against the 3:1 `ui-component` floor
     * (SC 1.4.11), not 4.5:1.
     */
    readonly foreground?: 'text' | 'border';
}

/** How to read a rendered native leaf: the opaque colour its (possibly translucent) background sits on. */
export interface ComputedContrastOptions {
    /** The opaque colour BEHIND the element's own background. Defaults to white. */
    readonly surface?: string;
}

/** How to read a rendered FOCUS RING: the opaque colour of the surface the ring is drawn on. */
export interface RingContrastOptions {
    /**
     * The opaque colour the ring is painted OVER — the element's backdrop, NOT the element's own fill.
     * Defaults to white. See {@link ringContrast} for why the element's own `bg-*` is deliberately ignored.
     */
    readonly surface?: string;
}

/** One parsed colour utility: the variant it is scoped to, the palette key, and its `/NN` alpha suffix. */
interface ColorUtility {
    readonly variant: string | undefined;
    readonly name: string;
    readonly alphaPercent: string | undefined;
}

/**
 * Every utility of one role in `className` that names a PALETTE colour, in source order, each keeping the
 * variant it is scoped to.
 *
 * Non-colour utilities that share a prefix (`text-body-sm`, `text-caption`, `border-2`, `border-border`,
 * `ring-2`, `ring-offset-2`) resolve to no palette entry and are skipped, which is what lets one regex serve
 * every role. Pure.
 */
function colorUtilities(className: string, prefix: 'text' | 'bg' | 'border' | 'ring'): readonly ColorUtility[] {
    return className
        .split(/\s+/)
        .map((token) => COLOR_UTILITY.exec(token))
        .filter((match): match is RegExpExecArray => match !== null && match[2] === prefix)
        .map((match) => ({ variant: match[1], name: match[3] as string, alphaPercent: match[4] }))
        .filter(({ name }) => name in palette);
}

/**
 * Find the utilities of one role in `className` that name a PALETTE colour, preferring the ones carrying
 * `variant` when a variant is requested. Pure.
 */
function candidates(
    className: string,
    prefix: 'text' | 'bg' | 'border',
    variant: string | undefined,
): readonly ColorUtility[] {
    const all = colorUtilities(className, prefix);

    // A requested variant WINS where it exists; otherwise the state inherits the base utility.
    const scoped = all.filter((candidate) => candidate.variant === variant);

    return scoped.length > 0 ? scoped : all.filter((candidate) => candidate.variant === undefined);
}

/** The palette colour a resolved utility names, with its `/NN` suffix applied as hex alpha. Pure. */
function colorOf({ name, alphaPercent }: ColorUtility): string {
    const color = palette[name as keyof typeof palette];

    return alphaPercent === undefined ? color : `${color}${toHexAlpha(Number.parseInt(alphaPercent, 10) / 100)}`;
}

/**
 * The element's FOREGROUND colour, which must be present exactly once.
 *
 * @throws Error when the class list carries no palette-coloured utility of that role, or more than one at the
 *   same variant level (an ambiguous measurement is worse than none — it would silently measure whichever
 *   came first).
 */
function foreground(className: string, role: 'text' | 'border', variant: string | undefined): string {
    const found = candidates(className, role, variant);

    if (found.length !== 1) {
        throw new Error(
            `Expected exactly ONE palette-coloured \`${role}-*\` utility in "${className}", found ${found.length}.`,
        );
    }

    return colorOf(found[0] as ColorUtility);
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

    return found.length === 0 ? surface : compositeOver(colorOf(found[0] as ColorUtility), surface);
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
    const { surface = palette.white, variant, foreground: role = 'text' } = options;

    return contrastRatio(
        compositeOver(foreground(className, role, variant), surface),
        background(className, variant, surface),
    );
}

/**
 * The WCAG contrast ratio of a rendered element's FOCUS RING against the surface the ring is drawn on. Pure.
 *
 * ## Why a ring needs its own reader instead of `utilityContrast(…, { foreground: 'border' })`
 *
 * A `border-*` is INSIDE the element's box, so its backdrop is the element's own `bg-*`. A Tailwind `ring-*`
 * is a spread `box-shadow` drawn OUTSIDE the border box (`--tw-ring-offset-width` is 0 by default), so its
 * backdrop is whatever the element is sitting ON — the card, the page, the tinted chip around it. Measuring a
 * ring against the element's own fill therefore scores a pair no reader ever sees, which is exactly how a
 * focus indicator can measure "fine" while being invisible on the page. So the element's `bg-*` utilities are
 * deliberately ignored here and the backdrop is stated by the caller.
 *
 * Variants are ignored on purpose: a focus ring only ever exists inside `focus:` / `focus-visible:` /
 * `focus-within:`, and which of those triggers it does not change the colour. What matters is that the class
 * list carries exactly ONE ring colour, so the measurement is unambiguous.
 *
 * A focus indicator is a non-text UI component boundary, so compare the result against the **3:1** floor of
 * SC 1.4.11 — not 4.5:1.
 *
 * @param className - The element's ACTUAL rendered class list (read it off the DOM, never re-spell it).
 * @param options - The opaque backdrop the ring is painted over. Defaults to white.
 * @returns The ratio, 1..21.
 * @throws Error when the class list carries no palette-coloured `ring-*` utility, or more than one — an
 *   ambiguous measurement is worse than none, and a MISSING ring is a defect in its own right (a control with
 *   `focus:outline-none` and no ring has no focus indicator at all), so it must fail loudly rather than
 *   silently measure the surface against itself.
 */
export function ringContrast(className: string, options: RingContrastOptions = {}): number {
    const { surface = palette.white } = options;
    const found = colorUtilities(className, 'ring');

    if (found.length !== 1) {
        throw new Error(
            `Expected exactly ONE palette-coloured \`ring-*\` utility in "${className}", found ${found.length}.`,
        );
    }

    return contrastRatio(compositeOver(colorOf(found[0] as ColorUtility), surface), surface);
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

    // ⛔ THE CONDITION IS "NEVER RENDERED", AND IT IS NOW TESTED DIRECTLY.
    //
    // This used to infer it from an EMPTY computed `color`, which jsdom 24 reported for a detached element.
    // jsdom 30 reports `rgb(0, 0, 0)` for detached and attached alike — measured — so the inference is dead
    // and the guard silently stopped guarding. `isConnected` asks the question the comment always described:
    // a test measuring an element it never put in the document proves nothing, whatever colour jsdom
    // invents for it.
    if (!element.isConnected) {
        throw new Error(
            'Expected the element to be in the document before measuring its computed `color`; ' +
                'measuring nothing proves nothing.',
        );
    }

    // Still checked, for a colour that is present but genuinely unreadable — left alone it reaches culori as
    // `undefined` and surfaces as an inscrutable "cannot read 'alpha'".
    if (parse(style.color) === undefined) {
        throw new Error('Expected the element to carry a computed `color`; measuring nothing proves nothing.');
    }

    const backdrop =
        style.backgroundColor === TRANSPARENT || parse(style.backgroundColor) === undefined
            ? surface
            : compositeOver(style.backgroundColor, surface);

    return contrastRatio(compositeOver(style.color, backdrop), backdrop);
}

/**
 * The custom property react-native-web routes `placeholderTextColor` through. Its `::placeholder` rule is
 * `color: var(--placeholderTextColor)`, and the value is set inline on the input — so the colour IS
 * observable, which is what makes placeholder contrast assertable rather than merely arguable.
 */
const PLACEHOLDER_COLOR_PROPERTY = '--placeholderTextColor';

/**
 * The WCAG contrast ratio of a NATIVE input's PLACEHOLDER text against the surface behind it.
 *
 * Placeholder text is text: a reader has to read it to know what the field wants. But `placeholderTextColor`
 * is a React Native prop, not a style, so a plain computed-`color` read sees the input's own text colour and
 * silently measures the wrong thing — passing while the placeholder is illegible. This reads the property
 * react-native-web actually paints the placeholder with.
 *
 * The web leg needs no equivalent: there the placeholder is a Tailwind variant, so
 * `utilityContrast(className, { variant: 'placeholder' })` already covers it.
 *
 * @sideEffect Reads computed style from the DOM.
 * @param element - The rendered `TextInput` element.
 * @param options - The opaque colour behind the input. Defaults to white.
 * @returns The ratio, 1..21.
 * @throws Error when the element paints no placeholder colour (the prop was never passed, so this test would
 *   be asserting the platform default rather than the design token it means to pin).
 */
export function placeholderContrast(element: Element, options: ComputedContrastOptions = {}): number {
    const { surface = palette.white } = options;
    const style = window.getComputedStyle(element);
    const color = style.getPropertyValue(PLACEHOLDER_COLOR_PROPERTY).trim();

    if (parse(color) === undefined) {
        throw new Error(
            `Expected the element to carry a \`${PLACEHOLDER_COLOR_PROPERTY}\`; without it there is no placeholder colour to measure.`,
        );
    }

    const backdrop =
        style.backgroundColor === TRANSPARENT || parse(style.backgroundColor) === undefined
            ? surface
            : compositeOver(style.backgroundColor, surface);

    return contrastRatio(compositeOver(color, backdrop), backdrop);
}

/** An 0..1 alpha as the two hex digits an `#RRGGBBAA` colour carries. Pure. */
function toHexAlpha(alpha: number): string {
    return Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0');
}
