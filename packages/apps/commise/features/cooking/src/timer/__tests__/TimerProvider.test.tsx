/** The timer provider on web: the cases are shared with the native file (`timerProviderCases.tsx`). */
import { afterEach, describe } from 'vitest';
import { cleanup } from '@testing-library/react';

import { timerProviderCases } from './timerProviderCases.js';

afterEach(cleanup);

describe('TimerProvider (web)', timerProviderCases);
