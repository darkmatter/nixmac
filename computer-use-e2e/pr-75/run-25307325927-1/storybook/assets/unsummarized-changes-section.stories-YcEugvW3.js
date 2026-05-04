import{p as l,r as y,u as x,j as c}from"./iframe-C-u98npA.js";import{U as h}from"./unsummarized-changes-section-B0E64Ag2.js";import"./preload-helper-PPVm8Dsz.js";import"./utils-BQHNewu7.js";import"./config-dir-badge-BHgbpSZS.js";import"./file-badge-CdNrAozR.js";import"./folder-open-CRy-m6sE.js";import"./analyze-button-DjbnAnjC.js";import"./button-Cs8JYVoL.js";import"./index-CHTdBjS2.js";import"./index-CBAhRqrw.js";import"./index-LHNt3CwB.js";import"./use-summary-C7Hw7jxZ.js";import"./tauri-api-D1Fxi4AQ.js";import"./loader-circle-CG1XW3ak.js";typeof window<"u"&&(window.__TAURI_INTERNALS__={invoke:async n=>(console.log("Mock Tauri invoke:",n),null)});const p=l.meta({title:"Widget/Summaries/UnsummarizedChangesSection",component:h,parameters:{layout:"padded"},tags:["autodocs"]});function e(n,s,m,o){return{id:n,hash:`hash${n}`,filename:s,diff:"",lineCount:4,createdAt:Date.now(),ownSummaryId:null,changeType:m,shortFilename:s.split("/").at(-1)??s,oldFilename:o}}const g=[e(1,"modules/darwin/packages.nix","edited"),e(2,"modules/darwin/fonts.nix","new"),e(3,"modules/home/shell.nix","removed"),e(4,"modules/darwin/terminal.nix","edited")],w=[e(1,"modules/darwin/packages.nix","edited"),e(2,"modules/darwin/brew.nix","renamed","modules/darwin/homebrew.nix"),e(3,"home.nix","new")],u={groups:[],singles:[],unsummarizedHashes:["hash1","hash2","hash3"]},C={groups:[{summary:{id:1,title:"Add fonts",description:"",status:"DONE",createdAt:0},changes:[]}],singles:[],unsummarizedHashes:["hash1"]};function d({changes:n,changeMap:s,configDir:m="/Users/user/.config/nixpkgs"}){return y.useEffect(()=>{const o=x.getState();o.setChangeMap(s),o.setConfigDir(m)},[]),c.jsx("div",{className:"w-[480px] rounded border border-border bg-background",children:c.jsx(h,{changes:n})})}const a=p.story({render:()=>d({changes:g,changeMap:u})}),r=p.story({render:()=>d({changes:g,changeMap:C})}),t=p.story({render:()=>d({changes:w,changeMap:u})}),i=p.story({render:()=>d({changes:[e(1,"flake.nix","edited")],changeMap:{...u,unsummarizedHashes:["hash1"]}})});a.input.parameters={...a.input.parameters,docs:{...a.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => setup({
    changes: mixedChanges,
    changeMap: emptyChangeMap
  })
})`,...a.input.parameters?.docs?.source},description:{story:'Mixed change types — no prior summaries ("Manual Changes found in").',...a.input.parameters?.docs?.description}}};r.input.parameters={...r.input.parameters,docs:{...r.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => setup({
    changes: mixedChanges,
    changeMap: partialChangeMap
  })
})`,...r.input.parameters?.docs?.source},description:{story:'Mixed types alongside existing summaries — header says "Also in".',...r.input.parameters?.docs?.description}}};t.input.parameters={...t.input.parameters,docs:{...t.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => setup({
    changes: withRenameChanges,
    changeMap: emptyChangeMap
  })
})`,...t.input.parameters?.docs?.source},description:{story:"Includes a renamed file shown with old → new path arrow.",...t.input.parameters?.docs?.description}}};i.input.parameters={...i.input.parameters,docs:{...i.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => setup({
    changes: [makeChange(1, "flake.nix", "edited")],
    changeMap: {
      ...emptyChangeMap,
      unsummarizedHashes: ["hash1"]
    }
  })
})`,...i.input.parameters?.docs?.source},description:{story:"Single change — minimal state.",...i.input.parameters?.docs?.description}}};const N=["OnlyUnsummarized","AlsoUnsummarized","WithRename","Single"];export{r as AlsoUnsummarized,a as OnlyUnsummarized,i as Single,t as WithRename,N as __namedExportsOrder,p as default};
