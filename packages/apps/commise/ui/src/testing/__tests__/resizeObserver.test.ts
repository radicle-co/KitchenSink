import { afterEach, describe, expect, it, vi } from 'vitest';

import { resizeObserver } from '../resizeObserver.js';

afterEach(() => {
    resizeObserver.observed.clear();
    resizeObserver.callback = undefined;
});

describe('the recording ResizeObserver', () => {
    // jsdom has no ResizeObserver; react-native-web reports `onLayout` through one. This double is what lets a test
    // see WHICH nodes are watched and report a layout through the callback, so these are its whole contract.
    it('is installed on globalThis by importing the module', () => {
        expect(typeof globalThis.ResizeObserver).toBe('function');
    });

    it('records the callback and the nodes watched, and forgets a node that is unobserved', () => {
        const callback = vi.fn();
        const first = document.createElement('div');
        const second = document.createElement('div');
        const observer = new ResizeObserver(callback);

        observer.observe(first);
        observer.observe(second);
        observer.unobserve(first);

        expect(resizeObserver.callback).toBe(callback);
        expect([...resizeObserver.observed]).toEqual([second]);
    });

    it('forgets every node on disconnect', () => {
        const observer = new ResizeObserver(vi.fn());

        observer.observe(document.createElement('div'));
        observer.disconnect();

        expect(resizeObserver.observed.size).toBe(0);
    });
});
