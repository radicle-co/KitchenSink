/**
 * @module @kitchensink/docgen-components/errors — the generator's one custom error.
 *
 * A generator that cannot read a package's `tsconfig.json` must FAIL, never emit a degraded catalogue: with
 * no compiler options every prop resolves to `any`, and the output would look complete while saying nothing.
 * That failure is a distinct condition from an I/O error, so it carries its own type and type guard.
 */

/** Raised when the generator cannot proceed against a source package. */
export class DocgenError extends Error {
    public constructor(message: string) {
        super(message);
        this.name = 'DocgenError';
        Object.setPrototypeOf(this, DocgenError.prototype);
    }
}

/**
 * Type guard for {@link DocgenError}.
 *
 * @param error - Any thrown value.
 * @returns Whether it is a {@link DocgenError}.
 */
export function isDocgenError(error: unknown): error is DocgenError {
    return error instanceof DocgenError;
}
