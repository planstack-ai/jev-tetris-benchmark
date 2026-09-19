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
): Promise<JevDecisionResponse> {
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
  let lastError = "Jev APIの呼び出しに失敗しました。";

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
      lastError = "Vercel AI Gatewayへ接続できませんでした。";
      if (attempt < 2) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000 * (attempt + 1)));
        continue;
      }
      throw new Error(lastError);
    }

    const data = await response.json() as Partial<JevDecisionResponse> & { error?: string };
    if (!response.ok) {
      lastError = data.error || lastError;
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
      throw new Error("Jev APIの応答形式を確認できませんでした。");
    }
    return data as JevDecisionResponse;
  }
  throw new Error(lastError);
}

async function requestHaikuDecision(
  currentPiece: PieceName,
  nextPieces: PieceName[],
  candidates: Candidate[],
): Promise<HaikuDecisionResponse> {
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
  if (!response.ok) throw new Error(data.error || "Haiku APIの呼び出しに失敗しました。");
  if (
    !Number.isSafeInteger(data.choice) ||
    typeof data.model !== "string" ||
    typeof data.latencyMs !== "number" ||
    !data.usage ||
    typeof data.usage.inputTokens !== "number" ||
    typeof data.usage.outputTokens !== "number" ||
    typeof data.costUsd !== "number"
  ) {
    throw new Error("Haiku APIの応答形式を確認できませんでした。");
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

function statusLabel(status: RunStatus) {
  return {
    ready: "ready",
    running: "running",
    paused: "paused",
    finished: "20 lines",
    failed: "game over",
    "api-error": "API error",
  }[status];
}

function PiecePreview({ piece }: { piece: PieceName }) {
  const { shape, value } = pieceCells(piece);
  return (
    <div className={styles.piecePreview} aria-label={`次のブロック ${piece}`}>
      {Array.from({ length: 8 }, (_, index) => {
        const x = index % 4;
        const y = Math.floor(index / 4);
        const filled = shape.some(([shapeX, shapeY]) => shapeX === x && shapeY === y);
        return <i key={index} data-cell={filled ? value : 0} />;
      })}
    </div>
  );
}

function TetrisBoard({ board, label }: { board: Board; label: string }) {
  return (
    <div
      className={styles.tetrisBoard}
      role="img"
      aria-label={`${label}のテトリス盤面`}
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
  unavailable = false,
}: {
  title: string;
  kind: PlayerKind;
  state: PlayerState;
  elapsed: number;
  unavailable?: boolean;
}) {
  const nextPiece = PIECES[state.pieceIndex] ?? "I";
  const decisionMedian = median(state.decisions);
  const apiCost = state.totalCostUsd;

  return (
    <article className={styles.playerCard} data-player={kind}>
      <header className={styles.playerHeader}>
        <div>
          <p>{kind === "jev" ? "SPECIALIZED MODEL" : "LANGUAGE MODEL"}</p>
          <h2>{title}</h2>
        </div>
        <span data-status={unavailable ? "unavailable" : state.status}>
          {unavailable ? "API keyなし" : state.thinking ? "asking API" : statusLabel(state.status)}
        </span>
      </header>

      <div className={styles.gameArea}>
        <TetrisBoard board={state.board} label={title} />
        <div className={styles.metrics}>
          <div>
            <span>消去ライン</span>
            <strong>{state.lines} <small>/ {TARGET_LINES}</small></strong>
          </div>
          <div>
            <span>経過</span>
            <strong>{formatTime(elapsed)}</strong>
          </div>
          <div>
            <span>1手の決定時間 中央値</span>
            <strong>{decisionMedian || "—"}<small>{decisionMedian ? " ms" : ""}</small></strong>
          </div>
          <div>
            <span>API費用 実測</span>
            <strong>${apiCost.toFixed(4)}</strong>
          </div>
          <div className={styles.candidateMetric}>
            <span>直前の候補</span>
            <strong>
              {state.candidateCount || "—"}
              <small>
                {state.candidateCount
                  ? ` choices · ${kind === "jev" && state.confidence !== null
                    ? `${Math.round(state.confidence * 100)}% conf`
                    : `${state.inputTokens} in`}`
                  : ""}
              </small>
            </strong>
          </div>
        </div>
      </div>

      <footer className={styles.nextBar}>
        <span>次のブロック</span>
        <PiecePreview piece={nextPiece} />
        <b>{nextPiece}</b>
      </footer>
      {state.error ? <p className={styles.apiError}>{state.error}</p> : null}
    </article>
  );
}

export function TetrisDemo() {
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
          throw new Error("API設定を確認できませんでした。");
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
      ).then((decision) => {
        if (requestSession !== sessionId.current) return;
        const selected = candidates.find((candidate) => candidate.id === decision.choice);
        if (!selected) throw new Error("Jevが候補外の手を返しました。");
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
          error: error instanceof Error ? error.message : "Jev APIの呼び出しに失敗しました。",
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
      ).then((decision) => {
        if (requestSession !== sessionId.current) return;
        const selected = candidates.find((candidate) => candidate.id === decision.choice);
        if (!selected) throw new Error("Haikuが候補外の手を返しました。");
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
          error: error instanceof Error ? error.message : "Haiku APIの呼び出しに失敗しました。",
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
  }, [haikuConfig?.enabled, jevConfig?.enabled, runStatus, speed]);

  const payload = useMemo(() => {
    const source = haiku.selectedCandidate ? haiku : jev;
    const currentPiece = source.lastPiece ?? PIECES[source.pieceIndex];
    if (!source.selectedCandidate) {
      return {
        currentPiece,
        candidates: "ゲームを開始すると、ここに最大12候補が表示されます",
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
  }, [haiku, jev]);

  const winner = !jevConfig?.enabled && !haikuConfig?.enabled
    ? "APIキーを設定してください"
    : jevConfig?.enabled && !haikuConfig?.enabled
      ? "Jev単独モード"
      : !jevConfig?.enabled && haikuConfig?.enabled
        ? "Haiku単独モード"
    : jev.status === "api-error"
      ? "Jev APIエラーで停止"
      : haiku.status === "api-error"
        ? "Haiku APIエラーで停止"
    : jev.status === "finished" && haiku.status !== "finished"
    ? "Jevが先に20ラインへ到達"
    : haiku.status === "finished" && jev.status !== "finished"
      ? "Haikuが先に20ラインへ到達"
      : jev.status === "finished" && haiku.status === "finished"
        ? elapsed.jev <= elapsed.haiku ? "Jevが先に20ラインへ到達" : "Haikuが先に20ラインへ到達"
        : "同一条件でレース中";

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.brandMark}>T</span>
          <div><strong>MODEL RACE</strong><small>TETRIS DECISION BENCH</small></div>
        </div>
        <div className={styles.legend}>
          <span><i data-color="jev" /> specialized</span>
          <span><i data-color="haiku" /> language model</span>
          <b>{jevConfig?.enabled && haikuConfig?.enabled
            ? "LIVE MODEL APIs"
            : jevConfig?.enabled
              ? "LIVE JEV API"
              : haikuConfig?.enabled
                ? "LIVE HAIKU API"
                : "ADD YOUR API KEY"}</b>
        </div>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>SAME BOARD. SAME BLOCKS. DIFFERENT DECISIONS.</p>
          <h1>AI Tetris<br /><span>Decision Race</span></h1>
        </div>
        <div className={styles.raceSummary}>
          <span>RACE STATUS</span>
          <strong>{winner}</strong>
          <p>
            {jevConfig?.enabled && haikuConfig?.enabled
              ? "候補生成と盤面更新は同一。違うのは、どの候補を選ぶかだけ。"
              : jevConfig?.enabled
                ? "現在はJevのみ実行します。Anthropic APIキー設定後は同じ条件で比較できます。"
                : haikuConfig?.enabled
                  ? "現在はHaikuのみ実行します。Vercel AI GatewayまたはTypeSafeのAPIキー設定後は同じ条件で比較できます。"
                  : "READMEの手順で自分のAPIキーを設定すると、実モデルによる検証を開始できます。"}
          </p>
        </div>
      </section>

      <section className={styles.controls} aria-label="デモ操作">
        <div className={styles.controlButtons}>
          {runStatus === "running" ? (
            <button type="button" className={styles.primaryButton} onClick={pause}>一時停止</button>
          ) : (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={start}
              disabled={jevConfig === null || haikuConfig === null || (!jevConfig.enabled && !haikuConfig.enabled)}
            >
              {runStatus === "paused" ? "再開" : "レースを開始"}
            </button>
          )}
          <button type="button" className={styles.secondaryButton} onClick={reset}>リセット</button>
        </div>
        <div className={styles.speedControl}>
          <span>再生速度</span>
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
            ? "API設定を確認中です…"
            : jevConfig.enabled && haikuConfig.enabled
              ? "開始すると毎手JevとClaude Haiku 4.5の実APIを呼び出します。API料金が発生します。"
              : jevConfig.enabled
                ? "Jevの実APIを単独で呼び出します。比較にはANTHROPIC_API_KEYも設定してください。"
                : haikuConfig.enabled
                  ? "Haikuの実APIを単独で呼び出します。比較にはJev用APIキーも設定してください。"
                  : "APIキーが未設定です。.env.localを作成してサーバーを再起動してください。"}
        </p>
      </section>

      <section className={styles.raceGrid}>
        <PlayerCard
          title={jevConfig?.model ? `${jevConfig.model} API` : "Jev API"}
          kind="jev"
          state={jev}
          elapsed={elapsed.jev}
          unavailable={jevConfig?.enabled === false}
        />
        <PlayerCard
          title={haikuConfig?.model ? `${haikuConfig.model} API` : "Claude Haiku 4.5 API"}
          kind="haiku"
          state={haiku}
          elapsed={elapsed.haiku}
          unavailable={haikuConfig?.enabled === false}
        />
      </section>

      <section className={styles.dataPanel}>
        <div className={styles.dataCopy}>
          <p>MODEL INPUT / OUTPUT</p>
          <h2>APIへ渡す候補配列</h2>
          <p>
            ゲーム側が合法手を列挙し、配置・ライン消去後の盤面を最大12個に絞ります。
            {jevConfig?.enabled && haikuConfig?.enabled
              ? "両モデルは盤面文字列を比較し、候補IDを返します。Jevでは全候補を1つのChoice質問として評価します。"
              : jevConfig?.enabled
                ? "Jevが全候補を1つのChoice質問として評価し、候補IDを返します。"
                : "Haikuが盤面文字列を比較し、候補IDを返します。"}
          </p>
          <div className={styles.pipeline}>
            <span>盤面</span><i>→</i><span>合法手</span><i>→</i><span>最大12候補</span><i>→</i><b>choice ID</b>
          </div>
        </div>
        <pre aria-live="polite"><code>{JSON.stringify(payload, null, 2)}</code></pre>
      </section>

      <footer className={styles.disclaimer}>
        <strong>DEMO NOTE</strong>
        <p>
          {jevConfig?.enabled && haikuConfig?.enabled
            ? "Haiku側はAnthropic API、Jev側はTypeSafe AI APIの実応答です。同じ合法手候補から各モデルが選んだ配置を反映します。"
            : jevConfig?.enabled
              ? "現在はJevの実応答による単独モードです。Haiku側はAnthropic APIキー未設定のため実行しません。"
              : haikuConfig?.enabled
                ? "現在はAnthropic APIの実応答によるHaiku単独モードです。Jev側はGatewayまたはTypeSafeのAPIキー未設定のため実行しません。"
                : "APIキーを設定すると、実モデルが選んだ配置を盤面へ反映します。"}
        </p>
      </footer>
    </main>
  );
}
