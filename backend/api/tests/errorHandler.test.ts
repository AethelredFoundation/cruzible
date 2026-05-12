import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { errorHandler } from "../src/middleware/errorHandler";

describe("error handler", () => {
  it("delegates late errors after headers have already been sent", () => {
    const error = new Error("late stream failure");
    const req = { requestId: "late-error-request" } as Request;
    const status = vi.fn();
    const json = vi.fn();
    const res = {
      headersSent: true,
      status,
      json,
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    errorHandler(error, req, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
  });
});
