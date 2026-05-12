const path = require("path");

const wagmiConnectorsRoot = path.dirname(
  require.resolve("@wagmi/connectors/package.json"),
);
const isProduction = process.env.NODE_ENV === "production";
const imageRemotePatterns = [
  ...(isProduction ? [] : [{ protocol: "http", hostname: "localhost" }]),
  { protocol: "https", hostname: "api.aethelred.io" },
];

function sourceForUrl(value) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function uniqueSources(sources) {
  return [...new Set(sources.filter(Boolean))];
}

function buildContentSecurityPolicy() {
  const configuredApiOrigin = sourceForUrl(process.env.NEXT_PUBLIC_API_URL);
  const devnetSources = isProduction
    ? []
    : [
        "http://localhost:*",
        "http://127.0.0.1:*",
        "ws://localhost:*",
        "ws://127.0.0.1:*",
      ];
  const connectSrc = uniqueSources([
    "'self'",
    configuredApiOrigin,
    "https://api.aethelred.io",
    "https://api.mainnet.aethelred.org",
    "https://api.testnet.aethelred.org",
    "https://evm-rpc.aethelred.network",
    "https://evm-rpc-testnet.aethelred.network",
    "wss://evm-ws.aethelred.network",
    "wss://evm-ws-testnet.aethelred.network",
    "https://*.walletconnect.com",
    "wss://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://*.walletconnect.org",
    ...devnetSources,
  ]);

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://api.aethelred.io https://cruzible.aethelred.org https://cruzible.aethelred.network",
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "form-action 'self'",
    "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
    "frame-ancestors 'none'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

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
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: buildContentSecurityPolicy(),
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
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

    config.optimization.splitChunks = {
      chunks: "all",
      cacheGroups: {
        default: false,
        vendors: false,
        vendor: {
          name: "vendor",
          chunks: "all",
          test: /node_modules/,
          priority: 20,
        },
        common: {
          name: "common",
          minChunks: 2,
          chunks: "all",
          priority: 10,
          reuseExistingChunk: true,
          enforce: true,
        },
        recharts: {
          name: "recharts",
          test: /[\\/]node_modules[\\/]recharts/,
          priority: 30,
        },
      },
    };

    if (!dev && !isServer) {
      config.optimization.minimize = true;
    }

    return config;
  },

  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },

  trailingSlash: false,
  poweredByHeader: false,
  generateEtags: true,
  distDir: ".next",
};

module.exports = nextConfig;
