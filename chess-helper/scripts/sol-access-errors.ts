import OpenAI from "openai";

const codes = new Set([
  "insufficient_quota", "credit_balance_exhausted", "rate_limit_exceeded", "slow_down",
  "organization_spend_limit_exceeded", "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded", "usage_limit_exceeded",
  "server_is_overloaded", "model_not_found", "invalid_api_key",
]);
const types = new Set([
  "insufficient_quota", "rate_limit_error", "invalid_request_error",
  "server_error", "service_unavailable_error", "authentication_error", "permission_error",
]);

// API messages, request bodies, IDs and arbitrary headers can contain private data.
export function solAccessFailure(error: unknown) {
  if (!(error instanceof OpenAI.APIError))
    return { httpStatus: null, code: null, type: null, retryAfterSeconds: null };
  const delay = error.headers?.get("retry-after");
  return {
    httpStatus: error.status ?? null,
    code: typeof error.code === "string" && codes.has(error.code) ? error.code : null,
    type: typeof error.type === "string" && types.has(error.type) ? error.type : null,
    retryAfterSeconds: delay && /^\d+(?:\.\d+)?$/.test(delay) && Number.isFinite(Number(delay))
      ? Number(delay) : null,
  };
}
