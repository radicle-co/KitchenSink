/**
 * Unit tests for {@link localEnvFilePaths} — the development-ONLY env-file gate (issue #120).
 *
 * This gate is a security-adjacent invariant, not a convenience: `FOOD_SERVICE_URL` is required with no
 * in-code default precisely so a deploy that forgot it fails loudly. If a committed `.env.development` were
 * also read on a deployed stage, it would silently restore the `http://localhost:3002` fallback that was
 * removed. So anything other than the exact string `development` must load NOTHING.
 */
import { describe, expect, it } from 'vitest';

import { localEnvFilePaths } from '../envFiles.js';

describe('localEnvFilePaths', () => {
    it('loads the local files in development, with the gitignored .env.local winning', () => {
        expect(localEnvFilePaths('development')).toEqual(['.env.local', '.env.development']);
    });

    it.each([['staging'], ['production'], ['test'], ['Development'], ['']])(
        'loads NOTHING for NODE_ENV=%s — a deployed stage must not read a committed default',
        (nodeEnv) => {
            expect(localEnvFilePaths(nodeEnv)).toEqual([]);
        },
    );

    it('loads NOTHING when NODE_ENV is unset', () => {
        expect(localEnvFilePaths(undefined)).toEqual([]);
    });
});
