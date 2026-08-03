// weather.js — Open-Meteo adapter (free, no API key). Opt-in per trip.
// Two calls: geocode a place name -> lat/lon, then fetch a daily forecast.
// The forecast API only covers ~16 days ahead, so we clamp the date range and
// fall back to the default 7-day forecast for trips further out. Returns a
// plain snapshot the caller stores on the event; model.js interprets it.
const GEO = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const MAX_AHEAD_DAYS = 16;

export async function geocode(name) {
  const url = `${GEO}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not look up that place — check your connection.');
  const j = await res.json();
  const r = j && j.results && j.results[0];
  if (!r) throw new Error(`No place found for “${name}”.`);
  const place = [r.name, r.country_code].filter(Boolean).join(', ');
  return { lat: r.latitude, lon: r.longitude, place };
}

const daysBetween = (fromISO, toISO) => Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86400000);
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export async function fetchForecast({ lat, lon, place, startDate, nights, todayISO }) {
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lon), timezone: 'auto',
    daily: 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max',
  });
  const today = todayISO || new Date().toISOString().slice(0, 10);
  // Use the trip's own dates when they're inside the forecast horizon.
  if (startDate && daysBetween(today, startDate) >= 0 && daysBetween(today, startDate) <= MAX_AHEAD_DAYS) {
    const end = addDays(startDate, Math.max(0, Number(nights) || 0));
    params.set('start_date', startDate);
    params.set('end_date', daysBetween(today, end) > MAX_AHEAD_DAYS ? addDays(today, MAX_AHEAD_DAYS) : end);
  }
  const res = await fetch(`${FORECAST}?${params.toString()}`);
  if (!res.ok) throw new Error('Could not fetch the forecast — check your connection.');
  const j = await res.json();
  const dd = j.daily || {};
  const daily = (dd.time || []).map((date, i) => ({
    date,
    code: dd.weathercode?.[i] ?? 0,
    tmax: dd.temperature_2m_max?.[i],
    tmin: dd.temperature_2m_min?.[i],
    precipProb: dd.precipitation_probability_max?.[i] ?? 0,
    wind: dd.windspeed_10m_max?.[i] ?? 0,
  }));
  if (!daily.length) throw new Error('No forecast is available for those dates yet.');
  return { place, lat, lon, fetchedAt: new Date().toISOString(), daily };
}

// Convenience: geocode + forecast in one call.
export async function getWeather(destination, { startDate, nights, todayISO } = {}) {
  const g = await geocode(destination);
  return fetchForecast({ ...g, startDate, nights, todayISO });
}
