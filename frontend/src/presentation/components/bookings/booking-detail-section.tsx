import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function BookingDetailSection({ title, description, icon, children, initiallyOpen = false }: {
  title: string; description: string; icon: ReactNode; children: ReactNode; initiallyOpen?: boolean;
}) {
  return (
    <details className="booking-detail-section" open={initiallyOpen}>
      <summary>
        <span className="booking-detail-section-icon" aria-hidden="true">{icon}</span>
        <span className="booking-detail-section-label"><span role="heading" aria-level={3} className="booking-detail-section-title">{title}</span><span className="booking-detail-section-description">{description}</span></span>
        <ChevronDown className="booking-detail-section-chevron" aria-hidden="true" />
      </summary>
      <div className="booking-detail-section-body">{children}</div>
    </details>
  );
}
