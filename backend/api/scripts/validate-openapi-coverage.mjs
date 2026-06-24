import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ROUTES_ROOT = path.join(API_ROOT, "src", "routes", "v1");
const ROUTE_INDEX = path.join(ROUTES_ROOT, "index.ts");
const OPENAPI_PATHS = path.join(
  API_ROOT,
  "src",
  "config",
  "openapi-paths.json",
);
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

function readText(filePath) {
  return readFileSync(filePath, "utf8");
}

function parseRouterImports(indexSource) {
  const imports = new Map();
  const importPattern = /import\s+\{([^}]+)\}\s+from\s+"\.\/(\w+)"/g;

  for (const match of indexSource.matchAll(importPattern)) {
    const moduleName = match[2];
    const importedNames = match[1]
      .split(",")
      .map((entry) => entry.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);

    for (const importedName of importedNames) {
      imports.set(importedName, moduleName);
    }
  }

  return imports;
}

function parseMounts(indexSource) {
  const imports = parseRouterImports(indexSource);
  const mounts = [];
  const mountPattern = /router\.use\(\s*"([^"]+)"\s*,\s*(\w+)\s*\)/g;

  for (const match of indexSource.matchAll(mountPattern)) {
    const [, mountPath, routerName] = match;
    const moduleName = imports.get(routerName);

    if (!moduleName) {
      throw new Error(
        `Could not resolve module for mounted router ${routerName}`,
      );
    }

    mounts.push({ mountPath, routerName, moduleName });
  }

  return mounts;
}

function normalizeExpressRoute(routePath) {
  if (routePath === "/") {
    return "";
  }

  return routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

export function discoverExpressRoutes(indexSource = readText(ROUTE_INDEX)) {
  const routes = [];

  for (const mount of parseMounts(indexSource)) {
    const routeFile = path.join(ROUTES_ROOT, `${mount.moduleName}.ts`);
    const source = readText(routeFile);
    const routePattern =
      /router\.(get|post|put|patch|delete)\s*\(\s*"([^"]+)"/g;

    for (const match of source.matchAll(routePattern)) {
      const [, method, routePath] = match;
      routes.push({
        method,
        path: `/v1${mount.mountPath}${normalizeExpressRoute(routePath)}`,
        source: path.relative(API_ROOT, routeFile),
      });
    }
  }

  return routes.sort((left, right) =>
    `${left.method} ${left.path}`.localeCompare(
      `${right.method} ${right.path}`,
    ),
  );
}

export function loadOpenApiRoutes(pathsSource = readText(OPENAPI_PATHS)) {
  const paths = JSON.parse(pathsSource);
  const routes = [];

  for (const [routePath, operations] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      if (
        operations &&
        typeof operations === "object" &&
        method in operations
      ) {
        routes.push({ method, path: routePath });
      }
    }
  }

  return routes.sort((left, right) =>
    `${left.method} ${left.path}`.localeCompare(
      `${right.method} ${right.path}`,
    ),
  );
}

function routeKey(route) {
  return `${route.method.toUpperCase()} ${route.path}`;
}

export function validateOpenApiCoverage({
  expressRoutes = discoverExpressRoutes(),
  openApiRoutes = loadOpenApiRoutes(),
} = {}) {
  const expressRouteKeys = new Set(expressRoutes.map(routeKey));
  const openApiRouteKeys = new Set(openApiRoutes.map(routeKey));
  const missing = [...expressRouteKeys].filter(
    (key) => !openApiRouteKeys.has(key),
  );
  const stale = [...openApiRouteKeys].filter(
    (key) => !expressRouteKeys.has(key),
  );
  const errors = [];

  if (expressRoutes.length === 0) {
    errors.push("No Express /v1 routes were discovered");
  }

  if (openApiRoutes.length === 0) {
    errors.push("No OpenAPI /v1 routes were documented");
  }

  for (const key of missing) {
    errors.push(`Missing OpenAPI coverage for ${key}`);
  }

  for (const key of stale) {
    errors.push(`OpenAPI documents stale route ${key}`);
  }

  return { expressRoutes, openApiRoutes, missing, stale, errors };
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  const { expressRoutes, errors } = validateOpenApiCoverage();

  if (errors.length > 0) {
    console.error("OpenAPI coverage validation failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `OpenAPI coverage validation passed (${expressRoutes.length} routes).`,
  );
}
