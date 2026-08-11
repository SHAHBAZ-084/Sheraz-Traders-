import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type FinancialYear } from '../lib/api';

type FinancialYearContextValue = {
  years: FinancialYear[];
  activeYear: FinancialYear | null;
  selectedYearId: number | null;
  setSelectedYearId: (id: number) => void;
  isReadOnly: boolean;
  refreshYears: () => Promise<void>;
  loading: boolean;
};

const FinancialYearContext = createContext<FinancialYearContextValue | null>(null);

export function FinancialYearProvider({ children }: { children: ReactNode }) {
  const [years, setYears] = useState<FinancialYear[]>([]);
  const [selectedYearId, setSelectedYearIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshYears = useCallback(async () => {
    const rows = await api.listFinancialYears();
    setYears(rows);
    const active = rows.find((y) => y.isActive) ?? rows[0] ?? null;
    setSelectedYearIdState((prev) => {
      if (prev != null && rows.some((y) => y.id === prev)) return prev;
      return active?.id ?? null;
    });
  }, []);

  useEffect(() => {
    void refreshYears()
      .catch(() => setYears([]))
      .finally(() => setLoading(false));
  }, [refreshYears]);

  const activeYear = useMemo(
    () => years.find((y) => y.isActive) ?? null,
    [years],
  );

  const setSelectedYearId = useCallback((id: number) => {
    setSelectedYearIdState(id);
  }, []);

  const isReadOnly = useMemo(() => {
    if (activeYear == null || selectedYearId == null) return false;
    return selectedYearId !== activeYear.id;
  }, [activeYear, selectedYearId]);

  const value = useMemo(
    () => ({
      years,
      activeYear,
      selectedYearId,
      setSelectedYearId,
      isReadOnly,
      refreshYears,
      loading,
    }),
    [years, activeYear, selectedYearId, setSelectedYearId, isReadOnly, refreshYears, loading],
  );

  return <FinancialYearContext.Provider value={value}>{children}</FinancialYearContext.Provider>;
}

export function useFinancialYear() {
  const ctx = useContext(FinancialYearContext);
  if (!ctx) {
    throw new Error('useFinancialYear must be used within FinancialYearProvider');
  }
  return ctx;
}

/** Global report FY from Reports > Financial Year, unless viewing a closed-year hub. */
export function useReportFinancialYearId(historicalScope?: { financialYearId: number } | null) {
  const { activeYear, selectedYearId } = useFinancialYear();
  return historicalScope?.financialYearId ?? selectedYearId ?? activeYear?.id ?? null;
}
