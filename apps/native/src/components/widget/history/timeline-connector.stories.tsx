// @ts-nocheck - Storybook 10 alpha types have inference issues (resolves to `never`)
import preview from "#storybook/preview";
import { HistoryItemTimeline, TimelineDot, TimeLineConnector } from "./timeline-connector";

const meta = preview.meta({
  title: "Widget/History/TimelineConnector",
  component: TimeLineConnector,
  parameters: { layout: "centered" },
  tags: ["autodocs"],
});

export default meta;

export const States = meta.story({
  render: () => (
    <div className="flex flex-col gap-6 rounded-lg border bg-background p-6">
      <div className="group flex items-start">
        <TimelineDot />
        <TimeLineConnector isInteractive isUndone={false} />
        <div className="ml-3 text-sm">Completed commit</div>
      </div>
      <div className="group flex items-start">
        <TimelineDot isUndone />
        <TimeLineConnector isInteractive isUndone />
        <div className="ml-3 text-sm">Restore boundary</div>
      </div>
      <div className="group flex items-start">
        <TimelineDot isUndone />
        <TimeLineConnector isInteractive isPreviewActive isUndone />
        <div className="ml-3 text-sm">Preview cut</div>
      </div>
      <div className="relative h-24 pl-8">
        <HistoryItemTimeline
          timeline={{
            isFirst: false,
            isLast: false,
            isUndone: false,
            bottomFadeToUndone: true,
            topFadeFromUndone: false,
          }}
        />
        <span className="text-muted-foreground text-sm">Vertical timeline segment</span>
      </div>
    </div>
  ),
});
