/* Fixture: the test file that made everyone believe this was tested. */

import { describe, it, expect } from "vitest";
import { answer } from "./supportAgent";

describe("answer", () => {
  it("returns something", async () => {
    const res = await answer("is water damage covered?", {}, {});
    expect(res).toBeDefined();
  });

  it("is not empty", async () => {
    const res = await answer("hello", {}, {});
    expect(res.length).toBeGreaterThan(0);
  });

  it("is truthy", async () => {
    const res = await answer("hello", {}, {});
    expect(res).toBeTruthy();
  });
});
