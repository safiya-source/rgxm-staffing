import type { Metadata } from "next";
import { getAvailability } from "@/server/domain/availability";
import { requireStaff } from "@/server/session";
import { AvailabilityEditor } from "./availability-editor";

export const metadata: Metadata = { title: "My availability" };

export default async function AvailabilityPage() {
  const viewer = await requireStaff();
  const { rules, exceptions } = await getAvailability(viewer.staff!.id);
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-[22px] font-semibold">My availability</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Helps RGXM send you the right offers. Saying you&apos;re available doesn&apos;t book you; you&apos;ll still get an offer to accept.
        </p>
      </div>
      <AvailabilityEditor
        rules={rules.map((r) => ({ weekday: r.weekday, startTime: r.startTime.slice(0, 5), endTime: r.endTime.slice(0, 5) }))}
        exceptions={exceptions.map((e) => ({
          id: e.id,
          date: e.date,
          kind: e.kind,
          startTime: e.startTime?.slice(0, 5) ?? null,
          endTime: e.endTime?.slice(0, 5) ?? null,
          note: e.note,
        }))}
      />
    </div>
  );
}
