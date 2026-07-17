export function formatWatts(watts: number): string {
  const abs = Math.abs(watts);
  if (abs >= 1000) return `${(watts / 1000).toFixed(1)} kW`;
  return `${Math.round(watts)} W`;
}

export function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function formatLongDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export function formatDuration(totalSec: number): string {
  const min = Math.floor(totalSec / 60);
  const sec = Math.floor(totalSec % 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

/** "Today 2:30 pm", "Tomorrow", or "Sat 14 Jun". */
export function formatEventTime(ts: number, allDay: boolean): string {
  const date = new Date(ts);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const dayLabel =
    dayDiff === 0
      ? "Today"
      : dayDiff === 1
        ? "Tomorrow"
        : date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  if (allDay) return dayLabel;
  return `${dayLabel} ${formatClock(date)}`;
}
