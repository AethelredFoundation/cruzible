import { createHmac } from "node:crypto";
import { config } from "../config";

export function hashPrivacyValue(value: string): string {
  return createHmac("sha256", config.logHashSecret).update(value).digest("hex");
}
