import assert from "node:assert/strict";
import test from "node:test";
import { comparePortablePaths, createServiceWorkerCacheName } from "./service-worker-cache.mjs";

const bytes = Buffer.from("same contents");

test("renaming an unchanged shell file changes the cache identity", () => {
  const before = createServiceWorkerCacheName([{ path: "./old-name.svg", contents: bytes }]);
  const after = createServiceWorkerCacheName([{ path: "./new-name.svg", contents: bytes }]);
  assert.notEqual(before, after);
});

test("adding an empty shell file changes the cache identity", () => {
  const before = createServiceWorkerCacheName([{ path: "./index.html", contents: bytes }]);
  const after = createServiceWorkerCacheName([
    { path: "./index.html", contents: bytes },
    { path: "./empty.txt", contents: Buffer.alloc(0) },
  ]);
  assert.notEqual(before, after);
});

test("directory enumeration order does not change the cache identity", () => {
  const records = [
    { path: "./index.html", contents: bytes },
    { path: "./assets/app.js", contents: Buffer.from("app") },
  ];
  assert.equal(createServiceWorkerCacheName(records), createServiceWorkerCacheName([...records].reverse()));
});

test("portable paths use locale-independent code-point order", () => {
  const paths = ["./assets/app.js", "./assets/ReportsPage.js", "./assets/Dashboard.js"];
  assert.deepEqual(paths.sort(comparePortablePaths), [
    "./assets/Dashboard.js",
    "./assets/ReportsPage.js",
    "./assets/app.js",
  ]);
});
