"use strict";
/*! TideTracker: app.js is compiled from ts/app.ts by tools/build-ts.sh, which leaves out every
    comment but this one: the explanations are in the source. Edit the .ts, never the .js: the build
    refuses to overwrite a hand edit, and its check mode fails on one. */
const state = {
    tab: 'city',
    city: null,
};
function byId(id, kind) {
    const el = document.getElementById(id);
    if (!(el instanceof kind))
        throw new Error(`TideTracker: #${id} is missing from the page`);
    return el;
}
const els = {
    tabCity: byId('tab-city', HTMLElement),
    tabGps: byId('tab-gps', HTMLElement),
    panelCity: byId('panel-city', HTMLElement),
    panelGps: byId('panel-gps', HTMLElement),
    citySearch: byId('city-search', HTMLInputElement),
    cityDropdown: byId('city-dropdown', HTMLElement),
    citySelected: byId('city-selected', HTMLElement),
    citySelectedText: byId('city-selected-text', HTMLElement),
    cityClearBtn: byId('city-clear-btn', HTMLElement),
    latInput: byId('lat-input', HTMLInputElement),
    lonInput: byId('lon-input', HTMLInputElement),
    latError: byId('lat-error', HTMLElement),
    lonError: byId('lon-error', HTMLElement),
    gpsEcho: byId('gps-echo', HTMLElement),
    dateInput: byId('date-input', HTMLInputElement),
    calculateBtn: byId('calculate-btn', HTMLElement),
    errorMsg: byId('error-msg', HTMLElement),
    resultsCard: byId('results-card', HTMLElement),
    resPlace: byId('res-place', HTMLElement),
    resDate: byId('res-date', HTMLElement),
    resTz: byId('res-tz', HTMLElement),
    resMoonIcon: byId('res-moon-icon', HTMLElement),
    resPhase: byId('res-phase', HTMLElement),
    resLit: byId('res-lit', HTMLElement),
    resRange: byId('res-range', HTMLElement),
    resRangeNote: byId('res-range-note', HTMLElement),
    resNextSpring: byId('res-next-spring', HTMLElement),
    resNextNeap: byId('res-next-neap', HTMLElement),
    loadingOverlay: byId('loading-overlay', HTMLElement),
};
function init() {
    els.dateInput.value = getTodayString();
    [els.tabCity, els.tabGps].forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    els.citySearch.addEventListener('input', onCityInput);
    els.citySearch.addEventListener('keydown', onCityKeydown);
    els.cityClearBtn.addEventListener('click', clearCity);
    document.addEventListener('click', e => {
        const target = e.target;
        if (!(target instanceof Element))
            return;
        if (!target.closest('.search-wrapper'))
            closeDropdown();
    });
    els.latInput.addEventListener('input', () => { setFieldError(els.latInput, els.latError, null); setEcho(null); });
    els.lonInput.addEventListener('input', () => { setFieldError(els.lonInput, els.lonError, null); setEcho(null); });
    els.calculateBtn.addEventListener('click', onCalculate);
}
function switchTab(tab) {
    state.tab = tab;
    [els.tabCity, els.tabGps].forEach(btn => {
        const isActive = btn.dataset.tab === tab;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', String(isActive));
    });
    els.panelCity.hidden = (tab !== 'city');
    els.panelGps.hidden = (tab !== 'gps');
}
let highlightIndex = -1;
let dropdownMatches = null;
function onCityInput() {
    const query = els.citySearch.value.trim().toLowerCase();
    highlightIndex = -1;
    if (query.length < 1) {
        closeDropdown();
        return;
    }
    const qf = foldQuery(query);
    const startsWith = [], contains = [];
    for (const c of CITIES) {
        if (c.fold.startsWith(qf) || c.alt.startsWith(qf))
            startsWith.push(c);
        else if (c.fold.includes(qf) || c.alt.includes(qf) || c.cfold.includes(qf))
            contains.push(c);
    }
    const matches = startsWith.concat(contains).slice(0, 8);
    if (matches.length === 0) {
        closeDropdown();
        return;
    }
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
    dropdownMatches = matches;
    els.cityDropdown.removeAttribute('hidden');
    els.citySearch.setAttribute('aria-expanded', 'true');
}
function onCityKeydown(e) {
    const items = els.cityDropdown.querySelectorAll('li');
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight(Math.min(highlightIndex + 1, items.length - 1));
    }
    else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight(Math.max(highlightIndex - 1, 0));
    }
    else if (e.key === 'Enter') {
        e.preventDefault();
        if (highlightIndex >= 0 && dropdownMatches) {
            const city = dropdownMatches[highlightIndex];
            if (city !== undefined)
                selectCity(city);
        }
    }
    else if (e.key === 'Escape') {
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
function parseDecimal(text, min, max) {
    if (text == null)
        return null;
    let s = String(text).trim().replace(/[\u2212\u2012\u2013\u2014\uFE63\uFF0D]/g, '-').replace(/\s+/g, '');
    if (/^[+-]?\d+,\d+$/.test(s))
        s = s.replace(',', '.');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s))
        return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
}
function setFieldError(input, errorEl, msg) {
    if (msg) {
        errorEl.textContent = msg;
        errorEl.hidden = false;
        input.setAttribute('aria-invalid', 'true');
    }
    else {
        errorEl.textContent = '';
        errorEl.hidden = true;
        input.removeAttribute('aria-invalid');
    }
}
function setEcho(text) {
    els.gpsEcho.textContent = text || '';
    els.gpsEcho.hidden = !text;
}
function nearestCityTimezone(lat, lon) {
    let best = null, bestDist = Infinity;
    for (const c of CITIES) {
        let dLon = Math.abs(c.lon - lon);
        if (dLon > 180)
            dLon = 360 - dLon;
        const dLat = c.lat - lat;
        const x = dLon * Math.cos(((lat + c.lat) / 2) * Math.PI / 180);
        const dist = x * x + dLat * dLat;
        if (dist < bestDist) {
            bestDist = dist;
            best = c;
        }
    }
    return best ? best.tz : (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
}
function resolveTimezone(lat, lon) {
    const ianaId = nearestCityTimezone(lat, lon);
    return { ianaId, abbreviation: getTimezoneAbbreviation(ianaId, els.dateInput.value) };
}
const RAD = Math.PI / 180;
function moonPhase(date) {
    const T = (date.getTime() / 86400000 + 2440587.5 - 2451545) / 36525;
    const D = (297.8501921 + 445267.1114034 * T) * RAD;
    const M = (357.5291092 + 35999.0502909 * T) * RAD;
    const Mp = (134.9633964 + 477198.8675055 * T) * RAD;
    const F = (93.2720950 + 483202.0175233 * T) * RAD;
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
function phaseStep(phase) {
    return Math.floor(((phase + 1 / 16) % 1) * 8);
}
const PHASE_NAMES = [
    'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
    'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent',
];
const PHASE_ICONS = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
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
function nextPhaseEvent(from, targets) {
    const STEP = 6 * 3600e3;
    const phaseAt = (ms) => moonPhase(new Date(ms));
    const ahead = (p, x) => (((x - p) % 1) + 1) % 1;
    let best = null;
    for (const x of targets) {
        let t0 = from.getTime(), a0 = ahead(phaseAt(t0), x);
        for (let k = 0; k < 140; k++) {
            const t1 = t0 + STEP, a1 = ahead(phaseAt(t1), x);
            if (a1 > a0 + 0.5) {
                let lo = t0, hi = t1;
                for (let j = 0; j < 16; j++) {
                    const mid = (lo + hi) / 2;
                    if (ahead(phaseAt(mid), x) > 0.5)
                        hi = mid;
                    else
                        lo = mid;
                }
                if (!best || hi < best.time.getTime())
                    best = { time: new Date(hi), target: x };
                break;
            }
            t0 = t1;
            a0 = a1;
        }
    }
    return best;
}
const EVENT_NAMES = { 0: 'New moon', 0.25: 'First quarter', 0.5: 'Full moon', 0.75: 'Last quarter' };
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
    }
    else if (state.tab === 'gps') {
        const latVal = parseDecimal(els.latInput.value, -90, 90);
        const lonVal = parseDecimal(els.lonInput.value, -180, 180);
        setFieldError(els.latInput, els.latError, latVal === null ? 'Enter a latitude between -90 and 90, such as 60.39 or 60,39.' : null);
        setFieldError(els.lonInput, els.lonError, lonVal === null ? 'Enter a longitude between -180 and 180, such as 5.32 or 5,32.' : null);
        if (latVal === null || lonVal === null) {
            setEcho(null);
            els.resultsCard.setAttribute('hidden', '');
            (latVal === null ? els.latInput : els.lonInput).focus();
            return;
        }
        lat = latVal;
        lon = lonVal;
        setEcho(`Using ${lat}, ${lon}`);
        placeLabel = `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
        showLoading(true);
        try {
            tzInfo = await resolveTimezone(lat, lon);
        }
        catch (err) {
            showLoading(false);
            showError(err instanceof Error ? err.message : String(err));
            return;
        }
        showLoading(false);
    }
    const [year, month, day] = els.dateInput.value.split('-').map(Number);
    if (!year || !month || !day) {
        showError('Please select a valid date.');
        return;
    }
    if (lat === undefined || tzInfo === undefined || placeLabel === undefined) {
        throw new Error(`TideTracker: no place for the tab ${String(state.tab)}`);
    }
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
function renderResults({ lat, tz, tzAbbr, dateStr, placeLabel, step, lit, range, nextSpring, nextNeap }) {
    els.resPlace.textContent = placeLabel;
    els.resDate.textContent = dateStr;
    els.resTz.textContent = tzAbbr ? `${tzAbbr} / ${tz}` : tz;
    els.resMoonIcon.textContent = PHASE_ICONS[step] ?? '';
    els.resMoonIcon.classList.toggle('southern', lat < 0);
    els.resPhase.textContent = PHASE_NAMES[step] ?? '';
    els.resLit.textContent = `${lit}% lit`;
    els.resRange.textContent = range.label;
    els.resRangeNote.textContent = range.note;
    const describe = (ev) => ev
        ? `${EVENT_NAMES[ev.target]}, ${formatLongDate(ev.time, tz)}`
        : 'Not found';
    els.resNextSpring.textContent = describe(nextSpring);
    els.resNextNeap.textContent = describe(nextNeap);
    els.resultsCard.removeAttribute('hidden');
    setTimeout(() => els.resultsCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
}
function getTodayString() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function partValue(parts, type) {
    const part = parts.find(p => p.type === type);
    if (part === undefined)
        throw new TypeError(`TideTracker: the date has no ${type} part`);
    return part.value;
}
function zonedNoon(year, month, day, tzId) {
    const noonUtc = Date.UTC(year, month - 1, day, 12, 0, 0);
    try {
        const fmt = new Intl.DateTimeFormat('en-GB', {
            timeZone: tzId, hourCycle: 'h23',
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
        });
        const offsetAt = (ms) => {
            const parts = fmt.formatToParts(new Date(ms));
            const get = (type) => Number(partValue(parts, type));
            return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - ms;
        };
        let t = noonUtc - offsetAt(noonUtc);
        t = noonUtc - offsetAt(t);
        return new Date(t);
    }
    catch {
        return new Date(noonUtc);
    }
}
function formatLongDate(date, tzId) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tzId,
    }).formatToParts(date);
    const get = (type) => partValue(parts, type);
    return `${get('weekday')} ${get('day')} ${get('month')} ${get('year')}`;
}
function getTimezoneAbbreviation(ianaId, dateStr) {
    try {
        const [y = NaN, mo = NaN, d = NaN] = dateStr.split('-').map(Number);
        const date = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: ianaId,
            timeZoneName: 'short',
        }).formatToParts(date);
        const tzPart = parts.find(p => p.type === 'timeZoneName');
        return tzPart ? tzPart.value : '';
    }
    catch {
        return '';
    }
}
function showError(msg) {
    els.errorMsg.textContent = msg;
    els.errorMsg.removeAttribute('hidden');
    els.resultsCard.setAttribute('hidden', '');
}
function clearError() {
    els.errorMsg.setAttribute('hidden', '');
    els.errorMsg.textContent = '';
}
function showLoading(show) {
    els.loadingOverlay.hidden = !show;
}
document.addEventListener('DOMContentLoaded', init);
