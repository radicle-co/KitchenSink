/**
 * Loads the committed IAM catalogue (`manifests/iamCatalogue.json`) for the guards that judge actions and ARNs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IamCatalogue } from '../src/iamCatalogue.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const iamCatalogue: IamCatalogue = JSON.parse(
    readFileSync(path.join(here, '../manifests/iamCatalogue.json'), 'utf8'),
) as IamCatalogue;

export const TEST_CONTEXT = { account: '123456789012', region: 'us-east-1' } as const;
