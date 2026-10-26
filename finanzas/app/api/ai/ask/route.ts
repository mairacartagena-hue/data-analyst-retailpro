import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { askGemini, type ChatTurn } from "@/lib/ai/gemini";

// Asistente: la app envía la pregunta, el historial corto y el resumen de los datos que la persona puede ver.
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CONTEXT = 120_000;

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "Inicia sesión" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const context = typeof body?.context === "string" ? body.context.slice(0, MAX_CONTEXT) : "";
  if (!question) return NextResponse.json({ ok: false, error: "Escribe una pregunta" }, { status: 400 });
  const history: ChatTurn[] = Array.isArray(body?.history)
    ? (body.history as unknown[])
        .filter((t): t is ChatTurn => !!t && typeof t === "object" && ((t as ChatTurn).role === "user" || (t as ChatTurn).role === "model") && typeof (t as ChatTurn).text === "string")
        .slice(-8)
    : [];

  try {
    const answer = await askGemini(question, context, history);
    return NextResponse.json({ ok: true, answer });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
