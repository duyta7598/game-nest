import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const native = join(root, 'native');
mkdirSync(join(native, 'bin'), { recursive: true });
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
const vendor = process.env.GAMENEST_LIBTORRENT_VENDOR;
if (process.platform === 'darwin' && vendor) {
  if (!existsSync(join(vendor, 'libtorrent-rasterbar.a')))
    throw new Error('Không tìm thấy libtorrent trong thư mục vendor.');
  run('clang++', [
    '-std=c++17',
    '-O2',
    '-DBOOST_ASIO_ENABLE_CANCELIO',
    '-DBOOST_ASIO_HAS_STD_CHRONO',
    '-DBOOST_ASIO_NO_DEPRECATED',
    '-DBOOST_EXCEPTION_DISABLE',
    '-DTORRENT_SSL_PEERS',
    '-DTORRENT_USE_LIBCRYPTO',
    '-DTORRENT_USE_OPENSSL',
    '-D_FILE_OFFSET_BITS=64',
    `-I${join(vendor, 'include')}`,
    join(native, 'engine.cpp'),
    `-L${vendor}`,
    '-ltorrent-rasterbar',
    '-lssl',
    '-lcrypto',
    '-framework',
    'Security',
    '-framework',
    'SystemConfiguration',
    '-framework',
    'CoreFoundation',
    '-o',
    join(native, 'bin', 'gamenest-engine'),
  ]);
  const licenses = join(native, 'bin', 'licenses');
  mkdirSync(licenses, { recursive: true });
  for (const file of readdirSync(vendor).filter((name) => name.endsWith('LICENSE.txt')))
    copyFileSync(join(vendor, file), join(licenses, file));
} else {
  const args = ['-S', native, '-B', join(native, 'build'), '-DCMAKE_BUILD_TYPE=Release'];
  if (process.env.VCPKG_ROOT) {
    args.push(
      `-DCMAKE_TOOLCHAIN_FILE=${join(process.env.VCPKG_ROOT, 'scripts', 'buildsystems', 'vcpkg.cmake')}`,
    );
    if (process.platform === 'win32')
      args.push(
        '-DVCPKG_TARGET_TRIPLET=x64-windows-static',
        '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
      );
  }
  run('cmake', args);
  run('cmake', ['--build', join(native, 'build'), '--config', 'Release', '--parallel', '4']);
  const triplet = process.platform === 'win32' ? 'x64-windows-static' : '';
  const share = join(native, 'build', 'vcpkg_installed', triplet, 'share');
  if (existsSync(share)) {
    const licenses = join(native, 'bin', 'licenses');
    mkdirSync(licenses, { recursive: true });
    for (const packageName of readdirSync(share)) {
      const copyright = join(share, packageName, 'copyright');
      if (existsSync(copyright)) copyFileSync(copyright, join(licenses, `${packageName}.txt`));
    }
  }
}
