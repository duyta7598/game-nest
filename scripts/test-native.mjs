import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'gamenest-test-'));
try {
  const engine = resolve(
    'native/bin',
    process.platform === 'win32' ? 'gamenest-engine.exe' : 'gamenest-engine',
  );
  const result = spawnSync(engine, ['--self-test', directory], {
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stdout || result.error?.message || result.stderr);
  const data = JSON.parse(result.stdout.trim());
  assert.equal(data.ok, true);
  assert.equal(data.bytes, 524288);
  assert.equal(data.resume, true);
  process.stdout.write(
    'PASS: local peer transfer, byte verification, resume data; no internet torrent used.\n',
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
