export function formatCurrency(amount: number, currency: string, compact = false): string {
  if (compact && Math.abs(amount) >= 1_000_000) {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(amount);
  }
  return new Intl.NumberFormat("en-NG", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.getTime())) return date;
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric" }).format(value);
}

export function formatMonth(month: string): string {
  const value = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(value.getTime())) return month;
  return new Intl.DateTimeFormat("en-NG", { month: "long", year: "numeric" }).format(value);
}

export function localIsoDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function newId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

export function downloadFile(content: string, fileName: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
