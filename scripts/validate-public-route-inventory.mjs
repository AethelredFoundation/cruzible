import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROUTE_INVENTORY_PATH =
  "docs/architecture/public-route-inventory.json";

const PAGES_ROOT = "src/pages";
const PAGE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);
const SPECIAL_PAGE_NAMES = new Set(["_app", "_document", "_error", "404"]);
const VALID_KINDS = new Set(["page", "next-api"]);
const VALID_STATUSES = new Set([
  "ready",
  "operational",
  "launch-gated",
  "dev-only",
]);
const DEV_ONLY_GUARDS = ["getServerSideProps", "isDevtoolsEnabled", "notFound"];

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function stripExtension(filePath) {
  return filePath.slice(0, -path.extname(filePath).length);
}

function normalizeDynamicSegment(segment) {
  const optionalCatchAll = segment.match(/^\[\[\.\.\.([^\]]+)\]\]$/);
  if (optionalCatchAll) {
    return `{...${optionalCatchAll[1]}?}`;
  }

  const catchAll = segment.match(/^\[\.\.\.([^\]]+)\]$/);
  if (catchAll) {
    return `{...${catchAll[1]}}`;
  }

  const dynamic = segment.match(/^\[([^\]]+)\]$/);
  if (dynamic) {
    return `{${dynamic[1]}}`;
  }

  return segment;
}

function walkFiles(directory, root = directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return walkFiles(absolutePath, root);
    }

    if (!entry.isFile()) {
      return [];
    }

    return [toPosixPath(path.relative(root, absolutePath))];
  });
}

export function routeFromPageFile(relativeFile) {
  const extension = path.extname(relativeFile);
  if (!PAGE_EXTENSIONS.has(extension)) {
    return null;
  }

  const withoutExtension = stripExtension(toPosixPath(relativeFile));
  const segments = withoutExtension.split("/");

  if (segments[0] === "api") {
    const apiSegments = segments.slice(1);
    if (apiSegments[apiSegments.length - 1] === "index") {
      apiSegments.pop();
    }

    const apiPath =
      apiSegments.length === 0
        ? "/api"
        : `/api/${apiSegments.map(normalizeDynamicSegment).join("/")}`;

    return {
      kind: "next-api",
      path: apiPath,
    };
  }

  if (SPECIAL_PAGE_NAMES.has(segments[0]) || segments[0].startsWith("_")) {
    return null;
  }

  if (segments[segments.length - 1] === "index") {
    segments.pop();
  }

  return {
    kind: "page",
    path:
      segments.length === 0
        ? "/"
        : `/${segments.map(normalizeDynamicSegment).join("/")}`,
  };
}

function compareRoutes(a, b) {
  return (
    a.kind.localeCompare(b.kind) ||
    a.path.localeCompare(b.path) ||
    a.file.localeCompare(b.file)
  );
}

export function discoverNextRoutes(root = process.cwd()) {
  const pagesDirectory = path.join(root, PAGES_ROOT);
  if (!existsSync(pagesDirectory)) {
    return [];
  }

  return walkFiles(pagesDirectory)
    .map((relativeFile) => {
      const route = routeFromPageFile(relativeFile);
      if (!route) {
        return null;
      }

      return {
        ...route,
        file: `${PAGES_ROOT}/${relativeFile}`,
      };
    })
    .filter(Boolean)
    .sort(compareRoutes);
}

function routeKey(route) {
  return `${route.kind}:${route.path}`;
}

function safeRouteKey(route) {
  if (
    !route ||
    typeof route !== "object" ||
    typeof route.kind !== "string" ||
    typeof route.path !== "string"
  ) {
    return null;
  }

  return routeKey(route);
}

function readTextIfPresent(root, filePath) {
  const absolutePath = path.join(root, filePath);
  if (!existsSync(absolutePath)) {
    return "";
  }

  return readFileSync(absolutePath, "utf8");
}

function validateRouteEntry(route, index, root, discoveredByKey, errors) {
  const label = `routes[${index}]`;

  if (!route || typeof route !== "object") {
    errors.push(`${label} must be an object.`);
    return;
  }

  const key = safeRouteKey(route);
  const discovered = key ? discoveredByKey.get(key) : null;

  if (!VALID_KINDS.has(route.kind)) {
    errors.push(`${label} has invalid kind "${route.kind}".`);
  }

  if (!VALID_STATUSES.has(route.status)) {
    errors.push(`${label} has invalid status "${route.status}".`);
  }

  if (typeof route.path !== "string" || !route.path.startsWith("/")) {
    errors.push(`${label} must use an absolute route path.`);
  }

  if (typeof route.file !== "string" || !route.file.startsWith(PAGES_ROOT)) {
    errors.push(`${label} must reference a file under ${PAGES_ROOT}.`);
  } else if (!existsSync(path.join(root, route.file))) {
    errors.push(`${label} references missing file ${route.file}.`);
  }

  if (route.path?.includes("[") || route.path?.includes("]")) {
    errors.push(`${label} must document dynamic routes with {param} syntax.`);
  }

  if (
    route.kind === "page" &&
    typeof route.path === "string" &&
    route.path.startsWith("/api/")
  ) {
    errors.push(`${label} marks API route ${route.path} as a page.`);
  }

  if (
    route.kind === "next-api" &&
    typeof route.path === "string" &&
    !route.path.startsWith("/api/")
  ) {
    errors.push(`${label} marks non-API route ${route.path} as next-api.`);
  }

  if (typeof route.surface !== "string" || route.surface.trim().length < 3) {
    errors.push(`${label} must name the user or operator surface.`);
  }

  if (typeof route.control !== "string" || route.control.trim().length < 12) {
    errors.push(`${label} must describe the launch/readiness control.`);
  }

  if (!Array.isArray(route.evidence) || route.evidence.length === 0) {
    errors.push(`${label} must include repository evidence paths.`);
  } else {
    if (!route.evidence.includes(route.file)) {
      errors.push(`${label} evidence must include the route file.`);
    }

    for (const evidencePath of route.evidence) {
      if (
        typeof evidencePath !== "string" ||
        !existsSync(path.join(root, evidencePath))
      ) {
        errors.push(`${label} references missing evidence ${evidencePath}.`);
      }
    }
  }

  if (key && !discovered) {
    errors.push(`${label} documents stale route ${key}.`);
  } else if (discovered && route.file !== discovered.file) {
    errors.push(
      `${label} maps ${key} to ${route.file}, discovered ${discovered.file}.`,
    );
  }

  const source = route.file ? readTextIfPresent(root, route.file) : "";

  if (route.status === "launch-gated") {
    if (route.launchGate?.component !== "LaunchReadinessPage") {
      errors.push(
        `${label} launch-gated route must declare LaunchReadinessPage as the gate.`,
      );
    }

    if (!source.includes("LaunchReadinessPage")) {
      errors.push(
        `${label} launch-gated route must render LaunchReadinessPage.`,
      );
    }
  }

  if (route.status === "dev-only") {
    for (const guard of DEV_ONLY_GUARDS) {
      if (!source.includes(guard)) {
        errors.push(`${label} dev-only route must contain ${guard}.`);
      }
    }
  }
}

export function validatePublicRouteInventory({
  root = process.cwd(),
  inventory,
  discovered = discoverNextRoutes(root),
} = {}) {
  const errors = [];
  let parsedInventory = inventory;

  if (!parsedInventory) {
    const inventoryPath = path.join(root, ROUTE_INVENTORY_PATH);
    if (!existsSync(inventoryPath)) {
      return {
        discovered,
        inventory: null,
        errors: [`Missing public route inventory at ${ROUTE_INVENTORY_PATH}.`],
      };
    }

    parsedInventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  }

  if (!Array.isArray(parsedInventory.routes)) {
    return {
      discovered,
      inventory: parsedInventory,
      errors: ["Public route inventory must include a routes array."],
    };
  }

  const discoveredByKey = new Map(
    discovered.map((route) => [routeKey(route), route]),
  );
  const manifestByKey = new Map();

  parsedInventory.routes.forEach((route, index) => {
    const key = safeRouteKey(route);
    if (key && manifestByKey.has(key)) {
      errors.push(`Duplicate public route inventory entry ${key}.`);
    }
    if (key) {
      manifestByKey.set(key, route);
    }
    validateRouteEntry(route, index, root, discoveredByKey, errors);
  });

  for (const route of discovered) {
    const key = routeKey(route);
    if (!manifestByKey.has(key)) {
      errors.push(`Missing public route inventory entry for ${key}.`);
    }
  }

  return {
    discovered,
    inventory: parsedInventory,
    errors,
  };
}

const isCliEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isCliEntrypoint) {
  const { discovered, errors } = validatePublicRouteInventory();

  if (errors.length > 0) {
    console.error("Public route inventory validation failed.");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const pageCount = discovered.filter((route) => route.kind === "page").length;
  const apiCount = discovered.filter(
    (route) => route.kind === "next-api",
  ).length;

  console.log(
    `Public route inventory validation passed (${pageCount} pages, ${apiCount} Next API routes).`,
  );
}
