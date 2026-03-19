/**
 * Jest Polyfills — loaded before test environment is set up.
 * Required for libraries (e.g. viem, msw v2) that depend on Node.js globals
 * not available in jsdom.
 *
 * IMPORTANT: Must use Object.defineProperty to survive jsdom environment setup.
 */

const { TextEncoder, TextDecoder } = require("util");
const { ReadableStream, WritableStream, TransformStream } =
  require("node:stream/web");

// Streams must be on globalThis before undici loads
Object.defineProperties(globalThis, {
  TextEncoder: { value: TextEncoder, writable: true, configurable: true },
  TextDecoder: { value: TextDecoder, writable: true, configurable: true },
  ReadableStream: { value: ReadableStream, writable: true, configurable: true },
  WritableStream: { value: WritableStream, writable: true, configurable: true },
  TransformStream: {
    value: TransformStream,
    writable: true,
    configurable: true,
  },
});

// msw v2 requires fetch API globals (Request, Response, fetch, Headers).
// jest-environment-jsdom replaces the global scope, stripping Node.js built-ins.
// See: https://mswjs.io/docs/faq#requestresponsetext-encoder-is-not-defined-jest
// BroadcastChannel is needed by msw WebSocket support
const { BroadcastChannel } = require("node:worker_threads");
Object.defineProperties(globalThis, {
  BroadcastChannel: {
    value: BroadcastChannel,
    writable: true,
    configurable: true,
  },
});

const { fetch: nodeFetch, Headers, Request, Response } = require("undici");

Object.defineProperties(globalThis, {
  fetch: { value: nodeFetch, writable: true, configurable: true },
  Headers: { value: Headers, writable: true, configurable: true },
  Request: { value: Request, writable: true, configurable: true },
  Response: { value: Response, writable: true, configurable: true },
});
