/**
 * @module css/cssCompiler — the port the CSS pipeline compiles through.
 *
 * @pattern Port (Ports and Adapters) — `compileCss` depends on this interface; `tailwindCssCompiler` is the real
 *   adapter and a test supplies a fake.
 */

/** What a compiler is given: a stylesheet and the path it is resolved from. */
export interface CssCompileInput {
    /** The stylesheet source. */
    readonly css: string;
    /** The file the source stands in for: `@import` and `@source` resolve from its directory. */
    readonly from: string;
}

/** Turns an authored stylesheet into the utility CSS the components need. */
export interface CssCompiler {
    /**
     * Compile a stylesheet.
     *
     * @param input - The source and where it resolves from.
     * @returns The compiled stylesheet text.
     */
    compile(input: CssCompileInput): Promise<string>;
}
