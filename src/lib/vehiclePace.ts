/** Display only: a partial vehicle requires one more whole delivery. */
export function roundUpVehiclePace(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Math.ceil(value);
}

export function formatVehiclePace(value: number | null): string {
  const wholeVehicles = roundUpVehiclePace(value);
  return wholeVehicles === null ? "—" : wholeVehicles.toLocaleString("en-US");
}
