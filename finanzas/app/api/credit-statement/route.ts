import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readCreditStatement } from "@/lib/capture/creditStatementGemini";

// Importar el extracto de un crédito: Gemini lo lee y la app llena el formulario para revisarlo.
export const runtime = "nodejs";
export const maxDuration = 60;

const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BASE64 = 4_200_000; // ~3 MB: Vercel acepta hasta 4,5 MB por solicitud

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ ok: false, error: "Inicia sesión" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { data?: unknown; mime?: unknown } | null;
  const mime = typeof body?.mime === "string" ? body.mime : "";
  const data = typeof body?.data === "string" ? body.data : "";
  if (!TYPES.includes(mime)) return NextResponse.json({ ok: false, error: "Sube el extracto en PDF o una foto (JPG o PNG)." }, { status: 400 });
  if (!data) return NextResponse.json({ ok: false, error: "Falta el archivo" }, { status: 400 });
  if (data.length > MAX_BASE64) return NextResponse.json({ ok: false, error: "El archivo es muy pesado (máximo ~3 MB)." }, { status: 413 });
  try {
    return NextResponse.json({ ok: true, result: await readCreditStatement({ data, mime }) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
