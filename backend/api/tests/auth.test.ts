import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { authenticate } from "../src/auth/middleware";
import { generateTokens } from "../src/auth/service";
import { withHttpServer } from "./helpers/http";

describe("auth middleware", () => {
  afterEach(() => {
    process.env.ALLOW_MOCK_SIGNATURES = "false";
  });

  it("rejects requests without a bearer token", async () => {
    const app = express();
    app.get("/protected", authenticate, (req, res) => {
      res.json({ address: req.user?.address });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body.message).toContain("Authorization header missing");
    });
  });

  it("accepts requests with a valid access token", async () => {
    const app = express();
    app.get("/protected", authenticate, (req, res) => {
      res.json({ address: req.user?.address, roles: req.user?.roles });
    });

    const { accessToken } = generateTokens({
      address: "aeth1validuser",
      roles: ["user", "operator"],
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/protected`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        address: "aeth1validuser",
        roles: ["user", "operator"],
      });
    });
  });
});
