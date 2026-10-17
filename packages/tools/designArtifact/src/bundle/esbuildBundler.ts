/**
 * @module bundle/esbuildBundler — the esbuild implementation of the {@link Bundler} port.
 *
 * Web and native differ in what they alias and how they resolve; everything else (React from the page, defines
 * baked at build time, an IIFE) is shared. The request-to-options mapping is a pure function so it can be tested
 * without running a build.
 *
 * @pattern Adapter — implements `Bundler` over esbuild.
 */
import { join } from 'node:path';

import { build } from 'esbuild';
import type { BuildOptions } from 'esbuild';

import { DesignArtifactError } from '../errors.js';
import { shimAliases } from '../shims/shimAliases.js';

import type { BundleRequest, BundleResult, Bundler } from './bundler.js';
import { describeFailure } from './describeFailure.js';
import { nativeFirstPlugin } from './nativeFirstPlugin.js';
import { runtimeGlobalsPlugin } from './runtimeGlobalsPlugin.js';
import { bundleInputs } from './sourceRoots.js';

/** The name esbuild reports the generated entry under; it is not a file on disk, so it is not a source root. */
const ENTRY_SOURCEFILE = 'surfaceEntry.ts';

/** Where each platform's aliases come from. */
export type AliasSource = (platform: 'web' | 'native') => Readonly<Record<string, string>>;

/**
 * Resolution order of the native build. `.web.*` comes first because react-native-web libraries ship browser
 * variants under that suffix, and the native build runs on react-native-web.
 */
const NATIVE_EXTENSIONS = ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.jsx', '.mjs'];

/**
 * The esbuild options for one request.
 *
 * `process.env.*` and `__DEV__` are replaced at build time instead of defining `window.process` at run time, so
 * no code path can observe a fake `process`. `global` and `EXPO_OS` are defined on native only: React Native
 * packages assume `global`, browsers do not have it, and a web build must not claim to be an iOS app.
 *
 * @param request - The bundle to build.
 * @param aliasesFor - Module specifier aliases for the request's platform.
 * @returns Options for `esbuild.build`.
 */
export function esbuildOptionsFor(request: BundleRequest, aliasesFor: AliasSource): BuildOptions {
    const native = request.platform === 'native';

    return {
        stdin: {
            contents: request.entrySource,
            resolveDir: request.resolveDir,
            loader: 'ts',
            sourcefile: ENTRY_SOURCEFILE,
        },
        bundle: true,
        format: 'iife',
        globalName: request.globalName,
        platform: 'browser',
        target: 'es2020',
        write: false,
        metafile: true,
        jsx: 'automatic',
        logLevel: 'silent',
        absWorkingDir: request.resolveDir,
        alias: { ...aliasesFor(request.platform) },
        define: {
            'process.env.NODE_ENV': '"production"',
            __DEV__: 'false',
            ...(native ? { global: 'window', 'process.env.EXPO_OS': '"ios"' } : {}),
        },
        loader: { '.svg': 'text', '.png': 'dataurl', '.ttf': 'dataurl', '.js': 'jsx' },
        plugins: native ? [runtimeGlobalsPlugin(), nativeFirstPlugin()] : [runtimeGlobalsPlugin()],
        ...(native
            ? { resolveExtensions: NATIVE_EXTENSIONS }
            : { tsconfig: join(request.resolveDir, 'tsconfig.json') }),
    };
}

/** Bundles with esbuild. */
export class EsbuildBundler implements Bundler {
    /** @param aliasesFor - Module aliases per platform; the real shims unless a test injects its own. */
    constructor(private readonly aliasesFor: AliasSource = shimAliases) {}

    /**
     * @inheritdoc
     * @sideEffect Reads the source tree through esbuild.
     */
    async bundle(request: BundleRequest): Promise<BundleResult> {
        try {
            const result = await build(esbuildOptionsFor(request, this.aliasesFor));
            const output = result.outputFiles?.[0];

            if (output === undefined || result.metafile === undefined) {
                throw new Error('esbuild produced no output file or metafile.');
            }

            return {
                script: output.text,
                inputs: bundleInputs(
                    Object.keys(result.metafile.inputs).filter((key) => key !== ENTRY_SOURCEFILE),
                    request.resolveDir,
                ),
            };
        } catch (error) {
            throw new DesignArtifactError(
                'bundle-failed',
                `The ${request.platform} bundle failed:\n${describeFailure(error)}`,
            );
        }
    }
}
