// Runs the page's three scripts, suncalc.js, cities.js and then the compiled app.js, in a fresh
// node:vm context, one global scope as in a browser, with a stub of the page parts app.js touches and
// a clock fixed at a given instant. No browser and no DOM library: app.js is a classic script that
// reads the page as it loads, so it cannot be imported; this runs it as the page does, then lets a
// test search for a city, use the keyboard, switch tabs, type coordinates and a date, and press
// Calculate, through the same listeners the page uses.

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

type Listener = (event: StubEvent) => unknown;

/** What app.js reads from an event: the key, the target, and preventDefault. */
interface StubEvent {
  key?: string;
  target?: StubElement | null;
  prevented?: boolean;
  preventDefault?: () => void;
}

/** A page element with only what app.js uses. */
class StubElement {
  readonly tag: string;
  readonly id: string;
  textContent = '';
  value = '';
  #html = '';
  parent: StubElement | null = null;
  readonly attrs = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly children: StubElement[] = [];
  readonly listeners = new Map<string, Listener[]>();
  /** Like the DOM's DOMStringMap: every value is stored as text. */
  readonly dataset: Record<string, string> = new Proxy<Record<string, string>>({}, {
    set: (target, key, value): boolean => { if (typeof key === 'string') target[key] = String(value); return true; },
  });
  readonly classList = {
    toggle: (name: string, force?: boolean): boolean => {
      const on = force === undefined ? !this.classes.has(name) : force;
      if (on) this.classes.add(name); else this.classes.delete(name);
      return on;
    },
    contains: (name: string): boolean => this.classes.has(name),
  };
  /** The options of each scrollIntoView call, as JSON. */
  readonly scrolls: string[] = [];
  readonly page: { active: StubElement | null };
  constructor(page: { active: StubElement | null }, tag: string, id = '', classes: string[] = []) {
    this.page = page;
    this.tag = tag;
    this.id = id;
    for (const c of classes) this.classes.add(c);
  }
  get hidden(): boolean { return this.attrs.has('hidden'); }
  set hidden(on: boolean) { if (on) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  setAttribute(name: string, value: unknown): void { this.attrs.set(name, String(value)); }
  removeAttribute(name: string): void { this.attrs.delete(name); }
  getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
  /** Markup is only recorded; setting it empties the element's children, as the DOM does. */
  get innerHTML(): string { return this.#html; }
  set innerHTML(html: string) { this.#html = html; for (const c of this.children.splice(0)) c.parent = null; }
  appendChild(child: StubElement): StubElement { child.parent = this; this.children.push(child); return child; }
  querySelectorAll(selector: string): StubElement[] {
    if (selector !== 'li') throw new Error(`the stub has no querySelectorAll(${selector})`);
    return this.children.filter((c) => c.tag === 'li');
  }
  /** Only class selectors (".name"), checked on this element and then up through its parents. */
  closest(selector: string): StubElement | null {
    if (!selector.startsWith('.')) throw new Error(`the stub has no closest(${selector})`);
    for (let e: StubElement | null = this; e; e = e.parent) if (e.classes.has(selector.slice(1))) return e;
    return null;
  }
  focus(): void { this.page.active = this; }
  scrollIntoView(options?: unknown): void { this.scrolls.push(JSON.stringify(options ?? null)); }
  addEventListener(type: string, fn: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  /** Calls the listeners for type with event, and returns what they returned. */
  fire(type: string, event: StubEvent = {}): unknown[] { return (this.listeners.get(type) ?? []).map((fn) => fn(event)); }
}
// The kind app.js checks with instanceof for its text fields.
class StubInput extends StubElement {}

/** What the page shows, read from the stub after a step. */
export interface PageState {
  tabs: { id: string; active: boolean; selected: string | null }[];
  panels: { city: boolean; gps: boolean };
  search: { value: string; expanded: string | null };
  dropdown: { hidden: boolean; items: { index: string; role: string | null; selected: string | null; highlighted: boolean; html: string }[] };
  selected: { hidden: boolean; text: string };
  lat: { value: string; invalid: string | null; error: string; errorHidden: boolean };
  lon: { value: string; invalid: string | null; error: string; errorHidden: boolean };
  echo: { text: string; hidden: boolean };
  date: string;
  error: { text: string; hidden: boolean };
  results: {
    hidden: boolean; place: string; date: string; tz: string; icon: string; southern: boolean;
    phase: string; lit: string; range: string; note: string; spring: string; neap: string;
  };
  loadingHidden: boolean;
  focus: string | null;
  /** scrollIntoView calls on the results card, and timers waiting to run. */
  scrolls: string[];
  timers: number;
}

export interface Page {
  state(): PageState;
  /** Types text into the city search, as the input event delivers it. */
  typeCity(text: string): void;
  /** A key pressed in the city search; true when the page called preventDefault. */
  key(key: string): boolean;
  /** The pointer enters, or clicks, dropdown row i. */
  hover(i: number): void;
  clickRow(i: number): void;
  /** A click somewhere on the page: in the search box, or on the results card. */
  click(where: 'search' | 'outside'): void;
  /** The clear button of the selected city. */
  clearCity(): void;
  /** A tab button. */
  tab(which: 'city' | 'gps'): void;
  /** Types into a coordinate field, as the input event delivers it. */
  typeCoord(which: 'lat' | 'lon', text: string): void;
  /** Sets the date field (the page reads it on Calculate). */
  setDate(value: string): void;
  /** Presses Calculate and waits for its handler to finish. */
  calculate(): Promise<void>;
  /** Runs the timers the page set (the results card's scroll). */
  runTimers(): void;
  /** Evaluates an expression in the page's global scope and returns it as JSON. */
  evaluate(expression: string): string;
}

/** Loads suncalc.js, cities.js and app.js from root (a directory URL) at the instant now, and fires DOMContentLoaded. */
export function loadPage(root: URL, now: number): Page {
  const doc: { active: StubElement | null } = { active: null };
  const el = (tag: string, id: string, classes: string[] = []): StubElement => new StubElement(doc, tag, id, classes);
  const input = (id: string): StubInput => new StubInput(doc, 'input', id);

  const tabCity = el('button', 'tab-city', ['tab', 'active']);
  tabCity.dataset.tab = 'city';
  tabCity.setAttribute('aria-selected', 'true');
  const tabGps = el('button', 'tab-gps', ['tab']);
  tabGps.dataset.tab = 'gps';
  tabGps.setAttribute('aria-selected', 'false');
  const wrapper = el('div', '', ['search-wrapper']);
  const search = wrapper.appendChild(input('city-search'));
  search.setAttribute('aria-expanded', 'false');
  const dropdown = wrapper.appendChild(el('ul', 'city-dropdown'));
  const hide = (e: StubElement): StubElement => { e.hidden = true; return e; };
  const all: StubElement[] = [
    tabCity, tabGps, el('div', 'panel-city'), hide(el('div', 'panel-gps')), search, hide(dropdown),
    hide(el('div', 'city-selected')), el('span', 'city-selected-text'), el('button', 'city-clear-btn'),
    input('lat-input'), input('lon-input'), hide(el('p', 'lat-error')), hide(el('p', 'lon-error')), hide(el('p', 'gps-echo')),
    input('date-input'), el('button', 'calculate-btn'), hide(el('p', 'error-msg')), hide(el('section', 'results-card')),
    el('span', 'res-place'), el('span', 'res-date'), el('span', 'res-tz'), el('span', 'res-moon-icon'), el('div', 'res-phase'),
    el('div', 'res-lit'), el('div', 'res-range'), el('p', 'res-range-note'), el('span', 'res-next-spring'),
    el('span', 'res-next-neap'), hide(el('div', 'loading-overlay')),
  ];
  const els = new Map<string, StubElement>(all.map((e) => [e.id, e]));
  const docListeners = new Map<string, Listener[]>();
  const timers: (() => void)[] = [];

  // The clock: new Date() and Date.now() give the fixed instant; every other use is the real Date.
  class FixedDate extends Date {
    constructor(...args: [] | [number | string | Date]) {
      if (args.length > 1) throw new Error('the stub clock takes at most one argument');
      if (args.length === 0) super(now); else super(args[0]);
    }
    static override now(): number { return now; }
  }

  const sandbox = {
    Date: FixedDate,
    Element: StubElement,
    HTMLElement: StubElement,
    HTMLInputElement: StubInput,
    setTimeout: (fn: () => void): number => timers.push(fn),
    document: {
      getElementById: (id: string): StubElement | null => els.get(id) ?? null,
      addEventListener: (type: string, fn: Listener): void => { docListeners.set(type, [...(docListeners.get(type) ?? []), fn]); },
      createElement: (tag: string): StubElement => el(tag, ''),
    },
  };
  const context = createContext(sandbox);
  runInContext('var window = globalThis;', context);
  for (const file of ['suncalc.js', 'cities.js', 'app.js']) {
    runInContext(readFileSync(new URL(file, root), 'utf8'), context, { filename: file });
  }
  const ready = docListeners.get('DOMContentLoaded');
  if (!ready || ready.length !== 1) throw new Error('app.js did not wait for DOMContentLoaded');
  for (const fn of ready) fn({});

  const get = (id: string): StubElement => {
    const e = els.get(id);
    if (!e) throw new Error(`no stub #${id}`);
    return e;
  };
  const row = (i: number): StubElement => {
    const li = dropdown.children[i];
    if (!li) throw new Error(`the dropdown has no row ${i}`);
    return li;
  };
  const coord = (which: 'lat' | 'lon'): PageState['lat'] => ({
    value: get(`${which}-input`).value, invalid: get(`${which}-input`).getAttribute('aria-invalid'),
    error: get(`${which}-error`).textContent, errorHidden: get(`${which}-error`).hidden,
  });
  const text = (id: string): string => get(id).textContent;
  return {
    state: () => ({
      tabs: [tabCity, tabGps].map((t) => ({ id: t.id, active: t.classes.has('active'), selected: t.getAttribute('aria-selected') })),
      panels: { city: get('panel-city').hidden, gps: get('panel-gps').hidden },
      search: { value: search.value, expanded: search.getAttribute('aria-expanded') },
      dropdown: {
        hidden: dropdown.hidden,
        items: dropdown.children.map((li) => ({
          index: li.dataset.index ?? '', role: li.getAttribute('role'), selected: li.getAttribute('aria-selected'),
          highlighted: li.classes.has('highlighted'), html: li.innerHTML,
        })),
      },
      selected: { hidden: get('city-selected').hidden, text: text('city-selected-text') },
      lat: coord('lat'),
      lon: coord('lon'),
      echo: { text: text('gps-echo'), hidden: get('gps-echo').hidden },
      date: get('date-input').value,
      error: { text: text('error-msg'), hidden: get('error-msg').hidden },
      results: {
        hidden: get('results-card').hidden, place: text('res-place'), date: text('res-date'), tz: text('res-tz'),
        icon: text('res-moon-icon'), southern: get('res-moon-icon').classes.has('southern'), phase: text('res-phase'),
        lit: text('res-lit'), range: text('res-range'), note: text('res-range-note'), spring: text('res-next-spring'),
        neap: text('res-next-neap'),
      },
      loadingHidden: get('loading-overlay').hidden,
      focus: doc.active ? doc.active.id : null,
      scrolls: [...get('results-card').scrolls],
      timers: timers.length,
    }),
    typeCity: (value) => { search.value = value; search.fire('input'); },
    key: (key) => {
      const event: StubEvent = { key, prevented: false };
      event.preventDefault = (): void => { event.prevented = true; };
      search.fire('keydown', event);
      return event.prevented === true;
    },
    hover: (i) => { row(i).fire('mouseenter'); },
    clickRow: (i) => {
      const li = row(i);
      li.fire('click', { target: li });
      for (const fn of docListeners.get('click') ?? []) fn({ target: li });
    },
    click: (where) => {
      const target = where === 'search' ? search : get('results-card');
      for (const fn of docListeners.get('click') ?? []) fn({ target });
    },
    clearCity: () => { get('city-clear-btn').fire('click'); },
    tab: (which) => { (which === 'city' ? tabCity : tabGps).fire('click'); },
    typeCoord: (which, value) => { const e = get(`${which}-input`); e.value = value; e.fire('input'); },
    setDate: (value) => { get('date-input').value = value; },
    calculate: async () => { await Promise.all(get('calculate-btn').fire('click')); },
    runTimers: () => { for (const fn of timers.splice(0)) fn(); },
    evaluate: (expression) => String(runInContext(`JSON.stringify(${expression})`, context)),
  };
}
