import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { _electron as electron } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const directory = mkdtempSync(join(tmpdir(), 'gamenest-desktop-'));
const screenshot = process.env.GAMENEST_SCREENSHOT || join(root, 'test-results', 'desktop.png');
mkdirSync(dirname(screenshot), { recursive: true });
let desktop;
const errors = [];
const launch = () =>
  electron.launch({
    args: [root],
    env: { ...process.env, GAMENEST_DATA_DIR: join(directory, 'profile') },
    timeout: 30000,
  });
try {
  desktop = await launch();
  let page = await desktop.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  const boot = await page.evaluate(() => window.gamenest.bootstrap());
  assert.equal(boot.downloads.engineReady, true, boot.downloads.engineError);
  const downloadPath = join(directory, 'payload');
  await page.evaluate(async (settings) => window.gamenest.saveSettings(settings), {
    ...boot.settings,
    downloadPath,
    closeToTray: false,
  });
  await page.locator('.game-card').first().waitFor({ timeout: 40000 });
  const cards = await page.locator('.game-card').count();
  assert.ok(cards > 0);
  await page.locator('.game-card .game-title').first().click();
  await page.getByRole('dialog', { name: 'Game details' }).waitFor({ timeout: 40000 });
  const detailText = await page.getByRole('dialog').textContent();
  assert.ok(detailText.includes('Download size'));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('.game-card .save-game').first().click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  assert.equal(await page.locator('.game-card').count(), 1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Game source connection' }).waitFor();
  await page.getByRole('button', { name: 'Discover', exact: true }).click();
  await page.locator('.hero').waitFor();
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.getByRole('textbox', { name: 'Search games' }).fill('Hollow Knight');
  await page
    .getByRole('heading', { name: 'Results for “Hollow Knight”' })
    .waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.locator('.hero').waitFor({ timeout: 10000 });
  const payload = Buffer.alloc(32768, 71);
  const original = join(directory, 'fixture.bin');
  const torrent = join(directory, 'fixture.torrent');
  writeFileSync(original, payload);
  const hash = createHash('sha1').update(payload).digest();
  writeFileSync(
    torrent,
    Buffer.concat([
      Buffer.from('d4:infod6:lengthi32768e4:name11:fixture.bin12:piece lengthi32768e6:pieces20:'),
      hash,
      Buffer.from('ee'),
    ]),
  );
  mkdirSync(downloadPath, { recursive: true });
  writeFileSync(join(downloadPath, 'fixture.bin'), payload);
  await desktop.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, torrent);
  const id = await page.evaluate(() => window.gamenest.importTorrent());
  assert.ok(id);
  await page.getByRole('button', { name: /^Downloads/ }).click();
  await page.locator('.download-item').waitFor();
  await page.waitForFunction(async (task) => (await window.gamenest.files(task)).length === 1, id);
  await page.evaluate((task) => window.gamenest.pauseDownload(task, true), id);
  await desktop.close();
  desktop = null;
  desktop = await launch();
  page = await desktop.firstWindow();
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  const restored = await page.evaluate(() => window.gamenest.bootstrap());
  assert.equal(restored.favorites.length, 1);
  assert.equal(restored.downloads.items[0].id, id);
  assert.equal(restored.downloads.items[0].paused, true);
  await page.evaluate((task) => window.gamenest.removeDownload(task), id);
  assert.deepEqual(readFileSync(join(downloadPath, 'fixture.bin')), payload);
  assert.equal(errors.length, 0, errors.join('\n'));
  process.stdout.write(
    `PASS: live catalog (${cards} games), details, search, favorites, settings, local torrent import, restart/resume, keep files on remove.\n`,
  );
} finally {
  if (desktop) await desktop.close();
  rmSync(directory, { recursive: true, force: true });
}
