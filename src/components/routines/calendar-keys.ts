export type CalendarKeyAction = "close" | "create" | "today" | "day" | "week" | "list";

type Key = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">;

/** What a key press does on the Routines page. Escape closes from anywhere, letters only act outside text fields. */
export function calendarKeyAction(event: Key, inField: boolean, onCalendar: boolean): CalendarKeyAction | null {
  if (event.key === "Escape") return "close";
  if (inField || !onCalendar || event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "c") return "create";
  if (key === "t") return "today";
  if (key === "1" || key === "d") return "day";
  if (key === "w") return "week";
  if (key === "l") return "list";
  return null;
}
