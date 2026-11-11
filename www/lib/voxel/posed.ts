import { Mesh } from 'three';
import type { BufferGeometry, Material, Vector3 } from 'three';

import { buildModel, buildPose } from './model';
import type { VoxelModelDef } from './model';

// A model on a mesh that can be put in any pose of its sequence.
export type PosedModel = {
  mesh: Mesh;
  size: Vector3;
  // Shows the pose that the given seconds of travelling lead to.
  pose: (seconds: number) => void;
  // Shows one pose of the sequence.
  show: (frame: number) => void;
  dispose: () => void;
};

export const createPosedModel = (def: VoxelModelDef, material: Material): PosedModel => {
  const { sequence } = def;
  const still = buildModel(def);
  const mesh = new Mesh(still.geometry, material);
  // Each pose is built the first time it is shown.
  const poses: (BufferGeometry | undefined)[] = [];

  const show = (frame: number): void => {
    if (!sequence) return;
    poses[frame] ??= buildPose(sequence, frame, still);
    mesh.geometry = poses[frame];
  };

  return {
    mesh,
    size: still.size,
    pose: (seconds): void => {
      if (sequence) show(Math.floor(seconds * sequence.framesPerSecond) % sequence.frames);
    },
    show,
    dispose: (): void => {
      still.geometry.dispose();
      for (const pose of poses) pose?.dispose();
    }
  };
};
