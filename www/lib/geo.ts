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

// The long way leaves the origin heading away from the destination, and
// reaches the destination from the side facing away from the origin.
export const pickGateways = (origin: Coordinates, destination: Coordinates): { exit: Gateway; entry: Gateway } => ({
  exit: closestGateway(origin, (bearing(origin, destination) + 180) % 360),
  entry: closestGateway(destination, (bearing(destination, origin) + 180) % 360)
});
