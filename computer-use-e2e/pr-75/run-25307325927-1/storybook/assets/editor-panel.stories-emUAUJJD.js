import{j as o,r as a,u as i}from"./iframe-C-u98npA.js";import{E as n}from"./editor-panel-BhWHvsn9.js";import"./preload-helper-PPVm8Dsz.js";import"./index-BuCZr0jB.js";import"./utils-BQHNewu7.js";import"./tauri-api-D1Fxi4AQ.js";import"./loader-circle-CG1XW3ak.js";import"./button-Cs8JYVoL.js";import"./index-CHTdBjS2.js";import"./index-CBAhRqrw.js";import"./index-LHNt3CwB.js";import"./x-BHB0f5-f.js";function s({filePath:r}){return a.useEffect(()=>(i.setState({editingFile:r}),()=>{i.setState({editingFile:null})}),[r]),o.jsx(n,{})}const S={component:s,title:"Components/EditorPanel",decorators:[r=>o.jsx("div",{className:"relative h-[600px] w-[800px] overflow-hidden rounded-lg border border-border bg-background",children:o.jsx(r,{})})]},e={args:{filePath:"flake.nix"}},t={args:{filePath:"configuration.nix"}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    filePath: "flake.nix"
  }
}`,...e.parameters?.docs?.source}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  args: {
    filePath: "configuration.nix"
  }
}`,...t.parameters?.docs?.source}}};const b=["EditingFlake","EditingConfiguration"];export{t as EditingConfiguration,e as EditingFlake,b as __namedExportsOrder,S as default};
