import { vi } from "vitest";
import "./utils/media-runtime.js";
import nock from "nock";

// Unit/integration tests must never inherit paid credentials or dotenv files.
for (const key of Object.keys(process.env)) {
  if (/(API_KEY|ACCESS_TOKEN|SECRET|ENDPOINT|BASE_URL)$/.test(key)) delete process.env[key];
}
vi.mock("dotenv/config", () => ({}));
vi.mock("dotenv", async (original) => ({
  ...await original<typeof import("dotenv")>(),
  config: () => ({ parsed: {} }),
}));
nock.disableNetConnect();
nock.enableNetConnect(/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/);
