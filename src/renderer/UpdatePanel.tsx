import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { UpdateStatus } from '../shared/update';
import { useTranslation } from './i18n';
export function UpdatePanel({ status }: { status: UpdateStatus | null }) {
  const { t } = useTranslation();
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const act = async (command: 'checkUpdates' | 'installUpdate') => {
    setWorking(true);
    setError('');
    try {
      await window.gamenest[command]();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setWorking(false);
    }
  };
  const phase = status?.phase;
  const busy = working || phase === 'checking' || phase === 'downloading' || phase === 'installing';
  return (
    <section className="settings-panel update-panel" aria-labelledby="update-heading">
      <div className="panel-heading">
        <RefreshCw />
        <h2 id="update-heading">{t('App updates')}</h2>
      </div>
      {status ? (
        <>
          <p>
            {t('Current version')}: {status.currentVersion}
          </p>
          <p className="field-hint">
            {t('Updates download in the background. Choose when to restart and apply them.')}
          </p>
          <div role="status">
            {phase === 'disabled' ? (
              <p>{t(status.reason ?? '')}</p>
            ) : phase === 'ready' ? (
              <p>
                {t('Ready to install')}: {status.version}
              </p>
            ) : phase === 'checking' ? (
              <p>{t('Checking for updates...')}</p>
            ) : phase === 'downloading' ? (
              <>
                <p>
                  {t('Downloading update')}: {status.version} · {Math.round(status.percent ?? 0)}%
                </p>
                <progress
                  aria-label={t('Update download progress')}
                  max={100}
                  value={status.percent ?? 0}
                />
              </>
            ) : phase === 'installing' ? (
              <p>{t('Restarting to update...')}</p>
            ) : phase === 'idle' ? (
              <p>
                {t(
                  status.checkedAt
                    ? 'You are using the latest version.'
                    : 'Automatic update checks are enabled.',
                )}
              </p>
            ) : null}
          </div>
          {status.notes && (
            <details>
              <summary>{t('Release notes')}</summary>
              <p className="release-notes">{status.notes}</p>
            </details>
          )}
          {(error || status.error) && (
            <p role="alert" className="error-text">
              {t(error || status.error || '')}
            </p>
          )}
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy || phase === 'disabled' || phase === 'ready'}
              onClick={() => void act('checkUpdates')}
            >
              {t('Check for updates')}
            </button>
            {phase === 'ready' && (
              <button className="primary" disabled={busy} onClick={() => void act('installUpdate')}>
                {t('Restart to update')}
              </button>
            )}
          </div>
          <p className="field-hint">{t('Your library, settings and downloaded games are kept.')}</p>
          {phase === 'ready' && <p>{t('Pause active downloads before updating.')}</p>}
        </>
      ) : (
        <p>{t(error || 'Loading update status...')}</p>
      )}
    </section>
  );
}
