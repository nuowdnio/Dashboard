// Wetter über Open-Meteo (kostenlos, kein API-Schlüssel nötig): https://open-meteo.com
const FORECAST_BASE = process.env.OPEN_METEO_BASE || 'https://api.open-meteo.com';
const GEO_BASE = process.env.OPEN_METEO_GEO_BASE || 'https://geocoding-api.open-meteo.com';
const CACHE_TTL_MS = 15 * 60 * 1000;

let cache = null; // { key, at, data }

async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    throw new Error(`Wetterdienst nicht erreichbar (${err.cause?.code || err.name}).`);
  }
  if (!res.ok) throw new Error(`Wetterdienst antwortet mit HTTP ${res.status}.`);
  return res.json();
}

/** Ortssuche, z. B. "Köln" -> [{ name, region, country, latitude, longitude }] */
export async function searchPlaces(name) {
  const url = new URL('/v1/search', GEO_BASE);
  url.search = new URLSearchParams({ name, count: '6', language: 'de', format: 'json' });
  const data = await getJson(url);
  return (data.results || []).map((r) => ({
    name: r.name,
    region: [r.admin1, r.country].filter(Boolean).join(', '),
    latitude: r.latitude,
    longitude: r.longitude,
  }));
}

export async function getForecast(location) {
  const key = `${location.latitude},${location.longitude}`;
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const url = new URL('/v1/forecast', FORECAST_BASE);
  url.search = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day',
    hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset',
    timezone: process.env.TZ || 'Europe/Berlin',
    forecast_days: '6',
    wind_speed_unit: 'kmh',
  });
  const raw = await getJson(url);

  // Stündliche Werte ab der aktuellen Stunde, 24 Stunden lang.
  const nowHour = raw.current.time.slice(0, 13);
  const startIdx = Math.max(0, raw.hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour));
  const hourly = raw.hourly.time.slice(startIdx, startIdx + 24).map((time, i) => ({
    time,
    temperature: raw.hourly.temperature_2m[startIdx + i],
    precipitationProbability: raw.hourly.precipitation_probability?.[startIdx + i] ?? null,
    precipitation: raw.hourly.precipitation?.[startIdx + i] ?? 0,
    code: raw.hourly.weather_code[startIdx + i],
    isDay: raw.hourly.is_day?.[startIdx + i] !== 0,
  }));

  const daily = raw.daily.time.map((date, i) => ({
    date,
    code: raw.daily.weather_code[i],
    max: raw.daily.temperature_2m_max[i],
    min: raw.daily.temperature_2m_min[i],
    precipitationProbability: raw.daily.precipitation_probability_max?.[i] ?? null,
    precipitationSum: raw.daily.precipitation_sum?.[i] ?? 0,
    sunrise: raw.daily.sunrise?.[i] ?? null,
    sunset: raw.daily.sunset?.[i] ?? null,
  }));

  const data = {
    location: location.name,
    current: {
      time: raw.current.time,
      temperature: raw.current.temperature_2m,
      feelsLike: raw.current.apparent_temperature,
      humidity: raw.current.relative_humidity_2m,
      precipitation: raw.current.precipitation,
      windSpeed: raw.current.wind_speed_10m,
      code: raw.current.weather_code,
      isDay: raw.current.is_day !== 0,
    },
    hourly,
    daily,
    fetchedAt: new Date().toISOString(),
  };
  cache = { key, at: Date.now(), data };
  return data;
}

export function clearWeatherCache() {
  cache = null;
}
