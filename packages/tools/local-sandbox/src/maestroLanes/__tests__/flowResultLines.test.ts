import { describe, expect, it } from 'vitest';

import { flowResultLines, notPassed } from '../flowResultLines.js';

import type { FlowResult } from '@kitchensink/e2e-plan/recordedScreens';

const results = (entries: Readonly<Record<string, FlowResult>>): ReadonlyMap<string, FlowResult> =>
    new Map(Object.entries(entries));

describe('flowResultLines: one line per planned flow, so a flow that did not pass cannot hide', () => {
    it('says passed, FAILED, skipped or NO RESULT for each planned flow, in plan order', () => {
        const flows = ['a', 'b', 'c', 'd'];
        const recorded = results({ a: 'passed', b: 'failed', c: 'skipped' });

        expect(flowResultLines({ platform: 'android', flows, results: recorded })).toEqual([
            'android a: passed',
            'android b: FAILED',
            'android c: skipped',
            'android d: NO RESULT',
        ]);
    });

    it('keeps the plan order, not a sorted one', () => {
        const recorded = results({ a: 'passed', b: 'passed', c: 'passed' });

        expect(flowResultLines({ platform: 'ios', flows: ['c', 'a', 'b'], results: recorded })).toEqual([
            'ios c: passed',
            'ios a: passed',
            'ios b: passed',
        ]);
    });

    it('prints a flow listed twice once', () => {
        expect(flowResultLines({ platform: 'ios', flows: ['a', 'a'], results: results({ a: 'passed' }) })).toEqual([
            'ios a: passed',
        ]);
    });

    it('prints nothing for a result whose flow is not in the plan, and nothing for an empty plan', () => {
        const recorded = results({ a: 'passed', z: 'passed' });

        expect(flowResultLines({ platform: 'android', flows: ['a'], results: recorded })).toEqual([
            'android a: passed',
        ]);
        expect(flowResultLines({ platform: 'android', flows: [], results: recorded })).toEqual([]);
    });

    it('names the platform on every line and never merges two platforms', () => {
        const android = flowResultLines({ platform: 'android', flows: ['a'], results: results({ a: 'passed' }) });
        const ios = flowResultLines({ platform: 'ios', flows: ['a'], results: results({}) });

        expect([...android, ...ios]).toEqual(['android a: passed', 'ios a: NO RESULT']);
    });

    it('says a one-off that did not pass has screenshots that are not evidence, and says nothing of a pass', () => {
        const recorded = results({ 'oneOff/run1/shots': 'failed', 'oneOff/run1/ok': 'passed' });
        const flows = ['oneOff/run1/shots', 'oneOff/run1/ok', 'oneOff/run1/gone'];

        expect(flowResultLines({ platform: 'android', flows, results: recorded })).toEqual([
            'android oneOff/run1/shots: FAILED, screenshots not evidence',
            'android oneOff/run1/ok: passed',
            'android oneOff/run1/gone: NO RESULT, screenshots not evidence',
        ]);
    });

    it('does not mark a committed flow whose name only looks like a one-off', () => {
        const lines = flowResultLines({ platform: 'ios', flows: ['x/oneOff/d'], results: results({}) });

        expect(lines).toEqual(['ios x/oneOff/d: NO RESULT']);
    });
});

describe('notPassed: the planned flows without a recorded pass', () => {
    it('lists failed, skipped and unrecorded flows in plan order, once each', () => {
        const recorded = results({ a: 'passed', b: 'failed', c: 'skipped' });

        expect(notPassed(['d', 'a', 'b', 'c', 'b'], recorded)).toEqual(['d', 'b', 'c']);
    });

    it('is empty when every planned flow passed', () => {
        expect(notPassed(['a', 'b'], results({ a: 'passed', b: 'passed', z: 'failed' }))).toEqual([]);
    });
});
