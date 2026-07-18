import { fileURLToPath } from "node:url";
export { FRONTEND_PUBLIC_BUILD_KEYS } from "./lib/frontend-public-env-keys.mjs";

const allowedChainEnvs = new Set(["mainnet", "testnet", "devnet"]);
const productionApiOriginsByChain = {
  mainnet: ["https://api.mainnet.aethelred.org"],
  testnet: ["https://api.testnet.aethelred.org"],
};
const EVM_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";
const WALLETCONNECT_PROJECT_ID_PATTERN = /^[0-9a-fA-F]{32}$/;
const BLOCKED_WALLETCONNECT_PROJECT_IDS = new Set([
  "00000000000000000000000000000000",
  "11111111111111111111111111111111",
  "0123456789abcdef0123456789abcdef",
  "abcdef0123456789abcdef0123456789",
]);
// Required per chain env. Testnet requires only the contracts this repo can
// actually deploy (backend/contracts-evm: Cruzible + StAETHEL) — the bridge,
// stablecoin, wrapped-token, and governance addresses have no contracts here
// yet, and the frontend feature-gates cleanly when they are blank
// (getContractAddress → undefined → hooks disabled). Mainnet keeps the full
// requirement: launching there without the periphery deployed is a decision
// that must be taken deliberately, not by leaving variables blank.
const DEPLOYED_REQUIRED_ADDRESS_KEYS_BY_CHAIN = {
  mainnet: [
    "NEXT_PUBLIC_CRUZIBLE_ADDRESS",
    "NEXT_PUBLIC_STAETHEL_ADDRESS",
    "NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS",
    "NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS",
    "NEXT_PUBLIC_USDC_TOKEN_ADDRESS",
    "NEXT_PUBLIC_USDT_TOKEN_ADDRESS",
  ],
  testnet: ["NEXT_PUBLIC_CRUZIBLE_ADDRESS", "NEXT_PUBLIC_STAETHEL_ADDRESS"],
  devnet: [],
};
const PUBLIC_ADDRESS_KEYS = [
  "NEXT_PUBLIC_CRUZIBLE_ADDRESS",
  "NEXT_PUBLIC_STAETHEL_ADDRESS",
  "NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS",
  "NEXT_PUBLIC_GOVERNANCE_ADDRESS",
  "NEXT_PUBLIC_STABLECOIN_BRIDGE_ADDRESS",
  "NEXT_PUBLIC_USDC_TOKEN_ADDRESS",
  "NEXT_PUBLIC_USDT_TOKEN_ADDRESS",
];
const DEVTOOLS_URL_KEYS = [
  "NEXT_PUBLIC_DEVTOOLS_FASTAPI_URL",
  "NEXT_PUBLIC_DEVTOOLS_NEXTJS_URL",
  "NEXT_PUBLIC_DEVTOOLS_RPC_URL",
];
const MAINNET_CONFIG_KEYS = [
  "NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID",
  "NEXT_PUBLIC_AETHELRED_MAINNET_RPC_URL",
  "NEXT_PUBLIC_AETHELRED_MAINNET_EXPLORER_URL",
];
const PUBLIC_APP_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,127}$/;
const GENESIS_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export class FrontendPublicEnvError extends Error {
  constructor(message) {
    super(message);
    this.name = "FrontendPublicEnvError";
  }
}

function isLocalApiHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function assertValidLocalDevtoolsOrigin(env, key) {
  const value = env[key]?.trim();
  if (!value) {
    return;
  }

  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new FrontendPublicEnvError(`${key} must be an absolute URL.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FrontendPublicEnvError(`${key} must use http or https.`);
  }

  if (parsed.username || parsed.password) {
    throw new FrontendPublicEnvError(`${key} must not include credentials.`);
  }

  if (parsed.search || parsed.hash) {
    throw new FrontendPublicEnvError(
      `${key} must not include query strings or fragments.`,
    );
  }

  if (parsed.pathname.replace(/\/+$/, "")) {
    throw new FrontendPublicEnvError(
      `${key} must be a service origin, not a deep path.`,
    );
  }

  if (!isLocalApiHost(parsed.hostname.toLowerCase())) {
    throw new FrontendPublicEnvError(
      `${key} must point to localhost when devtools are enabled.`,
    );
  }
}

function deployedRequirementMessage(key, chainEnv) {
  return `${key} must be a non-zero EVM address when NEXT_PUBLIC_CHAIN_ENV=${chainEnv}.`;
}

function assertValidAddress(env, key, { required = false, chainEnv } = {}) {
  const value = env[key]?.trim();
  if (!value) {
    if (!required) {
      return;
    }

    throw new FrontendPublicEnvError(deployedRequirementMessage(key, chainEnv));
  }

  if (
    !EVM_ADDRESS_PATTERN.test(value) ||
    value.toLowerCase() === ZERO_EVM_ADDRESS
  ) {
    throw new FrontendPublicEnvError(
      required
        ? deployedRequirementMessage(key, chainEnv)
        : `${key} must be blank or a non-zero EVM address.`,
    );
  }
}

function assertValidWalletConnectProjectId(
  env,
  { required = false, chainEnv } = {},
) {
  const value = env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  if (!value) {
    if (!required) {
      return;
    }

    throw new FrontendPublicEnvError(
      `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required when NEXT_PUBLIC_CHAIN_ENV=${chainEnv}.`,
    );
  }

  if (!WALLETCONNECT_PROJECT_ID_PATTERN.test(value)) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must be a 32-character hex WalletConnect project ID.",
    );
  }

  if (BLOCKED_WALLETCONNECT_PROJECT_IDS.has(value.toLowerCase())) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID must not use a placeholder project ID.",
    );
  }
}

function assertPublicServiceUrl(
  env,
  key,
  { required = false, allowPath = false, chainEnv } = {},
) {
  const value = env[key]?.trim();
  if (!value) {
    if (required) {
      throw new FrontendPublicEnvError(
        `${key} is required when NEXT_PUBLIC_CHAIN_ENV=${chainEnv}.`,
      );
    }
    return;
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new FrontendPublicEnvError(`${key} must be an absolute URL.`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new FrontendPublicEnvError(`${key} must use http or https.`);
  }
  if (parsed.username || parsed.password) {
    throw new FrontendPublicEnvError(`${key} must not include credentials.`);
  }
  if (parsed.search || parsed.hash) {
    throw new FrontendPublicEnvError(
      `${key} must not include query strings or fragments.`,
    );
  }
  if (!allowPath && parsed.pathname.replace(/\/+$/, "")) {
    throw new FrontendPublicEnvError(`${key} must be a service origin.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocalHost = isLocalApiHost(hostname);
  if (chainEnv !== "devnet" && isLocalHost) {
    throw new FrontendPublicEnvError(
      `${key} must not point at localhost unless NEXT_PUBLIC_CHAIN_ENV=devnet.`,
    );
  }
  if (
    parsed.protocol !== "https:" &&
    !(chainEnv === "devnet" && isLocalHost) &&
    !allowsPlaintextHttp(env)
  ) {
    throw new FrontendPublicEnvError(
      `${key} must use https unless NEXT_PUBLIC_CHAIN_ENV=devnet and the host is localhost, or CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true (pre-TLS testing profile).`,
    );
  }
}

function assertMainnetNetworkConfig(env) {
  for (const key of MAINNET_CONFIG_KEYS) {
    if (!env[key]?.trim()) {
      throw new FrontendPublicEnvError(
        `${key} is required when NEXT_PUBLIC_CHAIN_ENV=mainnet; the repository has no mainnet defaults.`,
      );
    }
  }

  const chainId = Number(env.NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID);
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || chainId === 7332) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_AETHELRED_MAINNET_CHAIN_ID must be a positive integer distinct from confirmed testnet chain ID 7332.",
    );
  }

  assertPublicServiceUrl(env, "NEXT_PUBLIC_AETHELRED_MAINNET_RPC_URL", {
    required: true,
    allowPath: true,
    chainEnv: "mainnet",
  });
  assertPublicServiceUrl(env, "NEXT_PUBLIC_AETHELRED_MAINNET_EXPLORER_URL", {
    required: true,
    chainEnv: "mainnet",
  });
}

function assertOptionalPublicAppConfig(env, chainEnv) {
  assertPublicServiceUrl(env, "NEXT_PUBLIC_ZEROID_APP_URL", { chainEnv });

  const appVersion = env.NEXT_PUBLIC_APP_VERSION?.trim();
  if (appVersion && !PUBLIC_APP_VERSION_PATTERN.test(appVersion)) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_APP_VERSION must be 1-128 safe version characters.",
    );
  }
}

const EXTRA_API_ORIGINS_KEY = "CRUZIBLE_EXTRA_API_ORIGINS";

// Build-time escape hatch for self-hosted staging/testnet API deployments
// (e.g. a validator team fronting the API on its own host before canonical
// DNS exists). Comma-separated https origins, validated as strictly as the
// primary allowlist. The operator-facing inputs are not named NEXT_PUBLIC,
// but next.config.js deliberately compiles their validated, non-secret policy
// values into browser code so client validation and runtime CSP enforce the
// same allowlist. Never place credentials in these values.
//
// http entries are admitted ONLY under the pre-TLS testing profile
// (CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true) — the compose backend serves plain
// HTTP, so a pre-DNS deployment has no https API origin to name.
function allowsPlaintextHttp(env) {
  return env.CRUZIBLE_ALLOW_PLAINTEXT_HTTP?.trim() === "true";
}

function parseExtraApiOrigins(env) {
  const raw = env[EXTRA_API_ORIGINS_KEY]?.trim();
  if (!raw) {
    return [];
  }

  const plaintextAllowed = allowsPlaintextHttp(env);

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      let parsed;

      try {
        parsed = new URL(entry);
      } catch {
        throw new FrontendPublicEnvError(
          `${EXTRA_API_ORIGINS_KEY} entries must be absolute URLs; got "${entry}".`,
        );
      }

      if (
        parsed.protocol !== "https:" &&
        !(parsed.protocol === "http:" && plaintextAllowed)
      ) {
        throw new FrontendPublicEnvError(
          `${EXTRA_API_ORIGINS_KEY} entries must use https (http requires CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true); got "${entry}".`,
        );
      }

      if (parsed.username || parsed.password) {
        throw new FrontendPublicEnvError(
          `${EXTRA_API_ORIGINS_KEY} entries must not include credentials.`,
        );
      }

      if (parsed.search || parsed.hash || parsed.pathname.replace(/\/+$/, "")) {
        throw new FrontendPublicEnvError(
          `${EXTRA_API_ORIGINS_KEY} entries must be bare origins, not deep paths; got "${entry}".`,
        );
      }

      return parsed.origin;
    });
}

function assertAllowedProductionApiOrigin(env, chainEnv, origin) {
  if (chainEnv === "devnet") {
    return;
  }

  const allowedOrigins = [
    ...productionApiOriginsByChain[chainEnv],
    ...parseExtraApiOrigins(env),
  ];
  if (!allowedOrigins.includes(origin)) {
    throw new FrontendPublicEnvError(
      `NEXT_PUBLIC_API_URL must be one of ${allowedOrigins.join(", ")} when NEXT_PUBLIC_CHAIN_ENV=${chainEnv}. ` +
        `Self-hosted API origins can be allowlisted at build time via ${EXTRA_API_ORIGINS_KEY} (comma-separated https origins).`,
    );
  }
}

export function validateFrontendPublicEnv(env = process.env) {
  const apiUrl = env.NEXT_PUBLIC_API_URL?.trim();
  const rawChainEnv = env.NEXT_PUBLIC_CHAIN_ENV?.trim();
  const chainEnv = rawChainEnv || "testnet";

  if (!apiUrl) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL is required at build time because Next.js public env is compiled into browser bundles.",
    );
  }

  if (env.NODE_ENV === "production" && !rawChainEnv) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_CHAIN_ENV is required for production builds.",
    );
  }

  if (!allowedChainEnvs.has(chainEnv)) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_CHAIN_ENV must be one of mainnet, testnet, or devnet.",
    );
  }

  if (env.NEXT_PUBLIC_ENABLE_DEVTOOLS?.trim() === "true") {
    if (chainEnv !== "devnet") {
      throw new FrontendPublicEnvError(
        "NEXT_PUBLIC_ENABLE_DEVTOOLS may only be true when NEXT_PUBLIC_CHAIN_ENV=devnet.",
      );
    }

    for (const key of DEVTOOLS_URL_KEYS) {
      assertValidLocalDevtoolsOrigin(env, key);
    }
  }

  let parsedApiUrl;

  try {
    parsedApiUrl = new URL(apiUrl);
  } catch {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must be an absolute URL.",
    );
  }

  if (parsedApiUrl.username || parsedApiUrl.password) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must not include credentials.",
    );
  }

  if (parsedApiUrl.search || parsedApiUrl.hash) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must not include query strings or fragments.",
    );
  }

  const normalizedPath = parsedApiUrl.pathname.replace(/\/+$/, "");
  if (normalizedPath && normalizedPath !== "/v1") {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL path must be empty or /v1.",
    );
  }

  if (parsedApiUrl.protocol !== "https:" && parsedApiUrl.protocol !== "http:") {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must use http or https.",
    );
  }

  const hostname = parsedApiUrl.hostname.toLowerCase();
  const isLocalHost = isLocalApiHost(hostname);

  if (chainEnv !== "devnet" && isLocalHost) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must not point at localhost unless NEXT_PUBLIC_CHAIN_ENV=devnet.",
    );
  }

  if (
    parsedApiUrl.protocol !== "https:" &&
    !(chainEnv === "devnet" && isLocalHost) &&
    !allowsPlaintextHttp(env)
  ) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_API_URL must use https unless NEXT_PUBLIC_CHAIN_ENV=devnet and the host is localhost, or CRUZIBLE_ALLOW_PLAINTEXT_HTTP=true (pre-TLS testing profile).",
    );
  }

  assertAllowedProductionApiOrigin(env, chainEnv, parsedApiUrl.origin);

  const requiredDeployedAddressKeys = new Set(
    DEPLOYED_REQUIRED_ADDRESS_KEYS_BY_CHAIN[chainEnv],
  );
  for (const key of PUBLIC_ADDRESS_KEYS) {
    assertValidAddress(env, key, {
      chainEnv,
      required: requiredDeployedAddressKeys.has(key),
    });
  }

  assertValidWalletConnectProjectId(env, {
    chainEnv,
    required: chainEnv !== "devnet",
  });

  if (chainEnv === "mainnet") {
    assertMainnetNetworkConfig(env);
  } else if (chainEnv === "testnet") {
    assertPublicServiceUrl(env, "NEXT_PUBLIC_AETHELRED_TESTNET_RPC_URL", {
      required: true,
      allowPath: true,
      chainEnv,
    });
    assertPublicServiceUrl(env, "NEXT_PUBLIC_AETHELRED_TESTNET_EXPLORER_URL", {
      chainEnv,
    });
  } else {
    assertPublicServiceUrl(env, "NEXT_PUBLIC_AETHELRED_DEVNET_RPC_URL", {
      allowPath: true,
      chainEnv,
    });
  }

  const genesisHash = env.NEXT_PUBLIC_AETHELRED_GENESIS_HASH?.trim();
  if (env.NODE_ENV === "production" && !genesisHash) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_AETHELRED_GENESIS_HASH is required for production builds so same-chain-id networks cannot be confused.",
    );
  }
  if (
    genesisHash &&
    (!GENESIS_HASH_PATTERN.test(genesisHash) || /^0x0{64}$/iu.test(genesisHash))
  ) {
    throw new FrontendPublicEnvError(
      "NEXT_PUBLIC_AETHELRED_GENESIS_HASH must be a non-zero 32-byte hex block hash.",
    );
  }

  assertOptionalPublicAppConfig(env, chainEnv);

  return {
    apiOrigin: parsedApiUrl.origin,
    chainEnv,
  };
}

function fail(message) {
  console.error(`Invalid frontend public build environment: ${message}`);
  process.exit(1);
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  try {
    const result = validateFrontendPublicEnv();
    console.log(
      `Frontend public API build config validated for ${result.chainEnv}: ${result.apiOrigin}`,
    );
  } catch (error) {
    if (error instanceof FrontendPublicEnvError) {
      fail(error.message);
    }

    throw error;
  }
}
