import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Plane,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import type { Material } from 'three';

import { APP_TITLE } from '@/lib/globe/journey';
import { CAMERA_HEIGHT, CAMERA_PITCH, fitVoxel, FOCAL, FRAME_ASPECT, FRAME_FOV, frameRay, type Pixel, type Place } from '@/lib/start/frame';
import { createGround, createRoutes, RAIL_MOUTHS, type Route, WATER_LEVEL } from '@/lib/start/ground';
import { S } from '@/lib/start/palette';
import { START_PEOPLE } from '@/lib/start/people';
import { createSign, START_CLOUDS, START_SCENERY, START_TREES } from '@/lib/start/scenery';
import { START_VEHICLES } from '@/lib/start/vehicles';
import { hash3 } from '@/lib/voxel/hash';
import { type BuiltModel, buildModel, buildPlantedModel, type VoxelModelDef } from '@/lib/voxel/model';
import { createPosedModel, type PosedModel } from '@/lib/voxel/posed';

export type StartBackdropOptions = {
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
};

export type StartBackdropHandle = {
  dispose: () => void;
};

type Tree = readonly [pixel: Pixel, pixels: number, model: keyof typeof START_TREES, turn: number];
type Cloud = readonly [model: number, pixel: Pixel, pixels: number, depth: number, speed: number];

const DEG = Math.PI / 180;
const SKY_DISTANCE = 900;
const FOG_NEAR = 60;
const FOG_FAR = 340;

const TITLE = APP_TITLE.toUpperCase();
const TAGLINE = 'VART SKA DU EGENTLIGEN?';
// Pixels of the frame that the title is wide, how deep its layers are, and how much the letters lean.
const TITLE_WIDTH = 1050;
const TITLE_DEPTH = 15;
const TAGLINE_WIDTH = 540;
const TAGLINE_DEPTH = 18;
const SLANT = 0.2;

// How far the camera moves with the pointer and by itself, in metres.
const POINTER_REACH = new Vector3(0.32, 0.12, 0);
const DRIFT_REACH = new Vector3(0.14, 0.05, 0);

const TAXI_VOXEL = 0.085;
const TAXI_SPEED = 3.4;
const TAXI_LANE = 0.55;
const TRAIN_VOXEL = 0.16;
const TRAIN_SPEED = 6.5;
const TRAIN_PERIOD = 21;
const CAR_SPACING = 7.7;
const PORTAL_VOXEL = 0.25;
const SWAN_VOXEL = 0.05;
const SWAN_SPEED = 0.4;
const HIKER_SPEED = 1;
const ELDER_SPEED = 0.42;
const TURN_SPEED = 4;
const WATER_BEATS = 8;

// The rocket waits, shakes, leaves, stays away and comes back down, in seconds.
const ROCKET_WAIT = 14;
const ROCKET_SHAKE = 1.6;
const ROCKET_FLIGHT = 4.5;
const ROCKET_AWAY = 5;
const ROCKET_CEILING = 70;

const TREES: readonly Tree[] = [
  [[830, 706], 255, 'oak', 2.4],
  [[100, 396], 130, 'tall', 0.4],
  [[598, 431], 62, 'round', 0],
  [[492, 446], 56, 'round', 1.2],
  [[852, 417], 62, 'round', 0.6],
  [[1622, 433], 88, 'round', 2],
  [[22, 405], 75, 'round', 1],
  [[1585, 470], 60, 'tall', 0.3],
  [[415, 400], 36, 'round', 0.5],
  [[560, 374], 28, 'tall', 1.5],
  [[705, 362], 26, 'round', 2.2],
  [[1600, 335], 42, 'tall', 1.1],
  [[250, 335], 44, 'round', 0.2],
  [[930, 385], 34, 'round', 0.9]
];

const BUSHES: readonly (readonly [pixel: Pixel, pixels: number, turn: number])[] = [
  [[1622, 884], 150, 0.3],
  [[1506, 902], 95, 2.6]
];

const BLOOMS: readonly (readonly [pixel: Pixel, pixels: number])[] = [
  [[1530, 928], 44],
  [[1585, 916], 48],
  [[1634, 935], 46]
];

const CLOUDS: readonly Cloud[] = [
  [0, [365, 198], 175, 160, 0.7],
  [1, [665, 245], 130, 190, 0.5],
  [2, [-380, 150], 190, 180, 0.6],
  [0, [2080, 215], 200, 170, 0.65],
  [1, [1625, 185], 110, 200, 0.45]
];

const SKY_BANDS: readonly (readonly [elevation: number, color: number])[] = [
  [-40, S.haze],
  [0, S.haze],
  [3, S.skyLow],
  [8, S.skyMid],
  [14, S.skyTop],
  [75, S.skyTop]
];

// A wall behind everything, lighter towards the horizon.
const createSky = (): BufferGeometry => {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = new Color();
  SKY_BANDS.forEach(([elevation, hex], band) => {
    const y = CAMERA_HEIGHT + SKY_DISTANCE * Math.tan(elevation * DEG);
    color.set(hex);
    positions.push(-SKY_DISTANCE * 4, y, -SKY_DISTANCE, SKY_DISTANCE * 4, y, -SKY_DISTANCE);
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
    if (band > 0) indices.push(band * 2 - 2, band * 2 - 1, band * 2 + 1, band * 2 - 2, band * 2 + 1, band * 2);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  return geometry;
};

// The place a pixel of the frame is at, so far from the camera along the way it looks.
const aloft = ([px, py]: Pixel, depth: number): Vector3 => {
  const [x, y, d] = frameRay(px, py);
  return new Vector3(x * depth, CAMERA_HEIGHT + y * depth, -d * depth);
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

// Follows the steps of the ground smoothly. Without time passed it is there at once.
const settle = (height: number, target: number, delta: number): number => (delta === 0 ? target : height + (target - height) * Math.min(1, delta * 7));

const turnToward = (angle: number, target: number, step: number): number => {
  const gap = Math.atan2(Math.sin(target - angle), Math.cos(target - angle));
  return angle + Math.sign(gap) * Math.min(Math.abs(gap), step);
};

export const createStartBackdrop = ({ canvas, reducedMotion }: StartBackdropOptions): StartBackdropHandle => {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(S.haze, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new Scene();
  scene.fog = new Fog(S.haze, FOG_NEAR, FOG_FAR);
  const camera = new PerspectiveCamera(FRAME_FOV, FRAME_ASPECT, 0.5, 6000);
  camera.position.set(0, CAMERA_HEIGHT, 0);
  camera.rotation.x = -CAMERA_PITCH;

  const sun = new DirectionalLight(0xfff1d0, 1.8);
  sun.position.set(-20, 32, -8);
  sun.target.position.set(0, 0, -24);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target, new HemisphereLight(0xe2f1ff, 0x9bcf78, 2));

  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const posed: PosedModel[] = [];
  const keep = <T extends BufferGeometry>(geometry: T): T => {
    geometries.push(geometry);
    return geometry;
  };
  const material = <T extends Material>(made: T): T => {
    materials.push(made);
    return made;
  };

  const lit = material(new MeshLambertMaterial({ vertexColors: true }));
  const glow = material(new MeshBasicMaterial({ vertexColors: true, fog: false }));

  const sky = new Mesh(keep(createSky()), material(new MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false })));
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  const routes = createRoutes();
  const ground = createGround(routes);
  for (const geometry of ground.geometries) {
    const mesh = new Mesh(keep(geometry), lit);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  const water = new Mesh(keep(ground.water), lit);
  water.receiveShadow = true;
  scene.add(water);

  const built = new Map<string, BuiltModel>();
  const build = (def: VoxelModelDef, planted = false): BuiltModel => {
    let model = built.get(def.id);
    if (!model) {
      model = planted ? buildPlantedModel(def) : buildModel(def);
      keep(model.geometry);
      built.set(def.id, model);
    }
    return model;
  };

  const stand = (object: Object3D, { x, y, d }: Place): void => {
    object.position.set(x, y, -d);
    scene.add(object);
  };

  // A still model on the ground that a pixel of the frame sees, as tall as so many pixels there.
  const plant = (def: VoxelModelDef, pixel: Pixel, pixels: number, turn: number): Mesh => {
    const { geometry, size } = build(def);
    const place = ground.seenAt(pixel);
    const mesh = new Mesh(geometry, lit);
    mesh.scale.setScalar(fitVoxel(place, pixels, size.y));
    mesh.rotation.y = turn;
    mesh.castShadow = true;
    stand(mesh, place);
    return mesh;
  };

  // A model with poses in a holder, sized like plant. The holder is where it stands and which way it faces.
  const cast = (def: VoxelModelDef, pixel: Pixel, pixels: number): { model: PosedModel; holder: Group; place: Place } => {
    const model = createPosedModel(def, lit);
    posed.push(model);
    const place = ground.seenAt(pixel);
    model.mesh.scale.setScalar(fitVoxel(place, pixels, model.size.y));
    model.mesh.castShadow = true;
    const holder = new Group();
    holder.add(model.mesh);
    stand(holder, place);
    return { model, holder, place };
  };

  // Turned towards the camera, and then so far to its own left.
  const faceCamera = (holder: Object3D, turn: number): void => {
    holder.rotation.y = Math.atan2(holder.position.z, -holder.position.x) + turn;
  };

  for (const [pixel, pixels, model, turn] of TREES) plant(START_TREES[model], pixel, pixels, turn);
  for (const [pixel, pixels, turn] of BUSHES) plant(START_SCENERY.bush, pixel, pixels, turn);
  for (const [pixel, pixels] of BLOOMS) plant(START_SCENERY.bloom, pixel, pixels, 0);
  faceCamera(plant(START_VEHICLES.cart, [915, 808], 115, 0), 2.3);

  // Tufts and small flowers on the lawn, more of them close to the camera.
  const scatter = (def: VoxelModelDef, count: number, seed: number, size: number): void => {
    const mesh = new InstancedMesh(build(def).geometry, lit, count);
    const spot = new Object3D();
    let placed = 0;
    for (let index = 0; index < count * 3 && placed < count; index += 1) {
      const d = 5 + hash3(index, 1, seed) ** 2 * 42;
      const x = (hash3(index, 2, seed) - 0.5) * 2 * Math.min(34, 6 + d * 0.9);
      if (!ground.isLawn(x, d)) continue;
      spot.position.set(x, ground.heightAt(x, d), -d);
      spot.rotation.y = hash3(index, 3, seed) * Math.PI;
      spot.scale.setScalar(size * (0.75 + hash3(index, 4, seed) * 0.6));
      spot.updateMatrix();
      mesh.setMatrixAt(placed, spot.matrix);
      placed += 1;
    }
    mesh.count = placed;
    mesh.receiveShadow = true;
    scene.add(mesh);
  };
  scatter(START_SCENERY.tuft, 340, 77, 0.06);
  scatter(START_SCENERY.bloom, 46, 91, 0.028);

  const skater = cast(START_PEOPLE.skater, [176, 924], 338);
  faceCamera(skater.holder, -0.3);
  const commuter = cast(START_PEOPLE.commuter, [722, 828], 240);
  faceCamera(commuter.holder, -0.25);
  const supporter = cast(START_PEOPLE.supporter, [150, 548], 150);
  supporter.holder.rotation.y = Math.atan2(-0.5, 0.85);
  const rocket = cast(START_VEHICLES.rocket, [1592, 612], 160);
  faceCamera(rocket.holder, 0.5);
  const rocketGround = rocket.holder.position.y;

  // Walkers go back and forth along a stretch of a route and turn around at its ends.
  const createWalker = (def: VoxelModelDef, pixel: Pixel, pixels: number, route: Route, from: number, to: number, speed: number): ((seconds: number, delta: number) => void) => {
    const { model, holder } = cast(def, pixel, pixels);
    return (seconds, delta): void => {
      const span = to - from;
      const lap = (seconds * speed) % (span * 2);
      const back = lap > span;
      const { x, d, dx, dd } = route.at(from + (back ? span * 2 - lap : lap));
      const heading = back ? Math.atan2(-dd, -dx) : Math.atan2(dd, dx);
      holder.position.set(x, settle(holder.position.y, ground.heightAt(x, d), delta), -d);
      holder.rotation.y = delta === 0 ? heading : turnToward(holder.rotation.y, heading, TURN_SPEED * delta);
      model.pose(seconds);
    };
  };
  const walkElder = createWalker(START_PEOPLE.elder, [462, 768], 195, routes.footpath, routes.footpath.length - 4.9, routes.footpath.length - 2.3, ELDER_SPEED);
  const walkHiker = createWalker(START_PEOPLE.hiker, [705, 460], 85, routes.trail, 6.8, 16, HIKER_SPEED);

  const taxi = createPosedModel(START_VEHICLES.taxi, lit);
  posed.push(taxi);
  taxi.mesh.scale.setScalar(TAXI_VOXEL);
  taxi.mesh.castShadow = true;
  const taxiHolder = new Group();
  taxiHolder.add(taxi.mesh);
  scene.add(taxiHolder);

  const swan = createPosedModel(START_VEHICLES.swan, lit);
  posed.push(swan);
  swan.mesh.scale.setScalar(SWAN_VOXEL);
  swan.mesh.castShadow = true;
  const swanHolder = new Group();
  swanHolder.add(swan.mesh);
  scene.add(swanHolder);

  // The train is only drawn between the two tunnel mouths.
  const mouths = [RAIL_MOUTHS[0], routes.rails.length - RAIL_MOUTHS[1]];
  const clips = mouths.map((distance, index) => {
    const outward = index === 0 ? 1 : -1;
    const { x, d, dx, dd } = routes.rails.at(distance - outward * 0.7);
    const normal = new Vector3(dx * outward, 0, -dd * outward);
    return new Plane(normal, -normal.dot(new Vector3(x, 0, -d)));
  });
  mouths.forEach((distance, index) => {
    const outward = index === 0 ? 1 : -1;
    const { x, d, dx, dd } = routes.rails.at(distance);
    const portal = new Mesh(build(START_SCENERY.portal, true).geometry, lit);
    portal.scale.setScalar(PORTAL_VOXEL);
    portal.rotation.y = Math.atan2(dd * outward, dx * outward);
    portal.castShadow = true;
    stand(portal, { x, y: 0, d });
  });
  const trainMaterial = material(new MeshLambertMaterial({ vertexColors: true, clippingPlanes: clips, clipShadows: true }));
  const cars = [0, Math.PI].map((turn) => {
    const car = new Mesh(build(START_VEHICLES.train).geometry, trainMaterial);
    car.scale.setScalar(TRAIN_VOXEL);
    car.rotation.y = turn;
    car.castShadow = true;
    const holder = new Group();
    holder.add(car);
    scene.add(holder);
    return holder;
  });

  const sunModel = createPosedModel(START_SCENERY.sun, glow);
  posed.push(sunModel);
  sunModel.mesh.rotation.y = -Math.PI / 2;
  sunModel.mesh.scale.setScalar(((100 / FOCAL) * 300) / 15);
  sunModel.mesh.position.copy(aloft([88, 257], 300));
  scene.add(sunModel.mesh);

  const clouds = CLOUDS.map(([model, pixel, pixels, depth, speed]) => {
    const { geometry, size } = build(START_CLOUDS[model]);
    const mesh = new Mesh(geometry, glow);
    mesh.scale.setScalar(((pixels / FOCAL) * depth) / size.x);
    mesh.position.copy(aloft(pixel, depth));
    scene.add(mesh);
    return { mesh, start: mesh.position.x, reach: depth * 1.5, speed };
  });

  // A layer that stands like the picture does, at its own depth. Inside it one unit is one pixel of the frame.
  const createLayer = (pixel: Pixel, depth: number): Group => {
    const layer = new Group();
    layer.position.copy(aloft(pixel, depth));
    layer.rotation.x = -CAMERA_PITCH;
    layer.scale.setScalar(depth / FOCAL);
    scene.add(layer);
    return layer;
  };
  const hang = (layer: Group, { geometry }: BuiltModel, voxel: number, x: number, y: number): void => {
    const mesh = new Mesh(geometry, glow);
    mesh.scale.setScalar(voxel);
    mesh.position.set(x, y, 0);
    layer.add(mesh);
  };

  // The title and its stripes lean like italics.
  const lean = new Matrix4().set(1, SLANT, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const title = build(createSign('start-title', TITLE, true));
  const stripes = build(START_SCENERY.stripes);
  title.geometry.applyMatrix4(lean);
  stripes.geometry.applyMatrix4(lean);
  const titleVoxel = TITLE_WIDTH / title.size.x;
  const titleLayer = createLayer([836, 94], TITLE_DEPTH);
  hang(titleLayer, title, titleVoxel, (-SLANT * title.size.y * titleVoxel) / 2, 0);
  for (const side of [-1, 1]) hang(titleLayer, stripes, titleVoxel, side * (TITLE_WIDTH / 2 + 115), titleVoxel);
  const titleHeight = titleLayer.position.y;

  const tagline = build(createSign('start-tagline', TAGLINE, false));
  const taglineVoxel = TAGLINE_WIDTH / tagline.size.x;
  const taglineLayer = createLayer([836, 138], TAGLINE_DEPTH);
  hang(taglineLayer, tagline, taglineVoxel, 0, 0);
  for (const side of [-1, 1]) hang(taglineLayer, build(START_SCENERY.rule), taglineVoxel, side * (TAGLINE_WIDTH / 2 + 110), taglineVoxel * 4);

  // The start header is shown as HTML (TitleBar), matching the trip view.
  titleLayer.visible = false;
  taglineLayer.visible = false;

  const flyRocket = (seconds: number): void => {
    const time = seconds % (ROCKET_WAIT + ROCKET_SHAKE + ROCKET_FLIGHT * 2 + ROCKET_AWAY);
    const shaking = time - ROCKET_WAIT;
    const leaving = shaking - ROCKET_SHAKE;
    const landing = leaving - ROCKET_FLIGHT - ROCKET_AWAY;
    let height = 0;
    if (landing > 0) height = ROCKET_CEILING * (1 - landing / ROCKET_FLIGHT) ** 2;
    else if (leaving > 0) height = ROCKET_CEILING * Math.min(1, leaving / ROCKET_FLIGHT) ** 2;
    const burning = shaking > 0 && (landing <= 0 || height > 0.05);
    rocket.model.show(burning ? 1 + (Math.floor(seconds * 10) % 3) : 0);
    rocket.model.mesh.position.x = shaking > 0 && leaving <= 0 ? Math.sin(seconds * 70) * 0.012 : 0;
    rocket.holder.position.y = rocketGround + height;
    rocket.holder.visible = height < ROCKET_CEILING;
  };

  const pointer = new Vector3();
  const eased = new Vector3();
  let waterBeat = -1;

  const update = (seconds: number, delta: number): void => {
    skater.model.pose(seconds);
    commuter.model.pose(seconds);
    supporter.model.pose(seconds);
    walkElder(seconds, delta);
    walkHiker(seconds, delta);
    flyRocket(seconds);
    sunModel.pose(seconds);
    sunModel.mesh.scale.setScalar((((100 / FOCAL) * 300) / 15) * (1 + Math.sin(seconds * 0.9) * 0.025));

    const drive = routes.road.at(seconds * TAXI_SPEED);
    const driveX = drive.x + drive.dd * TAXI_LANE;
    const driveD = drive.d - drive.dx * TAXI_LANE;
    taxiHolder.position.set(driveX, settle(taxiHolder.position.y, ground.heightAt(driveX, driveD), delta), -driveD);
    taxiHolder.rotation.y = Math.atan2(drive.dd, drive.dx);
    taxi.pose(seconds);
    taxi.mesh.position.y = Math.abs(Math.sin(seconds * 9)) * 0.008;

    const head = -6 + (seconds % TRAIN_PERIOD) * TRAIN_SPEED;
    cars.forEach((car, index) => {
      const { x, d, dx, dd } = routes.rails.at(head - index * CAR_SPACING);
      car.position.set(x, 0.1, -d);
      car.rotation.y = Math.atan2(dd, dx);
    });

    const paddle = routes.swan.at(seconds * SWAN_SPEED);
    swanHolder.position.set(paddle.x, WATER_LEVEL - SWAN_VOXEL, -paddle.d);
    swanHolder.rotation.y = Math.atan2(paddle.dd, paddle.dx);
    swan.pose(seconds);
    swan.mesh.rotation.x = Math.sin(seconds * 2.1) * 0.05;
    swan.mesh.rotation.z = Math.sin(seconds * 1.6) * 0.035;

    for (const { mesh, start, reach, speed } of clouds) {
      mesh.position.x = ((((start + seconds * speed + reach) % (reach * 2)) + reach * 2) % (reach * 2)) - reach;
    }

    const beat = Math.floor(seconds * WATER_BEATS);
    if (beat !== waterBeat) {
      waterBeat = beat;
      ground.flow(beat / WATER_BEATS);
    }

    // The camera follows the pointer a little and drifts by itself, which sets the layers apart.
    eased.lerp(pointer, 1 - Math.exp(-delta * 3));
    camera.position.set(
      eased.x * POINTER_REACH.x + Math.sin(seconds * 0.21) * DRIFT_REACH.x,
      CAMERA_HEIGHT - eased.y * POINTER_REACH.y + Math.sin(seconds * 0.17 + 1) * DRIFT_REACH.y,
      0
    );
    titleLayer.position.y = titleHeight + Math.sin(seconds * 0.8) * 0.03;
  };

  const onPointerMove = (event: PointerEvent): void => {
    pointer.set((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1, 0);
  };

  // Wider windows see more to the sides, taller ones more above and below. The frame always fits.
  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = camera.aspect >= FRAME_ASPECT ? FRAME_FOV : (2 * Math.atan((Math.tan((FRAME_FOV * DEG) / 2) * FRAME_ASPECT) / camera.aspect)) / DEG;
    camera.updateProjectionMatrix();
    if (reducedMotion) renderer.render(scene, camera);
  };

  update(0, 0);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let frame = 0;
  let seconds = 0;
  let previous = performance.now();
  const tick = (time: number): void => {
    const delta = clamp((time - previous) / 1000, 0, 0.05);
    previous = time;
    seconds += delta;
    update(seconds, delta);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  if (!reducedMotion) {
    window.addEventListener('pointermove', onPointerMove);
    frame = requestAnimationFrame(tick);
  }

  return {
    dispose: (): void => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      posed.forEach((model) => model.dispose());
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((made) => made.dispose());
      renderer.dispose();
    }
  };
};
