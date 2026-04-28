import '@testing-library/jest-dom/vitest';
import { TextDecoder, TextEncoder } from 'node:util';
import { afterAll, beforeAll, vi } from 'vitest';

const webFetch = globalThis.fetch?.bind(globalThis);
const WebHeaders = globalThis.Headers;
const WebRequest = globalThis.Request;
const WebResponse = globalThis.Response;

if (typeof globalThis.TextEncoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder });
}

if (typeof globalThis.TextDecoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder });
}

if (typeof globalThis.fetch === 'undefined') {
  Object.defineProperty(globalThis, 'fetch', { value: webFetch });
}

if (typeof globalThis.Headers === 'undefined' && WebHeaders) {
  Object.defineProperty(globalThis, 'Headers', { value: WebHeaders });
}

if (typeof globalThis.Request === 'undefined' && WebRequest) {
  Object.defineProperty(globalThis, 'Request', { value: WebRequest });
}

if (typeof globalThis.Response === 'undefined' && WebResponse) {
  Object.defineProperty(globalThis, 'Response', { value: WebResponse });
}

vi.mock('next/router', () => ({
  useRouter: () => ({
    route: '/',
    pathname: '/',
    query: {},
    asPath: '/',
    push: vi.fn(),
    replace: vi.fn(),
    reload: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    beforePopState: vi.fn(),
    events: {
      on: vi.fn(),
      off: vi.fn(),
      emit: vi.fn(),
    },
    isFallback: false,
    isLocaleDomain: false,
    isReady: true,
    isPreview: false,
  }),
}));

vi.mock('next/head', () => ({
  __esModule: true,
  default: ({ children }: { children?: unknown }) => children,
}));

class IntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  configurable: true,
  value: IntersectionObserver,
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

class ResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  configurable: true,
  value: ResizeObserver,
});

const originalError = console.error;

beforeAll(() => {
  console.error = (...args) => {
    if (/Warning.*not wrapped in act/.test(String(args[0] ?? ''))) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});
