/**
 * The error taxonomy for content-source resolution.
 *
 * One error, deliberately: the ONLY unrecoverable content state is a `required` source with no
 * Markdown behind it. Every `generated` absence is a legitimate state the site renders, not an error.
 */

/**
 * Raised when a `required` content source has no Markdown on disk.
 *
 * This is thrown rather than warned because the failure it names is exactly the one this whole site
 * exists to prevent: documentation that silently claims to cover something it no longer reaches.
 */
export class MissingContentSourceError extends Error {
    public readonly sourceId: string;
    public readonly contentPath: string;

    public constructor(sourceId: string, contentPath: string) {
        super(
            `Required documentation source "${sourceId}" has no Markdown at "${contentPath}". ` +
                'The path was renamed, moved or emptied — repoint it in contentRegistry.ts rather than ' +
                'letting the site ship a section that reaches nothing.',
        );
        this.name = 'MissingContentSourceError';
        this.sourceId = sourceId;
        this.contentPath = contentPath;
        Object.setPrototypeOf(this, MissingContentSourceError.prototype);
    }
}

/** Type guard for {@link MissingContentSourceError}. */
export function isMissingContentSourceError(error: unknown): error is MissingContentSourceError {
    return error instanceof MissingContentSourceError;
}
