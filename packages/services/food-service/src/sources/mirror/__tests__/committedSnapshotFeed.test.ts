/**
 * The committed-snapshot feed (plan U28, KTD-26): a preview fills its mirror from a snapshot committed to the
 * repository and calls no publisher, so open pull requests never multiply the load on one. The snapshot is gzipped,
 * and its pin is the SHA-256 of the publisher's own bytes, so it is checked after decompression and before a byte
 * reaches the parser.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSourcePinMismatchError } from '../../../foods/seed/archive/sourcePin.errors.js';
import { committedSnapshotFeed } from '../committedSnapshotFeed.js';
import { mirrorPullOf, type MirrorPull } from '../mirrorFeed.js';

const PUBLISHED = '{"foods":[{"foodId":"06.178","foodName":"Adzuki beans, uncooked"}],"locale":"en"}';
const PUBLISHED_SHA256 = createHash('sha256').update(PUBLISHED, 'utf8').digest('hex');
const PULL: MirrorPull = mirrorPullOf([{ externalKey: '06.178', name: 'Adzuki beans', payload: { foodId: '06.178' } }]);

describe('committedSnapshotFeed', () => {
    let dir: string;
    let path: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'snapshotFeed'));
        path = join(dir, 'matvaretabellenFoods2026.gz');
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await rm(dir, { recursive: true, force: true });
    });

    it("decompresses the snapshot, checks the publisher's digest, and hands the parser the published text", async () => {
        await writeFile(path, gzipSync(PUBLISHED));
        const seen: string[] = [];

        const pull = await committedSnapshotFeed(
            'matvaretabellen',
            { path, upstreamSha256: PUBLISHED_SHA256 },
            (text) => {
                seen.push(text);

                return PULL;
            },
        ).pull();

        expect(pull).toBe(PULL);
        expect(seen).toEqual([PUBLISHED]);
    });

    it('names its source', () => {
        expect(
            committedSnapshotFeed('matvaretabellen', { path, upstreamSha256: PUBLISHED_SHA256 }, () => PULL).source,
        ).toBe('matvaretabellen');
    });

    it('calls no network', async () => {
        await writeFile(path, gzipSync(PUBLISHED));
        const fetchSpy = vi.spyOn(globalThis, 'fetch');

        await committedSnapshotFeed('matvaretabellen', { path, upstreamSha256: PUBLISHED_SHA256 }, () => PULL).pull();

        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refuses a snapshot whose published bytes differ from the pin, before the parser sees them', async () => {
        await writeFile(path, gzipSync(PUBLISHED.replace('Adzuki', 'Mung')));
        let parsed = false;

        const thrown = await committedSnapshotFeed(
            'matvaretabellen',
            { path, upstreamSha256: PUBLISHED_SHA256 },
            () => {
                parsed = true;

                return PULL;
            },
        )
            .pull()
            .catch((error: unknown) => error);

        expect(isSourcePinMismatchError(thrown)).toBe(true);
        expect(isSourcePinMismatchError(thrown) && thrown.actual).toMatch(/^[0-9a-f]{64}$/u);
        expect(parsed).toBe(false);
    });

    it('refuses an absent snapshot as a pin with no file', async () => {
        const thrown = await committedSnapshotFeed(
            'matvaretabellen',
            { path, upstreamSha256: PUBLISHED_SHA256 },
            () => PULL,
        )
            .pull()
            .catch((error: unknown) => error);

        expect(isSourcePinMismatchError(thrown) && thrown.actual).toBeNull();
    });

    it('refuses a snapshot that is not gzip', async () => {
        await writeFile(path, PUBLISHED);

        await expect(
            committedSnapshotFeed('matvaretabellen', { path, upstreamSha256: PUBLISHED_SHA256 }, () => PULL).pull(),
        ).rejects.toThrow();
    });

    it('refuses a pin that is not a lower-case hex SHA-256', () => {
        expect(() =>
            committedSnapshotFeed(
                'matvaretabellen',
                { path, upstreamSha256: PUBLISHED_SHA256.toUpperCase() },
                () => PULL,
            ),
        ).toThrow(RangeError);
    });
});
