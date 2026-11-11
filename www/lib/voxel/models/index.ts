import type { SightModelId, VehicleId } from "@/lib/globe/journey";

import type { VoxelModelDef } from "../model";

import { BOAT_MODELS } from "./boats";
import { PEOPLE_MODELS } from "./people";
import { FLAGS_MODEL, SIGHT_MODELS } from "./sights";
import { WHEEL_MODELS } from "./wheels";

export const VEHICLE_MODELS: Record<VehicleId, VoxelModelDef> = {
  ...BOAT_MODELS,
  ...WHEEL_MODELS,
  ...PEOPLE_MODELS,
};

export const SIGHT_MODEL_DEFS: Record<SightModelId, VoxelModelDef> =
  SIGHT_MODELS;

export { FLAGS_MODEL };
