import { BoxGeometry, Color, Fog, Group, InstancedBufferAttribute, InstancedMesh, MeshLambertMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';

import { createSurfaceLookup, SHALLOW, type Surface } from '@/lib/globe/earth';
import { DEG } from '@/lib/globe/geo';
import type { VehicleId } from '@/lib/globe/journey';
import { hash3, valueNoise3 } from '@/lib/voxel/hash';
import { VEHICLE_MODELS } from '@/lib/voxel/models';
import { P } from '@/lib/voxel/palette';
import { createPosedModel, type PosedModel } from '@/lib/voxel/posed';

import { type Motion, VEHICLES } from './globe/scene';
import { addVoxelLights } from './globe/thumbnails';

export type Traveller = {
  modelId: VehicleId;
  // Position on the globe.
  unit: Vector3;
  // Direction of travel along the globe, zero when there is none.
  heading: Vector3;
  // City streets instead of the terrain of the globe.
  urban: boolean;
  moving: boolean;
};

export type StreetSceneOptions = {
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
  // The traveller the given number of real seconds from now.
  getTraveller: (aheadSeconds: number) => Traveller;
};

export type StreetSceneHandle = {
  dispose: () => void;
};

type Lane = 'water' | 'road' | 'path';

type RowStyle = { urban: boolean; lane: Lane; surfaceAt: (col: number) => Surface };

const SKY = 0x8fd4ee;
const FOG_NEAR = 30;
const FOG_FAR = 60;
const CAMERA_FOV = 50;
const CAMERA_X = -8.5;
const CAMERA_Y = 4.6;

const ROWS_BEHIND = 10;
const ROWS_AHEAD = 60;
// Half width of the terrain at the camera, and how much it widens per row.
const NEAR_HALF_WIDTH = 9;
const WIDENING = 0.95;
const LANE_HALF_WIDTH = 2;
const GROUND_DEPTH = 4;
const WATER_LEVEL = -0.5;
const MAX_BOXES = 16000;

const VEHICLE_SCALE = 0.6;
const POSES_PER_SECOND = 12;
// The sides sample the globe beside the route, one step per this many columns.
const LATERAL_COLUMNS = 5;
const LATERAL_STEP = 0.2 * DEG;
const JITTER = 0.09;

// Scenery speed in voxels per second. It says nothing about the real speed.
const SCROLL_SPEED: Record<Motion, number> = { float: 5, walk: 3.5, roll: 9 };
const LANES: Record<Motion, Lane> = { float: 'water', walk: 'path', roll: 'road' };

const FACADES = [P.cream, P.ochre, P.coral, P.pink, P.straw, P.shade] as const;
const ROOFS = [P.darkRed, P.steel, P.dark] as const;
const FLOWERS = [P.yellow, P.pink, P.white] as const;
const SPRUCE = [0x2f6b35, 0x357538, 0x28602f] as const;
const PATH = [P.ochre, P.khaki] as const;

const pick = (palette: readonly number[], roll: number): number => palette[Math.floor(roll * palette.length) % palette.length];

export const createStreetScene = ({ canvas, reducedMotion, getTraveller }: StreetSceneOptions): StreetSceneHandle => {
  const renderer = new WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setClearColor(SKY, 1);

  const scene = new Scene();
  scene.fog = new Fog(SKY, FOG_NEAR, FOG_FAR);
  addVoxelLights(scene);
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.5, 200);
  camera.position.set(CAMERA_X, CAMERA_Y, 0);
  camera.lookAt(12, 1.2, 0);

  const material = new MeshLambertMaterial({ vertexColors: true });
  const boxMaterial = new MeshLambertMaterial();
  const boxGeometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const terrain = new InstancedMesh(boxGeometry, boxMaterial, MAX_BOXES);
  terrain.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_BOXES * 3), 3);
  terrain.frustumCulled = false;
  terrain.instanceMatrix.array.fill(0);
  scene.add(terrain);

  const linearColors = new Map<number, Color>();
  const linear = (hex: number): Color => {
    let color = linearColors.get(hex);
    if (!color) {
      color = new Color(hex);
      linearColors.set(hex, color);
    }
    return color;
  };

  let boxCount = 0;
  // Adds a box standing on y, centred on x and z.
  const addBox = (x: number, y: number, z: number, width: number, height: number, depth: number, hex: number, shade = 1): void => {
    if (boxCount >= MAX_BOXES) return;
    const matrix = terrain.instanceMatrix.array;
    const at = boxCount * 16;
    matrix[at] = width;
    matrix[at + 5] = height;
    matrix[at + 10] = depth;
    matrix[at + 12] = x;
    matrix[at + 13] = y;
    matrix[at + 14] = z;
    matrix[at + 15] = 1;
    const color = linear(hex);
    terrain.instanceColor?.setXYZ(boxCount, color.r * shade, color.g * shade, color.b * shade);
    boxCount += 1;
  };

  const addGround = (x: number, z: number, top: number, hex: number, shade: number): void => {
    addBox(x, -GROUND_DEPTH, z, 1, top + GROUND_DEPTH, 1, hex, shade);
  };

  const addLane = (row: number, col: number, x: number, lane: Lane, shade: number): void => {
    if (lane === 'water') {
      addGround(x, col, WATER_LEVEL, pick(SHALLOW, hash3(row, col, 3)), shade);
    } else if (lane === 'road') {
      const dash = col === 0 && ((row % 6) + 6) % 6 < 3;
      addGround(x, col, 0, dash ? P.cream : P.dark, shade);
    } else {
      addGround(x, col, 0, pick(PATH, hash3(row, col, 3)), shade);
    }
  };

  const addTree = (x: number, z: number, top: number, trunk: number, layers: readonly (readonly [width: number, height: number, color: number])[]): void => {
    addBox(x, top, z, 0.5, trunk, 0.5, P.darkWood);
    let y = top + trunk;
    for (const [width, height, color] of layers) {
      addBox(x, y, z, width, height, width, color);
      y += height;
    }
  };

  const addCity = (row: number, col: number, x: number, distance: number, shade: number): void => {
    const side = Math.sign(col);
    const depth = distance - 3;
    const alongBlock = ((row % 6) + 6) % 6;
    const acrossBlock = depth % 5;
    if (distance <= 2 || alongBlock === 5 || acrossBlock === 4) {
      addGround(x, col, 0.25, P.stone, shade);
      return;
    }
    const block = Math.floor(row / 6);
    const lot = Math.floor(depth / 5) * side;
    const height = 4 + Math.floor(hash3(block, lot, 5) * 7);
    addGround(x, col, height, pick(FACADES, hash3(block, lot, 6)), shade);
    addBox(x, height, col, 1, 0.5, 1, pick(ROOFS, hash3(block, lot, 7)));
    if (acrossBlock === 0 && alongBlock % 2 === 1) {
      for (let floor = 1.4; floor < height - 1; floor += 2) {
        addBox(x, floor, col - side * 0.5, 0.6, 0.9, 0.12, P.glass);
      }
    }
  };

  const addSide = (row: number, col: number, x: number, surface: Surface, urban: boolean, shade: number): void => {
    const distance = Math.abs(col) - LANE_HALF_WIDTH;
    const roll = hash3(row, col, 11);
    const tone = hash3(row, col, 7);
    const noise = valueNoise3(row * 0.14, col * 0.14, 3);
    const color = pick(surface.palette, tone);

    if (urban) {
      addCity(row, col, x, distance, shade);
      return;
    }
    switch (surface.kind) {
      case 'ocean':
      case 'shallow':
        addGround(x, col, WATER_LEVEL, roll < 0.015 ? P.foam : color, shade);
        return;
      case 'sand':
        addGround(x, col, Math.floor(noise * 4.5 * Math.min(1, distance / 4)), color, shade);
        return;
      case 'rock':
      case 'snow': {
        const height = Math.min(14, Math.floor(noise * (2 + distance * 0.9)));
        const snowLine = surface.kind === 'snow' ? 3 : 7;
        addGround(x, col, height, height >= snowLine ? 0xf1eee4 : pick([0x8a8f8c, 0x7d8a9a], tone), shade);
        return;
      }
      case 'ice':
        addGround(x, col, Math.floor(noise * 2.4), color, shade);
        if (roll < 0.02 && distance > 1) addBox(x, Math.floor(noise * 2.4), col, 1.4, 1 + roll * 60, 1.4, 0xdde3f0);
        return;
      case 'tundra': {
        const top = Math.floor(noise * 1.6);
        addGround(x, col, top, color, shade);
        if (roll < 0.03) addBox(x, top, col, 1, 0.8, 1, P.stone);
        return;
      }
      case 'boreal': {
        const top = Math.floor(noise * 2);
        addGround(x, col, top, color, shade);
        if (roll < 0.08 && distance > 1) {
          const green = pick(SPRUCE, tone);
          addTree(x, col, top, 1.2, [
            [2.4, 1.4, green],
            [1.7, 1.3, green],
            [0.9, 1.3, green]
          ]);
        }
        return;
      }
      case 'jungle': {
        const top = Math.floor(noise * 2);
        addGround(x, col, top, color, shade);
        if (roll < 0.12 && distance > 1) {
          addTree(x, col, top, 2 + roll * 20, [
            [3, 1.5, P.darkGreen],
            [1.8, 1, P.green]
          ]);
        }
        return;
      }
      default: {
        const top = Math.floor(noise * 1.6);
        addGround(x, col, top, color, shade);
        if (roll < 0.03 && distance > 1) addTree(x, col, top, 1.6, [[2.2, 2.2, P.green]]);
        else if (roll < 0.07) addBox(x, top, col, 0.35, 0.35, 0.35, pick(FLOWERS, tone));
      }
    }
  };

  const lookup = createSurfaceLookup();
  const laneOf = ({ urban, modelId }: Traveller): Lane => (urban ? 'road' : LANES[VEHICLES[modelId].motion]);
  let traveller = getTraveller(0);
  let styleKey = '';
  let builtRow = Number.NaN;
  let offset = 0;

  const right = new Vector3();
  const beside = new Vector3();

  // The globe as it is where the traveller is, and to the left and right of the route there.
  const rowStyle = (sample: Traveller): RowStyle => {
    const { unit, heading, urban } = sample;
    const centre = lookup(unit.x, unit.y, unit.z);
    const sideways = !urban && right.crossVectors(heading, unit).lengthSq() > 0;
    if (!sideways) return { urban, lane: laneOf(sample), surfaceAt: (): Surface => centre };
    const { x, y, z } = right.normalize();
    const steps = new Map<number, Surface>([[0, centre]]);
    const surfaceAt = (col: number): Surface => {
      const step = Math.round(col / LATERAL_COLUMNS);
      let surface = steps.get(step);
      if (!surface) {
        beside
          .set(x, y, z)
          .multiplyScalar(Math.tan(step * LATERAL_STEP))
          .add(unit)
          .normalize();
        surface = lookup(beside.x, beside.y, beside.z);
        steps.set(step, surface);
      }
      return surface;
    };
    return { urban, lane: laneOf(sample), surfaceAt };
  };

  // Each row shows the globe where the traveller is when that row reaches the vehicle.
  const rebuild = (firstRow: number): void => {
    boxCount = 0;
    const scrolling = traveller.moving && !reducedMotion;
    const speed = SCROLL_SPEED[VEHICLES[traveller.modelId].motion];
    for (let x = -ROWS_BEHIND; x <= ROWS_AHEAD; x += 1) {
      const row = firstRow + x;
      const style = rowStyle(scrolling ? getTraveller((row - offset) / speed) : traveller);
      const halfWidth = Math.ceil(NEAR_HALF_WIDTH + Math.max(0, x - CAMERA_X) * WIDENING);
      for (let col = -halfWidth; col <= halfWidth; col += 1) {
        const shade = 1 + (hash3(row, col, 1) - 0.5) * JITTER;
        if (Math.abs(col) <= LANE_HALF_WIDTH) addLane(row, col, x, style.lane, shade);
        else addSide(row, col, x, style.surfaceAt(col), style.urban, shade);
      }
    }
    terrain.count = boxCount;
    terrain.instanceMatrix.needsUpdate = true;
    if (terrain.instanceColor) terrain.instanceColor.needsUpdate = true;
    builtRow = firstRow;
  };

  // Vehicles are built the first time they are needed.
  const holder = new Group();
  scene.add(holder);
  const vehicles = new Map<VehicleId, PosedModel>();
  const showVehicle = (id: VehicleId): PosedModel => {
    let vehicle = vehicles.get(id);
    if (!vehicle) {
      vehicle = createPosedModel(VEHICLE_MODELS[id], material);
      vehicle.mesh.scale.setScalar(VEHICLES[id].scale * VEHICLE_SCALE);
      holder.add(vehicle.mesh);
      vehicles.set(id, vehicle);
    }
    vehicles.forEach((other) => {
      other.mesh.visible = other === vehicle;
    });
    return vehicle;
  };

  // The poses follow the time spent moving, so they stand still when the traveller does.
  const updateVehicle = (elapsed: number, travelled: number): void => {
    const { motion } = VEHICLES[traveller.modelId];
    const vehicle = showVehicle(traveller.modelId);
    const { mesh } = vehicle;
    const pose = reducedMotion ? 0 : Math.floor(elapsed * POSES_PER_SECOND) / POSES_PER_SECOND;
    const moving = traveller.moving ? 1 : 0.35;
    vehicle.pose(travelled);
    holder.position.y = motion === 'float' ? WATER_LEVEL : 0;
    mesh.rotation.x = motion === 'float' ? Math.sin(pose * 2.4) * 0.07 : 0;
    mesh.rotation.z = motion === 'float' ? Math.sin(pose * 1.7) * 0.04 : motion === 'roll' ? Math.sin(pose * 19) * 0.012 * moving : 0;
  };

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let frame = 0;
  let elapsed = 0;
  let travelled = 0;
  let previousTime = performance.now();

  const tick = (time: number): void => {
    const delta = Math.min(0.05, (time - previousTime) / 1000);
    previousTime = time;
    elapsed += delta;
    traveller = getTraveller(0);
    if (traveller.moving && !reducedMotion) {
      offset += SCROLL_SPEED[VEHICLES[traveller.modelId].motion] * delta;
      travelled += delta;
    }

    // Standing still, the scenery only changes when the ground under the traveller does.
    const { unit } = traveller;
    const key = `${laneOf(traveller)}:${traveller.moving}:${lookup(unit.x, unit.y, unit.z).kind}`;
    const firstRow = Math.floor(offset);
    if (firstRow !== builtRow || key !== styleKey) {
      styleKey = key;
      rebuild(firstRow);
    }
    terrain.position.x = firstRow - offset;

    updateVehicle(elapsed, travelled);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    dispose: (): void => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      vehicles.forEach((vehicle) => vehicle.dispose());
      boxGeometry.dispose();
      boxMaterial.dispose();
      material.dispose();
      terrain.dispose();
      renderer.dispose();
    }
  };
};
