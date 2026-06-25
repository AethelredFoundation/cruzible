import { describe, expect, it } from "vitest";
import {
  discoverNextRoutes,
  routeFromPageFile,
  validatePublicRouteInventory,
} from "../../scripts/validate-public-route-inventory.mjs";

type InventoryRoute = {
  path: string;
  kind: string;
  file: string;
  status: string;
  launchGate?: {
    component?: string;
  };
};

type RouteInventory = {
  routes?: unknown[];
};

type ValidatePublicRouteInventory = (options?: {
  root?: string;
  inventory?: RouteInventory;
  discovered?: InventoryRoute[];
}) => {
  discovered: InventoryRoute[];
  inventory: RouteInventory | null;
  errors: string[];
};

const validateInventory =
  validatePublicRouteInventory as ValidatePublicRouteInventory;

describe("public route inventory", () => {
  it("matches every public Next.js page and API route", () => {
    const { discovered, inventory, errors } = validateInventory();
    const discoveredRoutes = discovered;
    const inventoryRoutes = (inventory?.routes ?? []) as InventoryRoute[];

    expect(errors).toEqual([]);
    expect(
      inventoryRoutes.map((route) => `${route.kind}:${route.path}`).sort(),
    ).toEqual(
      discoveredRoutes.map((route) => `${route.kind}:${route.path}`).sort(),
    );
    expect(inventoryRoutes).toHaveLength(15);
  });

  it("documents dynamic routes with stable brace syntax", () => {
    expect(routeFromPageFile("jobs/[id].tsx")).toEqual({
      kind: "page",
      path: "/jobs/{id}",
    });
    expect(routeFromPageFile("models/[modelHash].tsx")).toEqual({
      kind: "page",
      path: "/models/{modelHash}",
    });
    expect(routeFromPageFile("api/health.ts")).toEqual({
      kind: "next-api",
      path: "/api/health",
    });
  });

  it("keeps non-production and launch-gated surfaces explicit", () => {
    const { inventory, errors } = validateInventory();
    const inventoryRoutes = (inventory?.routes ?? []) as InventoryRoute[];
    const routeByPath = new Map(
      inventoryRoutes.map((route) => [route.path, route]),
    );

    expect(errors).toEqual([]);
    expect(routeByPath.get("/devtools")?.status).toBe("dev-only");
    expect(routeByPath.get("/governance")?.status).toBe("launch-gated");
    expect(routeByPath.get("/governance")?.launchGate?.component).toBe(
      "LaunchReadinessPage",
    );
    expect(routeByPath.get("/api/health")?.kind).toBe("next-api");
  });

  it("does not classify framework internals as public inventory routes", () => {
    const discovered = discoverNextRoutes() as InventoryRoute[];
    const publicFiles = new Set(discovered.map((route) => route.file));

    expect(publicFiles.has("src/pages/_app.tsx")).toBe(false);
    expect(publicFiles.has("src/pages/_document.tsx")).toBe(false);
    expect(publicFiles.has("src/pages/_error.tsx")).toBe(false);
    expect(publicFiles.has("src/pages/404.tsx")).toBe(false);
  });

  it("reports malformed manifest entries instead of throwing", () => {
    const { errors } = validateInventory({
      discovered: [],
      inventory: {
        routes: [null, { kind: "page" }],
      },
    });

    expect(errors).toContain("routes[0] must be an object.");
    expect(errors).toContain("routes[1] must use an absolute route path.");
    expect(errors).toContain(
      "routes[1] must reference a file under src/pages.",
    );
  });
});
