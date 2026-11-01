import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex max-w-full items-center justify-center gap-2 text-center leading-tight rounded-2xl font-semibold transition-[transform,background-color,opacity] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-olive [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-olive text-on-olive hover:opacity-95",
        secondary: "bg-surface-2 text-text hover:bg-border",
        outline: "border border-border bg-surface text-text hover:bg-surface-2",
        ghost: "text-text hover:bg-surface-2",
        danger: "bg-danger-soft text-danger hover:opacity-90",
      },
      size: {
        sm: "min-h-9 px-3 py-1.5 text-sm",
        md: "min-h-12 px-5 py-2 text-[15px]",
        lg: "min-h-14 px-6 py-2.5 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

export { buttonVariants };
