import * as React from "react";
import { cn } from "@/lib/utils";

export function HummingbirdLogo({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Hummingbird logo"
      className={cn("size-6", className)}
      {...props}
    >
      <path fill="#10b981" d="M27 29C18 17 11 12 7 11c6 5 14 13 20 20z" />
      <path fill="#10b981" d="M24 33c-1-4 3-7 9-7 7 0 12 2 13 5-1 2-5 4-13 4-6 0-8 0-9-2z" />
      <path fill="#10b981" d="M24 33 13 39l3-6-3-6z" />
      <path fill="#10b981" d="M46 30 63 29 46 31.5z" />
      <circle cx="40" cy="30" r="1.6" fill="#06281f" />
    </svg>
  );
}
