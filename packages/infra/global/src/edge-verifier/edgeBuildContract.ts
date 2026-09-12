/**
 * The one name shared between the edge handler's source and the bundler that compiles the key into it.
 *
 * `esbuild.mjs` substitutes this identifier with the Clerk instance's PEM public key via `define`, and
 * `handler.ts` `declare`s it. Neither can import the other — one is a build script in `.mjs`, the other is
 * bundled source — so the name is the contract between them, and a typo on either side is not a build error:
 * an un-substituted identifier is a `ReferenceError` at the edge, on every request, in production only.
 * `edgeVerifier.test.ts` reads `esbuild.mjs` and asserts it defines exactly this.
 *
 * It lives in its own module because it is the only thing in `handler.ts` that anything else may import:
 * importing `handler.ts` itself EVALUATES the declared global, which is the very thing that does not exist
 * outside a bundle.
 *
 * @module
 */

/** The build-time constant esbuild replaces with the Clerk instance's PEM public JWT key. */
export const EDGE_JWT_KEY_GLOBAL = '__CLERK_EDGE_JWT_KEY__';
