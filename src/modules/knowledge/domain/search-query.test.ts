import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_QUERY_TERMS, MAX_TERM_LENGTH, toSearchTerms } from './search-query.js';

describe('toSearchTerms', () => {
  it('lowercases, splits on anything that is not a letter or digit and drops one-character terms', () => {
    expect(toSearchTerms('Refund policy: 30-day, A b!')).toEqual(['refund', 'policy', '30', 'day']);
  });

  it('keeps accented letters and non-latin scripts', () => {
    expect(toSearchTerms('política de reembolso 返金')).toEqual(['política', 'de', 'reembolso', '返金']);
  });

  it('removes duplicates keeping the first occurrence', () => {
    expect(toSearchTerms('refund Refund REFUND policy refund')).toEqual(['refund', 'policy']);
  });

  it('keeps only the first terms up to the limit', () => {
    const query = Array.from({ length: MAX_QUERY_TERMS + 5 }, (_, n) => `term${n}`).join(' ');
    const terms = toSearchTerms(query);
    expect(terms).toHaveLength(MAX_QUERY_TERMS);
    expect(terms[0]).toBe('term0');
  });

  it('cuts a very long term', () => {
    expect(toSearchTerms('a'.repeat(MAX_TERM_LENGTH + 20))[0]).toHaveLength(MAX_TERM_LENGTH);
  });

  it('returns nothing when there is nothing searchable', () => {
    expect(toSearchTerms('  ! ? - ')).toEqual([]);
    expect(toSearchTerms('')).toEqual([]);
  });

  it('can never carry a tsquery operator', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (query) =>
        toSearchTerms(query).every((term) => /^[\p{L}\p{N}]+$/u.test(term) && term.length <= MAX_TERM_LENGTH),
      ),
    );
    expect(toSearchTerms("xx' | yy & !zz <-> (ww) :*")).toEqual(['xx', 'yy', 'zz', 'ww']);
  });
});
