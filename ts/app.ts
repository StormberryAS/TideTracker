/*! TideTracker: app.js is compiled from ts/app.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the .ts, never the .js: the build
    refuses to overwrite a hand edit, and its check mode fails on one. */

/**
 * TideTracker: the page code
 * ================================================================
 * Moon phase, and from it the spring and neap tide cycle, for any
 * date and place. Every calculation runs in the browser.
 *
 * A classic script, not a module: index.html loads suncalc.js (the
 * vendored SunCalc 1.8.0, typed in ts/suncalc.d.ts) in the head, then
 * cities.js (the shared Labs city catalogue, typed in ts/cities.d.ts)
 * and app.js at the end of the body, and all three share one global
 * scope. This file has no import or export, so tsc compiles it to a
 * plain script at the same path (app.js). It keeps nothing in
 * localStorage.
 *
 * What it does NOT do: predict tide times or heights. Until
 * 2026-10-02 the page showed high and low tide times and a water
 * level bar, but they came from a hash of the coordinates, not from
 * any tide prediction (about 7 hours off at Bergen, and tides for
 * Madrid). They were removed on 2026-10-02. Real times need harmonic
 * constants for each port; do not bring back anything that looks
 * like a tide time without them.
 *
 * Libraries used:
 *   • SunCalc  (bundled locally): illuminated fraction of the moon
 *   • Intl API (built-in): time zones and dates
 *
 * Key design decisions:
 *   1. The moon's phase comes from its elongation, the angle between
 *      the moon and the sun along the ecliptic, using the main lunar
 *      terms in Meeus, Astronomical Algorithms (chapters 25 and 47).
 *      Checked against PyEphem for every new moon, quarter and full
 *      moon of 2026 and 2027: worst error 8 minutes. SunCalc's own
 *      phase was up to 6 hours out, enough to put a date a day wrong.
 *   2. Spring and neap follow the phase alone: spring tides, the
 *      larger ones, come around new and full moon; neap tides, the
 *      smaller ones, around the first and last quarter. That is
 *      astronomy. How big the tide is at a given place, and when, is
 *      local and is not modelled here.
 *   3. The phase is taken at local noon on the chosen date, in the
 *      place's own time zone. Cities carry their IANA zone in the
 *      bundled catalogue; typed coordinates take the nearest city's.
 *      There is no device-location option: the stormberry.as zone
 *      sends Permissions-Policy geolocation=(), which blocks it on
 *      every Labs host, so it was removed on 2026-10-02.
 * ================================================================
 */

/* ================================================================
   SECTION 1: CITY DATABASE
   Format: { name, country, lat, lon, tz }
   Coverage: 25,007 cities worldwide, shared across every Labs app.
   Timezone IDs are IANA strings (used with Intl.DateTimeFormat).
================================================================ */
// The city catalogue lives in the shared cities.js, loaded by index.html
// before this file. Regenerate every app's copy with GitHub/update_cities.py.

/* ================================================================
   SECTION 2: APP STATE
   A single object that tracks what's currently selected.
================================================================ */
const state: {
  /** 'city' | 'gps': the data-tab of the tab button last pressed. */
  tab: string | undefined;
  /** Selected city object from the CITIES array. */
  city: City | null;
} = {
  tab: 'city',
  city: null,
};

/* ================================================================
   SECTION 3: DOM REFERENCES
   Grab all elements we need once at startup.
================================================================ */
/** The element with this id, of this kind; the page always has it, so a miss is a broken page. */
function byId<T extends HTMLElement>(id: string, kind: { new (): T; prototype: T }): T {
  const el = document.getElementById(id);
  if (!(el instanceof kind)) throw new Error(`TideTracker: #${id} is missing from the page`);
  return el;
}

const els = {
  // Tabs
  tabCity:   byId('tab-city', HTMLElement),
  tabGps:    byId('tab-gps', HTMLElement),
  // Panels
  panelCity:   byId('panel-city', HTMLElement),
  panelGps:    byId('panel-gps', HTMLElement),
  // City search
  citySearch:   byId('city-search', HTMLInputElement),
  cityDropdown: byId('city-dropdown', HTMLElement),
  citySelected: byId('city-selected', HTMLElement),
  citySelectedText: byId('city-selected-text', HTMLElement),
  cityClearBtn: byId('city-clear-btn', HTMLElement),
  // GPS inputs
  latInput: byId('lat-input', HTMLInputElement),
  lonInput: byId('lon-input', HTMLInputElement),
  latError: byId('lat-error', HTMLElement),
  lonError: byId('lon-error', HTMLElement),
  gpsEcho:  byId('gps-echo', HTMLElement),
  // Date
  dateInput: byId('date-input', HTMLInputElement),
  // Calculate
  calculateBtn: byId('calculate-btn', HTMLElement),
  errorMsg:     byId('error-msg', HTMLElement),
  // Results
  resultsCard: byId('results-card', HTMLElement),
  resPlace:    byId('res-place', HTMLElement),
  resDate:     byId('res-date', HTMLElement),
  resTz:       byId('res-tz', HTMLElement),
  resMoonIcon: byId('res-moon-icon', HTMLElement),
  resPhase:    byId('res-phase', HTMLElement),
  resLit:      byId('res-lit', HTMLElement),
  resRange:    byId('res-range', HTMLElement),
  resRangeNote: byId('res-range-note', HTMLElement),
  resNextSpring: byId('res-next-spring', HTMLElement),
  resNextNeap:   byId('res-next-neap', HTMLElement),
  // Loading
  loadingOverlay: byId('loading-overlay', HTMLElement),
};

/* ================================================================
   SECTION 4: INITIALISE UI
================================================================ */
function init(): void {
  // Set date picker to today's local date (YYYY-MM-DD format)
  els.dateInput.value = getTodayString();

  // Wire up tab click events
  [els.tabCity, els.tabGps].forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Wire up city search
  els.citySearch.addEventListener('input', onCityInput);
  els.citySearch.addEventListener('keydown', onCityKeydown);
  els.cityClearBtn.addEventListener('click', clearCity);

  // Close dropdown when clicking outside. A click always lands on an element; anything else is
  // ignored, as before (where reading closest from it threw and stopped this handler).
  document.addEventListener('click', e => {
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('.search-wrapper')) closeDropdown();
  });

  // Editing a coordinate clears its error and the "Using ..." line, which
  // described the previous value, until the next Calculate.
  els.latInput.addEventListener('input', () => { setFieldError(els.latInput, els.latError, null); setEcho(null); });
  els.lonInput.addEventListener('input', () => { setFieldError(els.lonInput, els.lonError, null); setEcho(null); });

  // Calculate button
  els.calculateBtn.addEventListener('click', onCalculate);
}

/* ================================================================
   SECTION 5: TAB SWITCHING
================================================================ */
function switchTab(tab: string | undefined): void {
  state.tab = tab;

  // Update aria/visual state for all tabs
  [els.tabCity, els.tabGps].forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });

  // Show / hide panels
  // Using the 'hidden' attribute (which CSS maps to display:none)
  els.panelCity.hidden = (tab !== 'city');
  els.panelGps.hidden  = (tab !== 'gps');
}

/* ================================================================
   SECTION 6: CITY SEARCH AND DROPDOWN
================================================================ */
// Track which dropdown item is keyboard-highlighted
let highlightIndex = -1;
// The cities the dropdown last listed, for keyboard navigation (null until the first list).
let dropdownMatches: City[] | null = null;

function onCityInput(): void {
  const query = els.citySearch.value.trim().toLowerCase();
  highlightIndex = -1;

  if (query.length < 1) {
    closeDropdown();
    return;
  }

  // Filter cities: match on name OR country, prioritise name-starts-with
  const qf = foldQuery(query);
  // Prefix matches first. With 25,000 cities a bare substring filter
  // buries the obvious answer: "erdal" returned Cloverdale, South
  // Riverdale and Terdal ahead of Erdal, and with only 8 rows shown the
  // city being typed could fall off the list entirely.
  const startsWith: City[] = [], contains: City[] = [];
  for (const c of CITIES) {
    // c.alt is the folded English exonym where GeoNames stores the local
    // name, so "gothenburg" finds Goteborg and "cologne" finds Koeln.
    if (c.fold.startsWith(qf) || c.alt.startsWith(qf)) startsWith.push(c);
    else if (c.fold.includes(qf) || c.alt.includes(qf) || c.cfold.includes(qf)) contains.push(c);
  }
  const matches = startsWith.concat(contains).slice(0, 8); // Limit to 8 results for usability

  if (matches.length === 0) {
    closeDropdown();
    return;
  }

  // Build the dropdown list HTML
  els.cityDropdown.innerHTML = '';
  matches.forEach((city, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.dataset.index = String(i);
    li.innerHTML = `
      <span class="city-name">${city.name}</span>
      <span class="city-country">${city.country}</span>
    `;
    li.addEventListener('click', () => selectCity(city));
    li.addEventListener('mouseenter', () => {
      setHighlight(i);
    });
    els.cityDropdown.appendChild(li);
  });

  // Store matches so keyboard navigation can reference them
  dropdownMatches = matches;
  els.cityDropdown.removeAttribute('hidden');
  els.citySearch.setAttribute('aria-expanded', 'true');
}

function onCityKeydown(e: KeyboardEvent): void {
  const items = els.cityDropdown.querySelectorAll('li');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setHighlight(Math.min(highlightIndex + 1, items.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setHighlight(Math.max(highlightIndex - 1, 0));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (highlightIndex >= 0 && dropdownMatches) {
      // The index always comes from the listed rows, so the city is there.
      const city = dropdownMatches[highlightIndex];
      if (city !== undefined) selectCity(city);
    }
  } else if (e.key === 'Escape') {
    closeDropdown();
  }
}

function setHighlight(index: number): void {
  const items = els.cityDropdown.querySelectorAll('li');
  items.forEach((li, i) => li.classList.toggle('highlighted', i === index));
  highlightIndex = index;
}

function selectCity(city: City): void {
  state.city = city;
  els.citySearch.value = '';
  closeDropdown();

  // Show the selected-city badge
  els.citySelectedText.textContent = `${city.name}, ${city.country} (${city.tz})`;
  els.citySelected.removeAttribute('hidden');
}

function clearCity(): void {
  state.city = null;
  els.citySelected.setAttribute('hidden', '');
  els.citySearch.value = '';
  els.citySearch.focus();
}

function closeDropdown(): void {
  els.cityDropdown.setAttribute('hidden', '');
  els.citySearch.setAttribute('aria-expanded', 'false');
  els.cityDropdown.innerHTML = '';
}

/* ================================================================
   SECTION 7: TYPED NUMBERS
================================================================ */
// Shared Labs parser: accepts "60,39" and a Unicode minus, rejects anything else or out of range (null).
function parseDecimal(text: string | null | undefined, min: number, max: number): number | null {
  if (text == null) return null;
  let s = String(text).trim().replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-').replace(/\s+/g, '');
  if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Show (msg) or clear (null) the inline message under one coordinate field. */
function setFieldError(input: HTMLInputElement, errorEl: HTMLElement, msg: string | null): void {
  if (msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
    input.setAttribute('aria-invalid', 'true');
  } else {
    errorEl.textContent = '';
    errorEl.hidden = true;
    input.removeAttribute('aria-invalid');
  }
}

/** Show (text) or clear (null) the "Using ..." line. Cleared text, not just
 *  hidden: aria-describedby still reads a hidden element it points at. */
function setEcho(text: string | null): void {
  els.gpsEcho.textContent = text || '';
  els.gpsEcho.hidden = !text;
}

/* ================================================================
   SECTION 8: TIMEZONE RESOLUTION (NO NETWORK)
   No network calls. City zones come straight from the bundled city
   database, and typed coordinates resolve to the nearest known
   city's zone. Nothing hits the network.
================================================================ */
/** A place's IANA zone and its short name on the chosen date ("" when the browser has none). */
interface TzInfo {
  ianaId: string;
  abbreviation: string;
}

function nearestCityTimezone(lat: number, lon: number): string {
  // Timezones are large political regions and the bundled city list is dense
  // near populated coasts, so the nearest city's zone is the correct one in
  // practice. Equirectangular distance is plenty for a nearest-neighbour pick.
  let best: City | null = null, bestDist = Infinity;
  for (const c of CITIES) {
    let dLon = Math.abs(c.lon - lon);
    if (dLon > 180) dLon = 360 - dLon;
    const dLat = c.lat - lat;
    const x = dLon * Math.cos(((lat + c.lat) / 2) * Math.PI / 180);
    const dist = x * x + dLat * dLat;
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  return best ? best.tz : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
}

function resolveTimezone(lat: number, lon: number): TzInfo {
  const ianaId = nearestCityTimezone(lat, lon);
  return { ianaId, abbreviation: getTimezoneAbbreviation(ianaId, els.dateInput.value) };
}

/* ================================================================
   SECTION 9: MOON PHASE, AND THE SPRING AND NEAP CYCLE
================================================================ */
const RAD = Math.PI / 180;

/**
 * The moon's phase as a fraction of the cycle: 0 new moon, 0.25 first
 * quarter, 0.5 full moon, 0.75 last quarter. It is the moon's elongation
 * from the sun in ecliptic longitude, divided by 360 degrees, using the
 * largest terms of Meeus, Astronomical Algorithms, chapters 25 (sun) and
 * 47 (moon). Worst error against PyEphem over 2026 and 2027: 8 minutes.
 */
function moonPhase(date: Date): number {
  const T  = (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
  const D  = (297.8501921 + 445267.1114034 * T) * RAD;  // mean elongation
  const M  = (357.5291092 + 35999.0502909 * T) * RAD;   // sun's mean anomaly
  const Mp = (134.9633964 + 477198.8675055 * T) * RAD;  // moon's mean anomaly
  const F  = (93.2720950 + 483202.0175233 * T) * RAD;   // moon's argument of latitude
  const sun = 280.46646 + 36000.76983 * T
    + (1.914602 - 0.004817 * T) * Math.sin(M) + 0.019993 * Math.sin(2 * M);
  const moon = 218.3164477 + 481267.88123421 * T
    + 6.288774 * Math.sin(Mp) + 1.274027 * Math.sin(2 * D - Mp) + 0.658314 * Math.sin(2 * D)
    + 0.213618 * Math.sin(2 * Mp) - 0.185116 * Math.sin(M) - 0.114332 * Math.sin(2 * F)
    + 0.058793 * Math.sin(2 * D - 2 * Mp) + 0.057066 * Math.sin(2 * D - M - Mp)
    + 0.053322 * Math.sin(2 * D + Mp) + 0.045758 * Math.sin(2 * D - M)
    - 0.040923 * Math.sin(M - Mp) - 0.034720 * Math.sin(D) - 0.030383 * Math.sin(M + Mp);
  return ((((moon - sun) % 360) + 360) % 360) / 360;
}

/**
 * One of eight phase steps, each an eighth of the cycle centred on its
 * phase (the same bands MoonApp uses): 0 new moon, 2 first quarter,
 * 4 full moon, 6 last quarter, and the crescents and gibbous moons between.
 */
function phaseStep(phase: number): number {
  return Math.floor(((phase + 1 / 16) % 1) * 8);
}

const PHASE_NAMES = [
  'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
  'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent',
];
const PHASE_ICONS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

/** Where the tides stand: a short label and one sentence about it. */
interface TideRange {
  label: string;
  note: string;
}

/**
 * Where the tides stand in the spring and neap cycle. This follows the
 * moon's phase alone, which is why it can be stated for any place: the size
 * of the tide at a particular harbour is local and is not modelled here.
 */
function tideRange(step: number): TideRange {
  if (step === 0 || step === 4) {
    return { label: 'Spring tides',
      note: 'Spring tides are the larger tides, which come around new and full moon: high water is higher and low water lower than usual.' };
  }
  if (step === 2 || step === 6) {
    return { label: 'Neap tides',
      note: 'Neap tides are the smaller tides, which come around the first and last quarter: there is less difference than usual between high and low water.' };
  }
  if (step === 1 || step === 5) {
    return { label: 'Shrinking towards neap',
      note: 'Between spring and neap: the tides are getting smaller, towards the neap tides of the next quarter moon.' };
  }
  return { label: 'Growing towards spring',
    note: 'Between neap and spring: the tides are getting larger, towards the spring tides of the next new or full moon.' };
}

/** A moment at which the phase reaches one of the targets, and which target. */
interface PhaseEvent {
  time: Date;
  target: number;
}

/**
 * The first moment after `from` at which the phase reaches one of `targets`.
 * Steps six hours at a time, then halves the step until it is under a
 * second. Returns { time: Date, target } or null.
 */
function nextPhaseEvent(from: Date, targets: number[]): PhaseEvent | null {
  const STEP = 6 * 3600e3;
  const phaseAt = (ms: number): number => moonPhase(new Date(ms));
  // How much of the cycle is left before the phase reaches x (0 to 1).
  const ahead = (p: number, x: number): number => (((x - p) % 1) + 1) % 1;
  let best: PhaseEvent | null = null;
  for (const x of targets) {
    let t0 = from.getTime(), a0 = ahead(phaseAt(t0), x);
    for (let k = 0; k < 140; k++) {               // 35 days, more than one cycle
      const t1 = t0 + STEP, a1 = ahead(phaseAt(t1), x);
      if (a1 > a0 + 0.5) {                        // x was passed between t0 and t1
        let lo = t0, hi = t1;
        for (let j = 0; j < 16; j++) {
          const mid = (lo + hi) / 2;
          if (ahead(phaseAt(mid), x) > 0.5) hi = mid; else lo = mid;
        }
        if (!best || hi < best.time.getTime()) best = { time: new Date(hi), target: x };
        break;
      }
      t0 = t1; a0 = a1;
    }
  }
  return best;
}

const EVENT_NAMES: Record<number, string> = { 0: 'New moon', 0.25: 'First quarter', 0.5: 'Full moon', 0.75: 'Last quarter' };

/* ================================================================
   SECTION 10: MAIN CALCULATE HANDLER
================================================================ */
async function onCalculate(): Promise<void> {
  clearError();

  let lat: number | undefined, lon: number | undefined, tzInfo: TzInfo | undefined, placeLabel: string | undefined;

  if (state.tab === 'city') {
    if (!state.city) {
      showError('Please select a city from the search list first.');
      return;
    }
    lat = state.city.lat;
    lon = state.city.lon;
    tzInfo = { ianaId: state.city.tz, abbreviation: getTimezoneAbbreviation(state.city.tz, els.dateInput.value) };
    placeLabel = `${state.city.name}, ${state.city.country}`;

  } else if (state.tab === 'gps') {
    const latVal = parseDecimal(els.latInput.value, -90, 90);
    const lonVal = parseDecimal(els.lonInput.value, -180, 180);

    setFieldError(els.latInput, els.latError,
      latVal === null ? 'Enter a latitude between -90 and 90, such as 60.39 or 60,39.' : null);
    setFieldError(els.lonInput, els.lonError,
      lonVal === null ? 'Enter a longitude between -180 and 180, such as 5.32 or 5,32.' : null);

    if (latVal === null || lonVal === null) {
      // Do not compute, and do not leave an older result showing under the error.
      setEcho(null);
      els.resultsCard.setAttribute('hidden', '');
      (latVal === null ? els.latInput : els.lonInput).focus();
      return;
    }

    lat = latVal;
    lon = lonVal;
    // Echo the numbers actually used, so "6,5" visibly became 6.5.
    setEcho(`Using ${lat}, ${lon}`);
    placeLabel = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;

    showLoading(true);
    try {
      tzInfo = await resolveTimezone(lat, lon);
    } catch (err) {
      showLoading(false);
      showError(err instanceof Error ? err.message : String(err));
      return;
    }
    showLoading(false);
  }

  const [year, month, day] = els.dateInput.value.split('-').map(Number);
  if (!year || !month || !day) { showError('Please select a valid date.'); return; }

  // Only the two tabs set a place; the tab buttons are the only way to change the tab.
  if (lat === undefined || tzInfo === undefined || placeLabel === undefined) {
    throw new Error(`TideTracker: no place for the tab ${String(state.tab)}`);
  }

  // The moon moves about 12 degrees a day against the sun, so the hour
  // matters near a phase boundary: take noon on that date where the place is.
  const noon = zonedNoon(year, month, day, tzInfo.ianaId);

  const phase = moonPhase(noon);
  const step = phaseStep(phase);
  const lit = Math.round(SunCalc.getMoonIllumination(noon).fraction * 100);
  const nextSpring = nextPhaseEvent(noon, [0, 0.5]);
  const nextNeap = nextPhaseEvent(noon, [0.25, 0.75]);

  renderResults({
    lat, tz: tzInfo.ianaId, tzAbbr: tzInfo.abbreviation,
    dateStr: formatLongDate(new Date(Date.UTC(year, month - 1, day, 12)), 'UTC'),
    placeLabel, step, lit, range: tideRange(step),
    nextSpring, nextNeap,
  });
}

/* ================================================================
   SECTION 11: RESULTS RENDERING
================================================================ */
/** Everything the results card shows. */
interface Results {
  lat: number;
  tz: string;
  tzAbbr: string;
  dateStr: string;
  placeLabel: string;
  step: number;
  lit: number;
  range: TideRange;
  nextSpring: PhaseEvent | null;
  nextNeap: PhaseEvent | null;
}

function renderResults({ lat, tz, tzAbbr, dateStr, placeLabel, step, lit, range, nextSpring, nextNeap }: Results): void {
  els.resPlace.textContent = placeLabel;
  els.resDate.textContent  = dateStr;
  els.resTz.textContent    = tzAbbr ? `${tzAbbr} / ${tz}` : tz;

  // step is 0 to 7, so both lists have it; "?? ''" sets what the DOM made of a missing entry.
  els.resMoonIcon.textContent = PHASE_ICONS[step] ?? '';
  // The icons show the moon as seen from the northern hemisphere. South of
  // the equator the lit side is the other way round, so mirror it there.
  els.resMoonIcon.classList.toggle('southern', lat < 0);
  els.resPhase.textContent = PHASE_NAMES[step] ?? '';
  els.resLit.textContent   = `${lit}% lit`;

  els.resRange.textContent     = range.label;
  els.resRangeNote.textContent = range.note;

  const describe = (ev: PhaseEvent | null): string => ev
    ? `${EVENT_NAMES[ev.target]}, ${formatLongDate(ev.time, tz)}`
    : 'Not found';
  els.resNextSpring.textContent = describe(nextSpring);
  els.resNextNeap.textContent   = describe(nextNeap);

  els.resultsCard.removeAttribute('hidden');
  setTimeout(() => els.resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}

/* ================================================================
   SECTION 12: HELPER FUNCTIONS
================================================================ */

/**
 * Returns today's date as a YYYY-MM-DD string based on the
 * browser's local date (for the date-picker default).
 */
function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The value of one part of a formatted date; a missing part throws, as reading .value of undefined did. */
function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const part = parts.find(p => p.type === type);
  if (part === undefined) throw new TypeError(`TideTracker: the date has no ${type} part`);
  return part.value;
}

/**
 * 12:00 on the given calendar date in the given IANA zone, as a Date.
 * Falls back to 12:00 UTC if the zone is unknown to this browser.
 */
function zonedNoon(year: number, month: number, day: number, tzId: string): Date {
  const noonUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tzId, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    // The zone's offset from UTC at instant ms, in milliseconds.
    const offsetAt = (ms: number): number => {
      const parts = fmt.formatToParts(new Date(ms));
      const get = (type: Intl.DateTimeFormatPartTypes): number => Number(partValue(parts, type));
      return Date.UTC(get('year'), get('month') - 1, get('day'),
        get('hour'), get('minute'), get('second')) - ms;
    };
    // Twice, so a clock change between the two instants is still caught.
    let t = noonUtc - offsetAt(noonUtc);
    t = noonUtc - offsetAt(t);
    return new Date(t);
  } catch {
    return new Date(noonUtc);
  }
}

/**
 * A date in British prose form, such as "Friday 2 October 2026",
 * as the calendar reads in the given IANA zone.
 */
function formatLongDate(date: Date, tzId: string): string {
  // Built from the parts: some browsers put a comma after the weekday.
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tzId,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => partValue(parts, type);
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`;
}

/**
 * Derives the short timezone abbreviation (e.g. "CEST") for a given
 * IANA timezone and date string, using the Intl API.
 *
 * @param ianaId   e.g. "Europe/Oslo"
 * @param dateStr  "YYYY-MM-DD"
 * @returns        e.g. "CEST", or "" when there is none
 */
function getTimezoneAbbreviation(ianaId: string, dateStr: string): string {
  try {
    // A missing part is NaN, which is what the arithmetic below made of it before.
    const [y = NaN, mo = NaN, d = NaN] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));

    // 'short' timeZoneName gives us the abbreviation like "CEST", "PST" etc.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: ianaId,
      timeZoneName: 'short',
    }).formatToParts(date);

    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : '';
  } catch {
    return '';
  }
}


/* ================================================================
   SECTION 13: UI STATE HELPERS
================================================================ */

/** Display an error message below the calculate button, and hide any
 *  earlier result so it cannot be read as the answer to the new input. */
function showError(msg: string): void {
  els.errorMsg.textContent = msg;
  els.errorMsg.removeAttribute('hidden');
  els.resultsCard.setAttribute('hidden', '');
}

/** Clear any visible error message */
function clearError(): void {
  els.errorMsg.setAttribute('hidden', '');
  els.errorMsg.textContent = '';
}

/** Show or hide the full-screen loading overlay */
function showLoading(show: boolean): void {
  els.loadingOverlay.hidden = !show;
}

/* ================================================================
   SECTION 14: BOOTSTRAP
================================================================ */
// Run init once the DOM is fully parsed (script is at end of body,
// so this is essentially immediate, but we guard with DOMContentLoaded).
document.addEventListener('DOMContentLoaded', init);
