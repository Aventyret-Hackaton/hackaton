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
  // Builds one pose that is not built yet. False when all of them are.
  prepare: () => boolean;
  dispose: () => void;
};

// A deferred model only shows poses that prepare has built, so that no frame waits for one.
export const createPosedModel = (def: VoxelModelDef, material: Material, deferred = false): PosedModel => {
  const { sequence } = def;
  const still = buildModel(def);
  const mesh = new Mesh(still.geometry, material);
  // Each pose is built the first time it is shown, or by prepare.
  const poses: (BufferGeometry | undefined)[] = [];
  let prepared = 0;

  const show = (frame: number): void => {
    if (!sequence) return;
    if (!deferred) poses[frame] ??= buildPose(sequence, frame, still);
    const pose = poses[frame];
    if (pose) mesh.geometry = pose;
  };

  return {
    mesh,
    size: still.size,
    pose: (seconds): void => {
      if (sequence) show(Math.floor(seconds * sequence.framesPerSecond) % sequence.frames);
    },
    show,
    prepare: (): boolean => {
      if (!sequence) return false;
      while (prepared < sequence.frames && poses[prepared]) prepared += 1;
      if (prepared >= sequence.frames) return false;
      poses[prepared] = buildPose(sequence, prepared, still);
      return true;
    },
    dispose: (): void => {
      still.geometry.dispose();
      for (const pose of poses) pose?.dispose();
    }
  };
};
