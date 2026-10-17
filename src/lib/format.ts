export function formatTRY(n: number | string | null | undefined): string {
  const v = typeof n === "string" ? Number(n) : (n ?? 0);
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(v);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  // Yalnız tarih ("2026-10-14"): saat gösterilmez. new Date() bunu UTC gece
  // yarısı sayar ve Türkiye saatinde sahte bir "03:00" çıkarırdı.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const [, y, m, day] = dateOnly;
    return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(
      new Date(Number(y), Number(m) - 1, Number(day)),
    );
  }
  const d = new Date(iso);
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(d);
}

export function halfHourOptions(): string[] {
  const out: string[] = [];
  for (let h = 6; h <= 22; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    out.push(`${String(h).padStart(2, "0")}:30`);
  }
  return out;
}
