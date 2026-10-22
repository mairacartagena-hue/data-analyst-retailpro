import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[20px] bg-accion">
          <span className="titulo text-[30px] text-rosa-claro">AM</span>
        </div>
        <h1 className="titulo text-[56px]">A Medias</h1>
        <p className="mt-2 text-[15px] text-sec">Las tareas de la casa, las compras y las mascotas, a medias entre los dos.</p>
      </div>
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
