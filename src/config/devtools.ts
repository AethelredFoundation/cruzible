type DevtoolsEnv = {
  [key: string]: string | undefined;
  NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL?: string;
  NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL?: string;
  NEXT_PUBLIC_DEVTOOLS_RPC_URL?: string;
};

type DevtoolsService = "fastapi" | "nextjs" | "rpc";

type DevtoolsServiceUrls = Record<DevtoolsService, string>;

const DEFAULT_DEVTOOLS_URLS: DevtoolsServiceUrls = {
  fastapi: "http://127.0.0.1:8000",
  nextjs: "http://127.0.0.1:3000",
  rpc: "http://127.0.0.1:26657",
};

const DEVTOOLS_ENV_KEYS: Record<DevtoolsService, keyof DevtoolsEnv> = {
  fastapi: "NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL",
  nextjs: "NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL",
  rpc: "NEXT_PUBLIC_DEVTOOLS_RPC_URL",
};

function isLocalDevtoolsHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function normalizeDevtoolsOrigin(
  service: DevtoolsService,
  value: string,
): string {
  const envKey = DEVTOOLS_ENV_KEYS[service];
  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${envKey} must be an absolute URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${envKey} must use http or https`);
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${envKey} must not include credentials`);
  }

  if (parsed.search || parsed.hash) {
    throw new Error(`${envKey} must not include query strings or fragments`);
  }

  if (parsed.pathname.replace(/\/+$/, "")) {
    throw new Error(`${envKey} must be a service origin, not a deep path`);
  }

  if (!isLocalDevtoolsHost(parsed.hostname)) {
    throw new Error(`${envKey} must point to localhost for devtools`);
  }

  return parsed.origin;
}

export function getDevtoolsServiceUrls(
  env: DevtoolsEnv = process.env,
): DevtoolsServiceUrls {
  return {
    fastapi: normalizeDevtoolsOrigin(
      "fastapi",
      env.NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL?.trim() ||
        DEFAULT_DEVTOOLS_URLS.fastapi,
    ),
    nextjs: normalizeDevtoolsOrigin(
      "nextjs",
      env.NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL?.trim() ||
        DEFAULT_DEVTOOLS_URLS.nextjs,
    ),
    rpc: normalizeDevtoolsOrigin(
      "rpc",
      env.NEXT_PUBLIC_DEVTOOLS_RPC_URL?.trim() || DEFAULT_DEVTOOLS_URLS.rpc,
    ),
  };
}
