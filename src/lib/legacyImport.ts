import { format, isValid, parse } from "date-fns";
import { isValidDateOnly, todayDateOnly } from "@/domain/date";
import { parseCurrencyToCents } from "@/domain/money";
import type { ImportPreview, Sale, SaleStatus } from "@/domain/types";
import { sha256 } from "@/lib/files";

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_ROWS = 25_000;

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9&]+/g, " ")
    .trim();
}

function parseLegacyDate(value: unknown, XLSX: typeof import("xlsx")): string | null {
  if (value instanceof Date && isValid(value)) return format(value, "yyyy-MM-dd");
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (isValidDateOnly(text)) return text;
  for (const pattern of ["M/d/yyyy", "MM/dd/yyyy", "M/d/yy", "MMM d, yyyy"]) {
    const parsed = parse(text, pattern, new Date());
    if (isValid(parsed)) return format(parsed, "yyyy-MM-dd");
  }
  return null;
}

function parseStatus(value: unknown): SaleStatus | null {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("en-US");
  if (normalized === "delivered") return "delivered";
  if (normalized === "pending") return "pending";
  if (normalized === "void" || normalized === "unwound") return "void";
  return null;
}

function parseImportedMoney(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Math.round(value * 100);
  const text = String(value).trim();
  const normalized = /^\(.*\)$/.test(text) ? `-${text.slice(1, -1)}` : text;
  return parseCurrencyToCents(normalized);
}

/**
 * Preserve the difference between a recorded No and an unanswered legacy cell.
 * Product/finance outcome analytics use that distinction for their completion rates.
 */
function parseImportedBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 0) return false;
    if (Number.isFinite(value)) return true;
    return undefined;
  }
  const normalized = String(value ?? "").trim().toLocaleLowerCase("en-US");
  if (!normalized) return undefined;
  if (["1", "x", "y", "yes", "true", "sold", "financed", "checked", "check", "✓", "✔"].includes(normalized)) {
    return true;
  }
  if (["0", "n", "no", "false", "not sold", "not financed", "unchecked", "blank", "—", "-"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function findHeaderRow(rows: unknown[][]): number {
  return rows.findIndex((row) => {
    const headers = row.map(normalizeHeader);
    return (
      headers.some((value) => value.includes("stock")) &&
      headers.some((value) => value.includes("status")) &&
      headers.some((value) => value.includes("front gross"))
    );
  });
}

function headerIndex(headers: string[], patterns: string[]): number {
  return headers.findIndex((header) => patterns.some((pattern) => header.includes(pattern)));
}

export async function previewLegacyWorkbook(
  file: File,
  earliestCoveredMonth?: string,
): Promise<ImportPreview> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Workbook is larger than the 12 MB safety limit.");
  const arrayBuffer = await file.arrayBuffer();
  const sourceHash = await sha256(arrayBuffer);
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    cellDates: true,
    dense: true,
    sheetRows: MAX_ROWS + 2,
  });
  const sheetName = workbook.SheetNames.find(
    (name) => name.trim().toLocaleLowerCase("en-US") === "enter sales",
  ) ?? workbook.SheetNames.find((name) => name.toLocaleLowerCase("en-US").includes("export"));
  if (!sheetName) throw new Error("Could not find an Enter Sales or Export Report sheet.");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("The selected workbook sheet could not be read.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (rows.length > MAX_ROWS) throw new Error("Workbook has more than 25,000 rows.");

  const headerRow = findHeaderRow(rows);
  if (headerRow < 0) throw new Error("Could not recognize the sales-entry column headings.");
  const headers = rows[headerRow].map(normalizeHeader);
  const indexes = {
    date: headerIndex(headers, ["delivery", "expected date", "sale date"]),
    lastName: headerIndex(headers, ["customer last name", "last name"]),
    stock: headerIndex(headers, ["stock"]),
    vehicle: headerIndex(headers, ["vehicle"]),
    status: headerIndex(headers, ["status"]),
    unit: headerIndex(headers, ["unit credit"]),
    front: headerIndex(headers, ["front gross"]),
    fi: headerIndex(headers, ["f&i gross", "f&i product gross", "fi gross"]),
    serviceContract: headerIndex(headers, ["service contract", "extended service", "warranty", "ford esp", "war"]),
    tireWheel: headerIndex(headers, ["t&w", "tire & wheel", "tire wheel"]),
    gap: headerIndex(headers, ["gap"]),
    dealerFinanced: headerIndex(headers, ["dealer financed", "dealer financing", "financed through dealer"]),
  };
  if (indexes.date < 0 || indexes.stock < 0 || indexes.status < 0) {
    throw new Error("The workbook is missing date, stock, or status columns.");
  }

  const validSales: Sale[] = [];
  const rejectedRows: ImportPreview["rejectedRows"] = [];
  const warnings: string[] = [];
  for (let index = headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index];
    const rowNumber = index + 1;
    const statusText = indexes.status >= 0 ? row[indexes.status] : "";
    const normalizedStatus = String(statusText).trim().toLocaleLowerCase("en-US");
    if (!row.some((value) => String(value).trim())) continue;
    if (normalizedStatus === "example") continue;
    const status = parseStatus(statusText);
    if (!status) {
      rejectedRows.push({ row: rowNumber, reason: "Status must be Delivered, Pending, or Void." });
      continue;
    }
    const saleDate = parseLegacyDate(row[indexes.date], XLSX);
    if (!saleDate) {
      rejectedRows.push({ row: rowNumber, reason: "Delivery or expected date could not be read." });
      continue;
    }
    const saleMonth = saleDate.slice(0, 7);
    if (earliestCoveredMonth && saleMonth < earliestCoveredMonth) {
      rejectedRows.push({
        row: rowNumber,
        reason: `No pay plan covers ${saleMonth}. Add an older pay plan beginning ${saleMonth} or earlier in Settings.`,
      });
      continue;
    }
    const stockNumber = String(row[indexes.stock] ?? "").trim();
    if (status === "delivered" && !stockNumber) {
      rejectedRows.push({ row: rowNumber, reason: "Delivered sale is missing a stock number." });
      continue;
    }
    if (stockNumber.length > 40) {
      rejectedRows.push({ row: rowNumber, reason: "Stock number must be 40 characters or fewer." });
      continue;
    }
    if (status === "delivered" && saleDate > todayDateOnly()) {
      rejectedRows.push({ row: rowNumber, reason: "A future delivery must remain Pending until delivered." });
      continue;
    }
    const frontGrossCents = indexes.front >= 0 ? parseImportedMoney(row[indexes.front]) : null;
    const fiGrossCents = indexes.fi >= 0 ? parseImportedMoney(row[indexes.fi]) : null;
    const invalidMoney = (value: number | null) =>
      value !== null &&
      (!Number.isSafeInteger(value) || Math.abs(value) > 100_000_000);
    if (invalidMoney(frontGrossCents) || invalidMoney(fiGrossCents)) {
      rejectedRows.push({ row: rowNumber, reason: "Gross must be valid and between -$1,000,000 and $1,000,000." });
      continue;
    }
    const rawUnit = indexes.unit >= 0 ? String(row[indexes.unit] ?? "").trim() : "";
    const unitCredit = rawUnit ? Number(rawUnit) : 1;
    if (!Number.isFinite(unitCredit) || unitCredit < 0 || unitCredit > 2) {
      rejectedRows.push({ row: rowNumber, reason: "Unit credit must be between 0 and 2." });
      continue;
    }
    const customerLastName = indexes.lastName >= 0 ? String(row[indexes.lastName] ?? "").trim() : "";
    const vehicleDescription = indexes.vehicle >= 0 ? String(row[indexes.vehicle] ?? "").trim() : "";
    if (customerLastName.length > 60) {
      rejectedRows.push({ row: rowNumber, reason: "Customer last name must be 60 characters or fewer." });
      continue;
    }
    if (vehicleDescription.length > 120) {
      rejectedRows.push({ row: rowNumber, reason: "Vehicle description must be 120 characters or fewer." });
      continue;
    }
    const timestamp = new Date().toISOString();
    validSales.push({
      id: `legacy-${sourceHash.slice(0, 16)}-${rowNumber}`,
      profileId: "primary",
      saleDate,
      customerLastName,
      stockNumber,
      vehicleDescription,
      status,
      unitCreditBasis: Math.round(unitCredit * 1_000),
      frontGrossCents: frontGrossCents ?? null,
      fiGrossCents: fiGrossCents ?? null,
      serviceContractSold: indexes.serviceContract >= 0
        ? parseImportedBoolean(row[indexes.serviceContract])
        : undefined,
      tireWheelSold: indexes.tireWheel >= 0
        ? parseImportedBoolean(row[indexes.tireWheel])
        : undefined,
      gapSold: indexes.gap >= 0
        ? parseImportedBoolean(row[indexes.gap])
        : undefined,
      dealerFinanced: indexes.dealerFinanced >= 0
        ? parseImportedBoolean(row[indexes.dealerFinanced])
        : undefined,
      notes: "",
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      source: "legacy-xlsx",
      sourceReference: `${file.name.slice(0, 180)} · ${sheetName.slice(0, 40)}!${rowNumber}`,
    });
  }

  if (!validSales.length && !rejectedRows.length) warnings.push("No sales rows were found after the heading row.");
  if (rejectedRows.length) warnings.push(`${rejectedRows.length} row(s) need correction and will not import.`);
  return { sourceName: file.name, sourceHash, validSales, rejectedRows, warnings };
}
