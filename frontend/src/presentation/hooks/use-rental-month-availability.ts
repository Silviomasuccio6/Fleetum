import { useCallback, useEffect, useRef, useState } from "react";
import { rentalBookingsUseCases } from "../../application/usecases/rental-bookings-usecases";

type Input = {
  month: string;
  siteId?: string;
  search?: string;
  refreshKey?: number;
};

type MonthAvailabilityResponse = Awaited<ReturnType<typeof rentalBookingsUseCases.monthAvailability>>;

export const useRentalMonthAvailability = (input: Input) => {
  const requestVersion = useRef(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MonthAvailabilityResponse["data"]>([]);
  const [summary, setSummary] = useState<MonthAvailabilityResponse["summary"]>({
    totalVehicles: 0,
    availableVehicles: 0,
    bookedVehicles: 0,
    occupancyRate: 0
  });

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const result = await rentalBookingsUseCases.monthAvailability({
        month: input.month,
        siteId: input.siteId || undefined,
        search: input.search || undefined
      });
      if (version !== requestVersion.current) return;
      setData(result.data ?? []);
      setSummary(result.summary);
    } catch (e) {
      if (version === requestVersion.current) setError((e as Error).message);
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [input.month, input.search, input.siteId]);

  useEffect(() => {
    void load();
    return () => { requestVersion.current += 1; };
  }, [load, input.refreshKey]);

  return {
    loading,
    error,
    data,
    summary,
    reload: load
  };
};
