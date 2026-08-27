import express from "express";
import { query } from "express-validator";
import { describe, expect, it } from "vitest";
import { validate } from "../src/middleware/validate";
import { withHttpServer } from "./helpers/http";

describe("validate middleware", () => {
  it("omits rejected input values from validation details", async () => {
    const app = express();
    app.get(
      "/checked",
      [
        query("limit")
          .isInt({ min: 1, max: 100 })
          .withMessage("limit must be between 1 and 100"),
        validate,
      ],
      (_req, res) => res.json({ ok: true }),
    );
    app.use((err: any, _req: any, res: any, _next: any) => {
      res.status(err.statusCode || 500).json({
        message: err.message,
        details: err.details,
      });
    });

    await withHttpServer(app, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/checked?limit=secret-token-value`,
      );
      const body = await response.json();
      const serializedBody = JSON.stringify(body);

      expect(response.status).toBe(400);
      expect(body.message).toBe("Validation failed");
      expect(serializedBody).toContain("limit");
      expect(serializedBody).toContain("limit must be between 1 and 100");
      expect(serializedBody).not.toContain("secret-token-value");
    });
  });
});
