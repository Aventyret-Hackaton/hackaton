import type { Vector3 } from 'three';

import { type LatLon, samplePath } from './geo';
import { LEGS } from './journey';

export type Track = { points: Vector3[]; cumulative: number[]; length: number };

const buildTrack = (path: readonly LatLon[]): Track => {
  const points = samplePath(path, 0.5);
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulative.push(cumulative[index - 1] + points[index - 1].angleTo(points[index]));
  }
  return { points, cumulative, length: cumulative[cumulative.length - 1] };
};

// Unit vector at the given fraction of the track, written into target.
export const trackPoint = (track: Track, fraction: number, target: Vector3): Vector3 => {
  const distance = Math.min(1, Math.max(0, fraction)) * track.length;
  let index = 1;
  while (index < track.points.length - 1 && track.cumulative[index] < distance) {
    index += 1;
  }
  const span = track.cumulative[index] - track.cumulative[index - 1];
  const t = span > 0 ? (distance - track.cumulative[index - 1]) / span : 0;
  return target
    .copy(track.points[index - 1])
    .lerp(track.points[index], t)
    .normalize();
};

export const JOURNEY_TRACKS: readonly Track[] = LEGS.map((leg) => buildTrack(leg.path));
