/**
 * @module lib/staticAssetPath — which request paths the middleware matcher skips because they name a static file.
 *
 * `middleware.ts`'s `config.matcher` excludes any path with `[^?]*\.(?:html?|css|…)` in it (Clerk's documented clause:
 * Next serves `public/` at the root, so a prefix cannot name those files). `clerkMiddleware` therefore never runs for
 * such a path, and a page that is nonetheless matched by a dynamic segment (`/en/collections/cover.png` is
 * `collections/[id]`) reaches `auth()` with no middleware context, which throws — a 500 where a 404 is the answer.
 *
 * The matcher is a literal Next reads statically, so it cannot import this list. `tests/lib/staticAssetPath.test.ts`
 * is what holds the two equal: it extracts the alternation from the matcher and runs both over a table of paths.
 *
 * Pure; no Next or Clerk import, so it is as safe in a test as in a page.
 */

/**
 * The matcher's extension alternation, one regex source per entry and in the matcher's order. `js(?!on)` keeps
 * `.json` out: a JSON route is an app path.
 */
export const STATIC_ASSET_EXTENSIONS: readonly string[] = [
    'html?',
    'css',
    'js(?!on)',
    'jpe?g',
    'webp',
    'png',
    'gif',
    'svg',
    'ttf',
    'woff2?',
    'ico',
    'csv',
    'docx?',
    'xlsx?',
    'zip',
    'webmanifest',
];

/** The matcher's clause, unanchored on purpose: it matches `.png/more` and `.pngx` as well, so this does too. */
const STATIC_ASSET_PATTERN = new RegExp(`\\.(?:${STATIC_ASSET_EXTENSIONS.join('|')})`, 'u');

/**
 * @param pathOrUrl - A request path, optionally with a query string or fragment.
 * @returns Whether the middleware matcher skips it as a static file. Only the path counts: a file name in the query
 *     string is not a file request. Pure.
 */
export function isStaticAssetPath(pathOrUrl: string): boolean {
    const [path = ''] = pathOrUrl.split(/[?#]/u);

    return STATIC_ASSET_PATTERN.test(path);
}
