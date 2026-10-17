import { describe, expect, it } from 'vitest';

import { isCardRuntimeConfig } from '../../cardRuntimeConfig.js';

describe('isCardRuntimeConfig', () => {
    it.each<[string, unknown, boolean]>([
        ['both, plain', { platforms: 'both', phoneViewport: false, frameHeight: null }, true],
        ['native, staged', { platforms: 'native', phoneViewport: true, frameHeight: 400 }, true],
        ['an unknown platform', { platforms: 'tv', phoneViewport: false, frameHeight: null }, false],
        ['a string viewport flag', { platforms: 'web', phoneViewport: 'yes', frameHeight: null }, false],
        ['a missing frame height', { platforms: 'web', phoneViewport: false }, false],
        ['a string frame height', { platforms: 'web', phoneViewport: false, frameHeight: '4' }, false],
        ['null', null, false],
        ['a string', 'both', false],
    ])('%s -> %s', (_name, value, expected) => {
        expect(isCardRuntimeConfig(value)).toBe(expected);
    });
});
