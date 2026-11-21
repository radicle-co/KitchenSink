// The git arguments behind bin/afterMerge.ts. Each case fails when its rule is removed: the two defects found on this
// feature (a two-dot diff, and a pathspec that was relative to the workspace folder) lived in exactly these arguments.
import { describe, expect, it } from 'vitest';

import { incomingDiffArgs } from '../incomingDiff.js';

const FOLDERS = ['docs/generated/components', 'docs/generated/design'] as const;

describe('incomingDiffArgs', () => {
    it('reads a merge commit as the incoming branch since the merge base, with three dots', () => {
        const args = incomingDiffArgs(true, FOLDERS);

        expect(args).toContain('HEAD^1...HEAD^2');
        expect(args.join(' ')).not.toMatch(/HEAD\^1\.\.HEAD\^2/u);
    });

    it('reads a fast-forward as what the pull moved, never through a second parent', () => {
        const args = incomingDiffArgs(false, FOLDERS);

        expect(args.slice(2, 4)).toEqual(['ORIG_HEAD', 'HEAD']);
        expect(args.join(' ')).not.toContain('HEAD^2');
    });

    it.each([true, false])('anchors every folder at the repository root (merge commit: %s)', (isMergeCommit) => {
        const args = incomingDiffArgs(isMergeCommit, FOLDERS);
        const pathspecs = args.slice(args.indexOf('--') + 1);

        expect(pathspecs).toEqual([':(top)docs/generated/components', ':(top)docs/generated/design']);
    });

    it('lists names only, so the caller needs no parsing', () => {
        expect(incomingDiffArgs(true, FOLDERS).slice(0, 2)).toEqual(['diff', '--name-only']);
    });
});
