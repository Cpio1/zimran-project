import { http, passthrough } from "msw";
import { API_BASE_URL } from "@/api/config";
import { configureMock, handleMockRequest } from "./core";

configureMock({ baseUrl: API_BASE_URL });

/** One catch-all handler: routing lives in core.ts so tests and browser share it. */
export const handlers = [
  http.all(`${API_BASE_URL}/*`, async ({ request }) => (await handleMockRequest(request)) ?? passthrough()),
];
