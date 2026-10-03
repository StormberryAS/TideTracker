/**
 * TideTracker: app.js
 * ================================================================
 * Moon phase, and from it the spring and neap tide cycle, for any
 * date and place. Every calculation runs in the browser.
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

'use strict';

/* ================================================================
   SECTION 1 — CITY DATABASE
   Format: { name, country, lat, lon, tz }
   Coverage: 25,007 cities worldwide, shared across every Labs app.
   Timezone IDs are IANA strings (used with Intl.DateTimeFormat).
================================================================ */
// The city catalogue lives in the shared cities.js, loaded by index.html
// before this file. Regenerate every app's copy with GitHub/update_cities.py.

/* ================================================================
   SECTION 2 — APP STATE
   A single object that tracks what's currently selected.
================================================================ */
const state = {
  tab: 'city',           // 'city' | 'gps'
  city: null,            // Selected city object from CITIES array
};

/* ================================================================
   SECTION 3 — DOM REFERENCES
   Grab all elements we need once at startup.
================================================================ */
const $ = id => document.getElementById(id);

const els = {
  // Tabs
  tabCity:   $('tab-city'),
  tabGps:    $('tab-gps'),
  // Panels
  panelCity:   $('panel-city'),
  panelGps:    $('panel-gps'),
  // City search
  citySearch:   $('city-search'),
  cityDropdown: $('city-dropdown'),
  citySelected: $('city-selected'),
  citySelectedText: $('city-selected-text'),
  cityClearBtn: $('city-clear-btn'),
  // GPS inputs
  latInput: $('lat-input'),
  lonInput: $('lon-input'),
  latError: $('lat-error'),
  lonError: $('lon-error'),
  gpsEcho:  $('gps-echo'),
  // Date
  dateInput: $('date-input'),
  // Calculate
  calculateBtn: $('calculate-btn'),
  errorMsg:     $('error-msg'),
  // Results
  resultsCard: $('results-card'),
  resPlace:    $('res-place'),
  resDate:     $('res-date'),
  resTz:       $('res-tz'),
  resMoonIcon: $('res-moon-icon'),
  resPhase:    $('res-phase'),
  resLit:      $('res-lit'),
  resRange:    $('res-range'),
  resRangeNote: $('res-range-note'),
  resNextSpring: $('res-next-spring'),
  resNextNeap:   $('res-next-neap'),
  // Loading
  loadingOverlay: $('loading-overlay'),
};

/* ================================================================
   SECTION 4 — INITIALISE UI
================================================================ */
function init() {
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

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrapper')) closeDropdown();
  });

  // Editing a coordinate clears its error and the "Using ..." line, which
  // described the previous value, until the next Calculate.
  els.latInput.addEventListener('input', () => { setFieldError(els.latInput, els.latError, null); setEcho(null); });
  els.lonInput.addEventListener('input', () => { setFieldError(els.lonInput, els.lonError, null); setEcho(null); });

  // Calculate button
  els.calculateBtn.addEventListener('click', onCalculate);
}

/* ================================================================
   SECTION 5 — TAB SWITCHING
================================================================ */
function switchTab(tab) {
  state.tab = tab;

  // Update aria/visual state for all tabs
  [els.tabCity, els.tabGps].forEach(btn => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });

  // Show / hide panels
  // Using the 'hidden' attribute (which CSS maps to display:none)
  els.panelCity.hidden = (tab !== 'city');
  els.panelGps.hidden  = (tab !== 'gps');
}

/* ================================================================
   SECTION 6 — CITY SEARCH & DROPDOWN
================================================================ */
// Track which dropdown item is keyboard-highlighted
let highlightIndex = -1;

function onCityInput() {
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
  const startsWith = [], contains = [];
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
    li.dataset.index = i;
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
  els.cityDropdown._matches = matches;
  els.cityDropdown.removeAttribute('hidden');
  els.citySearch.setAttribute('aria-expanded', 'true');
}

function onCityKeydown(e) {
  const items = els.cityDropdown.querySelectorAll('li');

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setHighlight(Math.min(highlightIndex + 1, items.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setHighlight(Math.max(highlightIndex - 1, 0));
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (highlightIndex >= 0 && els.cityDropdown._matches) {
      selectCity(els.cityDropdown._matches[highlightIndex]);
    }
  } else if (e.key === 'Escape') {
    closeDropdown();
  }
}

function setHighlight(index) {
  const items = els.cityDropdown.querySelectorAll('li');
  items.forEach((li, i) => li.classList.toggle('highlighted', i === index));
  highlightIndex = index;
}

function selectCity(city) {
  state.city = city;
  els.citySearch.value = '';
  closeDropdown();

  // Show the selected-city badge
  els.citySelectedText.textContent = `${city.name}, ${city.country} (${city.tz})`;
  els.citySelected.removeAttribute('hidden');
}

function clearCity() {
  state.city = null;
  els.citySelected.setAttribute('hidden', '');
  els.citySearch.value = '';
  els.citySearch.focus();
}

function closeDropdown() {
  els.cityDropdown.setAttribute('hidden', '');
  els.citySearch.setAttribute('aria-expanded', 'false');
  els.cityDropdown.innerHTML = '';
}

/* ================================================================
   SECTION 7: TYPED NUMBERS
================================================================ */
// Shared Labs parser: accepts "60,39" and a Unicode minus, rejects anything else or out of range (null).
function parseDecimal(text, min, max) {
  if (text == null) return null;
  let s = String(text).trim().replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-').replace(/\s+/g, '');
  if (/^[+-]?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Show (msg) or clear (null) the inline message under one coordinate field. */
function setFieldError(input, errorEl, msg) {
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
function setEcho(text) {
  els.gpsEcho.textContent = text || '';
  els.gpsEcho.hidden = !text;
}

/* ================================================================
   SECTION 8: TIMEZONE RESOLUTION (NO NETWORK)
   No network calls. City zones come straight from the bundled city
   database, and typed coordinates resolve to the nearest known
   city's zone. Nothing hits the network.
================================================================ */
function nearestCityTimezone(lat, lon) {
  // Timezones are large political regions and the bundled city list is dense
  // near populated coasts, so the nearest city's zone is the correct one in
  // practice. Equirectangular distance is plenty for a nearest-neighbour pick.
  let best = null, bestDist = Infinity;
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

function resolveTimezone(lat, lon) {
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
function moonPhase(date) {
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
function phaseStep(phase) {
  return Math.floor(((phase + 1 / 16) % 1) * 8);
}

const PHASE_NAMES = [
  'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
  'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent',
];
const PHASE_ICONS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

/**
 * Where the tides stand in the spring and neap cycle. This follows the
 * moon's phase alone, which is why it can be stated for any place: the size
 * of the tide at a particular harbour is local and is not modelled here.
 */
function tideRange(step) {
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

/**
 * The first moment after `from` at which the phase reaches one of `targets`.
 * Steps six hours at a time, then halves the step until it is under a
 * second. Returns { time: Date, target } or null.
 */
function nextPhaseEvent(from, targets) {
  const STEP = 6 * 3600e3;
  const phaseAt = ms => moonPhase(new Date(ms));
  // How much of the cycle is left before the phase reaches x (0 to 1).
  const ahead = (p, x) => (((x - p) % 1) + 1) % 1;
  let best = null;
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

const EVENT_NAMES = { 0: 'New moon', 0.25: 'First quarter', 0.5: 'Full moon', 0.75: 'Last quarter' };

/* ================================================================
   SECTION 10: MAIN CALCULATE HANDLER
================================================================ */
async function onCalculate() {
  clearError();

  let lat, lon, tzInfo, placeLabel;

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
      showError(err.message);
      return;
    }
    showLoading(false);
  }

  const [year, month, day] = els.dateInput.value.split('-').map(Number);
  if (!year || !month || !day) { showError('Please select a valid date.'); return; }

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
function renderResults({ lat, tz, tzAbbr, dateStr, placeLabel, step, lit, range, nextSpring, nextNeap }) {
  els.resPlace.textContent = placeLabel;
  els.resDate.textContent  = dateStr;
  els.resTz.textContent    = tzAbbr ? `${tzAbbr} / ${tz}` : tz;

  els.resMoonIcon.textContent = PHASE_ICONS[step];
  // The icons show the moon as seen from the northern hemisphere. South of
  // the equator the lit side is the other way round, so mirror it there.
  els.resMoonIcon.classList.toggle('southern', lat < 0);
  els.resPhase.textContent = PHASE_NAMES[step];
  els.resLit.textContent   = `${lit}% lit`;

  els.resRange.textContent     = range.label;
  els.resRangeNote.textContent = range.note;

  const describe = ev => ev
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
function getTodayString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * 12:00 on the given calendar date in the given IANA zone, as a Date.
 * Falls back to 12:00 UTC if the zone is unknown to this browser.
 */
function zonedNoon(year, month, day, tzId) {
  const noonUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: tzId, hourCycle: 'h23',
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    // The zone's offset from UTC at instant ms, in milliseconds.
    const offsetAt = ms => {
      const parts = fmt.formatToParts(new Date(ms));
      const get = type => Number(parts.find(p => p.type === type).value);
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
function formatLongDate(date, tzId) {
  // Built from the parts: some browsers put a comma after the weekday.
  const parts = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tzId,
  }).formatToParts(date);
  const get = type => parts.find(p => p.type === type).value;
  return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`;
}

/**
 * Derives the short timezone abbreviation (e.g. "CEST") for a given
 * IANA timezone and date string, using the Intl API.
 *
 * @param {string} ianaId   - e.g. "Europe/Oslo"
 * @param {string} dateStr  - "YYYY-MM-DD"
 * @returns {string}        - e.g. "CEST"
 */
function getTimezoneAbbreviation(ianaId, dateStr) {
  try {
    const [y, mo, d] = dateStr.split('-').map(Number);
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
function showError(msg) {
  els.errorMsg.textContent = msg;
  els.errorMsg.removeAttribute('hidden');
  els.resultsCard.setAttribute('hidden', '');
}

/** Clear any visible error message */
function clearError() {
  els.errorMsg.setAttribute('hidden', '');
  els.errorMsg.textContent = '';
}

/** Show or hide the full-screen loading overlay */
function showLoading(show) {
  els.loadingOverlay.hidden = !show;
}

/* ================================================================
   SECTION 14: BOOTSTRAP
================================================================ */
// Run init once the DOM is fully parsed (script is at end of body,
// so this is essentially immediate, but we guard with DOMContentLoaded).
document.addEventListener('DOMContentLoaded', init);
