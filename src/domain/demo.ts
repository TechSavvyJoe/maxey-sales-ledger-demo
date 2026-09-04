import { DEFAULT_PAY_PLAN } from "@/domain/commission";
import { monthKeyFromDate, todayDateOnly } from "@/domain/date";
import type { PaymentMethod, PayPlan, Sale } from "@/domain/types";

interface DemoVehicleLine {
  name: string;
  firstModelYear: number;
  lastModelYear?: number;
}

const vehicleLines: DemoVehicleLine[] = [
  { name: "Ford Escape Active", firstModelYear: 2023, lastModelYear: 2025 },
  { name: "Ford Escape SEL", firstModelYear: 2019, lastModelYear: 2025 },
  { name: "Ford F-150 XLT", firstModelYear: 2015 },
  { name: "Ford F-150 Lariat", firstModelYear: 2015 },
  { name: "Ford Bronco Sport Big Bend", firstModelYear: 2021 },
  { name: "Ford Explorer Limited", firstModelYear: 2016 },
  { name: "Ford Edge SEL", firstModelYear: 2016, lastModelYear: 2024 },
  { name: "Ford Maverick XLT", firstModelYear: 2022 },
  { name: "Ford Expedition XLT", firstModelYear: 2018 },
  { name: "Ford Mustang EcoBoost", firstModelYear: 2015 },
  { name: "Ford Ranger XLT", firstModelYear: 2019 },
  { name: "Ford Transit Connect XLT", firstModelYear: 2014, lastModelYear: 2023 },
  { name: "Chevrolet Equinox LT", firstModelYear: 2018 },
  { name: "Chevrolet Silverado 1500 LT", firstModelYear: 2014 },
  { name: "GMC Terrain SLE", firstModelYear: 2018 },
  { name: "Jeep Grand Cherokee Limited", firstModelYear: 2016 },
  { name: "Jeep Compass Latitude", firstModelYear: 2017 },
  { name: "Ram 1500 Big Horn", firstModelYear: 2014 },
  { name: "Toyota RAV4 XLE", firstModelYear: 2016 },
  { name: "Toyota Camry SE", firstModelYear: 2015 },
  { name: "Honda CR-V EX", firstModelYear: 2017 },
  { name: "Honda Accord Sport", firstModelYear: 2015 },
  { name: "Subaru Forester Premium", firstModelYear: 2017 },
  { name: "Nissan Rogue SV", firstModelYear: 2017 },
  { name: "Hyundai Tucson SEL", firstModelYear: 2018 },
  { name: "Kia Sportage EX", firstModelYear: 2017 },
];

// Common fictional surnames provide variety without copying any customer list.
const sampleLastNames = [
  "Adams", "Allen", "Anderson", "Baker", "Bell", "Bennett", "Brooks", "Brown",
  "Campbell", "Carter", "Clark", "Collins", "Cooper", "Davis", "Edwards", "Evans",
  "Foster", "Garcia", "Gray", "Green", "Hall", "Harris", "Hayes", "Hill",
  "Howard", "Jackson", "Johnson", "Kelly", "King", "Lee", "Lewis", "Martin",
  "Miller", "Mitchell", "Moore", "Morgan", "Nelson", "Parker", "Reed", "Rivera",
  "Roberts", "Robinson", "Scott", "Smith", "Taylor", "Thomas", "Turner", "Walker",
  "White", "Williams", "Wilson", "Wright", "Young",
];

// This is an illustrative salesperson profile, not a dealership benchmark:
// quieter winter months, busier summers, and the requested gross averages.
const yearlyDeliveryVolumes = [14, 15, 18, 20, 22, 24, 23, 22, 19, 18, 16, 15];
const FRONT_GROSS_PER_DELIVERY_CENTS = 230_000;
const FI_GROSS_PER_DELIVERY_CENTS = 120_000;
export const DEMO_PROFILE_VERSION = "three-calendar-years-2300-front-1200-fi-v2";

/** GitHub Pages is intentionally a richer, fictional walkthrough than local builds. */
export const IS_PUBLIC_DEMO_BUILD = import.meta.env.VITE_PUBLIC_DEMO === "true";
export const AUTOLOAD_PUBLIC_DEMO = IS_PUBLIC_DEMO_BUILD
  && import.meta.env.VITE_PUBLIC_DEMO_AUTOLOAD !== "false";
export const DEMO_DATASET_LABEL = IS_PUBLIC_DEMO_BUILD ? "sample history" : "full-year";
export const DEMO_DATASET_TITLE = IS_PUBLIC_DEMO_BUILD ? "Sample history" : "Full-year";
export const DEMO_HISTORIC_PLAN_VERSION = "Sample 2024–26 plan";

type DemoDatasetScope = "full-year" | "three-year";

/** Stable sample choices: refreshes must never shuffle a demonstration's results. */
export function samplePaymentMethod(sale: Pick<Sale, "id" | "dealerFinanced">): PaymentMethod {
  if (sale.dealerFinanced === true) return "dealer_financed";
  const seed = [...sale.id].reduce((value, character) => (Math.imul(value, 31) + character.charCodeAt(0)) >>> 0, 7);
  if (sale.dealerFinanced === false) return seed % 2 ? "cash" : "outside_financing";
  return (["dealer_financed", "cash", "outside_financing"] as const)[seed % 3];
}

function addMonths(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function yearMonths(monthKey: string): string[] {
  const year = monthKey.slice(0, 4);
  return Array.from(
    { length: 12 },
    (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`,
  );
}

/** Three named calendar years are easier to demonstrate than two partial years. */
function threeCalendarYearMonths(asOfDate: string): string[] {
  const currentMonth = monthKeyFromDate(asOfDate);
  const currentYear = Number(currentMonth.slice(0, 4));
  const firstMonth = `${currentYear - 2}-01`;
  const elapsedMonths = (currentYear - (currentYear - 2)) * 12 + Number(currentMonth.slice(5, 7));
  return Array.from({ length: elapsedMonths }, (_, index) => addMonths(firstMonth, index));
}

function demoWorkingDays(monthKey: string): number[] {
  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: daysInMonth }, (_, index) => index + 1)
    .filter((day) => new Date(Date.UTC(year, month - 1, day)).getUTCDay() !== 0);
}

function sampleSeed(key: string): number {
  let seed = 2_166_136_261;
  for (const character of key) seed = Math.imul(seed ^ character.charCodeAt(0), 16_777_619);
  seed = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b);
  seed = Math.imul(seed ^ (seed >>> 13), 0xc2b2ae35);
  return (seed ^ (seed >>> 16)) >>> 0;
}

function sampleFraction(key: string): number {
  return sampleSeed(key) / 0x1_0000_0000;
}

function deliveryVolume(monthKey: string): number {
  const monthIndex = Number(monthKey.slice(5, 7)) - 1;
  const yearVariation = sampleSeed(`${monthKey}:volume`) % 3 - 1;
  return yearlyDeliveryVolumes[monthIndex] + yearVariation;
}

function sampleVehicle(monthKey: string, index: number): string {
  const model = vehicleLines[sampleSeed(`${monthKey}:vehicle:${index}`) % vehicleLines.length];
  const saleYear = Number(monthKey.slice(0, 4));
  const age = sampleSeed(`${monthKey}:vehicle-age:${index}`) % 8;
  const modelYear = Math.min(
    model.lastModelYear ?? saleYear,
    Math.max(model.firstModelYear, saleYear - age),
  );
  return `${modelYear} ${model.name}`;
}

function selectSampleIndices(indices: number[], count: number, key: string, preference?: Set<number>): Set<number> {
  return new Set([...indices]
    .sort((left, right) => (
      sampleFraction(`${key}:${left}`) - (preference?.has(left) ? 0.18 : 0)
      - sampleFraction(`${key}:${right}`) + (preference?.has(right) ? 0.18 : 0)
    ) || left - right)
    .slice(0, count));
}

/** Largest-remainder allocation keeps cents exact without changing zero deals. */
function normalizeGross(weights: number[], targetCents: number): number[] {
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (totalWeight === 0) return weights.map(() => 0);
  const exact = weights.map((weight) => weight / totalWeight * targetCents);
  const amounts = exact.map(Math.floor);
  const remainderOrder = weights.map((_, index) => index)
    .filter((index) => weights[index] > 0)
    .sort((left, right) => (exact[right] - amounts[right]) - (exact[left] - amounts[left]) || left - right);
  const remaining = targetCents - amounts.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remaining; index += 1) amounts[remainderOrder[index]] += 1;
  return amounts;
}

function createDemoMonth(monthKey: string, status: Sale["status"]): Sale[] {
  const count = deliveryVolume(monthKey);
  const indices = Array.from({ length: count }, (_, index) => index);
  const workingDays = demoWorkingDays(monthKey);
  // Illustrative 70/20/10 Finance/Cash/Outside mix, not a measured store target.
  const financeRate = 0.70 + (sampleSeed(`${monthKey}:finance-rate`) % 5 - 2) * 0.015;
  const financed = selectSampleIndices(indices, Math.round(count * financeRate), `${monthKey}:finance`);
  const notFinanced = indices.filter((index) => !financed.has(index));
  const cash = selectSampleIndices(notFinanced, Math.round(notFinanced.length * 2 / 3), `${monthKey}:cash`);
  const serviceContracts = selectSampleIndices(indices, Math.round(count * 0.50), `${monthKey}:service`, financed);
  const tireWheel = selectSampleIndices(indices, Math.round(count * 0.27), `${monthKey}:tire-wheel`, financed);
  const gap = selectSampleIndices([...financed], Math.round(financed.size * 0.44), `${monthKey}:gap`);

  const isSpiffMonth = (Number(monthKey.slice(5, 7)) + Number(monthKey.slice(0, 4))) % 4 === 0;
  const lowFronts = [...selectSampleIndices(indices, 2, `${monthKey}:low-front`)];
  const fixedFront = indices.map((index) => {
    if (index === lowFronts[0] && (isSpiffMonth || sampleSeed(`${monthKey}:negative`) % 3 !== 0)) {
      return -(25_000 + sampleSeed(`${monthKey}:negative-amount`) % 70_001);
    }
    if (index === lowFronts[1] && sampleSeed(`${monthKey}:mini`) % 4 !== 0) {
      return 10_000 + sampleSeed(`${monthKey}:mini-amount`) % 30_001;
    }
    return null;
  });
  const frontWeights = indices.map((index) => fixedFront[index] === null
    ? 80_000 + sampleSeed(`${monthKey}:front:${index}`) % 360_001 : 0);
  const normalizedFront = normalizeGross(frontWeights,
    count * FRONT_GROSS_PER_DELIVERY_CENTS - fixedFront.reduce<number>((sum, value) => sum + (value ?? 0), 0));
  // Synthetic commissionable product gross, not dealer finance reserve/PVR.
  // Financing alone does not create F&I gross or salesperson commission here.
  const fiWeights = indices.map((index) => (
    (serviceContracts.has(index) ? 90_000 + sampleSeed(`${monthKey}:service-gross:${index}`) % 130_001 : 0)
    + (tireWheel.has(index) ? 25_000 + sampleSeed(`${monthKey}:tire-gross:${index}`) % 50_001 : 0)
    + (gap.has(index) ? 30_000 + sampleSeed(`${monthKey}:gap-gross:${index}`) % 50_001 : 0)
  ));
  const fiGross = normalizeGross(fiWeights, count * FI_GROSS_PER_DELIVERY_CENTS);
  // Only two or three split examples per year, not a mandatory split every month.
  const splitMonth = (Number(monthKey.slice(5, 7)) + Number(monthKey.slice(0, 4))) % 5 === 0;
  const splitIndex = splitMonth ? sampleSeed(`${monthKey}:split`) % count : -1;
  // Roughly one low-gross aged unit per quarter demonstrates a manager-set spiff.
  const spiffIndex = isSpiffMonth ? lowFronts[0] : -1;

  return indices.map((index) => {
    // A little stable day-to-day variation creates some double-delivery and quiet
    // days. Filtering this prebuilt calendar keeps early-month pace proportional.
    const position = (index + 0.5) * workingDays.length / count;
    const jitter = sampleFraction(`${monthKey}:day:${index}`) * 1.5 - 0.75;
    const dayIndex = Math.max(0, Math.min(workingDays.length - 1, Math.floor(position + jitter)));
    const saleDate = `${monthKey}-${String(workingDays[dayIndex]).padStart(2, "0")}`;
    const timestamp = `${saleDate}T15:00:00.000Z`;
    const paymentMethod: PaymentMethod = financed.has(index) ? "dealer_financed" : cash.has(index) ? "cash" : "outside_financing";
    return {
      id: `demo-${monthKey}-${index}-${status}`,
      profileId: "primary",
      saleDate,
      customerLastName: sampleLastNames[sampleSeed(`${monthKey}:name:${index}`) % sampleLastNames.length],
      stockNumber: `DEMO-${monthKey.replace("-", "")}-${String(index + 1).padStart(2, "0")}`,
      vehicleDescription: sampleVehicle(monthKey, index),
      status,
      unitCreditBasis: index === splitIndex ? 500 : 1_000,
      frontGrossCents: fixedFront[index] ?? normalizedFront[index],
      frontCommissionOverrideCents: index === spiffIndex
        ? 50_000 + sampleSeed(`${monthKey}:spiff:${index}`) % 30_001
        : null,
      fiGrossCents: fiGross[index],
      serviceContractSold: serviceContracts.has(index),
      tireWheelSold: tireWheel.has(index),
      gapSold: gap.has(index),
      dealerFinanced: financed.has(index),
      paymentMethod,
      notes: "Demonstration record — safe to remove from active views.",
      createdAt: timestamp,
      updatedAt: timestamp,
      revision: 1,
      source: "demo",
    };
  });
}

function buildMonthThroughDate(monthKey: string, asOfDate: string): Sale[] {
  const currentMonth = monthKeyFromDate(asOfDate);
  const status = monthKey > currentMonth ? "pending" : "delivered";
  const sales = createDemoMonth(monthKey, status);
  // The F&I manager supplies commissionable gross the following month. Keep
  // current-month amounts unknown, while preserving already-known product flags.
  return monthKey === currentMonth
    ? sales.filter((sale) => sale.saleDate <= asOfDate).map((sale) => ({ ...sale, fiGrossCents: null }))
    : sales;
}

function buildFullYearDemoSales(selectedMonth: string, asOfDate: string): Sale[] {
  return yearMonths(selectedMonth).flatMap((monthKey) => buildMonthThroughDate(monthKey, asOfDate));
}

function buildThreeYearDemoSales(asOfDate: string): Sale[] {
  return threeCalendarYearMonths(asOfDate).flatMap((monthKey) => buildMonthThroughDate(monthKey, asOfDate));
}

/**
 * The public demo uses a fictional historic plan only for its 2024–25 sample
 * records. It never changes the editable Howell plan used by local workspaces.
 */
export function createPublicDemoHistoricPlan(asOfDate = todayDateOnly()): PayPlan {
  return {
    ...structuredClone(DEFAULT_PAY_PLAN),
    version: DEMO_HISTORIC_PLAN_VERSION,
    effectiveMonth: threeCalendarYearMonths(asOfDate)[0],
  };
}

export function demoRangeDescription(asOfDate = todayDateOnly()): string {
  if (!IS_PUBLIC_DEMO_BUILD) return "a full calendar year";
  const start = threeCalendarYearMonths(asOfDate)[0];
  const [year, month] = start.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
  return `${label} through today`;
}

export function buildDemoSales(
  selectedMonth: string,
  asOfDate = todayDateOnly(),
  scope: DemoDatasetScope = IS_PUBLIC_DEMO_BUILD ? "three-year" : "full-year",
): Sale[] {
  return scope !== "full-year"
    ? buildThreeYearDemoSales(asOfDate)
    : buildFullYearDemoSales(selectedMonth, asOfDate);
}
