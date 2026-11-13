import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/util";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-navy-900 text-ivory hover:bg-navy-700",
        gold: "bg-gold-500 text-navy-950 hover:bg-gold-400",
        outline: "border border-navy-900/25 bg-transparent text-navy-900 hover:bg-navy-900/5",
        ghost: "text-navy-900 hover:bg-navy-900/5",
        danger: "bg-danger text-white hover:bg-danger/90",
        light: "bg-ivory text-navy-900 hover:bg-white",
      },
      size: { default: "h-11 px-6", sm: "h-9 px-4 text-xs", lg: "h-12 px-8 text-base", icon: "size-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";
