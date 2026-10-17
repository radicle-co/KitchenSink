import { dirname, isAbsolute, posix, relative, resolve } from 'node:path';

/** What {@link resolveRepositoryLink} needs to answer; `fileExists` is the only I/O and it is injected. */
export interface RepositoryLinkContext {
    /** Absolute path of the repository root. */
    readonly repoRoot: string;
    /** Absolute path of the Docusaurus site directory; `sourceFilePath` is relative to it. */
    readonly siteDir: string;
    /** Repository browse root, e.g. `https://github.com/owner/name` (no trailing slash). */
    readonly repositoryUrl: string;
    /** Git ref the produced links point at. */
    readonly ref: string;
    /** @sideEffect Reads the filesystem. */
    readonly fileExists: (absolutePath: string) => boolean;
}

/** The subset of Docusaurus's `onBrokenMarkdownLinks` payload this policy reads. */
export interface BrokenMarkdownLink {
    /** Source file of the link, relative to the site directory. */
    readonly sourceFilePath: string;
    /** The unresolved link target, possibly carrying `?query` and `#hash`. */
    readonly url: string;
}

/** A link that names another route, a website, or nothing at all — never a repository file. */
function isNotARelativeFileReference(url: string): boolean {
    return url === '' || url.startsWith('#') || url.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(url);
}

/**
 * Decides what a Markdown link that Docusaurus could not resolve should become.
 *
 * Docusaurus calls a link "broken" when its target is not a document in the same plugin instance.
 * For this site that lumps two very different things together: a link into `specs/`, `.specify/` or
 * `packages/` — a real file the site deliberately does not publish — and a link to nothing, which is
 * a defect. Separating them is the whole job here.
 *
 * A link naming a file that EXISTS inside the repository becomes a link to that file in the
 * repository. Everything else is left alone, so Docusaurus reports it under whatever severity the
 * site configures — which is how a genuine typo still fails the build.
 *
 * ⚠️ Existence is asked of the WORKING TREE, not of the ref the produced URL names. A file that
 * exists locally but not yet on `main` yields a link that resolves once the branch merges. Fixing
 * that would mean querying the forge at build time, which trades a self-healing link for a network
 * dependency in every build.
 *
 * @returns The replacement URL, or `undefined` to leave Docusaurus's own reporting in charge.
 */
export function resolveRepositoryLink(link: BrokenMarkdownLink, context: RepositoryLinkContext): string | undefined {
    if (isNotARelativeFileReference(link.url)) {
        return undefined;
    }

    const [pathAndQuery = '', ...hashParts] = link.url.split('#');
    const [filePath = ''] = pathAndQuery.split('?');

    if (filePath === '') {
        return undefined;
    }

    const sourceAbsolute = resolve(context.siteDir, link.sourceFilePath);
    const targetAbsolute = resolve(dirname(sourceAbsolute), decodeURIComponent(filePath));
    const repoRelative = relative(context.repoRoot, targetAbsolute);

    // `..` or an absolute result means the link points outside the repository altogether — a broken
    // relative path, not an unpublished repository file.
    if (repoRelative.startsWith('..') || isAbsolute(repoRelative) || repoRelative === '') {
        return undefined;
    }

    if (!context.fileExists(targetAbsolute)) {
        return undefined;
    }

    const hash = hashParts.length > 0 ? `#${hashParts.join('#')}` : '';

    // POSIX join: a URL path is always `/`-separated, whatever the build host uses.
    return `${context.repositoryUrl}/blob/${context.ref}/${repoRelative.split('\\').join(posix.sep)}${hash}`;
}
