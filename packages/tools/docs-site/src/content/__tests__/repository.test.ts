import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPOSITORY_BROWSE_URL, REPOSITORY_REF } from '../repository.js';
import { REPO_ROOT } from '../paths.js';

describe('repository constants', () => {
    it('still names the repository the root manifest points at', () => {
        // Containment, not equality: the manifest holds a git remote (`git+...git`) and this holds a
        // browse root. Containment is the strongest claim that needs no parser, and it is enough to
        // catch the hazard that matters — the repository being renamed or moved to another host,
        // which would otherwise leave every escaping link pointing at a stranger's project.
        const manifest: unknown = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
        const remote = (manifest as { repository?: { url?: string } }).repository?.url ?? '';

        expect(remote).not.toBe('');
        expect(remote).toContain(REPOSITORY_BROWSE_URL);
    });

    it('names a ref, with no slashes or spaces that would corrupt the produced path', () => {
        expect(REPOSITORY_REF).toMatch(/^[\w.-]+$/);
    });

    it('carries no trailing slash, because callers join with one', () => {
        expect(REPOSITORY_BROWSE_URL.endsWith('/')).toBe(false);
    });
});
