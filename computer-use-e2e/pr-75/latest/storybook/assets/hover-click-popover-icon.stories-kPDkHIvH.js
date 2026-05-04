import{j as e,p as c}from"./iframe-C-u98npA.js";import{H as i}from"./hover-click-popover-icon-CGXoeHJV.js";import{S as a}from"./shield-DC_eakE0.js";import{T as p}from"./triangle-alert-CTpJPFe0.js";import"./preload-helper-PPVm8Dsz.js";import"./popover-Ck85QUQA.js";import"./index-CK7_WtWS.js";import"./index-tKTb_eGA.js";import"./index-CKQQGJB5.js";import"./index-CBAhRqrw.js";import"./index-CoO9uR_f.js";import"./Combination-D6w0BdlX.js";import"./index-DINYspHe.js";import"./index-CO_i5btI.js";import"./index-CW1S6uvd.js";import"./utils-BQHNewu7.js";import"./info-BoB1uvcp.js";const s=c.meta({title:"UI/HoverClickPopoverIcon",component:i,parameters:{layout:"centered"},tags:["autodocs"]}),r=s.story({render:()=>e.jsx(i,{children:e.jsx("p",{children:"Hover or click to see this content."})})}),o=s.story({render:()=>e.jsxs(i,{icon:a,children:[e.jsx("p",{className:"font-medium mb-1",children:"Privacy note"}),e.jsx("p",{children:"Files listed in .gitignore are never touched by nixmac."})]})}),t=s.story({render:()=>e.jsxs(i,{icon:p,children:[e.jsx("p",{className:"font-medium mb-1",children:"Heads up"}),e.jsx("p",{children:"This action cannot be undone. Make sure you have a backup."})]})}),n=s.story({render:()=>e.jsxs("p",{className:"text-muted-foreground text-xs flex items-center gap-1",children:["Content may be seen by your AI provider"," ",e.jsx(i,{children:e.jsx("p",{children:"Files listed in .gitignore are excluded from analysis and edits."})})]})});r.input.parameters={...r.input.parameters,docs:{...r.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <HoverClickPopoverIcon>
      <p>Hover or click to see this content.</p>
    </HoverClickPopoverIcon>
})`,...r.input.parameters?.docs?.source},description:{story:"Default info icon with simple text content",...r.input.parameters?.docs?.description}}};o.input.parameters={...o.input.parameters,docs:{...o.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <HoverClickPopoverIcon icon={Shield}>
      <p className="font-medium mb-1">Privacy note</p>
      <p>Files listed in .gitignore are never touched by nixmac.</p>
    </HoverClickPopoverIcon>
})`,...o.input.parameters?.docs?.source},description:{story:"Custom icon",...o.input.parameters?.docs?.description}}};t.input.parameters={...t.input.parameters,docs:{...t.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <HoverClickPopoverIcon icon={AlertTriangle}>
      <p className="font-medium mb-1">Heads up</p>
      <p>This action cannot be undone. Make sure you have a backup.</p>
    </HoverClickPopoverIcon>
})`,...t.input.parameters?.docs?.source},description:{story:"Warning icon with richer content",...t.input.parameters?.docs?.description}}};n.input.parameters={...n.input.parameters,docs:{...n.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <p className="text-muted-foreground text-xs flex items-center gap-1">
      Content may be seen by your AI provider{" "}
      <HoverClickPopoverIcon>
        <p>Files listed in .gitignore are excluded from analysis and edits.</p>
      </HoverClickPopoverIcon>
    </p>
})`,...n.input.parameters?.docs?.source},description:{story:"Shown inline next to text, as used in the directory picker",...n.input.parameters?.docs?.description}}};const S=["Default","CustomIcon","WithWarningIcon","InlineWithText"];export{o as CustomIcon,r as Default,n as InlineWithText,t as WithWarningIcon,S as __namedExportsOrder,s as default};
