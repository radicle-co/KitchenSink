/**
 * The deferred-event detector against its own fixture table, proven before it is trusted with the tree
 * (`deferredEventReadsGuard.test.ts`). The renderer releases a handler's event when the handler returns, and a state
 * updater runs later, in render, so an event read inside one is `null` (qa-ios: `Cannot read property 'layout' of null`).
 */
import { describe, expect, it } from 'vitest';

import { deferredEventReads } from './deferredEventReads.js';

const reads = (code: string): number => deferredEventReads(code, 'x.native.tsx').length;

describe('deferredEventReads', () => {
    it.each([
        [
            'the Recipes frame spacer (the reported defect)',
            'const a = <View onLayout={(event) => setSpacer((previous) => nextBox(previous, event.nativeEvent.layout))} />;',
        ],
        ['a setState updater', 'function h(event) { setX((p) => p + event.nativeEvent.contentOffset.y); }'],
        ['a timer', 'const h = (e) => { setTimeout(() => use(e.nativeEvent.layout), 0); };'],
        ['a promise callback', 'const h = (e) => { load().then(() => use(e.nativeEvent)); };'],
        ['an inner function declaration', 'const h = (e) => { function later() { return e.nativeEvent; } };'],
    ])('flags %s', (_name, code) => {
        expect(reads(code)).toBe(1);
    });

    it.each([
        ['a synchronous read in the handler', 'const h = (event) => { const { layout } = event.nativeEvent; setX(layout); };'],
        [
            'the value read first, then passed to the updater',
            'const h = (event) => { const { layout } = event.nativeEvent; setBox((previous) => nextBox(previous, layout)); };',
        ],
        ['a destructured parameter', 'const h = ({ nativeEvent }) => { setBox((previous) => nextBox(previous, nativeEvent.layout)); };'],
        ['a nativeEvent that is not a handler parameter', 'const a = (() => { const o = { nativeEvent: 1 }; return () => o.nativeEvent; })();'],
        ['an arrow that returns the value directly', 'const h = (event) => event.nativeEvent.layout;'],
    ])('does not flag %s', (_name, code) => {
        expect(reads(code)).toBe(0);
    });

    it('reports the line of each use', () => {
        const code = 'const h = (e) => {\n  setX((p) => p + e.nativeEvent.x);\n  setY((p) => p + e.nativeEvent.y);\n};';

        expect(deferredEventReads(code, 'x.native.tsx').map((use) => use.line)).toEqual([2, 3]);
    });
});
