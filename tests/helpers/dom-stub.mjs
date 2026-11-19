import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

function decode(text) {
  return text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

export class Style {
  constructor() { this.values = new Map(); }
  setProperty(name, value) { this.values.set(name, value); }
  removeProperty(name) { this.values.delete(name); }
  getPropertyValue(name) { return this.values.get(name) ?? ''; }
}

export class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.ownText = '';
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.style = new Style();
    this.dataset = new Proxy({}, {
      get: (_, key) => this.attributes.get('data-' + camel(key)),
      set: (_, key, value) => { this.attributes.set('data-' + camel(key), String(value)); return true; },
      has: (_, key) => this.attributes.has('data-' + camel(key)),
    });
    this.classList = {
      add: (...names) => this.addClass(...names),
      remove: (...names) => this.removeClass(...names),
      toggle: (name, force) => {
        const on = force === undefined ? !this.hasClass(name) : force;
        if (on) this.addClass(name); else this.removeClass(name);
        return on;
      },
      contains: (name) => this.hasClass(name),
    };
  }
  get id() { return this.attributes.get('id') ?? ''; }
  set id(value) { this.attributes.set('id', String(value)); }
  // The browser turns `onclick = fn` into an event listener; the stub must do
  // the same so a test click reaches the app's real handler.
  set onclick(fn) { this.removeEventListener('click', this.clickHandler); this.clickHandler = fn; if (fn) this.addEventListener('click', fn); }
  get onclick() { return this.clickHandler ?? null; }
  get className() { return this.attributes.get('class') ?? ''; }
  set className(value) { this.attributes.set('class', String(value)); }
  get classes() { return new Set(this.className.split(/\s+/).filter(Boolean)); }
  hasClass(name) { return this.classes.has(name); }
  addClass(...names) {
    const set = this.classes; for (const n of names) { if (n) set.add(n); }
    this.attributes.set('class', [...set].join(' '));
  }
  removeClass(...names) {
    const set = this.classes; for (const n of names) set.delete(n);
    this.attributes.set('class', [...set].join(' '));
  }
  get hidden() { return this.attributes.get('hidden') !== undefined; }
  set hidden(value) { if (value) this.attributes.set('hidden', ''); else this.attributes.delete('hidden'); }
  get value() { return this.attributes.get('value') ?? this.ownText; }
  set value(v) { this.attributes.set('value', String(v)); }
  get checked() { return this.attributes.get('checked') === 'true'; }
  set checked(v) { this.attributes.set('checked', v ? 'true' : 'false'); }
  get textContent() { return this.ownText + this.children.map((c) => c.textContent ?? '').join(''); }
  set textContent(v) { this.ownText = String(v); this.children = []; this._html = undefined; }
  // Browsers parse an innerHTML assignment into a subtree. The stub keeps the
  // raw markup for assertions and parses it so querySelector finds real nodes.
  get innerHTML() { return this._html ?? this.ownText; }
  set innerHTML(v) {
    this._html = String(v);
    this.ownText = '';
    this.children = [];
    if (this._html.includes('<')) {
      const fragment = parseHtml(this._html);
      for (const child of fragment.children) {
        child.parentNode = this;
        this.children.push(child);
      }
    } else {
      this.ownText = this._html;
    }
  }
  get firstChild() { return this.children[0] ?? null; }
  get childNodes() { return this.children; }
  get lastChild() { return this.children[this.children.length - 1] ?? null; }
  get isConnected() { return true; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) {
    if (name === 'value') return this.value;
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  toggleAttribute(name) { if (this.hasAttribute(name)) this.attributes.delete(name); else this.attributes.set(name, ''); }
  append(...items) { for (const item of items) { item.parentNode = this; this.children.push(item); } }
  appendChild(item) { item.parentNode = this; this.children.push(item); return item; }
  prepend(item) { item.parentNode = this; this.children.unshift(item); }
  insertBefore(item) { item.parentNode = this; this.children.unshift(item); return item; }
  replaceWith() {}
  replaceChildren(...items) { this.children = items; this.ownText = ''; }
  remove() {
    this.removed = true;
    const siblings = this.parentNode?.children;
    const index = siblings ? siblings.indexOf(this) : -1;
    if (index >= 0) siblings.splice(index, 1);
  }
  insertAdjacentHTML() {}
  insertAdjacentElement() {}
  cloneNode() { return new El(this.tagName.toLowerCase()); }
  focus() { this.focused = true; }
  blur() {}
  click() { this.dispatch('click', { target: this, preventDefault() {}, stopPropagation() {} }); }
  scrollIntoView() {}
  scrollTo() {}
  setSelectionRange() {}
  select() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 10, height: 10 }; }
  getClientRects() { return [{ top: 0, left: 0, width: 10, height: 10 }]; }
  closest(selector) { return matches(this, selector) ? this : this.parentNode?.closest?.(selector) ?? null; }
  matches(selector) { return matches(this, selector); }
  contains(other) { return other === this; }
  querySelectorAll(selector) { return queryAll(this, selector); }
  querySelector(selector) { return queryAll(this, selector)[0] ?? null; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(type, list.filter((item) => item !== fn));
  }
  dispatch(type, event) {
    const full = { type, ...event };
    full.target ??= this;
    full.currentTarget = this;
    full.preventDefault ??= () => { full.defaultPrevented = true; };
    full.stopPropagation ??= () => { full.propagationStopped = true; };
    for (const fn of this.listeners.get(type) ?? []) fn.call(this, full);
    if (!full.propagationStopped && this.parentNode?.dispatch) this.parentNode.dispatch(type, full);
  }
}

function camel(name) {
  return name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseSelector(selector) {
  const parsed = [];
  const parts = selector.trim().split(/\s+/);
  for (const part of parts) {
    const token = { tag: null, id: null, classes: [], attrs: [] };
    const re = /([a-zA-Z0-9_-]+)?(#[-\w]+)?((?:\.[-\w]+)*)?((?:\[[^\]]*\])*)/g;
    let match;
    while ((match = re.exec(part))) {
      if (!match[0]) { re.lastIndex += 1; continue; }
      if (match[1]) token.tag = match[1].toUpperCase();
      if (match[2]) token.id = match[2].slice(1);
      if (match[3]) token.classes = match[3].split('.').filter(Boolean);
      for (const attr of match[4].matchAll(/\[([-\w]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) {
        token.attrs.push([attr[1], attr[2]]);
      }
    }
    parsed.push(token);
  }
  return parsed;
}

function matchesToken(el, token) {
  if (!token) return false;
  if (token.tag === '*' || token.tag === null) { /* any */ }
  else if (el.tagName !== token.tag) return false;
  if (token.id && el.id !== token.id) return false;
  if (token.classes.some((name) => !el.hasClass(name))) return false;
  for (const [name, value] of token.attrs) {
    if (!el.hasAttribute(name)) return false;
    if (value !== undefined) {
      const actual = el.getAttribute(name);
      if (name === 'class') {
        if (!String(actual).split(/\s+/).includes(value)) return false;
      } else if (actual !== value) return false;
    }
  }
  return true;
}

function matches(el, selector) {
  const tokens = parseSelector(selector);
  const target = tokens[tokens.length - 1];
  if (!matchesToken(el, target)) return false;
  let node = el.parentNode;
  for (let i = tokens.length - 2; i >= 0; i -= 1) {
    while (node && !matchesToken(node, tokens[i])) node = node.parentNode;
    if (!node) return false;
    node = node.parentNode;
  }
  return true;
}

function queryAll(root, selector) {
  const out = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (matches(child, selector)) out.push(child);
      visit(child);
    }
  };
  visit(root);
  return out;
}

const TAG = /<(\/?)([a-zA-Z0-9-]+)((?:\s+[-\w]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;

export function parseHtml(html) {
  const root = new El('#document');
  const stack = [root];
  let index = 0;
  let match;
  TAG.lastIndex = 0;
  while ((match = TAG.exec(html))) {
    const text = html.slice(index, match.index);
    if (text.trim()) stack[stack.length - 1].ownText += decode(text);
    index = TAG.lastIndex;
    const [, closing, tag, attrText, selfClose] = match;
    if (closing) {
      for (let i = stack.length - 1; i > 0; i -= 1) {
        if (stack[i].tagName === tag.toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    const el = new El(tag);
    for (const attr of attrText.matchAll(/([-\w]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      el.attributes.set(attr[1], decode(attr[2] ?? attr[3] ?? attr[4] ?? ''));
    }
    stack[stack.length - 1].children.push(el);
    el.parentNode = stack[stack.length - 1];
    if (!selfClose && !VOID.has(tag.toLowerCase())) stack.push(el);
  }
  const rest = html.slice(index);
  if (rest.trim()) stack[stack.length - 1].ownText += decode(rest);
  return root;
}

export function createDocument(htmlPath) {
  const file = htmlPath instanceof URL ? fileURLToPath(htmlPath) : htmlPath;
  const root = parseHtml(readFileSync(file, 'utf8'));
  const htmlEl = queryAll(root, 'html')[0];
  const docListeners = new Map();
  const document = {
    documentElement: htmlEl,
    head: queryAll(root, 'head')[0],
    body: queryAll(root, 'body')[0],
    title: 'Craft Workbench',
    readyState: 'complete',
    hidden: false,
    visibilityState: 'visible',
    cookie: '',
    getElementById: (id) => queryAll(root, `#${id}`)[0] ?? null,
    querySelector: (selector) => queryAll(root, selector)[0] ?? null,
    querySelectorAll: (selector) => queryAll(root, selector),
    createElement: (tag) => new El(tag),
    execCommand: () => true,
    createTextNode: (text) => { const el = new El('#text'); el.ownText = String(text); return el; },
    createDocumentFragment: () => new El('#fragment'),
    addEventListener: (type, fn) => docListeners.set(type, [...(docListeners.get(type) ?? []), fn]),
    removeEventListener: () => {},
    dispatchEvent: (event) => { for (const fn of docListeners.get(event.type) ?? []) fn(event); return true; },
    activeElement: null,
    hasFocus: () => true,
  };
  return document;
}
