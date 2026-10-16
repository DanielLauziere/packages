// Shared display/format helpers used by both web and RN apps.
// UUID switches (printer types, permission labels) take plain strings so
// clients keep their own enums — the UUID values are identical everywhere.

export function toCents(cents: number): string {
  return `0${cents}`.slice(-2);
}

export function toSentenceCase(str: string): string {
  if (!str) return '';
  const lowerStr = str.toLowerCase();
  return lowerStr.charAt(0).toUpperCase() + lowerStr.slice(1);
}

export function toTitleCase(str: string): string {
  return str.replace(
    /\w\S*/g,
    (text) => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase(),
  );
}

export function shadeColor(color: string, percent: number): string {
  if (!color || color.length < 7 || !/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color;
  }
  let R = parseInt(color.substring(1, 3), 16);
  let G = parseInt(color.substring(3, 5), 16);
  let B = parseInt(color.substring(5, 7), 16);

  R = parseInt(`${(R * (100 + percent)) / 100}`);
  G = parseInt(`${(G * (100 + percent)) / 100}`);
  B = parseInt(`${(B * (100 + percent)) / 100}`);

  R = R < 255 ? R : 255;
  G = G < 255 ? G : 255;
  B = B < 255 ? B : 255;

  R = Math.round(R);
  G = Math.round(G);
  B = Math.round(B);

  const RR = R.toString(16).length == 1 ? '0' + R.toString(16) : R.toString(16);
  const GG = G.toString(16).length == 1 ? '0' + G.toString(16) : G.toString(16);
  const BB = B.toString(16).length == 1 ? '0' + B.toString(16) : B.toString(16);

  return '#' + RR + GG + BB;
}

export function isEmail(str: string): boolean {
  const reg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return reg.test(str);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function safe(v: any) {
  return v === undefined || v === '' ? null : v;
}

export function coerceBools<T extends Record<string, unknown>>(
  data: T,
  keys: string[],
): T {
  const out = { ...data } as Record<string, unknown>;
  for (const key of keys) {
    if (key in out) out[key] = Boolean(out[key]);
  }
  return out as T;
}

const PRINTER_TYPE_ESCPOS = '102e9428-4e72-4439-a97a-4b8d32fc7626';
const PRINTER_TYPE_RELAY = '8352ed8a-a0a8-4a11-b117-b241c0865f1a';

export function getPrinterTypeName(type: string): string {
  switch (type) {
    case PRINTER_TYPE_ESCPOS:
      return 'ESC POS';
    case PRINTER_TYPE_RELAY:
      return 'Relay';
    default:
      return 'Traditional';
  }
}

const PERM_UPDATE_LOYALTY = 'ba15e452-f491-4fe9-ac05-f632b06ea202';
const PERM_UPDATE_PERSONNEL = '3c3c424b-c10c-4598-9397-1247c8efc8b8';
const PERM_UPDATE_RESTAURANT = 'fa8caf79-6a89-4005-a84f-bfcb6a9d57b3';
const PERM_UPDATE_MENU = 'da320500-cff4-40e1-a041-8a5cd7aa3b45';
const PERM_ADJUST_ORDERS = 'df3eee32-488e-420f-843f-48b27295c892';
const PERM_SEE_TOTALS = '0d6aaf00-6303-44d7-9663-5782e4165e00';
const PERM_SEE_ANALYTICS = '885ffd6d-e223-447b-94af-452007ae119a';

export function getShortPermissionLabel(uuid: string): string {
  switch (uuid) {
    case PERM_UPDATE_LOYALTY:
      return 'permUpdateLoyalty';
    case PERM_UPDATE_PERSONNEL:
      return 'permUpdateStaff';
    case PERM_UPDATE_RESTAURANT:
      return 'permUpdateRestaurant';
    case PERM_UPDATE_MENU:
      return 'permUpdateMenu';
    case PERM_ADJUST_ORDERS:
      return 'permAdjustOrders';
    case PERM_SEE_TOTALS:
      return 'permSeeTotals';
    case PERM_SEE_ANALYTICS:
      return 'permSeeAnalytics';
    default:
      return uuid;
  }
}

export function toPostgresTimestampTz(date = new Date()): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  // microseconds (Postgres shows 6 digits)
  const microseconds = pad(date.getMilliseconds() * 1000, 6);

  // timezone offset
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = pad(Math.floor(absOffset / 60));
  const offsetMins = pad(absOffset % 60);

  const tzOffset = `${sign}${offsetHours}${offsetMins}`;

  // timezone abbreviation (CST, CDT, etc.)
  const tzName =
    Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
      .formatToParts(date)
      .find((p) => p.type === 'timeZoneName')?.value ?? '';

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${microseconds} ${tzOffset} ${tzName}`;
}

export const days = [
  { name: 'sunday' },
  { name: 'monday' },
  { name: 'tuesday' },
  { name: 'wednesday' },
  { name: 'thursday' },
  { name: 'friday' },
  { name: 'saturday' },
];

export const daysLetter = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
