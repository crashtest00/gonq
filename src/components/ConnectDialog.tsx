import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Folder, Loader2, Server } from 'lucide-react';
import {
  addRecentFolder,
  connectHost,
  disconnectHost,
  lastFolderOn,
  listFolders,
  listHosts,
  listRecentFolders,
  openRoot,
  parseConnectInput,
  remoteUri,
  sshPathOf,
  type ConnectResult,
} from '../platform/connect';
import { RemoteFileError, remoteAccount } from '../platform/remote';
import { ROW_CHUNK } from './FolderSidebar';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const primary = `${button} border-primary bg-primary text-primary-foreground`;
const plain = `${button} border-border bg-transparent`;
const field =
  'h-8 w-full rounded-control border border-border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring';
const listRow =
  'flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-1 text-left text-[13px] text-foreground hover:bg-background focus-visible:bg-background focus-visible:outline-none';

type Step =
  | { name: 'host' }
  | { name: 'connecting' }
  | { name: 'host_key'; keyType: string; fingerprint: string }
  | { name: 'host_key_changed'; fingerprint: string; knownLine: string }
  | { name: 'passphrase'; keyPath: string }
  | { name: 'password'; attemptsLeft: number; wrong: boolean }
  | { name: 'auth_failed'; tried: string[] }
  | { name: 'unreachable'; reason: string }
  | { name: 'pick'; authority: string; start: string; notice: string | null }
  | { name: 'opening' };

/** What to do once the connection is up. */
type After = { kind: 'pick'; path: string | null } | { kind: 'open'; uri: string } | { kind: 'resume'; path: string };

function parentOf(path: string): string {
  const i = path.replace(/\/+$/, '').lastIndexOf('/');
  return i <= 0 ? '/' : path.slice(0, i);
}

function Busy({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="m-0 flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
      <Loader2 size={16} aria-hidden className="animate-spin" />
      {children}
    </p>
  );
}

/** Step 3: a folders-only browser on the connected host. */
function FolderPicker({
  authority,
  start,
  home,
  notice,
  onOpen,
  onLost,
  onCancel,
}: {
  authority: string;
  start: string;
  home: string;
  notice: string | null;
  onOpen: (uri: string) => Promise<void>;
  onLost: (path: string) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [text, setText] = useState(start);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState<string | null>(notice);
  const [lost, setLost] = useState(false);
  const [opening, setOpening] = useState(false);
  const [shown, setShown] = useState(ROW_CHUNK);
  const live = useRef(true);
  const current = useRef<string | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  /** Lists `target`; resolves whether it worked. A failure leaves the previous folder showing. */
  const go = useCallback(
    async (target: string, quiet = false): Promise<RemoteFileError | null> => {
      setLoading(true);
      try {
        const res = await listFolders(remoteUri(authority, target));
        if (!live.current) return null;
        const at = sshPathOf(res.uri);
        current.current = at;
        setPath(at);
        setText(at);
        setFolders(res.folders);
        setShown(ROW_CHUNK);
        setLost(false);
        if (!quiet) setProblem(null);
        return null;
      } catch (e) {
        const err = e instanceof RemoteFileError ? e : new RemoteFileError('io', e instanceof Error ? e.message : String(e));
        if (!live.current) return err;
        if (err.kind === 'disconnected' || err.kind === 'unreachable' || err.kind === 'auth_required') setLost(true);
        if (!quiet) setProblem(folderProblem(err, target));
        return err;
      } finally {
        if (live.current) setLoading(false);
      }
    },
    [authority],
  );

  // Start where asked; fall back to the parent of a file, then to home.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let err = await go(start, true);
      if (cancelled || err === null) return;
      if (err.kind === 'not_a_folder') {
        err = await go(parentOf(start), true);
        if (cancelled || err === null) return;
      }
      if ((err.kind === 'not_found' || err.kind === 'not_a_folder' || err.kind === 'permission_denied') && start !== home) {
        const again = await go(home, true);
        if (cancelled) return;
        if (again === null) setProblem(`${folderProblem(err, start)} Showing your home folder instead.`);
        else setProblem(folderProblem(again, home));
        return;
      }
      setProblem(folderProblem(err, start));
    })();
    return () => {
      cancelled = true;
    };
    // The starting point is fixed for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enter = (name: string) => void go(path === '/' ? `/${name}` : `${path}/${name}`);
  const open = async () => {
    if (path === null || opening) return;
    setOpening(true);
    try {
      await onOpen(remoteUri(authority, path));
    } catch (e) {
      if (!live.current) return;
      const err = e instanceof RemoteFileError ? e : null;
      if (err !== null && (err.kind === 'disconnected' || err.kind === 'unreachable' || err.kind === 'auth_required')) setLost(true);
      setProblem(err !== null ? folderProblem(err, path) : e instanceof Error ? e.message : String(e));
      setOpening(false);
    }
  };

  const remaining = folders.length - shown;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void open();
      }}
    >
      <label htmlFor="connect-path" className="mb-1 block text-[13px] font-semibold">
        Folder on {remoteAccount(`ssh://${authority}/`)}
      </label>
      <div className="mb-2 flex gap-2">
        <button
          type="button"
          aria-label="Up"
          title="Up one folder"
          disabled={loading || path === null || path === '/'}
          onClick={() => path !== null && void go(parentOf(path))}
          className={`${plain} flex w-8 items-center justify-center px-0`}
        >
          <ArrowUp size={14} aria-hidden />
        </button>
        <input
          id="connect-path"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter in the path field goes there; it does not open the folder.
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              if (text.trim() !== '') void go(text.trim());
            }
          }}
          spellCheck={false}
          autoFocus
          className={field}
        />
        <button type="button" onClick={() => text.trim() !== '' && void go(text.trim())} disabled={loading} className={plain}>
          Go
        </button>
      </div>
      <div className="mb-2 h-[220px] overflow-y-auto rounded-control border border-border bg-surface">
        {loading && path === null ? (
          <Busy>Loading…</Busy>
        ) : (
          <ul aria-label="Folders" aria-busy={loading} className="m-0 list-none p-0">
            {folders.length === 0 && !loading && <li className="px-2 py-2 text-[13px] text-muted-foreground">No subfolders.</li>}
            {folders.slice(0, shown).map((name) => (
              <li key={name}>
                <button type="button" onDoubleClick={() => enter(name)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), enter(name))} className={listRow} title="Double-click to open">
                  <Folder size={12} aria-hidden className="shrink-0 fill-current" />
                  <span className="truncate">{name}</span>
                </button>
              </li>
            ))}
            {remaining > 0 && (
              <li>
                <button type="button" onClick={() => setShown((n) => n + ROW_CHUNK)} className={`${listRow} text-muted-foreground`}>
                  Show more ({remaining} more)
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
      {problem !== null && (
        <p role="alert" className="m-0 mb-2 text-[12.5px] text-destructive">
          {problem}
        </p>
      )}
      {lost && (
        <p className="m-0 mb-2 text-[12.5px]">
          <button type="button" onClick={() => onLost(current.current ?? start)} className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] underline">
            Reconnect
          </button>
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={plain}>
          Cancel
        </button>
        <button type="submit" disabled={path === null || loading || opening} className={primary}>
          Open
        </button>
      </div>
    </form>
  );
}

function folderProblem(err: RemoteFileError, path: string): string {
  switch (err.kind) {
    case 'not_found':
      return `There is no folder ${path}.`;
    case 'not_a_folder':
      return `${path} is not a folder.`;
    case 'permission_denied':
      return `Permission denied for ${path}.`;
    case 'disconnected':
      return 'Lost the connection to the server.';
    case 'unreachable':
      return "Can't reach the server.";
    case 'auth_required':
      return 'You need to log in again.';
    default:
      return err.detail || err.message;
  }
}

/**
 * File > Connect to Server: choose a host, connect (host key, passphrase or password only when asked),
 * pick a folder, open it as the navigator root. With `reconnect` it only restores the connection
 * (a save or expand that needs a login) and reports through onClose.
 */
export function ConnectDialog({
  host,
  reconnect = false,
  inUse,
  onOpened,
  onClose,
}: {
  /** A host to fill in (and, with `reconnect`, to connect to straight away). */
  host?: string;
  reconnect?: boolean;
  /** Whether an open tab or the navigator still uses the session for this host. */
  inUse: (account: string) => boolean;
  onOpened: (folderUri: string) => void;
  onClose: (connected: boolean) => void;
}) {
  const [step, setStep] = useState<Step>({ name: 'host' });
  const [input, setInput] = useState(host ?? '');
  const [hosts, setHosts] = useState<string[] | null>(null);
  const [recents] = useState(() => listRecentFolders());
  const [secret, setSecret] = useState('');
  const run = useRef(0);
  const target = useRef('');
  const authority = useRef<string | null>(null);
  const started = useRef(false);
  const after = useRef<After>({ kind: 'pick', path: null });
  const trust = useRef<string | undefined>(undefined);
  const skip = useRef<string[]>([]);
  const sentPassword = useRef(false);
  const home = useRef('/');

  useEffect(() => {
    let live = true;
    listHosts().then((h) => live && setHosts(h));
    return () => {
      live = false;
    };
  }, []);

  const finish = useCallback((connected: boolean) => onClose(connected), [onClose]);

  const cancel = () => {
    run.current += 1;
    if (started.current && !reconnect) {
      const name = authority.current ?? target.current;
      if (!inUse(name)) void disconnectHost(target.current);
    }
    finish(false);
  };

  const openFolder = useCallback(
    async (uri: string) => {
      await openRoot(uri);
      addRecentFolder(uri);
      onOpened(uri);
      finish(true);
    },
    [onOpened, finish],
  );

  const onResult = useCallback(
    async (r: ConnectResult) => {
      sentPassword.current = r.kind === 'needs_password' ? sentPassword.current : false;
      switch (r.kind) {
        case 'connected': {
          authority.current = r.authority;
          home.current = r.home;
          const next = after.current;
          if (reconnect) return finish(true);
          if (next.kind === 'open') {
            setStep({ name: 'opening' });
            try {
              return await openFolder(next.uri);
            } catch (e) {
              const why = e instanceof RemoteFileError ? folderProblem(e, sshPathOf(next.uri)) : e instanceof Error ? e.message : String(e);
              return setStep({ name: 'pick', authority: r.authority, start: r.home, notice: `Couldn't open that folder: ${why}` });
            }
          }
          const wanted = next.kind === 'resume' ? next.path : (next.path ?? sshPathOf(lastFolderOn(r.authority) ?? remoteUri(r.authority, r.home)));
          return setStep({ name: 'pick', authority: r.authority, start: wanted, notice: null });
        }
        case 'needs_host_key':
          return setStep({ name: 'host_key', keyType: r.key_type, fingerprint: r.fingerprint });
        case 'host_key_changed':
          return setStep({ name: 'host_key_changed', fingerprint: r.fingerprint, knownLine: r.known_line });
        case 'needs_passphrase':
          return setStep({ name: 'passphrase', keyPath: r.key_path });
        case 'needs_password':
          return setStep({ name: 'password', attemptsLeft: r.attempts_left, wrong: sentPassword.current });
        case 'auth_failed':
          return setStep({ name: 'auth_failed', tried: r.tried });
        case 'unreachable':
          return setStep({ name: 'unreachable', reason: r.reason });
      }
    },
    [reconnect, finish, openFolder],
  );

  /** One ssh_connect call with everything answered so far plus this step's secret. */
  const attempt = useCallback(
    async (extra: { passphrase?: string; password?: string } = {}) => {
      const id = ++run.current;
      started.current = true;
      setStep({ name: 'connecting' });
      setSecret('');
      sentPassword.current = extra.password !== undefined;
      const result = await connectHost(target.current, {
        ...(trust.current === undefined ? {} : { trust_fingerprint: trust.current }),
        ...(skip.current.length === 0 ? {} : { skip_passphrase: skip.current }),
        ...extra,
      });
      // Cancelled while connecting: the result is dropped (cancel already asked for the disconnect).
      if (id !== run.current) return;
      await onResult(result);
    },
    [onResult],
  );

  const begin = useCallback(
    (typed: string, next: After) => {
      const parsed = parseConnectInput(typed);
      if (parsed.target === '') return;
      target.current = parsed.target;
      after.current = next.kind === 'pick' && next.path === null ? { kind: 'pick', path: parsed.path } : next;
      authority.current = null;
      trust.current = undefined;
      skip.current = [];
      void attempt();
    },
    [attempt],
  );

  // A reconnect (a save or an expand that needs a login) starts without asking for the host again.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (reconnect && host && !autoStarted.current) {
      autoStarted.current = true;
      begin(host, { kind: 'pick', path: null });
    }
  }, [reconnect, host, begin]);

  const title: Record<Step['name'], string> = {
    host: 'Connect to Server',
    connecting: 'Connecting…',
    host_key: 'Trust this host?',
    host_key_changed: 'Host key has changed',
    passphrase: 'Key passphrase',
    password: 'Password',
    auth_failed: 'Login failed',
    unreachable: "Can't connect",
    pick: 'Choose a folder',
    opening: 'Opening…',
  };

  const secretForm = (kind: 'passphrase' | 'password', label: string, hint: ReactNode, extraAction?: ReactNode) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (secret === '') return;
        void attempt(kind === 'passphrase' ? { passphrase: secret } : { password: secret });
      }}
    >
      <label htmlFor="connect-secret" className="mb-1 block text-[13px] font-semibold">
        {label}
      </label>
      <input
        id="connect-secret"
        type="password"
        autoComplete="off"
        autoFocus
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        className={field}
      />
      <div className="m-0 mt-1 mb-4 text-[12px] text-muted-foreground">{hint}</div>
      <div className="flex justify-end gap-2">
        {extraAction}
        <button type="button" onClick={cancel} className={plain}>
          Cancel
        </button>
        <button type="submit" disabled={secret === ''} className={primary}>
          {kind === 'passphrase' ? 'Unlock' : 'Log in'}
        </button>
      </div>
    </form>
  );

  const backToHost = () => {
    run.current += 1;
    setStep({ name: 'host' });
  };
  const actions = (primaryButton?: ReactNode) => (
    <div className="mt-4 flex justify-end gap-2">
      <button type="button" onClick={cancel} className={plain}>
        Cancel
      </button>
      {primaryButton}
    </div>
  );

  let body: ReactNode;
  switch (step.name) {
    case 'host':
      body = (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            begin(input, { kind: 'pick', path: null });
          }}
        >
          <label htmlFor="connect-host" className="mb-1 block text-[13px] font-semibold">
            Host
          </label>
          <input
            id="connect-host"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="user@host, a ~/.ssh/config name or ssh://…"
            spellCheck={false}
            autoFocus
            className={field}
          />
          <div className="mt-3 max-h-[260px] overflow-y-auto">
            {recents.length > 0 && (
              <section aria-label="Recent folders" className="mb-3">
                <h3 className="m-0 mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Recent folders</h3>
                <ul className="m-0 list-none p-0">
                  {recents.map((uri) => (
                    <li key={uri}>
                      <button type="button" title={uri} onClick={() => begin(remoteAccount(uri), { kind: 'open', uri })} className={listRow}>
                        <Server size={12} aria-hidden className="shrink-0" />
                        <span className="min-w-0 truncate">
                          <span className="font-semibold">{remoteAccount(uri)}</span>
                          <span className="ml-2 text-muted-foreground">{sshPathOf(uri)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section aria-label="SSH hosts">
              <h3 className="m-0 mb-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">Hosts in ~/.ssh/config</h3>
              {hosts === null ? null : hosts.length === 0 ? (
                <p className="m-0 text-[12.5px] text-muted-foreground">No named hosts found. Type user@host above.</p>
              ) : (
                <ul className="m-0 list-none p-0">
                  {hosts.map((h) => (
                    <li key={h}>
                      <button type="button" onClick={() => begin(h, { kind: 'pick', path: null })} className={listRow}>
                        <Server size={12} aria-hidden className="shrink-0" />
                        <span className="truncate">{h}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {actions(
            <button type="submit" disabled={input.trim() === ''} className={primary}>
              Connect
            </button>,
          )}
        </form>
      );
      break;
    case 'connecting':
      body = (
        <>
          <Busy>Connecting to {target.current}…</Busy>
          {actions()}
        </>
      );
      break;
    case 'host_key':
      body = (
        <>
          <p className="m-0 mb-2 text-[13px]">
            The authenticity of <strong>{target.current}</strong> can't be established. Its {step.keyType} key fingerprint is:
          </p>
          <code className="mb-2 block break-all rounded-control border border-border bg-background px-2 py-1 text-[12.5px]">{step.fingerprint}</code>
          <p className="m-0 text-[12.5px] text-muted-foreground">Trusting it adds the key to ~/.ssh/known_hosts. Check the fingerprint with the server's owner first.</p>
          {actions(
            <button
              type="button"
              onClick={() => {
                trust.current = step.fingerprint;
                void attempt();
              }}
              className={primary}
            >
              Trust
            </button>,
          )}
        </>
      );
      break;
    case 'host_key_changed':
      body = (
        <>
          <p role="alert" className="m-0 mb-2 text-[13px] text-destructive">
            The host key for <strong>{target.current}</strong> has changed. Someone may be intercepting the connection, or the server was reinstalled. The connection was refused.
          </p>
          <p className="m-0 mb-1 text-[12.5px]">New fingerprint:</p>
          <code className="mb-2 block break-all rounded-control border border-border bg-background px-2 py-1 text-[12.5px]">{step.fingerprint}</code>
          <p className="m-0 mb-1 text-[12.5px]">If you know the change is legitimate, remove this line from ~/.ssh/known_hosts and connect again:</p>
          <code className="block break-all rounded-control border border-border bg-background px-2 py-1 text-[12.5px]">{step.knownLine}</code>
          {actions()}
        </>
      );
      break;
    case 'passphrase':
      body = secretForm(
        'passphrase',
        `Passphrase for ${step.keyPath}`,
        'It is used for this connection only and is never saved. Load the key into ssh-agent to avoid this prompt.',
        <button
          type="button"
          onClick={() => {
            skip.current = [...skip.current, step.keyPath];
            void attempt();
          }}
          className={plain}
        >
          Skip
        </button>,
      );
      break;
    case 'password':
      body = secretForm(
        'password',
        `Password for ${target.current}`,
        <>
          {step.wrong && <span role="alert" className="mr-1 text-destructive">Wrong password.</span>}
          {step.attemptsLeft === 1 ? '1 attempt left.' : `${step.attemptsLeft} attempts left.`} It is never saved.
        </>,
      );
      break;
    case 'auth_failed':
      body = (
        <>
          <p role="alert" className="m-0 mb-2 text-[13px] text-destructive">
            Couldn't log in to {target.current}.
          </p>
          {step.tried.length > 0 && (
            <>
              <p className="m-0 mb-1 text-[12.5px]">Tried:</p>
              <ul className="m-0 mb-2 pl-5 text-[12.5px]">
                {step.tried.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
          {actions(
            <>
              <button type="button" onClick={backToHost} className={plain}>
                Back
              </button>
              <button type="button" onClick={() => void attempt()} className={primary}>
                Try again
              </button>
            </>,
          )}
        </>
      );
      break;
    case 'unreachable':
      body = (
        <>
          <p role="alert" className="m-0 mb-2 text-[13px] text-destructive">
            Couldn't reach {target.current}: {step.reason}
          </p>
          {actions(
            <>
              <button type="button" onClick={backToHost} className={plain}>
                Back
              </button>
              <button type="button" onClick={() => void attempt()} className={primary}>
                Try again
              </button>
            </>,
          )}
        </>
      );
      break;
    case 'pick':
      body = (
        <FolderPicker
          authority={step.authority}
          start={step.start}
          home={home.current}
          notice={step.notice}
          onOpen={openFolder}
          onLost={(path) => {
            after.current = { kind: 'resume', path };
            void attempt();
          }}
          onCancel={cancel}
        />
      );
      break;
    case 'opening':
      body = (
        <>
          <Busy>Opening the folder…</Busy>
          {actions()}
        </>
      );
      break;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
        }}
        className="w-[460px] max-w-[90vw] rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="connect-title" className="m-0 mb-3 text-[15px] font-semibold">
          {title[step.name]}
        </h2>
        {body}
      </div>
    </div>
  );
}
