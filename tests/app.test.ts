// The page logic, run as the page runs it (tests/vm-page.ts): suncalc.js, cities.js, then the
// compiled app.js, with the clock fixed at 5 November 2026 12:00 in Oslo. The expected values are
// what the JavaScript before the move to TypeScript (commit f16b7b9) showed at that instant.

process.env.TZ = 'Europe/Oslo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPage, type PageState } from './vm-page.ts';

const NOW = Date.parse('2026-11-05T11:00:00Z');
const root = new URL('../', import.meta.url);

/** The rows of the dropdown as "name | country". */
const rows = (s: PageState): string[] =>
  s.dropdown.items.map((i) => [...i.html.matchAll(/<span class="city-[a-z]+">([^<]*)<\/span>/g)].map((m) => m[1]).join(' | '));

const GROWING = 'Between neap and spring: the tides are getting larger, towards the spring tides of the next new or full moon.';
const NEAP = 'Neap tides are the smaller tides, which come around the first and last quarter: there is less difference than usual between high and low water.';

test('load: today in the date field, the city tab open, nothing shown yet', () => {
  const s = loadPage(root, NOW).state();
  assert.equal(s.date, '2026-11-05');
  assert.deepEqual(s.tabs, [{ id: 'tab-city', active: true, selected: 'true' }, { id: 'tab-gps', active: false, selected: 'false' }]);
  assert.deepEqual(s.panels, { city: false, gps: true });
  assert.deepEqual([s.dropdown.hidden, s.selected.hidden, s.error.hidden, s.results.hidden, s.loadingHidden], [true, true, true, true, true]);
  assert.deepEqual([s.search.expanded, s.focus, s.timers], ['false', null, 0]);
});

test('the city search: prefix matches first, at most 8 rows, folded names and English exonyms', () => {
  const page = loadPage(root, NOW);
  page.typeCity('Berg');
  assert.deepEqual(rows(page.state()), [
    'Bergerac | France', 'Bergedorf | Germany', 'Bergheim | Germany', 'Bergisch Gladbach | Germany',
    'Bergkamen | Germany', 'Bergamo | Italy', 'Bergen | Norway', 'Bergen | The Netherlands',
  ]);
  assert.deepEqual([page.state().dropdown.hidden, page.state().search.expanded], [false, 'true']);
  assert.deepEqual(page.state().dropdown.items.map((i) => [i.index, i.role, i.selected]),
    Array.from({ length: 8 }, (_, i) => [String(i), 'option', 'false']));
  page.typeCity('erdal');
  assert.deepEqual(rows(page.state()).slice(0, 4), ['Erdal | Norway', 'Cloverdale | Canada', 'South Riverdale | Canada', 'Terdāl | India']);
  page.typeCity('gothenburg');
  assert.deepEqual(rows(page.state()), ['Göteborg | Sweden']);
  page.typeCity('tromso');
  assert.deepEqual(rows(page.state()), ['Tromsø | Norway']);
  page.typeCity('   ');
  assert.deepEqual([page.state().dropdown.hidden, page.state().dropdown.items.length, page.state().search.expanded], [true, 0, 'false']);
  page.typeCity('qqqqzz');
  assert.deepEqual([page.state().dropdown.hidden, page.state().dropdown.items.length], [true, 0]);
});

test('the keyboard and the pointer: highlight, choose, close, clear', () => {
  const page = loadPage(root, NOW);
  page.typeCity('bergen');
  assert.equal(page.key('ArrowDown'), true);
  page.key('ArrowDown');
  page.key('ArrowUp');
  assert.deepEqual(page.state().dropdown.items.map((i) => i.highlighted), [true, false, false, false, false, false, false, false]);
  page.hover(3);
  assert.deepEqual(page.state().dropdown.items.map((i) => i.highlighted), [false, false, false, true, false, false, false, false]);
  assert.equal(page.key('Escape'), false);
  assert.deepEqual([page.state().dropdown.hidden, page.state().dropdown.items.length, page.state().search], [true, 0, { value: 'bergen', expanded: 'false' }]);

  page.typeCity('bergen');
  page.key('ArrowDown');
  assert.equal(page.key('Enter'), true);
  assert.deepEqual(page.state().selected, { hidden: false, text: 'Bergen, Norway (Europe/Oslo)' });
  assert.deepEqual([page.state().search.value, page.state().dropdown.hidden], ['', true]);

  page.typeCity('tromso');
  page.click('search');
  assert.equal(page.state().dropdown.hidden, false, 'a click in the search box keeps the list');
  page.click('outside');
  assert.equal(page.state().dropdown.hidden, true, 'a click elsewhere closes it');
  page.typeCity('tromso');
  page.clickRow(0);
  assert.deepEqual(page.state().selected, { hidden: false, text: 'Tromsø, Norway (Europe/Oslo)' });

  page.clearCity();
  assert.deepEqual([page.state().selected.hidden, page.state().search.value, page.state().focus], [true, '', 'city-search']);
});

test('Calculate for a city: the phase at local noon, the lit fraction, the spring and neap cycle', async () => {
  const page = loadPage(root, NOW);
  await page.calculate();
  assert.deepEqual([page.state().error, page.state().results.hidden], [{ text: 'Please select a city from the search list first.', hidden: false }, true]);

  page.typeCity('bergen');
  page.key('ArrowDown');
  page.key('Enter');
  await page.calculate();
  const { hidden, ...shown } = page.state().results;
  assert.equal(hidden, false);
  assert.deepEqual(shown, {
    place: 'Bergen, Norway', date: 'Thursday 5 November 2026', tz: 'GMT+1 / Europe/Oslo', icon: '🌘', southern: false,
    phase: 'Waning crescent', lit: '14% lit', range: 'Growing towards spring', note: GROWING,
    spring: 'New moon, Monday 9 November 2026', neap: 'First quarter, Tuesday 17 November 2026',
  });
  assert.deepEqual([page.state().error.hidden, page.state().timers, page.state().scrolls], [true, 1, []]);
  page.runTimers();
  assert.deepEqual(page.state().scrolls, ['{"behavior":"smooth","block":"start"}']);

  page.setDate('2027-01-01');
  await page.calculate();
  assert.deepEqual([page.state().results.date, page.state().results.icon, page.state().results.phase, page.state().results.lit,
    page.state().results.range, page.state().results.note, page.state().results.spring, page.state().results.neap], [
    'Friday 1 January 2027', '🌗', 'Last quarter', '34% lit', 'Neap tides', NEAP,
    'New moon, Thursday 7 January 2027', 'First quarter, Friday 15 January 2027',
  ]);

  page.setDate('');
  await page.calculate();
  assert.deepEqual([page.state().error, page.state().results.hidden], [{ text: 'Please select a valid date.', hidden: false }, true]);
});

test('Calculate for coordinates: a decimal comma and a Unicode minus, the nearest city\'s zone, and refusals', async () => {
  const page = loadPage(root, NOW);
  page.tab('gps');
  assert.deepEqual([page.state().tabs.map((t) => [t.active, t.selected]), page.state().panels],
    [[[false, 'false'], [true, 'true']], { city: true, gps: false }]);

  page.typeCoord('lat', '\u221233,87');
  page.typeCoord('lon', '151,21');
  await page.calculate();
  assert.deepEqual(page.state().echo, { text: 'Using -33.87, 151.21', hidden: false });
  assert.deepEqual([page.state().results.hidden, page.state().results.place, page.state().results.tz, page.state().results.southern,
    page.state().results.lit, page.state().loadingHidden], [false, '-33.8700°, 151.2100°', 'GMT+11 / Australia/Sydney', true, '18% lit', true]);

  page.typeCoord('lat', '60,39');
  assert.deepEqual(page.state().echo, { text: '', hidden: true }, 'editing a coordinate clears the "Using" line');
  page.typeCoord('lon', '5,32');
  await page.calculate();
  assert.deepEqual([page.state().results.place, page.state().results.tz, page.state().results.southern, page.state().echo.text],
    ['60.3900°, 5.3200°', 'GMT+1 / Europe/Oslo', false, 'Using 60.39, 5.32']);

  page.typeCoord('lon', 'abc');
  await page.calculate();
  const s = page.state();
  assert.deepEqual([s.lat.invalid, s.lat.errorHidden, s.lon.invalid, s.lon.error, s.lon.errorHidden, s.focus, s.results.hidden, s.echo.hidden],
    [null, true, 'true', 'Enter a longitude between -180 and 180, such as 5.32 or 5,32.', false, 'lon-input', true, true]);
  page.typeCoord('lat', '91');
  await page.calculate();
  assert.deepEqual([page.state().lat.error, page.state().focus], ['Enter a latitude between -90 and 90, such as 60.39 or 60,39.', 'lat-input']);
  page.typeCoord('lon', '5');
  assert.deepEqual(page.state().lon, { value: '5', invalid: null, error: '', errorHidden: true });
});

test('the model: the phase, its eight steps, the next events, local noon and the date texts', () => {
  const page = loadPage(root, NOW);
  assert.equal(page.evaluate('moonPhase(new Date(Date.UTC(2026,10,5,11)))'), '0.87490188028108');
  assert.equal(page.evaluate('[Date.UTC(2026,0,3,12), Date.UTC(2026,4,31,12), Date.UTC(2026,10,24,12), Date.UTC(2027,5,15,0)].map(t => [moonPhase(new Date(t)), phaseStep(moonPhase(new Date(t)))])'),
    '[[0.5029994855776345,4],[0.5040611301308269,4],[0.4951475278607379,4],[0.3712341251785902,3]]');
  assert.equal(page.evaluate('[0, 0.03, 0.0625, 0.25, 0.4999, 0.5, 0.9375, 0.99].map(phaseStep)'), '[0,0,1,2,4,4,0,0]');
  assert.equal(page.evaluate('[0,1,2,3].map(s => tideRange(s).label)'), '["Spring tides","Shrinking towards neap","Neap tides","Growing towards spring"]');
  assert.equal(page.evaluate('[nextPhaseEvent(new Date(Date.UTC(2026,10,5,11)), [0,0.5]), nextPhaseEvent(new Date(Date.UTC(2026,10,5,11)), [0.25,0.75]), nextPhaseEvent(new Date(Date.UTC(2026,11,31,12)), [0,0.5])]'),
    '[{"time":"2026-11-09T07:04:41.359Z","target":0},{"time":"2026-11-17T11:50:51.013Z","target":0.25},{"time":"2027-01-07T20:25:21.936Z","target":0}]');
  assert.equal(page.evaluate("[zonedNoon(2026,3,29,'Europe/Oslo'), zonedNoon(2026,10,25,'Europe/Oslo'), zonedNoon(2026,11,5,'Nowhere/Zone'), zonedNoon(2026,11,5,'Pacific/Kiritimati')]"),
    '["2026-03-29T10:00:00.000Z","2026-10-25T11:00:00.000Z","2026-11-05T12:00:00.000Z","2026-11-04T22:00:00.000Z"]');
  assert.equal(page.evaluate("[getTimezoneAbbreviation('Europe/Oslo','2026-07-01'), getTimezoneAbbreviation('Europe/Oslo',''), getTimezoneAbbreviation('Bad/Zone','2026-07-01'), getTodayString(), formatLongDate(new Date(Date.UTC(2026,9,2,12)),'UTC')]"),
    '["GMT+2","","","2026-11-05","Friday 2 October 2026"]');
  assert.equal(page.evaluate("['60,39','\\u22125.5','1e3',' 7 ','+.5','6,','abc',null].map(t => parseDecimal(t, -90, 90))"), '[60.39,-5.5,null,7,0.5,null,null,null]');
});
