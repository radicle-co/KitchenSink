import { createContext } from 'react';

import type { TimerStore } from './timerStore.js';

/** The session's one timer store. `null` outside `TimerProvider`, which the hook reports as a plain error. */
export const TimerStoreContext = createContext<TimerStore | null>(null);
