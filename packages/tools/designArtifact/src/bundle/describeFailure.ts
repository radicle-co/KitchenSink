/**
 * @module bundle/describeFailure — one readable message for whatever a failed esbuild run threw. Shared by the
 * component bundler and the card compiler so both name the file and line of a build error the same way.
 */

interface EsbuildMessage {
    readonly text?: string;
    readonly location?: { readonly file?: string; readonly line?: number } | null;
}

/**
 * @param error - What `esbuild.build` rejected with: a `BuildFailure` (with `errors`), an `Error`, or anything.
 * @returns One line per esbuild message (`text (file:line)`), or the error's own message.
 */
export function describeFailure(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'errors' in error && Array.isArray(error.errors)) {
        return error.errors
            .map((message: EsbuildMessage) => {
                const where = message.location
                    ? ` (${message.location.file ?? '?'}:${String(message.location.line ?? 0)})`
                    : '';

                return `${message.text ?? 'unknown error'}${where}`;
            })
            .join('\n');
    }

    return error instanceof Error ? error.message : String(error);
}
