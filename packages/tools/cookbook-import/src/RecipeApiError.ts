/**
 * The recipe API's error type and its type guard.
 *
 * Split out of `RecipeApiClient.ts` so each file does ONE thing (CODING_STANDARDS §1). It is a separate
 * SUBJECT from the transport: a caller catches and narrows this without importing the client, and the
 * guard travels with the class it narrows rather than sitting beside unrelated retry policy.
 */
/** An HTTP failure carrying the service's own error envelope, so a caller can branch on the code. */
export class RecipeApiError extends Error {
    /** The HTTP status. */
    public readonly status: number;
    /** The service's machine-readable `code`, when the body carried one. */
    public readonly code: string | undefined;
    /** The raw response body, for a report the reader can act on. */
    public readonly body: string;

    public constructor(status: number, code: string | undefined, body: string, message: string) {
        super(message);
        this.name = 'RecipeApiError';
        this.status = status;
        this.code = code;
        this.body = body;
        Object.setPrototypeOf(this, RecipeApiError.prototype);
    }
}

/** Type guard for {@link RecipeApiError}. */
export function isRecipeApiError(error: unknown): error is RecipeApiError {
    return error instanceof RecipeApiError;
}
