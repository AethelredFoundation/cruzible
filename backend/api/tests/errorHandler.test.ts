import type { NextFunction, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../src/middleware/errorHandler";

describe("error handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("logs unhandled errors without leaking messages or stack traces", () => {
    const error = new Error("database password=super-secret leaked upstream");
    const req = { requestId: "unhandled-error-request" } as Request;
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const res = {
      headersSent: false,
      status,
      json,
    } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    errorHandler(error, req, res, next);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: "InternalServerError",
      message: "Unexpected server error",
      requestId: "unhandled-error-request",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("super-secret");
    expect(errorSpy).toHaveBeenCalledWith(
      "[cruzible-api] Unhandled API error",
      {
        requestId: "unhandled-error-request",
        error: expect.objectContaining({ errorName: "Error" }),
      },
    );
  });
});
