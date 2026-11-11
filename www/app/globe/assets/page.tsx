import type { Metadata } from 'next';

import { AssetGallery } from '@/components/globe/AssetGallery';

export const metadata: Metadata = {
  title: 'Voxelmodeller – Pointless Travel Planner'
};

const AssetsPage = (): React.JSX.Element => <AssetGallery />;

export default AssetsPage;
