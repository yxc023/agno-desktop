import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

/**
 * TooltipContent — 用 Radix Portal 自动渲染到 body,脱离任何父级
 * stacking context,这样不会被兄弟节点(如 SessionList)遮盖。
 *
 * z-index 分层:
 * - dialog (z-[60]):模态,阻挡交互
 * - popover/dropdown/tooltip (z-[70]):portaled 浮层,始终在内容之上
 *
 * 用 70 而不是 50,是因为有些父级(如 backdrop-blur / transform)
 * 可能 create stacking context 让 z-50 在局部失效;70 在 Tailwind
 * 默认层序里仍然低于常见的 popover/dialog 习惯,且不会被 AppShell
 * 之类没显式设 z-index 的容器无意遮盖。
 */
const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-[70] overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };