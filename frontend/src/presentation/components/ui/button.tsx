import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.99] active:opacity-100 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-100 disabled:saturate-75 disabled:brightness-95",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-primary via-blue-600 to-indigo-500 text-primary-foreground shadow-[0_14px_32px_-18px_rgba(37,99,235,0.75)] hover:-translate-y-0.5 hover:from-blue-600 hover:to-indigo-500 hover:shadow-[0_20px_38px_-18px_rgba(37,99,235,0.82)]",
        secondary:
          "bg-gradient-to-r from-secondary to-secondary/85 text-secondary-foreground shadow-[0_10px_24px_-18px_rgba(15,23,42,0.4)] hover:bg-secondary",
        outline:
          "border border-input bg-gradient-to-b from-card to-card/90 text-foreground shadow-[0_10px_24px_-20px_rgba(15,23,42,0.45)] hover:bg-muted/85",
        ghost: "bg-transparent text-foreground hover:bg-muted/70",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90"
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-6",
        icon: "h-10 w-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} data-variant={variant ?? "default"} className={cn(buttonVariants({ variant, size, className }))} {...props} />
));
Button.displayName = "Button";
