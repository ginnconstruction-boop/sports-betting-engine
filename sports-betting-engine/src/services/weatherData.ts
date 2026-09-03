import { fetchNflJson } from './nflResearch';
export interface WeatherVenue {
  id: string; name: string; latitude: number; longitude: number;
  roof: 'outdoor' | 'indoor' | 'retractable-open' | 'retractable-closed' | 'unknown';
  source: string; verifiedAt: string;
}
export interface GameWeather {
  tempF: number | null; windMph: number | null; gustMph: number | null;
  feelsLikeF:number|null;humidityPct:number|null;precipitationProbability:number|null;weatherCode:number|null;
  windDirection: string; precipitationMm: number | null; condition: string;diagnosticFlags:string[];severeWeatherFlag:boolean|null;
  weatherImpact: 'none' | 'low' | 'medium' | 'high' | 'unknown';
  impactDetail: string; status: 'available' | 'unknown' | 'indoor';
  kickoff: string; forecastHour: string | null; fetchedAt: string;
  providerIssuedAt: null; venue: WeatherVenue | null; source: string | null;
  modelUse: 'context_only';
}
const SPORTS = ['baseball_mlb', 'baseball_ncaa', 'americanfootball_nfl', 'americanfootball_ncaaf'];
function unknown(kickoff: string, venue: WeatherVenue | null, at: number, reason: string): GameWeather {
  return { tempF: null, feelsLikeF:null,humidityPct:null,precipitationProbability:null,weatherCode:null,windMph: null, gustMph: null, windDirection: 'Unknown', precipitationMm: null,diagnosticFlags:[],severeWeatherFlag:null,
    condition: reason, weatherImpact: 'unknown', impactDetail: reason, status: 'unknown',
    kickoff, forecastHour: null, fetchedAt: new Date(at).toISOString(), providerIssuedAt: null,
    venue, source: null, modelUse: 'context_only' };
}
/** API request uses explicit Fahrenheit/mph/mm and Unix UTC timestamps.
 * Observation time is not model issue time; the latter remains unknown.
 * Missing/partial rows never become mild weather. No fitted betting effect. */
export function parseKickoffWeather(data: any, kickoff: string, venue: WeatherVenue, fetchedAt: number): GameWeather {
  const result = unknown(kickoff, venue, fetchedAt, 'Weather unavailable at verified kickoff hour.');
  const target = Date.parse(kickoff);
  if (!Number.isFinite(target) || target <= fetchedAt) return result;
  const h = data?.hourly, units = data?.hourly_units;
  if (units?.time !== 'unixtime' || units.temperature_2m !== '°F'
    || units.wind_speed_10m !== 'mp/h' || units.wind_gusts_10m !== 'mp/h'
    || units.precipitation !== 'mm') return result;
  const hour = Math.floor(target / 3600_000) * 3600;
  const matches = (h?.time ?? []).map((t: number, i: number) => t === hour ? i : -1).filter((i: number) => i >= 0);
  if (matches.length !== 1) return result;
  const i = matches[0], fields = ['temperature_2m', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'precipitation'];
  const values = fields.map(k => h[k]?.[i]);
  if (values.some(v => typeof v !== 'number' || !Number.isFinite(v))) return result;
  const [temp, wind, gust, direction, precip] = values;
  if (temp < -130 || temp > 140 || wind < 0 || gust < 0 || precip < 0 || direction < 0 || direction > 360) return result;
  const optional=(key:string,min:number,max:number)=>{const v=h[key]?.[i];return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:null;},
    feels=optional('apparent_temperature',-150,160),humidity=optional('relative_humidity_2m',0,100),precipProbability=optional('precipitation_probability',0,100),code=optional('weather_code',0,99);
  const flags:string[]=[];if(wind>=20)flags.push('WIND_20_PLUS');else if(wind>=15)flags.push('WIND_15_PLUS');
  if(gust>=25)flags.push('GUST_25_PLUS');else if(gust>=20)flags.push('GUST_20_PLUS');if(precip>=7.6)flags.push('HEAVY_PRECIPITATION');
  if(temp>=95)flags.push('EXTREME_HEAT');if(temp<=32)flags.push('EXTREME_COLD');
  const detail = temp.toFixed(1) + ' F; wind ' + wind.toFixed(1) + ' mph; gust ' + gust.toFixed(1)
    + ' mph; previous-hour precipitation ' + precip.toFixed(1) + ' mm. Context only.';
  return { ...result, status: 'available', tempF: temp, windMph: wind, gustMph: gust,
    feelsLikeF:feels,humidityPct:humidity,precipitationProbability:precipProbability,weatherCode:code,diagnosticFlags:flags,severeWeatherFlag:flags.length>0,
    windDirection: ['N','NE','E','SE','S','SW','W','NW'][Math.round(direction / 45) % 8],
    precipitationMm: precip, forecastHour: new Date(hour * 1000).toISOString(), condition: detail,
    weatherImpact: 'none', impactDetail: detail };
}
export async function getGameWeather(sportKey: string, _venueName: string, _city: string, kickoff: string,
  venue?: WeatherVenue, get = fetchNflJson, now = Date.now()): Promise<GameWeather | null> {
  if (!isOutdoorSport(sportKey)) return null;
  const result = unknown(kickoff, venue ?? null, now, 'Verified venue coordinates/roof unavailable; weather not modeled.');
  // No city/nickname fallback: neutral/international fixtures cannot inherit
  // the nominal home team's stadium. No static guess for a retractable roof.
  if (!venue?.id || !venue.source || !Number.isFinite(Date.parse(venue.verifiedAt))
    || Date.parse(venue.verifiedAt) > now || !Number.isFinite(Date.parse(kickoff)) || Date.parse(kickoff) <= now
    || !Number.isFinite(venue.latitude) || Math.abs(venue.latitude) > 90
    || !Number.isFinite(venue.longitude) || Math.abs(venue.longitude) > 180) return result;
  if (venue.roof.startsWith('retractable-') && now - Date.parse(venue.verifiedAt) > 3600_000) return result;
  if (venue.roof === 'indoor' || venue.roof === 'retractable-closed') return { ...result, status: 'indoor',
    weatherImpact: 'none', condition: 'Roof closed/indoor; outdoor weather not applicable.', impactDetail: 'Context only.' };
  if (!['outdoor', 'retractable-open'].includes(venue.roof)) return result;
  if (venue.roof === 'retractable-open' && now - Date.parse(venue.verifiedAt) > 3600_000) return result;
  const day = new Date(kickoff).toISOString().slice(0, 10);
  const source = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: String(venue.latitude), longitude: String(venue.longitude),
    hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability,precipitation,weather_code',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'mm',
    timeformat: 'unixtime', timezone: 'GMT', start_date: day, end_date: day }).toString();
  try { return { ...parseKickoffWeather(await get(source), kickoff, venue, now), source }; }
  catch { return { ...result, condition: 'Weather feed unavailable; no cached success or calm-weather substitution.', source }; }
}
export function isOutdoorSport(sportKey: string): boolean { return SPORTS.includes(sportKey); }
