// Saldo Seguro para Gastar (individual, en COP):
//   Saldo real en cuentas de depósito y billeteras
// − Obligaciones del hogar pendientes del usuario
// − Ahorros programados pendientes del usuario
// − Deuda pendiente de sus tarjetas de crédito
// − Lo que le debe a su pareja (lo que la pareja le debe NO suma)
// − Plata recibida de un tercero que aún no se ha pagado (lo que el tercero debe NO suma)

/** LOAN: préstamo de alguien (familia, un banco) que se paga con transferencias a la cuenta. */
export type AccountKind = "DEPOSIT" | "WALLET" | "CASH" | "CREDIT_CARD" | "LOAN" | "CREDIT";

export interface BalanceAccount {
  ownerUserId: string;
  kind: AccountKind;
  balance: number; // en tarjetas, negativo = deuda
}

export interface SafeToSpendInput {
  realBalance: number;
  householdObligationsPending: number;
  scheduledSavingsPending: number;
  creditCardDebt: number;
  owedToPartner: number;
  heldForThirdParty?: number;
}

export interface SafeToSpendResult extends SafeToSpendInput {
  heldForThirdParty: number;
  total: number;
}

const CASH_LIKE: AccountKind[] = ["DEPOSIT", "WALLET", "CASH"];

/** Suma de cuentas de depósito, billeteras y efectivo. Las tarjetas no suman. */
export function realBalanceOf(userId: string, accounts: BalanceAccount[]): number {
  return accounts
    .filter((a) => a.ownerUserId === userId && CASH_LIKE.includes(a.kind))
    .reduce((s, a) => s + a.balance, 0);
}

/** Deuda pendiente de las tarjetas y préstamos del usuario. Un saldo a favor no suma. */
export function creditCardDebtOf(userId: string, accounts: BalanceAccount[]): number {
  return accounts
    .filter((a) => a.ownerUserId === userId && (a.kind === "CREDIT_CARD" || a.kind === "LOAN"))
    .reduce((s, a) => s + Math.max(0, -a.balance), 0);
}

export function computeSafeToSpend(input: SafeToSpendInput): SafeToSpendResult {
  const parts = {
    realBalance: input.realBalance,
    householdObligationsPending: Math.max(0, input.householdObligationsPending),
    scheduledSavingsPending: Math.max(0, input.scheduledSavingsPending),
    creditCardDebt: Math.max(0, input.creditCardDebt),
    owedToPartner: Math.max(0, input.owedToPartner),
    heldForThirdParty: Math.max(0, input.heldForThirdParty ?? 0),
  };
  return {
    ...parts,
    total:
      parts.realBalance -
      parts.householdObligationsPending -
      parts.scheduledSavingsPending -
      parts.creditCardDebt -
      parts.owedToPartner -
      parts.heldForThirdParty,
  };
}
