import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const platform = process.argv[2];
if (platform !== process.platform)
  throw new Error('Build bộ cài trên đúng hệ điều hành đích để kiểm tra bộ tải native.');
const binary = resolve(
  'native/bin',
  platform === 'win32' ? 'gamenest-engine.exe' : 'gamenest-engine',
);
const result = spawnSync(binary, ['--version'], { encoding: 'utf8' });
if (result.error || result.status !== 0)
  throw new Error('Bộ tải chưa sẵn sàng. Chạy npm run native:build trước khi đóng gói.');
if (JSON.parse(result.stdout).engine !== 'libtorrent')
  throw new Error('Bộ tải native không hợp lệ.');
