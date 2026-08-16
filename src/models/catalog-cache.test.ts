import assert from "node:assert/strict";
import test from "node:test";
import { CatalogCache } from "./catalog-cache";

test("reuses a fresh catalog without refreshing", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = new CatalogCache<string[]>(() => now);

  assert.deepEqual(await cache.getOrRefresh(100, async () => { loads++; return ["first"]; }), ["first"]);
  now += 50;
  assert.deepEqual(await cache.getOrRefresh(100, async () => { loads++; return ["second"]; }), ["first"]);
  assert.equal(loads, 1);
});

test("refreshes expired entries and preserves the last usable catalog on failure", async () => {
  let now = 1_000;
  const cache = new CatalogCache<string[]>(() => now);
  await cache.getOrRefresh(100, async () => ["first"]);
  now += 100;

  assert.deepEqual(await cache.getOrRefresh(100, async () => { throw new Error("offline"); }), ["first"]);
});

test("does not turn cancellation into a successful cached response", async () => {
  let now = 1_000;
  const cache = new CatalogCache<string[]>(() => now);
  await cache.getOrRefresh(100, async () => ["first"]);
  now += 100;
  const cancellation = new Error("cancelled");

  await assert.rejects(
    cache.getOrRefresh(100, async () => { throw cancellation; }, (error) => error === cancellation),
    cancellation,
  );
});

test("does not hide the first refresh failure", async () => {
  const cache = new CatalogCache<string[]>();
  const failure = new Error("unavailable");

  await assert.rejects(cache.getOrRefresh(100, async () => { throw failure; }), failure);
});

test("clearing the cache forces the next refresh", async () => {
  let loads = 0;
  const cache = new CatalogCache<string[]>();
  await cache.getOrRefresh(100_000, async () => { loads++; return ["first"]; });
  cache.clear();
  await cache.getOrRefresh(100_000, async () => { loads++; return ["second"]; });

  assert.equal(loads, 2);
});
