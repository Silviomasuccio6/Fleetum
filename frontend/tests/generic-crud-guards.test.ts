import assert from "node:assert/strict";
import test from "node:test";
import {
  createCrudListQueryCursor,
  createLatestRequestGuard,
  createSubmissionGuard
} from "../src/presentation/pages/shared/generic-crud-guards.js";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

test("only the latest CRUD list response can update rows, totals, errors, and loading", async () => {
  const guard = createLatestRequestGuard();
  const first = deferred<{ rows: string[]; total: number }>();
  const second = deferred<{ rows: string[]; total: number }>();
  const state = { rows: [] as string[], total: 0, loading: false, error: null as string | null };

  const run = async (request: Promise<{ rows: string[]; total: number }>) => {
    const requestId = guard.begin();
    state.loading = true;
    state.error = null;
    try {
      const result = await request;
      if (!guard.isCurrent(requestId)) return;
      state.rows = result.rows;
      state.total = result.total;
    } catch (error) {
      if (guard.isCurrent(requestId)) state.error = (error as Error).message;
    } finally {
      if (guard.isCurrent(requestId)) state.loading = false;
    }
  };

  const firstRun = run(first.promise);
  const secondRun = run(second.promise);
  second.resolve({ rows: ["risultato-b"], total: 1 });
  await secondRun;
  first.resolve({ rows: ["risultato-a-obsoleto"], total: 99 });
  await firstRun;

  assert.deepEqual(state, { rows: ["risultato-b"], total: 1, loading: false, error: null });
});

test("the synchronous submission guard collapses a rapid double submit and unlocks after failure", async () => {
  const guard = createSubmissionGuard();
  let calls = 0;
  const pending = deferred<void>();

  const submit = async (task: () => Promise<void>) => {
    if (!guard.tryAcquire()) return false;
    calls += 1;
    try {
      await task();
      return true;
    } finally {
      guard.release();
    }
  };

  const first = submit(() => pending.promise);
  const duplicate = await submit(async () => undefined);
  assert.equal(duplicate, false);
  assert.equal(calls, 1);

  pending.resolve();
  assert.equal(await first, true);

  await assert.rejects(submit(async () => {
    throw new Error("errore sintetico");
  }), /errore sintetico/);
  assert.equal(await submit(async () => undefined), true);
  assert.equal(calls, 3);
});

test("a delayed mutation reloads the current page and search instead of its stale closure", async () => {
  const cursor = createCrudListQueryCursor({ page: 1, search: "A" });
  const mutation = deferred<void>();
  const reloads: Array<{ page: number; search: string }> = [];

  const delayedMutation = (async () => {
    await mutation.promise;
    reloads.push(cursor.read());
  })();

  cursor.update({ page: 2, search: "B" });
  mutation.resolve();
  await delayedMutation;

  assert.deepEqual(reloads, [{ page: 2, search: "B" }]);
});
