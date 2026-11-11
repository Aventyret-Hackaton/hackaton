/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required by the rig's prod image stage (slim standalone Node runner).
  output: 'standalone'
};

export default nextConfig;
