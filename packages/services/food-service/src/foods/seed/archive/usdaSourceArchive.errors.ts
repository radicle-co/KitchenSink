/**
 * The refusals the pinned-archive boundary can raise (plan U1, R2).
 *
 * Each one means the committed source bytes are not the ones the seed was reviewed against, so nothing
 * downstream may read them.
 */

/** Thrown when `sourcePins.json` is not the pins shape. */
export class SourcePinsFormatError extends Error {
    /**
     * @param detail - What is wrong with the pins file.
     */
    public constructor(detail: string) {
        super(`sourcePins.json is not usable: ${detail}`);
        this.name = 'SourcePinsFormatError';
        Object.setPrototypeOf(this, SourcePinsFormatError.prototype);
    }
}

/**
 * Type guard for {@link SourcePinsFormatError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is a pins format error.
 */
export function isSourcePinsFormatError(error: unknown): error is SourcePinsFormatError {
    return error instanceof SourcePinsFormatError;
}

/** Thrown when pinned bytes are not a zip, or a zip whose entries cannot be addressed by basename. */
export class ArchiveLayoutError extends Error {
    /**
     * @param detail - What is wrong with the archive.
     */
    public constructor(detail: string) {
        super(`USDA archive is not usable: ${detail}`);
        this.name = 'ArchiveLayoutError';
        Object.setPrototypeOf(this, ArchiveLayoutError.prototype);
    }
}

/**
 * Type guard for {@link ArchiveLayoutError}.
 *
 * @param error - The thrown value.
 * @returns `true` when the value is an archive layout error.
 */
export function isArchiveLayoutError(error: unknown): error is ArchiveLayoutError {
    return error instanceof ArchiveLayoutError;
}
