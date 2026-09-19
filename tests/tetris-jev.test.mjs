import assert from "node:assert/strict";
import test from "node:test";
import { handleTetrisJevRequest } from "../lib/tetris-jev.mjs";

const emptyBoard = Array.from({ length: 20 }, (_, index) =>
  index === 19 ? "####..####" : "..........",
);

const payload = {
  currentPiece: "I",
  clearedTotal: 3,
  nextPieces: ["T", "O", "L"],
  candidates: [
    {
      id: 0,
      board: emptyBoard,
      clearedLines: 0,
      rotation: 0,
      x: 0,
      metrics: { holes: 0, holesAdded: 0, coveredHoles: 0, aggregateHeight: 8, maxHeight: 1, bumpiness: 2, wells: 1 },
    },
    {
      id: 1,
      board: [...emptyBoard.slice(0, 19), ".........."],
      clearedLines: 1,
      rotation: 1,
      x: 4,
      metrics: { holes: 0, holesAdded: 0, coveredHoles: 0, aggregateHeight: 0, maxHeight: 0, bumpiness: 0, wells: 0 },
    },
  ],
};

function apiRequest(body = payload, headers = {}) {
  return new Request("http://localhost:3000/api/tetris-jev", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": "http://localhost:3000",
      "Sec-Fetch-Site": "same-origin",
      "X-Tetris-Jev": "1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function typesafeResponse(choice = "candidate_1", overrides = {}) {
  return Response.json({
    model: "jev-1.13.0",
    answers: {
      placement: {
        type: "choice",
        choice,
        confidence: 0.74,
        probabilities: { candidate_0: 0.18, candidate_1: 0.82 },
      },
    },
    usage: { input_tokens: 600, output_tokens: 24 },
    ...overrides,
  });
}

test("Jev status reports whether direct API access is configured", async () => {
  const request = new Request("http://localhost:3000/api/tetris-jev");
  assert.deepEqual(await (await handleTetrisJevRequest(request, {})).json(), {
    enabled: false,
    model: "jev-latest",
    provider: "typesafe-direct",
  });
  assert.deepEqual(await (await handleTetrisJevRequest(request, {
    TYPESAFE_API_KEY: "secret",
    TETRIS_JEV_ENABLED: "true",
    TETRIS_JEV_MODEL: "jev-1.13.0",
  })).json(), { enabled: true, model: "jev-1.13.0", provider: "typesafe-direct" });
  assert.deepEqual(await (await handleTetrisJevRequest(request, {
    AI_GATEWAY_API_KEY: "gateway-secret",
    TETRIS_JEV_ENABLED: "true",
  })).json(), { enabled: true, model: "typesafe-ai/jev", provider: "vercel-ai-gateway" });
});

test("Jev endpoint uses Vercel AI Gateway evaluation when configured", async () => {
  let evaluation;
  const response = await handleTetrisJevRequest(apiRequest(), {
    AI_GATEWAY_API_KEY: "gateway-secret",
    TETRIS_JEV_ENABLED: "true",
  }, {
    evaluator: async (input) => {
      evaluation = input;
      return {
        answers: {
          placement: {
            type: "choice",
            choice: "candidate_1",
            probabilities: { candidate_0: 0.08, candidate_1: 0.92 },
          },
        },
        usage: { inputTokens: 500, outputTokens: 20, totalTokens: 520 },
        providerMetadata: { typesafe: { confidence: { placement: 0.84 } } },
        response: { modelId: "typesafe-ai/jev" },
      };
    },
  });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.choice, 1);
  assert.equal(data.model, "typesafe-ai/jev");
  assert.equal(data.confidence, 0.84);
  assert.equal(data.costUsd, 0.00002);
  assert.equal(evaluation.questions.placement.type, "choice");
  assert.equal(evaluation.providerOptions.gateway.zeroDataRetention, true);
});

test("Jev endpoint unwraps AI SDK retry errors and preserves rate limits", async () => {
  const response = await handleTetrisJevRequest(apiRequest(), {
    AI_GATEWAY_API_KEY: "gateway-secret",
    TETRIS_JEV_ENABLED: "true",
  }, {
    evaluator: async () => {
      throw {
        name: "AI_RetryError",
        lastError: {
          name: "GatewayRateLimitError",
          statusCode: 429,
          type: "rate_limit_exceeded",
        },
      };
    },
  });

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "15");
  assert.match((await response.json()).error, /レート制限/);
});

test("Jev endpoint sends one Choice question and returns probabilities", async () => {
  let requestBody;
  const response = await handleTetrisJevRequest(apiRequest(), {
    TYPESAFE_API_KEY: "server-secret",
    TETRIS_JEV_ENABLED: "true",
  }, {
    fetcher: async (url, init) => {
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal(init.headers.Authorization, "Bearer server-secret");
      requestBody = JSON.parse(init.body);
      return typesafeResponse();
    },
  });

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.choice, 1);
  assert.equal(data.model, "jev-1.13.0");
  assert.equal(data.confidence, 0.74);
  assert.deepEqual(data.probabilities, { 0: 0.18, 1: 0.82 });
  assert.deepEqual(data.usage, { inputTokens: 600, outputTokens: 24 });
  assert.equal(data.costUsd, 0.0000252);
  assert.equal(requestBody.model, "jev-latest");
  assert.equal(requestBody.questions.placement.type, "choice");
  assert.equal(requestBody.state.clearedTotal, 3);
  assert.equal(requestBody.state.candidates[1].metrics.bumpiness, 0);
  assert.match(requestBody.questions.placement.instructions.priority[0], /holesAdded/);
  assert.deepEqual(Object.keys(requestBody.questions.placement.criteria), ["candidate_0", "candidate_1"]);
  assert.equal(JSON.stringify(data).includes("server-secret"), false);
});

test("Jev endpoint rejects malformed and out-of-list answers", async () => {
  const malformed = await handleTetrisJevRequest(apiRequest({ ...payload, clearedTotal: -1 }), {
    TYPESAFE_API_KEY: "x",
    TETRIS_JEV_ENABLED: "true",
  });
  assert.equal(malformed.status, 400);

  const invalidChoice = await handleTetrisJevRequest(apiRequest(), {
    TYPESAFE_API_KEY: "x",
    TETRIS_JEV_ENABLED: "true",
  }, { fetcher: async () => typesafeResponse("candidate_9") });
  assert.equal(invalidChoice.status, 502);
  assert.match((await invalidChoice.json()).error, /候補外/);
});
