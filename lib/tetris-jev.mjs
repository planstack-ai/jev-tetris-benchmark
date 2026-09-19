import { createGateway } from "@ai-sdk/gateway";
import { experimental_evaluate as evaluate } from "ai";

const MODEL = "jev-latest";
const INPUT_USD_PER_TOKEN = 0.042 / 1_000_000;
const GATEWAY_MODEL = "typesafe-ai/jev";
const GATEWAY_INPUT_USD_PER_TOKEN = 0.04 / 1_000_000;

const securityHeaders = {
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", ...extra },
});

class TetrisJevError extends Error {
  constructor(message, status = 400, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

function gatewayErrorDetails(error) {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if (Number.isInteger(current.statusCode)) {
      return {
        name: typeof current.name === "string" ? current.name : "Error",
        statusCode: current.statusCode,
        type: typeof current.type === "string" ? current.type : undefined,
      };
    }
    current = current.lastError || current.cause;
  }
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    statusCode: undefined,
    type: undefined,
  };
}

function retryAfterSeconds(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

function requireSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (
    origin !== new URL(request.url).origin ||
    request.headers.get("X-Tetris-Jev") !== "1" ||
    request.headers.get("Sec-Fetch-Site") === "cross-site"
  ) {
    throw new TetrisJevError("このページからのリクエストを確認できません。再読み込みしてください。", 403);
  }
}

async function readJson(request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new TetrisJevError("JSON形式で送信してください。", 415);
  }
  if (Number(request.headers.get("Content-Length")) > 48_000) {
    throw new TetrisJevError("候補データが大きすぎます。", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 48_000) {
    throw new TetrisJevError("候補データが大きすぎます。", 413);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TetrisJevError("候補データを読み取れませんでした。");
  }
}

function validateBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TetrisJevError("候補データが正しくありません。");
  }
  if (!["I", "O", "T", "S", "Z", "J", "L"].includes(body.currentPiece)) {
    throw new TetrisJevError("現在のブロックを確認できません。");
  }
  if (!Number.isSafeInteger(body.clearedTotal) || body.clearedTotal < 0 || body.clearedTotal > 20) {
    throw new TetrisJevError("現在の消去ライン数を確認できません。");
  }
  if (!Array.isArray(body.candidates) || body.candidates.length < 1 || body.candidates.length > 12) {
    throw new TetrisJevError("候補は1〜12件で送信してください。");
  }

  const ids = new Set();
  const candidates = body.candidates.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new TetrisJevError("配置候補を確認できません。");
    }
    if (!Number.isSafeInteger(candidate.id) || candidate.id < 0 || candidate.id > 11 || ids.has(candidate.id)) {
      throw new TetrisJevError("候補IDを確認できません。");
    }
    ids.add(candidate.id);
    if (
      !Array.isArray(candidate.board) ||
      candidate.board.length !== 20 ||
      candidate.board.some((row) => typeof row !== "string" || !/^[.#]{10}$/.test(row))
    ) {
      throw new TetrisJevError("候補盤面は10列×20行で送信してください。");
    }
    if (!Number.isSafeInteger(candidate.clearedLines) || candidate.clearedLines < 0 || candidate.clearedLines > 4) {
      throw new TetrisJevError("消去ライン数を確認できません。");
    }
    if (!Number.isSafeInteger(candidate.rotation) || candidate.rotation < 0 || candidate.rotation > 3) {
      throw new TetrisJevError("回転情報を確認できません。");
    }
    if (!Number.isSafeInteger(candidate.x) || candidate.x < 0 || candidate.x > 9) {
      throw new TetrisJevError("横位置を確認できません。");
    }
    const metrics = candidate.metrics;
    const metricLimits = {
      holes: 200,
      holesAdded: 200,
      coveredHoles: 2_000,
      aggregateHeight: 200,
      maxHeight: 20,
      bumpiness: 200,
      wells: 2_000,
    };
    if (
      !metrics ||
      typeof metrics !== "object" ||
      Array.isArray(metrics) ||
      Object.entries(metricLimits).some(([key, limit]) =>
        !Number.isSafeInteger(metrics[key]) || metrics[key] < 0 || metrics[key] > limit)
    ) {
      throw new TetrisJevError("盤面評価値を確認できません。");
    }
    return {
      id: candidate.id,
      board: candidate.board,
      clearedLines: candidate.clearedLines,
      rotation: candidate.rotation,
      x: candidate.x,
      metrics: Object.fromEntries(Object.keys(metricLimits).map((key) => [key, metrics[key]])),
    };
  });

  const nextPieces = body.nextPieces === undefined ? [] : body.nextPieces;
  if (
    !Array.isArray(nextPieces) ||
    nextPieces.length > 3 ||
    nextPieces.some((piece) => !["I", "O", "T", "S", "Z", "J", "L"].includes(piece))
  ) {
    throw new TetrisJevError("先読みブロックを確認できません。");
  }

  return { currentPiece: body.currentPiece, clearedTotal: body.clearedTotal, nextPieces, candidates };
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get("Retry-After"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter * 1000, 2_000);
  return 250 * (2 ** attempt);
}

async function callTypeSafe(payload, env, fetcher) {
  const model = env.TETRIS_JEV_MODEL || MODEL;
  const criteria = Object.fromEntries(payload.candidates.map((candidate) => [
    `candidate_${candidate.id}`,
    {
      action: `Use placement candidate ${candidate.id}, fully described at state.candidates[${candidate.id}].`,
      outcome: {
        clearedLines: candidate.clearedLines,
        ...candidate.metrics,
      },
    },
  ]));
  const requestBody = {
    model,
    state: {
      game: "10-column by 20-row Tetris. Filling all 10 cells of a row clears it. If the next piece cannot enter at the top, the game is over.",
      target: "Survive and reach 20 total cleared lines.",
      coordinates: "board[0] is the top row and board[19] is the bottom row. A dot is empty and # is occupied.",
      clearedTotal: payload.clearedTotal,
      currentPiece: payload.currentPiece,
      nextPieces: payload.nextPieces,
      candidates: payload.candidates,
    },
    questions: {
      placement: {
        type: "choice",
        instructions: {
          question: "Which placement candidate is most likely to survive and reach 20 total cleared lines?",
          priority: [
            "First minimize metrics.holesAdded. Never create a new hole when any candidate has holesAdded 0.",
            "Among candidates with the same holesAdded, maximize clearedLines.",
            "Then minimize metrics.holes and metrics.coveredHoles.",
            "Then make the surface flat and low: minimize metrics.bumpiness, then metrics.maxHeight and metrics.aggregateHeight.",
            "Do not trade a new hole for a flatter surface or a line clear.",
          ],
        },
        criteria,
      },
    },
  };

  const startedAt = Date.now();
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetcher("https://api.typesafe.ai/v1/systemone", {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
        headers: {
          Authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });
    } catch (error) {
      if (error?.name === "TimeoutError" || error?.name === "AbortError") {
        throw new TetrisJevError("Jev APIがタイムアウトしました。", 504);
      }
      throw new TetrisJevError("Jev APIへ接続できませんでした。", 502);
    }
    if (![429, 529].includes(response.status) || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
  }

  if (!response?.ok) {
    if (response?.status === 401 || response?.status === 403) {
      throw new TetrisJevError("TypeSafe APIキーの設定を確認してください。", 503);
    }
    if (response?.status === 429) {
      throw new TetrisJevError("Jev APIのレート制限に達しました。", 429);
    }
    if (response?.status === 529) {
      throw new TetrisJevError("Jev APIが混雑しています。", 503);
    }
    throw new TetrisJevError("Jev APIの処理に失敗しました。", 502);
  }

  const data = await response.json();
  const answer = data?.answers?.placement;
  const match = /^candidate_(\d{1,2})$/.exec(answer?.choice || "");
  const choice = match ? Number(match[1]) : -1;
  const validIds = new Set(payload.candidates.map((candidate) => candidate.id));
  if (answer?.type !== "choice" || !validIds.has(choice)) {
    throw new TetrisJevError("Jevが候補外の手を返しました。", 502);
  }
  if (typeof answer.confidence !== "number" || answer.confidence < 0 || answer.confidence > 1) {
    throw new TetrisJevError("Jevのconfidenceを確認できませんでした。", 502);
  }
  const probabilities = {};
  for (const candidate of payload.candidates) {
    const value = answer.probabilities?.[`candidate_${candidate.id}`];
    if (typeof value !== "number" || value < 0 || value > 1) {
      throw new TetrisJevError("Jevの候補確率を確認できませんでした。", 502);
    }
    probabilities[candidate.id] = value;
  }
  const inputTokens = Number.isSafeInteger(data?.usage?.input_tokens) ? data.usage.input_tokens : 0;
  const outputTokens = Number.isSafeInteger(data?.usage?.output_tokens) ? data.usage.output_tokens : 0;
  return {
    choice,
    model: data?.model || model,
    latencyMs: Math.max(0, Date.now() - startedAt),
    confidence: answer.confidence,
    probabilities,
    usage: { inputTokens, outputTokens },
    costUsd: Number((inputTokens * INPUT_USD_PER_TOKEN).toFixed(12)),
  };
}

async function callVercelGateway(payload, env, options = {}) {
  const criteria = Object.fromEntries(payload.candidates.map((candidate) => [
    `candidate_${candidate.id}`,
    {
      action: `Use placement candidate ${candidate.id}, fully described at state.candidates[${candidate.id}].`,
      outcome: {
        clearedLines: candidate.clearedLines,
        ...candidate.metrics,
      },
    },
  ]));
  const state = {
    game: "10-column by 20-row Tetris. Filling all 10 cells of a row clears it. If the next piece cannot enter at the top, the game is over.",
    target: "Survive and reach 20 total cleared lines.",
    coordinates: "board[0] is the top row and board[19] is the bottom row. A dot is empty and # is occupied.",
    clearedTotal: payload.clearedTotal,
    currentPiece: payload.currentPiece,
    nextPieces: payload.nextPieces,
    candidates: payload.candidates,
  };
  const questions = {
    placement: {
      type: "choice",
      instructions: {
        question: "Which placement candidate is most likely to survive and reach 20 total cleared lines?",
        priority: [
          "First minimize metrics.holesAdded. Never create a new hole when any candidate has holesAdded 0.",
          "Among candidates with the same holesAdded, maximize clearedLines.",
          "Then minimize metrics.holes and metrics.coveredHoles.",
          "Then make the surface flat and low: minimize metrics.bumpiness, then metrics.maxHeight and metrics.aggregateHeight.",
          "Do not trade a new hole for a flatter surface or a line clear.",
        ],
      },
      criteria,
    },
  };

  let gatewayRetryAfter = null;
  const gatewayFetch = async (...args) => {
    const response = await (options.fetcher || fetch)(...args);
    if (response.status === 429) {
      gatewayRetryAfter = retryAfterSeconds(response.headers.get("Retry-After"));
    }
    return response;
  };
  const gateway = createGateway({
    apiKey: env.AI_GATEWAY_API_KEY,
    fetch: gatewayFetch,
  });
  const startedAt = Date.now();
  let result;
  try {
    result = await (options.evaluator || evaluate)({
      model: gateway.evaluationModel(GATEWAY_MODEL),
      state,
      questions,
      // Return rate limits to the browser immediately so it can honor Retry-After
      // without holding a Worker request open through a long free-tier cooldown.
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(10_000),
      providerOptions: { gateway: { zeroDataRetention: true } },
    });
  } catch (error) {
    const details = gatewayErrorDetails(error);
    const report = details.statusCode === 429 ? console.warn : console.error;
    report("Tetris Jev gateway request failed", details);
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      throw new TetrisJevError("Vercel AI Gatewayがタイムアウトしました。", 504);
    }
    if (details.statusCode === 401 || details.statusCode === 403) {
      throw new TetrisJevError("Vercel AI Gatewayキーの設定を確認してください。", 503);
    }
    if (details.statusCode === 402) {
      throw new TetrisJevError("Vercel AI Gatewayのクレジットまたは予算上限を確認してください。", 402);
    }
    if (details.statusCode === 429) {
      const waitSeconds = gatewayRetryAfter ?? 15;
      throw new TetrisJevError(
        "Vercel AI Gatewayがレート制限中です。待機して再試行します。",
        429,
        { "Retry-After": String(waitSeconds) },
      );
    }
    if (details.statusCode === 408 || details.statusCode === 504) {
      throw new TetrisJevError("Vercel AI Gatewayがタイムアウトしました。", 504);
    }
    if (details.statusCode === 424 || (details.statusCode && details.statusCode >= 500)) {
      throw new TetrisJevError("Vercel AI GatewayまたはJevが一時的に混雑しています。", 503);
    }
    throw new TetrisJevError("Vercel AI GatewayのJev呼び出しに失敗しました。", 502);
  }

  const answer = result?.answers?.placement;
  const match = /^candidate_(\d{1,2})$/.exec(answer?.choice || "");
  const choice = match ? Number(match[1]) : -1;
  const validIds = new Set(payload.candidates.map((candidate) => candidate.id));
  if (answer?.type !== "choice" || !validIds.has(choice)) {
    throw new TetrisJevError("Jevが候補外の手を返しました。", 502);
  }
  const probabilities = {};
  for (const candidate of payload.candidates) {
    const value = answer.probabilities?.[`candidate_${candidate.id}`];
    if (typeof value !== "number" || value < 0 || value > 1) {
      throw new TetrisJevError("Jevの候補確率を確認できませんでした。", 502);
    }
    probabilities[candidate.id] = value;
  }
  const providerConfidence = result?.providerMetadata?.typesafe?.confidence?.placement;
  const confidence = typeof providerConfidence === "number"
    ? providerConfidence
    : probabilities[choice];
  const inputTokens = Number.isSafeInteger(result?.usage?.inputTokens) ? result.usage.inputTokens : 0;
  const outputTokens = Number.isSafeInteger(result?.usage?.outputTokens) ? result.usage.outputTokens : 0;
  return {
    choice,
    model: result?.response?.modelId || GATEWAY_MODEL,
    latencyMs: Math.max(0, Date.now() - startedAt),
    confidence,
    probabilities,
    usage: { inputTokens, outputTokens },
    costUsd: Number((inputTokens * GATEWAY_INPUT_USD_PER_TOKEN).toFixed(12)),
  };
}

export async function handleTetrisJevRequest(request, env, options = {}) {
  try {
    if (request.method === "GET") {
      const useGateway = Boolean(env.AI_GATEWAY_API_KEY);
      return json({
        enabled: env.TETRIS_JEV_ENABLED === "true" && Boolean(env.TYPESAFE_API_KEY || env.AI_GATEWAY_API_KEY),
        model: useGateway ? GATEWAY_MODEL : env.TETRIS_JEV_MODEL || MODEL,
        provider: useGateway ? "vercel-ai-gateway" : "typesafe-direct",
      });
    }
    if (request.method !== "POST") {
      return json({ error: "この操作には対応していません。" }, 405, { Allow: "GET, POST" });
    }
    requireSameOrigin(request);
    if (env.TETRIS_JEV_ENABLED !== "true") {
      throw new TetrisJevError("Jev APIデモは現在無効です。", 503);
    }
    if (!env.TYPESAFE_API_KEY && !env.AI_GATEWAY_API_KEY) {
      throw new TetrisJevError("AI_GATEWAY_API_KEYまたはTYPESAFE_API_KEYが未設定です。", 503);
    }
    const payload = validateBody(await readJson(request));
    const result = env.AI_GATEWAY_API_KEY
      ? await callVercelGateway(payload, env, options)
      : await callTypeSafe(payload, env, options.fetcher || fetch);
    return json(result);
  } catch (error) {
    if (error instanceof TetrisJevError) {
      return json({ error: error.message }, error.status, error.headers);
    }
    console.error("Tetris Jev API failed", error?.name || "Error");
    return json({ error: "Jev APIの処理に失敗しました。" }, 500);
  }
}
