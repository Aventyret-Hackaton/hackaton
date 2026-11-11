import type { Metadata } from 'next';

import { GlobeView } from '@/components/globe/GlobeView';
import { APP_TAGLINE, APP_TITLE } from '@/lib/globe/journey';

export const metadata: Metadata = {
  title: APP_TITLE,
  description: APP_TAGLINE
};

const GlobePage = (): React.JSX.Element => <GlobeView />;

export default GlobePage;
