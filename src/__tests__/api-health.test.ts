import type { NextApiRequest, NextApiResponse } from "next";

import handler from "@/pages/api/health";

type JsonBody = Record<string, unknown>;

function createResponse() {
  const res = {
    body: undefined as JsonBody | undefined,
    ended: false,
    headers: new Map<string, string>(),
    statusCode: 200,
    end: vi.fn(() => {
      res.ended = true;
      return res;
    }),
    json: vi.fn((body: JsonBody) => {
      res.body = body;
      return res;
    }),
    setHeader: vi.fn((name: string, value: string) => {
      res.headers.set(name.toLowerCase(), value);
      return res;
    }),
    status: vi.fn((statusCode: number) => {
      res.statusCode = statusCode;
      return res;
    }),
  };

  return res as unknown as NextApiResponse & typeof res;
}

function createRequest(method: string): NextApiRequest {
  return { method } as NextApiRequest;
}

describe("/api/health", () => {
  it("returns a non-cacheable frontend health payload", () => {
    const res = createResponse();

    handler(createRequest("GET"), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toMatchObject({
      service: "cruzible-frontend",
      status: "ok",
    });
    expect(typeof res.body?.timestamp).toBe("string");
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
  });

  it("supports HEAD probes without a response body", () => {
    const res = createResponse();

    handler(createRequest("HEAD"), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.end).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it("rejects unsupported methods with an allow header", () => {
    const res = createResponse();

    handler(createRequest("POST"), res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.body).toEqual({ error: "Method Not Allowed" });
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });
});
