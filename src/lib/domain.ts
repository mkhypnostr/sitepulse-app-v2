import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];
export type WorkStatus = Database["public"]["Enums"]["work_status"];
export type PhotoType = Database["public"]["Enums"]["photo_type"];

export const roleLabels: Record<AppRole, string> = {
  admin: "Yönetici",
  technical_office: "Teknik Ofis",
  contractor: "Taşeron",
  customer: "Müşteri",
};

export const statusLabels: Record<WorkStatus, string> = {
  draft: "Taslak",
  planned: "Planlandı",
  in_progress: "Devam Ediyor",
  review_pending: "Yönetici Kontrolünde",
  completed: "Tamamlandı",
  cancelled: "İptal",
};

export const photoTypeLabels: Record<PhotoType, string> = {
  saha: "Saha",
  montaj_sonrasi: "Montaj Sonrası",
  malzeme: "Malzeme",
  diger: "Diğer",
};

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return "Beklenmeyen bir hata oluştu";
}

export function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

// Word gerçek bir kütüphane gerektirmeden, MS Office'in Word/HTML XML
// ad alanlarıyla işaretlenmiş bir HTML dokümanını .doc olarak açabilmesinden
// yararlanır — herhangi bir docx bağımlılığı eklemeden çalışır.
export function downloadWordDocument(filename: string, title: string, bodyHtml: string) {
  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8" /><title>${title}</title></head><body>${bodyHtml}</body></html>`;
  const url = URL.createObjectURL(new Blob(["﻿", html], { type: "application/msword" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, rows: unknown[][]) {
  const content = `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function parseDelimitedText(text: string) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = firstLine.includes(";") ? ";" : ",";
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const cells: string[] = [];
      let current = "";
      let quoted = false;
      for (let index = 0; index < line.length; index += 1) {
        const character = line[index];
        if (character === '"' && line[index + 1] === '"' && quoted) {
          current += '"';
          index += 1;
        } else if (character === '"') {
          quoted = !quoted;
        } else if (character === delimiter && !quoted) {
          cells.push(current.trim());
          current = "";
        } else {
          current += character;
        }
      }
      cells.push(current.trim());
      return cells;
    });
}
