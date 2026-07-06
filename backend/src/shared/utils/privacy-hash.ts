import crypto from "node:crypto";
import { env } from "../config/env.js";

export const privacyHash = (value?: string | null) => {
  if (!value) return undefined;
  const salt = env.JWT_SECRET.slice(0, 32);
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex");
};
