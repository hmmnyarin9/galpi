import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchText } from '../src/search.ts';

test('highlights Korean normalization and case folding without breaking graphemes', () => {
  assert.deepEqual(searchText('한글 기록'.normalize('NFD'), '한글').parts, [
    { text: '한글', matched: true }, { text: ' 기록', matched: false },
  ]);
  assert.equal(searchText('İstanbul', 'i').parts[0].text, 'İ');
  assert.equal(searchText('👨‍👩‍👧‍👦 가족', '👩').parts[0].text, '👨‍👩‍👧‍👦');
});

test('excerpts center on a late match and full text remains available', () => {
  const body = '앞 문장. '.repeat(100) + '찾을 기록' + ' 뒤 문장.'.repeat(100);
  const result = searchText(body, '찾을');
  assert.equal(result.truncated, true);
  assert.equal(result.parts[0].text, '…');
  assert.equal(result.parts.at(-1)?.text, '…');
  assert.ok(result.parts.some(part => part.matched && part.text === '찾을'));
  assert.ok(result.parts.map(part => part.text).join('').length < 180);
  assert.equal(searchText(body, '찾을', false).parts.map(part => part.text).join(''), body);
  assert.equal(searchText(body, '').truncated, false);
});

test('HTML-like content remains plain data and all literal occurrences are marked', () => {
  const body = '<script>alert("a+b")</script> a+b';
  const result = searchText(body, 'a+b');
  assert.equal(result.parts.map(part => part.text).join(''), body);
  assert.equal(result.parts.filter(part => part.matched).length, 2);
  assert.equal(searchText('다음 할 일', '없는 말').parts[0].matched, false);
});
