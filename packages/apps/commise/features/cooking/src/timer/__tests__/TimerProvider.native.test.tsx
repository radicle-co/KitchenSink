/** The timer provider under the native config: the cases are shared with the web file (`timerProviderCases.tsx`). */
import { afterEach, describe } from 'vitest';
import { cleanup } from '@testing-library/react';

import { timerProviderCases } from './timerProviderCases.js';

afterEach(cleanup);

describe('TimerProvider (native)', timerProviderCases);
