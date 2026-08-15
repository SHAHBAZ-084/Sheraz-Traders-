import { FieldLabel } from '../ui/PageShell';
import { SearchSelect } from '../ui/SearchSelect';
import { useFinancialYear } from '../../contexts/FinancialYearContext';

export function ReportFinancialYearSelect({ className = '' }: { className?: string }) {
  const { years, selectedYearId, setSelectedYearId, loading, isReadOnly } = useFinancialYear();

  if (loading || years.length === 0) return null;

  return (
    <div className={className}>
      <FieldLabel>Financial Year</FieldLabel>
      <SearchSelect
        value={selectedYearId != null ? String(selectedYearId) : ''}
        onChange={(value) => setSelectedYearId(Number(value))}
        options={years.map((y) => ({
          value: String(y.id),
          label: y.isActive ? `${y.label} (current)` : y.label,
        }))}
        placeholder="Select financial year"
      />
      {isReadOnly ? (
        <p className="mt-1 text-xs text-textMuted">Viewing a closed year — read-only.</p>
      ) : null}
    </div>
  );
}
