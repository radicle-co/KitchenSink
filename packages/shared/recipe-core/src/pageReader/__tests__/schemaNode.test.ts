import { describe, expect, it } from 'vitest';

import { asList, field, isSchemaNode, scalar, textOf, typeNames } from '../schemaNode.js';

describe('field', () => {
    it('reads an own property, and never an inherited one', () => {
        expect(field({ name: 'x' }, 'name')).toBe('x');
        expect(field({}, 'constructor')).toBeUndefined();
        expect(field({}, 'toString')).toBeUndefined();
        expect(field(Object.create({ name: 'inherited' }) as Record<string, unknown>, 'name')).toBeUndefined();
    });

    it('reads a parsed __proto__ key as plain data, and the prototype stays untouched', () => {
        const parsed: unknown = JSON.parse('{"__proto__":{"polluted":1},"name":"kept"}');

        expect(isSchemaNode(parsed)).toBe(true);
        expect(isSchemaNode(parsed) ? field(parsed, '__proto__') : undefined).toEqual({ polluted: 1 });
        expect(isSchemaNode(parsed) ? field(parsed, 'name') : undefined).toBe('kept');
        expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });
});

describe('isSchemaNode', () => {
    it.each([[{}], [{ a: 1 }], [Object.create(null)]])('accepts the object %j', (value) => {
        expect(isSchemaNode(value)).toBe(true);
    });

    it.each([[null], [undefined], [[]], ['text'], [3]])('refuses %j', (value) => {
        expect(isSchemaNode(value)).toBe(false);
    });
});

describe('asList and scalar', () => {
    it('make a list of anything, and take the first of a list', () => {
        expect(asList([1, 2])).toEqual([1, 2]);
        expect(asList('a')).toEqual(['a']);
        expect(asList(undefined)).toEqual([]);
        expect(asList(null)).toEqual([]);
        expect(scalar(['a', 'b'])).toBe('a');
        expect(scalar('a')).toBe('a');
        expect(scalar([])).toBeUndefined();
    });
});

describe('textOf', () => {
    it('reads one level of list and no deeper, so a hostile nesting cannot overflow the stack', () => {
        expect(textOf(['a', ['b'], 'c'])).toBe('a c');
        expect(textOf(JSON.parse(`${'['.repeat(100_000)}"x"${']'.repeat(100_000)}`))).toBeUndefined();
    });

    it('reads a string, a number, a JSON-LD value object and a list of them on one line', () => {
        expect(textOf('  a   b ')).toBe('a b');
        expect(textOf(7)).toBe('7');
        expect(textOf({ '@value': 'v' })).toBe('v');
        expect(textOf(['a', ' ', 'b'])).toBe('a b');
    });

    it.each([[undefined], [null], [''], ['  '], [{}], [{ '@value': {} }], [[]], [true]])(
        'reads %j as no text',
        (value) => {
            expect(textOf(value)).toBeUndefined();
        },
    );
});

describe('typeNames', () => {
    it('reduces a type to the name after the last slash, hash or colon', () => {
        expect(
            typeNames({ '@type': ['Recipe', 'schema:NewsArticle', 'https://schema.org/Thing/', 'http://x.org/#Odd'] }),
        ).toEqual(['Recipe', 'NewsArticle', 'Thing', 'Odd']);
        expect(typeNames({})).toEqual([]);
        expect(typeNames({ '@type': 5 })).toEqual([]);
    });
});
