import './style.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { searchText } from './search';
import * as bridge from './bridge';
import { filterEntries, localDateKey, defaultShortcut, shortcutFromKey, type Entry, type Settings, type View } from './model';

document.documentElement.classList.toggle('native', bridge.native);

const bookmark = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4h10v16l-5-3-5 3V4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="app-bar" data-tauri-drag-region>
    <a class="brand" href="#" aria-label="갈피 홈">${bookmark}<span>갈피</span></a>
    <div class="drag-space" data-tauri-drag-region></div>
    <button id="settings-button" class="settings-button" title="설정" aria-label="설정"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m9.5 3-.6 2.2-1.4.8-2.2-.6-2.5 4.2 1.6 1.6v1.6l-1.6 1.6 2.5 4.2 2.2-.6 1.4.8.6 2.2h5l.6-2.2 1.4-.8 2.2.6 2.5-4.2-1.6-1.6v-1.6l1.6-1.6-2.5-4.2-2.2.6-1.4-.8-.6-2.2h-5Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg></button>
    <div class="window-controls" id="window-controls">
      <button id="toggle-popup" title="팝업 모드" aria-label="팝업 모드" aria-pressed="false"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M8 8h5.5v5.5H8z"/></svg></button>
      <button hidden id="minimize-window" title="최소화" aria-label="창 최소화"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10"/></svg></button>
      <button hidden id="close-window" title="트레이로 숨기기" aria-label="창 닫기 · 트레이로 숨기기"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg></button>
    </div>
  </header>
  <main>
    <div class="preview-banner" id="preview-banner" hidden>브라우저 미리보기 · 이 브라우저에 저장돼요.</div>
    <h1 class="sr-only">갈피 기록</h1>
    <div id="load-error" class="error-box" role="alert" hidden></div>
    <section class="composer" aria-label="새 기록" id="composer">
      <form id="entry-form"><label for="body" class="sr-only">새 기록</label>
      <textarea id="body" maxlength="20000" placeholder="지금 남겨둘 생각…" aria-describedby="save-hint" rows="3" required></textarea>
      <div id="next-action-wrap" hidden><label for="next-action">다음에 할 일 <span>선택</span></label><input id="next-action" maxlength="2000" placeholder="다시 시작할 나에게 작은 힌트를 남겨주세요." /></div>
      <div class="composer-footer"><button type="button" id="toggle-next" class="text-button" aria-expanded="false" aria-controls="next-action-wrap">＋ 다음 할 일</button><div class="save-group"><span id="draft-label" role="status"></span><span id="save-hint">Ctrl + Enter</span><button type="submit" id="save-button" class="primary" disabled>저장</button></div></div></form>
    </section>
    <section id="records-panel" class="records-section" aria-label="저장한 기록"><div class="records-toolbar"><nav aria-label="기록 기간"><button data-view="today" class="nav-button selected">오늘 <span class="count" id="today-count">0</span></button><button data-view="week" class="nav-button">7일</button><button data-view="all" class="nav-button">전체</button></nav><div class="search-tools"><label class="search"><input id="search" type="search" title="검색 (Ctrl+F)" aria-keyshortcuts="Control+f Meta+f" placeholder="검색" aria-label="기록 검색" /></label><button type="button" id="toggle-date-range" class="date-range-toggle" title="기간 지정" aria-label="날짜 범위 지정" aria-expanded="false" aria-pressed="false" aria-controls="date-range-panel"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 3v4m8-4v4M4 11h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></div></div><div id="date-range-panel" class="date-range-panel" hidden><label for="date-from">시작일<input id="date-from" type="date" /></label><label for="date-to">종료일<input id="date-to" type="date" /></label><button type="button" id="clear-date-range" class="secondary">기간 초기화</button><p id="date-error" class="date-error" role="alert" hidden>시작일이 종료일보다 늦어요. 날짜를 확인해주세요.</p></div><p id="search-status" class="search-status" role="status" hidden></p><h2 id="records-title" class="sr-only">오늘 기록 <span id="visible-count">0</span></h2><div id="records" aria-live="polite"></div></section>
  </main>
  <div id="popup-backdrop" data-tauri-drag-region aria-hidden="true"></div>
  <dialog id="settings-dialog" aria-labelledby="settings-title"><form id="settings-form"><div class="dialog-top"><h2 id="settings-title">설정</h2><button type="button" class="icon-button" id="close-settings" aria-label="설정 닫기">×</button></div><div class="setting-row"><div><label for="launch-at-startup">Windows 시작 시 실행</label><p>Windows에 로그인하면 갈피를 실행해요.</p></div><input type="checkbox" id="launch-at-startup" role="switch" /></div><div class="setting-row startup-child" id="start-minimized-row"><div><label for="start-minimized">최소화로 시작</label><p>창을 띄우지 않고 트레이에서 시작해요.</p></div><input type="checkbox" id="start-minimized" disabled /></div><div class="setting-row"><div><label for="reminder-enabled">하루 한 번, 기록 알림</label><p>앱이 실행 중일 때 정한 시간에 알려드려요.</p></div><input type="checkbox" id="reminder-enabled" role="switch" /></div><div class="setting-row"><label for="reminder-time">기록할 시간</label><input type="time" id="reminder-time" required /></div><p class="setting-note" id="reminder-note">Windows 알림 설정에 따라 알림이 표시되지 않을 수 있어요. 창을 닫아도 트레이에 남아 있고, 트레이 메뉴에서 종료할 수 있어요.</p><div class="shortcut-setting"><label for="shortcut-input">빠른 기록 단축키</label><div class="shortcut-input-row"><input id="shortcut-input" type="text" readonly aria-describedby="shortcut-note" aria-label="빠른 기록 단축키 · 선택 후 키 조합 입력" /><button type="button" id="reset-shortcut" class="secondary">기본값</button></div><p class="setting-note" id="shortcut-note">입력칸을 선택하고 Ctrl 또는 Alt와 영문·숫자·F키를 눌러주세요.</p></div><p class="error-box" id="settings-error" role="alert" hidden></p><button class="primary full-width" type="submit" id="settings-save">설정 저장</button><hr><div class="setting-row"><div><strong>기록 내보내기</strong><p>전체 기록을 JSON 파일로 저장해요.</p></div><button type="button" class="secondary" id="export-button">내보내기</button></div><p class="data-path" id="data-path"></p></form></dialog>
  <dialog id="delete-dialog" aria-labelledby="delete-title"><h2 id="delete-title">이 갈피를 삭제할까요?</h2><p class="dialog-description">삭제한 기록은 되돌릴 수 없어요.</p><div class="dialog-actions"><button class="secondary" id="cancel-delete">취소</button><button class="danger" id="confirm-delete">삭제하기</button></div></dialog>
  <dialog id="edit-dialog" aria-labelledby="edit-title"><form id="edit-form"><div class="dialog-top"><h2 id="edit-title">기록 수정</h2><button type="button" class="icon-button" id="close-edit" aria-label="편집 닫기">×</button></div><label class="edit-label" for="edit-body">기록</label><textarea id="edit-body" maxlength="20000" rows="6" required></textarea><label class="edit-label" for="edit-next">다음에 할 일 <span>선택</span></label><textarea id="edit-next" maxlength="2000" rows="2"></textarea><p class="error-box" id="edit-error" role="alert" hidden></p><div id="discard-edit" hidden><p class="setting-note">저장하지 않은 변경 사항이 있어요. 편집을 그만둘까요?</p><button type="button" class="secondary" id="keep-editing">계속 편집</button> <button type="button" class="secondary" id="discard-changes">변경 버리기</button></div><div class="dialog-actions edit-actions"><button type="button" class="secondary" id="cancel-edit">취소</button><button type="submit" class="primary" id="save-edit">수정 저장</button></div></form></dialog>
  <div class="toast" id="toast" role="status" hidden></div>
`;

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const body = $<HTMLTextAreaElement>('#body');
const nextAction = $<HTMLInputElement>('#next-action');
const saveButton = $<HTMLButtonElement>('#save-button');
const settingsDialog = $<HTMLDialogElement>('#settings-dialog');
const deleteDialog = $<HTMLDialogElement>('#delete-dialog');
const editDialog = $<HTMLDialogElement>('#edit-dialog');
const editBody = $<HTMLTextAreaElement>('#edit-body');
const editNext = $<HTMLTextAreaElement>('#edit-next');
let editingEntry: Entry | null = null;
let updating = false;
let entries: Entry[] = [];
let view: View = 'today';
let ready = false;
let saving = false;
let deletingId: string | null = null;
let toastTimeout: ReturnType<typeof setTimeout>;
let settings: Settings = { reminderEnabled: false, reminderTime: '18:00', quickCaptureShortcut: defaultShortcut, launchAtStartup: false, startMinimized: false };
let currentDay = localDateKey(new Date());
let popupMode = false;
let normalScrollY = 0;
let normalWindowSize = new LogicalSize(720, 720);
let popupWindowSize = new LogicalSize(656, 160);
let popupOffset = { x: 0, y: 0 };
let changingMode = false;

// Serialize native resize requests so rapid toggles finish in the latest mode.
let resizeQueue = Promise.resolve();
let resizeVersion = 0;
function syncWindowMode(position?: PhysicalPosition) {
  if (!bridge.native) return Promise.resolve();
  const size = popupMode ? popupWindowSize : normalWindowSize;
  const version = ++resizeVersion;
  resizeQueue = resizeQueue.then(async () => {
    if (version !== resizeVersion) return;
    await getCurrentWindow().setSize(size);
    if (position) await getCurrentWindow().setPosition(position);
  }).catch(error => message(`창 크기를 바꾸지 못했어요. ${errorText(error)}`));
  return resizeQueue;
}

let modeTransition = Promise.resolve();
function setPopupMode(enabled: boolean): Promise<void> {
  const transition = modeTransition.catch(() => {}).then(async () => {
    if (popupMode === enabled) return;
    changingMode = true;
    try {
      await resizeQueue;
      const geometry = bridge.native ? await Promise.all([
        getCurrentWindow().outerPosition(), getCurrentWindow().scaleFactor(),
      ]) : null;
      if (!popupMode) {
        normalScrollY = window.scrollY;
        normalWindowSize = new LogicalSize(window.innerWidth, window.innerHeight);
        const inputBounds = $('#composer').getBoundingClientRect();
        popupWindowSize = new LogicalSize(inputBounds.width, inputBounds.height);
        popupOffset = { x: inputBounds.left, y: inputBounds.top };
      }
      // DOM offsets use CSS pixels; native desktop positions use physical pixels.
      // Reverse the offset from the current popup position, including after a move.
      const direction = popupMode ? -1 : 1;
      const position = geometry ? new PhysicalPosition(
        Math.round(geometry[0].x + direction * popupOffset.x * geometry[1]),
        Math.round(geometry[0].y + direction * popupOffset.y * geometry[1]),
      ) : undefined;
      popupMode = enabled;
      document.documentElement.classList.toggle('popup-mode', popupMode);
      const button = $('#toggle-popup');
      button.setAttribute('aria-pressed', String(popupMode));
      button.setAttribute('aria-label', popupMode ? '일반 모드로 복원' : '팝업 모드');
      button.title = popupMode ? '일반 모드로 복원' : '팝업 모드';
      if (popupMode) {
        window.scrollTo(0, 0);
        body.focus({ preventScroll: true });
      } else {
        button.focus({ preventScroll: true });
      }
      await syncWindowMode(position);
      if (!popupMode) window.scrollTo(0, normalScrollY);
    } finally {
      changingMode = false;
      syncPopupHeight();
    }
  });
  modeTransition = transition;
  return transition;
}
$('#toggle-popup').addEventListener('click', () => {
  if (changingMode) return;
  void setPopupMode(!popupMode).catch(error => message(`창 위치를 바꾸지 못했어요. ${errorText(error)}`));
});

// The optional next-action field changes the composer height in popup mode.
function syncPopupHeight() {
  if (!popupMode || changingMode) return;
  const height = $('#composer').getBoundingClientRect().height;
  if (Math.abs(height - popupWindowSize.height) < .5) return;
  popupWindowSize = new LogicalSize(popupWindowSize.width, height);
  void syncWindowMode();
}
new ResizeObserver(syncPopupHeight).observe($('#composer'));

function message(text: string) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { $('#toast').hidden = true; }, 4200);
}

function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }

function writeRecordText(target: HTMLElement, value: string, query: string, excerpt = true): boolean {
  const result = searchText(value, query, excerpt);
  target.replaceChildren(...result.parts.map(part => {
    if (!part.matched) return document.createTextNode(part.text);
    const mark = document.createElement('mark');
    mark.textContent = part.text;
    return mark;
  }));
  return result.truncated;
}

function updateDraft() {
  saveButton.disabled = !ready || saving || !body.value.trim();
  try {
    localStorage.setItem('galpi-draft', JSON.stringify({ body: body.value, nextAction: nextAction.value }));
    $('#draft-label').textContent = body.value || nextAction.value ? '초안 보관됨' : '';
  } catch { $('#draft-label').textContent = '임시 보관 불가 · 저장 버튼으로 남겨주세요'; }
}

function focusComposer() {
  if (editDialog.open) { editBody.focus(); return; }
  if (settingsDialog.open) settingsDialog.close();
  if (deleteDialog.open) deleteDialog.close();
  $('#composer').scrollIntoView({ behavior: 'smooth', block: 'center' });
  body.focus({ preventScroll: true });
}

function render() {
  const query = $<HTMLInputElement>('#search').value;
  const searching = !!query.trim();
  const from = $<HTMLInputElement>('#date-from').value;
  const to = $<HTMLInputElement>('#date-to').value;
  const customPeriod = !!from || !!to;
  const effectiveView = customPeriod ? 'range' : searching ? 'all' : view;
  const filtered = filterEntries(entries, view, query, new Date(), { from, to });
  $('#date-error').hidden = !(from && to && from > to);
  $<HTMLInputElement>('#date-from').max = to;
  $<HTMLInputElement>('#date-to').min = from;
  $('#toggle-date-range').setAttribute('aria-pressed', String(customPeriod));
  $('#search-status').hidden = !searching && !customPeriod;
  $('#search-status').textContent = customPeriod ? `${from || '처음'} ~ ${to || '끝'} · ${searching ? '검색 ' : ''}${filtered.length}개` : `전체 기록 검색 · ${filtered.length}개`;
  $('#today-count').textContent = String(filterEntries(entries, 'today', '').length);
  $('#visible-count').textContent = String(filtered.length);
  const titles = { today: '오늘 남긴 갈피', all: '차곡차곡 쌓인 갈피', week: '지난 7일의 갈피' };
  $('#records-title').firstChild!.textContent = `${searching ? '검색 결과' : customPeriod ? '기간별 기록' : titles[view]} `;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => {
    button.classList.toggle('selected', button.dataset.view === effectiveView);
    button.setAttribute('aria-current', button.dataset.view === effectiveView ? 'page' : 'false');
  });
  const records = $('#records');
  records.replaceChildren();
  if (!filtered.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<h3></h3><p></p>';
    empty.querySelector('h3')!.textContent = !ready ? '기록을 불러오고 있어요.' : searching ? '일치하는 갈피가 없어요.' : customPeriod ? '이 기간의 기록이 없어요.' : '아직 기록이 없어요.';
    empty.querySelector('p')!.textContent = !ready ? '잠시만 기다려주세요.' : searching || customPeriod ? '다른 단어나 기간으로 찾아보세요.' : '위에 한 줄 남겨보세요.';
    records.append(empty);
    return;
  }
  let previousDay = '';
  for (const entry of filtered) {
    const date = new Date(entry.createdAt);
    const day = localDateKey(date);
    if (effectiveView !== 'today' && previousDay !== day) {
      const heading = document.createElement('h3');
      heading.className = 'day-heading';
      heading.textContent = date.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
      records.append(heading);
      previousDay = day;
    }
    const article = document.createElement('article');
    article.className = 'record';
    const time = document.createElement('time');
    time.dateTime = entry.createdAt;
    time.textContent = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const content = document.createElement('div');
    content.className = 'record-content';
    const text = document.createElement('p');
    text.className = 'record-body';
    let truncated = writeRecordText(text, entry.body, query);
    content.append(text);
    let actionText: HTMLParagraphElement | undefined;
    if (entry.nextAction) {
      const next = document.createElement('div');
      next.className = 'record-next';
      const label = document.createElement('span');
      label.textContent = '↳ 다음에는';
      const action = document.createElement('p');
      truncated = writeRecordText(action, entry.nextAction, query) || truncated;
      actionText = action;
      next.append(label, action);
      content.append(next);
    }
    if (searching && truncated) {
      let expanded = false;
      const expand = document.createElement('button');
      expand.className = 'record-expand';
      expand.textContent = '전체 보기';
      expand.setAttribute('aria-expanded', 'false');
      expand.addEventListener('click', () => {
        expanded = !expanded;
        writeRecordText(text, entry.body, query, !expanded);
        if (actionText) writeRecordText(actionText, entry.nextAction, query, !expanded);
        expand.textContent = expanded ? '접기' : '전체 보기';
        expand.setAttribute('aria-expanded', String(expanded));
      });
      content.append(expand);
    }
    const actions = document.createElement('div');
    actions.className = 'record-actions';
    const edit = document.createElement('button');
    edit.className = 'edit-button';
    edit.textContent = '수정';
    edit.setAttribute('aria-label', `${entry.body.slice(0, 20)} 기록 수정`);
    edit.addEventListener('click', () => {
      editingEntry = entry;
      editBody.value = entry.body;
      editNext.value = entry.nextAction;
      $('#edit-error').hidden = true;
      $('#discard-edit').hidden = true;
      updateEditButton();
      editDialog.showModal();
      editBody.focus();
    });
    const remove = document.createElement('button');
    remove.className = 'delete-button';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `${entry.body.slice(0, 20)} 기록 삭제`);
    remove.addEventListener('click', () => { deletingId = entry.id; deleteDialog.showModal(); });
    actions.append(edit, remove);
    article.append(time, content, actions);
    records.append(article);
  }
}

$('#entry-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!ready || saving || !body.value.trim()) return;
  saving = true;
  body.readOnly = true;
  nextAction.readOnly = true;
  updateDraft();
  saveButton.textContent = '남기는 중…';
  try {
    const entry = await bridge.saveEntry(body.value, nextAction.value);
    entries.unshift(entry);
    body.value = '';
    nextAction.value = '';
    $('#next-action-wrap').hidden = true;
    $('#toggle-next').setAttribute('aria-expanded', 'false');
    view = 'today';
    $<HTMLInputElement>('#search').value = '';
    render();
    message('저장했어요.');
  } catch (error) { message(`저장하지 못했어요. ${errorText(error)}`); }
  finally { saving = false; body.readOnly = false; nextAction.readOnly = false; saveButton.textContent = '저장'; updateDraft(); body.focus(); }
});

function editIsDirty() {
  return editingEntry !== null && (editBody.value !== editingEntry.body || editNext.value !== editingEntry.nextAction);
}

function updateEditButton() {
  $<HTMLButtonElement>('#save-edit').disabled = updating || !editBody.value.trim() || !editIsDirty();
}

function requestEditClose() {
  if (updating) return;
  if (editIsDirty()) {
    $('#discard-edit').hidden = false;
    $('#keep-editing').focus();
  } else { editDialog.close(); }
}

editDialog.addEventListener('cancel', event => { event.preventDefault(); requestEditClose(); });
editDialog.addEventListener('close', () => { editingEntry = null; });
$('#close-edit').addEventListener('click', requestEditClose);
$('#cancel-edit').addEventListener('click', requestEditClose);
$('#discard-changes').addEventListener('click', () => { if (!updating) editDialog.close(); });
$('#keep-editing').addEventListener('click', () => { $('#discard-edit').hidden = true; editBody.focus(); });
for (const field of [editBody, editNext]) field.addEventListener('input', () => {
  $('#discard-edit').hidden = true;
  $('#edit-error').hidden = true;
  updateEditButton();
});
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!editingEntry || updating || !editBody.value.trim() || !editIsDirty()) return;
  updating = true;
  editBody.readOnly = true;
  editNext.readOnly = true;
  $('#discard-edit').hidden = true;
  updateEditButton();
  $('#save-edit').textContent = '저장하는 중…';
  try {
    const updated = await bridge.updateEntry(editingEntry.id, editBody.value, editNext.value);
    entries = entries.map(entry => entry.id === updated.id ? updated : entry);
    render();
    editDialog.close();
    message('갈피를 수정했어요.');
  } catch (error) {
    $('#edit-error').textContent = `수정하지 못했어요. ${errorText(error)}`;
    $('#edit-error').hidden = false;
  } finally {
    updating = false;
    editBody.readOnly = false;
    editNext.readOnly = false;
    $('#save-edit').textContent = '수정 저장';
    updateEditButton();
  }
});

body.addEventListener('input', updateDraft);
nextAction.addEventListener('input', updateDraft);
$('#toggle-next').addEventListener('click', () => {
  const wrap = $('#next-action-wrap');
  wrap.hidden = !wrap.hidden;
  $('#toggle-next').setAttribute('aria-expanded', String(!wrap.hidden));
  if (!wrap.hidden) nextAction.focus();
});
$('.brand').addEventListener('click', event => { event.preventDefault(); view = 'today'; render(); focusComposer(); });
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => {
  view = button.dataset.view as View;
  $<HTMLInputElement>('#date-from').value = '';
  $<HTMLInputElement>('#date-to').value = '';
  render();
}));
$('#search').addEventListener('input', render);
$('#toggle-date-range').addEventListener('click', () => {
  const panel = $('#date-range-panel');
  panel.hidden = !panel.hidden;
  $('#toggle-date-range').setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) $('#date-from').focus();
});
$('#date-from').addEventListener('input', render);
$('#date-to').addEventListener('input', render);
$('#clear-date-range').addEventListener('click', () => {
  $<HTMLInputElement>('#date-from').value = '';
  $<HTMLInputElement>('#date-to').value = '';
  render();
  $('#date-from').focus();
});

async function focusSearch() {
  await setPopupMode(false);
  $('#records-panel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  const search = $<HTMLInputElement>('#search');
  search.focus({ preventScroll: true });
  search.select();
}

document.addEventListener('keydown', event => {
  if (event.isComposing) return;
  const modalOpen = [settingsDialog, editDialog, deleteDialog].some(dialog => dialog.open);
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !modalOpen) {
    event.preventDefault();
    void focusSearch().catch(error => message(`검색을 열지 못했어요. ${errorText(error)}`));
    return;
  }
  const search = $<HTMLInputElement>('#search');
  if (event.key === 'Escape' && document.activeElement === search && search.value && !modalOpen) {
    event.preventDefault();
    search.value = '';
    render();
    return;
  }
  if (editDialog.open) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      $<HTMLFormElement>('#edit-form').requestSubmit();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !settingsDialog.open && !deleteDialog.open) {
    event.preventDefault();
    $<HTMLFormElement>('#entry-form').requestSubmit();
  }
  if (event.key === 'Escape' && !settingsDialog.open && !deleteDialog.open && bridge.native) {
    void invoke('hide_window').catch(error => message(errorText(error)));
  }
});

function syncStartupControls() {
  $<HTMLInputElement>('#launch-at-startup').disabled = !bridge.native;
  const disabled = !bridge.native || !$<HTMLInputElement>('#launch-at-startup').checked;
  $<HTMLInputElement>('#start-minimized').disabled = disabled;
  $('#start-minimized-row').classList.toggle('disabled', disabled);
}
$('#launch-at-startup').addEventListener('change', syncStartupControls);

async function openSettings() {
  await setPopupMode(false);
  if (settingsDialog.open) return;
  $<HTMLInputElement>('#launch-at-startup').checked = settings.launchAtStartup;
  $<HTMLInputElement>('#start-minimized').checked = settings.startMinimized;
  syncStartupControls();
  $<HTMLInputElement>('#reminder-enabled').checked = settings.reminderEnabled;
  $<HTMLInputElement>('#reminder-time').value = settings.reminderTime;
  $<HTMLInputElement>('#shortcut-input').value = settings.quickCaptureShortcut;
  $('#settings-error').hidden = true;
  settingsDialog.showModal();
}
$('#settings-button').addEventListener('click', () => {
  void openSettings().catch(error => message(`설정을 열지 못했어요. ${errorText(error)}`));
});
$('#shortcut-input').addEventListener('keydown', event => {
  const key = event as KeyboardEvent;
  if (key.key === 'Tab' || key.key === 'Escape') return;
  key.preventDefault();
  key.stopPropagation();
  if (key.repeat || key.isComposing) return;
  const value = shortcutFromKey(key);
  if (value) {
    $<HTMLInputElement>('#shortcut-input').value = value;
    $('#settings-error').hidden = true;
  } else if (!['Control', 'Alt', 'Shift'].includes(key.key)) {
    $('#settings-error').textContent = 'Ctrl 또는 Alt와 영문·숫자·F키를 조합해주세요. Alt+F4는 사용할 수 없어요.';
    $('#settings-error').hidden = false;
  }
});
$('#reset-shortcut').addEventListener('click', () => {
  $<HTMLInputElement>('#shortcut-input').value = defaultShortcut;
  $('#settings-error').hidden = true;
});
$('#close-settings').addEventListener('click', () => settingsDialog.close());
$('#settings-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $<HTMLButtonElement>('#settings-save');
  if (button.disabled) return;
  button.disabled = true;
  const next = { reminderEnabled: $<HTMLInputElement>('#reminder-enabled').checked, reminderTime: $<HTMLInputElement>('#reminder-time').value, quickCaptureShortcut: $<HTMLInputElement>('#shortcut-input').value, launchAtStartup: $<HTMLInputElement>('#launch-at-startup').checked, startMinimized: $<HTMLInputElement>('#start-minimized').checked };
  try {
    await bridge.setSettings(next);
    settings = next;
    if (bridge.native) $('#shortcut-note').textContent = '입력칸을 선택하고 Ctrl 또는 Alt와 영문·숫자·F키를 눌러주세요.';
    settingsDialog.close();
    message('설정을 저장했어요.');
  }
  catch (error) { $('#settings-error').textContent = `설정을 저장하지 못했어요. ${errorText(error)}`; $('#settings-error').hidden = false; }
  finally { button.disabled = false; }
});
$('#export-button').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('#export-button');
  button.disabled = true;
  try { if (await bridge.exportEntries()) message('기록을 내보냈어요.'); }
  catch (error) { message(`내보내지 못했어요. ${errorText(error)}`); }
  finally { button.disabled = false; }
});
$('#cancel-delete').addEventListener('click', () => deleteDialog.close());
$('#confirm-delete').addEventListener('click', async () => {
  const id = deletingId;
  if (!id) return;
  const button = $<HTMLButtonElement>('#confirm-delete');
  button.disabled = true;
  try { await bridge.deleteEntry(id); entries = entries.filter(entry => entry.id !== id); render(); deleteDialog.close(); message('기록을 삭제했어요.'); }
  catch (error) { message(`삭제하지 못했어요. ${errorText(error)}`); }
  finally { button.disabled = false; }
});

if (bridge.native) {
  $('#minimize-window').hidden = false;
  $('#close-window').hidden = false;
  const appWindow = getCurrentWindow();
  $('#minimize-window').addEventListener('click', () => { void appWindow.minimize().catch(error => message(errorText(error))); });
  $('#close-window').addEventListener('click', () => { void appWindow.close().catch(error => message(errorText(error))); });
}

async function start() {
  try {
    const draft = JSON.parse(localStorage.getItem('galpi-draft') || '{}');
    if (typeof draft.body === 'string') body.value = draft.body;
    if (typeof draft.nextAction === 'string') nextAction.value = draft.nextAction;
    $('#next-action-wrap').hidden = !nextAction.value;
    $('#toggle-next').setAttribute('aria-expanded', String(!!nextAction.value));
  } catch { message('임시 기록을 불러오지 못했어요. 저장된 기록은 그대로 보관돼요.'); }
  try {
    [entries, settings] = await Promise.all([bridge.listEntries(), bridge.getSettings()]);
    ready = true;
    if (bridge.native) {
      const info = await invoke<{ shortcutError: string | null; dataPath: string }>('runtime_info');
      $('#data-path').textContent = `저장 위치: ${info.dataPath}`;
      if (info.shortcutError) {
        $('#shortcut-note').textContent = `${settings.quickCaptureShortcut}를 등록하지 못했어요. 다른 조합으로 바꾸거나 기본값을 다시 저장해주세요.`;
        message('빠른 기록 단축키를 등록하지 못했어요. 설정에서 안내를 확인해주세요.');
      }
      await listen('open-settings', () => {
        void openSettings().catch(error => message(`설정을 열지 못했어요. ${errorText(error)}`));
      });
      await listen('quick-capture', () => { if (!settingsDialog.open) focusComposer(); });
      await listen('reminder', () => message('오늘 남겨두고 싶은 일이 있나요? 한 줄이면 충분해요.'));
      await listen('reminder-error', () => message('Windows 알림을 보내지 못했어요. 시스템 알림 설정을 확인해주세요.'));
    } else {
      $('#preview-banner').hidden = false;
      syncStartupControls();
      $<HTMLInputElement>('#reminder-enabled').disabled = true;
      $('#reminder-note').textContent = '브라우저 미리보기에서는 Windows 알림을 보낼 수 없어요.';
      $('#shortcut-note').textContent = '브라우저에서는 조합을 보관하며, 전역 단축키는 Windows 앱에서 작동해요.';
    }
  } catch (error) {
    const box = $('#load-error');
    box.hidden = false;
    box.textContent = `기록을 불러오지 못했어요. 앱을 다시 열어주세요. ${errorText(error)}`;
    ready = false;
  }
  updateDraft();
  render();
}

setInterval(() => {
  const day = localDateKey(new Date());
  if (day !== currentDay) { currentDay = day; render(); }
}, 30000);
void start();
