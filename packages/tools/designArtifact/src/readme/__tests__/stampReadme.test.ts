import { describe, expect, it } from 'vitest';

import { stampReadme } from '../stampReadme.js';

describe('stampReadme', () => {
    const stamp = {
        sha: 'abcdef0123456789abcdef0123456789abcdef01',
        date: '2026-10-16T17:55:40-04:00',
        dirty: false,
    };

    it('appends one line naming the commit and its date after the authored text', () => {
        expect(stampReadme('# Commise\n\nBody.\n', stamp)).toBe(
            '# Commise\n\nBody.\n\nBuilt from commit abcdef012345 (2026-10-16T17:55:40-04:00).\n',
        );
    });

    it('does not pile up blank lines when the source ends with several', () => {
        expect(stampReadme('Body.\n\n\n', stamp)).toBe(
            'Body.\n\nBuilt from commit abcdef012345 (2026-10-16T17:55:40-04:00).\n',
        );
    });

    it('is a function of its inputs: the same commit gives the same text', () => {
        expect(stampReadme('x', stamp)).toBe(stampReadme('x', { ...stamp }));
    });

    it('says so when the tree had uncommitted changes: the commit alone does not name what was built', () => {
        expect(stampReadme('Body.\n', { ...stamp, dirty: true })).toBe(
            'Body.\n\nBuilt from commit abcdef012345 (2026-10-16T17:55:40-04:00) plus uncommitted changes.\n',
        );
    });

    it('changes when the commit changes', () => {
        expect(stampReadme('x', stamp)).not.toBe(stampReadme('x', { ...stamp, sha: '1'.repeat(40) }));
    });
});
