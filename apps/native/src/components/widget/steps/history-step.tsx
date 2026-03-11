import { useHistory } from "@/hooks/use-history";
import { useWidgetStore } from "@/stores/widget-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { groupByDay } from "@/components/widget/utils";
import { HistoryDayLabel } from "@/components/widget/history-day-label";
import { HistoryHeader } from "@/components/widget/history-header";
import { HistoryItemCard } from "@/components/widget/history-item-card";

export function HistoryStep() {
  const { generateFrom } = useHistory();
  const history = useWidgetStore((state) => state.history);
  const historyLoading = useWidgetStore((state) => state.historyLoading);

  if (historyLoading) return <p>Loading...</p>;

  const newest = history[0];
  const historyByDay = groupByDay(history);

  return (
    <>
      <HistoryHeader
        count={history.length}
        onGenerateAll={newest ? () => generateFrom(newest.hash, 10) : null}
      />
      <ScrollArea className="flex-1 pb-3">
        {historyByDay.map(({ label, items }) => (
          <div key={label}>
            <HistoryDayLabel label={label} />
            {items.map((item) => (
              <HistoryItemCard key={item.hash} item={item} onGenerateFrom={generateFrom} />
            ))}
          </div>
        ))}
      </ScrollArea>
    </>
  );
}
