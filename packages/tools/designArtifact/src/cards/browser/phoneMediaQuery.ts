/**
 * @module cards/browser/phoneMediaQuery — answers a CSS media query as the 390 x 844 phone would. Pure: the
 * browser's own answer for a term that is not about the viewport is a parameter, so a test needs no window.
 */
import { PHONE_VIEWPORT } from './phoneSize.js';

/** `(min-width: 390px)`, `(max-height: 40em)`, `(orientation: portrait)`; the value part is optional. */
const FEATURE = /^\(\s*(min-|max-)?(width|height|orientation)\s*(?::\s*([^)]*?))?\s*\)$/u;
const LENGTH = /^([\d.]+)(px|em|rem)$/u;
const PIXELS_PER_EM = 16;

/**
 * One media feature against the phone.
 *
 * @returns `true`/`false`, or `null` when the feature is not one the phone can answer (another feature name, a
 * unit other than px/em/rem), which sends the whole term to the browser.
 */
function phoneFeature(feature: string): boolean | null {
    const parts = FEATURE.exec(feature);

    if (parts === null) {
        return null;
    }

    const prefix = parts.at(1);
    const name = parts.at(2);
    const value = (parts.at(3) ?? '').trim();

    if (name === 'orientation') {
        return value === 'portrait';
    }

    const length = LENGTH.exec(value);

    if (length === null) {
        return null;
    }

    const pixels = parseFloat(length.at(1) ?? '') * (length.at(2) === 'px' ? 1 : PIXELS_PER_EM);
    const actual = name === 'width' ? PHONE_VIEWPORT.width : PHONE_VIEWPORT.height;

    if (prefix === 'min-') {
        return actual >= pixels;
    }

    return prefix === 'max-' ? actual <= pixels : actual === pixels;
}

/** One comma-separated term: `(min-width: 1px) and (max-width: 9px)`. Pure viewport terms are answered here. */
function phoneTerm(term: string, askBrowser: (term: string) => boolean): boolean {
    const answers = term
        .trim()
        .split(/\s+and\s+/u)
        .map(phoneFeature);

    if (answers.every((answer): answer is boolean => answer !== null)) {
        return answers.every((answer) => answer);
    }

    return askBrowser(term);
}

/**
 * Whether a media query list matches on the phone: any comma-separated term that matches is enough.
 *
 * @param query - A media query list.
 * @param askBrowser - The answer for a term that is not purely about the viewport (`prefers-reduced-motion`, `hover`).
 * @returns Whether the list matches.
 */
export function phoneMatches(query: string, askBrowser: (term: string) => boolean): boolean {
    return query.split(',').some((term) => phoneTerm(term, askBrowser));
}
