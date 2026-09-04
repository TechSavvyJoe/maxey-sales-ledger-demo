import { deleteApp, initializeApp } from "firebase/app";
import { connectFirestoreEmulator, doc, getDocFromCache, initializeFirestore, memoryLocalCache, terminate } from "firebase/firestore";
import { expect, it } from "vitest";

it("the installed Firebase SDK recreates an isolated memory cache after terminate on the same app", async () => {
  const app = initializeApp({ projectId: "demo-sales-ledger-lifecycle" }, "sales-ledger-test-cache-lifecycle");
  try {
    const first = initializeFirestore(app, { localCache: memoryLocalCache() });
    connectFirestoreEmulator(first, "127.0.0.1", 8080);
    await terminate(first);
    const second = initializeFirestore(app, { localCache: memoryLocalCache() });
    connectFirestoreEmulator(second, "127.0.0.1", 8080);
    expect(second).not.toBe(first);
    // A fresh cache has no document. This does not connect to an emulator or live service.
    await expect(getDocFromCache(doc(second, "probe/isolated"))).rejects.toMatchObject({ code: "unavailable" });
    await terminate(second);
  } finally {
    await deleteApp(app);
  }
});
