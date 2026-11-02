"use client";

// Contactos fuera del hogar: saldos por cobrar o por pagar con personas que no son la pareja.
// Si el contacto usa la app (en otro hogar), se vinculan con un código y los dos ven el mismo saldo.

import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, HandCoins, KeyRound, Link2, Link2Off, Pencil, Plus, Share2, Trash2, Undo2, UserRound } from "lucide-react";
import { useFinance } from "@/lib/data/FinanceProvider";
import { useShell } from "@/components/AppShell";
import { AmountInput } from "@/components/AmountInput";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/card";
import { ErrorText, Field, Input } from "@/components/ui/input";
import { ChipGroup, Segmented } from "@/components/ui/segmented";
import { Sheet } from "@/components/ui/sheet";
import { contactSummaries, contactTotals, type ContactRow, type ContactSummary } from "@/lib/finance/contacts";
import { accountLabel } from "@/lib/finance/labels";
import { formatCop, parseCop } from "@/lib/finance/money";
import { formatDay, todayBogota } from "@/lib/finance/periods";
import type { ContactEntryKind } from "@/lib/types";
import { cn, errMsg } from "@/lib/utils";

const KIND_LABEL: Record<ContactEntryKind, string> = {
  SPLIT: "Parte de una compra",
  LOAN: "Préstamo",
  ERRAND: "Encargo",
  PAYMENT: "Pago",
  FORGIVEN: "Deuda condonada",
};

const LINK_PARAM = "vincular";

/** Mis cuentas donde puede entrar o salir un pago. */
function useCashAccounts() {
  const { accounts, me } = useFinance();
  return accounts.filter((a) => a.owner_user_id === me.user_id && !a.archived && !["CREDIT_CARD", "LOAN", "CREDIT"].includes(a.kind));
}

export function ContactsSection() {
  const { contacts, contactLedger, me } = useFinance();
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  // Enlace compartido: /cuentas?vista=cruce&vincular=CODIGO abre la vinculación con el código puesto
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get(LINK_PARAM);
    if (c) setCode(c);
  }, []);

  const all = contactSummaries(contacts, contactLedger, me.user_id, true);
  const visible = all.filter((s) => showArchived || !s.contact.archived || s.net !== 0);
  const hiddenCount = all.length - visible.length;
  const totals = contactTotals(all);
  const open = all.find((s) => s.contact.id === openId) ?? null;

  return (
    <div>
      <SectionTitle>Contactos</SectionTitle>
      <p className="-mt-1 mb-3 px-1 text-xs text-muted">
        Personas fuera del hogar: lo que te deben o les debes. Si usan la app, pueden vincularse y ver el mismo saldo.
      </p>
      {(totals.owedToMe > 0 || totals.iOwe > 0) && (
        <div className="mb-3 grid grid-cols-2 gap-3">
          <Card className="p-3 text-center">
            <p className="text-xs text-muted">Te deben</p>
            <p className="num font-display text-xl text-olive">{formatCop(totals.owedToMe)}</p>
          </Card>
          <Card className="p-3 text-center">
            <p className="text-xs text-muted">Debes</p>
            <p className={cn("num font-display text-xl", totals.iOwe > 0 && "text-danger")}>{formatCop(totals.iOwe)}</p>
          </Card>
        </div>
      )}

      {visible.length > 0 && (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {visible.map((s) => (
            <button key={s.contact.id} className="flex w-full items-center gap-3 px-3.5 py-3 text-left" onClick={() => setOpenId(s.contact.id)}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-muted"><UserRound size={16} /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate font-medium">
                  {s.contact.name}
                  {s.contact.linked_user_id && <Link2 size={14} className="shrink-0 text-olive" aria-label="Vinculado" />}
                  {s.contact.archived && <Archive size={14} className="shrink-0 text-muted" aria-label="Archivado" />}
                </span>
                <span className="block text-xs text-muted">
                  {s.net === 0 ? "A paz y salvo" : s.net > 0 ? "Te debe" : "Le debes"}
                </span>
              </span>
              {s.net !== 0 && (
                <span className={cn("num shrink-0 font-semibold", s.net > 0 ? "text-olive" : "text-danger")}>{formatCop(Math.abs(s.net))}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {all.length === 0 && (
        <p className="px-1 text-sm text-muted">Aún no tienes contactos. Agrega uno para anotar préstamos o dividir una compra con alguien de fuera del hogar.</p>
      )}
      {hiddenCount > 0 && (
        <button className="mt-2 px-1 text-xs text-muted underline" onClick={() => setShowArchived(true)}>
          Ver {hiddenCount === 1 ? "1 archivado" : `${hiddenCount} archivados`}
        </button>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={() => setNewOpen(true)}><Plus size={18} /> Nuevo contacto</Button>
        <Button variant="outline" onClick={() => setCode("")}><KeyRound size={18} /> Tengo un código</Button>
      </div>

      <NewContactSheet open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => setOpenId(id)} />
      {open && <ContactSheet summary={open} onClose={() => setOpenId(null)} />}
      <LinkCodeSheet code={code} onClose={() => {
        setCode(null);
        // Quita el código del enlace para que no se vuelva a abrir
        const url = new URL(window.location.href);
        if (url.searchParams.has(LINK_PARAM)) {
          url.searchParams.delete(LINK_PARAM);
          window.history.replaceState(null, "", url.toString());
        }
      }} onLinked={(id) => setOpenId(id)} />
    </div>
  );
}

function NewContactSheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const { supabase, reload } = useFinance();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setName(""); setError(null); }
  }, [open]);

  async function save() {
    if (!name.trim()) return setError("Escribe el nombre.");
    setBusy(true);
    const { data, error } = await supabase.rpc("save_contact", { p: { name } });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    await reload();
    onCreated(data as string);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Nuevo contacto"
      description="Alguien fuera del hogar con quien llevas cuentas. Solo lo ves tú."
      footer={<div className="space-y-2"><ErrorText>{error}</ErrorText><Button size="lg" className="w-full" disabled={busy} onClick={save}>{busy ? "Guardando..." : "Guardar"}</Button></div>}>
      <div className="pb-2">
        <Field label="Nombre" htmlFor="contact-name">
          <Input id="contact-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Ej. Juan, mamá, oficina…" />
        </Field>
      </div>
    </Sheet>
  );
}

type Action = "ENTRY" | "RECEIVED" | "PAID" | "FORGIVEN" | null;

function ContactSheet({ summary, onClose }: { summary: ContactSummary; onClose: () => void }) {
  const { supabase, reload, transactions } = useFinance();
  const { openTransaction } = useShell();
  const { contact, rows, net } = summary;
  const linked = !!contact.linked_user_id;
  const [action, setAction] = useState<Action>(null);
  const [receiving, setReceiving] = useState<ContactRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(contact.name);
  const [linkCode, setLinkCode] = useState<string | null>(contact.link_code);
  const [error, setError] = useState<string | null>(null);

  async function run(p: PromiseLike<{ error: unknown }>) {
    setError(null);
    const { error } = await p;
    if (error) setError(errMsg(error));
    else void reload();
    return !error;
  }

  async function rename() {
    if (await run(supabase.rpc("save_contact", { p: { id: contact.id, name, archived: contact.archived } }))) setEditing(false);
  }

  async function toggleArchive() {
    await run(supabase.rpc("save_contact", { p: { id: contact.id, name: contact.name, archived: !contact.archived } }));
  }

  async function remove() {
    if (!confirm(`¿Borrar a ${contact.name}?`)) return;
    if (await run(supabase.rpc("delete_contact", { p_id: contact.id }))) onClose();
  }

  async function shareCode() {
    setError(null);
    let code = linkCode;
    if (!code) {
      const { data, error } = await supabase.rpc("contact_link_code", { p_contact: contact.id });
      if (error) return setError(errMsg(error));
      code = data as string;
      setLinkCode(code);
    }
    const url = `${window.location.origin}/cuentas?vista=cruce&${LINK_PARAM}=${code}`;
    const text = `Vinculemos nuestras cuentas en Finanzas en Pareja para ver el mismo saldo. Abre ${url} o, en Cuentas › Cruce › Contactos › Tengo un código, escribe: ${code}`;
    if (navigator.share) {
      try { await navigator.share({ title: "Finanzas en Pareja", text }); } catch {}
    } else {
      try { await navigator.clipboard.writeText(text); alert("Mensaje copiado"); } catch { alert(`Código: ${code}`); }
    }
  }

  async function unlink() {
    if (!confirm(`¿Desvincular a ${contact.name}? Cada uno vuelve a ver solo los asientos que anotó.`)) return;
    await run(supabase.rpc("unlink_contact", { p_contact: contact.id }));
  }

  async function removeEntry(id: string) {
    if (!confirm("¿Borrar este asiento?")) return;
    await run(supabase.rpc("delete_contact_entry", { p_id: id }));
  }

  async function undoPayment(txId: string) {
    if (!confirm("¿Deshacer este pago? Se borra el movimiento de tu cuenta y el saldo vuelve a quedar como antes.")) return;
    await run(supabase.rpc("delete_transaction", { p_id: txId }));
  }

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={contact.name}
      description={linked ? "Vinculado: los dos ven estos asientos." : "Solo lo ves tú."}>
      <div className="space-y-4 pb-2">
        <Card className="text-center">
          <p className={cn("num font-display text-3xl", net < 0 && "text-danger")}>
            {net === 0 ? "A paz y salvo" : net > 0 ? `Te debe ${formatCop(net)}` : `Le debes ${formatCop(-net)}`}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button variant="outline" size="sm" disabled={contact.archived} onClick={() => setAction("ENTRY")}><HandCoins size={16} /> Préstamo o encargo</Button>
            {net > 0 && !linked && <Button size="sm" onClick={() => setAction("RECEIVED")}>Me pagó</Button>}
            {net < 0 && <Button size="sm" onClick={() => setAction("PAID")}>Le pagué</Button>}
            {net > 0 && <Button variant="outline" size="sm" onClick={() => setAction("FORGIVEN")}>Condonar</Button>}
          </div>
          {net > 0 && linked && <p className="mt-2 text-xs text-muted">Cuando te pague, lo registra {contact.name} y aquí marcas en qué cuenta te entró.</p>}
          {!contact.archived && <p className="mt-2 text-xs text-muted">Para dividir una compra, elige a {contact.name} en «¿A quién le corresponde?» al registrar el gasto.</p>}
        </Card>

        <ErrorText>{error}</ErrorText>

        <div>
          <p className="mb-2 px-1 text-sm font-medium text-muted">Historial</p>
          {rows.length === 0 ? (
            <p className="px-1 text-sm text-muted">Aún no hay asientos.</p>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {rows.map((r) => {
                const tx = r.mine && r.transaction_id ? transactions.find((t) => t.id === r.transaction_id) : null;
                const deletable = r.mine && ["LOAN", "ERRAND", "FORGIVEN"].includes(r.kind);
                const undoable = r.mine && r.kind === "PAYMENT" && !!r.transaction_id;
                // Pago que anotó el contacto vinculado (me pagó): marco en qué cuenta entró
                const toReceive = !r.mine && r.kind === "PAYMENT" && !r.mineInFavor && !r.received_transaction_id;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-3.5 py-3">
                    <div className="min-w-0 flex-1">
                      <button className="block w-full text-left" disabled={!tx} onClick={() => tx && openTransaction(tx)}>
                        <span className="block truncate font-medium">{r.description || KIND_LABEL[r.kind]}</span>
                        <span className="block text-xs text-muted">
                          {KIND_LABEL[r.kind]} · {formatDay(r.occurred_on)}{linked ? ` · ${r.mine ? "lo anotaste tú" : `lo anotó ${contact.name}`}` : ""}
                          {!r.mine && r.kind === "PAYMENT" && r.received_transaction_id ? " · ya está en tu cuenta" : ""}
                        </span>
                      </button>
                      {toReceive && (
                        <Button size="sm" variant="secondary" className="mt-1.5" onClick={() => setReceiving(r)}>¿En qué cuenta te entró?</Button>
                      )}
                    </div>
                    <span className={cn("num shrink-0 font-semibold", r.mineInFavor ? "text-olive" : "text-danger")}>
                      {r.mineInFavor ? "+" : "−"}{formatCop(r.amount)}
                    </span>
                    {deletable && (
                      <button className="p-1 text-muted" onClick={() => removeEntry(r.id)} aria-label="Borrar asiento"><Trash2 size={16} /></button>
                    )}
                    {undoable && (
                      <button className="p-1 text-muted" onClick={() => undoPayment(r.transaction_id!)} aria-label="Deshacer el pago"><Undo2 size={16} /></button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-2 px-1 text-xs text-muted">Verde: a tu favor. Rojo: lo debes tú. Las compras se corrigen editando el movimiento.</p>
        </div>

        <div className="space-y-2 rounded-2xl border border-border p-3">
          <p className="text-sm font-medium">¿{contact.name} usa la app?</p>
          {linked ? (
            <>
              <p className="text-xs text-muted">Están vinculados: cada uno ve los asientos del otro, pero nada más de su hogar (ni cuentas ni movimientos).</p>
              <Button size="sm" variant="outline" onClick={unlink}><Link2Off size={16} /> Desvincular</Button>
            </>
          ) : (
            <>
              <p className="text-xs text-muted">
                Si tiene su propio hogar en la app, compártele un código. Al usarlo, los dos verán el mismo saldo; los asientos que ya anotaste aquí también los verá.
              </p>
              {linkCode && <p className="num text-center font-display text-2xl tracking-widest">{linkCode}</p>}
              <Button size="sm" variant="outline" onClick={shareCode}><Share2 size={16} /> {linkCode ? "Compartir el código" : "Crear código para vincular"}</Button>
            </>
          )}
        </div>

        <div className="space-y-2">
          {editing ? (
            <div className="flex gap-2">
              <Input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Nombre" />
              <Button size="sm" onClick={rename}>Guardar</Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Pencil size={16} /> Renombrar</Button>
              <Button size="sm" variant="ghost" onClick={toggleArchive}>
                {contact.archived ? <><ArchiveRestore size={16} /> Desarchivar</> : <><Archive size={16} /> Archivar</>}
              </Button>
              {rows.length === 0 && !linked && <Button size="sm" variant="ghost" onClick={remove}><Trash2 size={16} /> Borrar</Button>}
            </div>
          )}
        </div>
      </div>

      <ContactEntrySheet open={action === "ENTRY"} onOpenChange={(v) => !v && setAction(null)} contactId={contact.id} name={contact.name} />
      {(action === "RECEIVED" || action === "PAID" || action === "FORGIVEN") && (
        <SettleContactSheet mode={action} contactId={contact.id} name={contact.name} max={Math.abs(net)} onClose={() => setAction(null)} />
      )}
      {receiving && <ReceivePaymentSheet entry={receiving} name={contact.name} onClose={() => setReceiving(null)} />}
    </Sheet>
  );
}

function ContactEntrySheet({ open, onOpenChange, contactId, name }: { open: boolean; onOpenChange: (v: boolean) => void; contactId: string; name: string }) {
  const { supabase, reload } = useFinance();
  const [kind, setKind] = useState<"LOAN" | "ERRAND">("LOAN");
  const [direction, setDirection] = useState<"they_owe" | "i_owe">("they_owe");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayBogota());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) { setAmount(""); setDescription(""); setDate(todayBogota()); setError(null); }
  }, [open]);

  async function save() {
    const n = parseCop(amount) ?? 0;
    if (n <= 0) return setError("Escribe el monto.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("add_contact_entry", {
      p: { contact_id: contactId, kind, in_favor: direction === "they_owe", amount: n, description, occurred_on: date },
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onOpenChange(false);
    void reload();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Préstamo o encargo"
      description="Solo queda anotado: no mueve plata de tus cuentas."
      footer={<div className="space-y-2"><ErrorText>{error}</ErrorText><Button size="lg" className="w-full" disabled={busy} onClick={save}>{busy ? "Guardando..." : "Guardar"}</Button></div>}>
      <div className="space-y-4 pb-2">
        <Segmented value={kind} onChange={setKind} options={[{ value: "LOAN", label: "Préstamo" }, { value: "ERRAND", label: "Encargo" }]} />
        <Segmented value={direction} onChange={setDirection} options={[
          { value: "they_owe", label: `${name} me debe` },
          { value: "i_owe", label: `Le debo a ${name}` },
        ]} />
        <AmountInput large value={amount} onChange={setAmount} />
        <Field label="Concepto" htmlFor="contact-entry-desc">
          <Input id="contact-entry-desc" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder={kind === "LOAN" ? "Te presté para…" : "Me trajiste… / te compré…"} />
        </Field>
        <Field label="Fecha" htmlFor="contact-entry-date"><Input id="contact-entry-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

function SettleContactSheet({ mode, contactId, name, max, onClose }: { mode: "RECEIVED" | "PAID" | "FORGIVEN"; contactId: string; name: string; max: number; onClose: () => void }) {
  const { supabase, reload, labels } = useFinance();
  const cash = useCashAccounts();
  const [amount, setAmount] = useState(String(max));
  const [account, setAccount] = useState(cash[0]?.id ?? "");
  const [date, setDate] = useState(todayBogota());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const n = parseCop(amount) ?? 0;
  const moves = mode !== "FORGIVEN";

  async function save() {
    if (n <= 0) return setError("Escribe el monto.");
    if (n > max) return setError(`El saldo es de ${formatCop(max)}.`);
    if (moves && !account) return setError("Elige la cuenta.");
    setBusy(true);
    setError(null);
    const { error } = await supabase.rpc("settle_contact", {
      p: { contact_id: contactId, mode, amount: n, occurred_on: date, account_id: moves ? account : null },
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onClose();
    void reload();
  }

  const title = mode === "RECEIVED" ? `${name} me pagó` : mode === "PAID" ? `Le pagué a ${name}` : "Condonar la deuda";
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={title} description={`Saldo: ${formatCop(max)}`}
      footer={<div className="space-y-2"><ErrorText>{error}</ErrorText><Button size="lg" className="w-full" disabled={busy} onClick={save}>
        {busy ? "Guardando..." : `${mode === "FORGIVEN" ? "Condonar" : "Registrar"} ${formatCop(n)}`}
      </Button></div>}>
      <div className="space-y-4 pb-2">
        <AmountInput large value={amount} onChange={setAmount} />
        <p className="-mt-2 text-xs text-muted">Puede ser solo una parte; el resto queda pendiente.</p>
        {moves ? (
          <>
            <Field label={mode === "RECEIVED" ? "Entró a" : "Salió de"}>
              <ChipGroup value={account} onChange={setAccount} options={cash.map((a) => ({ value: a.id, label: accountLabel(labels, a.id) }))} />
            </Field>
            <p className="rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">
              {mode === "RECEIVED" ? "Sube el saldo de tu cuenta y baja la deuda. No cuenta como ingreso." : "Baja el saldo de tu cuenta y lo que le debes. No cuenta como gasto."}
            </p>
          </>
        ) : (
          <p className="rounded-2xl bg-wood-soft px-3 py-2 text-sm">Solo se quita del saldo: no se mueve plata. Si te arrepientes, puedes borrarlo desde el historial.</p>
        )}
        <Field label="Fecha" htmlFor="contact-settle-date"><Input id="contact-settle-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      </div>
    </Sheet>
  );
}

function ReceivePaymentSheet({ entry, name, onClose }: { entry: ContactRow; name: string; onClose: () => void }) {
  const { supabase, reload, labels } = useFinance();
  const cash = useCashAccounts();
  const [account, setAccount] = useState(cash[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!account) return setError("Elige la cuenta.");
    setBusy(true);
    const { error } = await supabase.rpc("receive_contact_payment", { p: { entry_id: entry.id, account_id: account } });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onClose();
    void reload();
  }

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={`Pago de ${name}`} description={`${formatCop(entry.amount)} · ${formatDay(entry.occurred_on)}`}
      footer={<div className="space-y-2"><ErrorText>{error}</ErrorText><Button size="lg" className="w-full" disabled={busy} onClick={save}>{busy ? "Guardando..." : "Guardar"}</Button></div>}>
      <div className="space-y-4 pb-2">
        <Field label="Entró a">
          <ChipGroup value={account} onChange={setAccount} options={cash.map((a) => ({ value: a.id, label: accountLabel(labels, a.id) }))} />
        </Field>
        <p className="rounded-2xl bg-surface-2 px-3 py-2 text-xs text-muted">Sube el saldo de tu cuenta. No cuenta como ingreso: el saldo con {name} ya se bajó cuando registró el pago.</p>
      </div>
    </Sheet>
  );
}

/** Escribir el código que compartió alguien de otro hogar. */
function LinkCodeSheet({ code, onClose, onLinked }: { code: string | null; onClose: () => void; onLinked: (id: string) => void }) {
  const { supabase, reload, contacts, me } = useFinance();
  const [value, setValue] = useState("");
  const [who, setWho] = useState<string | null>(null);
  const [target, setTarget] = useState<string>("NEW");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const unlinked = contacts.filter((c) => c.owner_user_id === me.user_id && !c.linked_user_id && !c.archived);

  useEffect(() => {
    if (code === null) return;
    setValue(code);
    setWho(null);
    setTarget("NEW");
    setName("");
    setError(null);
    if (code) void check(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function check(c = value) {
    setError(null);
    if (!c.trim()) return setError("Escribe el código.");
    setBusy(true);
    const { data, error } = await supabase.rpc("contact_link_preview", { p_code: c });
    setBusy(false);
    if (error) return setError(errMsg(error));
    if (!data) return setError("Ese código no existe o ya se usó.");
    setWho(data as string);
    setName(data as string);
  }

  async function link() {
    setBusy(true);
    setError(null);
    const { data, error } = await supabase.rpc("link_contact", {
      p: { code: value, contact_id: target === "NEW" ? null : target, name: target === "NEW" ? name : null },
    });
    setBusy(false);
    if (error) return setError(errMsg(error));
    onClose();
    await reload();
    onLinked(data as string);
  }

  return (
    <Sheet open={code !== null} onOpenChange={(v) => !v && onClose()} title="Vincular con un código"
      description="Para cruzar cuentas con alguien de otro hogar que usa la app."
      footer={<div className="space-y-2"><ErrorText>{error}</ErrorText>
        {who ? (
          <Button size="lg" className="w-full" disabled={busy} onClick={link}><Link2 size={18} /> {busy ? "Vinculando..." : `Vincular con ${who}`}</Button>
        ) : (
          <Button size="lg" className="w-full" disabled={busy} onClick={() => check()}>{busy ? "Buscando..." : "Continuar"}</Button>
        )}
      </div>}>
      <div className="space-y-4 pb-2">
        <Field label="Código" htmlFor="link-code">
          <Input id="link-code" value={value} autoCapitalize="characters" autoComplete="off"
            onChange={(e) => { setValue(e.target.value.toUpperCase()); setWho(null); }} placeholder="Ej. K7P2QX9MLA" />
        </Field>
        {who && (
          <>
            <p className="rounded-2xl bg-olive-soft px-3 py-2 text-sm">
              Lo compartió <strong>{who}</strong>. Al vincular, los dos verán los asientos que cada uno anote con el otro (no sus cuentas ni sus movimientos).
            </p>
            {unlinked.length > 0 && (
              <Field label="¿Ya lo tienes como contacto?">
                <ChipGroup value={target} onChange={setTarget} options={[
                  { value: "NEW", label: "No, crear uno" },
                  ...unlinked.map((c) => ({ value: c.id, label: c.name })),
                ]} />
              </Field>
            )}
            {target === "NEW" && (
              <Field label="Nombre para ti" htmlFor="link-name">
                <Input id="link-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              </Field>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
