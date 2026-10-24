/**
 * The touch floor (§1.6): one definition of the smallest tap target, 44 pt on iOS and 48 dp on Android, extracted from
 * `Button.native` and `HeroButton.native`, which each kept a copy, so the pinned back bar's frame is the third caller and
 * not the third copy.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'android' }));

vi.mock('react-native', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-native')>();

    return {
        ...actual,
        Platform: {
            ...actual.Platform,
            get OS() {
                return platform.os;
            },
        },
    };
});

import { touchFloor } from '../touchFloor.native.js';

afterEach(() => {
    platform.os = 'ios';
});

describe('touchFloor', () => {
    it('is 44 pt on iOS', () => {
        platform.os = 'ios';

        expect(touchFloor()).toBe(44);
    });

    it('is 48 dp on Android: every 44 is 48 there', () => {
        platform.os = 'android';

        expect(touchFloor()).toBe(48);
    });
});
