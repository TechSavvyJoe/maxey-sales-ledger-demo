import { describe, expect, it } from "vitest";
import { formatVehiclePace, roundUpVehiclePace } from "@/lib/vehiclePace";

describe("whole-vehicle pace display", () => {
  it.each([
    [0, 0, "0"],
    [0.3, 1, "1"],
    [1.6, 2, "2"],
    [17.3, 18, "18"],
    [2, 2, "2"],
    [null, null, "—"],
  ] as const)("displays %s as %s whole vehicles", (value, rounded, label) => {
    expect(roundUpVehiclePace(value)).toBe(rounded);
    expect(formatVehiclePace(value)).toBe(label);
  });
});
