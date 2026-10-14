import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Catalog } from '../src/main/catalog';
import { article } from './fixture';

test('cache deduplicates requests, persists across instances and falls back offline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gamenest-cache-'));
  let calls = 0;
  let offline = false;
  const fetcher = async () => {
    calls++;
    if (offline) throw new Error('offline');
    return `<main id="content">${article}</main>`;
  };
  try {
    const catalog = new Catalog(directory, fetcher);
    const [a, b] = await Promise.all([catalog.list('', 1), catalog.list('', 1)]);
    assert.equal(calls, 1);
    assert.equal(a.games[0].id, b.games[0].id);
    assert.equal((await catalog.list('', 1)).cached, true);
    const restarted = new Catalog(directory, fetcher);
    assert.equal((await restarted.list('', 1)).cached, true);
    assert.equal(calls, 1);
    offline = true;
    const fallback = await restarted.list('', 1, true);
    assert.equal(fallback.games.length, 1);
    assert.match(fallback.warning || '', /đã lưu/);
    assert.equal(calls, 2);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('first request offline reports actual error without invented game data', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gamenest-offline-'));
  try {
    await assert.rejects(
      new Catalog(directory, async () => {
        throw new Error('DNS unavailable');
      }).list('fixture', 1),
      /DNS unavailable/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
