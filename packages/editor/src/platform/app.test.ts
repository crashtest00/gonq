/** appKind(): 'desktop' unless __GONQ_APP__ is 'mobile', read on every call. */
import { vi } from 'vitest';
import { appKind, CONNECT_UNAVAILABLE_MOBILE } from './app';

afterEach(() => vi.unstubAllGlobals());

describe('appKind', () => {
  it('is desktop when __GONQ_APP__ is not defined', () => {
    expect(appKind()).toBe('desktop');
  });
  it('is desktop for "desktop" and for any unknown value', () => {
    vi.stubGlobal('__GONQ_APP__', 'desktop');
    expect(appKind()).toBe('desktop');
    vi.stubGlobal('__GONQ_APP__', 'tablet');
    expect(appKind()).toBe('desktop');
  });
  it('is mobile when a test sets __GONQ_APP__ = "mobile", and follows later changes', () => {
    vi.stubGlobal('__GONQ_APP__', 'mobile');
    expect(appKind()).toBe('mobile');
    vi.stubGlobal('__GONQ_APP__', undefined);
    expect(appKind()).toBe('desktop');
  });
  it('words the mobile message as specified', () => {
    expect(CONNECT_UNAVAILABLE_MOBILE).toBe('Connecting to a server is not part of the Gonq mobile app.');
  });
});
