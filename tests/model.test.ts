import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterEntries, localDateKey, toMarkdown, validateEntry, shortcutFromKey } from '../src/model.ts';

const now = new Date(2026, 9, 28, 12);
const entry = (id: string, day: number, body: string, nextAction = '') => ({ id, body, nextAction, createdAt: new Date(2026, 9, day, 14).toISOString() });
const entries = [entry('old', 21, '지난주'), entry('week', 22, '첫날'), entry('today', 28, '한글 기록', '로그인 수정'), entry('future', 29, '내일')];

test('today and seven-day view respect local midnight and exclude tomorrow', () => {
  assert.deepEqual(filterEntries(entries, 'today', '', now).map(e => e.id), ['today']);
  assert.deepEqual(filterEntries(entries, 'week', '', now).map(e => e.id), ['today', 'week']);
  assert.equal(localDateKey(new Date(2026, 0, 2)), '2026-01-02');
});
test('search finds next actions and normalizes Korean Unicode', () => {
  assert.equal(filterEntries(entries, 'all', '로그인', now)[0].id, 'today');
  assert.equal(filterEntries(entries, 'all', '한글'.normalize('NFD'), now)[0].id, 'today');
  assert.equal(filterEntries(entries, 'all', '없는 단어', now).length, 0);
});

test('a search spans all dates and clearing it restores the selected period', () => {
  assert.deepEqual(filterEntries(entries, 'today', '지난주', now).map(e => e.id), ['old']);
  assert.deepEqual(filterEntries(entries, 'week', '지난주', now).map(e => e.id), ['old']);
  assert.deepEqual(filterEntries(entries, 'today', '  ', now).map(e => e.id), ['today']);
  const previous = entry('previous-action', 21, '작업 기록', '다음 배포');
  assert.equal(filterEntries([previous], 'today', '배포', now)[0].id, previous.id);
});
test('markdown includes body and optional next action', () => {
  const markdown = toMarkdown([entry('one', 28, '본문\n두 줄', '다음')]);
  assert.ok(markdown.includes('본문\n두 줄'));
  assert.ok(markdown.includes('다음에 할 일: 다음'));
});

test('entry validation trims input and rejects blank or oversized content', () => {
  assert.deepEqual(validateEntry('  기록\n두 줄  ', ' 다음 '), { body: '기록\n두 줄', nextAction: '다음' });
  assert.throws(() => validateEntry(' \n ', ''), /한 줄/);
  assert.throws(() => validateEntry('가'.repeat(20001), ''), /20,000/);
  assert.throws(() => validateEntry('본문', '가'.repeat(2001)), /2,000/);
  assert.equal([...validateEntry('🌱'.repeat(20000), '').body].length, 20000);
});

test('shortcut capture uses physical keys for Korean layouts and requires modifiers', () => {
  const key = { code: 'KeyG', ctrlKey: true, altKey: true, shiftKey: false, metaKey: false };
  assert.equal(shortcutFromKey(key), 'Ctrl+Alt+G');
  assert.equal(shortcutFromKey({ ...key, code: 'Digit9', altKey: false, shiftKey: true }), 'Ctrl+Shift+9');
  assert.equal(shortcutFromKey({ ...key, code: 'F10', ctrlKey: false }), 'Alt+F10');
  assert.equal(shortcutFromKey({ ...key, ctrlKey: false, altKey: false }), null);
  assert.equal(shortcutFromKey({ ...key, metaKey: true }), null);
  assert.equal(shortcutFromKey({ ...key, ctrlKey: false, code: 'F4' }), null);
  assert.equal(shortcutFromKey({ ...key, code: 'Enter' }), null);
});
