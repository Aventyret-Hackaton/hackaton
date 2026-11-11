'use client';

import type { VoxelModelDef } from '@/lib/voxel/model';
import { FLAGS_MODEL, SIGHT_MODEL_DEFS, VEHICLE_MODELS } from '@/lib/voxel/models';

import styles from './AssetGallery.module.css';
import { pixelFont } from './pixelFont';
import { useModelThumbnails } from './useModelThumbnails';

const IMAGE_SIZE = 220;

const GROUPS: readonly { title: string; models: readonly VoxelModelDef[] }[] = [
  { title: 'Färdmedel', models: Object.values(VEHICLE_MODELS) },
  {
    title: 'Sevärdheter och flaggor',
    models: [...Object.values(SIGHT_MODEL_DEFS), FLAGS_MODEL]
  }
];
const MODELS = GROUPS.flatMap((group) => group.models);

export const AssetGallery = (): React.JSX.Element => {
  const images = useModelThumbnails(MODELS, IMAGE_SIZE);

  return (
    <main className={`${pixelFont.variable} ${styles.root}`}>
      <h1 className={styles.title}>Voxelmodeller</h1>
      {GROUPS.map((group) => (
        <section key={group.title} className={styles.group}>
          <h2 className={styles.heading}>{group.title}</h2>
          <ul className={styles.grid}>
            {group.models.map((model) => (
              <li key={model.id} className={styles.card}>
                {images[model.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.image} src={images[model.id]} alt="" width={IMAGE_SIZE} height={IMAGE_SIZE} />
                ) : (
                  <div className={styles.image} />
                )}
                <span className={styles.label}>{model.label}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
};
