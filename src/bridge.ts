import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Entry, Settings } from './model';
import { validateEntry, defaultShortcut } from './model';

export const native = isTauri();
const previewKey = 'galpi-preview-v1';
interface PreviewData { entries: Entry[]; settings: Settings }

function readPreview(): PreviewData {
  const stored = localStorage.getItem(previewKey);
  if (!stored) return { entries: [], settings: { reminderEnabled: false, reminderTime: '18:00', quickCaptureShortcut: defaultShortcut, launchAtStartup: false, startMinimized: false } };
  const value: unknown = JSON.parse(stored);
  if (!value || typeof value !== 'object' || !('entries' in value) || !Array.isArray(value.entries)) {
    throw new Error('미리보기 데이터를 읽지 못했어요. 브라우저 저장소를 확인해주세요.');
  }
  const data = value as PreviewData;
  return { ...data, settings: { ...data.settings, quickCaptureShortcut: data.settings.quickCaptureShortcut ?? defaultShortcut, launchAtStartup: data.settings.launchAtStartup ?? false, startMinimized: data.settings.startMinimized ?? false } };
}

function writePreview(value: PreviewData) { localStorage.setItem(previewKey, JSON.stringify(value)); }

export async function listEntries(): Promise<Entry[]> {
  return native ? invoke('list_entries') : readPreview().entries;
}

export async function saveEntry(body: string, nextAction: string): Promise<Entry> {
  ({ body, nextAction } = validateEntry(body, nextAction));
  if (native) return invoke('save_entry', { body, nextAction });
  const data = readPreview();
  const entry = { id: crypto.randomUUID(), body: body.trim(), nextAction: nextAction.trim(), createdAt: new Date().toISOString() };
  data.entries.unshift(entry);
  writePreview(data);
  return entry;
}

export async function updateEntry(id: string, body: string, nextAction: string): Promise<Entry> {
  ({ body, nextAction } = validateEntry(body, nextAction));
  if (native) return invoke('update_entry', { id, body, nextAction });
  const data = readPreview();
  const index = data.entries.findIndex(entry => entry.id === id);
  if (index < 0) throw new Error('기록을 찾지 못했어요. 목록을 다시 불러와주세요.');
  const entry = { ...data.entries[index], body, nextAction };
  data.entries[index] = entry;
  writePreview(data);
  return entry;
}

export async function deleteEntry(id: string): Promise<void> {
  if (native) return invoke('delete_entry', { id });
  const data = readPreview();
  data.entries = data.entries.filter(entry => entry.id !== id);
  writePreview(data);
}

export async function getSettings(): Promise<Settings> {
  return native ? invoke('get_settings') : readPreview().settings;
}

export async function setSettings(settings: Settings): Promise<void> {
  if (native) return invoke('set_settings', { settings });
  const data = readPreview();
  data.settings = settings;
  writePreview(data);
}

export async function exportEntries(): Promise<boolean> {
  if (native) return invoke('export_entries');
  const url = URL.createObjectURL(new Blob([JSON.stringify(readPreview().entries, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'galpi-preview-backup.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
