// Paketverfolgung. Die Kachel erscheint nur, wenn ein Paket erwartet wird.
// Für DHL gibt es mit einem kostenlosen API-Schlüssel (developer.dhl.com) automatisch den aktuellen Status;
// für alle anderen Paketdienste gibt es einen Direktlink zur Sendungsverfolgung.
const DHL_BASE = process.env.DHL_API_BASE || 'https://api-eu.dhl.com';
const CACHE_TTL_MS = 30 * 60 * 1000; // DHL erlaubt im Gratis-Tarif nur wenige Abrufe pro Tag

export const CARRIERS = {
  dhl: { name: 'DHL', url: (n) => `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${n}` },
  hermes: { name: 'Hermes', url: (n) => `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#${n}` },
  dpd: { name: 'DPD', url: (n) => `https://tracking.dpd.de/status/de_DE/parcel/${n}` },
  gls: { name: 'GLS', url: (n) => `https://gls-group.com/DE/de/paketverfolgung?match=${n}` },
  ups: { name: 'UPS', url: (n) => `https://www.ups.com/track?loc=de_DE&tracknum=${n}` },
  amazon: { name: 'Amazon', url: () => 'https://www.amazon.de/gp/css/order-history' },
  other: { name: 'Sonstige', url: () => '' },
};

export const STATUSES = ['expected', 'transit', 'out_for_delivery', 'delivered', 'problem'];

/** Paketdienst anhand der Sendungsnummer raten (nur Vorschlag, im Formular änderbar). */
export function guessCarrier(number) {
  const n = String(number || '').replace(/\s+/g, '').toUpperCase();
  if (!n) return 'other';
  if (/^1Z[0-9A-Z]{16}$/.test(n)) return 'ups';
  if (/^(JJD|JVGL|GM|LX|RX|CA|CX)/.test(n) || /^00340\d{15}$/.test(n)) return 'dhl';
  if (/^\d{14}$/.test(n)) return 'dpd';
  if (/^[A-Z0-9]{8}$/.test(n) || /^\d{11}$/.test(n)) return 'gls';
  if (/^(H\d{19}|\d{16})$/.test(n)) return 'hermes';
  if (/^\d{12}$|^\d{20}$/.test(n)) return 'dhl';
  if (/^TBA/.test(n)) return 'amazon';
  return 'other';
}

export function trackingUrl(pkg) {
  if (pkg.customUrl) return pkg.customUrl;
  const c = CARRIERS[pkg.carrier] || CARRIERS.other;
  return pkg.trackingNumber || pkg.carrier === 'amazon' ? c.url(encodeURIComponent(pkg.trackingNumber || '')) : '';
}

const dhlCache = new Map(); // trackingNumber -> { at, data }

const DHL_STATUS = {
  'pre-transit': 'expected',
  transit: 'transit',
  delivered: 'delivered',
  failure: 'problem',
};

/** Aktuellen Status bei DHL abfragen. Gibt null zurück, wenn nichts gefunden wurde. */
export async function fetchDhlStatus(apiKey, trackingNumber) {
  const hit = dhlCache.get(trackingNumber);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const url = new URL('/track/shipments', DHL_BASE);
  url.search = new URLSearchParams({ trackingNumber, language: 'de' });
  const res = await fetch(url, {
    headers: { 'DHL-API-Key': apiKey, Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) {
    dhlCache.set(trackingNumber, { at: Date.now(), data: null });
    return null;
  }
  if (res.status === 401) throw new Error('DHL-API-Schlüssel ungültig.');
  if (res.status === 429) throw new Error('DHL-Abruflimit erreicht, später erneut versuchen.');
  if (!res.ok) throw new Error(`DHL antwortet mit HTTP ${res.status}.`);

  const shipment = (await res.json()).shipments?.[0];
  if (!shipment) return null;
  const st = shipment.status || {};
  const text = `${st.status || ''} ${st.description || ''}`.toLowerCase();
  let status = DHL_STATUS[st.statusCode] || 'transit';
  if (status === 'transit' && /zustellfahrzeug|in zustellung|zusteller|out for delivery/.test(text)) status = 'out_for_delivery';

  const data = {
    status,
    statusText: st.description || st.status || '',
    location: st.location?.address?.addressLocality || '',
    updatedAt: st.timestamp || null,
    estimatedDelivery: shipment.estimatedTimeOfDelivery || shipment.estimatedDeliveryTimeFrame?.estimatedFrom || null,
  };
  dhlCache.set(trackingNumber, { at: Date.now(), data });
  return data;
}

export function clearDhlCache(trackingNumber) {
  if (trackingNumber) dhlCache.delete(trackingNumber);
  else dhlCache.clear();
}
