/** Haftanın pazartesi günü, YYYY-MM-DD (yerel saat). */
export function toWeekKey(d: Date) {
  const offset = (d.getDay() + 6) % 7; // Pazartesi = 0
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`;
}
