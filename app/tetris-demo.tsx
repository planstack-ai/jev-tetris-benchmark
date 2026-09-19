"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./tetris.module.css";
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  TARGET_LINES,
  createInitialBoard,
  createPieceSequence,
  enumerateCandidates,
  pieceCells,
  type Board,
  type Candidate,
  type PieceName,
  type PlayerKind,
} from "./engine";

type RunStatus = "ready" | "running" | "paused" | "finished" | "failed" | "api-error";

type PlayerState = {
  board: Board;
  lines: number;
  pieceIndex: number;
  decisions: number[];
  status: RunStatus;
  selectedCandidate: Candidate | null;
  lastCandidates: Candidate[];
  candidateCount: number;
  lastPiece: PieceName | null;
  thinking: boolean;
  error: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  confidence: number | null;
  probabilities: Record<string, number>;
};

type HaikuDecisionResponse = {
  choice: number;
  model: string;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
};

type JevDecisionResponse = HaikuDecisionResponse & {
  confidence: number;
  probabilities: Record<string, number>;
};

type ModelConfig = {
  enabled: boolean;
  model: string;
};

type Language = "en" | "ja";

const COPY = {
  en: {
    languageLabel: "Language",
    specializedLegend: "specialized",
    languageLegend: "language model",
    liveModels: "LIVE MODEL APIs",
    liveJev: "LIVE JEV API",
    liveHaiku: "LIVE HAIKU API",
    addApiKey: "ADD YOUR API KEY",
    eyebrow: "SAME BOARD. SAME BLOCKS. DIFFERENT DECISIONS.",
    raceStatus: "RACE STATUS",
    configureApi: "Configure an API key to begin",
    jevOnlyMode: "Jev-only mode",
    haikuOnlyMode: "Haiku-only mode",
    jevApiStopped: "Stopped by a Jev API error",
    haikuApiStopped: "Stopped by a Haiku API error",
    jevWon: "Jev reached 20 lines first",
    haikuWon: "Haiku reached 20 lines first",
    racing: "Racing under identical conditions",
    summaryBoth: "Candidate generation and board updates are identical. Only the selected placement differs.",
    summaryJev: "Only Jev is running. Add an Anthropic API key to compare both models.",
    summaryHaiku: "Only Haiku is running. Add a Vercel AI Gateway or TypeSafe API key to compare both models.",
    summaryNone: "Follow the README to add your own API keys and run the experiment with live models.",
    controlsLabel: "Demo controls",
    pause: "Pause",
    resume: "Resume",
    start: "Start race",
    reset: "Reset",
    playbackSpeed: "Playback speed",
    checkingConfig: "Checking API configuration…",
    configBoth: "Each move calls the live Jev and Claude Haiku 4.5 APIs. Usage charges apply.",
    configJev: "The live Jev API will run alone. Add ANTHROPIC_API_KEY for a comparison.",
    configHaiku: "The live Haiku API will run alone. Add a Jev API key for a comparison.",
    configNone: "No API key is configured. Create .env.local and restart the server.",
    specializedModel: "SPECIALIZED MODEL",
    languageModel: "LANGUAGE MODEL",
    apiKeyMissing: "API key missing",
    askingApi: "asking API",
    statusReady: "ready",
    statusRunning: "running",
    statusPaused: "paused",
    statusFinished: "20 lines",
    statusFailed: "game over",
    statusApiError: "API error",
    linesCleared: "Lines cleared",
    elapsed: "Elapsed",
    medianDecision: "Median decision time",
    measuredCost: "Measured API cost",
    previousCandidates: "Previous candidates",
    choices: "choices",
    nextPiece: "Next piece",
    board: "Tetris board",
    candidatePlaceholder: "Start the game to display up to 12 placement candidates here.",
    payloadTitle: "Candidate array sent to the APIs",
    payloadIntro: "The game enumerates legal moves and keeps at most 12 post-placement boards after line clears. ",
    payloadBoth: "Both models compare the board strings and return a candidate ID. Jev evaluates all candidates in one Choice question.",
    payloadJev: "Jev evaluates every candidate in one Choice question and returns a candidate ID.",
    payloadHaiku: "Haiku compares the board strings and returns a candidate ID.",
    pipelineBoard: "board",
    pipelineMoves: "legal moves",
    pipelineCandidates: "top 12",
    footerBoth: "Haiku uses live Anthropic responses and Jev uses live TypeSafe AI responses. Each selected placement is applied from the same legal candidates.",
    footerJev: "Jev is running with live responses. Haiku is disabled because no Anthropic API key is configured.",
    footerHaiku: "Haiku is running with live Anthropic responses. Jev is disabled because no Gateway or TypeSafe API key is configured.",
    footerNone: "Configure API keys to apply placements selected by live models.",
    jevRequestFailed: "The Jev API request failed.",
    gatewayConnectFailed: "Could not connect to Vercel AI Gateway.",
    jevInvalidResponse: "The Jev API returned an invalid response.",
    haikuRequestFailed: "The Haiku API request failed.",
    haikuInvalidResponse: "The Haiku API returned an invalid response.",
    jevInvalidChoice: "Jev returned a choice outside the candidate list.",
    haikuInvalidChoice: "Haiku returned a choice outside the candidate list.",
  },
  ja: {
    languageLabel: "言語",
    specializedLegend: "特化型モデル",
    languageLegend: "言語モデル",
    liveModels: "実モデルAPI",
    liveJev: "Jev実API",
    liveHaiku: "Haiku実API",
    addApiKey: "APIキーを設定",
    eyebrow: "同じ盤面。同じブロック。異なる判断。",
    raceStatus: "レース状況",
    configureApi: "APIキーを設定してください",
    jevOnlyMode: "Jev単独モード",
    haikuOnlyMode: "Haiku単独モード",
    jevApiStopped: "Jev APIエラーで停止",
    haikuApiStopped: "Haiku APIエラーで停止",
    jevWon: "Jevが先に20ラインへ到達",
    haikuWon: "Haikuが先に20ラインへ到達",
    racing: "同一条件でレース中",
    summaryBoth: "候補生成と盤面更新は同一。違うのは、どの候補を選ぶかだけです。",
    summaryJev: "現在はJevのみ実行します。Anthropic APIキー設定後は同じ条件で比較できます。",
    summaryHaiku: "現在はHaikuのみ実行します。Vercel AI GatewayまたはTypeSafeのAPIキー設定後は同じ条件で比較できます。",
    summaryNone: "READMEの手順で自分のAPIキーを設定すると、実モデルによる検証を開始できます。",
    controlsLabel: "デモ操作",
    pause: "一時停止",
    resume: "再開",
    start: "レースを開始",
    reset: "リセット",
    playbackSpeed: "再生速度",
    checkingConfig: "API設定を確認中です…",
    configBoth: "開始すると毎手JevとClaude Haiku 4.5の実APIを呼び出します。API料金が発生します。",
    configJev: "Jevの実APIを単独で呼び出します。比較にはANTHROPIC_API_KEYも設定してください。",
    configHaiku: "Haikuの実APIを単独で呼び出します。比較にはJev用APIキーも設定してください。",
    configNone: "APIキーが未設定です。.env.localを作成してサーバーを再起動してください。",
    specializedModel: "特化型モデル",
    languageModel: "言語モデル",
    apiKeyMissing: "APIキーなし",
    askingApi: "APIへ問い合わせ中",
    statusReady: "準備完了",
    statusRunning: "実行中",
    statusPaused: "一時停止",
    statusFinished: "20ライン",
    statusFailed: "ゲームオーバー",
    statusApiError: "APIエラー",
    linesCleared: "消去ライン",
    elapsed: "経過",
    medianDecision: "1手の決定時間 中央値",
    measuredCost: "API費用 実測",
    previousCandidates: "直前の候補",
    choices: "候補",
    nextPiece: "次のブロック",
    board: "テトリス盤面",
    candidatePlaceholder: "ゲームを開始すると、ここに最大12候補が表示されます。",
    payloadTitle: "APIへ渡す候補配列",
    payloadIntro: "ゲーム側が合法手を列挙し、配置・ライン消去後の盤面を最大12個に絞ります。",
    payloadBoth: "両モデルは盤面文字列を比較し、候補IDを返します。Jevでは全候補を1つのChoice質問として評価します。",
    payloadJev: "Jevが全候補を1つのChoice質問として評価し、候補IDを返します。",
    payloadHaiku: "Haikuが盤面文字列を比較し、候補IDを返します。",
    pipelineBoard: "盤面",
    pipelineMoves: "合法手",
    pipelineCandidates: "最大12候補",
    footerBoth: "Haiku側はAnthropic API、Jev側はTypeSafe AI APIの実応答です。同じ合法手候補から各モデルが選んだ配置を反映します。",
    footerJev: "現在はJevの実応答による単独モードです。Haiku側はAnthropic APIキー未設定のため実行しません。",
    footerHaiku: "現在はAnthropic APIの実応答によるHaiku単独モードです。Jev側はGatewayまたはTypeSafeのAPIキー未設定のため実行しません。",
    footerNone: "APIキーを設定すると、実モデルが選んだ配置を盤面へ反映します。",
    jevRequestFailed: "Jev APIの呼び出しに失敗しました。",
    gatewayConnectFailed: "Vercel AI Gatewayへ接続できませんでした。",
    jevInvalidResponse: "Jev APIの応答形式を確認できませんでした。",
    haikuRequestFailed: "Haiku APIの呼び出しに失敗しました。",
    haikuInvalidResponse: "Haiku APIの応答形式を確認できませんでした。",
    jevInvalidChoice: "Jevが候補外の手を返しました。",
    haikuInvalidChoice: "Haikuが候補外の手を返しました。",
  },
} as const;

type Copy = { [Key in keyof typeof COPY.en]: string };

function localizedApiError(message: string | undefined, language: Language, fallback: string) {
  if (!message) return fallback;
  if (language === "ja" || !/[ぁ-んァ-ン一-龯]/.test(message)) return message;
  return fallback;
}

const PIECES = createPieceSequence();

function initialPlayer(): PlayerState {
  return {
    board: createInitialBoard(),
    lines: 0,
    pieceIndex: 0,
    decisions: [],
    status: "ready",
    selectedCandidate: null,
    lastCandidates: [],
    candidateCount: 0,
    lastPiece: null,
    thinking: false,
    error: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    totalCostUsd: 0,
    confidence: null,
    probabilities: {},
  };
}

async function requestJevDecision(
  currentPiece: PieceName,
  nextPieces: PieceName[],
  candidates: Candidate[],
  clearedTotal: number,
  language: Language,
): Promise<JevDecisionResponse> {
  const copy: Copy = COPY[language];
  const body = JSON.stringify({
    currentPiece,
    nextPieces,
    clearedTotal,
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      board: candidate.boardRows,
      clearedLines: candidate.clearedLines,
      rotation: candidate.rotation,
      x: candidate.x,
      metrics: candidate.metrics,
    })),
  });
  let lastError = copy.jevRequestFailed;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let response: Response;
    try {
      response = await fetch("/api/tetris-jev", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Tetris-Jev": "1",
        },
        body,
      });
    } catch {
      lastError = copy.gatewayConnectFailed;
      if (attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000 * (attempt + 1)));
        continue;
      }
      throw new Error(lastError);
    }

    const data = await response.json() as Partial<JevDecisionResponse> & { error?: string };
    if (!response.ok) {
      lastError = localizedApiError(data.error, language, lastError);
      const retryable = [429, 502, 503, 504].includes(response.status);
      if (retryable && attempt < 2) {
        const retryAfter = Number(response.headers.get("Retry-After"));
        const delayMs = Number.isFinite(retryAfter) && retryAfter >= 0
          ? Math.max(1_000, retryAfter * 1_000)
          : 1_500 * (2 ** attempt);
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
        continue;
      }
      throw new Error(lastError);
    }
    if (
      !Number.isSafeInteger(data.choice) ||
      typeof data.model !== "string" ||
      typeof data.latencyMs !== "number" ||
      typeof data.confidence !== "number" ||
      !data.probabilities ||
      !data.usage ||
      typeof data.usage.inputTokens !== "number" ||
      typeof data.usage.outputTokens !== "number" ||
      typeof data.costUsd !== "number"
    ) {
      throw new Error(copy.jevInvalidResponse);
    }
    return data as JevDecisionResponse;
  }
  throw new Error(lastError);
}

async function requestHaikuDecision(
  currentPiece: PieceName,
  nextPieces: PieceName[],
  candidates: Candidate[],
  language: Language,
): Promise<HaikuDecisionResponse> {
  const copy: Copy = COPY[language];
  const response = await fetch("/api/tetris-haiku", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tetris-Haiku": "1",
    },
    body: JSON.stringify({
      currentPiece,
      nextPieces,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        board: candidate.boardRows,
        clearedLines: candidate.clearedLines,
        topOut: candidate.topOut,
        rotation: candidate.rotation,
        x: candidate.x,
        metrics: candidate.metrics,
      })),
    }),
  });
  const data = await response.json() as Partial<HaikuDecisionResponse> & { error?: string };
  if (!response.ok) {
    throw new Error(localizedApiError(data.error, language, copy.haikuRequestFailed));
  }
  if (
    !Number.isSafeInteger(data.choice) ||
    typeof data.model !== "string" ||
    typeof data.latencyMs !== "number" ||
    !data.usage ||
    typeof data.usage.inputTokens !== "number" ||
    typeof data.usage.outputTokens !== "number" ||
    typeof data.costUsd !== "number"
  ) {
    throw new Error(copy.haikuInvalidResponse);
  }
  return data as HaikuDecisionResponse;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function formatTime(milliseconds: number) {
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function statusLabel(status: RunStatus, copy: Copy) {
  return {
    ready: copy.statusReady,
    running: copy.statusRunning,
    paused: copy.statusPaused,
    finished: copy.statusFinished,
    failed: copy.statusFailed,
    "api-error": copy.statusApiError,
  }[status];
}

function PiecePreview({ piece, copy }: { piece: PieceName; copy: Copy }) {
  const { shape, value } = pieceCells(piece);
  return (
    <div className={styles.piecePreview} aria-label={`${copy.nextPiece}: ${piece}`}>
      {Array.from({ length: 8 }, (_, index) => {
        const x = index % 4;
        const y = Math.floor(index / 4);
        const filled = shape.some(([shapeX, shapeY]) => shapeX === x && shapeY === y);
        return <i key={index} data-cell={filled ? value : 0} />;
      })}
    </div>
  );
}

function TetrisBoard({ board, label, copy }: { board: Board; label: string; copy: Copy }) {
  return (
    <div
      className={styles.tetrisBoard}
      role="img"
      aria-label={`${label} ${copy.board}`}
      style={{
        gridTemplateColumns: `repeat(${BOARD_WIDTH}, 1fr)`,
        gridTemplateRows: `repeat(${BOARD_HEIGHT}, 1fr)`,
      }}
    >
      {board.flatMap((row, rowIndex) =>
        row.map((cell, columnIndex) => (
          <i key={`${rowIndex}-${columnIndex}`} data-cell={cell} />
        )),
      )}
    </div>
  );
}

function PlayerCard({
  title,
  kind,
  state,
  elapsed,
  language,
  copy,
  unavailable = false,
}: {
  title: string;
  kind: PlayerKind;
  state: PlayerState;
  elapsed: number;
  language: Language;
  copy: Copy;
  unavailable?: boolean;
}) {
  const nextPiece = PIECES[state.pieceIndex] ?? "I";
  const decisionMedian = median(state.decisions);
  const apiCost = state.totalCostUsd;

  return (
    <article className={styles.playerCard} data-player={kind}>
      <header className={styles.playerHeader}>
        <div>
          <p>{kind === "jev" ? copy.specializedModel : copy.languageModel}</p>
          <h2>{title}</h2>
        </div>
        <span data-status={unavailable ? "unavailable" : state.status}>
          {unavailable ? copy.apiKeyMissing : state.thinking ? copy.askingApi : statusLabel(state.status, copy)}
        </span>
      </header>

      <div className={styles.gameArea}>
        <TetrisBoard board={state.board} label={title} copy={copy} />
        <div className={styles.metrics}>
          <div>
            <span>{copy.linesCleared}</span>
            <strong>{state.lines} <small>/ {TARGET_LINES}</small></strong>
          </div>
          <div>
            <span>{copy.elapsed}</span>
            <strong>{formatTime(elapsed)}</strong>
          </div>
          <div>
            <span>{copy.medianDecision}</span>
            <strong>{decisionMedian || "—"}<small>{decisionMedian ? " ms" : ""}</small></strong>
          </div>
          <div>
            <span>{copy.measuredCost}</span>
            <strong>${apiCost.toFixed(4)}</strong>
          </div>
          <div className={styles.candidateMetric}>
            <span>{copy.previousCandidates}</span>
            <strong>
              {state.candidateCount || "—"}
              <small>
                {state.candidateCount
                  ? ` ${copy.choices} · ${kind === "jev" && state.confidence !== null
                    ? `${Math.round(state.confidence * 100)}% conf`
                    : `${state.inputTokens} in`}`
                  : ""}
              </small>
            </strong>
          </div>
        </div>
      </div>

      <footer className={styles.nextBar}>
        <span>{copy.nextPiece}</span>
        <PiecePreview piece={nextPiece} copy={copy} />
        <b>{nextPiece}</b>
      </footer>
      {state.error ? (
        <p className={styles.apiError}>
          {localizedApiError(
            state.error,
            language,
            kind === "jev" ? copy.jevRequestFailed : copy.haikuRequestFailed,
          )}
        </p>
      ) : null}
    </article>
  );
}

export function TetrisDemo() {
  const [language, setLanguage] = useState<Language>("en");
  const [jev, setJev] = useState<PlayerState>(() => initialPlayer());
  const [haiku, setHaiku] = useState<PlayerState>(() => initialPlayer());
  const [runStatus, setRunStatus] = useState<RunStatus>("ready");
  const [jevConfig, setJevConfig] = useState<ModelConfig | null>(null);
  const [haikuConfig, setHaikuConfig] = useState<ModelConfig | null>(null);
  const [speed, setSpeed] = useState(2.5);
  const [elapsed, setElapsed] = useState({ jev: 0, haiku: 0 });
  const startedAt = useRef(0);
  const nextDecisionAt = useRef({ jev: 0, haiku: 0 });
  const finishTimes = useRef({ jev: 0, haiku: 0 });
  const playerRefs = useRef({ jev, haiku });
  const jevRequestPending = useRef(false);
  const haikuRequestPending = useRef(false);
  const sessionId = useRef(0);
  const copy: Copy = COPY[language];

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    playerRefs.current = { jev, haiku };
  }, [jev, haiku]);

  useEffect(() => {
    let active = true;
    const loadConfig = async (url: string, fallbackModel: string): Promise<ModelConfig> => {
      try {
        const response = await fetch(url, { cache: "no-store" });
        const data = await response.json() as Partial<ModelConfig>;
        if (!response.ok || typeof data.enabled !== "boolean" || typeof data.model !== "string") {
          throw new Error("API configuration could not be verified.");
        }
        return data as ModelConfig;
      } catch {
        return { enabled: false, model: fallbackModel };
      }
    };
    void Promise.all([
      loadConfig("/api/tetris-jev", "jev-latest"),
      loadConfig("/api/tetris-haiku", "claude-haiku-4-5-20251001"),
    ]).then(([nextJevConfig, nextHaikuConfig]) => {
      if (!active) return;
      setJevConfig(nextJevConfig);
      setHaikuConfig(nextHaikuConfig);
    });
    return () => { active = false; };
  }, []);

  const reset = useCallback(() => {
    sessionId.current += 1;
    jevRequestPending.current = false;
    haikuRequestPending.current = false;
    const nextJev = initialPlayer();
    const nextHaiku = initialPlayer();
    setJev(nextJev);
    setHaiku(nextHaiku);
    playerRefs.current = { jev: nextJev, haiku: nextHaiku };
    setRunStatus("ready");
    setElapsed({ jev: 0, haiku: 0 });
    startedAt.current = 0;
    nextDecisionAt.current = { jev: 0, haiku: 0 };
    finishTimes.current = { jev: 0, haiku: 0 };
  }, []);

  const start = useCallback(() => {
    if (jevConfig === null || haikuConfig === null || (!jevConfig.enabled && !haikuConfig.enabled)) return;
    const now = performance.now();
    if (runStatus === "ready" || runStatus === "finished" || runStatus === "failed") {
      if (runStatus !== "ready") reset();
      startedAt.current = now;
      nextDecisionAt.current = { jev: now + 180 / speed, haiku: now + 680 / speed };
      finishTimes.current = { jev: 0, haiku: 0 };
      if (jevConfig.enabled) setJev((state) => ({ ...state, status: "running" }));
      if (haikuConfig.enabled) setHaiku((state) => ({ ...state, status: "running", error: null }));
    } else {
      const pauseDuration = now - startedAt.current - Math.max(elapsed.jev, elapsed.haiku);
      startedAt.current += Math.max(0, pauseDuration);
      nextDecisionAt.current = { jev: now + 80, haiku: now + 180 };
      if (jevConfig.enabled) {
        setJev((state) => state.status === "paused" ? { ...state, status: "running" } : state);
      }
      if (haikuConfig.enabled) {
        setHaiku((state) => state.status === "paused" ? { ...state, status: "running" } : state);
      }
    }
    setRunStatus("running");
  }, [elapsed, haikuConfig, jevConfig, reset, runStatus, speed]);

  const pause = useCallback(() => {
    setRunStatus("paused");
    const nextJev = playerRefs.current.jev.status === "running"
      ? { ...playerRefs.current.jev, status: "paused" as const }
      : playerRefs.current.jev;
    const nextHaiku = playerRefs.current.haiku.status === "running"
      ? { ...playerRefs.current.haiku, status: "paused" as const }
      : playerRefs.current.haiku;
    playerRefs.current = { jev: nextJev, haiku: nextHaiku };
    setJev(nextJev);
    setHaiku(nextHaiku);
  }, []);

  useEffect(() => {
    if (runStatus !== "running") return;

    const stepJev = (now: number) => {
      const current = playerRefs.current.jev;
      if (
        current.status !== "running" ||
        current.thinking ||
        jevRequestPending.current ||
        now < nextDecisionAt.current.jev
      ) return;

      const piece = PIECES[current.pieceIndex];
      const candidates = enumerateCandidates(current.board, piece);
      if (candidates.length === 0) {
        const failed = { ...current, status: "failed" as const, lastPiece: piece };
        playerRefs.current.jev = failed;
        setJev(failed);
        finishTimes.current.jev = now - startedAt.current;
        return;
      }

      const requestSession = sessionId.current;
      const thinkingState: PlayerState = {
        ...current,
        thinking: true,
        error: null,
        lastCandidates: candidates,
        candidateCount: candidates.length,
        lastPiece: piece,
      };
      jevRequestPending.current = true;
      playerRefs.current.jev = thinkingState;
      setJev(thinkingState);

      void requestJevDecision(
        piece,
        PIECES.slice(current.pieceIndex + 1, current.pieceIndex + 4),
        candidates,
        current.lines,
        language,
      ).then((decision) => {
        if (requestSession !== sessionId.current) return;
        const selected = candidates.find((candidate) => candidate.id === decision.choice);
        if (!selected) throw new Error(copy.jevInvalidChoice);
        const latest = playerRefs.current.jev;
        const totalLines = latest.lines + selected.clearedLines;
        const didFinish = totalLines >= TARGET_LINES;
        const paused = latest.status === "paused";
        const nextState: PlayerState = {
          ...latest,
          board: selected.board,
          lines: totalLines,
          pieceIndex: latest.pieceIndex + 1,
          decisions: [...latest.decisions, decision.latencyMs],
          status: didFinish ? "finished" : paused ? "paused" : "running",
          selectedCandidate: selected,
          thinking: false,
          model: decision.model,
          inputTokens: latest.inputTokens + decision.usage.inputTokens,
          outputTokens: latest.outputTokens + decision.usage.outputTokens,
          totalCostUsd: latest.totalCostUsd + decision.costUsd,
          confidence: decision.confidence,
          probabilities: decision.probabilities,
        };
        playerRefs.current.jev = nextState;
        setJev(nextState);
        if (didFinish) finishTimes.current.jev = performance.now() - startedAt.current;
        else nextDecisionAt.current.jev = performance.now() + 80 / speed;
      }).catch((error: unknown) => {
        if (requestSession !== sessionId.current) return;
        const latest = playerRefs.current.jev;
        const failed: PlayerState = {
          ...latest,
          status: "api-error",
          thinking: false,
          error: error instanceof Error ? error.message : copy.jevRequestFailed,
        };
        playerRefs.current.jev = failed;
        setJev(failed);
        finishTimes.current.jev = performance.now() - startedAt.current;
      }).finally(() => {
        if (requestSession === sessionId.current) jevRequestPending.current = false;
      });
    };

    const stepHaiku = (now: number) => {
      const current = playerRefs.current.haiku;
      if (
        current.status !== "running" ||
        current.thinking ||
        haikuRequestPending.current ||
        now < nextDecisionAt.current.haiku
      ) return;

      const piece = PIECES[current.pieceIndex];
      const candidates = enumerateCandidates(current.board, piece);
      if (candidates.length === 0) {
        const failed = { ...current, status: "failed" as const, lastPiece: piece };
        playerRefs.current.haiku = failed;
        setHaiku(failed);
        finishTimes.current.haiku = now - startedAt.current;
        return;
      }

      const requestSession = sessionId.current;
      const thinkingState = {
        ...current,
        thinking: true,
        error: null,
        lastCandidates: candidates,
        candidateCount: candidates.length,
        lastPiece: piece,
      };
      haikuRequestPending.current = true;
      playerRefs.current.haiku = thinkingState;
      setHaiku(thinkingState);

      void requestHaikuDecision(
        piece,
        PIECES.slice(current.pieceIndex + 1, current.pieceIndex + 4),
        candidates,
        language,
      ).then((decision) => {
        if (requestSession !== sessionId.current) return;
        const selected = candidates.find((candidate) => candidate.id === decision.choice);
        if (!selected) throw new Error(copy.haikuInvalidChoice);
        const latest = playerRefs.current.haiku;
        const totalLines = latest.lines + selected.clearedLines;
        const didFinish = totalLines >= TARGET_LINES;
        const paused = latest.status === "paused";
        const nextState: PlayerState = {
          ...latest,
          board: selected.board,
          lines: totalLines,
          pieceIndex: latest.pieceIndex + 1,
          decisions: [...latest.decisions, decision.latencyMs],
          status: didFinish ? "finished" : paused ? "paused" : "running",
          selectedCandidate: selected,
          thinking: false,
          model: decision.model,
          inputTokens: latest.inputTokens + decision.usage.inputTokens,
          outputTokens: latest.outputTokens + decision.usage.outputTokens,
          totalCostUsd: latest.totalCostUsd + decision.costUsd,
        };
        playerRefs.current.haiku = nextState;
        setHaiku(nextState);
        if (didFinish) finishTimes.current.haiku = performance.now() - startedAt.current;
        else nextDecisionAt.current.haiku = performance.now() + 80 / speed;
      }).catch((error: unknown) => {
        if (requestSession !== sessionId.current) return;
        const latest = playerRefs.current.haiku;
        const failed: PlayerState = {
          ...latest,
          status: "api-error",
          thinking: false,
          error: error instanceof Error ? error.message : copy.haikuRequestFailed,
        };
        playerRefs.current.haiku = failed;
        setHaiku(failed);
        finishTimes.current.haiku = performance.now() - startedAt.current;
      }).finally(() => {
        if (requestSession === sessionId.current) haikuRequestPending.current = false;
      });
    };

    const timer = window.setInterval(() => {
      const now = performance.now();
      stepJev(now);
      stepHaiku(now);

      setElapsed({
        jev: finishTimes.current.jev || now - startedAt.current,
        haiku: finishTimes.current.haiku || now - startedAt.current,
      });

      const states = playerRefs.current;
      const jevDone = !jevConfig?.enabled || states.jev.status !== "running";
      const haikuDone = !haikuConfig?.enabled || states.haiku.status !== "running";
      if (jevDone && haikuDone) {
        const bothFailed = (!jevConfig?.enabled || ["failed", "api-error"].includes(states.jev.status)) &&
          (!haikuConfig?.enabled || ["failed", "api-error"].includes(states.haiku.status));
        setRunStatus(bothFailed ? "failed" : "finished");
      }
    }, 32);

    return () => window.clearInterval(timer);
  }, [copy, haikuConfig?.enabled, jevConfig?.enabled, language, runStatus, speed]);

  const payload = useMemo(() => {
    const source = haiku.selectedCandidate ? haiku : jev;
    const currentPiece = source.lastPiece ?? PIECES[source.pieceIndex];
    if (!source.selectedCandidate) {
      return {
        currentPiece,
        candidates: copy.candidatePlaceholder,
      };
    }
    return {
      currentPiece,
      candidates: source.lastCandidates.map((candidate) => ({
        id: candidate.id,
        board: candidate.boardRows,
        clearedLines: candidate.clearedLines,
        topOut: candidate.topOut,
        rotation: candidate.rotation,
        x: candidate.x,
        metrics: candidate.metrics,
      })),
      responses: {
        jev: {
          choice: jev.selectedCandidate?.id ?? null,
          model: jev.model,
          confidence: jev.confidence,
          probabilities: jev.probabilities,
          inputTokens: jev.inputTokens,
          costUsd: Number(jev.totalCostUsd.toFixed(8)),
        },
        haiku: {
          choice: haiku.selectedCandidate?.id ?? null,
          model: haiku.model,
          inputTokens: haiku.inputTokens,
          outputTokens: haiku.outputTokens,
          costUsd: Number(haiku.totalCostUsd.toFixed(6)),
        },
      },
    };
  }, [copy.candidatePlaceholder, haiku, jev]);

  const winner = !jevConfig?.enabled && !haikuConfig?.enabled
    ? copy.configureApi
    : jevConfig?.enabled && !haikuConfig?.enabled
      ? copy.jevOnlyMode
      : !jevConfig?.enabled && haikuConfig?.enabled
        ? copy.haikuOnlyMode
    : jev.status === "api-error"
      ? copy.jevApiStopped
      : haiku.status === "api-error"
        ? copy.haikuApiStopped
    : jev.status === "finished" && haiku.status !== "finished"
    ? copy.jevWon
    : haiku.status === "finished" && jev.status !== "finished"
      ? copy.haikuWon
      : jev.status === "finished" && haiku.status === "finished"
        ? elapsed.jev <= elapsed.haiku ? copy.jevWon : copy.haikuWon
        : copy.racing;

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>T</span>
          <div><strong>MODEL RACE</strong><small>TETRIS DECISION BENCH</small></div>
        </div>
        <div className={styles.legend}>
          <span><i data-color="jev" /> {copy.specializedLegend}</span>
          <span><i data-color="haiku" /> {copy.languageLegend}</span>
          <b>{jevConfig?.enabled && haikuConfig?.enabled
            ? copy.liveModels
            : jevConfig?.enabled
              ? copy.liveJev
              : haikuConfig?.enabled
                ? copy.liveHaiku
                : copy.addApiKey}</b>
          <div className={styles.languageSwitch} role="group" aria-label={copy.languageLabel}>
            <button type="button" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
            <button type="button" aria-pressed={language === "ja"} onClick={() => setLanguage("ja")}>日本語</button>
          </div>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>{copy.eyebrow}</p>
          <h1>AI Tetris<br /><span>Decision Race</span></h1>
        </div>
        <div className={styles.raceSummary}>
          <span>{copy.raceStatus}</span>
          <strong>{winner}</strong>
          <p>
            {jevConfig?.enabled && haikuConfig?.enabled
              ? copy.summaryBoth
              : jevConfig?.enabled
                ? copy.summaryJev
                : haikuConfig?.enabled
                  ? copy.summaryHaiku
                  : copy.summaryNone}
          </p>
        </div>
      </section>

      <section className={styles.controls} aria-label={copy.controlsLabel}>
        <div className={styles.controlButtons}>
          {runStatus === "running" ? (
            <button type="button" className={styles.primaryButton} onClick={pause}>{copy.pause}</button>
          ) : (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={start}
              disabled={jevConfig === null || haikuConfig === null || (!jevConfig.enabled && !haikuConfig.enabled)}
            >
              {runStatus === "paused" ? copy.resume : copy.start}
            </button>
          )}
          <button type="button" className={styles.secondaryButton} onClick={reset}>{copy.reset}</button>
        </div>
        <div className={styles.speedControl}>
          <span>{copy.playbackSpeed}</span>
          {[1, 2.5, 5].map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={speed === option}
              onClick={() => setSpeed(option)}
            >
              ×{option}
            </button>
          ))}
        </div>
        <p className={!jevConfig?.enabled ? styles.configError : undefined}>
          {jevConfig === null || haikuConfig === null
            ? copy.checkingConfig
            : jevConfig.enabled && haikuConfig.enabled
              ? copy.configBoth
              : jevConfig.enabled
                ? copy.configJev
                : haikuConfig.enabled
                  ? copy.configHaiku
                  : copy.configNone}
        </p>
      </section>

      <section className={styles.raceGrid}>
        <PlayerCard
          title={jevConfig?.model ? `${jevConfig.model} API` : "Jev API"}
          kind="jev"
          state={jev}
          elapsed={elapsed.jev}
          language={language}
          copy={copy}
          unavailable={jevConfig?.enabled === false}
        />
        <PlayerCard
          title={haikuConfig?.model ? `${haikuConfig.model} API` : "Claude Haiku 4.5 API"}
          kind="haiku"
          state={haiku}
          elapsed={elapsed.haiku}
          language={language}
          copy={copy}
          unavailable={haikuConfig?.enabled === false}
        />
      </section>

      <section className={styles.dataPanel}>
        <div className={styles.dataCopy}>
          <p>MODEL INPUT / OUTPUT</p>
          <h2>{copy.payloadTitle}</h2>
          <p>
            {copy.payloadIntro}
            {jevConfig?.enabled && haikuConfig?.enabled
              ? copy.payloadBoth
              : jevConfig?.enabled
                ? copy.payloadJev
                : copy.payloadHaiku}
          </p>
          <div className={styles.pipeline}>
            <span>{copy.pipelineBoard}</span><i>→</i><span>{copy.pipelineMoves}</span><i>→</i><span>{copy.pipelineCandidates}</span><i>→</i><b>choice ID</b>
          </div>
        </div>
        <pre aria-live="polite"><code>{JSON.stringify(payload, null, 2)}</code></pre>
      </section>

      <footer className={styles.disclaimer}>
        <strong>DEMO NOTE</strong>
        <p>
          {jevConfig?.enabled && haikuConfig?.enabled
            ? copy.footerBoth
            : jevConfig?.enabled
              ? copy.footerJev
              : haikuConfig?.enabled
                ? copy.footerHaiku
                : copy.footerNone}
        </p>
      </footer>
    </main>
  );
}
