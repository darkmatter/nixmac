import { useHistory } from "@/hooks/use-history";
import { useWidgetStore } from "@/stores/widget-store";
import type { SummaryResponse } from "@/tauri-api";

export function HistoryStep() {
  const { generateFrom } = useHistory();
  const history = useWidgetStore((state) => state.history);
  const historyLoading = useWidgetStore((state) => state.historyLoading);

  if (historyLoading) return <p>Loading...</p>;

  const newest = history[0];

  return (
    <div>
      {newest && (
        <button type="button" onClick={() => generateFrom(newest.hash, history.length)}>
          Generate all
        </button>
      )}
      {history.map((item) => {
        const summary = item.summary
          ? (JSON.parse(item.summary.contentJson) as SummaryResponse)
          : null;

        return (
          <div key={item.hash}>
            <p>{item.hash}</p>
            <p>{item.message ?? "(no message)"}</p>
            <p>{new Date(item.createdAt * 1000).toLocaleString()}</p>
            {summary ? (
              <div>
                {summary.items.map((si) => (
                  <p key={si.title}>
                    {si.title}: {si.description}
                  </p>
                ))}
              </div>
            ) : (
              <button type="button" onClick={() => generateFrom(item.hash, 1)}>
                Generate summary
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
