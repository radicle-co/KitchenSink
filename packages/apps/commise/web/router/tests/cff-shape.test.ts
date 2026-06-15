import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// CloudFront Functions runtime 2.0 locates a TOP-LEVEL `function handler(event)` and FORBIDS `export`
// statements (unlike AWS Lambda's `export const handler`). esbuild bundles this file with
// --tree-shaking=false precisely so the unreferenced top-level handler survives. This test locks that
// contract: a well-meaning "add an export" change would bundle cleanly but fail at CloudFront deploy.
// See docs/architecture/decisions/0001 and the JS-2.0 runtime docs.
const here = path.dirname(fileURLToPath(import.meta.url));
const cffSource = readFileSync(path.join(here, '../src/router.cff.js'), 'utf8');

describe('router.cff.js shape (CloudFront Functions JS 2.0 contract)', () => {
    it('declares a top-level async handler function', () => {
        expect(cffSource).toMatch(/^async function handler\(event\)/m);
    });

    it('contains no export statement (CFF 2.0 rejects exports)', () => {
        expect(cffSource).not.toMatch(/^\s*export\b/m);
    });

    it('imports the cloudfront built-in (the only allowed import at the edge)', () => {
        expect(cffSource).toMatch(/^import cf from 'cloudfront';/m);
    });
});
