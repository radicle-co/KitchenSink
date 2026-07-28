/**
 * @module test-utils/tailwindContrast — measure the WCAG contrast of a leaf's ACTUAL rendered Tailwind classes.
 *
 * jsdom loads no stylesheet, so a web component test cannot read a Tailwind utility back out as a computed
 * colour the way the native suites read react-native-web's compiled atomic CSS. The tempting workaround —
 * asserting `expect(className).toContain('text-slate')` — proves a spelling, not a ratio: it passes just as
 * happily if the palette re-themes slate to near-white.
 *
 * So this resolves the pair the reader actually experiences, FROM the className the component really rendered:
 * the `text-*` utility and the `bg-*` utility are looked up in the shared {@link palette}, the background's
 * `/NN` alpha suffix is composited onto the surface the chip sits on, and the result is measured with the
 * WCAG helpers in `@commise/test-utils`. Both halves are then load-bearing — change the class and the lookup
 * moves, re-theme the token and the ratio moves.
 *
 * `variant` exists because a HOVER state is a state like any other: a chip whose resting pair passes and whose
 * `hover:bg-…` tint pushes it back under the floor is still an inaccessible chip, and that is exactly the
 * defect this module first caught.
 *
 * It lives under `src/__tests__/` for the same two reasons `cssColor.ts` does: `tsconfig`'s `rootDir` is
 * `src`, and `tsconfig.build.json` excludes every `__tests__` directory, so test-only code stays out of the
 * built package.
 */
import { compositeOver, contrastRatio } from '@commise/test-utils';
import { palette } from '@commise/ui';

/**
 * A `text-…` / `bg-…` utility with an optional leading variant and an optional `/NN` opacity suffix —
 * `bg-coral/10`, `text-slate`, `hover:bg-coral/25`.
 */
const COLOR_UTILITY = /^(?:([a-z-]+):)?(text|bg)-([a-z-]+?)(?:\/(\d{1,3}))?$/;

/** How to read a class list: which surface the element is painted over, and which variant state to measure. */
export interface UtilityContrastOptions {
    /** The opaque colour BEHIND the element's own translucent background. Defaults to white. */
    readonly surface?: string;
    /** A Tailwind variant to prefer, e.g. `'hover'`. Utilities without it are the fallback. */
    readonly variant?: string;
}

/**
 * Find the single `text-*` or `bg-*` utility in `className` that names a PALETTE colour, preferring the one
 * carrying `variant` when a variant is requested.
 *
 * Type utilities that share the prefix (`text-body-sm`, `text-caption`) resolve to no palette entry and are
 * skipped, which is what lets one regex serve both roles. Pure.
 *
 * @throws Error when the class list carries no such utility, or more than one at the same variant level (an
 *   ambiguous measurement is worse than none — it would silently measure whichever came first).
 */
function resolve(className: string, prefix: 'text' | 'bg', variant: string | undefined): string {
    const candidates = className
        .split(/\s+/)
        .map((token) => COLOR_UTILITY.exec(token))
        .filter((match): match is RegExpExecArray => match !== null && match[2] === prefix)
        .map((match) => ({ variant: match[1], name: match[3] as string, alphaPercent: match[4] }))
        .filter(({ name }) => name in palette);

    // A requested variant WINS where it exists; otherwise the state inherits the base utility.
    const scoped = candidates.filter((candidate) => candidate.variant === variant);
    const found = scoped.length > 0 ? scoped : candidates.filter((candidate) => candidate.variant === undefined);

    if (found.length !== 1) {
        throw new Error(
            `Expected exactly ONE palette-coloured \`${prefix}-*\` utility in "${className}", found ${found.length}.`,
        );
    }

    const { name, alphaPercent } = found[0] as { name: string; alphaPercent: string | undefined };
    const color = palette[name as keyof typeof palette];

    return alphaPercent === undefined ? color : `${color}${toHexAlpha(Number.parseInt(alphaPercent, 10) / 100)}`;
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
        compositeOver(resolve(className, 'text', variant), surface),
        compositeOver(resolve(className, 'bg', variant), surface),
    );
}

/** An 0..1 alpha as the two hex digits an `#RRGGBBAA` colour carries. Pure. */
function toHexAlpha(alpha: number): string {
    return Math.round(alpha * 255)
        .toString(16)
        .padStart(2, '0');
}
