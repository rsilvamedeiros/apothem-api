/**
 * Deterministic, format-aware chunking for knowledge documents (ADR-014).
 * Chunks are derived data: the stored document stays authoritative, and the
 * version below is recorded so an index can be rebuilt after a change.
 */
export const CHUNKER_VERSION = 'paragraph-v1';
export const CHUNK_TARGET_CHARS = 400;
export const CHUNK_MAX_CHARS = 500;
export const MAX_SECTION_LENGTH = 120;

export interface Chunk {
  readonly ordinal: number;
  readonly text: string;
  /** The nearest Markdown heading above the chunk, when there is one. */
  readonly section: string | null;
}

// Control characters (except tab and newline), zero width characters and
// bidirectional overrides: none carry meaning and several can hide text.
// eslint-disable-next-line no-control-regex, no-irregular-whitespace -- matching these characters is the whole point
const INVISIBLE =/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁤﻿]/g;
const HEADING = /^#{1,6}\s+(\S.*)$/;

export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLE, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function headingOf(unit: string): string | undefined {
  const firstLine = unit.split('\n', 1)[0] ?? '';
  const match = HEADING.exec(firstLine);
  return match?.[1] === undefined ? undefined : match[1].trim().slice(0, MAX_SECTION_LENGTH);
}

/** Cuts text longer than the hard maximum at whitespace when possible, otherwise in the middle of a token. */
function splitLong(unit: string): string[] {
  const pieces: string[] = [];
  let rest = unit;
  while (rest.length > CHUNK_MAX_CHARS) {
    const window = rest.slice(0, CHUNK_MAX_CHARS + 1);
    let cut = CHUNK_MAX_CHARS;
    for (let index = window.length - 1; index > CHUNK_MAX_CHARS / 2; index -= 1) {
      if (/\s/.test(window.charAt(index))) {
        cut = index;
        break;
      }
    }
    pieces.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}

/**
 * Keeps paragraphs together up to the target size, never lets a chunk span
 * two sections and never emits one above the hard maximum. Expects text that
 * went through `normalizeText`.
 */
export function chunkText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  let section: string | null = null;
  let current = '';
  let currentSection: string | null = null;

  const flush = () => {
    if (current.length > 0) {
      chunks.push({ ordinal: chunks.length, text: current, section: currentSection });
    }
    current = '';
  };

  for (const unit of text.split(/\n{2,}/)) {
    const trimmed = unit.trim();
    if (trimmed.length === 0) continue;

    const heading = headingOf(trimmed);
    if (heading !== undefined) {
      flush();
      section = heading;
    }

    for (const piece of splitLong(trimmed)) {
      if (current.length > 0 && current.length + 2 + piece.length <= CHUNK_TARGET_CHARS) {
        current = `${current}\n\n${piece}`;
      } else {
        flush();
        current = piece;
        currentSection = section;
      }
    }
  }
  flush();
  return chunks;
}
