import type { ReactElement } from "react";

import type { Metadata } from "next";
import { Press_Start_2P } from "next/font/google";

import { GlobeView } from "@/components/globe/GlobeView";
import { APP_TAGLINE, APP_TITLE } from "@/lib/globe/journey";

const pixelFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
});

export const metadata: Metadata = {
  title: APP_TITLE,
  description: APP_TAGLINE,
};

const GlobePage = (): ReactElement => (
  <div className={pixelFont.variable}>
    <GlobeView />
  </div>
);

export default GlobePage;
