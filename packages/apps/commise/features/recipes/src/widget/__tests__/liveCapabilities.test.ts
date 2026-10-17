/**
 * The capabilities whose backing service is live: ONE list read by Home's widget curation and by both apps'
 * navigation. It was declared twice (web `AppShell`, mobile `liveCapabilities.ts`); this pins the single copy and
 * that the `./widget` package entry exposes it.
 */
import { describe, expect, it } from 'vitest';

import { RECIPE_HOME_WIDGET_CAPABILITY } from '../../descriptor.js';
import { LIVE_CAPABILITIES } from '../index.js';

describe('LIVE_CAPABILITIES', () => {
    it('names the recipe capability, the only one whose service ships', () => {
        expect(LIVE_CAPABILITIES).toEqual([RECIPE_HOME_WIDGET_CAPABILITY]);
    });
});
