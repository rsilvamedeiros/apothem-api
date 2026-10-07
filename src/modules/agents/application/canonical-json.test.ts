import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical-json.js';

describe('canonicalJson', () => {
  it('serializes primitives like JSON', () => {
    expect(canonicalJson('a"b')).toBe('"a\\"b"');
    expect(canonicalJson(1.5)).toBe('1.5');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(null)).toBe('null');
  });

  it('serializes undefined and functions as null at the top level', () => {
    expect(canonicalJson(undefined)).toBe('null');
  });

  it('sorts object keys at every depth, in both directions', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
    expect(canonicalJson({ z: { y: 1, x: 2 }, a: [{ d: 1, c: 2 }] })).toBe('{"a":[{"c":2,"d":1}],"z":{"x":2,"y":1}}');
  });

  it('keeps array order (order is meaningful)', () => {
    expect(canonicalJson([2, 1])).not.toBe(canonicalJson([1, 2]));
    expect(canonicalJson([1, [2, 3]])).toBe('[1,[2,3]]');
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson({})).toBe('{}');
  });

  it('drops undefined object members like JSON.stringify', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  it('distinguishes different values', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ b: 1 }));
    expect(canonicalJson({ a: '1' })).not.toBe(canonicalJson({ a: 1 }));
  });

  it('is invariant under key shuffling and agrees with JSON.parse round-trips (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const shuffled = JSON.parse(JSON.stringify(value), (_key, v: unknown) =>
          v !== null && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).reverse())
            : v,
        );
        expect(canonicalJson(shuffled)).toBe(canonicalJson(value));
      }),
    );
  });
});
