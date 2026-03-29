"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const TooltipTouchContext = React.createContext<{
  open: boolean
  onOpenChange: (open: boolean) => void
}>({ open: false, onOpenChange: () => {} })

function Tooltip({
  open: controlledOpen,
  onOpenChange: controlledOnChange,
  delayDuration,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? controlledOnChange! : setInternalOpen

  const contextValue = React.useMemo(
    () => ({ open, onOpenChange: setOpen }),
    [open, setOpen]
  )

  return (
    <TooltipTouchContext.Provider value={contextValue}>
      <TooltipPrimitive.Root
        open={open}
        onOpenChange={setOpen}
        delayDuration={delayDuration}
        {...props}
      >
        {children}
      </TooltipPrimitive.Root>
    </TooltipTouchContext.Provider>
  )
}

const TooltipTrigger = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>
>(({ onClick, ...props }, ref) => {
  const { open, onOpenChange } = React.useContext(TooltipTouchContext)

  return (
    <TooltipPrimitive.Trigger
      ref={ref}
      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
        if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
          const target = e.currentTarget as HTMLElement
          const isLink = target.tagName === "A" || target.closest("a")
          if (!isLink) {
            e.preventDefault()
          }
          onOpenChange(!open)
        }
        onClick?.(e)
      }}
      {...props}
    />
  )
})
TooltipTrigger.displayName = "TooltipTrigger"

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Content
    ref={ref}
    sideOffset={sideOffset}
    className={cn(
      "z-50 overflow-hidden rounded-md border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-tooltip-content-transform-origin]",
      className
    )}
    {...props}
  />
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
