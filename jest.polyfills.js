/**
 * Jest Polyfills — loaded before test environment is set up.
 * Required for libraries (e.g. viem) that depend on Node.js globals
 * not available in jsdom.
 */

const { TextEncoder, TextDecoder } = require('util');

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}
