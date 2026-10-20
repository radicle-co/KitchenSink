/**
 * @module reactRuntime — the React 18 UMD files the artifact host loads from jsDelivr, fetched once and verified.
 *
 * The bundle expects `window.React` and `window.ReactDOM` from the host. The host loads the builds named below with a
 * pinned SRI hash; this module fetches the same files and refuses any whose bytes do not match that hash, so the
 * browser tests run against exactly what the host runs against. The files are cached under
 * `node_modules/.cache/designArtifact/` and re-verified on every read, so a damaged cache is a failure and not a
 * different React.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { PACKAGE_ROOT } from '../../src/config.js';
import { DesignArtifactError } from '../../src/errors.js';

/** One pinned file. */
interface PinnedScript {
    readonly name: string;
    readonly url: string;
    /** The Subresource Integrity value, `sha384-<base64>`. */
    readonly integrity: string;
}

/** The two builds, with the hashes the host pins. */
export const REACT_RUNTIME: readonly PinnedScript[] = [
    {
        name: 'react.production.min.js',
        url: 'https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js',
        integrity: 'sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z',
    },
    {
        name: 'react-dom.production.min.js',
        url: 'https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js',
        integrity: 'sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1',
    },
];

/** Where the verified files are kept. */
export const REACT_CACHE_DIR = join(PACKAGE_ROOT, 'node_modules/.cache/designArtifact');

/**
 * The SRI value of some bytes.
 *
 * @param bytes - File content.
 * @returns `sha384-<base64>`.
 */
export function integrityOf(bytes: Uint8Array): string {
    return `sha384-${createHash('sha384').update(bytes).digest('base64')}`;
}

function assertMatches(script: PinnedScript, bytes: Uint8Array, origin: string): void {
    const actual = integrityOf(bytes);

    if (actual !== script.integrity) {
        throw new DesignArtifactError(
            'integrity-mismatch',
            `${script.name} from ${origin} hashes to ${actual}, not the pinned ${script.integrity}.`,
        );
    }
}

/**
 * Returns the verified React 18 runtime, fetching what is not cached.
 *
 * @returns The two scripts' text, `react` first.
 * @throws DesignArtifactError `integrity-mismatch` when a cached or fetched file is not the pinned build, and a plain
 * `Error` naming the URL when the network is needed and unreachable.
 * @sideEffect Reads and writes the cache directory; fetches from jsDelivr on a cache miss.
 */
export async function reactRuntime(): Promise<{ readonly react: string; readonly reactDom: string }> {
    await mkdir(REACT_CACHE_DIR, { recursive: true });

    const texts: string[] = [];

    for (const script of REACT_RUNTIME) {
        const cached = join(REACT_CACHE_DIR, script.name);

        // Read the cache directly and treat a missing file as a miss: checking first and reading after would race.
        const bytes = await readFile(cached).catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
                return undefined;
            }

            throw error;
        });

        if (bytes !== undefined) {
            assertMatches(script, bytes, cached);
            texts.push(bytes.toString('utf8'));
            continue;
        }

        const response = await fetch(script.url);

        if (!response.ok) {
            throw new Error(`Could not fetch ${script.url}: HTTP ${String(response.status)}.`);
        }

        const fetched = new Uint8Array(await response.arrayBuffer());

        assertMatches(script, fetched, script.url);
        await writeFile(cached, fetched);
        texts.push(Buffer.from(fetched).toString('utf8'));
    }

    const [react, reactDom] = texts;

    return { react: react ?? '', reactDom: reactDom ?? '' };
}
