"use client";
import { useRouter } from "next/navigation";
import { NativeSelect } from "@/components/ui/native-select";

/** A select that navigates by setting one query parameter. */
export function NativeSelectLink({ label, value, options, base, param }: { label: string; value: string; options: { value: string; label: string }[]; base: string; param: string }) {
  const router = useRouter();
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(e) => router.replace(e.target.value ? `${base}&${param}=${e.target.value}` : base)}
      className="h-9 w-auto max-w-64"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </NativeSelect>
  );
}
