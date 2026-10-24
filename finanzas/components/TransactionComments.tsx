"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { MemberBadge } from "@/components/MemberBadge";
import { Button } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/input";
import { errMsg } from "@/lib/utils";

interface Comment {
  id: string;
  author_id: string;
  body: string;
  created_at: string;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Comentarios de un movimiento. Los ve quien puede ver el movimiento; cada uno borra solo los suyos. */
export function TransactionComments({ txId }: { txId: string }) {
  const { supabase, me, memberById } = useFinance();
  const [comments, setComments] = useState<Comment[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("transaction_comments").select("id, author_id, body, created_at")
      .eq("transaction_id", txId).order("created_at", { ascending: true });
    if (error) setError(errMsg(error));
    else setComments((data ?? []) as Comment[]);
  }, [supabase, txId]);

  useEffect(() => {
    setComments([]);
    setText("");
    setError(null);
    void load();
    // Si la pareja comenta mientras tengo el movimiento abierto, aparece solo
    const channel = supabase.channel(`comments-${txId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "transaction_comments", filter: `transaction_id=eq.${txId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, txId, load]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    const { data: tx, error: txError } = await supabase.from("transactions").select("household_id").eq("id", txId).single();
    if (txError || !tx) {
      setBusy(false);
      return setError(errMsg(txError ?? "No se encontró el movimiento"));
    }
    const { error } = await supabase.from("transaction_comments").insert({ household_id: tx.household_id, transaction_id: txId, author_id: me.user_id, body });
    setBusy(false);
    if (error) return setError(errMsg(error));
    setText("");
    void load();
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar este comentario?")) return;
    const { error } = await supabase.from("transaction_comments").delete().eq("id", id);
    if (error) setError(errMsg(error));
    else void load();
  }

  return (
    <section className="space-y-2 border-t border-border pt-4" aria-label="Comentarios">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold"><MessageSquare size={15} /> Comentarios{comments.length > 0 ? ` (${comments.length})` : ""}</h3>
      {comments.length === 0 && <p className="text-sm text-muted">Sin comentarios. Anota para qué fue o cualquier detalle.</p>}
      <ul className="space-y-2">
        {comments.map((c) => {
          const mine = c.author_id === me.user_id;
          const author = memberById(c.author_id);
          return (
            <li key={c.id} className="rounded-2xl bg-surface-2 px-3 py-2 text-sm">
              <div className="flex items-center gap-2 text-xs text-muted">
                <MemberBadge member={author} size={16} />
                <span className="font-medium">{mine ? "Yo" : author?.display_name ?? "Pareja"}</span>
                <span>· {when(c.created_at)}</span>
                {mine && <button className="ml-auto p-1" onClick={() => remove(c.id)} aria-label="Borrar comentario"><Trash2 size={14} /></button>}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{c.body}</p>
            </li>
          );
        })}
      </ul>
      <div className="flex items-end gap-2">
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={2} aria-label="Escribir un comentario"
          placeholder="Escribe un comentario…"
          className="min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-surface px-3 py-2 text-[15px] outline-none focus:border-olive"
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }}
        />
        <Button size="icon" onClick={send} disabled={busy || !text.trim()} aria-label="Enviar comentario"><Send size={18} /></Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
