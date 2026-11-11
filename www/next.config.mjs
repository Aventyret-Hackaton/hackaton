/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required by the rig's prod image stage (slim standalone Node runner).
  output: 'standalone',
  // The rig proxy serves the dev server on these hosts.
  allowedDevOrigins: ['www.hackaton.test', 'hackaton.test']
};

export default nextConfig;
