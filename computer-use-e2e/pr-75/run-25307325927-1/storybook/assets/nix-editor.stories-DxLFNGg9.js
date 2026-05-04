import{j as a}from"./iframe-C-u98npA.js";import{N as n}from"./index-BuCZr0jB.js";import"./preload-helper-PPVm8Dsz.js";import"./utils-BQHNewu7.js";import"./tauri-api-D1Fxi4AQ.js";import"./loader-circle-CG1XW3ak.js";const l={component:n,title:"Components/NixEditor",decorators:[s=>a.jsx("div",{className:"h-[500px] w-[700px] overflow-hidden rounded-lg border border-border bg-background",children:a.jsx(s,{})})]},r={args:{filePath:"flake.nix"}},e={args:{filePath:"configuration.nix"}},o={args:{filePath:"modules/homebrew.nix"}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  args: {
    filePath: "flake.nix"
  }
}`,...r.parameters?.docs?.source}}};e.parameters={...e.parameters,docs:{...e.parameters?.docs,source:{originalSource:`{
  args: {
    filePath: "configuration.nix"
  }
}`,...e.parameters?.docs?.source}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  args: {
    filePath: "modules/homebrew.nix"
  }
}`,...o.parameters?.docs?.source}}};const x=["FlakeNix","ConfigurationNix","UnknownFile"];export{e as ConfigurationNix,r as FlakeNix,o as UnknownFile,x as __namedExportsOrder,l as default};
