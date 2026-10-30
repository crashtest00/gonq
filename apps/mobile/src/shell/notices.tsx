/**
 * The mobile counterpart of App's two message lines: a provider holding one error and one dismissible notice, the
 * useNotices() hook later stories call (setError / setNotice) and <NoticeBanner/>, which renders both under the top bar.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export interface Notices {
  error: string | null;
  notice: string | null;
  setError(message: string | null): void;
  setNotice(message: string | null): void;
}

const NoticesContext = createContext<Notices | null>(null);

export function NoticesProvider({ children }: { children: ReactNode }) {
  const [error, setErrorState] = useState<string | null>(null);
  const [notice, setNoticeState] = useState<string | null>(null);
  const setError = useCallback((m: string | null) => setErrorState(m), []);
  const setNotice = useCallback((m: string | null) => setNoticeState(m), []);
  const value = useMemo(() => ({ error, notice, setError, setNotice }), [error, notice, setError, setNotice]);
  return <NoticesContext.Provider value={value}>{children}</NoticesContext.Provider>;
}

export function useNotices(): Notices {
  const ctx = useContext(NoticesContext);
  if (!ctx) throw new Error('useNotices needs a <NoticesProvider>');
  return ctx;
}

/** The error (alert) and the notice (status), each with a Dismiss button; renders nothing when both are empty. */
export function NoticeBanner() {
  const { error, notice, setError, setNotice } = useNotices();
  if (!error && !notice) return null;
  return (
    <div className="m-banners">
      {error && (
        <div className="m-banner m-banner-error" role="alert">
          <span>{error}</span>
          <button type="button" className="m-tap" aria-label="Dismiss error" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="m-banner" role="status">
          <span>{notice}</span>
          <button type="button" className="m-tap" aria-label="Dismiss notice" onClick={() => setNotice(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
