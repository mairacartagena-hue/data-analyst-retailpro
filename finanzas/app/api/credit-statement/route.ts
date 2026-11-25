import { NextResponse, type NextRequest } from "next/server";
import { requireApiMember } from "@/lib/supabase/server";
import { readCreditStatement } from "@/lib/capture/creditStatementGemini";
import { readCreditStatementLocal, type LocalCreditRead } from "@/lib/capture/creditStatementLocal";
import { LockedPdfError } from "@/lib/capture/cardStatementLocal";

// Importar el extracto de un crédito y llenar el formulario para revisarlo. Un PDF de una entidad conocida (Addi) se lee directo,
// sin IA; si es otra entidad, una foto, o la lectura no cuadra con los totales del propio extracto, lo lee Gemini.
export const runtime = "nodejs";
export const maxDuration = 60;

const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_BASE64 = 4_200_000; // ~3 MB: Vercel acepta hasta 4,5 MB por solicitud

export async function POST(req: NextRequest) {
  const { denied } = await requireApiMember();
  if (denied) return NextResponse.json({ ok: false, error: denied.error }, { status: denied.status });
  const body = (await req.json().catch(() => null)) as { data?: unknown; mime?: unknown; engine?: unknown } | null;
  const mime = typeof body?.mime === "string" ? body.mime : "";
  const data = typeof body?.data === "string" ? body.data : "";
  if (!TYPES.includes(mime)) return NextResponse.json({ ok: false, error: "Sube el extracto en PDF o una foto (JPG o PNG)." }, { status: 400 });
  if (!data) return NextResponse.json({ ok: false, error: "Falta el archivo" }, { status: 400 });
  if (data.length > MAX_BASE64) return NextResponse.json({ ok: false, error: "El archivo es muy pesado (máximo ~3 MB)." }, { status: 413 });
  // engine "ai": la persona pidió leerlo con la IA (p. ej. el saldo a capital, que el extracto de Addi no imprime)
  let local: LocalCreditRead | null = null;
  try {
    if (body?.engine !== "ai") local = await readCreditStatementLocal({ data, mime });
  } catch (e) {
    if (e instanceof LockedPdfError) return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
    throw e;
  }
  if (local) return NextResponse.json({ ok: true, source: "local", institution: local.institution, result: local.statement });
  try {
    return NextResponse.json({ ok: true, source: "gemini", result: await readCreditStatement({ data, mime }) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
