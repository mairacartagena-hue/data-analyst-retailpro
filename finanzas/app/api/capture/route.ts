import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { captureWithGemini, type CaptureContext } from "@/lib/capture/gemini";
import type { CaptureOption } from "@/lib/capture/phrase";

// Registro por voz o foto: Gemini propone los datos y la app llena el formulario para revisarlo.
export const runtime = "nodejs";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_IMAGE_BASE64 = 6_000_000; // ~4,5 MB

function options(v: unknown): CaptureOption[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((o): o is { id: string; name: string } => !!o && typeof o.id === "string" && typeof o.name === "string")
    .slice(0, 300)
    .map((o) => ({ id: o.id.slice(0, 64), name: o.name.slice(0, 80) }));
}

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "Inicia sesión" }, { status: 401 });
  if (!process.env.GEMINI_API_KEY) return NextResponse.json({ ok: false, error: "Gemini no está configurado" }, { status: 503 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Solicitud no válida" }, { status: 400 });

  const today = typeof body.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0, 10);
  const ctx: CaptureContext = { today, accounts: options(body.accounts), categories: options(body.categories), incomeCategories: options(body.incomeCategories) };

  let input: { text: string } | { image: string; mime: string };
  if (typeof body.image === "string" && body.image) {
    const mime = typeof body.mime === "string" ? body.mime : "image/jpeg";
    if (!IMAGE_TYPES.includes(mime)) return NextResponse.json({ ok: false, error: "Formato de imagen no soportado" }, { status: 400 });
    if (body.image.length > MAX_IMAGE_BASE64) return NextResponse.json({ ok: false, error: "La foto es muy pesada" }, { status: 413 });
    input = { image: body.image, mime };
  } else if (typeof body.text === "string" && body.text.trim()) {
    input = { text: body.text };
  } else {
    return NextResponse.json({ ok: false, error: "Falta la frase o la foto" }, { status: 400 });
  }

  try {
    const result = await captureWithGemini(input, ctx);
    return NextResponse.json({ ok: true, result: result ?? {} });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
