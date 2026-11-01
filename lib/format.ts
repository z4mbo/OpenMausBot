/** Dates, times and names, formatted one way across the app (en-US). */

export const LOCALE = "en-US";

type DateInput = number | Date;
export type DueTone = "overdue" | "soon" | "later";
export type Person = { name?: string | null; username?: string | null; email?: string | null };

const DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, options: Intl.DateTimeFormatOptions) {
  let value = formatters.get(key);
  if (!value) {
    value = new Intl.DateTimeFormat(LOCALE, options);
    formatters.set(key, value);
  }
  return value;
}

/** ICU puts a narrow no-break space before AM/PM; a plain space renders the same on every runtime. */
function clean(text: string) {
  return text.replace(/[  ]/g, " ");
}

function toDate(value: DateInput) {
  return value instanceof Date ? value : new Date(value);
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** Whole calendar days from `now` to `value` (negative in the past), unaffected by DST shifts. */
function calendarDays(value: Date, now: Date) {
  return Math.round((startOfDay(value).getTime() - startOfDay(now).getTime()) / DAY);
}

/** "Nov 3", or "Nov 3, 2025" outside the current year. */
export function formatDate(value: DateInput, now: DateInput = new Date()) {
  const date = toDate(value);
  return date.getFullYear() === toDate(now).getFullYear()
    ? formatter("date", { month: "short", day: "numeric" }).format(date)
    : formatter("date-year", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

/** "4:19 PM". */
export function formatTime(value: DateInput) {
  return clean(formatter("time", { hour: "numeric", minute: "2-digit" }).format(toDate(value)));
}

/** "Nov 3, 4:19 PM", or "Nov 3, 2025, 4:19 PM" outside the current year. */
export function formatDateTime(value: DateInput, now: DateInput = new Date()) {
  return `${formatDate(value, now)}, ${formatTime(value)}`;
}

/** "now", "5m", "3h", "Yesterday", then the date. */
export function formatRelative(value: DateInput, now: DateInput = new Date()) {
  const date = toDate(value);
  const current = toDate(now);
  const minutes = Math.floor((current.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  if (calendarDays(date, current) === -1) return "Yesterday";
  return formatDate(date, current);
}

/** Local date of a "YYYY-MM-DD" due date (no time-zone shift), or null when it is not a real date. */
export function parseDueDate(value?: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** "YYYY-MM-DD" of a local date. */
export function toDueDate(value: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/** Today / Tomorrow / Yesterday within a day, else the date; overdue before today, soon today or tomorrow. */
export function formatDue(value?: string | null, now: DateInput = new Date()): { label: string; tone: DueTone } | null {
  const due = parseDueDate(value);
  if (!due) return null;
  const current = toDate(now);
  const days = calendarDays(due, current);
  const label = days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : formatDate(due, current);
  return { label, tone: days < 0 ? "overdue" : days <= 1 ? "soon" : "later" };
}

/** Full name, falling back to the username, then the email's local part. */
export function displayName(person: Person) {
  return person.name?.trim() || person.username?.trim() || person.email?.split("@")[0]?.trim() || "";
}
