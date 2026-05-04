import{j as t,p as A,r as l,u as n}from"./iframe-C-u98npA.js";import{D as g}from"./widget-TJz2w2Fn.js";import"./preload-helper-PPVm8Dsz.js";import"./loader-circle-CG1XW3ak.js";import"./editor-panel-BhWHvsn9.js";import"./index-BuCZr0jB.js";import"./utils-BQHNewu7.js";import"./tauri-api-D1Fxi4AQ.js";import"./button-Cs8JYVoL.js";import"./index-CHTdBjS2.js";import"./index-CBAhRqrw.js";import"./index-LHNt3CwB.js";import"./x-BHB0f5-f.js";import"./evolve-progress-CqfmYxSQ.js";import"./check-CF8tKEk8.js";import"./chevron-down-CqVHLixH.js";import"./file-text-USzk9CW4.js";import"./circle-check-big-28P8cHPc.js";import"./hammer-YheH4sS3.js";import"./play-CE2izBV9.js";import"./rebuild-overlay-panel-ymuBuqZN.js";import"./use-rebuild-stream-bZaPyR1N.js";import"./index-BgKvAmlr.js";import"./index-tKTb_eGA.js";import"./index-CKQQGJB5.js";import"./use-summary-C7Hw7jxZ.js";import"./triangle-alert-CTpJPFe0.js";import"./terminal-BhB-bsmt.js";import"./rotate-ccw-9C-exoW9.js";import"./sparkles-BFirNw3e.js";import"./download-8URUUCW-.js";import"./select-Dxl8s-46.js";import"./index-BdQq_4o_.js";import"./index-CK7_WtWS.js";import"./index-CD2TtmNW.js";import"./index-eiDJy8c2.js";import"./index-CoO9uR_f.js";import"./Combination-D6w0BdlX.js";import"./index-DINYspHe.js";import"./index-CO_i5btI.js";import"./index-Dezg7c6w.js";import"./settings-CvVfXj7c.js";import"./dialog-Co34hKFa.js";import"./index-CW1S6uvd.js";import"./command-l29Mx239.js";import"./search-G_8IzrC6.js";import"./tabs-09gDl_Wj.js";import"./input-group-BRqNmjah.js";import"./input-B-Agm3fc.js";import"./tooltip-BJmbxATH.js";import"./info-BoB1uvcp.js";import"./ai-models-tab-CU32ZzeJ.js";import"./popover-Ck85QUQA.js";import"./git-commit-horizontal-CanBR4Du.js";import"./history-C-vU5Oou.js";import"./hover-click-popover-icon-CGXoeHJV.js";import"./config-dir-badge-BHgbpSZS.js";import"./file-badge-CdNrAozR.js";import"./folder-open-CRy-m6sE.js";import"./gitignore-badge-B4rGoizL.js";import"./file-BdSOSu91.js";import"./external-build-detected-Cr7x9IKz.js";import"./index-Bv5QQAaS.js";import"./scroll-area-ibSmoDDq.js";import"./unsummarized-changes-section-B0E64Ag2.js";import"./analyze-button-DjbnAnjC.js";import"./timeline-connector-CINJTNu0.js";import"./badge-BugI5b1r.js";import"./card-DTcOoczF.js";import"./shield-DC_eakE0.js";const y=[{id:1,hash:"abc123",filename:"configuration.nix",diff:`@@ -3,6 +3,8 @@
 {
   environment.systemPackages = with pkgs; [
     vim
+    htop
+    btop
     git
     ripgrep
     fd`,lineCount:8,createdAt:Date.now()/1e3,ownSummaryId:1},{id:2,hash:"def456",filename:"modules/monitoring.nix",diff:`@@ -0,0 +1,12 @@
+{ config, pkgs, ... }:
+
+{
+  # System monitoring tools
+  environment.systemPackages = with pkgs; [
+    htop
+    btop
+    bottom
+    bandwhich
+    procs
+  ];
+}`,lineCount:12,createdAt:Date.now()/1e3,ownSummaryId:2}],v={groups:[{summary:{id:1,title:"System Monitoring Tools",description:"Added htop, btop, bottom, bandwhich, and procs for comprehensive system monitoring. Created a dedicated monitoring module and updated the main configuration.",status:"DONE",createdAt:Date.now()/1e3},changes:[{id:1,hash:"abc123",filename:"configuration.nix",diff:"",lineCount:8,createdAt:Date.now()/1e3,ownSummaryId:1,title:"Add monitoring packages",description:"Added htop and btop to system packages"},{id:2,hash:"def456",filename:"modules/monitoring.nix",diff:"",lineCount:12,createdAt:Date.now()/1e3,ownSummaryId:2,title:"New monitoring module",description:"Dedicated module for system monitoring tools"}]}],singles:[],unsummarizedHashes:[]},u={files:[{path:"configuration.nix",changeType:"edited"},{path:"modules/monitoring.nix",changeType:"new"}],branch:"main",headIsBuilt:!1,diff:y.map(e=>e.diff).join(`
`),additions:14,deletions:0,headCommitHash:"abc1234567890",cleanHead:!1,changes:y},h={evolutionId:null,currentChangesetId:null,changesetAtBuild:null,committable:!1,backupBranch:null,step:"begin"},S={evolutionId:1,currentChangesetId:1,changesetAtBuild:null,committable:!1,backupBranch:"backup/pre-evolve-1",step:"evolve"},b={evolutionId:1,currentChangesetId:1,changesetAtBuild:1,committable:!0,backupBranch:"backup/pre-evolve-1",step:"merge"},o=[{raw:"Starting evolution...",summary:"Starting evolution",eventType:"start",iteration:null,timestampMs:0},{raw:"Iteration 1 of 25",summary:"Iteration 1",eventType:"iteration",iteration:1,timestampMs:1200},{raw:"Analyzing current configuration to understand package structure...",summary:"Thinking about changes",eventType:"thinking",iteration:1,timestampMs:2400},{raw:"read_file: configuration.nix",summary:"Reading configuration.nix",eventType:"reading",iteration:1,timestampMs:3100},{raw:"edit_file: configuration.nix — adding htop and btop",summary:"Editing configuration.nix",eventType:"editing",iteration:1,timestampMs:4500},{raw:"Creating modules/monitoring.nix with monitoring tools",summary:"Creating modules/monitoring.nix",eventType:"editing",iteration:1,timestampMs:5800},{raw:"Running nix eval to verify syntax...",summary:"Checking build",eventType:"buildCheck",iteration:1,timestampMs:7200},{raw:"Build check passed",summary:"Build passed",eventType:"buildPass",iteration:1,timestampMs:9500},{raw:"Summarizing changes...",summary:"Analyzing changes",eventType:"summarizing",iteration:null,timestampMs:10200},{raw:"Evolution complete: 2 files changed, 14 additions",summary:"Evolution complete",eventType:"complete",iteration:null,timestampMs:11800}];function c({storeState:e}){return l.useEffect(()=>{n.setState(e)},[e]),t.jsx(g,{})}function T(){const e=l.useRef([]);return l.useEffect(()=>{n.setState({evolveState:h,evolvePrompt:"Add system monitoring tools like htop and btop"});const w=setTimeout(()=>{n.setState({isGenerating:!0,evolveEvents:[o[0]]})},800);e.current.push(w);for(let i=1;i<o.length;i++){const x=setTimeout(()=>{n.setState(M=>({evolveEvents:[...M.evolveEvents,o[i]]}))},800+o[i].timestampMs);e.current.push(x)}const f=800+o[o.length-1].timestampMs+1500,E=setTimeout(()=>{n.setState({isGenerating:!1,evolveState:S,gitStatus:u,changeMap:v,summaryAvailable:!0})},f);e.current.push(E);const k=setTimeout(()=>{n.setState({evolveState:b,commitMessageSuggestion:"feat: add system monitoring tools (htop, btop, bottom, bandwhich, procs)"})},f+5e3);return e.current.push(k),()=>{for(const i of e.current)clearTimeout(i)}},[]),t.jsx(g,{})}const d=A.meta({title:"Flows/Evolve",component:g,parameters:{layout:"fullscreen"},decorators:[e=>t.jsx("div",{className:"m-8 relative min-h-[300px] min-w-[420px] overflow-hidden rounded-xl border border-border bg-background flex items-center justify-center",children:t.jsx(e,{})})]}),r=d.story({name:"1. Begin (idle)",render:()=>t.jsx(c,{storeState:{evolveState:h,gitStatus:{...u,files:[],changes:[],diff:"",additions:0,deletions:0,cleanHead:!0}}})}),a=d.story({name:"2. Evolving (progress)",render:()=>t.jsx(c,{storeState:{evolveState:h,isGenerating:!0,evolvePrompt:"Add system monitoring tools",evolveEvents:o.slice(0,7)}})}),s=d.story({name:"3. Review (changes generated)",render:()=>t.jsx(c,{storeState:{evolveState:S,gitStatus:u,changeMap:v,summaryAvailable:!0,evolveEvents:o}})}),m=d.story({name:"4. Merge (ready to commit)",render:()=>t.jsx(c,{storeState:{evolveState:b,gitStatus:u,changeMap:v,summaryAvailable:!0,commitMessageSuggestion:"feat: add system monitoring tools (htop, btop, bottom, bandwhich, procs)"}})}),p=d.story({name:"Full Flow (animated)",render:()=>t.jsx(T,{})});r.input.parameters={...r.input.parameters,docs:{...r.input.parameters?.docs,source:{originalSource:`meta.story({
  name: "1. Begin (idle)",
  render: () => <WidgetWithState storeState={{
    evolveState: evolveStateBegin,
    gitStatus: {
      ...mockGitStatus,
      files: [],
      changes: [],
      diff: "",
      additions: 0,
      deletions: 0,
      cleanHead: true
    }
  }} />
})`,...r.input.parameters?.docs?.source},description:{story:'Step 1: Idle state — prompt input and "Get started" message.',...r.input.parameters?.docs?.description}}};a.input.parameters={...a.input.parameters,docs:{...a.input.parameters?.docs,source:{originalSource:`meta.story({
  name: "2. Evolving (progress)",
  render: () => <WidgetWithState storeState={{
    evolveState: evolveStateBegin,
    isGenerating: true,
    evolvePrompt: "Add system monitoring tools",
    evolveEvents: mockEvolveEvents.slice(0, 7)
  }} />
})`,...a.input.parameters?.docs?.source},description:{story:"Step 2: Evolve overlay with streaming progress events.",...a.input.parameters?.docs?.description}}};s.input.parameters={...s.input.parameters,docs:{...s.input.parameters?.docs,source:{originalSource:`meta.story({
  name: "3. Review (changes generated)",
  render: () => <WidgetWithState storeState={{
    evolveState: evolveStateEvolve,
    gitStatus: mockGitStatus,
    changeMap: mockChangeMap,
    summaryAvailable: true,
    evolveEvents: mockEvolveEvents
  }} />
})`,...s.input.parameters?.docs?.source},description:{story:"Step 3: Evolution complete — summary/diff of changes with Discard / Build & Test buttons.",...s.input.parameters?.docs?.description}}};m.input.parameters={...m.input.parameters,docs:{...m.input.parameters?.docs,source:{originalSource:`meta.story({
  name: "4. Merge (ready to commit)",
  render: () => <WidgetWithState storeState={{
    evolveState: evolveStateMerge,
    gitStatus: mockGitStatus,
    changeMap: mockChangeMap,
    summaryAvailable: true,
    commitMessageSuggestion: "feat: add system monitoring tools (htop, btop, bottom, bandwhich, procs)"
  }} />
})`,...m.input.parameters?.docs?.source},description:{story:"Step 4: After Build & Test — merge step with commit message and Commit button.",...m.input.parameters?.docs?.description}}};p.input.parameters={...p.input.parameters,docs:{...p.input.parameters?.docs,source:{originalSource:`meta.story({
  name: "Full Flow (animated)",
  render: () => <AnimatedEvolveFlow />
})`,...p.input.parameters?.docs?.source},description:{story:"Animated walkthrough: begin -> evolving -> review -> merge, auto-advancing over ~20s.",...p.input.parameters?.docs?.description}}};const Je=["Begin","Evolving","Review","Merge","FullFlowAnimated"];export{r as Begin,a as Evolving,p as FullFlowAnimated,m as Merge,s as Review,Je as __namedExportsOrder,d as default};
