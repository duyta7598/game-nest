import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogPage, GameDetail } from '../shared/types';
import { parseCatalog, parseDetail, SOURCE, sourceUrl } from './parser';
import { readJson, writeJson } from './store';

interface Cached<T> {
  time: number;
  value: T;
}
export class Catalog {
  private queue: Promise<unknown> = Promise.resolve();
  private nextRequest = 0;
  private pending = new Map<string, Promise<unknown>>();
  constructor(
    private directory: string,
    private fetchPage: (url: string) => Promise<string>,
  ) {
    mkdirSync(directory, { recursive: true });
  }

  private async request(url: string) {
    const run = this.queue
      .catch(() => {})
      .then(async () => {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, this.nextRequest - Date.now())),
        );
        this.nextRequest = Date.now() + 1500;
        return this.fetchPage(sourceUrl(url));
      });
    this.queue = run;
    return run;
  }

  private async cached<T>(
    key: string,
    ttl: number,
    refresh: boolean,
    loader: () => Promise<T>,
  ): Promise<{ value: T; stale: boolean; cached: boolean }> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<{ value: T; stale: boolean; cached: boolean }>;
    const run = (async () => {
      const path = join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`);
      const saved = readJson<Cached<T> | null>(path, null);
      if (saved && !refresh && Date.now() - saved.time < ttl)
        return { value: saved.value, stale: false, cached: true };
      try {
        const value = await loader();
        writeJson(path, { time: Date.now(), value });
        return { value, stale: false, cached: false };
      } catch (error) {
        if (saved) return { value: saved.value, stale: true, cached: true };
        throw error;
      }
    })();
    this.pending.set(key, run);
    try {
      return await run;
    } finally {
      this.pending.delete(key);
    }
  }

  async list(query: string, page: number, refresh = false): Promise<CatalogPage> {
    const url = new URL(page === 1 ? '/' : `/page/${page}/`, SOURCE);
    if (query) url.searchParams.set('s', query);
    const result = await this.cached(url.href, 60 * 60 * 1000, refresh, async () =>
      parseCatalog(await this.request(url.href), page),
    );
    return {
      ...result.value,
      cached: result.cached,
      ...(result.stale
        ? {
            warning:
              'Không kết nối được nguồn. Đang hiển thị dữ liệu đã lưu; kiểm tra DNS/WARP hoặc proxy trong Cài đặt.',
          }
        : {}),
    };
  }
  async detail(url: string): Promise<GameDetail> {
    const result = await this.cached(sourceUrl(url), 24 * 60 * 60 * 1000, false, async () =>
      parseDetail(await this.request(url), url),
    );
    return result.value;
  }
}
