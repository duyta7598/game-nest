import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download as DownloadIcon,
  FileCheck2,
  FolderOpen,
  Gamepad2,
  Heart,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import appIcon from '../../resources/icon.png';
import type { Translator } from '../shared/i18n';
import type {
  CatalogPage,
  Download,
  DownloadState,
  Game,
  GameDetail,
  Settings,
  TorrentFile,
} from '../shared/types';
import { LanguageProvider, useTranslation } from './i18n';

type Page = 'library' | 'downloads' | 'favorites' | 'settings';
const api = window.gamenest;
const shortTitle = (title: string) => title.split(/\s[–—]\s/)[0];
const bytes = (value = 0) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : value >= 1024 ** 2
      ? `${(value / 1024 ** 2).toFixed(1)} MB`
      : `${Math.round(value / 1024)} KB`;
const rate = (value = 0) => `${bytes(value)}/s`;
const percent = (item: Download) => Math.min(100, Math.max(0, (item.progress || 0) * 100));
const status = (item: Download, t: Translator) =>
  item.error
    ? t('Có lỗi')
    : item.finished
      ? t('Hoàn tất')
      : item.paused
        ? t('Đã tạm dừng')
        : item.queued
          ? t('Đang chờ')
          : !item.metadata
            ? t('Đang tìm metadata')
            : item.state === 1 || item.state === 7
              ? t('Đang kiểm tra')
              : t('Đang tải xuống');
const eta = (item: Download, t: Translator) => {
  if (!item.downloadRate || item.finished || item.paused) return '—';
  const minutes = Math.ceil(((item.total || 0) - (item.downloaded || 0)) / item.downloadRate / 60);
  return minutes >= 60
    ? t('{0} giờ {1} phút', { '0': Math.floor(minutes / 60), '1': minutes % 60 })
    : t('{0} phút', { '0': minutes });
};

function Cover({
  game,
  className = '',
}: {
  game: Pick<Game, 'title' | 'image'>;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState('');
  return (
    <div className={`cover ${className}`}>
      {game.image && failedSource !== game.image ? (
        <img
          src={game.image}
          alt={game.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedSource(game.image)}
        />
      ) : (
        <div className="cover-fallback">
          <Gamepad2 />
          <span>{shortTitle(game.title)}</span>
        </div>
      )}
    </div>
  );
}

function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const labelId = useRef(`modal-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-labelledby={labelId.current}
      onCancel={close}
    >
      <div className="modal-head">
        <h2 id={labelId.current}>{title}</h2>
        <button className="icon-button" aria-label={t('Đóng')} onClick={close}>
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function App() {
  return (
    <LanguageProvider>
      <AppContent />
    </LanguageProvider>
  );
}

function AppContent() {
  const { t, language, setLanguage } = useTranslation();
  const [page, setPage] = useState<Page>('library');
  const [connection, setConnection] = useState<Awaited<
    ReturnType<typeof api.networkStatus>
  > | null>(null);
  useEffect(() => {
    if (page !== 'settings') return;
    let active = true;
    void api
      .networkStatus()
      .then((value) => {
        if (active) setConnection(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [page]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [downloads, setDownloads] = useState<DownloadState>({
    items: [],
    engineReady: false,
    engineError: '',
  });
  const [favorites, setFavorites] = useState<Game[]>([]);
  const [catalog, setCatalog] = useState<CatalogPage | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [number, setNumber] = useState(1);
  const [genre, setGenre] = useState('__all__');
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<GameDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [magnetIndex, setMagnetIndex] = useState(0);
  const [magnetOpen, setMagnetOpen] = useState(false);
  const [magnet, setMagnet] = useState('');
  const [remove, setRemove] = useState<Download | null>(null);
  const [filesFor, setFilesFor] = useState<Download | null>(null);
  const [files, setFiles] = useState<TorrentFile[]>([]);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [filesLoading, setFilesLoading] = useState(false);
  const request = useRef(0);
  const detailRequest = useRef(0);
  const [version, setVersion] = useState('0.1.0');

  useEffect(() => {
    const off = api.onDownloads(setDownloads);
    api
      .bootstrap()
      .then((value) => {
        setLanguage(value.settings.language || 'en');
        setSettings(value.settings);
        setDraft(value.settings);
        setFavorites(value.favorites);
        setDownloads(value.downloads);
        setVersion(value.version);
      })
      .catch((error) => setMessage(error.message));
    return off;
  }, [setLanguage]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setNumber(1);
    }, 450);
    return () => clearTimeout(timer);
  }, [query]);

  const loadCatalog = useCallback(
    async (refresh = false) => {
      const current = ++request.current;
      setLoading(true);
      setCatalogError('');
      try {
        const result = await api.catalog(search, number, refresh);
        if (current === request.current) setCatalog(result);
      } catch (error) {
        if (current === request.current) setCatalogError((error as Error).message);
      } finally {
        if (current === request.current) setLoading(false);
      }
    },
    [search, number],
  );
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  async function perform(action: () => Promise<unknown>, success = '') {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      if (success) setMessage(success);
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function openDetail(game: Game) {
    const current = ++detailRequest.current;
    setDetailLoading(true);
    setSelected(null);
    setMagnetIndex(0);
    try {
      const value = await api.detail(game.url);
      if (current === detailRequest.current) setSelected(value);
    } catch (error) {
      if (current === detailRequest.current) setMessage((error as Error).message);
    } finally {
      if (current === detailRequest.current) setDetailLoading(false);
    }
  }

  async function favorite(game: Game) {
    setFavorites(await api.toggleFavorite(game));
  }
  async function loadFiles(item: Download) {
    setFilesFor(item);
    setFilesLoading(true);
    setFiles([]);
    try {
      const result = await api.files(item.id);
      setFiles(result);
      setChosen(new Set(result.filter((f) => f.selected).map((f) => f.index)));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setFilesLoading(false);
    }
  }
  async function chooseFolder(target: 'saved' | 'draft') {
    const directory = await api.chooseFolder();
    if (!directory) return;
    if (target === 'draft')
      setDraft((value) => (value ? { ...value, downloadPath: directory } : value));
    else if (settings) {
      const value = await api.saveSettings({ ...settings, downloadPath: directory });
      setSettings(value);
      setDraft(value);
    }
  }
  const active = downloads.items.filter((item) => !item.finished);
  const featured = catalog?.games[0];
  const allGames = page === 'favorites' ? favorites : catalog?.games || [];
  const displayed = allGames.filter((game) => genre === '__all__' || game.genres.includes(genre));
  const genres = ['__all__', ...new Set(allGames.flatMap((game) => game.genres))].slice(0, 7);
  const inFavorites = (game: Game) => favorites.some((g) => g.id === game.id);

  function gameCard(game: Game) {
    return (
      <article className="game-card" key={game.id}>
        <button
          className="poster-button"
          onClick={() => void openDetail(game)}
          aria-label={t('Xem {0}', { 0: game.title })}
        >
          <Cover game={game} />
          <span className="poster-overlay">
            <span>{t('Xem chi tiết')}</span>
            <ArrowRight />
          </span>
        </button>
        <button
          className={`save-game ${inFavorites(game) ? 'saved' : ''}`}
          onClick={() => void perform(() => favorite(game))}
          aria-label={
            inFavorites(game)
              ? t('Bỏ yêu thích {0}', { '0': game.title })
              : t('Yêu thích {0}', { '0': game.title })
          }
          aria-pressed={inFavorites(game)}
        >
          <Heart />
        </button>
        <div className="card-body">
          <button className="game-title" onClick={() => void openDetail(game)} title={game.title}>
            {shortTitle(game.title)}
          </button>
          <p>{game.genres.slice(0, 2).join(' · ') || 'Windows'}</p>
          <div className="card-bottom">
            <span>{game.repackSize || t('Xem dung lượng')}</span>
            <button
              className="download-small"
              disabled={busy || !downloads.engineReady}
              onClick={() =>
                void perform(
                  () => api.startDownload(game.url, 0),
                  t('Đã thêm game vào hàng đợi tải.'),
                )
              }
              aria-label={t('Tải {0}', { '0': game.title })}
            >
              <ArrowDown />
              {t('Tải')}{' '}
            </button>
          </div>
        </div>
      </article>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setPage('library')}>
          <img className="brand-icon" src={appIcon} alt="" />
          GameNest<span className="brand-beta">BETA</span>
        </button>
        <nav aria-label={t('Điều hướng chính')}>
          {(
            [
              ['library', t('Khám phá')],
              ['downloads', t('Đang tải')],
              ['favorites', t('Yêu thích')],
            ] as [Page, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={page === value ? 'active' : ''}
              onClick={() => setPage(value)}
            >
              {label}
              {value === 'downloads' && active.length > 0 && (
                <span className="count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="header-end">
          <span className={`engine-state ${downloads.engineReady ? 'online' : ''}`}>
            <i />
            {downloads.engineReady ? t('Bộ tải sẵn sàng') : t('Bộ tải chưa sẵn sàng')}
          </span>
          <button
            className={`icon-button ${page === 'settings' ? 'active' : ''}`}
            aria-label={t('Cài đặt')}
            onClick={() => setPage('settings')}
          >
            <Settings2 />
          </button>
        </div>
      </header>
      {message && (
        <div className="toast" role="status">
          <CircleAlert />
          <span>{t(message)}</span>
          <button
            className="icon-button"
            aria-label={t('Ẩn thông báo')}
            onClick={() => setMessage('')}
          >
            <X />
          </button>
        </div>
      )}
      {downloads.engineError && (
        <div className="banner error" role="alert">
          <CircleAlert />
          <span>{t(downloads.engineError)}</span>
        </div>
      )}

      {(page === 'library' || page === 'favorites') && (
        <main className="discover">
          {page === 'library' && !search && featured && !loading && (
            <section className="hero">
              {featured.image && (
                <img
                  className="hero-backdrop"
                  src={featured.image}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              )}
              <div className="hero-shade" />
              <div className="hero-content">
                <span className="eyebrow">
                  <span />
                  {t('MỚI CẬP NHẬT TRÊN FITGIRL')}{' '}
                </span>
                <h1>{shortTitle(featured.title)}</h1>
                <p className="hero-tags">
                  {featured.genres.slice(0, 3).join(' / ') || t('Khám phá game mới')}
                </p>
                <p className="hero-meta">
                  {featured.repackSize || t('Xem thông tin dung lượng')}
                  <span />
                  Windows
                  <span />
                  Torrent
                </p>
                <div className="hero-actions">
                  <button
                    className="primary"
                    disabled={busy || !downloads.engineReady}
                    onClick={() =>
                      void perform(
                        () => api.startDownload(featured.url, 0),
                        t('Đã thêm game vào hàng đợi tải.'),
                      )
                    }
                  >
                    <DownloadIcon />
                    {t('Tải game')}{' '}
                  </button>
                  <button className="ghost" onClick={() => void openDetail(featured)}>
                    {t('Xem chi tiết')} <ArrowRight />
                  </button>
                </div>
              </div>
              <div className="hero-cover">
                <Cover game={featured} />
              </div>
              <span className="hero-caption">{t('TỰA GAME MỚI NHẤT')}</span>
            </section>
          )}
          <section className="catalog-section">
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  {page === 'favorites' ? t('BỘ SƯU TẬP CỦA BẠN') : t('THƯ VIỆN GAME')}
                </span>
                <h2>
                  {page === 'favorites'
                    ? t('Để dành cho lần chơi tới.')
                    : search
                      ? t('Kết quả cho “{0}”', { '0': search })
                      : t('Hành trình tiếp theo.')}
                </h2>
              </div>
              {page === 'library' && (
                <div className="search-tools">
                  <label className="search">
                    <Search />
                    <input
                      aria-label={t('Tìm game')}
                      placeholder={t('Tìm tựa game…')}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    {query && (
                      <button
                        className="icon-button"
                        aria-label={t('Xóa tìm kiếm')}
                        onClick={() => setQuery('')}
                      >
                        <X />
                      </button>
                    )}
                  </label>
                  <button
                    className="icon-button outlined"
                    disabled={loading}
                    aria-label={t('Cập nhật danh sách')}
                    onClick={() => void loadCatalog(true)}
                  >
                    <RefreshCw className={loading ? 'spin' : ''} />
                  </button>
                </div>
              )}
            </div>
            {page === 'library' && catalog?.warning && (
              <div className="banner">
                <Wifi />
                <span>{t(catalog.warning)}</span>
                <button className="text-button" onClick={() => setPage('settings')}>
                  {t('Cài đặt mạng')}{' '}
                </button>
              </div>
            )}
            {catalogError && page === 'library' ? (
              <div className="empty">
                <Wifi />
                <h3>{t('Chưa kết nối được nguồn')}</h3>
                <p>{t(catalogError)}</p>
                <div className="button-row">
                  <button className="primary" onClick={() => void loadCatalog(true)}>
                    {t('Thử lại')}{' '}
                  </button>
                  <button className="secondary" onClick={() => setPage('settings')}>
                    {t('Cài đặt mạng')}{' '}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="filter-row">
                  <div className="filters">
                    {genres.map((value) => (
                      <button
                        key={value}
                        className={genre === value ? 'active' : ''}
                        onClick={() => setGenre(value)}
                      >
                        {value === '__all__' ? t('Tất cả') : value}
                      </button>
                    ))}
                  </div>
                  <span className="subtle">
                    {catalog?.cached && page === 'library' ? t('Đã lưu cục bộ · ') : ''}
                    {displayed.length} {t('game')}
                  </span>
                </div>
                {loading && page === 'library' ? (
                  <div className="game-grid">
                    {[0, 1, 2, 3].map((i) => (
                      <div className="skeleton" key={i}>
                        <div />
                        <span />
                        <span />
                      </div>
                    ))}
                  </div>
                ) : displayed.length ? (
                  <div className="game-grid">{displayed.map(gameCard)}</div>
                ) : (
                  <div className="empty">
                    <Gamepad2 />
                    <h3>
                      {page === 'favorites'
                        ? t('Chưa có game yêu thích')
                        : t('Không tìm thấy game')}
                    </h3>
                    <p>
                      {page === 'favorites'
                        ? t('Bấm biểu tượng trái tim trên game để lưu vào đây.')
                        : t('Thử tên game khác hoặc chọn “Tất cả”.')}
                    </p>
                  </div>
                )}
              </>
            )}
            {page === 'library' && !catalogError && (
              <div className="pagination">
                <button
                  className="secondary"
                  disabled={number === 1 || loading}
                  onClick={() => setNumber((n) => n - 1)}
                >
                  <ChevronLeft />
                  {t('Trước')}{' '}
                </button>
                <span>{t('Trang {0}', { 0: number })}</span>
                <button
                  className="secondary"
                  disabled={!catalog?.hasNext || loading}
                  onClick={() => setNumber((n) => n + 1)}
                >
                  {t('Tiếp')} <ChevronRight />
                </button>
              </div>
            )}
          </section>
        </main>
      )}

      {page === 'downloads' && (
        <main className="content-page">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('BỘ TẢI TÍCH HỢP')}</span>
              <h1>{t('Đang tải')}</h1>
              <p>{t('Tiến độ được lưu tự động để tiếp tục ở lần mở sau.')}</p>
            </div>
            <div className="button-row">
              <button
                className="secondary"
                disabled={busy || !downloads.engineReady}
                onClick={() => void perform(() => api.importTorrent())}
              >
                <Plus />
                {t('File torrent')}
              </button>
              <button
                className="primary"
                disabled={!downloads.engineReady}
                onClick={() => setMagnetOpen(true)}
              >
                <Plus />
                Magnet
              </button>
            </div>
          </div>
          <div className="download-summary">
            <span>
              <DownloadIcon />
              {t('{0} tác vụ chưa hoàn tất', { 0: active.length })}
            </span>
            <span>{rate(downloads.items.reduce((sum, d) => sum + (d.downloadRate || 0), 0))}</span>
            <span className="subtle">
              {t('{0} hoàn tất', { 0: downloads.items.filter((d) => d.finished).length })}
            </span>
          </div>
          {!downloads.items.length ? (
            <div className="empty">
              <DownloadIcon />
              <h3>{t('Hàng đợi đang trống')}</h3>
              <p>{t('Chọn game trong Khám phá hoặc thêm magnet/file torrent.')}</p>
              <button className="primary" onClick={() => setPage('library')}>
                {t('Khám phá game')} <ArrowRight />
              </button>
            </div>
          ) : (
            <div className="download-list">
              {downloads.items.map((item) => (
                <article className="download-item" key={item.id}>
                  <Cover game={item} className="download-cover" />
                  <div className="download-main">
                    <div className="download-title-row">
                      <h3>{shortTitle(item.title)}</h3>
                      <span className={item.finished ? 'complete-label' : 'status-label'}>
                        {item.finished && <Check />}
                        {status(item, t)}
                      </span>
                    </div>
                    <div
                      className="progress"
                      role="progressbar"
                      aria-label={t('Tiến độ {0}', { '0': item.title })}
                      aria-valuenow={Math.round(percent(item))}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      <div style={{ width: `${percent(item)}%` }} />
                    </div>
                    <div className="download-stats">
                      <span>
                        {percent(item).toFixed(1)}% · {bytes(item.downloaded)} / {bytes(item.total)}
                      </span>
                      <span>
                        {rate(item.downloadRate)} ·{' '}
                        {t('{0} peer · Còn {1}', { 0: item.peers || 0, 1: eta(item, t) })}
                      </span>
                    </div>
                    {item.error && <p className="error-text">{t(item.error)}</p>}
                    <p className="path-text">{item.savePath}</p>
                  </div>
                  <div className="download-actions">
                    <button
                      className="icon-button"
                      aria-label={item.paused ? t('Tiếp tục tải') : t('Tạm dừng tải')}
                      disabled={busy || !downloads.engineReady || Boolean(item.error)}
                      onClick={() => void perform(() => api.pauseDownload(item.id, !item.paused))}
                    >
                      {item.paused ? <Play /> : <Pause />}
                    </button>
                    <button
                      className="icon-button"
                      aria-label={t('Chọn file {0}', { '0': item.title })}
                      disabled={!item.metadata || !downloads.engineReady}
                      onClick={() => void loadFiles(item)}
                    >
                      <FileCheck2 />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={t('Mở thư mục {0}', { '0': item.title })}
                      onClick={() => void perform(() => api.openFolder(item.id))}
                    >
                      <FolderOpen />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={t('Bỏ tác vụ {0}', { '0': item.title })}
                      onClick={() => setRemove(item)}
                    >
                      <Trash2 />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </main>
      )}

      {page === 'settings' && draft && (
        <main className="content-page settings-page">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('THEO CÁCH CỦA BẠN')}</span>
              <h1>{t('Cài đặt')}</h1>
            </div>
            <span className="version">GameNest {version}</span>
          </div>
          <div className="settings-grid">
            <section className="settings-panel">
              <div className="panel-heading">
                <FolderOpen />
                <h2>{t('Lưu trữ & tải xuống')}</h2>
              </div>
              <label className="field">
                <span>{t('Ngôn ngữ')}</span>
                <select
                  value={language}
                  disabled={busy}
                  onChange={(event) =>
                    void perform(async () => {
                      const next = event.target.value as Settings['language'];
                      const value = await api.saveSettings({
                        ...(settings ?? draft),
                        language: next,
                      });
                      setSettings(value);
                      setDraft((current) => (current ? { ...current, language: next } : value));
                      setLanguage(next);
                    })
                  }
                >
                  <option value="en">English</option>
                  <option value="vi">Tiếng Việt</option>
                </select>
              </label>
              <label className="field">
                <span>{t('Thư mục tải mặc định')}</span>
                <div className="folder-field">
                  <input readOnly value={draft.downloadPath} />
                  <button
                    className="secondary"
                    onClick={() => void perform(() => chooseFolder('draft'))}
                  >
                    {t('Chọn thư mục')}{' '}
                  </button>
                </div>
              </label>
              <div className="fields-row">
                <label className="field">
                  <span>{t('Tải đồng thời')}</span>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={draft.maxDownloads}
                    onChange={(e) => setDraft({ ...draft, maxDownloads: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>{t('Giới hạn tải · KiB/s')}</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.downloadLimit}
                    onChange={(e) => setDraft({ ...draft, downloadLimit: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>{t('Giới hạn upload · KiB/s')}</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.uploadLimit}
                    onChange={(e) => setDraft({ ...draft, uploadLimit: Number(e.target.value) })}
                  />
                </label>
              </div>
              <p className="field-hint">{t('Nhập 0 để không giới hạn tốc độ.')}</p>
              <label className="toggle-field">
                <span>
                  <b>{t('Tiếp tục seed sau khi tải xong')}</b>
                  <small>{t('Chia sẻ dữ liệu với các peer khác.')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.seedAfterDownload}
                  onChange={(e) => setDraft({ ...draft, seedAfterDownload: e.target.checked })}
                />
              </label>
              <label className="toggle-field">
                <span>
                  <b>{t('Thu xuống khay hệ thống khi đóng cửa sổ')}</b>
                  <small>{t('Bộ tải tiếp tục chạy. Chọn Thoát trong menu khay để dừng.')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.closeToTray}
                  onChange={(e) => setDraft({ ...draft, closeToTray: e.target.checked })}
                />
              </label>
            </section>
            <section className="settings-panel">
              <div className="panel-heading">
                <ShieldCheck />
                <h2>{t('Kết nối nguồn game')}</h2>
              </div>
              <label className="field">
                <span>{t('Chế độ kết nối')}</span>
                <select
                  value={draft.networkMode}
                  onChange={(e) =>
                    setDraft({ ...draft, networkMode: e.target.value as Settings['networkMode'] })
                  }
                >
                  <option value="auto">{t('Tự động · Đề xuất')}</option>
                  <option value="direct">{t('Kết nối trực tiếp')}</option>
                  <option value="proxy">{t('Luôn dùng proxy')}</option>
                </select>
              </label>
              <p className="field-hint">
                {t(
                  'Tự động thử mạng trực tiếp, rồi dùng proxy khi nguồn game bị chặn hoặc không phản hồi. Áp dụng cho danh mục và ảnh game.',
                )}{' '}
              </p>
              {connection && (
                <div className="network-status" role="status">
                  <span>
                    WARP:{' '}
                    {connection.warpConnected
                      ? connection.warpProxyMode
                        ? t('Proxy cục bộ')
                        : t('VPN toàn máy')
                      : connection.warpInstalled
                        ? t('Chưa kết nối')
                        : t('Chưa cài đặt')}
                  </span>
                  <span>Proxy: {connection.proxyReady ? t('Sẵn sàng') : t('Chưa kết nối')}</span>
                  <span>
                    {t('Lần truy cập gần nhất:')}{' '}
                    {connection.route === 'proxy' ? 'Proxy' : t('Trực tiếp')}
                  </span>
                </div>
              )}
              <label className="toggle-field">
                <span>
                  <b>{t('Tự quản lý WARP')}</b>
                  <small>{t('Cần cài và mở Cloudflare WARP một lần. Dùng proxy localhost.')}</small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.manageWarp}
                  onChange={(e) => setDraft({ ...draft, manageWarp: e.target.checked })}
                />
              </label>
              <label className="toggle-field">
                <span>
                  <b>{t('DNS mã hóa qua Cloudflare')}</b>
                  <small>
                    {t('Có thể hữu ích khi lỗi phân giải tên miền. Không thay thế WARP.')}
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.secureDns}
                  onChange={(e) => setDraft({ ...draft, secureDns: e.target.checked })}
                />
              </label>
              <label className="field">
                <span>{t('Địa chỉ proxy HTTP / SOCKS5')}</span>
                <input
                  placeholder="http://127.0.0.1:40000"
                  value={draft.proxyRules}
                  onChange={(e) => setDraft({ ...draft, proxyRules: e.target.value })}
                />
              </label>
              <p className="field-hint">
                {t(
                  'Để trống dùng http://127.0.0.1:40000 của WARP. Proxy ngoài: tắt Tự quản lý WARP. Không hỗ trợ xác thực. Peer và tracker torrent dùng mạng hệ thống.',
                )}{' '}
              </p>
              {draft.manageWarp && draft.networkMode !== 'direct' && (
                <>
                  <p className="field-hint">
                    {t('Chuẩn bị WARP sẽ chuyển WARP từ VPN toàn máy sang proxy cục bộ.')}{' '}
                  </p>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const value = await api.saveSettings(draft);
                        setSettings(value);
                        setDraft(value);
                        const result = await api.prepareNetwork();
                        setMessage(result.message);
                        setConnection(await api.networkStatus());
                      })
                    }
                  >
                    <ShieldCheck />
                    {t('Chuẩn bị WARP')}{' '}
                  </button>
                </>
              )}
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const value = await api.saveSettings(draft);
                    setSettings(value);
                    const result = await api.testConnection();
                    setMessage(result.message);
                    setConnection(await api.networkStatus());
                  })
                }
              >
                <Wifi />
                {t('Lưu & kiểm tra kết nối')}{' '}
              </button>
            </section>
          </div>
          <div className="settings-footer">
            <span className="subtle">{t('Thay đổi thư mục chỉ áp dụng cho tác vụ tải mới.')}</span>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const value = await api.saveSettings(draft);
                  setSettings(value);
                }, t('Đã lưu cài đặt.'))
              }
            >
              <Check />
              {t('Lưu cài đặt')}{' '}
            </button>
          </div>
        </main>
      )}

      <footer className="app-footer">
        <span>
          <i className="source-dot" />
          {t('Nguồn: FitGirl Repacks')}{' '}
        </span>
        <span>
          {t('Tải trực tiếp bằng libtorrent')}
          <span className="footer-separator">/</span>Windows
        </span>
      </footer>
      {active[0] && page !== 'downloads' && (
        <div className="bottom-download">
          <button className="bottom-open" onClick={() => setPage('downloads')}>
            <DownloadIcon />
            <div>
              <b>{shortTitle(active[0].title)}</b>
              <span>
                {status(active[0], t)} · {percent(active[0]).toFixed(1)}% ·{' '}
                {rate(active[0].downloadRate)}
              </span>
            </div>
            <div className="progress">
              <div style={{ width: `${percent(active[0])}%` }} />
            </div>
          </button>
          <button
            className="icon-button"
            aria-label={active[0].paused ? t('Tiếp tục tải') : t('Tạm dừng tải')}
            disabled={busy || !downloads.engineReady}
            onClick={() => void perform(() => api.pauseDownload(active[0].id, !active[0].paused))}
          >
            {active[0].paused ? <Play /> : <Pause />}
          </button>
        </div>
      )}

      {detailLoading && (
        <Modal
          title={t('Đang đọc thông tin game')}
          close={() => {
            detailRequest.current++;
            setDetailLoading(false);
          }}
        >
          <div className="empty">
            <LoaderCircle className="spin" />
            <p>{t('Đang lấy thông tin từ nguồn…')}</p>
          </div>
        </Modal>
      )}
      {selected && (
        <Modal title={t('Chi tiết game')} close={() => setSelected(null)} wide>
          <div className="detail-top">
            <Cover game={selected} />
            <div>
              <span className="eyebrow">FITGIRL REPACKS</span>
              <h2>{selected.title}</h2>
              <p>{selected.genres.join(' · ')}</p>
              <div className="detail-facts">
                <span>
                  {t('Dung lượng tải')}
                  <b>{selected.repackSize || t('Chưa có thông tin')}</b>
                </span>
                <span>
                  {t('Dung lượng gốc')}
                  <b>{selected.originalSize || t('Chưa có thông tin')}</b>
                </span>
              </div>
              <button
                className="text-button"
                onClick={() => void perform(() => chooseFolder('saved'))}
              >
                <FolderOpen />
                {settings?.downloadPath}
                <SlidersHorizontal />
              </button>
            </div>
          </div>
          <div className="detail-download">
            {selected.magnets.length > 0 ? (
              <>
                <label className="field">
                  <span>{t('Nguồn torrent')}</span>
                  <select
                    value={magnetIndex}
                    onChange={(e) => setMagnetIndex(Number(e.target.value))}
                  >
                    {selected.magnets.map((source, index) => (
                      <option key={source.uri} value={index}>
                        {source.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={busy || !downloads.engineReady}
                  onClick={() =>
                    void perform(async () => {
                      await api.startDownload(selected.url, magnetIndex);
                      setSelected(null);
                      setPage('downloads');
                    }, t('Đã thêm vào hàng đợi tải.'))
                  }
                >
                  <DownloadIcon />
                  {t('Tải game')}{' '}
                </button>
              </>
            ) : (
              <p className="error-text">
                {t(
                  'Trang này chưa có magnet trực tiếp. Có thể thêm file .torrent trong mục Đang tải.',
                )}{' '}
              </p>
            )}
            <button
              className={`secondary ${inFavorites(selected) ? 'saved' : ''}`}
              onClick={() => void perform(() => favorite(selected))}
            >
              <Heart />
              {inFavorites(selected) ? t('Đã lưu') : t('Yêu thích')}
            </button>
          </div>
          {selected.description && (
            <section className="detail-description">
              <h3>{t('Về tựa game')}</h3>
              <p>{selected.description}</p>
            </section>
          )}
          {selected.features.length > 0 && (
            <section className="detail-description">
              <h3>{t('Thông tin bản repack')}</h3>
              <ul>
                {selected.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </section>
          )}
        </Modal>
      )}
      {magnetOpen && (
        <Modal title={t('Thêm magnet')} close={() => setMagnetOpen(false)}>
          <label className="field">
            <span>Magnet link</span>
            <textarea
              rows={5}
              placeholder="magnet:?xt=urn:btih:…"
              value={magnet}
              onChange={(e) => setMagnet(e.target.value)}
            />
          </label>
          <p className="field-hint">
            {t('Lưu tại')} {settings?.downloadPath}
          </p>
          <button
            className="primary"
            disabled={busy || !magnet.trim()}
            onClick={() =>
              void perform(async () => {
                await api.addMagnet(magnet.trim());
                setMagnet('');
                setMagnetOpen(false);
              }, t('Đã thêm torrent.'))
            }
          >
            <DownloadIcon />
            {t('Bắt đầu tải')}{' '}
          </button>
        </Modal>
      )}
      {remove && (
        <Modal title={t('Bỏ tác vụ tải?')} close={() => setRemove(null)}>
          <p>{shortTitle(remove.title)}</p>
          <p>{t('Dữ liệu đã tải vẫn được giữ trong thư mục. Tác vụ sẽ bị gỡ khỏi hàng đợi.')}</p>
          <div className="button-row">
            <button className="secondary" onClick={() => setRemove(null)}>
              {t('Giữ lại')}{' '}
            </button>
            <button
              className="primary destructive"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await api.removeDownload(remove.id);
                  setRemove(null);
                })
              }
            >
              {t('Bỏ tác vụ')}{' '}
            </button>
          </div>
        </Modal>
      )}
      {filesFor && (
        <Modal title={t('Chọn file tải')} close={() => setFilesFor(null)} wide>
          <p>{shortTitle(filesFor.title)}</p>
          {filesLoading ? (
            <div className="empty">
              <LoaderCircle className="spin" />
            </div>
          ) : files.length ? (
            <>
              <div className="file-toolbar">
                <button
                  className="text-button"
                  onClick={() => setChosen(new Set(files.map((f) => f.index)))}
                >
                  {t('Chọn tất cả')}{' '}
                </button>
                <span className="subtle">
                  {chosen.size}/{files.length} {t('file')} ·{' '}
                  {bytes(
                    files.filter((f) => chosen.has(f.index)).reduce((sum, f) => sum + f.size, 0),
                  )}
                </span>
              </div>
              <div className="file-list">
                {files.map((file) => (
                  <label className="file-row" key={file.index}>
                    <input
                      type="checkbox"
                      checked={chosen.has(file.index)}
                      onChange={(event) =>
                        setChosen((value) => {
                          const next = new Set(value);
                          if (event.target.checked) next.add(file.index);
                          else next.delete(file.index);
                          return next;
                        })
                      }
                    />
                    <span>{file.path}</span>
                    <small>{bytes(file.size)}</small>
                  </label>
                ))}
              </div>
              <button
                className="primary"
                disabled={busy || !chosen.size}
                onClick={() =>
                  void perform(async () => {
                    await api.selectFiles(filesFor.id, [...chosen]);
                    setFilesFor(null);
                  }, t('Đã cập nhật các file cần tải.'))
                }
              >
                <Check />
                {t('Áp dụng lựa chọn')}{' '}
              </button>
            </>
          ) : (
            <div className="empty">
              <p>{t('Chưa có metadata để liệt kê file.')}</p>
              <button className="secondary" onClick={() => void loadFiles(filesFor)}>
                {t('Đọc lại')}{' '}
              </button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
