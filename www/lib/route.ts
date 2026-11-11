import { Vector3 } from 'three';

export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type LongRoute = {
  distanceKm: number;
  // Unit vector on the globe at the given progress (0 = origin, 1 = destination).
  pointAt: (progress: number, target?: Vector3) => Vector3;
  // Axis the route circles around.
  axis: Vector3;
};

const EARTH_RADIUS_KM = 6371;
const MIN_ANGLE = 1e-9;

// Matches the UV mapping of three's SphereGeometry with an equirectangular map.
export const toUnitVector = ({ latitude, longitude }: Coordinates): Vector3 => {
  const phi = ((90 - latitude) * Math.PI) / 180;
  const theta = ((longitude + 180) * Math.PI) / 180;
  return new Vector3(-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
};

// The great circle through both points, travelled the long way around.
export const createLongRoute = (origin: Coordinates, destination: Coordinates): LongRoute => {
  const start = toUnitVector(origin);
  const end = toUnitVector(destination);
  const shortAngle = start.angleTo(end);

  const axis = new Vector3().crossVectors(start, end);
  if (shortAngle < MIN_ANGLE || axis.lengthSq() === 0) {
    // Identical points have no unique great circle, so head west around the globe.
    axis.set(0, 1, 0).cross(start);
  }
  axis.normalize();

  const longAngle = 2 * Math.PI - shortAngle;

  return {
    distanceKm: longAngle * EARTH_RADIUS_KM,
    axis,
    pointAt: (progress, target = new Vector3()) => target.copy(start).applyAxisAngle(axis, -progress * longAngle)
  };
};
