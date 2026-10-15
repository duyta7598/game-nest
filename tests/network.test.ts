import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { NetworkRouter } from '../src/main/network';
import { Store, settingsSchema } from '../src/main/store';

const directory = mkdtempSync(join(tmpdir(), 'gamenest-network-'));
const settings = new Store(directory, directory).settings;
rmSync(directory, { recursive: true, force: true });
const url = 'https://fitgirl-repacks.site/';
test('auto uses direct while reachable, without preparing WARP', async () => {
  const router = new NetworkRouter(settings, {
    direct: async () => new Response('direct'),
    proxy: async () => {
      throw new Error('unexpected proxy');
    },
    prepare: async () => {
      throw new Error('unexpected WARP');
    },
  });
  assert.equal(await (await router.fetch(url)).text(), 'direct');
  assert.equal(router.route, 'direct');
});
test('auto falls back on block/network failure and remembers successful proxy', async () => {
  for (const blocked of [true, false]) {
    let direct = 0,
      proxy = 0,
      prepared = 0;
    const router = new NetworkRouter(settings, {
      direct: async () => {
        direct++;
        if (!blocked) throw new Error('offline');
        return new Response('blocked', { status: 403 });
      },
      proxy: async () => {
        proxy++;
        return new Response('proxy');
      },
      prepare: async () => {
        prepared++;
      },
    });
    await router.fetch(url);
    await router.fetch(url);
    assert.equal(direct, 1);
    assert.equal(proxy, 2);
    assert.equal(prepared, 2);
    assert.equal(router.route, 'proxy');
  }
});
test('timeouts fall back but explicit cancellation never opens proxy', async () => {
  let proxies = 0;
  const router = new NetworkRouter(settings, {
    directTimeout: 10,
    direct: async (_, options) =>
      new Promise((_, reject) =>
        options.signal?.addEventListener('abort', () => reject(new Error('timeout')), {
          once: true,
        }),
      ),
    proxy: async () => {
      proxies++;
      return new Response('proxy');
    },
    prepare: async () => {},
  });
  const alive = setTimeout(() => {}, 1000);
  try {
    await router.fetch(url);
    assert.equal(proxies, 1);
    await assert.rejects(
      () => router.fetch(url, { signal: AbortSignal.abort(new Error('cancelled')) }),
      /cancelled/,
    );
    assert.equal(proxies, 1);
  } finally {
    clearTimeout(alive);
  }
});
test('forced proxy fails without direct fallback; direct never prepares WARP', async () => {
  const dependencies = {
    direct: async () => new Response('direct'),
    proxy: async () => {
      throw new Error('proxy unavailable');
    },
    prepare: async () => {
      throw new Error('WARP must stay off');
    },
  };
  const forced = new NetworkRouter(
    { ...settings, networkMode: 'proxy', manageWarp: false },
    dependencies,
  );
  await assert.rejects(() => forced.fetch(url), /proxy unavailable/);
  assert.equal(
    await (
      await new NetworkRouter({ ...settings, networkMode: 'direct' }, dependencies).fetch(url)
    ).text(),
    'direct',
  );
});
test('proxy validation rejects malformed endpoints and nonlocal automatic WARP', () => {
  for (const proxyRules of [
    'invalid',
    'http://user:secret@host:8080',
    'socks5://localhost:99999',
    'http://host:8080/path',
    'https://localhost:40000',
  ])
    assert.equal(settingsSchema.safeParse({ ...settings, proxyRules }).success, false);
  assert.equal(
    settingsSchema.safeParse({
      ...settings,
      manageWarp: false,
      proxyRules: 'http://proxy.example:8080',
    }).success,
    true,
  );
});
test('old external proxy settings migrate without losing the download folder', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gamenest-migration-'));
  try {
    const { networkMode, manageWarp, ...legacy } = settings;
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ ...legacy, proxyRules: 'http://proxy.example:8080' }),
    );
    const restored = new Store(dir, dir).settings;
    assert.equal(restored.networkMode, 'proxy');
    assert.equal(restored.manageWarp, false);
    assert.equal(restored.downloadPath, settings.downloadPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
