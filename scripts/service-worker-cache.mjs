import { createHash } from "node:crypto";

export function comparePortablePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function createServiceWorkerCacheName(records) {
  const digest = createHash("sha256");
  const ordered = records
    .map((record) => ({
      path: String(record.path).replaceAll("\\", "/"),
      contents: Buffer.isBuffer(record.contents) ? record.contents : Buffer.from(record.contents),
    }))
    .sort((left, right) => comparePortablePaths(left.path, right.path));
  for (const record of ordered) {
    digest.update(record.path);
    digest.update("\0");
    digest.update(String(record.contents.byteLength));
    digest.update("\0");
    digest.update(record.contents);
  }
  return `sales-ledger-${digest.digest("hex").slice(0, 12)}`;
}
