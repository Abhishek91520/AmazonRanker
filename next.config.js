/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['playwright-core', '@sparticuz/chromium'],
  turbopack: {},
};

module.exports = nextConfig;
