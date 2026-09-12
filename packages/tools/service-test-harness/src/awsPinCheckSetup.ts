/**
 * The vitest setup file every pinned tier runs (`AwsPin.setupFiles`): before each test file, the SDK's real default
 * credential chain must resolve the pin's dummy key (`awsPinCheck.ts`).
 *
 * @sideEffect Resolves AWS credentials when imported, and throws if the pin did not hold.
 */
import { defaultProvider } from '@aws-sdk/credential-provider-node';

import { assertPinnedAwsCredentials } from './awsPinCheck.js';

await assertPinnedAwsCredentials(defaultProvider());
