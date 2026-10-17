/**
 * @module errors — the one error this package raises. Every failure of the build is a {@link DesignArtifactError}
 * whose `code` says which rule the source broke, so the build fails closed with a reason instead of emitting a
 * partial artifact.
 */

/** What went wrong. Each code names the rule the input broke. */
export type DesignArtifactErrorCode =
    | 'duplicate-name'
    | 'missing-card'
    | 'invalid-card'
    | 'unknown-component'
    | 'unknown-colour'
    | 'unsafe-header'
    | 'bundle-failed'
    | 'missing-font'
    | 'missing-source'
    | 'unsafe-path'
    | 'write-failed'
    | 'integrity-mismatch'
    | 'surface-mismatch'
    | 'invalid-reference';

/** A build input broke a rule the artifact depends on. */
export class DesignArtifactError extends Error {
    readonly code: DesignArtifactErrorCode;

    constructor(code: DesignArtifactErrorCode, message: string) {
        super(message);
        this.name = 'DesignArtifactError';
        this.code = code;
        Object.setPrototypeOf(this, DesignArtifactError.prototype);
    }
}

/**
 * Whether a value is a {@link DesignArtifactError}.
 *
 * @param value - Anything caught.
 * @returns Whether it is this package's error.
 */
export function isDesignArtifactError(value: unknown): value is DesignArtifactError {
    return value instanceof DesignArtifactError;
}
