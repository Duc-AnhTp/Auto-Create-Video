import { z } from "zod";

/** Identifiers are identities, never paths. Do not silently sanitize persisted IDs. */
export const AssetId = z.string().min(1).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Unsafe asset identifier")
  .refine(value => !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value), "Reserved asset identifier");
