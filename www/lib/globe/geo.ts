import { Vector3 } from "three";

export type LatLon = readonly [latitude: number, longitude: number];

export const DEG = Math.PI / 180;

// Longitude 0 faces +z, east is +x and north is +y.
export const latLonToUnit = ([latitude, longitude]: LatLon): Vector3 => {
  const phi = latitude * DEG;
  const lambda = longitude * DEG;
  return new Vector3(
    Math.cos(phi) * Math.sin(lambda),
    Math.sin(phi),
    Math.cos(phi) * Math.cos(lambda),
  );
};

export const unitToLatLon = (unit: Vector3): LatLon => [
  Math.asin(Math.max(-1, Math.min(1, unit.y))) / DEG,
  Math.atan2(unit.x, unit.z) / DEG,
];

const slerp = (from: Vector3, to: Vector3, t: number): Vector3 => {
  const angle = from.angleTo(to);
  if (angle < 1e-6) return from.clone();
  const sine = Math.sin(angle);
  return from
    .clone()
    .multiplyScalar(Math.sin((1 - t) * angle) / sine)
    .addScaledVector(to, Math.sin(t * angle) / sine)
    .normalize();
};

// Unit vectors along the great-circle segments between the waypoints.
export const samplePath = (
  waypoints: readonly LatLon[],
  stepDegrees: number,
): Vector3[] => {
  const corners = waypoints.map(latLonToUnit);
  const points: Vector3[] = [corners[0].clone()];
  for (let index = 1; index < corners.length; index += 1) {
    const from = corners[index - 1];
    const to = corners[index];
    const steps = Math.max(
      1,
      Math.ceil(from.angleTo(to) / (stepDegrees * DEG)),
    );
    for (let step = 1; step <= steps; step += 1) {
      points.push(slerp(from, to, step / steps));
    }
  }
  return points;
};
