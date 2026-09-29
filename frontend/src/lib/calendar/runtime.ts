export type CalendarKind = "gregorian" | "shamsi";

let currentCalendar: CalendarKind = "gregorian";

export function getCalendar(): CalendarKind {
  return currentCalendar;
}

export function setCalendarRuntime(kind: CalendarKind) {
  currentCalendar = kind;
}
