import { type BufferGeometry, CatmullRomCurve3, InstancedMesh, type Material, Object3D, Vector3 } from 'three';

import { buildGull, buildVessel, FLEET, type Vessel } from '@/lib/city/harbour';
import { CITY_GROUND } from '@/lib/city/stockholm';
import { CITY_DEPTH, CITY_WIDTH } from '@/lib/city/stockholmMap';

// Voxel layer that the vessels float on: the top of the water.
const AFLOAT = 0.85;
const GULL_SIZE = 0.48;
// A gull flaps for a while and then glides, in seconds.
const FLAP_SECONDS = 1.9;
const GLIDE_SECONDS = 2.3;
const FLAPS_PER_SECOND = 9;
const FLAP_POSES = [0, 1, 2, 1];
const GLIDE_POSE = 1;
const BANK = 0.4;

// Gulls circle over the middle of the view. Offsets and radii are shares of the camera distance.
type Gull = {
  offset: readonly [east: number, south: number];
  radius: readonly [east: number, south: number];
  // Layers above the streets, cells per second and where on the circle it starts.
  height: number;
  speed: number;
  start: number;
};

const GULLS: readonly Gull[] = [
  { offset: [-0.2, -0.06], radius: [0.09, 0.07], height: 15, speed: 4.4, start: 0 },
  { offset: [0.21, 0.07], radius: [0.12, 0.09], height: 19, speed: -5, start: 2.1 },
  { offset: [0.02, -0.19], radius: [0.07, 0.06], height: 13, speed: 3.8, start: 4 },
  { offset: [-0.05, 0.12], radius: [0.3, 0.13], height: 22, speed: -5.6, start: 1 },
  { offset: [-0.02, 0.1], radius: [0.31, 0.15], height: 23, speed: -5.6, start: 1.25 }
];

export type CityLife = {
  // Where the opening shot looks, and from how far, in cells of the city map.
  setView: (x: number, z: number, distance: number) => void;
  update: (seconds: number) => void;
  dispose: () => void;
};

type Mover = { mesh: InstancedMesh; frames: readonly BufferGeometry[] };

// Vessels on the water and gulls in the air. The parent is the city, in cells of its map.
// Curve is how far the ground drops per cell squared from the middle of the map.
export const createCityLife = (parent: Object3D, material: Material, curve: number): CityLife => {
  const geometries: BufferGeometry[] = [];
  const spot = new Object3D();
  spot.rotation.order = 'YXZ';
  const point = new Vector3();
  const tangent = new Vector3();
  const view = { x: 0, z: 0, distance: 0 };

  const keep = (frames: BufferGeometry[]): BufferGeometry[] => {
    geometries.push(...frames);
    return frames;
  };

  // One instance each, so that the city material can let them dissolve with the city.
  const createMover = (frames: readonly BufferGeometry[]): Mover => {
    const mesh = new InstancedMesh(frames[0], material, 1);
    mesh.frustumCulled = false;
    parent.add(mesh);
    return { mesh, frames };
  };

  // East and south are measured from the middle of the map. The ground bends away under everything.
  const place = ({ mesh }: Mover, east: number, layer: number, south: number, heading: number, roll: number, pitch: number, size: number): void => {
    spot.position.set(east, layer - curve * (east * east + south * south), south);
    spot.rotation.set(roll, heading, pitch);
    spot.scale.setScalar(size);
    spot.updateMatrix();
    mesh.setMatrixAt(0, spot.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  };

  const vessels = FLEET.map((vessel: Vessel, index) => {
    const route = new CatmullRomCurve3(
      vessel.route.map(([x, z]) => new Vector3(x - CITY_WIDTH / 2, 0, z - CITY_DEPTH / 2)),
      true,
      'centripetal'
    );
    return { vessel, index, route, length: route.getLength(), mover: createMover(keep(buildVessel(vessel.kind))) };
  });
  const gullFrames = keep(buildGull());
  const gulls = GULLS.map((gull, index) => ({ gull, index, mover: createMover(gullFrames) }));

  const update = (seconds: number): void => {
    for (const { vessel, index, route, length, mover } of vessels) {
      const lap = vessel.lead + (seconds * vessel.speed) / length;
      const share = lap - Math.floor(lap);
      route.getPointAt(share, point);
      route.getTangentAt(share, tangent);
      const swell = seconds * 1.7 + index * 2.3;
      mover.mesh.geometry = mover.frames[Math.floor(seconds * vessel.beat) % mover.frames.length];
      place(
        mover,
        point.x,
        AFLOAT + Math.sin(swell) * 0.05,
        point.z,
        Math.atan2(-tangent.z, tangent.x),
        vessel.heel + Math.sin(swell * 0.8) * 0.05,
        Math.sin(swell * 1.3) * 0.025,
        vessel.size
      );
    }

    for (const { gull, index, mover } of gulls) {
      const radiusEast = gull.radius[0] * view.distance;
      const radiusSouth = gull.radius[1] * view.distance;
      const angle = gull.start + (seconds * gull.speed) / ((radiusEast + radiusSouth) / 2);
      const east = view.x + gull.offset[0] * view.distance + Math.cos(angle) * radiusEast;
      const south = view.z + gull.offset[1] * view.distance + Math.sin(angle) * radiusSouth;
      const turn = Math.sign(gull.speed);
      const heading = Math.atan2(-Math.cos(angle) * radiusSouth * turn, -Math.sin(angle) * radiusEast * turn);
      const beat = (seconds + index * 1.3) % (FLAP_SECONDS + GLIDE_SECONDS);
      const pose = beat < FLAP_SECONDS ? FLAP_POSES[Math.floor(beat * FLAPS_PER_SECOND) % FLAP_POSES.length] : GLIDE_POSE;
      mover.mesh.geometry = mover.frames[pose];
      place(mover, east, CITY_GROUND + gull.height + Math.sin(seconds * 0.7 + index) * 1.2, south, heading, turn * BANK, 0, GULL_SIZE);
    }
  };

  return {
    setView: (x, z, distance): void => {
      view.x = x - CITY_WIDTH / 2;
      view.z = z - CITY_DEPTH / 2;
      view.distance = distance;
    },
    update,
    dispose: (): void => {
      for (const geometry of geometries) geometry.dispose();
    }
  };
};
