import { useEffect, useState } from 'react';

import type { VoxelModelDef } from '@/lib/voxel/model';

import { renderModelThumbnails } from './thumbnails';

// PNG data URLs keyed by model id, rendered once the page has painted.
export const useModelThumbnails = (models: readonly VoxelModelDef[], size: number): Record<string, string> => {
  const [images, setImages] = useState<Record<string, string>>({});
  const modelIds = models.map((model) => model.id).join(',');

  useEffect(() => {
    const unique = new Map(models.map((model) => [model.id, model]));
    const frame = requestAnimationFrame(() => setImages(renderModelThumbnails([...unique.values()], size)));
    return (): void => cancelAnimationFrame(frame);
    // The images only depend on which models are shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIds, size]);

  return images;
};
