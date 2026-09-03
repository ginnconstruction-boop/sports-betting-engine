import test from 'node:test';
import assert from 'node:assert/strict';
import { compareToLine } from '../services/powerRatings';
import { deriveSelectedATS, selectedATSSituation } from '../services/atsDatabase';
import { enrichWithProbability } from '../services/probabilityEngine';
import { applyRisk } from '../services/riskEngine';
import { getGameWeather, parseKickoffWeather, WeatherVenue } from '../services/weatherData';

test('spread value direction respects home handicap including underdogs and sign changes', () => {
  for (const [ourLine, offered, expected] of [[-7,-3,'home'],[-3,-7,'away'],[7,10,'home'],
    [7,3,'away'],[-1,2,'home'],[2,-1,'away'],[0,0,'none'],[-3,-2,'none']] as const) {
    const result = compareToLine({ recentNetRating: -ourLine - 2.5 } as any,
      { recentNetRating: 0 } as any, offered, 'americanfootball_nfl');
    assert.equal(result.ourLine, ourLine);
    assert.equal(result.recommendation, expected);
  }
});
const now = Date.parse('2026-09-22T12:00Z');
const pick = { eventId: 'e1', betType: 'Spread', matchup: 'Away @ Home', side: 'Home',
  sportKey: 'americanfootball_nfl', pickedLine: 3, pickedBook: 'FanDuel',
  gameResult: 'WIN', date: '2026-09-20T12:00Z', gameTime: '2026-09-20T17:00Z', neutralSite: false };
test('ATS is idempotent, exact-line deduplicated, and skips ungraded/void/conflicting rows', () => {
  const data = [pick, { ...pick, pickId: 'copy' }, { ...pick, eventId: 'pending', gameResult: 'PENDING' },
    { ...pick, eventId: 'void', gameResult: 'VOID' }];
  const a = deriveSelectedATS(data, now);
  assert.deepEqual(a, deriveSelectedATS(data, now));
  assert.equal(a.rows.length, 1); assert.equal(a.duplicates, 1); assert.equal(a.excluded, 2);
  assert.equal(deriveSelectedATS([pick, { ...pick, gameResult: 'LOSS' }], now).rows.length, 0);
  assert.equal(deriveSelectedATS([{ ...pick, side: 'Unknown' }], now).rows.length, 0);
});
test('ATS home-underdog split is historical underdog-only, current season, known nonneutral', () => {
  const result = selectedATSSituation([pick,
    { ...pick, eventId: 'fav', pickedLine: -3, gameResult: 'LOSS' },
    { ...pick, eventId: 'neutral', neutralSite: true, gameResult: 'LOSS' },
    { ...pick, eventId: 'unknown', neutralSite: undefined, gameResult: 'LOSS' },
    { ...pick, eventId: 'old', date: '2025-09-20T12:00Z', gameTime: '2025-09-20T17:00Z', gameResult: 'LOSS' }],
    'americanfootball_nfl', 'Home', 'Away', 3, now);
  assert.deepEqual(result.homeAsUnderdog, { wins: 1, losses: 0, winPct: 100 });
  assert.equal(result.homeATS.gamesTracked, 4);
  assert.equal(result.atsScoreBonus, 0);
});
test('legacy enrichment strips invented and cached probabilities/edges without mutating score', () => {
  const input: any = { score: 80, bestPrice: -110, winProbability: .62, impliedEdge: .1,
    weightedAdjustedEdge: .12, adjustedEdge: .11, adjustedWinProbability: .61 };
  const [c] = applyRisk(enrichWithProbability([input]));
  assert.equal(c.score, 80); assert.equal(input.winProbability, .62);
  assert.equal(c.winProbability, undefined); assert.equal(c.adjustedWinProbability, undefined);
  assert.equal(c.adjustedEdge, undefined); assert.equal(c.weightedAdjustedEdge, undefined);
  assert.equal(c.impliedProbabilityFromBestPrice, 110 / 210);
  assert.equal(enrichWithProbability([{ ...input, bestPrice: 0 }])[0].impliedProbabilityFromBestPrice, undefined);
});
const kickoff = '2026-11-02T00:20:00Z'; // prior evening in Chicago; UTC/server timezone irrelevant
const weatherNow = Date.parse('2026-11-01T12:00Z');
const venue: WeatherVenue = { id: 'fixture', name: 'Verified test venue', latitude: 41, longitude: -87,
  roof: 'outdoor', source: 'test-fixture', verifiedAt: '2026-11-01T11:00Z' };
const weather = { hourly_units: { time: 'unixtime', temperature_2m: '°F', apparent_temperature: '°F',
  relative_humidity_2m: '%', precipitation_probability: '%', weather_code: 'wmo code', wind_speed_10m: 'mp/h',
  wind_gusts_10m: 'mp/h', precipitation: 'mm' }, hourly: {
  time: [Date.parse('2026-11-02T00:00Z') / 1000], temperature_2m: [42], wind_speed_10m: [16],
  apparent_temperature: [36], relative_humidity_2m: [71], precipitation_probability: [34], weather_code: [3],
  wind_gusts_10m: [25], wind_direction_10m: [90], precipitation: [0] } };
test('weather matches epoch kickoff across timezone/date/DST and rejects nulls and wrong units', () => {
  const result = parseKickoffWeather(weather, kickoff, venue, weatherNow);
  assert.equal(result.status, 'available'); assert.equal(result.tempF, 42);
  assert.equal(result.feelsLikeF, 36); assert.equal(result.humidityPct, 71);
  assert.equal(result.precipitationProbability, 34); assert.equal(result.weatherCode, 3);
  assert.deepEqual(result.diagnosticFlags, ['WIND_15_PLUS','GUST_25_PLUS']); assert.equal(result.severeWeatherFlag, true);
  assert.equal(result.forecastHour, '2026-11-02T00:00:00.000Z');
  assert.equal(result.providerIssuedAt, null); assert.equal(result.modelUse, 'context_only');
  assert.equal(parseKickoffWeather({ ...weather, hourly: { ...weather.hourly, wind_speed_10m: [null] } },
    kickoff, venue, weatherNow).status, 'unknown');
  assert.equal(parseKickoffWeather({ ...weather, hourly_units: {} }, kickoff, venue, weatherNow).status, 'unknown');
  assert.equal(parseKickoffWeather(weather, '2026-11-02T01:20Z', venue, weatherNow).status, 'unknown');
});
test('weather never guesses home-city coordinates, missing roof, indoor weather, or past forecasts', async () => {
  let calls = 0; const get = async () => { calls++; return weather; };
  const check = (v?: WeatherVenue, time = kickoff) => getGameWeather('americanfootball_nfl', '', 'New York Giants', time, v, get, weatherNow);
  assert.equal((await check()).status, 'unknown');
  assert.equal((await check({ ...venue, roof: 'unknown' })).status, 'unknown');
  assert.equal((await check({ ...venue, roof: 'indoor' })).status, 'indoor');
  assert.equal((await check(venue, '2026-10-31T00:00Z')).status, 'unknown');
  assert.equal(calls, 0);
  assert.equal((await check(venue)).status, 'available'); assert.equal(calls, 1);
});
