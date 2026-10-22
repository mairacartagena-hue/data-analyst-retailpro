"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, CalendarDays, ListChecks, ShoppingBasket, Sun } from "lucide-react";

const TABS = [
  { href: "/", label: "Hoy", Icon: Sun },
  { href: "/tareas", label: "Tareas", Icon: ListChecks },
  { href: "/compras", label: "Compras", Icon: ShoppingBasket },
  { href: "/semana", label: "Semana", Icon: CalendarDays },
  { href: "/recordar", label: "Recordar", Icon: Bell },
];

export function BottomNav() {
  const path = usePathname();
  const activo = (href: string) =>
    href === "/" ? path === "/" || path === "/ajustes" : path.startsWith(href) || (href === "/recordar" && path.startsWith("/mascotas"));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t-[3px] border-vino bg-crema pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-md justify-between px-2 py-2">
        {TABS.map(({ href, label, Icon }) => {
          const on = activo(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={`mx-auto flex w-[62px] flex-col items-center gap-0.5 rounded-[14px] py-1.5 text-[11px] font-semibold ${
                  on ? "bg-accion text-crema" : "text-vino"
                }`}
              >
                <Icon size={22} strokeWidth={2.2} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
