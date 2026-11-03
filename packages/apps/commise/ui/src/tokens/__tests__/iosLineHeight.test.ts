/**
 * The default (web, and any non-native bundler) line-height snap is the identity: only the native iOS file shifts the
 * leading, so a web page or a Node build reads the exact token (react/react-native#58970 is a TextKit/Yoga bug).
 */
import { describe, expect, it } from 'vitest';

import { devicePixelScale, snapLineHeight } from '../iosLineHeight.js';

describe('snapLineHeight (default)', () => {
    it.each([
        [28, 3],
        [20.2, 3],
        [24, 2],
        [32, 1],
    ])('returns %s exactly at pixel scale %s', (lineHeight, scale) => {
        expect(snapLineHeight(lineHeight, scale)).toBe(lineHeight);
    });

    it('reads a pixel scale of 1 where there is no device', () => {
        expect(devicePixelScale()).toBe(1);
    });
});
