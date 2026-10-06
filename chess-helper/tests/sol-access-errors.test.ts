import { expect, it } from "vitest";
import OpenAI from "openai";
import { solAccessFailure } from "../scripts/sol-access-errors";

it("reports quota evidence and a numeric retry delay without private error data", () => {
  const error = new OpenAI.APIError(429, {
    code: "credit_balance_exhausted", type: "insufficient_quota",
    message: "private account detail", param: "private request parameter",
  }, "private message", new Headers({
    "retry-after": "3.5", "x-request-id": "private request ID", "authorization": "private credential",
  }));
  expect(solAccessFailure(error)).toEqual({
    httpStatus: 429, code: "credit_balance_exhausted", type: "insufficient_quota", retryAfterSeconds: 3.5,
  });
});

it("does not expose unknown codes, types, header text or non-API errors", () => {
  const error = new OpenAI.APIError(429, {
    code: "private code", type: "private type", message: "private message",
  }, undefined, new Headers({ "retry-after": "private header" }));
  expect(solAccessFailure(error)).toEqual({ httpStatus: 429, code: null, type: null, retryAfterSeconds: null });
  expect(solAccessFailure(new Error("private failure"))).toEqual({ httpStatus: null, code: null, type: null, retryAfterSeconds: null });
});
