export interface SearchPart { text: string; matched: boolean }

// Map case-folded matches back to whole graphemes so Korean normalization,
// emoji and case conversions that change string length keep valid boundaries.
export function searchText(value: string, query: string, excerpt = true): { parts: SearchPart[]; truncated: boolean } {
  const text = value.normalize('NFC');
  const needle = query.trim().normalize('NFC').toLocaleLowerCase('ko-KR');
  if (!needle) return { parts: [{ text, matched: false }], truncated: false };
  const segments = [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text)];
  const positions: { start: number; end: number }[] = [];
  let folded = '';
  for (const segment of segments) {
    const lower = segment.segment.toLocaleLowerCase('ko-KR');
    folded += lower;
    for (let i = 0; i < lower.length; i++) positions.push({ start: segment.index, end: segment.index + segment.segment.length });
  }
  const ranges: { start: number; end: number }[] = [];
  for (let index = folded.indexOf(needle); index >= 0; index = folded.indexOf(needle, index + needle.length)) {
    const range = { start: positions[index].start, end: positions[index + needle.length - 1].end };
    const previous = ranges.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else ranges.push(range);
  }
  const boundaries = [...segments.map(segment => segment.index), text.length];
  const rawStart = excerpt ? Math.max(0, (ranges[0]?.start ?? 0) - 48) : 0;
  const start = boundaries.filter(index => index <= rawStart).at(-1) ?? 0;
  const rawEnd = excerpt ? Math.min(text.length, Math.max(start + 160, ranges[0]?.end ?? 0)) : text.length;
  const end = boundaries.find(index => index >= rawEnd) ?? text.length;
  const parts: SearchPart[] = [];
  if (start) parts.push({ text: '…', matched: false });
  let cursor = start;
  for (const range of ranges) {
    if (range.end <= start || range.start >= end) continue;
    if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start), matched: false });
    parts.push({ text: text.slice(Math.max(cursor, range.start), Math.min(end, range.end)), matched: true });
    cursor = Math.min(end, range.end);
  }
  if (cursor < end) parts.push({ text: text.slice(cursor, end), matched: false });
  if (end < text.length) parts.push({ text: '…', matched: false });
  return { parts, truncated: start > 0 || end < text.length };
}
