import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Store, settingsSchema } from '../src/main/store';
import { translate } from '../src/shared/i18n';
import translations from '../src/shared/translations.json';

test('fresh and legacy settings default to English and Vietnamese persists after restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gamenest-language-'));
  try {
    const store = new Store(dir, dir);
    assert.equal(store.settings.language, 'en');
    const { language, ...legacy } = store.settings;
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(legacy));
    const migrated = new Store(dir, dir);
    assert.equal(migrated.settings.language, 'en');
    migrated.saveSettings({ ...migrated.settings, language: 'vi' });
    assert.equal(new Store(dir, dir).settings.language, 'vi');
    assert.equal(settingsSchema.safeParse({ ...migrated.settings, language: 'fr' }).success, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('all translations preserve interpolation placeholders in both languages', () => {
  for (const [vi, en] of Object.entries(translations)) {
    assert.ok(en.trim());
    assert.deepEqual(vi.match(/\{\d+\}/g) ?? [], en.match(/\{\d+\}/g) ?? [], vi);
    assert.equal(translate(vi), en);
    assert.equal(translate(vi, 'vi'), vi);
  }
});
test('dynamic source errors, IPC wrappers and validation issues are localized', () => {
  const error =
    "Error invoking remote method 'catalog:list': Error: Không đọc được FitGirl: Nguồn trả về HTTP 503. Kiểm tra mạng, DNS/WARP hoặc proxy trong Cài đặt.";
  assert.equal(
    translate(error),
    'Could not read FitGirl: The source returned HTTP 503. Check the network, DNS/WARP or proxy in Settings.',
  );
  const validation = JSON.stringify([
    { message: 'Proxy phải có dạng http://host:port hoặc socks5://host:port.' },
  ]);
  assert.equal(
    translate(validation),
    'Use a proxy address such as http://host:port or socks5://host:port.',
  );
  assert.equal(
    translate('Torrent metadata is not available yet', 'vi'),
    'Chưa có metadata của torrent',
  );
});
test('interpolation preserves source titles and paths, including dollar signs', () => {
  assert.equal(translate('Tải {0}', 'en', { 0: 'Đang tải $&' }), 'Download Đang tải $&');
  assert.equal(translate('Trang {0}', 'vi', { 0: 2 }), 'Trang 2');
  assert.equal(translate('Unknown OS error'), 'Unknown OS error');
});
