'use client';

import { useEffect, useRef, useState } from 'react';

import * as THREE from 'three';

import type { Place } from '@/lib/places';
import { createLongRoute } from '@/lib/route';

type TripGlobeProps = {
  origin: Place;
  destination: Place;
  durationSeconds?: number;
};

const ROUTE_SEGMENTS = 512;
const CAMERA_DISTANCE = 9;
const EARTH_TEXTURE_URL = '/earth.jpg';

const createGraticule = (): THREE.LineSegments => {
  const geometry = new THREE.WireframeGeometry(new THREE.SphereGeometry(1.001, 24, 12));
  const material = new THREE.LineBasicMaterial({ color: 0x4a78b8 });
  return new THREE.LineSegments(geometry, material);
};

const createMarker = (position: THREE.Vector3, color: number, radius: number): THREE.Mesh => {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 16), new THREE.MeshBasicMaterial({ color }));
  marker.position.copy(position);
  return marker;
};

const disposeScene = (scene: THREE.Scene): void => {
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material: THREE.Material) => material.dispose());
    }
  });
};

export const TripGlobe = ({ origin, destination, durationSeconds = 60 }: TripGlobeProps): React.JSX.Element => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const route = createLongRoute(origin, destination);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const { pointAt, axis } = createLongRoute(origin, destination);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const earthMaterial = new THREE.MeshBasicMaterial({ color: 0x1b3a6b });
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), earthMaterial));
    const graticule = createGraticule();
    scene.add(graticule);

    // Optional texture, the graticule is the fallback when the file is missing.
    const texture = new THREE.TextureLoader().load(
      EARTH_TEXTURE_URL,
      (loaded) => {
        loaded.colorSpace = THREE.SRGBColorSpace;
        earthMaterial.map = loaded;
        earthMaterial.color.set(0xffffff);
        earthMaterial.needsUpdate = true;
        graticule.visible = false;
      },
      undefined,
      () => undefined
    );

    const routePoints = Array.from({ length: ROUTE_SEGMENTS + 1 }, (_, index) => pointAt(index / ROUTE_SEGMENTS).multiplyScalar(1.005));
    const plannedLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(routePoints), new THREE.LineBasicMaterial({ color: 0x888888 }));
    const travelledLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(routePoints.map((point) => point.clone().multiplyScalar(1.002))),
      new THREE.LineBasicMaterial({ color: 0xff4422 })
    );
    travelledLine.geometry.setDrawRange(0, 0);
    scene.add(plannedLine, travelledLine);

    scene.add(createMarker(pointAt(0).multiplyScalar(1.005), 0x33dd66, 0.015));
    scene.add(createMarker(pointAt(1).multiplyScalar(1.005), 0xffffff, 0.015));
    const dot = createMarker(pointAt(0), 0xffdd00, 0.03);
    scene.add(dot);

    const resize = (): void => {
      const width = container.clientWidth || window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener('resize', resize);

    const position = new THREE.Vector3();
    const startTime = performance.now();
    let lastReported = -1;

    renderer.setAnimationLoop(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      const current = Math.min(elapsed / durationSeconds, 1);

      pointAt(current, position);
      dot.position.copy(position).multiplyScalar(1.01);
      travelledLine.geometry.setDrawRange(0, Math.floor(current * ROUTE_SEGMENTS) + 1);

      // The camera follows the dot, so the globe appears to rotate under it.
      camera.position.copy(position).addScaledVector(axis, 0.35).setLength(CAMERA_DISTANCE);
      camera.up.copy(axis);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);

      const rounded = Math.floor(current * 1000) / 1000;
      if (rounded !== lastReported) {
        lastReported = rounded;
        setProgress(current);
      }
      if (current >= 1) {
        renderer.setAnimationLoop(null);
      }
    });

    return (): void => {
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      disposeScene(scene);
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [origin, destination, durationSeconds]);

  return (
    <div>
      <p>
        {origin.address} → {destination.address}
      </p>
      <p>
        {Math.round(progress * route.distanceKm).toLocaleString('sv-SE')} av {Math.round(route.distanceKm).toLocaleString('sv-SE')} km
        {progress >= 1 ? ' – framme!' : ''}
      </p>
      <div ref={containerRef} />
    </div>
  );
};
