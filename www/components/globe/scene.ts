import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';

import { DISTRICT_NAMES } from '@/lib/city/stockholmMap';
import { bearing, type Coordinates, pickExit, SLUSSEN } from '@/lib/geo';
import { createMoonGeometry, createSurfaceLookup, DEFAULT_EARTH_LEVEL, EARTH_LEVEL_COUNT, GLOBE_RADIUS, MOON_RADIUS } from '@/lib/globe/earth';
import { DEG, latLonToUnit } from '@/lib/globe/geo';
import type { LatLon } from '@/lib/globe/geo';
import { ARRIVAL_DAY, LEGS, locateJourney, SIGHTS, STOCKHOLM } from '@/lib/globe/journey';
import type { VehicleId } from '@/lib/globe/journey';
import { JOURNEY_TRACKS, type Track, trackPoint } from '@/lib/globe/track';
import { hash3 } from '@/lib/voxel/hash';
import { buildVoxelGeometry } from '@/lib/voxel/mesher';
import { buildModel, buildPlantedModel } from '@/lib/voxel/model';
import { GOAL_FLAG_MODEL, SIGHT_MODEL_DEFS, START_FLAG_MODEL, VEHICLE_MODELS } from '@/lib/voxel/models';
import { createPosedModel, type PosedModel } from '@/lib/voxel/posed';

import { createCityIntro } from './cityIntro';
import { createGlobeLod } from './globeLod';
import type { LodBlend } from './globeLod';
import { addVoxelLights } from './thumbnails';

const BACKGROUND = 0x08162b;
const DASH_SPACING = 2.7 * DEG;
const ARROW_EVERY = 6;
const COLOR_AHEAD = 0xff2a2a;
const COLOR_DONE = 0xffffff;

// The moon keeps its real size ratio and sidereal month, on a much tighter orbit.
const MOON_SCALE = (GLOBE_RADIUS * 0.273) / MOON_RADIUS;
const MOON_ORBIT_DAYS = 27.32;
const MOON_ORBIT_RADIUS = 420;
const MOON_INCLINATION = 18.3 * DEG;
const MOON_START_ANGLE = Math.PI + 0.17;
// The orbit always stays this much wider than the camera distance.
const MOON_CAMERA_MARGIN = 1.4;

const CAMERA_FOV = 30;
const CAMERA_NEAR = 1;
const CAMERA_START = 152;
const CAMERA_MIN = 70;
// One key press moves the camera this much, and on to the next detail level.
const ZOOM_STEP_RATIO = 1.265;
const LOD_BUILD_BUDGET_MS = 5;
const CAMERA_MAX = 300;
const VIEW_LATITUDE = 14 * DEG;
const PITCH_LIMIT = 1.25;
const FOLLOW_PITCH_LIMIT = 0.5;
const SPIN_SPEED = 1.5;
const IDLE_SPIN_SPEED = 0.07;
const IDLE_SPIN_DELAY = 4;
const EASING = 4.5;
const PIXEL_SCALE = 1;

const SECONDS_PER_DEGREE = 0.24;
const MIN_LEG_SECONDS = 5;
const MAX_LEG_SECONDS = 26;
const POSES_PER_SECOND = 12;

const SIGHT_SCALE = 0.24;
const FLAGS_SCALE = 0.34;
// Planted just north of the start so the vehicles never hide the flags.
const FLAGS_OFFSET: LatLon = [2.4, 0];
const LABEL_MIN_FACING = 0.32;

// The journey opens on a close-up of Stockholm and pulls back to the whole globe.
const INTRO_SECONDS = 3.4;
const INTRO_ELEVATION = 48 * DEG;
// The water of the city lies this far above the sea level of the globe.
const CITY_WATER_LIFT = 0.35;
// The flags are this much larger in the close-up than their size on the globe gives.
const CLOSE_FLAG_SCALE = 1.5;
const CITY_LABELS_END = 0.2;
const GLOBE_LABELS_START = 0.88;
// Shares of the pull-back between which the traveller grows into view.
const TRAVELLER_APPEARS = [0.3, 0.5];
const CLOSE_LIGHT = 2.2;
// Shares of the pull-back: when the extra light on the flags is gone, and the labels change over.
const CLOSE_LIGHT_END = 0.5;
const LABEL_RANGE = Math.cos(32 * DEG);
const LABELS_SHOWN = 2;

export type Motion = 'float' | 'walk' | 'roll';

export const VEHICLES: Record<VehicleId, { scale: number; motion: Motion }> = {
  cruiser: { scale: 0.34, motion: 'float' },
  scooter: { scale: 0.42, motion: 'roll' },
  swimmer: { scale: 0.27, motion: 'float' },
  walker: { scale: 0.32, motion: 'walk' },
  raft: { scale: 0.4, motion: 'float' },
  mower: { scale: 0.38, motion: 'roll' },
  swan: { scale: 0.4, motion: 'float' },
  flamingo: { scale: 0.4, motion: 'float' },
  ship: { scale: 0.27, motion: 'float' },
  moonwalker: { scale: 0.32, motion: 'walk' },
  bus: { scale: 0.33, motion: 'roll' }
};

export type GlobePlace = { name: string; position: LatLon };

// Where the trip starts and ends in Stockholm.
export type GlobePlaces = { origin: GlobePlace; destination: GlobePlace };

const DEFAULT_PLACES: GlobePlaces = {
  origin: { name: 'T-Centralen', position: [59.331, 18.0597] },
  destination: { name: 'Medborgarplatsen', position: [59.3143, 18.0735] }
};

// Who is on the way, and whether they move. The poses stand still when they do.
export type GlobeTraveller = { modelId: VehicleId; moving: boolean };

export type GlobeStatus = {
  running: boolean;
  started: boolean;
  finished: boolean;
  follow: boolean;
};

export type GlobeSceneOptions = {
  canvas: HTMLCanvasElement;
  labelLayer: HTMLElement;
  sightLabelClassName: string;
  hereLabelClassName: string;
  hereLabelText: string;
  placeLabelClassName: string;
  districtLabelClassName: string;
  places?: GlobePlaces;
  reducedMotion: boolean;
  // Journey progress from 0 to 1. Without it the scene runs on its own clock.
  getProgress?: () => number;
  // Whether a trip on an outside clock has set off, even if it has not reached the globe yet.
  isUnderWay?: () => boolean;
  // Who the globe shows travelling, or null for nobody. Without it the leg decides.
  getTraveller?: () => GlobeTraveller | null;
  onLegChange: (index: number) => void;
  onStatusChange: (status: GlobeStatus) => void;
};

export type GlobeSceneHandle = {
  dispose: () => void;
  toggleRunning: () => void;
  restart: () => void;
  stepLeg: (delta: number) => void;
  toggleFollow: () => void;
  setSpin: (x: number, y: number) => void;
  zoom: (direction: number) => void;
};

type Marker = { leg: number; fraction: number; unit: Vector3; heading: Vector3 };

// Something standing on the ground, with its surface radius on every detail level.
type Landmark = {
  mesh: Mesh;
  unit: Vector3;
  scale: number;
  radii: number[];
  radius: number;
  // Where it stands in the close-up of the city, if it starts out there.
  home: Vector3 | null;
  label: Label | null;
  labelLift: number;
};

type Label = { element: HTMLElement; anchor: Vector3; closeness: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const toCoordinates = ([latitude, longitude]: LatLon): Coordinates => ({ latitude, longitude });

const eastOf = (unit: Vector3, target: Vector3): Vector3 => {
  target.set(unit.z, 0, -unit.x);
  return target.lengthSq() < 1e-8 ? target.set(1, 0, 0) : target.normalize();
};

const createArrowGeometry = (): BufferGeometry => {
  const cells = [
    [2, 0],
    [1, -1],
    [1, 1],
    [0, -2],
    [0, 2]
  ].map(([x, z]) => ({ x, y: 0, z, color: 0xffffff }));
  const isSolid = (x: number, y: number, z: number): boolean => cells.some((cell) => cell.x === x && cell.y === y && cell.z === z);
  const geometry = buildVoxelGeometry(cells, isSolid, 0);
  geometry.translate(-1.5, -0.5, -0.5);
  geometry.scale(0.62, 0.62, 0.62);
  return geometry;
};

const createStars = (): Points => {
  const count = 520;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const tints = [0xfff0c2, 0xffffff, 0x9fc3ff, 0xffe45c].map((hex) => new Color(hex));
  for (let index = 0; index < count; index += 1) {
    const u = hash3(index, 1, 7) * 2 - 1;
    const angle = hash3(index, 2, 7) * Math.PI * 2;
    const ring = Math.sqrt(1 - u * u);
    const radius = 700 + hash3(index, 3, 7) * 200;
    positions.set([ring * Math.cos(angle) * radius, u * radius, ring * Math.sin(angle) * radius], index * 3);
    const tint = tints[Math.floor(hash3(index, 4, 7) * tints.length)];
    const dim = 0.35 + hash3(index, 5, 7) * 0.65;
    colors.set([tint.r * dim, tint.g * dim, tint.b * dim], index * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const material = new PointsMaterial({
    size: 2,
    sizeAttenuation: false,
    vertexColors: true
  });
  return new Points(geometry, material);
};

export const createGlobeScene = (options: GlobeSceneOptions): GlobeSceneHandle => {
  const { canvas, labelLayer, reducedMotion, onLegChange, onStatusChange } = options;
  const disposables: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const renderer = new WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setClearColor(BACKGROUND, 1);

  const scene = new Scene();
  addVoxelLights(scene);
  // In the close-up the flags face the camera with their backs to the sun.
  const closeLight = new DirectionalLight(0xfff0d8, 0);
  closeLight.position.set(0.25, -0.45, 1);
  scene.add(closeLight);
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, 2000);
  camera.position.set(0, 0, CAMERA_START);

  const stars = createStars();
  track(stars.geometry);
  track(stars.material as PointsMaterial);
  scene.add(stars);

  const voxelMaterial = track(new MeshLambertMaterial({ vertexColors: true }));
  const glowMaterial = track(new MeshBasicMaterial({ toneMapped: false }));

  const moon = new Mesh(track(createMoonGeometry()), voxelMaterial);
  moon.scale.setScalar(MOON_SCALE);
  scene.add(moon);

  const globe = new Group();
  scene.add(globe);

  // The city of the opening shot and the land around it are let into the globe at Stockholm.
  const places = options.places ?? DEFAULT_PLACES;
  const departure = toCoordinates(places.origin.position);
  const stockholmUnit = latLonToUnit(STOCKHOLM);
  const stockholmEast = eastOf(stockholmUnit, new Vector3());
  const stockholmSouth = new Vector3().crossVectors(stockholmEast, stockholmUnit);
  const cityRadius = GLOBE_RADIUS + CITY_WATER_LIFT;
  const cityOrigin = stockholmUnit.clone().multiplyScalar(cityRadius);
  const surfaceAt = createSurfaceLookup();
  const arrowGeometry = createArrowGeometry();
  const city = createCityIntro({
    origin: places.origin.position,
    destination: places.destination.position,
    exitBearing: bearing(departure, pickExit(departure, toCoordinates(places.destination.position))),
    entry: [SLUSSEN.latitude, SLUSSEN.longitude],
    routeColor: COLOR_AHEAD,
    arrowGeometry,
    elevation: INTRO_ELEVATION,
    halfFov: (CAMERA_FOV / 2) * DEG,
    radius: cityRadius,
    surface: (x, z) => {
      const unit = new Vector3().copy(cityOrigin).addScaledVector(stockholmEast, x).addScaledVector(stockholmSouth, z).normalize();
      const { kind, palette } = surfaceAt(unit.x, unit.y, unit.z);
      return { water: kind === 'ocean' || kind === 'shallow', bare: kind === 'rock' || kind === 'snow', palette };
    }
  });
  city.group.matrix.makeBasis(stockholmEast, stockholmUnit, stockholmSouth).setPosition(cityOrigin);
  globe.add(city.group);
  const cityToGlobe = (local: Vector3): Vector3 => local.clone().applyMatrix4(city.group.matrix);

  const landmarks: Landmark[] = [];
  const lod = createGlobeLod({
    onLevelReady: (level): void => {
      for (const landmark of landmarks) landmark.radii[level.index] = level.surfaceRadius(landmark.unit);
    },
    cutout: { origin: cityOrigin, east: stockholmEast, up: stockholmUnit, south: stockholmSouth, ...city.footprint }
  });
  globe.add(lod.group);
  let routeRadius = lod.defaultLevel.routeRadius;

  const scratch = {
    a: new Vector3(),
    b: new Vector3(),
    c: new Vector3(),
    d: new Vector3(),
    forward: new Vector3(),
    right: new Vector3(),
    matrix: new Matrix4(),
    color: new Color(),
    rotation: new Quaternion()
  };
  const focus = new Vector3(0, 0, 1);

  const surfaceMatrix = (unit: Vector3, radius: number, forward: Vector3, target: Matrix4): Matrix4 => {
    scratch.right.crossVectors(forward, unit).normalize();
    scratch.forward.crossVectors(unit, scratch.right).normalize();
    return target.makeBasis(scratch.forward, unit, scratch.right).setPosition(unit.x * radius, unit.y * radius, unit.z * radius);
  };

  // Route: dashes and arrows hovering above the surface.
  const tracks = JOURNEY_TRACKS;
  const dashes: Marker[] = [];
  const arrows: Marker[] = [];
  let carry = DASH_SPACING / 2;
  let markerCount = 0;
  tracks.forEach((legTrack, leg) => {
    let at = carry;
    while (at < legTrack.length) {
      const marker = { leg, fraction: at / legTrack.length, unit: new Vector3(), heading: new Vector3() };
      if (markerCount % ARROW_EVERY === ARROW_EVERY - 1) arrows.push(marker);
      else dashes.push(marker);
      markerCount += 1;
      at += DASH_SPACING;
    }
    carry = at - legTrack.length;
  });

  const headingAt = (legTrack: Track, fraction: number, target: Vector3): Vector3 => {
    const from = trackPoint(legTrack, Math.max(0, fraction - 0.01), scratch.a);
    const to = trackPoint(legTrack, Math.min(1, fraction + 0.01), scratch.b);
    target.copy(to).sub(from);
    return target.lengthSq() < 1e-12 ? eastOf(to, target) : target.normalize();
  };

  const placeMarkers = (mesh: InstancedMesh, markers: Marker[]): void => {
    const radius = cityRadius + (routeRadius - cityRadius) * introShift;
    markers.forEach((marker, index) => {
      mesh.setMatrixAt(index, surfaceMatrix(marker.unit, radius, marker.heading, scratch.matrix).scale(scratch.a.setScalar(introScale)));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };

  const createMarkers = (geometry: BufferGeometry, markers: Marker[]): InstancedMesh => {
    const mesh = new InstancedMesh(track(geometry), glowMaterial, markers.length);
    markers.forEach((marker, index) => {
      const legTrack = tracks[marker.leg];
      headingAt(legTrack, marker.fraction, marker.heading);
      trackPoint(legTrack, marker.fraction, marker.unit);
      mesh.setColorAt(index, scratch.color.setHex(COLOR_AHEAD));
    });
    // The markers move with the detail level, so their bounds are not fixed.
    mesh.frustumCulled = false;
    globe.add(mesh);
    return mesh;
  };
  const dashMesh = createMarkers(new BoxGeometry(0.9, 0.5, 0.5), dashes);
  const arrowMesh = createMarkers(arrowGeometry, arrows);

  const paintMarkers = (mesh: InstancedMesh, markers: Marker[], leg: number, fraction: number): void => {
    markers.forEach((marker, index) => {
      const done = marker.leg < leg || (marker.leg === leg && marker.fraction <= fraction);
      mesh.setColorAt(index, scratch.color.setHex(done ? COLOR_DONE : COLOR_AHEAD));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  // Vehicles share one holder that rides along the route.
  const vehicleHolder = new Group();
  vehicleHolder.matrixAutoUpdate = false;
  globe.add(vehicleHolder);
  const vehicles = new Map<VehicleId, PosedModel>();
  (Object.keys(VEHICLES) as VehicleId[]).forEach((id) => {
    const vehicle = track(createPosedModel(VEHICLE_MODELS[id], voxelMaterial));
    vehicle.mesh.scale.setScalar(VEHICLES[id].scale);
    vehicle.mesh.visible = false;
    vehicleHolder.add(vehicle.mesh);
    vehicles.set(id, vehicle);
  });

  // During the opening a landmark is as small as the view is close, and may still be in the city.
  const placeLandmark = ({ mesh, unit, scale, radius, home, label, labelLift }: Landmark): void => {
    const position = scratch.d.copy(unit).multiplyScalar(radius);
    if (home) position.lerpVectors(home, position, introShift);
    const height = position.length();
    const up = position.divideScalar(height);
    const size = introScale * (home ? CLOSE_FLAG_SCALE + (1 - CLOSE_FLAG_SCALE) * introShift : 1);
    mesh.matrix.copy(surfaceMatrix(up, height, eastOf(unit, scratch.c), scratch.matrix)).scale(scratch.a.setScalar(scale * size));
    mesh.matrixWorldNeedsUpdate = true;
    label?.anchor.copy(up).multiplyScalar(height + labelLift * size);
  };

  const addLandmark = (geometry: BufferGeometry, unit: Vector3, scale: number, label: Label | null, labelLift: number, home: Vector3 | null = null): Mesh => {
    const mesh = new Mesh(track(geometry), voxelMaterial);
    mesh.matrixAutoUpdate = false;
    globe.add(mesh);
    const radii = Array.from({ length: EARTH_LEVEL_COUNT }, (_, index) => lod.level(index)?.surfaceRadius(unit) ?? Number.NaN);
    landmarks.push({ mesh, unit, scale, radii, radius: radii[DEFAULT_EARTH_LEVEL], home, label, labelLift });
    return mesh;
  };

  const createLabel = (className: string, text: string, anchor: Vector3): Label => {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = text;
    element.style.display = 'none';
    labelLayer.appendChild(element);
    return { element, anchor, closeness: 1 };
  };

  const labels: Label[] = SIGHTS.map((sight) => {
    const built = buildModel(SIGHT_MODEL_DEFS[sight.modelId]);
    const label = createLabel(options.sightLabelClassName, sight.name, new Vector3());
    addLandmark(built.geometry, latLonToUnit(sight.position), SIGHT_SCALE, label, built.size.y * SIGHT_SCALE + 0.6);
    return label;
  });

  const hereLabel = createLabel(options.hereLabelClassName, options.hereLabelText, new Vector3());

  // Created first, so that the names of the two addresses are drawn on top of them.
  const districtLabels = DISTRICT_NAMES.map(({ name, at }) => createLabel(options.districtLabelClassName, name, cityToGlobe(city.locate(at))));

  // The flags stand at the two addresses, and end up side by side north of the city.
  const flagsUnit = latLonToUnit([STOCKHOLM[0] + FLAGS_OFFSET[0], STOCKHOLM[1] + FLAGS_OFFSET[1]]);
  const flagsEast = eastOf(flagsUnit, new Vector3());
  const placeLabels = [
    { model: START_FLAG_MODEL, side: -1, home: city.origin, name: places.origin.name },
    { model: GOAL_FLAG_MODEL, side: 1, home: city.destination, name: places.destination.name }
  ].map(({ model, side, home, name }) => {
    const built = buildPlantedModel(model);
    const unit = flagsUnit
      .clone()
      .multiplyScalar(GLOBE_RADIUS)
      .addScaledVector(flagsEast, side * FLAGS_SCALE)
      .normalize();
    const label = createLabel(options.placeLabelClassName, name, new Vector3());
    // Drawn after the route of the close-up, which ignores what is in front of it.
    addLandmark(built.geometry, unit, FLAGS_SCALE, label, (built.size.y + 2) * FLAGS_SCALE, cityToGlobe(home)).renderOrder = 2;
    return label;
  });
  const vehicleHome = cityToGlobe(city.origin);

  // State
  let legIndex = 0;
  let legProgress = 0;
  let status: GlobeStatus = {
    running: false,
    started: false,
    finished: false,
    follow: true
  };
  let yaw = 0;
  let pitch = 0;
  let targetYaw = 0;
  let targetPitch = 0;
  let distance = CAMERA_START;
  let zoomLevel = DEFAULT_EARTH_LEVEL;
  let zoomFactor = 1;
  let bufferWidth = 1;
  let bufferHeight = 1;
  let appliedBlend = -1;
  let fitFactor = 1;
  let spinX = 0;
  let spinY = 0;
  let idleTime = 0;
  let elapsed = 0;
  // Seconds the traveller has been seen moving, which is what its poses follow.
  let travelled = 0;
  let paintedKey = -1;
  // How far the opening has pulled back, and what that does to the things on the globe:
  // they keep their size on screen, and slide from the city to their place.
  let introTime = 0;
  let introEase = 0;
  let introScale = 1;
  let introShift = 1;
  let introNear = 1;
  const introAnchor = new Vector3();
  let layoutKey = -1;
  let frame = 0;
  let previousTime = performance.now();
  const vehicleUnit = new Vector3();
  const vehicleHeading = new Vector3();
  const vehicleTop = new Vector3();
  let traveller: GlobeTraveller | null = null;

  const setStatus = (patch: Partial<GlobeStatus>): void => {
    status = { ...status, ...patch };
    onStatusChange(status);
  };

  const setLeg = (index: number, progress: number): void => {
    const changed = index !== legIndex;
    legIndex = index;
    legProgress = progress;
    if (changed) onLegChange(index);
  };

  const legSeconds = (index: number): number => clamp((tracks[index].length / DEG) * SECONDS_PER_DEGREE, MIN_LEG_SECONDS, MAX_LEG_SECONDS);

  // Driven mode: an outside clock decides how far along the journey is.
  const syncToProgress = (progress: number): void => {
    const location = locateJourney(progress);
    setLeg(location.legIndex, location.legProgress);

    const running = progress > 0 && progress < 1;
    const started = progress > 0;
    const finished = progress >= 1;
    if (running !== status.running || started !== status.started || finished !== status.finished) {
      setStatus({ running, started, finished });
    }
  };

  const advance = (delta: number): void => {
    if (!status.running) return;
    let progress = legProgress + delta / legSeconds(legIndex);
    if (progress < 1) {
      legProgress = progress;
      return;
    }
    if (legIndex === LEGS.length - 1) {
      legProgress = 1;
      setStatus({ running: false, finished: true });
      return;
    }
    progress = 0;
    setLeg(legIndex + 1, progress);
  };

  const locateVehicle = (): void => {
    const legTrack = tracks[legIndex];
    trackPoint(legTrack, legProgress, vehicleUnit);
    headingAt(legTrack, legProgress, vehicleHeading);
  };

  // The leg decides who travels unless an outside clock does. Nobody is left once the journey is over.
  const findTraveller = (): GlobeTraveller | null => {
    if (options.getTraveller) return options.getTraveller();
    return status.finished ? null : { modelId: LEGS[legIndex].modelId, moving: status.running };
  };

  const updateVehicle = (delta: number): void => {
    traveller = findTraveller();
    // The traveller only appears once the houses are too small to stand among.
    const size = traveller ? introScale * clamp((introEase - TRAVELLER_APPEARS[0]) / (TRAVELLER_APPEARS[1] - TRAVELLER_APPEARS[0]), 0, 1) : 0;
    vehicleHolder.visible = size > 0;
    if (!traveller) return;
    const { modelId } = traveller;
    const position = scratch.d.copy(vehicleUnit).multiplyScalar(routeRadius);
    if (introShift < 1) position.lerpVectors(vehicleHome, position, introShift);
    const height = position.length();
    const up = position.divideScalar(height);
    surfaceMatrix(up, height, vehicleHeading, vehicleHolder.matrix).scale(scratch.a.setScalar(size));
    const { scale, motion } = VEHICLES[modelId];
    vehicleTop.copy(up).multiplyScalar(height + ((vehicles.get(modelId)?.size.y ?? 0) * scale + 1.4) * introScale);

    // The poses only play for the traveller on show, and stand still when it does.
    if (traveller.moving && vehicleHolder.visible && !reducedMotion) travelled += delta;
    const pose = reducedMotion ? 0 : Math.floor(elapsed * POSES_PER_SECOND) / POSES_PER_SECOND;
    const moving = traveller.moving ? 1 : 0.35;
    vehicles.forEach((vehicle, id) => {
      const { mesh } = vehicle;
      mesh.visible = id === modelId;
      if (!mesh.visible) return;
      vehicle.pose(travelled);
      mesh.rotation.x = motion === 'float' ? Math.sin(pose * 2.4) * 0.07 : 0;
      mesh.rotation.z = motion === 'float' ? Math.sin(pose * 1.7) * 0.04 : motion === 'roll' ? Math.sin(pose * 19) * 0.012 * moving : 0;
    });
  };

  const updateCamera = (delta: number): void => {
    const steering = spinX !== 0 || spinY !== 0;
    if (steering) {
      targetYaw -= spinX * SPIN_SPEED * delta;
      targetPitch = clamp(targetPitch + spinY * SPIN_SPEED * delta, -PITCH_LIMIT, PITCH_LIMIT);
      idleTime = 0;
    } else if (status.follow) {
      targetYaw = -Math.atan2(vehicleUnit.x, vehicleUnit.z);
      // Zoomed in, the globe may tilt further so the traveller stays in view.
      const limit = clamp(FOLLOW_PITCH_LIMIT + (1 - zoomFactor) * 1.5, FOLLOW_PITCH_LIMIT, PITCH_LIMIT);
      const followPitch = clamp(Math.asin(clamp(vehicleUnit.y, -1, 1)) - VIEW_LATITUDE, -limit, limit);
      // The close-up looks down on the city at a fixed angle.
      const closePitch = Math.asin(stockholmUnit.y) - (Math.PI / 2 - INTRO_ELEVATION);
      targetPitch = closePitch + (followPitch - closePitch) * introEase;
    } else {
      idleTime += delta;
      if (idleTime > IDLE_SPIN_DELAY && !reducedMotion) {
        targetYaw -= IDLE_SPIN_SPEED * delta;
      }
    }

    const ease = 1 - Math.exp(-delta * EASING);
    const turn = ((((targetYaw - yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    yaw += turn * ease;
    pitch += (targetPitch - pitch) * ease;
    globe.rotation.set(pitch, yaw, 0);

    const targetDistance = clamp(CAMERA_START * zoomFactor * fitFactor, CAMERA_MIN, CAMERA_MAX * fitFactor);
    distance += (targetDistance - distance) * ease;
    placeCamera();
  };

  // Pulls straight back from the close-up while the city drifts to its place on screen.
  const placeCamera = (): void => {
    const anchor = scratch.a.copy(introAnchor).applyEuler(globe.rotation);
    const far = distance - anchor.z;
    const depth = introEase >= 1 ? far : introNear * (far / introNear) ** introEase;
    introScale = depth / far;
    introShift = (depth - introNear) / (far - introNear);
    const centred = 1 - introEase * introScale;
    camera.position.set(anchor.x * centred, anchor.y * centred, anchor.z + depth);
    const near = clamp(depth * 0.3, 0.05, CAMERA_NEAR);
    if (near !== camera.near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  };

  const frameIntro = (): void => {
    const framing = city.frame(camera.aspect);
    introAnchor.copy(cityToGlobe(framing.target));
    introNear = framing.distance;
  };

  // The view stays on the city until the trip sets off.
  const underWay = (): boolean => status.started || (options.isUnderWay?.() ?? false);

  const updateIntro = (delta: number): void => {
    const goal = underWay() ? 1 : 0;
    const step = reducedMotion ? 1 : delta / INTRO_SECONDS;
    introTime = goal > introTime ? Math.min(goal, introTime + step) : Math.max(goal, introTime - step);
    introEase = introTime * introTime * (3 - 2 * introTime);
    city.setProgress(introEase);
    closeLight.intensity = CLOSE_LIGHT * (1 - clamp(introEase / CLOSE_LIGHT_END, 0, 1));
  };

  // Day of the journey, read off the leg the traveller is on.
  const journeyDay = (): number => {
    const from = LEGS[legIndex].startDay;
    const to = legIndex < LEGS.length - 1 ? LEGS[legIndex + 1].startDay : ARRIVAL_DAY;
    return from + (to - from) * legProgress;
  };

  // One prograde lap per sidereal month of journey time, in the camera's frame.
  const updateMoon = (): void => {
    const months = (journeyDay() - LEGS[0].startDay) / MOON_ORBIT_DAYS;
    const angle = MOON_START_ANGLE + (reducedMotion ? 0 : months * Math.PI * 2);
    // Wider than the camera distance, so the near side passes behind the camera.
    const radius = Math.max(MOON_ORBIT_RADIUS, distance * MOON_CAMERA_MARGIN);
    moon.position.set(radius * Math.sin(angle), -radius * Math.cos(angle) * Math.sin(MOON_INCLINATION), radius * Math.cos(angle) * Math.cos(MOON_INCLINATION));
    // Tidally locked: the same face always looks at the earth.
    moon.rotation.y = angle;
    // Never drawn on the camera's side of the earth, whatever the window shape.
    moon.visible = moon.position.z < 0;
  };

  const updateRouteColors = (): void => {
    const key = legIndex * 1000 + Math.floor(legProgress * 400);
    if (key === paintedKey) return;
    paintedKey = key;
    paintMarkers(dashMesh, dashes, legIndex, legProgress);
    paintMarkers(arrowMesh, arrows, legIndex, legProgress);
  };

  const positionLabel = (label: Label, shown: boolean, width: number, height: number): void => {
    const world = scratch.a.copy(label.anchor).applyMatrix4(globe.matrixWorld);
    const facing = scratch.b.copy(world).normalize().dot(scratch.c.copy(camera.position).sub(world).normalize());
    if (!shown || facing < LABEL_MIN_FACING) {
      label.element.style.display = 'none';
      return;
    }
    showLabel(label, world.project(camera), clamp((facing - LABEL_MIN_FACING) / 0.2, 0, 1), width, height);
  };

  const showLabel = (label: Label, projected: Vector3, opacity: number, width: number, height: number): void => {
    const x = Math.round((projected.x * 0.5 + 0.5) * width);
    const y = Math.round((-projected.y * 0.5 + 0.5) * height);
    label.element.style.display = 'block';
    label.element.style.opacity = String(opacity);
    label.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  };

  // Names in the city: shown in the close-up only, and never from behind the camera.
  const positionCityLabel = (label: Label, opacity: number, width: number, height: number): void => {
    const projected = scratch.a.copy(label.anchor).applyMatrix4(globe.matrixWorld).project(camera);
    if (opacity <= 0 || projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) {
      label.element.style.display = 'none';
      return;
    }
    showLabel(label, projected, opacity, width, height);
  };

  const updateLabels = (): void => {
    scene.updateMatrixWorld();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const onGlobe = introEase > GLOBE_LABELS_START;
    hereLabel.anchor.copy(vehicleTop);
    // Sights are named near the traveller, or near the view centre when steering freely.
    if (status.follow) focus.copy(vehicleUnit);
    else focus.set(0, 0, 1).applyQuaternion(scratch.rotation.copy(globe.quaternion).invert());
    for (const label of labels) {
      label.closeness = scratch.a.copy(label.anchor).normalize().dot(focus);
    }
    const threshold = Math.max(LABEL_RANGE, labels.map((label) => label.closeness).sort((a, b) => b - a)[LABELS_SHOWN - 1]);
    for (const label of labels) {
      positionLabel(label, onGlobe && label.closeness >= threshold, width, height);
    }
    // Before departure and after arrival the flags mark the spot instead.
    positionLabel(hereLabel, onGlobe && underWay() && traveller !== null, width, height);
    const inCity = 1 - clamp(introEase / CITY_LABELS_END, 0, 1);
    for (const label of [...placeLabels, ...districtLabels]) {
      positionCityLabel(label, inCity, width, height);
    }
  };

  // Moves the route and everything on the ground to the height of the visible detail.
  const applyBlend = ({ from, to, amount }: LodBlend): void => {
    const key = from * 10 + amount;
    if (key === appliedBlend) return;
    appliedBlend = key;
    const mix = (coarse: number, fine: number): number => (amount <= 0 ? coarse : amount >= 1 ? fine : coarse + (fine - coarse) * amount);
    routeRadius = mix(lod.level(from)?.routeRadius ?? routeRadius, lod.level(to)?.routeRadius ?? routeRadius);
    for (const landmark of landmarks) {
      landmark.radius = mix(landmark.radii[from], landmark.radii[to]);
    }
    layoutKey = -1;
  };

  // The route and the landmarks move when the detail level or the opening does.
  const updateLayout = (): void => {
    const key = introScale + introShift;
    if (key === layoutKey) return;
    layoutKey = key;
    placeMarkers(dashMesh, dashes);
    placeMarkers(arrowMesh, arrows);
    for (const landmark of landmarks) placeLandmark(landmark);
  };

  // The detail level follows the camera distance, so it changes at the pace of the zoom.
  const updateDetail = (): void => {
    lod.build(LOD_BUILD_BUDGET_MS);
    const zoom = camera.position.length() / (CAMERA_START * fitFactor);
    const coordinate = DEFAULT_EARTH_LEVEL - Math.log(zoom) / Math.log(ZOOM_STEP_RATIO);
    // During the opening the globe never stops to generate a level it has not got yet.
    applyBlend(lod.update(introEase < 1 ? Math.min(coordinate, lod.finestReady()) : coordinate, bufferWidth, bufferHeight));
  };

  const resize = (): void => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    bufferWidth = Math.ceil(width / PIXEL_SCALE);
    bufferHeight = Math.ceil(height / PIXEL_SCALE);
    renderer.setSize(bufferWidth, bufferHeight, false);
    camera.aspect = width / height;
    fitFactor = 1 / Math.min(1, camera.aspect);
    camera.updateProjectionMatrix();
    frameIntro();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const tick = (time: number): void => {
    // A frame can carry a time from before the scene was made, when the tab is in the background.
    const delta = clamp((time - previousTime) / 1000, 0, 0.05);
    previousTime = time;
    elapsed += delta;
    if (options.getProgress) syncToProgress(options.getProgress());
    else advance(delta);
    city.build();
    if (!reducedMotion) city.animate(elapsed);
    updateIntro(delta);
    updateDetail();
    locateVehicle();
    updateCamera(delta);
    updateVehicle(delta);
    updateLayout();
    updateMoon();
    updateRouteColors();
    updateLabels();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };

  // Start facing Stockholm without easing in from the far side, and already
  // out on the globe if the journey is under way.
  if (options.getProgress) syncToProgress(options.getProgress());
  introTime = underWay() ? 1 : 0;
  updateIntro(0);
  locateVehicle();
  updateCamera(0);
  yaw = targetYaw;
  pitch = targetPitch;
  frame = requestAnimationFrame(tick);

  const restart = (): void => {
    setLeg(0, 0);
    setStatus({
      running: false,
      started: false,
      finished: false,
      follow: true
    });
  };

  return {
    dispose: (): void => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      for (const label of [...labels, hereLabel, ...placeLabels, ...districtLabels]) label.element.remove();
      for (const item of disposables) item.dispose();
      city.dispose();
      lod.dispose();
      renderer.dispose();
    },
    toggleRunning: (): void => {
      if (status.finished) setLeg(0, 0);
      setStatus({ running: !status.running, started: true, finished: false });
    },
    restart,
    stepLeg: (delta: number): void => {
      setLeg(clamp(legIndex + delta, 0, LEGS.length - 1), 0);
      setStatus({ finished: false, started: true });
    },
    toggleFollow: (): void => {
      if (!underWay()) return;
      idleTime = 0;
      setStatus({ follow: !status.follow });
    },
    setSpin: (x: number, y: number): void => {
      spinX = underWay() ? x : 0;
      spinY = underWay() ? y : 0;
      if ((spinX !== 0 || spinY !== 0) && status.follow) setStatus({ follow: false });
    },
    zoom: (direction: number): void => {
      if (!underWay()) return;
      zoomLevel = clamp(zoomLevel + (direction > 0 ? -1 : 1), 0, EARTH_LEVEL_COUNT - 1);
      zoomFactor = ZOOM_STEP_RATIO ** (DEFAULT_EARTH_LEVEL - zoomLevel);
    }
  };
};
