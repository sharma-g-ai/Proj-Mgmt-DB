/** @type {import('next').NextConfig} */
const nextConfig = {
  // pdfkit reads bundled .afm font files and exceljs is a large CJS package —
  // keep both external so they load from node_modules at runtime rather than
  // being processed by the bundler (which breaks pdfkit's font resolution).
  experimental: {
    serverComponentsExternalPackages: ["pdfkit", "exceljs", "unpdf"],
  },
};

export default nextConfig;
