/**
 * Unit tests for the Home-widget descriptor contract — the live/placeholder discriminated union, its type
 * guards, and its zod validator.
 *
 * Requirement map:
 *  - FR-046 / R6 (as amended by CR-001) — a widget for an unshipped feature (005–009) renders as a SKELETON
 *    PLACEHOLDER, never as fake data and no longer as an absent tile. The union exists so that
 *    "a placeholder without a capability" is UNREPRESENTABLE: a placeholder is defined by the capability it
 *    is waiting on, so omitting it must be a compile error, and the validator must reject it at runtime.
 */
import { describe, expect, it } from 'vitest';

import {
    homeWidgetDescriptorSchema,
    isLiveHomeWidget,
    isPlaceholderHomeWidget,
    type HomeWidgetDescriptor,
    type LiveHomeWidgetDescriptor,
    type PlaceholderHomeWidgetDescriptor,
} from '../contract.js';

const noopLoad = (): Promise<{ default: unknown }> => Promise.resolve({ default: null });

const live: LiveHomeWidgetDescriptor = { id: 'recipes', load: noopLoad, defaultWeight: 10, capability: 'recipes' };
const placeholder: PlaceholderHomeWidgetDescriptor = {
    kind: 'placeholder',
    id: 'nutrition',
    load: noopLoad,
    defaultWeight: 20,
    capability: 'nutrition',
};

describe('HomeWidgetDescriptor type guards', () => {
    describe('isPlaceholderHomeWidget', () => {
        it('is true for a descriptor whose kind is placeholder', () => {
            expect(isPlaceholderHomeWidget(placeholder)).toBe(true);
        });

        it('is false for an explicit live descriptor', () => {
            expect(isPlaceholderHomeWidget({ ...live, kind: 'live' })).toBe(false);
        });

        it('is false for a descriptor with no kind (the implicit-live default)', () => {
            expect(isPlaceholderHomeWidget(live)).toBe(false);
        });

        it('narrows to the placeholder arm, exposing its REQUIRED capability', () => {
            const descriptor: HomeWidgetDescriptor = placeholder;

            if (!isPlaceholderHomeWidget(descriptor)) {
                throw new Error('expected the placeholder arm');
            }

            // `capability` is `string` (not `string | undefined`) only on the narrowed placeholder arm — this
            // assignment is the compile-time proof that a capability-less placeholder is unrepresentable.
            const capability: string = descriptor.capability;

            expect(capability).toBe('nutrition');
        });
    });

    describe('isLiveHomeWidget', () => {
        it('is true for a descriptor with no kind (a bare descriptor is live by default)', () => {
            expect(isLiveHomeWidget(live)).toBe(true);
        });

        it('is true for an explicitly-live descriptor', () => {
            expect(isLiveHomeWidget({ ...live, kind: 'live' })).toBe(true);
        });

        it('is false for a placeholder descriptor', () => {
            expect(isLiveHomeWidget(placeholder)).toBe(false);
        });
    });

    it('classifies every descriptor as exactly one of live or placeholder', () => {
        for (const descriptor of [live, { ...live, kind: 'live' as const }, placeholder]) {
            expect(isLiveHomeWidget(descriptor)).toBe(!isPlaceholderHomeWidget(descriptor));
        }
    });
});

describe('homeWidgetDescriptorSchema', () => {
    describe('live arm', () => {
        it('accepts a bare descriptor with no kind', () => {
            expect(homeWidgetDescriptorSchema.safeParse(live).success).toBe(true);
        });

        it('accepts an explicitly-live descriptor', () => {
            expect(homeWidgetDescriptorSchema.safeParse({ ...live, kind: 'live' }).success).toBe(true);
        });

        it('accepts a live descriptor with NO capability (an always-on widget)', () => {
            const { capability: _capability, ...noCapability } = live;

            expect(homeWidgetDescriptorSchema.safeParse(noCapability).success).toBe(true);
        });
    });

    describe('placeholder arm', () => {
        it('accepts a well-formed placeholder', () => {
            expect(homeWidgetDescriptorSchema.safeParse(placeholder).success).toBe(true);
        });

        it('REJECTS a placeholder with no capability (the illegal state the union exists to prevent)', () => {
            const { capability: _capability, ...noCapability } = placeholder;

            expect(homeWidgetDescriptorSchema.safeParse(noCapability).success).toBe(false);
        });

        it('rejects a placeholder whose capability is empty', () => {
            expect(homeWidgetDescriptorSchema.safeParse({ ...placeholder, capability: '' }).success).toBe(false);
        });
    });

    describe('shared constraints', () => {
        it('rejects an unknown kind', () => {
            expect(homeWidgetDescriptorSchema.safeParse({ ...live, kind: 'ghost' }).success).toBe(false);
        });

        it('rejects a descriptor with an empty id', () => {
            expect(homeWidgetDescriptorSchema.safeParse({ ...live, id: '' }).success).toBe(false);
        });

        it('rejects a descriptor whose load is not a function', () => {
            expect(homeWidgetDescriptorSchema.safeParse({ ...live, load: 'nope' }).success).toBe(false);
        });

        it('rejects a non-finite defaultWeight', () => {
            expect(homeWidgetDescriptorSchema.safeParse({ ...live, defaultWeight: Number.NaN }).success).toBe(false);
        });
    });
});
