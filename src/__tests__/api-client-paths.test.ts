import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getJob,
  getStakingInfo,
  getTransaction,
  getValidator,
} from "@/lib/api";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("legacy API client path construction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes route parameters before composing request URLs", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(jsonResponse({ success: true, data: {} })),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getJob("job/1?debug=true");
    await getTransaction("tx/hash#fragment");
    await getValidator("aeth val/oper1");
    await getStakingInfo("aeth1user/../../admin");

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:3001/v1/jobs/job%2F1%3Fdebug%3Dtrue",
      "http://localhost:3001/v1/transactions/tx%2Fhash%23fragment",
      "http://localhost:3001/v1/validators/aeth%20val%2Foper1",
      "http://localhost:3001/v1/staking/aeth1user%2F..%2F..%2Fadmin",
    ]);
  });
});
