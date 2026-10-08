import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHUNK_MAX_CHARS, CHUNK_TARGET_CHARS, chunkText, normalizeText } from './chunker.js';

const squash = (text: string) => text.replace(/\s+/g, '');

describe('normalizeText', () => {
  it('unifies line endings and trims the ends', () => {
    expect(normalizeText('  one\r\ntwo\rthree  \n')).toBe('one\ntwo\nthree');
  });

  it('removes control characters but keeps tabs and newlines', () => {
    expect(normalizeText('a\u0000b\u0007c\td\ne\u007f')).toBe('abc\td\ne');
  });

  it('removes trailing spaces on each line and collapses runs of blank lines', () => {
    expect(normalizeText('a   \n\n\n\n\nb')).toBe('a\n\nb');
  });

  it('removes zero width and bidirectional override characters that can hide text', () => {
    expect(normalizeText('ig​nore ‮previous')).toBe('ignore previous');
  });

  it('is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (raw) => {
        const once = normalizeText(raw);
        return normalizeText(once) === once;
      }),
    );
  });
});

describe('chunkText', () => {
  it('returns nothing for empty text', () => {
    expect(chunkText('')).toEqual([]);
  });

  it('keeps a short document in a single chunk with a null section', () => {
    expect(chunkText('Refunds take five days.')).toEqual([{ ordinal: 0, text: 'Refunds take five days.', section: null }]);
  });

  it('packs consecutive paragraphs up to the target size', () => {
    const paragraph = 'a'.repeat(150);
    const chunks = chunkText([paragraph, paragraph, paragraph, paragraph].join('\n\n'));
    expect(chunks.map((c) => c.text.length)).toEqual([150 + 2 + 150, 150 + 2 + 150]);
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1]);
  });

  it('never packs beyond the target when the next paragraph would not fit', () => {
    const chunks = chunkText(['a'.repeat(300), 'b'.repeat(300)].join('\n\n'));
    expect(chunks.map((c) => c.text)).toEqual(['a'.repeat(300), 'b'.repeat(300)]);
  });

  it('records the nearest Markdown heading as the section and never spans two sections', () => {
    const chunks = chunkText(['# Billing', 'Invoices are monthly.', '## Refunds', 'Refunds take five days.', 'They go to the original card.'].join('\n\n'));
    expect(chunks).toEqual([
      { ordinal: 0, text: '# Billing\n\nInvoices are monthly.', section: 'Billing' },
      { ordinal: 1, text: '## Refunds\n\nRefunds take five days.\n\nThey go to the original card.', section: 'Refunds' },
    ]);
  });

  it('keeps text before the first heading in a null section', () => {
    const chunks = chunkText(['Intro text.', '# Title', 'Body.'].join('\n\n'));
    expect(chunks.map((c) => c.section)).toEqual([null, 'Title']);
  });

  it('limits the length of a section name', () => {
    const chunks = chunkText(`# ${'h'.repeat(300)}\n\nbody`);
    expect(chunks[0]!.section).toHaveLength(120);
  });

  it('does not treat a hash without a space, or seven hashes, as a heading', () => {
    expect(chunkText('#hashtag\n\n####### seven').map((c) => c.section)).toEqual([null]);
  });

  it('splits an oversized paragraph at whitespace without exceeding the hard maximum', () => {
    const words = Array.from({ length: 400 }, (_, n) => `word${n}`).join(' ');
    const chunks = chunkText(words);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS);
      expect(chunk.text).toBe(chunk.text.trim());
    }
    expect(chunks.map((c) => c.text).join(' ')).toBe(words);
  });

  it('hard-cuts a single token longer than the maximum', () => {
    const chunks = chunkText('x'.repeat(CHUNK_MAX_CHARS * 2 + 10));
    expect(chunks.map((c) => c.text.length)).toEqual([CHUNK_MAX_CHARS, CHUNK_MAX_CHARS, 10]);
  });

  it('trims the section name', () => {
    expect(chunkText('#   Spaced title   \n\nbody')[0]!.section).toBe('Spaced title');
  });

  it('keeps single line breaks inside one paragraph', () => {
    expect(chunkText('line one\nline two')).toEqual([{ ordinal: 0, text: 'line one\nline two', section: null }]);
  });

  it('skips blank units instead of storing them', () => {
    expect(chunkText('first\n\n   \n\nsecond').map((c) => c.text)).toEqual(['first\n\nsecond']);
  });

  it('packs paragraphs up to exactly the target size and no further', () => {
    const half = (CHUNK_TARGET_CHARS - 2) / 2;
    expect(chunkText(`${'a'.repeat(half)}\n\n${'b'.repeat(half)}`)).toHaveLength(1);
    expect(chunkText(`${'a'.repeat(half)}\n\n${'b'.repeat(half + 1)}`)).toHaveLength(2);
  });

  describe('splitting long text', () => {
    it('keeps text of exactly the hard maximum in one chunk', () => {
      expect(chunkText('x'.repeat(CHUNK_MAX_CHARS)).map((c) => c.text.length)).toEqual([CHUNK_MAX_CHARS]);
    });

    it('cuts right after the maximum when a space sits exactly there', () => {
      const chunks = chunkText(`${'a'.repeat(CHUNK_MAX_CHARS)} ${'b'.repeat(10)}`);
      expect(chunks.map((c) => c.text)).toEqual(['a'.repeat(CHUNK_MAX_CHARS), 'b'.repeat(10)]);
    });

    it('ignores a space in the first half and cuts at the maximum instead', () => {
      const half = CHUNK_MAX_CHARS / 2;
      const chunks = chunkText(`${'a'.repeat(half)} ${'b'.repeat(CHUNK_MAX_CHARS)}`);
      expect(chunks[0]!.text).toHaveLength(CHUNK_MAX_CHARS);
    });

    it('drops the whitespace at the end of a cut piece but keeps the words', () => {
      const chunks = chunkText(`${'a'.repeat(CHUNK_MAX_CHARS - 3)}   ${'b'.repeat(50)}`);
      expect(chunks.map((c) => c.text)).toEqual(['a'.repeat(CHUNK_MAX_CHARS - 3), 'b'.repeat(50)]);
    });
  });

  it('is deterministic', () => {
    const text = '# A\n\nfirst paragraph\n\nsecond paragraph\n\n# B\n\nthird';
    expect(chunkText(text)).toEqual(chunkText(text));
  });

  it('keeps the section of a split paragraph on every piece', () => {
    const chunks = chunkText(`# Long\n\n${'word '.repeat(300)}`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(new Set(chunks.map((c) => c.section))).toEqual(new Set(['Long']));
  });

  it('has sane constants', () => {
    expect(CHUNK_TARGET_CHARS).toBeLessThan(CHUNK_MAX_CHARS);
  });

  describe('properties', () => {
    const documents = fc.array(fc.oneof(fc.string({ maxLength: 700 }), fc.stringMatching(/^#{1,3} [a-z ]{1,30}$/)), { maxLength: 12 }).map((parts) => parts.join('\n\n'));

    it('loses no content: the non-space characters are exactly the normalized input', () => {
      fc.assert(
        fc.property(documents, (raw) => {
          const normalized = normalizeText(raw);
          return squash(chunkText(normalized).map((c) => c.text).join('')) === squash(normalized);
        }),
      );
    });

    it('never emits an empty or oversized chunk, and numbers chunks from zero without gaps', () => {
      fc.assert(
        fc.property(documents, (raw) => {
          const chunks = chunkText(normalizeText(raw));
          return chunks.every((c, index) => c.text.length > 0 && c.text.length <= CHUNK_MAX_CHARS && c.ordinal === index);
        }),
      );
    });
  });
});
