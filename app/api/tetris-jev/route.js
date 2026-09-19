import { handleTetrisJevRequest } from "../../../lib/tetris-jev.mjs";

export const runtime = "nodejs";

function serverEnv() {
  const configured = Boolean(process.env.AI_GATEWAY_API_KEY || process.env.TYPESAFE_API_KEY);
  return {
    ...process.env,
    TETRIS_JEV_ENABLED: process.env.TETRIS_JEV_ENABLED ?? String(configured),
  };
}

export function GET(request) {
  return handleTetrisJevRequest(request, serverEnv());
}

export function POST(request) {
  return handleTetrisJevRequest(request, serverEnv());
}
