import { redirect } from "next/navigation";

// Las etiquetas se manejan desde Movimientos → Etiquetas; esta ruta vieja lleva allá.
export default function EtiquetasPage() {
  redirect("/movimientos");
}
