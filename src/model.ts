export interface Entry {
  id: string;
  body: string;
  nextAction: string;
  createdAt: string;
}

export interface Settings {
  reminderEnabled: boolean;
  reminderTime: string;
  quickCaptureShortcut: string;
  launchAtStartup: boolean;
  startMinimized: boolean;
}

export const defaultShortcut = 'Ctrl+Alt+G';

export function shortcutFromKey(event: { code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  if (event.metaKey || (!event.ctrlKey && !event.altKey)) return null;
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit[0-9]$/.test(event.code) ? event.code.slice(5) : /^F([1-9]|1[0-9]|2[0-4])$/.test(event.code) ? event.code : null;
  if (!key) return null;
  const value = [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', key].filter(Boolean).join('+');
  return value === 'Alt+F4' ? null : value;
}

export type View = 'today' | 'all' | 'week';

export function validateEntry(body: string, nextAction: string): { body: string; nextAction: string } {
  const value = { body: body.trim(), nextAction: nextAction.trim() };
  if (!value.body) throw new Error('한 줄을 적어주세요.');
  if ([...value.body].length > 20000 || [...value.nextAction].length > 2000) {
    throw new Error('기록은 20,000자, 다음에 할 일은 2,000자까지 저장할 수 있어요.');
  }
  return value;
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function filterEntries(entries: Entry[], view: View, query: string, now = new Date()): Entry[] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (view === 'week') start.setDate(start.getDate() - 6);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const needle = query.trim().normalize('NFC').toLocaleLowerCase('ko-KR');
  return entries.filter(entry => {
    const date = new Date(entry.createdAt);
    const inRange = view === 'all' || (date >= start && date < tomorrow);
    const matches = `${entry.body}\n${entry.nextAction}`.normalize('NFC').toLocaleLowerCase('ko-KR').includes(needle);
    return inRange && matches;
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function toMarkdown(entries: Entry[]): string {
  return '# 나의 갈피\n\n' + entries.map(entry => {
    const date = new Date(entry.createdAt).toLocaleString('ko-KR');
    return `## ${date}\n\n${entry.body}\n${entry.nextAction ? `\n다음에 할 일: ${entry.nextAction}\n` : ''}`;
  }).join('\n---\n\n');
}
