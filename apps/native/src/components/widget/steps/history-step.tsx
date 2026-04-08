import { useEffect } from "react";
import { useHistory } from "@/hooks/use-history";
import { useWidgetStore } from "@/stores/widget-store";
import { ScrollArea } from "@/components/ui/scroll-area";
import { groupByDay } from "@/components/widget/utils";
import { HistoryDayLabel } from "@/components/widget/history-day-label";
import { HistoryHeader } from "@/components/widget/history-header";
import { HistoryItemCard } from "@/components/widget/history-item-card";

export function HistoryStep() {
  const { loadHistory } = useHistory();
  const history = useWidgetStore((state) => state.history);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const historyByDay = groupByDay(history);

  return (
    <>
      <HistoryHeader count={history.length} />
      <ScrollArea className="flex-1 pb-3">
        {historyByDay.map(({ label, items }) => (
          <div key={label}>
            <HistoryDayLabel label={label} />
            {items.map((item) => (
              <HistoryItemCard key={item.hash} item={item} />
            ))}
          </div>
        ))}
      </ScrollArea>
    </>
  );
}
