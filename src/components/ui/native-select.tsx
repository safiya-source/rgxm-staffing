import * as React from "react";
import { cn } from "@/lib/utils";

// A styled native <select>: accessible, mobile-friendly and form-action compatible.
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-10 w-full cursor-pointer appearance-none rounded-md border border-input bg-card bg-[length:16px] bg-[right_0.6rem_center] bg-no-repeat px-3 pr-8 text-[15px] shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50 sm:text-sm",
        "bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>\")]",
        className,
      )}
      {...props}
    />
  );
}

export { NativeSelect };
