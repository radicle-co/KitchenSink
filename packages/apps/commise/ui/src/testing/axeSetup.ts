/**
 * @module testing/axeSetup — registers `toHaveNoViolations` on Vitest's `expect`, for the web component tiers that list
 * it in `setupFiles`.
 */
import { expect } from 'vitest';

import { toHaveNoViolations } from './axe.js';

expect.extend(toHaveNoViolations);
