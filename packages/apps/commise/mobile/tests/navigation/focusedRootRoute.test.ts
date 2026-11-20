import { describe, expect, it } from 'vitest';

import { noticeFormOf } from '../../src/navigation/focusedRootRoute.js';

describe('noticeFormOf', () => {
    it('is the cooking form only while the cooking task is the focused root route', () => {
        expect(noticeFormOf('CookingMode')).toBe('cooking');
    });

    it('is the app form on the tabs, on every other task, and before any route is known', () => {
        expect(noticeFormOf('Tabs')).toBe('app');
        expect(noticeFormOf('RecipeEdit')).toBe('app');
        expect(noticeFormOf('RecipeCreate')).toBe('app');
        expect(noticeFormOf(undefined)).toBe('app');
    });
});
