import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "h-8 w-full rounded border border-line bg-ink-0 px-2.5 text-[13px] text-fg placeholder:text-muted/70 focus:border-signal/60 focus:outline-none num",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "w-full resize-none rounded border border-line bg-ink-0 px-2.5 py-2 text-[13px] leading-relaxed text-fg placeholder:text-muted/70 focus:border-signal/60 focus:outline-none",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="flex items-baseline justify-between text-2xs text-muted">
        <span>{label}</span>
        {hint && <span className="text-muted/70">{hint}</span>}
      </label>
      {children}
    </div>
  );
}
