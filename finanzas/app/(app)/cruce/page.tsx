import { redirect } from "next/navigation";

// El cruce ahora vive en la pantalla Cuentas.
export default function CrucePage() {
  redirect("/cuentas?vista=cruce");
}
