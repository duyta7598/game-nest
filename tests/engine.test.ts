import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { TorrentEngine } from '../src/main/engine';
import type { TorrentFile, TorrentStatus } from '../src/shared/types';

const executable = resolve(
  'native/bin',
  process.platform === 'win32' ? 'gamenest-engine.exe' : 'gamenest-engine',
);
test('native IPC: add, files, pause, restore and remove while keeping payload', {
  skip: !existsSync(executable),
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gamenest-ipc-'));
  let engine = new TorrentEngine();
  const payload = Buffer.alloc(4096, 37);
  const file = join(directory, 'fixture.bin');
  const torrent = join(directory, 'fixture.torrent');
  writeFileSync(file, payload);
  const hash = createHash('sha1').update(payload).digest();
  writeFileSync(
    torrent,
    Buffer.concat([
      Buffer.from('d4:infod6:lengthi4096e4:name11:fixture.bin12:piece lengthi16384e6:pieces20:'),
      hash,
      Buffer.from('ee'),
    ]),
  );
  const task = { id: 'fixture', source: torrent, savePath: directory, paused: false };
  try {
    engine.start(executable, join(directory, 'resume'));
    await engine.request('configure', { seedAfterDownload: true });
    await engine.request('add', task);
    const files = await engine.request<TorrentFile[]>('files', { id: 'fixture' });
    assert.equal(files[0].path, 'fixture.bin');
    assert.equal(files[0].size, 4096);
    await engine.request('selectFiles', { id: 'fixture', indexes: [0] });
    await assert.rejects(engine.request('selectFiles', { id: 'fixture', indexes: [99] }), /index/);
    await engine.request('pause', { id: 'fixture', paused: true });
    await engine.shutdown();
    assert.equal(existsSync(join(directory, 'resume', 'fixture.resume')), true);
    engine = new TorrentEngine();
    engine.start(executable, join(directory, 'resume'));
    await engine.request('add', { ...task, paused: true });
    const statuses = await engine.request<TorrentStatus[]>('snapshot');
    assert.equal(statuses[0].paused, true);
    await engine.request('remove', { id: 'fixture' });
    assert.equal((await engine.request<TorrentStatus[]>('snapshot')).length, 0);
    assert.deepEqual(readFileSync(file), payload);
  } finally {
    await engine.shutdown();
    rmSync(directory, { recursive: true, force: true });
  }
});
