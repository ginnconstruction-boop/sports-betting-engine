// ============================================================
// src/services/weatherData.ts
// Free weather data from open-meteo.com -- no API key needed
// Only relevant for outdoor sports: MLB, NFL, NCAAF
// ============================================================

import https from 'https';

export interface GameWeather {
  tempF: number;
  windMph: number;
  windDirection: string;
  precipitationMm: number;
  condition: string;
  weatherImpact: 'none' | 'low' | 'medium' | 'high';
  impactDetail: string;
}

const OUTDOOR_SPORTS = ['baseball_mlb', 'americanfootball_nfl', 'americanfootball_ncaaf'];

// Known stadium coordinates for major venues
// Supplemented by city-level lookup as fallback
const STADIUM_COORDS: Record<string, { lat: number; lon: number }> = {
  'Yankee Stadium': { lat: 40.8296, lon: -73.9262 },
  'Fenway Park': { lat: 42.3467, lon: -71.0972 },
  'Wrigley Field': { lat: 41.9484, lon: -87.6553 },
  'Dodger Stadium': { lat: 34.0739, lon: -118.2400 },
  'Oracle Park': { lat: 37.7786, lon: -122.3893 },
  'Truist Park': { lat: 33.8908, lon: -84.4681 },
  'Globe Life Field': { lat: 32.7473, lon: -97.0836 },
  'Minute Maid Park': { lat: 29.7573, lon: -95.3555 },
  'Camden Yards': { lat: 39.2838, lon: -76.6218 },
  'Guaranteed Rate Field': { lat: 41.8300, lon: -87.6339 },
  'PNC Park': { lat: 40.4469, lon: -80.0058 },
  'Great American Ball Park': { lat: 39.0979, lon: -84.5082 },
  'Coors Field': { lat: 39.7559, lon: -104.9942 },
  'Chase Field': { lat: 33.4453, lon: -112.0667 },
  'Petco Park': { lat: 32.7076, lon: -117.1570 },
};

// City fallback coords
const CITY_COORDS: Record<string, { lat: number; lon: number }> = {
  'New York': { lat: 40.7128, lon: -74.0060 },
  'Boston': { lat: 42.3601, lon: -71.0589 },
  'Chicago': { lat: 41.8781, lon: -87.6298 },
  'Los Angeles': { lat: 34.0522, lon: -118.2437 },
  'San Francisco': { lat: 37.7749, lon: -122.4194 },
  'Atlanta': { lat: 33.7490, lon: -84.3880 },
  'Dallas': { lat: 32.7767, lon: -96.7970 },
  'Houston': { lat: 29.7604, lon: -95.3698 },
  'Baltimore': { lat: 39.2904, lon: -76.6122 },
  'Pittsburgh': { lat: 40.4406, lon: -79.9959 },
  'Cincinnati': { lat: 39.1031, lon: -84.5120 },
  'Denver': { lat: 39.7392, lon: -104.9903 },
  'Phoenix': { lat: 33.4484, lon: -112.0740 },
  'San Diego': { lat: 32.7157, lon: -117.1611 },
  'Miami': { lat: 25.7617, lon: -80.1918 },
  'Seattle': { lat: 47.6062, lon: -122.3321 },
  'Minneapolis': { lat: 44.9778, lon: -93.2650 },
  'Cleveland': { lat: 41.4993, lon: -81.6944 },
  'Detroit': { lat: 42.3314, lon: -83.0458 },
  'Kansas City': { lat: 39.0997, lon: -94.5786 },
  'St. Louis': { lat: 38.6270, lon: -90.1994 },
  'Milwaukee': { lat: 43.0389, lon: -87.9065 },
  'Philadelphia': { lat: 39.9526, lon: -75.1652 },
  'Washington': { lat: 38.9072, lon: -77.0369 },
  'Oakland': { lat: 37.8044, lon: -122.2712 },
  'Tampa': { lat: 27.9506, lon: -82.4572 },
};

function fetchJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Weather parse failed')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(6000, () => { req.destroy(); reject(new Error('Weather timeout')); });
  });
}

function celsiusToF(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

function mpsToMph(mps: number): number {
  return Math.round(mps * 2.237);
}

function getWindDirection(degrees: number): string {
  const dirs = ['N','NE','E','SE','S','SW','W','NW'];
  return dirs[Math.round(degrees / 45) % 8];
}

function assessImpact(tempF: number, windMph: number, precipMm: number): {
  impact: 'none' | 'low' | 'medium' | 'high';
  detail: string;
} {
  const factors: string[] = [];
  let severity = 0;

  if (tempF < 35) { factors.push(`very cold (${tempF}degF)`); severity += 2; }
  else if (tempF < 45) { factors.push(`cold (${tempF}degF)`); severity += 1; }
  else if (tempF > 95) { factors.push(`extreme heat (${tempF}degF)`); severity += 1; }

  if (windMph >= 20) { factors.push(`strong wind (${windMph}mph)`); severity += 2; }
  else if (windMph >= 12) { factors.push(`moderate wind (${windMph}mph)`); severity += 1; }

  if (precipMm > 5) { factors.push(`heavy rain/snow`); severity += 3; }
  else if (precipMm > 1) { factors.push(`light precipitation`); severity += 1; }

  const impact = severity >= 4 ? 'high' : severity >= 2 ? 'medium' : severity >= 1 ? 'low' : 'none';
  const detail = factors.length > 0 ? factors.join(', ') : 'Clear conditions';

  return { impact, detail };
}

export async function getGameWeather(
  sportKey: string,
  venueName: string,
  city: string,
  gameTimeIso: string
): Promise<GameWeather | null> {
  if (!OUTDOOR_SPORTS.includes(sportKey)) return null;

  // Get coords -- try venue first, then city
  let coords = STADIUM_COORDS[venueName];
  if (!coords) {
    const cityKey = Object.keys(CITY_COORDS).find(k =>
      city.toLowerCase().includes(k.toLowerCase())
    );
    if (cityKey) coords = CITY_COORDS[cityKey];
  }
  if (!coords) return null;

  try {
    const gameDate = gameTimeIso.split('T')[0];
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&hourly=temperature_2m,windspeed_10m,winddirection_10m,precipitation&temperature_unit=celsius&windspeed_unit=ms&timezone=auto&start_date=${gameDate}&end_date=${gameDate}`;

    const data = await fetchJson(url) as any;
    const hourly = data?.hourly;
    if (!hourly) return null;

    // Find the hour closest to game time
    const gameHour = new Date(gameTimeIso).getHours();
    const idx = Math.min(gameHour, (hourly.time?.length ?? 1) - 1);

    const tempC = hourly.temperature_2m?.[idx] ?? 20;
    const windMps = hourly.windspeed_10m?.[idx] ?? 0;
    const windDeg = hourly.winddirection_10m?.[idx] ?? 0;
    const precipMm = hourly.precipitation?.[idx] ?? 0;
    const tempF = celsiusToF(tempC);
    const windMph = mpsToMph(windMps);

    const { impact, detail } = assessImpact(tempF, windMph, precipMm);

    return {
      tempF,
      windMph,
      windDirection: getWindDirection(windDeg),
      precipitationMm: Math.round(precipMm * 10) / 10,
      condition: detail,
      weatherImpact: impact,
      impactDetail: detail,
    };
  } catch {
    return null;
  }
}

export function isOutdoorSport(sportKey: string): boolean {
  return OUTDOOR_SPORTS.includes(sportKey);
}
