export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type Gateway = Coordinates & {
  name: string;
};

const EARTH_RADIUS_METERS = 6371000;

// Roads used to leave and enter Stockholm at street level.
export const GATEWAYS: Gateway[] = [
  { name: 'sydväst', latitude: 59.286361, longitude: 17.943944 },
  { name: 'söder', latitude: 59.248528, longitude: 18.099667 },
  { name: 'öst', latitude: 59.315306, longitude: 18.250667 },
  { name: 'norr', latitude: 59.392, longitude: 17.991222 }
];

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

export const distanceMeters = (from: Coordinates, to: Coordinates): number => {
  const deltaLatitude = toRadians(to.latitude - from.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
};

// Compass bearing in degrees, 0 = north and 90 = east.
export const bearing = (from: Coordinates, to: Coordinates): number => {
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);
  const deltaLongitude = toRadians(to.longitude - from.longitude);
  const y = Math.sin(deltaLongitude) * Math.cos(toLatitude);
  const x = Math.cos(fromLatitude) * Math.sin(toLatitude) - Math.sin(fromLatitude) * Math.cos(toLatitude) * Math.cos(deltaLongitude);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};

const angleBetween = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

const closestGateway = (from: Coordinates, direction: number): Gateway =>
  GATEWAYS.reduce((best, gateway) => (angleBetween(bearing(from, gateway), direction) < angleBetween(bearing(from, best), direction) ? gateway : best));

// The long way leaves the origin heading away from the destination.
export const pickExit = (origin: Coordinates, destination: Coordinates): Gateway => closestGateway(origin, (bearing(origin, destination) + 180) % 360);

// Where the last leg on the globe ends.
export const SLUSSEN: Coordinates = { latitude: 59.3195, longitude: 18.0722 };

// Approximate jetties in waters that connect to Mälaren or the Baltic Sea.
const JETTIES: Coordinates[] = [
  { latitude: 59.2647, longitude: 17.8836 },
  { latitude: 59.285, longitude: 17.893 },
  { latitude: 59.301, longitude: 18.05 },
  { latitude: 59.3035, longitude: 18.096 },
  { latitude: 59.238, longitude: 18.3 },
  { latitude: 59.317, longitude: 18.228 },
  { latitude: 59.3895, longitude: 18.02 },
  { latitude: 59.405, longitude: 18.005 }
];

export const nearestJetty = (from: Coordinates): Coordinates => JETTIES.reduce((best, jetty) => (distanceMeters(from, jetty) < distanceMeters(from, best) ? jetty : best));
