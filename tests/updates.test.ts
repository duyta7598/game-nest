import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { DesktopUpdates, type UpdateDriver, updateDisabledReason } from '../src/main/updates';

class Driver extends EventEmitter implements UpdateDriver {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  checks = 0;
  downloads = 0;
  installed = false;
  checkAction: () => Promise<unknown> = async () => {
    this.emit('update-available', { version: '0.4.0', releaseNotes: 'New release' });
  };
  downloadAction: () => Promise<unknown> = async () => {
    this.emit('download-progress', { percent: 45, transferred: 45, total: 100 });
    this.emit('update-downloaded', { version: '0.4.0' });
  };
  async checkForUpdates() {
    this.checks++;
    return this.checkAction();
  }
  async downloadUpdate() {
    this.downloads++;
    return this.downloadAction();
  }
  quitAndInstall() {
    this.installed = true;
  }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
test('update gates reject development, unsupported platforms and unsigned Mac builds', async () => {
  assert.match(updateDisabledReason(false, 'darwin', true, true) ?? '', /installed/);
  assert.match(updateDisabledReason(true, 'linux', true, true) ?? '', /platform/);
  assert.match(updateDisabledReason(true, 'darwin', true, false) ?? '', /signed/);
  assert.match(updateDisabledReason(true, 'win32', false, true) ?? '', /source/);
  assert.equal(updateDisabledReason(true, 'win32', true, false), undefined);
  const driver = new Driver(),
    updates = new DesktopUpdates(
      driver,
      '0.3.0',
      () => {},
      () => false,
      'disabled',
    );
  await updates.check();
  assert.equal(driver.checks, 0);
  assert.equal(driver.autoInstallOnAppQuit, false);
  await assert.rejects(
    updates.install(async () => {}),
    /Download/,
  );
});
test('checks coalesce, download automatically, and install only after explicit shutdown', async () => {
  const driver = new Driver(),
    phases: string[] = [],
    updates = new DesktopUpdates(
      driver,
      '0.3.0',
      (value) => phases.push(value.phase),
      () => false,
    );
  await Promise.all([updates.check(), updates.check()]);
  await tick();
  assert.equal(driver.checks, 1);
  assert.equal(driver.downloads, 1);
  assert.equal(updates.status().phase, 'ready');
  assert.ok(phases.includes('checking'));
  assert.ok(phases.includes('downloading'));
  assert.equal(driver.installed, false);
  assert.equal(driver.allowDowngrade, false);
  assert.equal(driver.allowPrerelease, false);
  await updates.check();
  assert.equal(driver.checks, 1);
  let prepared = false;
  await updates.install(async () => {
    assert.equal(driver.installed, false);
    prepared = true;
  });
  assert.equal(prepared, true);
  assert.equal(driver.installed, true);
  await assert.rejects(
    updates.install(async () => {}),
    /Download/,
  );
});
test('active downloads block installing without stopping the app', async () => {
  const driver = new Driver();
  let busy = true,
    prepared = false;
  const updates = new DesktopUpdates(
    driver,
    '0.3.0',
    () => {},
    () => busy,
  );
  await updates.check();
  await tick();
  await assert.rejects(
    updates.install(async () => {
      prepared = true;
    }),
    /Pause active downloads/,
  );
  assert.equal(prepared, false);
  assert.equal(driver.installed, false);
  assert.equal(updates.status().phase, 'ready');
  busy = false;
  await updates.install(async () => {});
  assert.equal(driver.installed, true);
});
test('failed downloads can retry and failed preparation does not start the installer', async () => {
  const driver = new Driver(),
    updates = new DesktopUpdates(
      driver,
      '0.3.0',
      () => {},
      () => false,
    );
  driver.downloadAction = async () => {
    throw new Error('network unavailable');
  };
  await updates.check();
  await tick();
  assert.equal(updates.status().phase, 'error');
  assert.match(updates.status().error ?? '', /network/);
  driver.downloadAction = async () => {
    driver.emit('update-downloaded', { version: '0.4.0' });
  };
  await updates.check();
  await tick();
  assert.equal(updates.status().phase, 'ready');
  await assert.rejects(
    updates.install(async () => {
      throw new Error('Could not save state');
    }),
    /save state/,
  );
  assert.equal(driver.installed, false);
  assert.equal(updates.status().phase, 'ready');
});
test('no update and check errors are reported without downloading or installing', async () => {
  const driver = new Driver(),
    updates = new DesktopUpdates(
      driver,
      '0.3.0',
      () => {},
      () => false,
    );
  driver.checkAction = async () => {
    driver.emit('update-not-available', { version: '0.3.0' });
  };
  await updates.check();
  assert.equal(updates.status().phase, 'idle');
  assert.equal(driver.downloads, 0);
  driver.checkAction = async () => {
    driver.emit('error', new Error('Invalid update metadata'));
    throw new Error('Invalid update metadata');
  };
  await updates.check();
  assert.equal(updates.status().phase, 'error');
  assert.equal(driver.installed, false);
});

test('manual checks do not recheck while a background download is pending', async () => {
  const driver = new Driver();
  let complete: (() => void) | undefined;
  driver.downloadAction = () =>
    new Promise<void>((resolve) => {
      complete = resolve;
    });
  const updates = new DesktopUpdates(
    driver,
    '0.1.0',
    () => {},
    () => false,
  );
  await updates.check();
  await tick();
  const checking = updates.check();
  assert.equal(driver.checks, 1);
  assert.equal(driver.downloads, 1);
  driver.emit('update-downloaded', { version: '0.2.0' });
  complete?.();
  await checking;
  assert.equal(updates.status().phase, 'ready');
});
