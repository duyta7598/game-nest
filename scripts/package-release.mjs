import { spawnSync } from 'node:child_process';
import { build } from 'electron-builder';

const target = process.argv[2];
if (!['mac', 'win'].includes(target)) throw new Error('Choose mac or win.');
if (process.platform !== (target === 'mac' ? 'darwin' : 'win32'))
  throw new Error(
    'Build each release on its target operating system so the native engine matches.',
  );
if (
  target === 'mac' &&
  (!process.env.GAMENEST_MAC_SIGN_IDENTITY || process.env.GAMENEST_MAC_SIGN_IDENTITY.trim() === '-')
)
  throw new Error(
    'Set GAMENEST_MAC_SIGN_IDENTITY to your Developer ID Application identity before building a macOS update.',
  );
for (const [command, args] of [
  [process.execPath, ['scripts/check-native.mjs', target === 'mac' ? 'darwin' : 'win32']],
  [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']],
]) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && command === 'npm.cmd',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await build({
  [target]: target === 'mac' ? ['dmg', 'zip'] : ['nsis'],
  [target === 'mac' ? 'arm64' : 'x64']: true,
  publish: 'never',
  config: {
    ...(target === 'mac'
      ? {
          mac: { identity: process.env.GAMENEST_MAC_SIGN_IDENTITY, hardenedRuntime: true },
          forceCodeSigning: true,
        }
      : {}),
    artifactName: `GameNest-\${version}-${target === 'win' ? 'Windows' : 'mac'}-\${arch}.\${ext}`,
  },
});
