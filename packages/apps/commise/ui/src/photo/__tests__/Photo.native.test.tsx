/**
 * The native `Photo` is Tamagui's `styled()` over expo-image's `Image`, with a boolean `fill` variant. What a leaf
 * relies on is that expo-image's own props pass through untouched (`source`, `contentFit`, `cachePolicy` and the
 * accessibility name), and that `fill` is a `width` and `height` of 100% that a caller's own size still overrides.
 *
 * `expo-image` is a native module, aliased to `test/stubs/expoImageStub.tsx`, which writes `data-content-fit` and
 * `data-cache-policy` so a test can see they arrived. Tamagui's web build, which this lane runs, hands a non-Tamagui base
 * its sizes as an inline `style`, and drops React Native's `accessibilityElementsHidden` and `importantForAccessibility`
 * before the base sees them, so the pair that hides a photo from assistive tech is a DEVICE check (the first consumer
 * slice's Maestro flow), not one this lane can make.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { renderWithTamagui } from '../../testing/tamaguiTesting.native.js';
import { Photo } from '../Photo.native.js';

afterEach(cleanup);

const SOURCE = { uri: 'https://cdn.example/pie.jpg' };

/** The image's root: the element Tamagui's style lands on. */
const rootOf = (label: string): HTMLElement => screen.getByAltText(label).parentElement as HTMLElement;

describe('Photo (native)', () => {
    it('fill paints width and height 100%', () => {
        renderWithTamagui(<Photo fill source={SOURCE} accessibilityLabel="A pie" />, 'light');

        expect(rootOf('A pie').style.width).toBe('100%');
        expect(rootOf('A pie').style.height).toBe('100%');
    });

    it('without fill sets neither width nor height', () => {
        renderWithTamagui(<Photo source={SOURCE} accessibilityLabel="A pie" />, 'light');

        expect(rootOf('A pie').style.width).toBe('');
        expect(rootOf('A pie').style.height).toBe('');
    });

    it('passes source, contentFit and cachePolicy to expo-image', () => {
        renderWithTamagui(
            <Photo source={SOURCE} accessibilityLabel="A pie" contentFit="contain" cachePolicy="memory-disk" />,
            'light',
        );

        expect(screen.getByAltText('A pie').getAttribute('src')).toBe(SOURCE.uri);
        expect(rootOf('A pie').getAttribute('data-content-fit')).toBe('contain');
        expect(rootOf('A pie').getAttribute('data-cache-policy')).toBe('memory-disk');
    });

    it('names the image with its accessibilityLabel', () => {
        renderWithTamagui(<Photo source={SOURCE} accessibilityLabel="Steaming apple pie" />, 'light');

        expect(screen.getByAltText('Steaming apple pie')).toBeTruthy();
    });

    it('lets a caller’s own size win over fill', () => {
        renderWithTamagui(<Photo fill width={120} source={SOURCE} accessibilityLabel="A pie" />, 'light');

        expect(rootOf('A pie').style.width).toBe('120px');
        expect(rootOf('A pie').style.height).toBe('100%');
    });
});
