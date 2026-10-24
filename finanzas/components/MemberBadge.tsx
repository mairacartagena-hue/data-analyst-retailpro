import type { Member } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Círculo con el color y el avatar (emoji o inicial) de cada miembro. */
export function MemberBadge({ member, size = 28, className }: { member: Member | null; size?: number; className?: string }) {
  if (!member) {
    return (
      <span className={cn("inline-flex items-center justify-center rounded-full bg-household text-[11px] font-bold text-on-olive", className)}
        style={{ width: size, height: size }} title="Hogar">
        H
      </span>
    );
  }
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, background: member.color, fontSize: size * 0.45 }}
      title={member.display_name}
    >
      {member.avatar || member.display_name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

export function HouseholdBadge({ size = 28 }: { size?: number }) {
  return <MemberBadge member={null} size={size} />;
}
