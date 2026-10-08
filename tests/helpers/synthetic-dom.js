'use strict';

// Small, intentionally strict DOM for offline VM integration tests. It parses
// generated markup instead of inventing nodes when an id is requested. Select
// values, option lists, detached nodes, datasets, and input strings mirror the
// browser behavior needed by these forms. This is not a browser/layout engine.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const decode = text => String(text).replace(/&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g, x => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&#x27;':"'",'&nbsp;':' '}[x]));
const dataKey = name => name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class Element {
  constructor(tagName, document, attrs = {}) {
    this.tagName = tagName.toUpperCase(); this.ownerDocument = document;
    this.attributes = {...attrs}; this.children = []; this.parentNode = null;
    this.dataset = {}; this._value = attrs.value ?? ''; this._text = ''; this._html = '';
    this.hidden = Object.hasOwn(attrs, 'hidden'); this.disabled = Object.hasOwn(attrs, 'disabled');
    this.checked = Object.hasOwn(attrs, 'checked'); this.selected = Object.hasOwn(attrs, 'selected');
    this.listeners = new Map();
    for (const [name, value] of Object.entries(attrs)) if (name.startsWith('data-')) this.dataset[dataKey(name)] = value;
  }
  get id() { return this.attributes.id || ''; }
  get isConnected() { return this === this.ownerDocument.root || !!this.parentNode?.isConnected; }
  get options() { return this.tagName === 'SELECT' ? this.querySelectorAll('option') : undefined; }
  get value() {
    if (this.tagName !== 'SELECT') return this.tagName === 'OPTION' && !Object.hasOwn(this.attributes, 'value') ? this.textContent : this._value;
    const options = this.options;
    if (this._selectionSet) return options.find(option => option.value === this._value)?.value ?? '';
    return (options.find(option => option.selected) || options[0])?.value ?? '';
  }
  set value(value) { this._value = String(value); if (this.tagName === 'SELECT') this._selectionSet = true; }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    for (const child of this.children) child.parentNode = null;
    this.children = []; this._html = String(html); this._text = ''; this._selectionSet = false;
    parseInto(this, this._html);
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(text) { for (const child of this.children) child.parentNode = null; this.children = []; this._html = ''; this._text = String(text); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  addEventListener(name, callback) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(callback); }
  focus() { this.ownerDocument.activeElement = this; }
  querySelectorAll(selector) {
    const matches = [], selectors = selector.split(',').map(value => value.trim());
    const visit = node => { for (const child of node.children) { if (selectors.some(value => matchesSelector(child, value))) matches.push(child); visit(child); } };
    visit(this); return matches;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { for (let node = this; node; node = node.parentNode) if (matchesSelector(node, selector)) return node; return null; }
  fire(type, extras = {}) {
    const event = {type, target:this, currentTarget:this, preventDefault(){this.defaultPrevented = true;}, ...extras};
    this['on'+type]?.(event); for (const callback of this.listeners.get(type) || []) callback(event); return event;
  }
  click() { if (!this.disabled) this.fire('click'); }
}
function matchesSelector(node, selector) {
  const parts = selector.trim().split(/\s+(?![^\[]*\])/);
  if (parts.length > 1) {
    if (!matchesSelector(node, parts.pop())) return false;
    const parentSelector = parts.join(' ');
    for (let parent = node.parentNode; parent; parent = parent.parentNode) if (matchesSelector(parent, parentSelector)) return true;
    return false;
  }
  let result = true;
  selector = selector.replace(/:not\(([^)]+)\)/g, (_, inner) => { if (matchesSelector(node, inner)) result = false; return ''; });
  selector = selector.replace(/:(checked|disabled)/g, (_, name) => { if (!node[name]) result = false; return ''; });
  selector = selector.replace(/\[([^\]=]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/g, (_, name, double, single, bare) => {
    const expected = double ?? single ?? bare;
    const actual = name === 'disabled' || name === 'checked' ? (node[name] ? '' : null) : node.getAttribute(name);
    if (actual === null || (expected !== undefined && actual !== expected)) result = false;
    return '';
  });
  selector = selector.replace(/#([\w-]+)/g, (_, id) => { if (node.id !== id) result = false; return ''; });
  selector = selector.replace(/\.([\w-]+)/g, (_, name) => { if (!(node.attributes.class || '').split(/\s+/).includes(name)) result = false; return ''; });
  if (selector && selector !== '*' && node.tagName.toLowerCase() !== selector.toLowerCase()) result = false;
  return result;
}
function parseInto(root, html) {
  const stack = [root];
  for (const match of html.matchAll(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+/g)) {
    const token = match[0];
    if (token.startsWith('<!--')) continue;
    if (!token.startsWith('<')) { stack.at(-1)._text += decode(token); continue; }
    const tag = token.match(/^<\/?([\w-]+)/)[1].toLowerCase();
    if (token.startsWith('</')) {
      let index = stack.length - 1;
      while (index > 0 && stack[index].tagName.toLowerCase() !== tag) index--;
      if (index > 0) stack.length = index;
      continue;
    }
    if (tag === 'option' && stack.at(-1).tagName === 'OPTION') stack.pop();
    const attrs = {}, raw = token.slice(token.indexOf(tag) + tag.length, -1);
    for (const attr of raw.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[attr[1]] = decode(attr[2] ?? attr[3] ?? attr[4] ?? '');
    const element = new Element(tag, root.ownerDocument, attrs); stack.at(-1).appendChild(element);
    if (!VOID.has(tag) && !token.endsWith('/>')) stack.push(element);
  }
}
function createDocument(html) {
  const document = {activeElement:null}; document.root = new Element('document', document);
  document.getElementById = id => document.root.querySelector('#'+id);
  document.querySelector = selector => document.root.querySelector(selector);
  document.querySelectorAll = selector => document.root.querySelectorAll(selector);
  document.createElement = tag => new Element(tag, document);
  document.addEventListener = (...args) => document.root.addEventListener(...args);
  document.root.innerHTML = html; return document;
}
module.exports = {createDocument};
