import * as React from "react"
import { cn } from "@/lib/utils"

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
type ButtonSize = "default" | "sm" | "lg" | "icon"

const variantClasses: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
  destructive: "bg-destructive text-white shadow-xs hover:bg-destructive/90",
  outline: "border border-border bg-background shadow-xs hover:bg-secondary hover:text-secondary-foreground",
  secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
  ghost: "hover:bg-secondary hover:text-secondary-foreground",
  link: "text-primary underline-offset-4 hover:underline",
}

const sizeClasses: Record<ButtonSize, string> = {
  default: "h-9 px-4 py-2 text-sm",
  sm: "h-8 gap-1.5 px-3 text-xs",
  lg: "h-10 px-6 text-base",
  icon: "size-9",
}

interface ButtonProps extends React.ComponentProps<"button"> {
  variant?: ButtonVariant
  size?: ButtonSize
}

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      data-slot="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  )
}

export { Button }
export type { ButtonProps, ButtonVariant, ButtonSize }
