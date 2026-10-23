import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 select-none",
  {
    variants: {
      variant: {
        default: "bg-ink-3 text-fg hover:bg-line-strong border border-line",
        ghost: "text-fg-soft hover:text-fg hover:bg-ink-2",
        outline: "border border-line text-fg-soft hover:text-fg hover:border-line-strong",
        buy: "bg-buy text-ink-0 hover:brightness-110",
        sell: "bg-sell text-ink-0 hover:brightness-110",
        signal: "bg-signal text-ink-0 hover:brightness-110",
        quiet: "text-muted hover:text-fg",
      },
      size: {
        xs: "h-6 px-2 text-2xs rounded-sm",
        sm: "h-7 px-2.5 text-xs rounded",
        md: "h-8 px-3 text-[13px] rounded",
        lg: "h-10 px-4 text-sm rounded-md",
        icon: "h-7 w-7 rounded",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, type = "button", ...props }, ref) => (
  <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
