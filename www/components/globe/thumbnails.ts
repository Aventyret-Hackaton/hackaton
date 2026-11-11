import { DirectionalLight, HemisphereLight, Mesh, MeshLambertMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three';

import { buildModel } from '@/lib/voxel/model';
import type { VoxelModelDef } from '@/lib/voxel/model';

const DEG = Math.PI / 180;

// Map-view camera from the concept book: 45° around the vertical, 35° down.
const VIEW_DIRECTION = new Vector3(Math.sin(45 * DEG) * Math.cos(35 * DEG), Math.sin(35 * DEG), Math.cos(45 * DEG) * Math.cos(35 * DEG));

export const addVoxelLights = (scene: Scene): void => {
  const key = new DirectionalLight(0xffe8c2, 2.5);
  key.position.set(-1.1, 1.4, 1.5);
  scene.add(key, new HemisphereLight(0xa9c8ff, 0x22335f, 1.25));
};

// Renders each model once and returns PNG data URLs keyed by model id.
export const renderModelThumbnails = (defs: readonly VoxelModelDef[], size: number): Record<string, string> => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);

  const scene = new Scene();
  addVoxelLights(scene);
  const material = new MeshLambertMaterial({ vertexColors: true });
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
  const images: Record<string, string> = {};

  for (const def of defs) {
    const { geometry } = buildModel(def);
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);

    const sphere = geometry.boundingSphere;
    const radius = (sphere?.radius ?? 1) * 1.02;
    const center = sphere?.center ?? new Vector3();
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.position.copy(center).addScaledVector(VIEW_DIRECTION, 200);
    camera.lookAt(center);
    camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    images[def.id] = canvas.toDataURL('image/png');

    scene.remove(mesh);
    geometry.dispose();
  }

  material.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return images;
};
