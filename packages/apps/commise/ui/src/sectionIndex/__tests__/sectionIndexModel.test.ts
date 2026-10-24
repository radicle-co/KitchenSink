/**
 * The section index's tone Policy (`buildSpec.md` §7.2, "Statuses"): what each tone draws, and the bar's choices.
 */
import { describe, expect, it } from 'vitest';

import type { SectionIndexItem } from '../props.js';
import {
    TONE_GLYPH,
    TONE_ROLE,
    TONE_SEGMENT,
    barCountRoleOf,
    barItemOf,
    descriptionOf,
    shownCountOf,
} from '../sectionIndexModel.js';

const item = (overrides: Partial<SectionIndexItem>): SectionIndexItem => ({
    id: 'steps',
    label: 'Steps',
    tone: 'muted',
    ...overrides,
});

describe('sectionIndexModel', () => {
    it('gives every tone words or a glyph, never colour alone', () => {
        expect(TONE_GLYPH).toEqual({
            fix: 'triangleAlert',
            attention: 'triangleAlert',
            muted: undefined,
            complete: 'check',
        });
        expect(TONE_ROLE).toEqual({ fix: 'dangerText', attention: 'attention', muted: 'inkMuted', complete: 'ink' });
        expect(TONE_SEGMENT).toEqual({
            fix: 'needsAction',
            attention: 'needsAction',
            muted: 'empty',
            complete: 'done',
        });
    });

    it('counts only fix and attention', () => {
        expect(shownCountOf(item({ tone: 'fix', count: 2 }))).toBe(2);
        expect(shownCountOf(item({ tone: 'attention', count: 1 }))).toBe(1);
        expect(shownCountOf(item({ tone: 'muted', count: 3 }))).toBeUndefined();
        expect(shownCountOf(item({ tone: 'complete', count: 3 }))).toBeUndefined();
    });

    it('names the current item in the bar, the first before any is current, nothing for an empty index', () => {
        const items = [item({ id: 'a', label: 'A' }), item({ id: 'b', label: 'B' })];

        expect(barItemOf(items, 'b')?.label).toBe('B');
        expect(barItemOf(items, undefined)?.label).toBe('A');
        expect(barItemOf(items, 'gone')?.label).toBe('A');
        expect(barItemOf([], 'a')).toBeUndefined();
    });

    it('draws the bar count in dangerText when anything must be fixed, else attention', () => {
        expect(barCountRoleOf([item({ tone: 'attention' }), item({ tone: 'fix' })])).toBe('dangerText');
        expect(barCountRoleOf([item({ tone: 'attention' })])).toBe('attention');
    });

    it('describes by the reason, then the hint where shown, skipping what is absent or empty', () => {
        expect(descriptionOf(item({ reason: 'Not started', hint: 'Say how' }), true)).toBe('Not started, Say how');
        expect(descriptionOf(item({ reason: 'Not started', hint: 'Say how' }), false)).toBe('Not started');
        expect(descriptionOf(item({ hint: 'Say how' }), true)).toBe('Say how');
        expect(descriptionOf(item({ reason: '' }), true)).toBeUndefined();
        expect(descriptionOf(item({}), true)).toBeUndefined();
    });

    it('speaks a quiet status that shows no words (a plain complete), and only when it shows none', () => {
        expect(descriptionOf(item({ tone: 'complete', spokenStatus: 'Complete' }), false)).toBe('Complete');
        expect(
            descriptionOf(item({ tone: 'complete', reason: 'Ready to publish', spokenStatus: 'Complete' }), false),
        ).toBe('Ready to publish');
    });
});
