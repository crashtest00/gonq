/**
 * The one place dialogs are mounted: registerDialog(id, Component, cancel) declares a dialog, openDialog(id, props)
 * shows it and returns a promise of its result, and <DialogHost/> (mounted once, by App.tsx) renders the open one.
 * A dialog opened while another is open waits its turn and is shown after the first has resolved.
 */
import { useEffect, useSyncExternalStore, type ComponentType } from 'react';

/** What every registered dialog receives besides its own props: `close` resolves the promise openDialog returned. */
export interface DialogClose<R> {
  close: (result: R) => void;
}

/** A registered dialog; carries its prop and result types to openDialog. */
export interface DialogRef<P, R> {
  readonly id: string;
  /** Type-only: never set. */
  readonly types?: (props: P) => R;
}

interface Registered {
  Component: ComponentType<any>;
  cancel: unknown;
}

interface Entry {
  seq: number;
  reg: Registered;
  props: unknown;
  done: boolean;
  resolve: (result: unknown) => void;
}

const registry = new Map<string, Registered>();
const waiting: Entry[] = [];
let current: Entry | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/**
 * Declares dialog `id`. `cancel` is the result of dismissing it without an answer: it resolves a dialog whose
 * host goes away. Registering an id again replaces the earlier one.
 */
export function registerDialog<P, R>(id: string, Component: ComponentType<P & DialogClose<R>>, cancel: R): DialogRef<Omit<P, 'close'>, R> {
  registry.set(id, { Component, cancel });
  return { id };
}

/** Shows dialog `id` with `props`; resolves with what it closes with. Queued behind a dialog that is already open. */
export function openDialog<P, R>(dialog: DialogRef<P, R> | string, props: P): Promise<R> {
  const id = typeof dialog === 'string' ? dialog : dialog.id;
  const reg = registry.get(id);
  if (reg === undefined) return Promise.reject(new Error(`No dialog is registered as "${id}".`));
  return new Promise<R>((resolve) => {
    const entry: Entry = { seq: ++seq, reg, props, done: false, resolve: resolve as (result: unknown) => void };
    if (current === null) {
      current = entry;
      notify();
    } else waiting.push(entry);
  });
}

function finish(entry: Entry, result: unknown) {
  if (entry.done) return;
  entry.done = true;
  entry.resolve(result);
  if (entry !== current) return;
  current = waiting.shift() ?? null;
  notify();
}

/** The host went away: everything open or waiting is dismissed with its cancel result. */
function cancelAll() {
  const all = [...(current === null ? [] : [current]), ...waiting.splice(0)];
  current = null;
  for (const entry of all) {
    entry.done = true;
    entry.resolve(entry.reg.cancel);
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** Renders the open dialog (each one fresh, keyed by its request). Mount it once, last in the app shell. */
export function DialogHost() {
  const entry = useSyncExternalStore(subscribe, () => current);
  useEffect(() => cancelAll, []);
  if (entry === null) return null;
  const { Component } = entry.reg;
  return <Component key={entry.seq} {...(entry.props as object)} close={(result: unknown) => finish(entry, result)} />;
}
