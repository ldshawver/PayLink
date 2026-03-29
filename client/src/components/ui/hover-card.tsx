"use client"

import * as React from "react"
import * as HoverCardPrimitive from "@radix-ui/react-hover-card"

import { cn } from "@/lib/utils"

function HoverCard({
  open: controlledOpen,
  onOpenChange: controlledOnChange,
  openDelay = 200,
  closeDelay = 300,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Root>) {
  const [internalOpen, setInternalOpen] = React.useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const onOpenChange = isControlled ? controlledOnChange! : setInternalOpen

  const contextValue = React.useMemo(
    () => ({ open, onOpenChange }),
    [open, onOpenChange]
  )

  return (
    <HoverCardTouchContext.Provider value={contextValue}>
      <HoverCardPrimitive.Root
        open={open}
        onOpenChange={onOpenChange}
        openDelay={openDelay}
        closeDelay={closeDelay}
        {...props}
      >
        {children}
      </HoverCardPrimitive.Root>
    </HoverCardTouchContext.Provider>
  )
}

const HoverCardTouchContext = React.createContext<{
  open: boolean
  onOpenChange: (open: boolean) => void
}>({ open: false, onOpenChange: () => {} })

const HoverCardTrigger = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Trigger>
>(({ onClick, ...props }, ref) => {
  const { open, onOpenChange } = React.useContext(HoverCardTouchContext)

  return (
    <HoverCardPrimitive.Trigger
      ref={ref}
      onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
        if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
          onOpenChange(!open)
        }
        onClick?.(e)
      }}
      {...props}
    />
  )
})
HoverCardTrigger.displayName = "HoverCardTrigger"

const HoverCardContent = React.forwardRef<
  React.ElementRef<typeof HoverCardPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, ...props }, ref) => (
  <HoverCardPrimitive.Content
    ref={ref}
    align={align}
    sideOffset={sideOffset}
    className={cn(
      "z-50 w-64 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-hover-card-content-transform-origin]",
      className
    )}
    {...props}
  />
))
HoverCardContent.displayName = HoverCardPrimitive.Content.displayName

export { HoverCard, HoverCardTrigger, HoverCardContent }
