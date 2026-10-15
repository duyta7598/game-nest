export interface Game {
  id: string;
  title: string;
  url: string;
  image: string;
  genres: string[];
  repackSize: string;
  originalSize: string;
  date: string;
}

export interface GameDetail extends Game {
  description: string;
  features: string[];
  magnets: { label: string; uri: string }[];
}

export interface CatalogPage {
  games: Game[];
  page: number;
  hasNext: boolean;
  cached: boolean;
  fetchedAt: string;
  warning?: string;
}

export interface Settings {
  language: 'en' | 'vi';
  downloadPath: string;
  secureDns: boolean;
  networkMode: 'auto' | 'direct' | 'proxy';
  manageWarp: boolean;
  proxyRules: string;
  maxDownloads: number;
  downloadLimit: number;
  uploadLimit: number;
  seedAfterDownload: boolean;
  closeToTray: boolean;
}

export interface DownloadRecord {
  id: string;
  title: string;
  source: string;
  savePath: string;
  image: string;
  createdAt: string;
  paused: boolean;
  priorities: Record<string, number>;
}

export interface TorrentStatus {
  id: string;
  name: string;
  progress: number;
  downloadRate: number;
  uploadRate: number;
  downloaded: number;
  total: number;
  peers: number;
  paused: boolean;
  finished: boolean;
  metadata: boolean;
  state: number;
  error: string;
}

export type Download = DownloadRecord & Partial<TorrentStatus> & { queued?: boolean };

export interface TorrentFile {
  index: number;
  path: string;
  size: number;
  downloaded: number;
  selected: boolean;
}

export interface DownloadState {
  items: Download[];
  engineReady: boolean;
  engineError: string;
}

export interface Bootstrap {
  settings: Settings;
  downloads: DownloadState;
  favorites: Game[];
  version: string;
}

export interface GameNestAPI {
  bootstrap(): Promise<Bootstrap>;
  catalog(query: string, page: number, refresh?: boolean): Promise<CatalogPage>;
  detail(url: string): Promise<GameDetail>;
  saveSettings(settings: Settings): Promise<Settings>;
  chooseFolder(): Promise<string | null>;
  startDownload(url: string, magnetIndex: number): Promise<string>;
  addMagnet(uri: string): Promise<string>;
  importTorrent(): Promise<string | null>;
  pauseDownload(id: string, paused: boolean): Promise<void>;
  removeDownload(id: string): Promise<void>;
  files(id: string): Promise<TorrentFile[]>;
  selectFiles(id: string, indexes: number[]): Promise<void>;
  openFolder(id: string): Promise<void>;
  toggleFavorite(game: Game): Promise<Game[]>;
  prepareNetwork(): Promise<{ ok: boolean; message: string }>;
  networkStatus(): Promise<{
    warpInstalled: boolean;
    warpConnected: boolean;
    warpProxyMode: boolean;
    proxyReady: boolean;
    route: 'direct' | 'proxy';
  }>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
  onDownloads(listener: (state: DownloadState) => void): () => void;
}

declare global {
  interface Window {
    gamenest: GameNestAPI;
  }
}
