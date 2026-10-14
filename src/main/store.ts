import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { DownloadRecord, Game, Settings } from '../shared/types';

export const settingsSchema = z.object({
  downloadPath: z.string().min(1).max(4096),
  secureDns: z.boolean(),
  proxyRules: z
    .string()
    .max(2048)
    .refine(
      (s) => !s || /^(https?|socks5):\/\/[^\s/@]+:\d{1,5}$/.test(s),
      'Proxy phải có dạng http://host:port hoặc socks5://host:port.',
    ),
  maxDownloads: z.number().int().min(1).max(10),
  downloadLimit: z.number().int().min(0).max(1048576),
  uploadLimit: z.number().int().min(0).max(1048576),
  seedAfterDownload: z.boolean(),
  closeToTray: z.boolean(),
});

export const gameSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{16}$/),
  title: z.string().max(1000),
  url: z.string().max(2048),
  image: z.string().max(4096),
  genres: z.array(z.string()).max(20),
  repackSize: z.string(),
  originalSize: z.string(),
  date: z.string(),
});

const downloadSchema = z.object({
  id: z.string().uuid(),
  title: z.string().max(1000),
  source: z.string().max(32768),
  savePath: z.string().max(4096),
  image: z.string().max(4096),
  createdAt: z.string(),
  paused: z.boolean(),
  priorities: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(7)),
});

export function readJson<T>(file: string, fallback: T, strict = false): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (error) {
    if (strict && error instanceof SyntaxError)
      throw new Error(`Dữ liệu lưu bị lỗi JSON: ${file}. Giữ nguyên file để khôi phục.`);
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  const temporary = `${file}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  renameSync(temporary, file);
}

export class Store {
  settings: Settings;
  downloads: DownloadRecord[];
  favorites: Game[];
  constructor(
    readonly directory: string,
    downloadsDirectory: string,
  ) {
    mkdirSync(directory, { recursive: true });
    const defaults: Settings = {
      downloadPath: join(downloadsDirectory, 'GameNest'),
      secureDns: false,
      proxyRules: '',
      maxDownloads: 2,
      downloadLimit: 0,
      uploadLimit: 0,
      seedAfterDownload: false,
      closeToTray: true,
    };
    const saved = settingsSchema.safeParse(
      readJson(join(directory, 'settings.json'), defaults, true),
    );
    this.settings = saved.success ? saved.data : defaults;
    this.downloads = z
      .array(downloadSchema)
      .parse(readJson(join(directory, 'downloads.json'), [], true));
    this.favorites = z
      .array(gameSchema)
      .parse(readJson(join(directory, 'favorites.json'), [], true));
  }
  saveSettings(value: Settings) {
    const parsed = settingsSchema.parse(value);
    writeJson(join(this.directory, 'settings.json'), parsed);
    this.settings = parsed;
  }
  saveDownloads() {
    writeJson(join(this.directory, 'downloads.json'), this.downloads);
  }
  saveFavorites() {
    writeJson(join(this.directory, 'favorites.json'), this.favorites);
  }
}
