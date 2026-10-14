import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store, settingsSchema } from '../src/main/store';

test('settings and paused tasks survive a fresh store instance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gamenest-store-'));
  try {
    const store = new Store(directory, directory);
    store.saveSettings({ ...store.settings, secureDns: true, maxDownloads: 3 });
    store.downloads = [
      {
        id: randomUUID(),
        title: 'Fixture',
        source: `magnet:?xt=urn:btih:${'a'.repeat(40)}`,
        savePath: directory,
        image: '',
        createdAt: new Date().toISOString(),
        paused: true,
        priorities: { '0': 1 },
      },
    ];
    store.saveDownloads();
    const restored = new Store(directory, directory);
    assert.equal(restored.settings.secureDns, true);
    assert.equal(restored.settings.maxDownloads, 3);
    assert.equal(restored.downloads[0].paused, true);
    assert.equal(restored.downloads[0].priorities['0'], 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('corrupt task registry is preserved instead of silently overwritten', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gamenest-corrupt-'));
  try {
    const file = join(directory, 'downloads.json');
    writeFileSync(file, '{"broken":');
    assert.throws(() => new Store(directory, directory), /Giữ nguyên file/);
    assert.equal(readFileSync(file, 'utf8'), '{"broken":');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('settings reject unsupported proxies and excessive concurrency', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gamenest-validation-'));
  try {
    const settings = new Store(directory, directory).settings;
    assert.equal(settingsSchema.safeParse({ ...settings, maxDownloads: 99 }).success, false);
    assert.equal(
      settingsSchema.safeParse({ ...settings, proxyRules: 'http://user:pass@host:80' }).success,
      false,
    );
    assert.equal(
      settingsSchema.safeParse({ ...settings, proxyRules: 'socks5://127.0.0.1:7890' }).success,
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
