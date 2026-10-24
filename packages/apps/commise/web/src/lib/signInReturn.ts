/**
 * @module lib/signInReturn — where a signed-out visitor is sent back to after signing in (W-01; `buildSpec.md` §8: "a
 * signed-out deep link returns to its destination after sign-in").
 *
 * A protected page sends its own path out as `?redirect_url=` on the sign-in URL ({@link signInPathFor}); the sign-in
 * and sign-up pages read it back through {@link safeReturnPath} and hand the result to Clerk as `forceRedirectUrl`.
 * Clerk's `forceRedirectUrl` is the app's only guard against an open redirect, so what reaches it must be a PARSED
 * value, not a checked string: {@link safeReturnPath} accepts one shape — an app-relative path in this locale — and
 * answers `undefined` for everything else, and {@link signInPathFor} runs the same parse on the way out so the two
 * ends cannot disagree about what is acceptable.
 *
 * Why not `auth().redirectToSignIn({ returnBackUrl })`: it builds the sign-in URL from `NEXT_PUBLIC_CLERK_SIGN_IN_URL`,
 * which is one locale-less string, and takes `returnBackUrl` as-is, so it neither routes to `/{locale}/sign-in` nor
 * validates the value — and a validated, locale-aware, basePath-aware return path is the whole of the requirement.
 *
 * The result is BARE (no preview basePath): `forceRedirectUrl` runs through Next's router, which prepends the basePath
 * itself, and a pre-prefixed value double-prefixes (see `SignInForm`). The basePath is therefore STRIPPED from an input
 * that carries it — the `401` handler sends `window.location.pathname`, which does (`unauthorizedRedirect`).
 *
 * Pure.
 */
import { BASE_PATH } from './basePath';

/** The longest return path honoured. Far above any real route, below anything that could be a payload. */
const MAX_RETURN_PATH_LENGTH = 2048;

/** Code points up to and including this one are refused: the C0 controls and the space (U+0020). */
const LAST_REFUSED_LOW_CODE_POINT = 0x20;

/** DEL (U+007F), the one control character above the printable range. */
const DEL = 0x7f;

/**
 * @param value - A candidate path.
 * @returns Whether it holds a control character (NUL, tab and newline among them — URL parsers DELETE those, so
 *     `/\t/evil.com` becomes `//evil.com`), a space, DEL or a backslash (which a browser reads as `/`). Pure.
 */
function hasUnsafeCharacter(value: string): boolean {
    for (const character of value) {
        const code = character.codePointAt(0) ?? 0;

        if (code <= LAST_REFUSED_LOW_CODE_POINT || code === DEL || character === '\\') {
            return true;
        }
    }

    return false;
}

/** What a locale segment may be made of. */
const LOCALE_PATTERN = /^[A-Za-z0-9-]+$/;

/** The auth pages: returning to one would leave a signed-in visitor on a form that cannot render for them. */
const AUTH_SEGMENTS: ReadonlySet<string> = new Set(['sign-in', 'sign-up']);

/** The characters that end a path and may follow the locale segment. */
const PATH_END = new Set(['/', '?', '#']);

/**
 * @param raw - A path that may carry the preview basePath.
 * @param basePath - The preview basePath (`''` when there is none).
 * @returns The path without the basePath, or `undefined` when a basePath is set and `raw` is exactly it.
 */
function withoutBasePath(raw: string, basePath: string): string | undefined {
    if (basePath === '') {
        return raw;
    }

    if (raw === basePath) {
        return undefined;
    }

    return raw.startsWith(`${basePath}/`) ? raw.slice(basePath.length) : raw;
}

/**
 * Parse a `redirect_url` into the app path it may send the visitor to.
 *
 * Accepted: `/{locale}` or `/{locale}/…` (with an optional query or fragment), with the preview basePath stripped if
 * present. Refused: anything else — another origin, a protocol-relative or backslash form, a dot segment (which a
 * browser normalises into something else), a control character, another locale, the auth pages, an over-long value, a
 * repeated parameter.
 *
 * @param raw - The `redirect_url` search parameter as Next hands it over.
 * @param locale - The locale the sign-in page is rendered in.
 * @param basePath - The preview basePath to strip; defaults to the build's.
 * @returns The bare, validated path, or `undefined`.
 */
export function safeReturnPath(
    raw: string | readonly string[] | undefined,
    locale: string,
    basePath: string = BASE_PATH,
): string | undefined {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RETURN_PATH_LENGTH) {
        return undefined;
    }

    if (hasUnsafeCharacter(raw) || !LOCALE_PATTERN.test(locale)) {
        return undefined;
    }

    const path = withoutBasePath(raw, basePath);
    const root = `/${locale}`;

    if (path === undefined || !path.startsWith(root)) {
        return undefined;
    }

    const next = path.charAt(root.length);

    if (next !== '' && !PATH_END.has(next)) {
        return undefined;
    }

    const pathname = path.split(/[?#]/, 1)[0] ?? '';
    const segments = pathname.split('/').slice(1);

    if (pathname.includes('//')) {
        return undefined;
    }

    for (const segment of segments) {
        const decoded = segment.replace(/%2e/gi, '.');

        if (decoded === '.' || decoded === '..') {
            return undefined;
        }
    }

    if (AUTH_SEGMENTS.has(segments[1] ?? '')) {
        return undefined;
    }

    return path;
}

/**
 * @param page - The auth page to build the URL of.
 * @param locale - The locale of the page being protected.
 * @param returnPath - The destination to carry, if any; dropped when {@link safeReturnPath} refuses it.
 * @param basePath - The preview basePath to strip.
 * @returns A bare app path to the auth page, with the destination as one percent-encoded `redirect_url` value.
 */
function authPathFor(
    page: 'sign-in' | 'sign-up',
    locale: string,
    returnPath: string | undefined,
    basePath: string,
): string {
    const authPage = `/${locale}/${page}`;
    const target = safeReturnPath(returnPath, locale, basePath);

    return target === undefined ? authPage : `${authPage}?redirect_url=${encodeURIComponent(target)}`;
}

/**
 * The sign-in page to send a signed-out visitor to, carrying where they were going.
 *
 * @param locale - The locale of the page being protected.
 * @param returnPath - The path to come back to (`/{locale}/…`, with or without the preview basePath). One that
 *     {@link safeReturnPath} would refuse is dropped, leaving the bare sign-in page.
 * @param basePath - The preview basePath to strip; defaults to the build's.
 * @returns A bare app path (Next's `redirect` prepends the basePath), e.g. `/en/sign-in?redirect_url=%2Fen%2Fcollections`.
 */
export function signInPathFor(locale: string, returnPath: string | undefined, basePath: string = BASE_PATH): string {
    return authPathFor('sign-in', locale, returnPath, basePath);
}

/**
 * The sign-up page, carrying the same destination: the sign-in form's "Create an account" link is the only way to
 * register, so it must not lose where the visitor was going.
 *
 * @param locale - The locale of the page being protected.
 * @param returnPath - The destination, as for {@link signInPathFor}.
 * @param basePath - The preview basePath to strip; defaults to the build's.
 * @returns A bare app path, e.g. `/en/sign-up?redirect_url=%2Fen%2Fcollections`.
 */
export function signUpPathFor(locale: string, returnPath: string | undefined, basePath: string = BASE_PATH): string {
    return authPathFor('sign-up', locale, returnPath, basePath);
}
