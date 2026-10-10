import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "../lib/cn"

export interface CheckboxProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, ...props }, ref) => {
    return (
      <div className="relative">
        <input
          type="checkbox"
          className="sr-only"
          ref={ref}
          checked={checked}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          {...props}
        />
        <div
          className={cn(
            "h-4 w-4 rounded border border-gray-300 bg-white flex items-center justify-center transition-colors",
            checked && "bg-blue-600 border-blue-600",
            props.disabled && "opacity-50 cursor-not-allowed",
            !props.disabled && "cursor-pointer hover:border-blue-500",
            className
          )}
          onClick={() => {
            if (!props.disabled && onCheckedChange) {
              onCheckedChange(!checked)
            }
          }}
        >
          {checked && (
            <Check className="h-3 w-3 text-white" />
          )}
        </div>
      </div>
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox } 