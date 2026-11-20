import { describe, expect, it } from 'vitest';

import { CANVAS_ASSETS_DIR, isLfsPointer, lfsPullArgs, lfsPullCommand } from '../gitCanvasHistory.js';

const POINTER = Buffer.from('version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 3\n');

describe('isLfsPointer', () => {
    it('is true for a pointer file', () => {
        expect(isLfsPointer(POINTER)).toBe(true);
    });

    it.each([
        ['PNG', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        ['WebP', Buffer.from('RIFF\0\0\0\0WEBP', 'latin1')],
    ])('is false for %s bytes', (_name, bytes) => {
        expect(isLfsPointer(bytes)).toBe(false);
    });

    it('is false for a buffer shorter than the header, and for an empty one', () => {
        expect(isLfsPointer(POINTER.subarray(0, 10))).toBe(false);
        expect(isLfsPointer(Buffer.alloc(0))).toBe(false);
    });

    it('is false for a near-miss header', () => {
        expect(isLfsPointer(Buffer.from('version https://git-lfs.github.com/spec/v2\n'))).toBe(false);
        expect(isLfsPointer(Buffer.from('version https://git-lfs.github.com/spec/v1 \n'))).toBe(false);
        expect(isLfsPointer(Buffer.from(' version https://git-lfs.github.com/spec/v1\n'))).toBe(false);
    });
});

describe('lfsPullArgs', () => {
    it('lifts the fetch exclude and includes the asset folder of every canvas in one list', () => {
        expect(lfsPullArgs(['homeWeb', 'homeMobile'])).toEqual([
            '-c',
            'lfs.fetchexclude=',
            'lfs',
            'pull',
            `--include=docs/design/canvases/homeWeb/project/${CANVAS_ASSETS_DIR}/**,docs/design/canvases/homeMobile/project/${CANVAS_ASSETS_DIR}/**`,
        ]);
    });
});

describe('lfsPullCommand', () => {
    it('is the git command with only the include list quoted', () => {
        expect(lfsPullCommand('homeWeb')).toBe(
            "git -c lfs.fetchexclude= lfs pull --include='docs/design/canvases/homeWeb/project/assets/**'",
        );
    });

    it('joins several folders into one quoted list', () => {
        expect(lfsPullCommand('a', 'b')).toBe(
            "git -c lfs.fetchexclude= lfs pull --include='docs/design/canvases/a/project/assets/**,docs/design/canvases/b/project/assets/**'",
        );
    });
});
