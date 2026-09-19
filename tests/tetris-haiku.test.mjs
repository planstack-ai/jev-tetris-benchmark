import assert from "node:assert/strict";
import test from "node:test";
import { handleTetrisHaikuRequest } from "../lib/tetris-haiku.mjs";

const emptyBoard = Array.from({ length: 20 }, (_, index) =>
  index === 19 ? "####..####" : "..........",
);

const payload = {
  currentPiece: "I",
  nextPieces: ["T", "O", "L"],
  candidates: [
    {
      id: 0,
      board: emptyBoard,
      clearedLines: 0,
      topOut: false,
      rotation: 0,
      x: 0,
      metrics: { holes: 0, holesAdded: 0, coveredHoles: 0, aggregateHeight: 8, maxHeight: 1, bumpiness: 2, wells: 1 },
    },
    {
      id: 1,
      board: [...emptyBoard.slice(0, 19), ".........."],
      clearedLines: 1,
      topOut: false,
      rotation: 1,
      x: 4,
      metrics: { holes: 0, holesAdded: 0, coveredHoles: 0, aggregateHeight: 0, maxHeight: 0, bumpiness: 0, wells: 0 },
    },
  ],
};

function apiRequest(body = payload, headers = {}) {
  return new Request("http://localhost:3000/api/tetris-haiku", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
      "X-Tetris-Haiku": "1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function anthropicResponse(choice, overrides = {}) {
  return Response.json({
    id: "msg_test",
    model: "claude-haiku-4-5-20251001",
    stop_reason: "tool_use",
    content: [{ type: "tool_use", name: "select_tetris_candidate", input: { choice } }],
    usage: { input_tokens: 700, output_tokens: 12 },
    ...overrides,
  });
}

test("Haiku status reports whether API access is configured", async () => {
  const request = new Request("http://localhost:3000/api/tetris-haiku");
  assert.deepEqual(await (await handleTetrisHaikuRequest(request, {})).json(), {
    enabled: false,
    model: "claude-haiku-4-5-20251001",
  });
  assert.deepEqual(await (await handleTetrisHaikuRequest(request, {
    ANTHROPIC_API_KEY: "secret",
    TETRIS_HAIKU_ENABLED: "true",
  })).json(), {
    enabled: true,
    model: "claude-haiku-4-5-20251001",
  });
});

test("Haiku endpoint sends validated candidates and returns measured usage", async () => {
  let requestBody;
  const response = await handleTetrisHaikuRequest(apiRequest(), {
    ANTHROPIC_API_KEY: "server-secret",
    TETRIS_HAIKU_ENABLED: "true",
  }, {
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.anthropic.com/v1/messages");
      assert.equal(init.headers["x-api-key"], "server-secret");
      assert.equal(init.headers["anthropic-version"], "2023-06-01");
      requestBody = JSON.parse(init.body);
      return anthropicResponse(1);
    },
  });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.choice, 1);
  assert.equal(data.model, "claude-haiku-4-5-20251001");
  assert.deepEqual(data.usage, { inputTokens: 700, outputTokens: 12 });
  assert.equal(data.costUsd, 0.00076);
  assert.equal(requestBody.model, "claude-haiku-4-5-20251001");
  assert.equal(requestBody.messages[0].content.includes("####..####"), true);
  assert.equal(requestBody.messages[0].content.includes('"holesAdded":0'), true);
  assert.match(requestBody.system, /never create a new hole/i);
  assert.equal(requestBody.tool_choice.name, "select_tetris_candidate");
  assert.equal(JSON.stringify(data).includes("server-secret"), false);
});

test("Haiku endpoint rejects unsafe or malformed requests", async () => {
  const crossOrigin = apiRequest(payload, { Origin: "https://evil.example" });
  assert.equal((await handleTetrisHaikuRequest(crossOrigin, { ANTHROPIC_API_KEY: "x", TETRIS_HAIKU_ENABLED: "true" })).status, 403);

  const disabled = await handleTetrisHaikuRequest(apiRequest(), { ANTHROPIC_API_KEY: "x" });
  assert.equal(disabled.status, 503);
  assert.match((await disabled.json()).error, /無効/);

  const malformedBoard = await handleTetrisHaikuRequest(apiRequest({
    ...payload,
    candidates: [{ ...payload.candidates[0], board: [".........."] }],
  }), { ANTHROPIC_API_KEY: "x", TETRIS_HAIKU_ENABLED: "true" });
  assert.equal(malformedBoard.status, 400);
});

test("Haiku endpoint rejects a model choice outside the supplied candidates", async () => {
  const response = await handleTetrisHaikuRequest(apiRequest(), {
    ANTHROPIC_API_KEY: "x",
    TETRIS_HAIKU_ENABLED: "true",
  }, { fetcher: async () => anthropicResponse(9) });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /候補外/);
});
