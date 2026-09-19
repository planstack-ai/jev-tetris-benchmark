import { handleTetrisHaikuRequest } from "../../../lib/tetris-haiku.mjs";

export const runtime = "nodejs";

function serverEnv() {
  const configured = Boolean(process.env.ANTHROPIC_API_KEY);
  return {
    ...process.env,
    TETRIS_HAIKU_ENABLED: process.env.TETRIS_HAIKU_ENABLED ?? String(configured),
  };
}

export function GET(request) {
  return handleTetrisHaikuRequest(request, serverEnv());
}

export function POST(request) {
  return handleTetrisHaikuRequest(request, serverEnv());
}
