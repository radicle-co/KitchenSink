/**
 * ADR-0106: the earned hold clear is a function of an earned rewrite, never of a request. `clearByEarnedRewrite` takes the
 * caller's transaction and trusts it, so a route or a request body that reached it would let any caller clear a hold. No
 * controller and no DTO under `recipe-service/src` may name it. The first caller is the rewrite-earn path (a service), which
 * arrives later.
 *
 * Limit, stated: the guard reads identifiers in controllers and DTOs. A service that a controller calls and that forwards a
 * request field into the clear is caught by review and by the policy's own refusals, not by this scan.
 *
 * ✅ THE FIX FOR A FAILURE: call it from the service that earns the rewrite, inside that service's own transaction.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { presentFiles, repoRoot } from './serviceSources.js';
import { withoutTsComments } from './sourceComments.js';

const SERVICE_SRC = 'packages/services/recipe-service/src';
const FORBIDDEN = /\bclearByEarnedRewrite\b/;

const isWireSurface = (file: string): boolean => /\.controller\.ts$/.test(file) || /\/dto\//.test(file);

/** The files among `entries` that are a controller or a DTO and name the earned clear in code (comments stripped). Pure. */
function reachingFiles(entries: readonly { file: string; text: string }[]): string[] {
    return entries
        .filter(({ file, text }) => isWireSurface(file) && FORBIDDEN.test(withoutTsComments(text, file)))
        .map(({ file }) => file);
}

describe('the detector', () => {
    it('fails a controller that calls the earned clear', () => {
        const text = 'class C { go() { return this.clears.clearByEarnedRewrite(tx, id); } }';

        expect(reachingFiles([{ file: 'a/recipes/x.controller.ts', text }])).toEqual(['a/recipes/x.controller.ts']);
    });

    it('fails a DTO that names it', () => {
        expect(
            reachingFiles([{ file: 'a/recipes/dto/x.dto.ts', text: 'export const clearByEarnedRewrite = 1;' }]),
        ).toEqual(['a/recipes/dto/x.dto.ts']);
    });

    it('passes a clean controller, a service that calls it, and a comment that only mentions it', () => {
        expect(
            reachingFiles([
                { file: 'a/x.controller.ts', text: 'class C {}' },
                { file: 'a/x.service.ts', text: 'this.clears.clearByEarnedRewrite(tx, id);' },
                { file: 'a/y.controller.ts', text: '// never clearByEarnedRewrite here\nclass C {}' },
            ]),
        ).toEqual([]);
    });
});

describe('the real tree', () => {
    it('no controller and no DTO under recipe-service names clearByEarnedRewrite', () => {
        const entries = presentFiles([SERVICE_SRC])
            .filter((file) => file.endsWith('.ts'))
            .map((file) => ({ file, text: readFileSync(path.join(repoRoot, file), 'utf8') }));

        expect(reachingFiles(entries)).toEqual([]);
    });
});
