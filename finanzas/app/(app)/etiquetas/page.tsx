import { redirect } from "next/navigation";

// Las etiquetas se quitaron de la app; las suscripciones se manejan con la categoría "Suscripciones".
export default function EtiquetasPage() {
  redirect("/movimientos");
}
