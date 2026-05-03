const apiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const chainEnv = process.env.NEXT_PUBLIC_CHAIN_ENV?.trim() || "testnet";
const allowedChainEnvs = new Set(["mainnet", "testnet", "devnet"]);

function fail(message) {
  console.error(`Invalid frontend public build environment: ${message}`);
  process.exit(1);
}

function isLocalApiHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

if (!apiUrl) {
  fail(
    "NEXT_PUBLIC_API_URL is required at build time because Next.js public env is compiled into browser bundles.",
  );
}

if (!allowedChainEnvs.has(chainEnv)) {
  fail("NEXT_PUBLIC_CHAIN_ENV must be one of mainnet, testnet, or devnet.");
}

let parsedApiUrl;

try {
  parsedApiUrl = new URL(apiUrl);
} catch {
  fail("NEXT_PUBLIC_API_URL must be an absolute URL.");
}

if (parsedApiUrl.protocol !== "https:" && parsedApiUrl.protocol !== "http:") {
  fail("NEXT_PUBLIC_API_URL must use http or https.");
}

const hostname = parsedApiUrl.hostname.toLowerCase();
const isLocalHost = isLocalApiHost(hostname);

if (chainEnv !== "devnet" && isLocalHost) {
  fail(
    "NEXT_PUBLIC_API_URL must not point at localhost unless NEXT_PUBLIC_CHAIN_ENV=devnet.",
  );
}

if (chainEnv !== "mainnet" && hostname.includes("mainnet")) {
  fail(
    "NEXT_PUBLIC_API_URL points at a mainnet API while NEXT_PUBLIC_CHAIN_ENV is not mainnet.",
  );
}

if (chainEnv === "mainnet" && hostname.includes("testnet")) {
  fail(
    "NEXT_PUBLIC_API_URL must not point at a testnet API when NEXT_PUBLIC_CHAIN_ENV=mainnet.",
  );
}

console.log(
  `Frontend public API build config validated for ${chainEnv}: ${parsedApiUrl.origin}`,
);
