/**
 * @module sources/sourceFiles — the port the build reads authored files through.
 *
 * @pattern Port (Ports and Adapters) — `fsSourceFiles` reads the disk; `memorySourceFiles` serves a test.
 */

/** Reads the files the build is made from. */
export interface SourceFiles {
    /** @throws DesignArtifactError `missing-source` when the file does not exist. */
    text(path: string): Promise<string>;
    /** @throws DesignArtifactError `missing-source` when the file does not exist. */
    bytes(path: string): Promise<Uint8Array>;
    /**
     * The names inside a directory, sorted.
     *
     * @throws DesignArtifactError `missing-source` when the directory does not exist. A missing directory is a broken
     * checkout, and answering with an empty list would let the build ship an artifact with no cards.
     */
    list(directory: string): Promise<readonly string[]>;
    /** Whether a file or directory exists. */
    exists(path: string): Promise<boolean>;
}
