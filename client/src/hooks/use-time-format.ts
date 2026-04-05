import { useQuery } from "@tanstack/react-query";

export type TimeFormat = "12" | "24";

export function useTimeFormat(): TimeFormat {
  const { data: worker } = useQuery<any>({
    queryKey: ["/api/my/worker"],
  });
  const prefs = worker ? JSON.parse(worker.preferences || "{}") : {};
  return prefs.timeFormat === "24" ? "24" : "12";
}

export function formatShiftTime(time: string, format: TimeFormat = "12"): string {
  if (!time || !time.includes(":")) return time ?? "";
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr || "0", 10);
  if (isNaN(h) || isNaN(m)) return time;

  if (format === "24") {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export function formatShiftRange(start: string, end: string, format: TimeFormat = "12"): string {
  return `${formatShiftTime(start, format)} – ${formatShiftTime(end, format)}`;
}
