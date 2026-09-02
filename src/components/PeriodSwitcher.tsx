import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { currentMonthKey, monthLabel, monthName, shiftMonth, yearForMonth } from "@/domain/date";
import { cn } from "@/lib/utils";

interface PeriodSwitcherProps {
  selectedMonth: string;
  earliestMonth: string;
  monthsWithSales: Set<string>;
  onChange: (monthKey: string, options?: { preserveFocus?: boolean }) => void;
}

export function PeriodSwitcher({ selectedMonth, earliestMonth, monthsWithSales, onChange }: PeriodSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [visibleYear, setVisibleYear] = useState(yearForMonth(selectedMonth));
  const currentMonth = currentMonthKey();
  const earliestYear = yearForMonth(earliestMonth);
  const previousMonth = shiftMonth(selectedMonth, -1);
  const canMovePrevious = previousMonth >= earliestMonth;

  const months = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) =>
        `${visibleYear}-${String(index + 1).padStart(2, "0")}`,
      ),
    [visibleYear],
  );

  return (
    <div
      className="period-switcher"
      aria-label="Reporting period"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" && !open && canMovePrevious) {
          event.preventDefault();
          onChange(previousMonth, { preserveFocus: true });
        }
        if (event.key === "ArrowRight" && !open) {
          event.preventDefault();
          onChange(shiftMonth(selectedMonth, 1), { preserveFocus: true });
        }
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="period-switcher__arrow"
        aria-label={canMovePrevious ? `Show ${monthLabel(previousMonth)}` : `No pay plan before ${monthLabel(earliestMonth)}`}
        disabled={!canMovePrevious}
        onClick={() => canMovePrevious && onChange(previousMonth, { preserveFocus: true })}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (nextOpen) setVisibleYear(yearForMonth(selectedMonth));
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="period-switcher__label"
            aria-label={`Choose reporting month. Currently ${monthLabel(selectedMonth)}`}
          >
            <CalendarDays className="period-switcher__calendar" aria-hidden="true" />
            <span className="period-switcher__value period-switcher__value--full">{monthLabel(selectedMonth)}</span>
            <span className="period-switcher__value period-switcher__value--compact" aria-hidden="true">
              {monthLabel(selectedMonth, "short")}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="period-popover" align="center" sideOffset={10}>
          <div className="period-popover__year">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Show months in ${visibleYear - 1}`}
              disabled={visibleYear <= earliestYear}
              onClick={() => setVisibleYear((year) => year - 1)}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <strong>{visibleYear}</strong>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Show months in ${visibleYear + 1}`}
              onClick={() => setVisibleYear((year) => year + 1)}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
          <div className="month-grid" role="group" aria-label={`Months in ${visibleYear}`}>
            {months.map((monthKey, index) => {
              const isSelected = monthKey === selectedMonth;
              const isCurrent = monthKey === currentMonth;
              const hasSales = monthsWithSales.has(monthKey);
              const isBeforeCoverage = monthKey < earliestMonth;
              return (
                <button
                  type="button"
                  className={cn(
                    "month-grid__month",
                    isSelected && "is-selected",
                    isCurrent && "is-current",
                  )}
                  aria-pressed={isSelected}
                  aria-label={isBeforeCoverage ? `${monthName(index)} — no pay plan coverage` : undefined}
                  disabled={isBeforeCoverage}
                  key={monthKey}
                  onClick={() => {
                    onChange(monthKey);
                    setOpen(false);
                  }}
                >
                  <span>{monthName(index)}</span>
                  {hasSales ? <span role="img" className="month-grid__dot" aria-label="Has sales" /> : null}
                </button>
              );
            })}
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={currentMonth < earliestMonth}
            onClick={() => {
              onChange(currentMonth);
              setOpen(false);
            }}
          >
            This month
          </Button>
        </PopoverContent>
      </Popover>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="period-switcher__arrow"
        aria-label={`Show ${monthLabel(shiftMonth(selectedMonth, 1))}`}
        onClick={() => onChange(shiftMonth(selectedMonth, 1), { preserveFocus: true })}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
