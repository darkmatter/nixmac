import{p as c,r as p,u as m,j as d}from"./iframe-C-u98npA.js";import{E as u}from"./external-build-detected-Cr7x9IKz.js";import"./preload-helper-PPVm8Dsz.js";import"./utils-BQHNewu7.js";import"./loader-circle-CG1XW3ak.js";import"./tauri-api-D1Fxi4AQ.js";import"./use-rebuild-stream-bZaPyR1N.js";import"./index-BgKvAmlr.js";import"./index-tKTb_eGA.js";import"./index-CKQQGJB5.js";import"./hammer-YheH4sS3.js";typeof window<"u"&&(window.__TAURI_INTERNALS__={invoke:async o=>(console.log("Mock Tauri invoke:",o),null)});const n=c.meta({title:"Widget/ExternalBuildDetected",component:u,parameters:{layout:"padded"},tags:["autodocs"]}),l={evolutionId:42,currentChangesetId:null,committable:!1,backupBranch:null,step:"evolve"};function i({externalBuildDetected:o,evolveState:s}){return p.useEffect(()=>{const a=m.getState();a.setExternalBuildDetected(o),a.setEvolveState(s)},[o,s]),d.jsx("div",{className:"w-[400px] border border-border rounded",children:d.jsx(u,{})})}const e=n.story({render:()=>i({externalBuildDetected:!0,evolveState:l})}),t=n.story({render:()=>i({externalBuildDetected:!1,evolveState:l})}),r=n.story({render:()=>i({externalBuildDetected:!0,evolveState:null})});e.input.parameters={...e.input.parameters,docs:{...e.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => setup({
    externalBuildDetected: true,
    evolveState: mockEvolveState
  })
})`,...e.input.parameters?.docs?.source},description:{story:"Default — banner is visible: external build detected during an active evolution.",...e.input.parameters?.docs?.description}}};t.input.parameters={...t.input.parameters,docs:{...t.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => setup({
    externalBuildDetected: false,
    evolveState: mockEvolveState
  })
})`,...t.input.parameters?.docs?.source},description:{story:"Hidden — no external build detected, component renders nothing.",...t.input.parameters?.docs?.description}}};r.input.parameters={...r.input.parameters,docs:{...r.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => setup({
    externalBuildDetected: true,
    evolveState: null
  })
})`,...r.input.parameters?.docs?.source},description:{story:"Hidden — external build detected but no active evolution, component renders nothing.",...r.input.parameters?.docs?.description}}};const N=["Visible","HiddenNoBuild","HiddenNoEvolution"];export{t as HiddenNoBuild,r as HiddenNoEvolution,e as Visible,N as __namedExportsOrder,n as default};
