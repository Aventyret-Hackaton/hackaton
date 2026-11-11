import type { ReactElement } from "react";

import type { Metadata } from "next";
import { Press_Start_2P } from "next/font/google";

import { AssetGallery } from "@/components/globe/AssetGallery";

const pixelFont = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
});

export const metadata: Metadata = {
  title: "Voxelmodeller – Pointless Travel Planner",
};

const AssetsPage = (): ReactElement => (
  <div className={pixelFont.variable}>
    <AssetGallery />
  </div>
);

export default AssetsPage;
