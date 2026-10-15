import type { Settings } from '../shared/types';

export class NetworkRouter {
  private proxyUntil = 0;
  route: 'direct' | 'proxy' = 'direct';
  constructor(
    private settings: Settings,
    private dependencies: {
      direct: (url: string, options: RequestInit) => Promise<Response>;
      proxy: (url: string, options: RequestInit) => Promise<Response>;
      prepare: () => Promise<void>;
      directTimeout?: number;
    },
  ) {}
  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    options.signal?.throwIfAborted();
    const proxy = async () => {
      if (this.settings.manageWarp) await this.dependencies.prepare();
      options.signal?.throwIfAborted();
      const response = await this.dependencies.proxy(url, options);
      this.route = 'proxy';
      if (response.ok) this.proxyUntil = Date.now() + 600000;
      return response;
    };
    if (this.settings.networkMode === 'proxy') return proxy();
    if (this.settings.networkMode === 'direct') {
      this.route = 'direct';
      return this.dependencies.direct(url, options);
    }
    if (this.proxyUntil > Date.now()) {
      try {
        return await proxy();
      } catch (error) {
        if (options.signal?.aborted) throw error;
        this.proxyUntil = 0;
      }
    }
    let response: Response | undefined;
    try {
      response = await this.dependencies.direct(url, {
        ...options,
        signal: options.signal
          ? AbortSignal.any([
              options.signal,
              AbortSignal.timeout(this.dependencies.directTimeout ?? 5000),
            ])
          : AbortSignal.timeout(this.dependencies.directTimeout ?? 5000),
      });
      if (![403, 451, 502, 503, 504].includes(response.status)) {
        this.route = 'direct';
        return response;
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
    }
    await response?.body?.cancel();
    return proxy();
  }
}
