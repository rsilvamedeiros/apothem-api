export const MAX_QUERY_TERMS = 12;
export const MAX_TERM_LENGTH = 40;
const MIN_TERM_LENGTH = 2;

/**
 * Turns free text, from a person or from model output, into plain search
 * terms. Only letters and digits survive, so nothing in the query can be read
 * as a full-text operator (ADR-014). Terms are lowercased, de-duplicated and
 * capped in number and length.
 */
export function toSearchTerms(query: string): string[] {
  const matches = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const match of matches) {
    const characters = Array.from(match);
    if (characters.length < MIN_TERM_LENGTH) continue;
    const term = characters.slice(0, MAX_TERM_LENGTH).join('');
    if (seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length === MAX_QUERY_TERMS) break;
  }
  return terms;
}
