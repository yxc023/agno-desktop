import { cn } from "@/lib/utils";

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * Agno Desktop Logo
 * 三点 + 连线，参考"图论 / 智能体协作"的视觉隐喻
 * 暖琥珀色（不再是紫蓝）
 */
export function Logo({ className, size = 28, ...props }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      {...props}
    >
      <defs>
        <linearGradient id="agno-grad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="hsl(32 92% 58%)" />
          <stop offset="1" stopColor="hsl(20 90% 50%)" />
        </linearGradient>
        <linearGradient id="agno-grad-2" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="hsl(38 96% 64%)" />
          <stop offset="1" stopColor="hsl(12 86% 52%)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="7" fill="url(#agno-grad)" />
      {/* 三点构成"思考 → 工具 → 答案" */}
      <circle cx="11" cy="11" r="2.4" fill="hsl(24 14% 8%)" opacity="0.92" />
      <circle cx="21" cy="11" r="2.4" fill="hsl(24 14% 8%)" opacity="0.78" />
      <circle cx="16" cy="22" r="2.8" fill="hsl(24 14% 8%)" />
      <line
        x1="11"
        y1="11"
        x2="16"
        y2="22"
        stroke="hsl(24 14% 8%)"
        strokeWidth="1.4"
        opacity="0.5"
      />
      <line
        x1="21"
        y1="11"
        x2="16"
        y2="22"
        stroke="hsl(24 14% 8%)"
        strokeWidth="1.4"
        opacity="0.5"
      />
    </svg>
  );
}

/** 文字版 logo */
export function LogoText({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Logo size={26} />
      <div className="flex flex-col leading-none">
        <span className="text-[13px] font-semibold tracking-tight">
          Agno Desktop
        </span>
        <span className="font-mono text-[9px] text-muted-foreground/80 tracking-wider mt-0.5">
          v0.1.0
        </span>
      </div>
    </div>
  );
}