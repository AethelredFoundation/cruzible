/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  
  // Image optimization
  images: {
    domains: ['localhost', 'api.aethelred.io'],
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
  },

  // Compression
  compress: true,

  // Experimental features
  experimental: {
    externalDir: true,
    // optimizeCss requires 'critters' package — disabled until installed
    // optimizeCss: true,
    scrollRestoration: true,
  },

  // TypeScript — skip type checking backend/ and sdk/ which have their own
  // tsconfig. The frontend tsconfig include already scopes to src/.
  typescript: {
    ignoreBuildErrors: false,
  },

  // Headers for security and caching
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin',
          },
        ],
      },
      {
        // Cache static assets
        source: '/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Cache images
        source: '/_next/image/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  // Redirects
  async redirects() {
    return [
      {
        source: '/old-path',
        destination: '/new-path',
        permanent: true,
      },
    ];
  },

  // Rewrites for API proxying (development)
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/v1/:path*',
      },
    ];
  },

  // Webpack optimization
  webpack: (config, { isServer, dev }) => {
    // Handle node: protocol imports (used by sdk/typescript via protocol.ts)
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
        stream: false,
        buffer: false,
        fs: false,
        path: false,
        os: false,
      };

      // Rewrite node: scheme imports to bare specifiers for browser fallback
      const webpack = require('webpack');
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /^node:/,
          (resource) => {
            resource.request = resource.request.replace(/^node:/, '');
          },
        ),
      );
    }

    // Split chunks optimization
    config.optimization.splitChunks = {
      chunks: 'all',
      cacheGroups: {
        default: false,
        vendors: false,
        // Vendor chunk for node_modules
        vendor: {
          name: 'vendor',
          chunks: 'all',
          test: /node_modules/,
          priority: 20,
        },
        // Commons chunk for shared code
        common: {
          name: 'common',
          minChunks: 2,
          chunks: 'all',
          priority: 10,
          reuseExistingChunk: true,
          enforce: true,
        },
        // Recharts chunk
        recharts: {
          name: 'recharts',
          test: /[\\/]node_modules[\\/]recharts/,
          priority: 30,
        },
      },
    };

    // Production optimizations
    if (!dev && !isServer) {
      config.optimization.minimize = true;
    }

    return config;
  },

  // Environment variables exposed to client
  env: {
    NEXT_PUBLIC_APP_VERSION: process.env.npm_package_version,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },

  // Trailing slashes
  trailingSlash: false,

  // Powered by header
  poweredByHeader: false,

  // Generate ETags
  generateEtags: true,

  // Dist directory
  distDir: '.next',
};

module.exports = nextConfig;
