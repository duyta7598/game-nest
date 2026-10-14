import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
} from 'electron';
import { z } from 'zod';
import type {
  DownloadRecord,
  DownloadState,
  Game,
  Settings,
  TorrentFile,
  TorrentStatus,
} from '../shared/types';
import { Catalog } from './catalog';
import { TorrentEngine } from './engine';
import { SOURCE, sourceUrl, validMagnet } from './parser';
import { gameSchema, Store, settingsSchema } from './store';

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let pollTimer: NodeJS.Timeout | undefined;
let store: Store;
const engine = new TorrentEngine();
let state: DownloadState = { items: [], engineReady: false, engineError: '' };
const itemErrors = new Map<string, string>();
const prioritiesApplied = new Set<string>();
let polling = false;

function emit() {
  if (window && !window.isDestroyed()) window.webContents.send('downloads:changed', state);
}

function record(id: unknown) {
  const value = z.string().uuid().parse(id);
  const item = store.downloads.find((d) => d.id === value);
  if (!item) throw new Error('Không tìm thấy tác vụ tải.');
  return item;
}

async function poll() {
  if (polling || quitting) return;
  polling = true;
  try {
    const statuses = engine.ready ? await engine.request<TorrentStatus[]>('snapshot') : [];
    let changed = false;
    for (const status of statuses) {
      const item = store.downloads.find((d) => d.id === status.id);
      if (!item) continue;
      if (
        status.metadata &&
        !prioritiesApplied.has(item.id) &&
        Object.keys(item.priorities).length
      ) {
        await engine.request('selectFiles', {
          id: item.id,
          indexes: Object.entries(item.priorities)
            .filter(([, p]) => p > 0)
            .map(([i]) => Number(i)),
        });
        prioritiesApplied.add(item.id);
      }
      if (status.finished && !store.settings.seedAfterDownload && !item.paused) {
        item.paused = true;
        changed = true;
      }
    }
    if (changed) store.saveDownloads();
    state = {
      items: store.downloads.map((item) => {
        const status = statuses.find((s) => s.id === item.id);
        return {
          ...item,
          ...status,
          paused: item.paused,
          queued: Boolean(status?.paused && !item.paused && !status.finished),
          error: itemErrors.get(item.id) || status?.error || '',
        };
      }),
      engineReady: engine.ready,
      engineError: engine.error,
    };
    emit();
  } catch (error) {
    state = { ...state, engineReady: engine.ready, engineError: (error as Error).message };
    emit();
  } finally {
    polling = false;
  }
}

async function configure(settings: Settings) {
  app.configureHostResolver({
    secureDnsMode: settings.secureDns ? 'secure' : 'off',
    secureDnsServers: settings.secureDns ? ['https://cloudflare-dns.com/dns-query'] : [],
  });
  await session
    .fromPartition('persist:catalog')
    .setProxy(
      settings.proxyRules
        ? { mode: 'fixed_servers', proxyRules: settings.proxyRules }
        : { mode: 'system' },
    );
  if (engine.ready)
    await engine.request('configure', {
      maxDownloads: settings.maxDownloads,
      downloadLimit: settings.downloadLimit,
      uploadLimit: settings.uploadLimit,
      seedAfterDownload: settings.seedAfterDownload,
    });
}

async function fetchPage(url: string) {
  try {
    const response = await session.fromPartition('persist:catalog').fetch(sourceUrl(url), {
      signal: AbortSignal.timeout(25000),
      redirect: 'error',
      headers: {
        'User-Agent': `GameNest/${app.getVersion()} desktop catalog`,
        Accept: 'text/html',
      },
    });
    if (response.status === 403 || response.status === 429)
      throw new Error(
        'Nguồn đang hạn chế truy cập. Thử mở trang bằng trình duyệt hoặc kiểm tra WARP/proxy.',
      );
    if (!response.ok) throw new Error(`Nguồn trả về HTTP ${response.status}.`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Nguồn trả về nội dung trống.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('Trang nguồn vượt giới hạn dung lượng.');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    throw new Error(
      `Không đọc được FitGirl: ${(error as Error).message} Kiểm tra mạng, DNS/WARP hoặc proxy trong Cài đặt.`,
    );
  }
}

async function addDownload(source: string, title: string, image = ''): Promise<string> {
  if (!engine.ready) throw new Error(engine.error || 'Bộ tải chưa sẵn sàng.');
  const item: DownloadRecord = {
    id: randomUUID(),
    title,
    source,
    image,
    savePath: store.settings.downloadPath,
    createdAt: new Date().toISOString(),
    paused: false,
    priorities: {},
  };
  if (!isAbsolute(item.savePath)) throw new Error('Thư mục tải phải là đường dẫn tuyệt đối.');
  mkdirSync(item.savePath, { recursive: true });
  await engine.request('add', item as unknown as Record<string, unknown>);
  store.downloads.unshift(item);
  try {
    store.saveDownloads();
  } catch (error) {
    store.downloads = store.downloads.filter((d) => d.id !== item.id);
    await engine.request('remove', { id: item.id });
    throw error;
  }
  await poll();
  return item.id;
}

function createWindow() {
  window = new BrowserWindow({
    width: 1240,
    height: 850,
    minWidth: 840,
    minHeight: 620,
    title: 'GameNest',
    backgroundColor: '#111416',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
    },
  });
  window.once('ready-to-show', () => window?.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.on('close', (event) => {
    if (!quitting && store.settings.closeToTray && tray) {
      event.preventDefault();
      window?.hide();
    }
  });
  window.on('closed', () => {
    window = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));
}

function installHandlers(catalog: Catalog) {
  const handle = (name: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(name, (event, ...args) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error('Yêu cầu không hợp lệ.');
      return fn(...args);
    });
  handle('app:bootstrap', () => ({
    settings: store.settings,
    downloads: state,
    favorites: store.favorites,
    version: app.getVersion(),
  }));
  handle('catalog:list', (query, page, refresh) =>
    catalog.list(
      z.string().max(200).parse(query),
      z.number().int().min(1).max(10000).parse(page),
      z.boolean().optional().parse(refresh),
    ),
  );
  handle('catalog:detail', (url) => catalog.detail(sourceUrl(z.string().max(2048).parse(url))));
  handle('settings:save', async (value) => {
    const settings = settingsSchema.parse(value);
    if (!isAbsolute(settings.downloadPath))
      throw new Error('Chọn thư mục tải bằng đường dẫn tuyệt đối.');
    await configure(settings);
    store.saveSettings(settings);
    return settings;
  });
  handle('settings:folder', async () => {
    if (!window) throw new Error('Cửa sổ app đã đóng.');
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: store.settings.downloadPath,
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('downloads:start', async (url, index) => {
    const detail = await catalog.detail(sourceUrl(z.string().max(2048).parse(url)));
    const selected = detail.magnets[z.number().int().min(0).max(100).parse(index)];
    if (!selected) throw new Error('Game này chưa có magnet trực tiếp.');
    return addDownload(selected.uri, detail.title, detail.image);
  });
  handle('downloads:magnet', async (value) => {
    const uri = z.string().max(32768).parse(value);
    if (!validMagnet(uri)) throw new Error('Magnet không hợp lệ.');
    return addDownload(uri, new URL(uri).searchParams.get('dn')?.slice(0, 300) || 'Torrent mới');
  });
  handle('downloads:import', async () => {
    if (!window) throw new Error('Cửa sổ app đã đóng.');
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile'],
      filters: [{ name: 'Torrent', extensions: ['torrent'] }],
    });
    if (result.canceled) return null;
    const source = result.filePaths[0];
    const directory = join(store.directory, 'torrents');
    mkdirSync(directory, { recursive: true });
    const target = join(directory, `${randomUUID()}.torrent`);
    copyFileSync(source, target);
    return addDownload(target, basename(source, '.torrent'));
  });
  handle('downloads:pause', async (id, value) => {
    const item = record(id);
    const paused = z.boolean().parse(value);
    await engine.request('pause', { id: item.id, paused });
    item.paused = paused;
    store.saveDownloads();
    await poll();
  });
  handle('downloads:remove', async (id) => {
    const item = record(id);
    if (engine.ready && !itemErrors.has(item.id)) await engine.request('remove', { id: item.id });
    store.downloads = store.downloads.filter((d) => d.id !== item.id);
    store.saveDownloads();
    itemErrors.delete(item.id);
    prioritiesApplied.delete(item.id);
    await poll();
  });
  handle('downloads:files', (id) => engine.request<TorrentFile[]>('files', { id: record(id).id }));
  handle('downloads:select-files', async (id, value) => {
    const item = record(id);
    const indexes = z.array(z.number().int().min(0)).min(1).max(100000).parse(value);
    await engine.request('selectFiles', { id: item.id, indexes });
    item.priorities = Object.fromEntries(indexes.map((i) => [String(i), 1]));
    prioritiesApplied.add(item.id);
    store.saveDownloads();
    await poll();
  });
  handle('downloads:folder', async (id) => {
    const error = await shell.openPath(record(id).savePath);
    if (error) throw new Error(error);
  });
  handle('favorites:toggle', (value) => {
    const game = gameSchema.parse(value) as Game;
    sourceUrl(game.url);
    store.favorites = store.favorites.some((g) => g.id === game.id)
      ? store.favorites.filter((g) => g.id !== game.id)
      : [game, ...store.favorites];
    store.saveFavorites();
    return store.favorites;
  });
  handle('network:test', async () => {
    try {
      await fetchPage(SOURCE);
      return { ok: true, message: 'Kết nối được FitGirl từ app.' };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!window) createWindow();
    window?.show();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      if (process.env.GAMENEST_DATA_DIR) app.setPath('userData', process.env.GAMENEST_DATA_DIR);
      store = new Store(app.getPath('userData'), app.getPath('downloads'));
      const executable = app.isPackaged
        ? join(
            process.resourcesPath,
            'engine',
            process.platform === 'win32' ? 'gamenest-engine.exe' : 'gamenest-engine',
          )
        : join(
            app.getAppPath(),
            'native',
            'bin',
            process.platform === 'win32' ? 'gamenest-engine.exe' : 'gamenest-engine',
          );
      engine.start(executable, join(store.directory, 'resume'));
      await configure(store.settings);
      for (const item of store.downloads) {
        try {
          await engine.request('add', item as unknown as Record<string, unknown>);
        } catch (error) {
          itemErrors.set(item.id, (error as Error).message);
        }
      }
      const catalog = new Catalog(join(store.directory, 'cache'), fetchPage);
      installHandlers(catalog);
      createWindow();
      const icon = nativeImage.createFromPath(join(app.getAppPath(), 'resources', 'icon.png'));
      if (!icon.isEmpty()) {
        tray = new Tray(icon.resize({ width: 20, height: 20 }));
        tray.setToolTip('GameNest');
        tray.setContextMenu(
          Menu.buildFromTemplate([
            {
              label: 'Mở GameNest',
              click: () => {
                if (!window) createWindow();
                window?.show();
              },
            },
            { label: 'Thoát và lưu tiến độ', click: () => app.quit() },
          ]),
        );
        tray.on('click', () => window?.show());
      }
      await poll();
      pollTimer = setInterval(() => void poll(), 1000);
    })
    .catch((error) => {
      dialog.showErrorBox('GameNest', (error as Error).message);
      app.quit();
    });
  app.on('activate', () => {
    if (!window && store) createWindow();
    else window?.show();
  });
  app.on('window-all-closed', () => {
    if (!tray || !store?.settings.closeToTray) app.quit();
  });
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    clearInterval(pollTimer);
    void engine.shutdown().finally(() => {
      tray?.destroy();
      app.quit();
    });
  });
}
