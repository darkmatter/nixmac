import{r as y,u as l,j as g}from"./iframe-C-u98npA.js";import{R as x}from"./rebuild-overlay-panel-ymuBuqZN.js";import"./preload-helper-PPVm8Dsz.js";import"./button-Cs8JYVoL.js";import"./index-CHTdBjS2.js";import"./index-CBAhRqrw.js";import"./index-LHNt3CwB.js";import"./utils-BQHNewu7.js";import"./use-rebuild-stream-bZaPyR1N.js";import"./tauri-api-D1Fxi4AQ.js";import"./index-BgKvAmlr.js";import"./index-tKTb_eGA.js";import"./index-CKQQGJB5.js";import"./use-summary-C7Hw7jxZ.js";import"./triangle-alert-CTpJPFe0.js";import"./terminal-BhB-bsmt.js";import"./x-BHB0f5-f.js";import"./rotate-ccw-9C-exoW9.js";import"./circle-check-big-28P8cHPc.js";import"./sparkles-BFirNw3e.js";import"./hammer-YheH4sS3.js";import"./download-8URUUCW-.js";import"./play-CE2izBV9.js";const e=f=>{const p={isRunning:!1,context:"apply",lines:[],rawLines:[],exitCode:void 0,success:void 0,errorType:void 0,errorMessage:void 0};return m=>(y.useEffect(()=>(l.setState({rebuild:{...p,...f}}),()=>{l.setState({rebuild:p})}),[]),g.jsx("div",{style:{width:280,height:400,position:"relative"},children:g.jsx(m,{})}))},K={title:"Components/RebuildOverlayPanel",component:x,parameters:{layout:"centered",backgrounds:{default:"dark",values:[{name:"dark",value:"#1a1a2e"}]}},tags:["autodocs"]},b=[{id:1,text:"🚀 Starting rebuild...",type:"info"}],h=[{id:1,text:"🚀 Starting rebuild...",type:"info"},{id:2,text:"📦 Evaluating flake configuration",type:"info"},{id:3,text:"🔨 Building 12 packages",type:"info"}],S=[{id:1,text:"🚀 Starting rebuild...",type:"info"},{id:2,text:"📦 Evaluating flake configuration",type:"info"},{id:3,text:"🔨 Building 12 packages",type:"info"},{id:4,text:"📥 Fetching dependencies from cache",type:"info"},{id:5,text:"⚡ Compiling neovim plugins",type:"info"}],R=[{id:1,text:"🚀 Starting rebuild...",type:"info"},{id:2,text:"📦 Evaluating flake configuration",type:"info"},{id:3,text:"🔨 Building 12 packages",type:"info"},{id:4,text:"📥 Fetching dependencies from cache",type:"info"},{id:5,text:"⚡ Compiling neovim plugins",type:"info"},{id:6,text:"🔧 Activating system configuration",type:"info"},{id:7,text:"✅ Rebuild complete!",type:"info"}],u=[{id:1,text:"🚀 Starting rebuild...",type:"info"},{id:2,text:"📦 Evaluating flake configuration",type:"info"},{id:3,text:"❌ Build failed: infinite recursion",type:"stderr"}],i={decorators:[e({isRunning:!0,lines:b})]},r={decorators:[e({isRunning:!0,lines:h})]},t={decorators:[e({isRunning:!0,lines:S})]},n={decorators:[e({isRunning:!1,lines:R,success:!0})]},s={decorators:[e({isRunning:!1,lines:u,success:!1,errorType:"infinite_recursion",errorMessage:"error: infinite recursion encountered at /nix/store/...-source/flake.nix:42"})]},o={decorators:[e({isRunning:!1,lines:u,success:!1,errorType:"evaluation_error",errorMessage:"error: attribute 'missing-package' not found at /nix/store/...-source/configuration.nix:15"})]},a={decorators:[e({isRunning:!1,lines:[{id:1,text:"🚀 Starting rebuild...",type:"info"},{id:2,text:"📦 Evaluating flake configuration",type:"info"},{id:3,text:"🔨 Building packages...",type:"info"},{id:4,text:"❌ Package build failed",type:"stderr"}],success:!1,errorType:"build_error",errorMessage:"builder for '/nix/store/abc123-some-package.drv' failed with exit code 1"})]},d={decorators:[e({isRunning:!1,lines:u,success:!1,errorType:"generic_error",errorMessage:"An unexpected error occurred during the rebuild process"})]},c={decorators:[e({isRunning:!0,lines:[{id:1,text:"🚀 Starting rebuild...",type:"info"},{id:2,text:"📦 Evaluating flake configuration",type:"info"},{id:3,text:"🔨 Building 24 packages",type:"info"},{id:4,text:"📥 Fetching from binary cache",type:"info"},{id:5,text:"⚡ Compiling neovim",type:"info"},{id:6,text:"🔧 Building home-manager",type:"info"},{id:7,text:"📦 Installing ripgrep",type:"info"},{id:8,text:"🎯 Configuring git",type:"info"},{id:9,text:"✨ Setting up zsh plugins",type:"info"},{id:10,text:"🔨 Building starship prompt",type:"info"}]})]};i.parameters={...i.parameters,docs:{...i.parameters?.docs,source:{originalSource:`{
  decorators: [withRebuildState({
    isRunning: true,
    lines: startingLines
  })]
}`,...i.parameters?.docs?.source},description:{story:"Initial state when rebuild just started",...i.parameters?.docs?.description}}};r.parameters={...r.parameters,docs:{...r.parameters?.docs,source:{originalSource:`{
  decorators: [withRebuildState({
    isRunning: true,
    lines: buildingLines
  })]
}`,...r.parameters?.docs?.source},description:{story:"Building state with a few progress lines",...r.parameters?.docs?.description}}};t.parameters={...t.parameters,docs:{...t.parameters?.docs,source:{originalSource:`{
  decorators: [withRebuildState({
    isRunning: true,
    lines: midBuildLines
  })]
}`,...t.parameters?.docs?.source},description:{story:"Mid-build state with more progress",...t.parameters?.docs?.description}}};n.parameters={...n.parameters,docs:{...n.parameters?.docs,source:{originalSource:`{
  decorators: [withRebuildState({
    isRunning: false,
    lines: completedLines,
    success: true
  })]
}`,...n.parameters?.docs?.source},description:{story:"Successfully completed rebuild",...n.parameters?.docs?.description}}};s.parameters={...s.parameters,docs:{...s.parameters?.docs,source:{originalSource:`{
  decorators: [withRebuildState({
    isRunning: false,
    lines: errorLines,
    success: false,
    errorType: "infinite_recursion",
    errorMessage: "error: infinite recursion encountered at /nix/store/...-source/flake.nix:42"
  })]
}`,...s.parameters?.docs?.source},description:{story:"Failed with infinite recursion error",...s.parameters?.docs?.description}}};o.parameters={...o.parameters,docs:{...o.parameters?.docs,source:{originalSource:`{
  decorators: [withRebuildState({
    isRunning: false,
    lines: errorLines,
    success: false,
    errorType: "evaluation_error",
    errorMessage: "error: attribute 'missing-package' not found at /nix/store/...-source/configuration.nix:15"
  })]
}`,...o.parameters?.docs?.source},description:{story:"Failed with evaluation error",...o.parameters?.docs?.description}}};a.parameters={...a.parameters,docs:{...a.parameters?.docs,source:{originalSource:`{
  decorators: [withRebuildState({
    isRunning: false,
    lines: [{
      id: 1,
      text: "🚀 Starting rebuild...",
      type: "info"
    }, {
      id: 2,
      text: "📦 Evaluating flake configuration",
      type: "info"
    }, {
      id: 3,
      text: "🔨 Building packages...",
      type: "info"
    }, {
      id: 4,
      text: "❌ Package build failed",
      type: "stderr"
    }],
    success: false,
    errorType: "build_error",
    errorMessage: "builder for '/nix/store/abc123-some-package.drv' failed with exit code 1"
  })]
}`,...a.parameters?.docs?.source},description:{story:"Failed with build error",...a.parameters?.docs?.description}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  decorators: [withRebuildState({
    isRunning: false,
    lines: errorLines,
    success: false,
    errorType: "generic_error",
    errorMessage: "An unexpected error occurred during the rebuild process"
  })]
}`,...d.parameters?.docs?.source},description:{story:"Failed with generic error",...d.parameters?.docs?.description}}};c.parameters={...c.parameters,docs:{...c.parameters?.docs,source:{originalSource:`{
  decorators: [withRebuildState({
    isRunning: true,
    lines: [{
      id: 1,
      text: "🚀 Starting rebuild...",
      type: "info"
    }, {
      id: 2,
      text: "📦 Evaluating flake configuration",
      type: "info"
    }, {
      id: 3,
      text: "🔨 Building 24 packages",
      type: "info"
    }, {
      id: 4,
      text: "📥 Fetching from binary cache",
      type: "info"
    }, {
      id: 5,
      text: "⚡ Compiling neovim",
      type: "info"
    }, {
      id: 6,
      text: "🔧 Building home-manager",
      type: "info"
    }, {
      id: 7,
      text: "📦 Installing ripgrep",
      type: "info"
    }, {
      id: 8,
      text: "🎯 Configuring git",
      type: "info"
    }, {
      id: 9,
      text: "✨ Setting up zsh plugins",
      type: "info"
    }, {
      id: 10,
      text: "🔨 Building starship prompt",
      type: "info"
    }]
  })]
}`,...c.parameters?.docs?.source},description:{story:"Many lines to test scrolling behavior",...c.parameters?.docs?.description}}};const N=["Starting","Building","MidBuild","Success","InfiniteRecursionError","EvaluationError","BuildError","GenericError","ManyLines"];export{a as BuildError,r as Building,o as EvaluationError,d as GenericError,s as InfiniteRecursionError,c as ManyLines,t as MidBuild,i as Starting,n as Success,N as __namedExportsOrder,K as default};
