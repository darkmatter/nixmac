import{j as e,p as i}from"./iframe-C-u98npA.js";import{A as n,D as p}from"./analyze-button-DjbnAnjC.js";import{L as c}from"./loader-circle-CG1XW3ak.js";import"./preload-helper-PPVm8Dsz.js";import"./button-Cs8JYVoL.js";import"./index-CHTdBjS2.js";import"./index-CBAhRqrw.js";import"./index-LHNt3CwB.js";import"./utils-BQHNewu7.js";const o=i.meta({title:"Widget/Summaries/AnalyzeButton",component:n,parameters:{layout:"centered"},tags:["autodocs"]}),t=o.story({render:()=>e.jsxs(n,{onClick:()=>{},children:[e.jsx(p,{className:"h-[10px] w-[10px]"}),"Analyze"]})}),a=o.story({render:()=>e.jsxs(n,{disabled:!0,children:[e.jsx(c,{className:"h-[10px] w-[10px] animate-spin"}),"Analyzing…"]})}),r=o.story({render:()=>e.jsxs(n,{onClick:()=>{},children:[e.jsx(p,{className:"h-[10px] w-[10px]"}),"Analyze recent (3)"]})}),s=o.story({render:()=>e.jsxs(n,{onClick:()=>{},children:[e.jsx(p,{className:"h-[10px] w-[10px]"}),"Update"]})});t.input.parameters={...t.input.parameters,docs:{...t.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <AnalyzeButton onClick={() => {}}>
      <Dna className="h-[10px] w-[10px]" />
      Analyze
    </AnalyzeButton>
})`,...t.input.parameters?.docs?.source}}};a.input.parameters={...a.input.parameters,docs:{...a.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <AnalyzeButton disabled>
      <Loader2 className="h-[10px] w-[10px] animate-spin" />
      Analyzing…
    </AnalyzeButton>
})`,...a.input.parameters?.docs?.source}}};r.input.parameters={...r.input.parameters,docs:{...r.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <AnalyzeButton onClick={() => {}}>
      <Dna className="h-[10px] w-[10px]" />
      Analyze recent (3)
    </AnalyzeButton>
})`,...r.input.parameters?.docs?.source}}};s.input.parameters={...s.input.parameters,docs:{...s.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <AnalyzeButton onClick={() => {}}>
      <Dna className="h-[10px] w-[10px]" />
      Update
    </AnalyzeButton>
})`,...s.input.parameters?.docs?.source}}};const g=["Idle","Loading","WithCount","Update"];export{t as Idle,a as Loading,s as Update,r as WithCount,g as __namedExportsOrder,o as default};
