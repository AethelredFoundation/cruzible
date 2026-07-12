import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  fetchLiveReconciliation,
  fetchReconciliationControlPlane,
  fetchReconciliationScorecard,
  fetchReconciliationHistory,
  fetchHistoricalReconciliationSnapshot,
} from "@/lib/reconciliation";
import { fetchSeals } from "@/lib/seals";

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function lastUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  return String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
}

describe("reconciliation fetch wrappers", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetchLiveReconciliation hits /reconciliation/live with default validator limit", async () => {
    fetchMock.mockResolvedValue(
      ok({ epoch: 1, network: "t", mode: "m", captured_at: "x" }),
    );
    const doc = await fetchLiveReconciliation();
    expect(lastUrl(fetchMock)).toContain(
      "/reconciliation/live?validator_limit=200",
    );
    expect(doc.epoch).toBe(1);
  });

  it("fetchLiveReconciliation passes a custom validator limit", async () => {
    fetchMock.mockResolvedValue(ok({ epoch: 2 }));
    await fetchLiveReconciliation(50);
    expect(lastUrl(fetchMock)).toContain("validator_limit=50");
  });

  it("fetchReconciliationControlPlane hits the control-plane path", async () => {
    fetchMock.mockResolvedValue(ok({ epoch: 1 }));
    await fetchReconciliationControlPlane();
    expect(lastUrl(fetchMock)).toContain("/reconciliation/control-plane");
  });

  it("fetchReconciliationScorecard hits the scorecard path", async () => {
    fetchMock.mockResolvedValue(ok({ status: "OK" }));
    const card = await fetchReconciliationScorecard();
    expect(lastUrl(fetchMock)).toContain("/reconciliation/scorecard");
    expect(card.status).toBe("OK");
  });

  it("fetchReconciliationHistory hits the history path with default limit", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await fetchReconciliationHistory();
    expect(lastUrl(fetchMock)).toContain("/reconciliation/history?limit=10");
  });

  it("fetchReconciliationHistory passes a custom limit", async () => {
    fetchMock.mockResolvedValue(ok([]));
    await fetchReconciliationHistory(25);
    expect(lastUrl(fetchMock)).toContain("limit=25");
  });

  it("fetchHistoricalReconciliationSnapshot hits the epoch path", async () => {
    fetchMock.mockResolvedValue(ok({ snapshot_id: "s1" }));
    await fetchHistoricalReconciliationSnapshot(42);
    expect(lastUrl(fetchMock)).toContain("/reconciliation/42");
  });

  it("propagates an ApiHttpError on a non-ok response", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: "gone" }), { status: 404 }),
    );
    await expect(fetchReconciliationScorecard()).rejects.toMatchObject({
      name: "ApiHttpError",
      statusCode: 404,
    });
  });
});

describe("seals fetchSeals", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses default limit/offset/sort", async () => {
    fetchMock.mockResolvedValue(ok({ seals: [], total: 0 }));
    await fetchSeals();
    const url = lastUrl(fetchMock);
    expect(url).toContain("limit=24");
    expect(url).toContain("offset=0");
    expect(url).toContain("sort=created_at%3Adesc");
  });

  it("passes status/requester/jobId filters when set", async () => {
    fetchMock.mockResolvedValue(ok({ seals: [], total: 0 }));
    await fetchSeals({ status: "active", requester: "aeth1r", jobId: "job-9" });
    const url = lastUrl(fetchMock);
    expect(url).toContain("status=active");
    expect(url).toContain("requester=aeth1r");
    expect(url).toContain("job");
  });

  it("normalizes returned seals and preserves total", async () => {
    fetchMock.mockResolvedValue(
      ok({
        seals: [
          {
            id: "seal-1",
            status: "SEAL_STATUS_ACTIVE",
            validators: ["a", "b"],
            created_at: "2026-07-01T00:00:00Z",
          },
        ],
        total: 1,
      }),
    );
    const res = await fetchSeals();
    expect(res.total).toBe(1);
    expect(res.seals[0].id).toBe("seal-1");
    expect(res.seals[0].status).toBe("active");
  });

  it("drops malformed seal entries lacking an id", async () => {
    fetchMock.mockResolvedValue(
      ok({
        seals: [{ status: "active" }, { id: "seal-2", status: "active" }],
        total: 2,
      }),
    );
    const res = await fetchSeals();
    expect(res.seals.map((s) => s.id)).toEqual(["seal-2"]);
  });

  it("handles a missing seals array gracefully", async () => {
    fetchMock.mockResolvedValue(ok({ total: 0 }));
    const res = await fetchSeals();
    expect(res.seals).toEqual([]);
  });
});
