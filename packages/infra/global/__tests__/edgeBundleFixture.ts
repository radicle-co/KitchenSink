/**
 * A stand-in for the esbuild-produced Lambda@Edge bundle, for suites that synthesize `EdgeStack`.
 *
 * `EdgeStack` REFUSES to synthesize without a real bundle — there is no placeholder, because both failure
 * directions at the edge are unacceptable (a throwing stub is a total outage of the fronted services; a
 * pass-through stub leaves the cache-partition header unset, which is ADR-0020's P0 data leak). That
 * deliberate hard failure has to be given something to find in a unit test, so the bundle directory is an
 * explicit, documented prop and this module supplies the fixture.
 *
 * The fixture's `handler.js` embeds the verification key the same way `esbuild.mjs`'s `define` does — as a
 * JS string literal with newlines escaped — because `EdgeStack` checks that the bundle it is about to ship
 * really was built with the key synth was handed. A fixture that skipped that would leave the check
 * unexercised in the only place it can be exercised without running a deploy.
 *
 * Memoized per key so repeated synths in one file stage byte-identical assets (CDK hashes asset CONTENT,
 * not path, so this is belt-and-braces for the template-parity comparison rather than a correctness need).
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** A syntactically-valid, obviously-fake PEM. Never a real key: this file is committed to a public repo. */
export const TEST_EDGE_JWT_KEY =
    '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAfixture\n-----END PUBLIC KEY-----';

const cache = new Map<string, string>();

/**
 * Create (once per key) a directory shaped like the real edge bundle.
 *
 * @param jwtKey - The key the bundle should look as though it was built with.
 * @returns The absolute path to pass as `verifierBundleDir`.
 * @sideEffect Creates a temporary directory and writes a file into it.
 */
export function stubEdgeBundleDir(jwtKey: string = TEST_EDGE_JWT_KEY): string {
    const memoized = cache.get(jwtKey);

    if (memoized !== undefined) {
        return memoized;
    }

    const directory = mkdtempSync(path.join(tmpdir(), 'kitchensink-edge-bundle-'));

    writeFileSync(
        path.join(directory, 'handler.js'),
        `exports.handler = async (event) => { const key = ${JSON.stringify(jwtKey)}; return event; };\n`,
        'utf8',
    );
    cache.set(jwtKey, directory);

    return directory;
}
