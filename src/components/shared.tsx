import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, ChevronRight, Inbox } from "lucide-react";
import type { SaleStatus } from "@/domain/types";
import { cn } from "@/lib/utils";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow ? <span className="page-heading__eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {action ? <div className="page-heading__action">{action}</div> : null}
    </header>
  );
}

export function StatusBadge({ status }: { status: SaleStatus }) {
  return <span className={cn("status-badge", `status-badge--${status}`)}>{status}</span>;
}

export function ReviewState({
  count,
  compact = false,
}: {
  count: number;
  compact?: boolean;
  clearLabel?: string;
  issueLabel?: string;
}) {
  if (count === 0) {
    return (
      <span className={cn("review-state is-ready", compact && "is-compact")}>
        <CheckCircle2 aria-hidden="true" />
        All clear
      </span>
    );
  }
  return (
    <span className={cn("review-state is-warning", compact && "is-compact")}>
      <AlertTriangle aria-hidden="true" />
      {count} {count === 1 ? "sale needs" : "sales need"} review
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  headingLevel = 2,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";

  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        <Inbox />
      </span>
      <Heading>{title}</Heading>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function SectionHeader({
  id,
  title,
  description,
  action,
}: {
  id?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2 id={id}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function InlineLinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="inline-link-button" onClick={onClick}>
      {children}
      <ChevronRight aria-hidden="true" />
    </button>
  );
}
