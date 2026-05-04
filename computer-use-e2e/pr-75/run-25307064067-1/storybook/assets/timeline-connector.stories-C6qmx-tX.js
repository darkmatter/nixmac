import{j as e,p as n}from"./iframe-C-u98npA.js";import{T as i,a as t,H as r}from"./timeline-connector-CINJTNu0.js";import"./preload-helper-PPVm8Dsz.js";import"./utils-BQHNewu7.js";const a=n.meta({title:"Widget/History/TimelineConnector",component:t,parameters:{layout:"centered"},tags:["autodocs"]}),s=a.story({render:()=>e.jsxs("div",{className:"flex flex-col gap-6 rounded-lg border bg-background p-6",children:[e.jsxs("div",{className:"group flex items-start",children:[e.jsx(i,{}),e.jsx(t,{isInteractive:!0,isUndone:!1}),e.jsx("div",{className:"ml-3 text-sm",children:"Completed commit"})]}),e.jsxs("div",{className:"group flex items-start",children:[e.jsx(i,{isUndone:!0}),e.jsx(t,{isInteractive:!0,isUndone:!0}),e.jsx("div",{className:"ml-3 text-sm",children:"Restore boundary"})]}),e.jsxs("div",{className:"group flex items-start",children:[e.jsx(i,{isUndone:!0}),e.jsx(t,{isInteractive:!0,isPreviewActive:!0,isUndone:!0}),e.jsx("div",{className:"ml-3 text-sm",children:"Preview cut"})]}),e.jsxs("div",{className:"relative h-24 pl-8",children:[e.jsx(r,{timeline:{isFirst:!1,isLast:!1,isUndone:!1,bottomFadeToUndone:!0,topFadeFromUndone:!1}}),e.jsx("span",{className:"text-muted-foreground text-sm",children:"Vertical timeline segment"})]})]})});s.input.parameters={...s.input.parameters,docs:{...s.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <div className="flex flex-col gap-6 rounded-lg border bg-background p-6">
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
        <HistoryItemTimeline timeline={{
        isFirst: false,
        isLast: false,
        isUndone: false,
        bottomFadeToUndone: true,
        topFadeFromUndone: false
      }} />
        <span className="text-muted-foreground text-sm">Vertical timeline segment</span>
      </div>
    </div>
})`,...s.input.parameters?.docs?.source}}};const c=["States"];export{s as States,c as __namedExportsOrder,a as default};
