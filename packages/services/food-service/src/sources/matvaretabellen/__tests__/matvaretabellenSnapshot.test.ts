/**
 * The committed Matvaretabellen snapshot (plan U28, KTD-26) against the committed extract the seed cites (U23).
 *
 * A preview fills its mirror from this snapshot, so it must be the publisher's file (its pin) and it must say what the
 * seed says: through the same parser and mapper a live sync uses, every cited food is listed and every value the
 * mirror reads equals the extract's. A drift here is a real finding for a seed pull request (R60), not a test to
 * loosen. The kJ value is not compared because the mirror does not read it (see `matvaretabellenMirrorMapper.ts`).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSourceExtract } from '../../../foods/seed/archive/sourceExtract.js';
import { parseTableExtractPins } from '../../../foods/seed/archive/tableExtractPins.js';
import { committedSnapshotFeed } from '../../mirror/committedSnapshotFeed.js';
import { extractDrift } from '../../mirror/extractDrift.js';
import { parseMatvaretabellenFoods } from '../matvaretabellenFoods.js';
import { MATVARETABELLEN_MIRROR_TAGS, matvaretabellenExtractLine } from '../matvaretabellenMirrorMapper.js';

const DATA_DIR = join(import.meta.dirname, '../../../foods/seed/data/matvaretabellen');

describe('the committed Matvaretabellen snapshot', () => {
    it('is the pinned publisher file, lists every cited food, and agrees with the extract on every value it reads', async () => {
        const pins = parseTableExtractPins(await readFile(join(DATA_DIR, 'sourcePins.json'), 'utf8'));
        const snapshot = pins.snapshots?.['foods'];
        const extract = parseSourceExtract(await readFile(join(DATA_DIR, pins.extract)));

        expect(snapshot).toBeDefined();

        const pull = await committedSnapshotFeed(
            'matvaretabellen',
            { path: join(DATA_DIR, snapshot?.committed ?? ''), upstreamSha256: snapshot?.upstreamSha256 ?? '' },
            parseMatvaretabellenFoods,
        ).pull();

        expect(extract.size).toBeGreaterThan(0);
        expect(extractDrift(pull.items, extract, matvaretabellenExtractLine, MATVARETABELLEN_MIRROR_TAGS)).toEqual([]);
    });

    it('maps every food the publisher lists, so no listed food is unservable from the mirror', async () => {
        const pins = parseTableExtractPins(await readFile(join(DATA_DIR, 'sourcePins.json'), 'utf8'));
        const snapshot = pins.snapshots?.['foods'];
        const pull = await committedSnapshotFeed(
            'matvaretabellen',
            { path: join(DATA_DIR, snapshot?.committed ?? ''), upstreamSha256: snapshot?.upstreamSha256 ?? '' },
            parseMatvaretabellenFoods,
        ).pull();

        const rejected = pull.items.flatMap((item) => {
            try {
                matvaretabellenExtractLine(item);

                return [];
            } catch (error) {
                return [`${item.externalKey}: ${error instanceof Error ? error.message : String(error)}`];
            }
        });

        expect(pull.items.length).toBeGreaterThan(2000);
        expect(rejected).toEqual([]);
    });
});
