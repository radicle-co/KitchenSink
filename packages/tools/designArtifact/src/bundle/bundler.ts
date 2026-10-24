/**
 * @module bundle/bundler — the port the bundle step depends on. The only implementation that touches esbuild is
 * `esbuildBundler`; `bundleComponents` and its tests see only this interface.
 *
 * @pattern Port (Hexagonal) — the artifact pipeline names what it needs from a bundler and not how it is done.
 */

/** One platform's bundle. */
export interface BundleRequest {
    /** TypeScript source of the generated entry module (see `entryModule`). */
    readonly entrySource: string;
    /** The global the resulting IIFE assigns its exports to, e.g. `__CommiseWeb`. */
    readonly globalName: string;
    readonly platform: 'web' | 'native';
    /** Directory the entry's imports resolve from; also the build's working directory. */
    readonly resolveDir: string;
}

/** One platform's bundle and what went into it. */
export interface BundleResult {
    /** The IIFE source: `var <globalName> = (() => { … })();`. */
    readonly script: string;
    /**
     * Absolute paths of the product source files the bundle read (dependencies, virtual modules and non-text
     * assets excluded). The stylesheet's `@source` roots are derived from these.
     */
    readonly inputs: readonly string[];
}

/** Turns a generated entry module into one self-contained classic script. */
export interface Bundler {
    /**
     * @param request - What to bundle.
     * @returns The IIFE source and the files it was built from.
     * @throws DesignArtifactError `bundle-failed` when resolution or compilation fails.
     */
    bundle(request: BundleRequest): Promise<BundleResult>;
}
