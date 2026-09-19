import assert from "node:assert/strict";
import test from "node:test";
import {
  createInitialBoard,
  createPieceSequence,
  enumerateCandidates,
} from "../app/engine.ts";

test("piece sequence is deterministic and uses seven-bag pieces", () => {
  const first = createPieceSequence(42, 21);
  const second = createPieceSequence(42, 21);
  assert.deepEqual(first, second);
  assert.deepEqual(new Set(first.slice(0, 7)), new Set(["I", "O", "T", "S", "Z", "J", "L"]));
});

test("candidate generation includes rotations and returns validated boards", () => {
  const candidates = enumerateCandidates(createInitialBoard(), "T");
  assert.ok(candidates.length > 1 && candidates.length <= 12);
  assert.ok(new Set(candidates.map((candidate) => candidate.rotation)).size > 1);
  for (const candidate of candidates) {
    assert.equal(candidate.boardRows.length, 20);
    assert.ok(candidate.boardRows.every((row) => /^[.#]{10}$/.test(row)));
    assert.ok(candidate.metrics.holesAdded >= 0);
  }
});
