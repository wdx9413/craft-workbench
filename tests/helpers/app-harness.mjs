/**
 * Boot the real browser entry (web/app.js) inside Node.
 *
 * app.js is a single IIFE that reads index.html, installs window/document
 * listeners and talks to the Runtime over fetch. The harness parses the real
 * index.html, proxies fetch to an in-process mock Runtime, and records every
 * listener so a test can fire the same events a browser would.
 */
import { createDocument } from './dom-stub.mjs';

const KEYS = ['window', 'document', 'localStorage', 'location', 'fetch',
  'getComputedStyle', 'requestAnimationFrame', 'FileReader', 'CustomEvent',
  'setInterval', 'clearInterval', 'navigator', 'history', 'matchMedia'];

export function installAppGlobals({ htmlPath, hash, base, prompts = [] }) {
  const nativeFetch = globalThis.fetch;
  const originals = new Map(KEYS.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const listeners = new Map();
  const timers = new Map();
  const storage = new Map();
  const fetchCalls = [];
  let timerId = 0;
  const doc = createDocument(htmlPath);
  let currentHash = hash;
  const location = {
    get hash() { return currentHash; },
    set hash(next) {
      const value = String(next);
      if (value === currentHash) return;
      currentHash = value;
      for (const fn of listeners.get('hashchange') ?? []) fn({ type: 'hashchange' });
    },
    href: `http://127.0.0.1/${hash}`,
    search: '',
    origin: 'http://127.0.0.1',
    pathname: '/',
    reload() {},
    assign() {},
  };

  const win = {
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== fn)); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) ?? []) fn(event); return true; },
    setInterval: () => { timerId += 1; return timerId; },
    clearInterval: () => {},
    setTimeout: (fn) => { timerId += 1; timers.set(timerId, fn); return timerId; },
    clearTimeout: (id) => { timers.delete(id); },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    prompt: (message) => { prompts.push(message); return prompts.shift() ?? null; },
    confirm: () => true,
    open: () => null,
  };
  Object.assign(win, {
    document: doc,
    location,
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, String(value)); },
      removeItem: (key) => { storage.delete(key); },
    },
    fetch: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      return nativeFetch(`${base}${String(url).replace(/^https?:\/\/[^/]+/, '')}`, init);
    },
    getComputedStyle: () => ({ getPropertyValue: () => '#101010' }),
    requestAnimationFrame: (fn) => { fn(); return 1; },
    FileReader: class { readAsText() { this.onload?.(); } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    history: { back() {}, forward() {} },
  });
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.localStorage = win.localStorage;
  globalThis.location = win.location;
  globalThis.fetch = win.fetch;
  globalThis.getComputedStyle = win.getComputedStyle;
  globalThis.requestAnimationFrame = win.requestAnimationFrame;
  globalThis.FileReader = win.FileReader;
  globalThis.CustomEvent = win.CustomEvent;
  globalThis.history = win.history;
  // The dock and approval notifier poll on intervals; recording stubs keep the
  // process from staying alive and let a test drive one tick explicitly.
  globalThis.setInterval = () => { timerId += 1; return timerId; };
  globalThis.clearInterval = () => {};
  if (!Object.getOwnPropertyDescriptor(globalThis, 'navigator')?.get) {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true, value: { userAgent: 'node', clipboard: { writeText: async () => {} } },
    });
  }

  return {
    doc,
    win,
    fetchCalls,
    prompts,
    storage,
    fire(type, event = {}) {
      for (const fn of listeners.get(type) ?? []) fn({ type, preventDefault() {}, ...event });
    },
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

export const settle = async (rounds = 8) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
