import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
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

import { createMoonGeometry, DEFAULT_EARTH_LEVEL, EARTH_LEVEL_COUNT, GLOBE_RADIUS, MOON_RADIUS } from '@/lib/globe/earth';
import { DEG, latLonToUnit } from '@/lib/globe/geo';
import type { LatLon } from '@/lib/globe/geo';
import { ARRIVAL_DAY, LEGS, locateJourney, SIGHTS, STOCKHOLM } from '@/lib/globe/journey';
import type { VehicleId } from '@/lib/globe/journey';
import { JOURNEY_TRACKS, type Track, trackPoint } from '@/lib/globe/track';
import { hash3 } from '@/lib/voxel/hash';
import { buildVoxelGeometry } from '@/lib/voxel/mesher';
import { buildModel } from '@/lib/voxel/model';
import { FLAGS_MODEL, SIGHT_MODEL_DEFS, VEHICLE_MODELS } from '@/lib/voxel/models';

import { createGlobeLod } from './globeLod';
import type { LodBlend } from './globeLod';
import { addVoxelLights } from './thumbnails';

const BACKGROUND = 0x08162b;
const DASH_SPACING = 2.7 * DEG;
const ARROW_EVERY = 6;
const COLOR_AHEAD = 0xf4905c;
const COLOR_CURRENT = 0xffe45c;
const COLOR_DONE = 0x4d6078;

// The moon keeps its real size ratio and sidereal month, on a much tighter orbit.
const MOON_SCALE = (GLOBE_RADIUS * 0.273) / MOON_RADIUS;
const MOON_ORBIT_DAYS = 27.32;
const MOON_ORBIT_RADIUS = 420;
const MOON_INCLINATION = 18.3 * DEG;
const MOON_START_ANGLE = Math.PI + 0.17;
// The orbit always stays this much wider than the camera distance.
const MOON_CAMERA_MARGIN = 1.4;

const CAMERA_FOV = 30;
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
  reducedMotion: boolean;
  // Journey progress from 0 to 1. Without it the scene runs on its own clock.
  getProgress?: () => number;
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
type Landmark = { mesh: Mesh; unit: Vector3; scale: number; radii: number[]; label: Label | null; labelLift: number };

type Label = { element: HTMLElement; anchor: Vector3; closeness: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

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
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 1, 2000);
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
  const landmarks: Landmark[] = [];
  const lod = createGlobeLod({
    onLevelReady: (level): void => {
      for (const landmark of landmarks) landmark.radii[level.index] = level.surfaceRadius(landmark.unit);
    }
  });
  globe.add(lod.group);
  let routeRadius = lod.defaultLevel.routeRadius;

  const scratch = {
    a: new Vector3(),
    b: new Vector3(),
    c: new Vector3(),
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
    markers.forEach((marker, index) => {
      mesh.setMatrixAt(index, surfaceMatrix(marker.unit, routeRadius, marker.heading, scratch.matrix));
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
    placeMarkers(mesh, markers);
    globe.add(mesh);
    return mesh;
  };
  const dashMesh = createMarkers(new BoxGeometry(0.9, 0.5, 0.5), dashes);
  const arrowMesh = createMarkers(createArrowGeometry(), arrows);

  const paintMarkers = (mesh: InstancedMesh, markers: Marker[], leg: number, fraction: number): void => {
    markers.forEach((marker, index) => {
      const done = marker.leg < leg || (marker.leg === leg && marker.fraction <= fraction);
      const hex = done ? COLOR_DONE : marker.leg === leg ? COLOR_CURRENT : COLOR_AHEAD;
      mesh.setColorAt(index, scratch.color.setHex(hex));
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  // Vehicles share one holder that rides along the route.
  const vehicleHolder = new Group();
  vehicleHolder.matrixAutoUpdate = false;
  globe.add(vehicleHolder);
  const vehicleMeshes = new Map<VehicleId, Mesh>();
  const vehicleHeights = new Map<VehicleId, number>();
  (Object.keys(VEHICLES) as VehicleId[]).forEach((id) => {
    const built = buildModel(VEHICLE_MODELS[id]);
    const mesh = new Mesh(track(built.geometry), voxelMaterial);
    mesh.scale.setScalar(VEHICLES[id].scale);
    vehicleHeights.set(id, built.size.y * VEHICLES[id].scale);
    mesh.visible = false;
    vehicleHolder.add(mesh);
    vehicleMeshes.set(id, mesh);
  });

  const placeLandmark = (landmark: Landmark, radius: number): void => {
    const { mesh, unit, scale, label, labelLift } = landmark;
    mesh.matrix.copy(surfaceMatrix(unit, radius, eastOf(unit, scratch.c), scratch.matrix)).scale(scratch.a.setScalar(scale));
    mesh.matrixWorldNeedsUpdate = true;
    label?.anchor.copy(unit).multiplyScalar(radius + labelLift);
  };

  const addLandmark = (geometry: BufferGeometry, position: LatLon, scale: number, label: Label | null, labelLift: number): void => {
    const unit = latLonToUnit(position);
    const mesh = new Mesh(track(geometry), voxelMaterial);
    mesh.matrixAutoUpdate = false;
    globe.add(mesh);
    const radii = Array.from({ length: EARTH_LEVEL_COUNT }, (_, index) => lod.level(index)?.surfaceRadius(unit) ?? Number.NaN);
    const landmark = { mesh, unit, scale, radii, label, labelLift };
    landmarks.push(landmark);
    placeLandmark(landmark, radii[DEFAULT_EARTH_LEVEL]);
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
    addLandmark(built.geometry, sight.position, SIGHT_SCALE, label, built.size.y * SIGHT_SCALE + 0.6);
    return label;
  });
  addLandmark(buildModel(FLAGS_MODEL).geometry, [STOCKHOLM[0] + FLAGS_OFFSET[0], STOCKHOLM[1] + FLAGS_OFFSET[1]], FLAGS_SCALE, null, 0);

  const hereLabel = createLabel(options.hereLabelClassName, options.hereLabelText, new Vector3());

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
  let paintedKey = -1;
  let frame = 0;
  let previousTime = performance.now();
  const vehicleUnit = new Vector3();
  const vehicleHeading = new Vector3();

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

  const updateVehicle = (): void => {
    const legTrack = tracks[legIndex];
    trackPoint(legTrack, legProgress, vehicleUnit);
    headingAt(legTrack, legProgress, vehicleHeading);
    surfaceMatrix(vehicleUnit, routeRadius, vehicleHeading, vehicleHolder.matrix);

    const activeId = LEGS[legIndex].modelId;
    const pose = reducedMotion ? 0 : Math.floor(elapsed * POSES_PER_SECOND) / POSES_PER_SECOND;
    const moving = status.running ? 1 : 0.35;
    vehicleMeshes.forEach((mesh, id) => {
      mesh.visible = id === activeId;
      if (!mesh.visible) return;
      const { motion } = VEHICLES[id];
      mesh.position.y = motion === 'walk' ? Math.abs(Math.sin(pose * 7)) * 0.22 * moving : 0;
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
      targetPitch = clamp(Math.asin(clamp(vehicleUnit.y, -1, 1)) - VIEW_LATITUDE, -limit, limit);
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
    camera.position.set(0, 0, distance);
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
    world.project(camera);
    const x = Math.round((world.x * 0.5 + 0.5) * width);
    const y = Math.round((-world.y * 0.5 + 0.5) * height);
    label.element.style.display = 'block';
    label.element.style.opacity = String(clamp((facing - LABEL_MIN_FACING) / 0.2, 0, 1));
    label.element.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  };

  const updateLabels = (): void => {
    scene.updateMatrixWorld();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const vehicleHeight = vehicleHeights.get(LEGS[legIndex].modelId) ?? 0;
    hereLabel.anchor.copy(vehicleUnit).multiplyScalar(routeRadius + vehicleHeight + 1.4);
    // Sights are named near the traveller, or near the view centre when steering freely.
    if (status.follow) focus.copy(vehicleUnit);
    else focus.set(0, 0, 1).applyQuaternion(scratch.rotation.copy(globe.quaternion).invert());
    for (const label of labels) {
      label.closeness = scratch.a.copy(label.anchor).normalize().dot(focus);
    }
    const threshold = Math.max(LABEL_RANGE, labels.map((label) => label.closeness).sort((a, b) => b - a)[LABELS_SHOWN - 1]);
    for (const label of labels) {
      positionLabel(label, label.closeness >= threshold, width, height);
    }
    // Before departure and after arrival the flags mark the spot instead.
    positionLabel(hereLabel, status.started && !status.finished, width, height);
  };

  // Moves the route and everything on the ground to the height of the visible detail.
  const applyBlend = ({ from, to, amount }: LodBlend): void => {
    const key = from * 10 + amount;
    if (key === appliedBlend) return;
    appliedBlend = key;
    const mix = (coarse: number, fine: number): number => (amount <= 0 ? coarse : amount >= 1 ? fine : coarse + (fine - coarse) * amount);
    routeRadius = mix(lod.level(from)?.routeRadius ?? routeRadius, lod.level(to)?.routeRadius ?? routeRadius);
    placeMarkers(dashMesh, dashes);
    placeMarkers(arrowMesh, arrows);
    for (const landmark of landmarks) {
      placeLandmark(landmark, mix(landmark.radii[from], landmark.radii[to]));
    }
  };

  // The detail level follows the camera distance, so it changes at the pace of the zoom.
  const updateDetail = (): void => {
    lod.build(LOD_BUILD_BUDGET_MS);
    const zoom = distance / (CAMERA_START * fitFactor);
    const coordinate = DEFAULT_EARTH_LEVEL - Math.log(zoom) / Math.log(ZOOM_STEP_RATIO);
    applyBlend(lod.update(coordinate, bufferWidth, bufferHeight));
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
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const tick = (time: number): void => {
    const delta = Math.min(0.05, (time - previousTime) / 1000);
    previousTime = time;
    elapsed += delta;
    if (options.getProgress) syncToProgress(options.getProgress());
    else advance(delta);
    updateDetail();
    updateVehicle();
    updateCamera(delta);
    updateMoon();
    updateRouteColors();
    updateLabels();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };

  // Start facing Stockholm without easing in from the far side.
  updateVehicle();
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
      for (const label of [...labels, hereLabel]) label.element.remove();
      for (const item of disposables) item.dispose();
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
      idleTime = 0;
      setStatus({ follow: !status.follow });
    },
    setSpin: (x: number, y: number): void => {
      spinX = x;
      spinY = y;
      if ((x !== 0 || y !== 0) && status.follow) setStatus({ follow: false });
    },
    zoom: (direction: number): void => {
      zoomLevel = clamp(zoomLevel + (direction > 0 ? -1 : 1), 0, EARTH_LEVEL_COUNT - 1);
      zoomFactor = ZOOM_STEP_RATIO ** (DEFAULT_EARTH_LEVEL - zoomLevel);
    }
  };
};
