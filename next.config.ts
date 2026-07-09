import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // ATLAS uses bun workspaces (packages/* + mini-services/*). Tell Turbopack
  // the project root so it can resolve workspace dependencies correctly.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
