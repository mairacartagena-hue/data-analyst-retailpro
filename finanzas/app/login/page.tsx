import { Suspense } from "react";
import { LoginForm } from "./LoginForm";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8">
        <Logo size={64} />
        <h1 className="mt-5 font-display text-5xl leading-tight">Finanzas en Pareja</h1>
        <p className="mt-2 text-[15px] text-muted">Lo que cada uno puede gastar tranquilo, lo que le toca y lo que se deben.</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
