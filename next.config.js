const path = require("path");

const wagmiConnectorsRoot = path.dirname(
  require.resolve("@wagmi/connectors/package.json"),
);
const isProduction = process.env.NODE_ENV === "production";
const imageRemotePatterns = [
  ...(isProduction ? [] : [{ protocol: "http", hostname: "localhost" }]),
  { protocol: "https", hostname: "api.aethelred.io" },
];
const disabledBrowserFeatures = [
  "accelerometer",
  "autoplay",
  "browsing-topics",
  "camera",
  "display-capture",
  "encrypted-media",
  "gamepad",
  "geolocation",
  "gyroscope",
  "interest-cohort",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "speaker-selection",
  "usb",
  "xr-spatial-tracking",
];
const permissionsPolicy = disabledBrowserFeatures
  .map((feature) => `${feature}=()`)
  .join(", ");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,

  // Image optimization
  images: {
    remotePatterns: imageRemotePatterns,
    formats: ["image/webp", "image/avif"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  // Compression
  compress: true,
  productionBrowserSourceMaps: false,

  // Experimental features
  experimental: {
    externalDir: true,
    scrollRestoration: true,
    optimizePackageImports: ["lucide-react", "recharts"],
  },

  // TypeScript
  typescript: {
    ignoreBuildErrors: false,
  },

  // Headers for security and caching
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "off" },
          // HSTS pins browsers to https for two years — poison for a
          // pre-DNS/pre-TLS testnet host serving plain HTTP on a public IP.
          // CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true (same opt-out the CSP
          // middleware honors) omits it; defaults stay secure.
          ...(process.env.CRUZIBLE_ALLOW_PLAINTEXT_HTTP === "true"
            ? []
            : [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]),
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: permissionsPolicy,
          },
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          { key: "Cross-Origin-Resource-Policy", value: "same-site" },
          { key: "Origin-Agent-Cluster", value: "?1" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/_next/image/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },

  // Webpack optimization
  webpack: (config, { isServer, dev }) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@cruzible/wagmi-connector-coinbase": path.join(
        wagmiConnectorsRoot,
        "dist/esm/coinbaseWallet.js",
      ),
      "@cruzible/wagmi-connector-walletconnect": path.join(
        wagmiConnectorsRoot,
        "dist/esm/walletConnect.js",
      ),
    };

    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@react-native-async-storage/async-storage": false,
      };

      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        buffer: false,
        fs: false,
        path: false,
        os: false,
      };

      const webpack = require("webpack");
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
    }

    if (!isServer && !dev) {
      config.optimization.minimize = true;
    }

    return config;
  },

  env: {
    NEXT_PUBLIC_APP_VERSION:
      process.env.NEXT_PUBLIC_APP_VERSION ||
      process.env.npm_package_version ||
      "local-dev",
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    // These are non-secret build policies. Expose the already-validated
    // values to browser code so client-side origin checks match the build and
    // runtime CSP contract for self-hosted/pre-TLS testnet deployments.
    NEXT_PUBLIC_CRUZIBLE_EXTRA_API_ORIGINS:
      process.env.CRUZIBLE_EXTRA_API_ORIGINS,
    NEXT_PUBLIC_CRUZIBLE_ALLOW_PLAINTEXT_HTTP:
      process.env.CRUZIBLE_ALLOW_PLAINTEXT_HTTP,
  },

  trailingSlash: false,
  poweredByHeader: false,
  generateEtags: true,
  distDir: ".next",
};

module.exports = nextConfig;
