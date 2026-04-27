import type { NextApiRequest, NextApiResponse } from "next";

type HealthResponse = {
  service: "cruzible-frontend";
  status: "ok";
  timestamp: string;
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<HealthResponse | { error: string }>,
): void {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  if (req.method === "HEAD") {
    res.status(200).end();
    return;
  }

  res.status(200).json({
    service: "cruzible-frontend",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
}
