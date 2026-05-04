import{j as o,p as T,r as U,u as A}from"./iframe-C-u98npA.js";import{P as I}from"./permissions-screen-DF_o1lHM.js";import{f as j}from"./index-ClYFKAFl.js";import{D as b}from"./widget-TJz2w2Fn.js";import"./preload-helper-PPVm8Dsz.js";import"./icon-title-description-card-coRLXrLt.js";import"./utils-BQHNewu7.js";import"./icon-title-subtitle-BVxEDBsN.js";import"./button-Cs8JYVoL.js";import"./index-CHTdBjS2.js";import"./index-CBAhRqrw.js";import"./index-LHNt3CwB.js";import"./card-DTcOoczF.js";import"./loader-circle-CG1XW3ak.js";import"./editor-panel-BhWHvsn9.js";import"./index-BuCZr0jB.js";import"./tauri-api-D1Fxi4AQ.js";import"./x-BHB0f5-f.js";import"./evolve-progress-CqfmYxSQ.js";import"./check-CF8tKEk8.js";import"./chevron-down-CqVHLixH.js";import"./file-text-USzk9CW4.js";import"./circle-check-big-28P8cHPc.js";import"./hammer-YheH4sS3.js";import"./play-CE2izBV9.js";import"./rebuild-overlay-panel-ymuBuqZN.js";import"./use-rebuild-stream-bZaPyR1N.js";import"./index-BgKvAmlr.js";import"./index-tKTb_eGA.js";import"./index-CKQQGJB5.js";import"./use-summary-C7Hw7jxZ.js";import"./triangle-alert-CTpJPFe0.js";import"./terminal-BhB-bsmt.js";import"./rotate-ccw-9C-exoW9.js";import"./sparkles-BFirNw3e.js";import"./download-8URUUCW-.js";import"./select-Dxl8s-46.js";import"./index-BdQq_4o_.js";import"./index-CK7_WtWS.js";import"./index-CD2TtmNW.js";import"./index-eiDJy8c2.js";import"./index-CoO9uR_f.js";import"./Combination-D6w0BdlX.js";import"./index-DINYspHe.js";import"./index-CO_i5btI.js";import"./index-Dezg7c6w.js";import"./settings-CvVfXj7c.js";import"./dialog-Co34hKFa.js";import"./index-CW1S6uvd.js";import"./command-l29Mx239.js";import"./search-G_8IzrC6.js";import"./tabs-09gDl_Wj.js";import"./input-group-BRqNmjah.js";import"./input-B-Agm3fc.js";import"./tooltip-BJmbxATH.js";import"./info-BoB1uvcp.js";import"./ai-models-tab-CU32ZzeJ.js";import"./popover-Ck85QUQA.js";import"./git-commit-horizontal-CanBR4Du.js";import"./history-C-vU5Oou.js";import"./hover-click-popover-icon-CGXoeHJV.js";import"./config-dir-badge-BHgbpSZS.js";import"./file-badge-CdNrAozR.js";import"./folder-open-CRy-m6sE.js";import"./gitignore-badge-B4rGoizL.js";import"./file-BdSOSu91.js";import"./external-build-detected-Cr7x9IKz.js";import"./index-Bv5QQAaS.js";import"./scroll-area-ibSmoDDq.js";import"./unsummarized-changes-section-B0E64Ag2.js";import"./analyze-button-DjbnAnjC.js";import"./timeline-connector-CINJTNu0.js";import"./badge-BugI5b1r.js";import"./shield-DC_eakE0.js";typeof window<"u"&&(window.__TAURI_INTERNALS__={invoke:async e=>(console.log("Mock Tauri invoke:",e),e==="plugin:darwin|git_status"?{files:[],diff:""}:e==="plugin:darwin|read_config"?{configDir:"/Users/demo/.darwin"}:e==="plugin:darwin|list_hosts"?["Demo-MacBook-Pro","Work-MacBook"]:null)});const t=T.meta({title:"Widget/DarwinWidget",component:b,parameters:{layout:"fullscreen"},decorators:[e=>o.jsx("div",{className:"relative m-2 h-[600px] w-[400px] overflow-hidden rounded-xl border border-border shadow-2xl",children:o.jsx(e,{})})],tags:["autodocs"]}),n={files:[{path:"modules/darwin/default.nix",changeType:"edited"},{path:"modules/home/default.nix",changeType:"edited"},{path:"modules/darwin/vim.nix",changeType:"new"}],diff:`diff --git a/modules/darwin/default.nix b/modules/darwin/default.nix
...`,additions:25,deletions:3},W={files:[{path:"modules/darwin/default.nix",changeType:"edited"},{path:"modules/home/default.nix",changeType:"edited"},{path:"modules/darwin/vim.nix",changeType:"new"}],diff:`diff --git a/modules/darwin/default.nix b/modules/darwin/default.nix
...`,additions:25,deletions:3},C=[{eventType:"start",summary:"Starting AI evolution...",raw:"Starting evolution with model gpt-5.1",iteration:null,timestampMs:0},{eventType:"iteration",summary:"Processing iteration 1...",raw:"Iteration 1 | messages=2",iteration:1,timestampMs:500},{eventType:"apiRequest",summary:"Querying AI model...",raw:"Sending request to AI provider",iteration:1,timestampMs:550},{eventType:"apiResponse",summary:"Received AI response",raw:"Received response | tokens used: 1523",iteration:1,timestampMs:2300},{eventType:"thinking",summary:"Planning approach...",raw:"[planning] Analyzing configuration structure...",iteration:1,timestampMs:2400},{eventType:"reading",summary:"Reading default.nix",raw:"Reading file: modules/darwin/default.nix",iteration:2,timestampMs:4600}],s={groups:[{summary:{id:1,title:"System Settings (4)",description:"Dock autohide, Finder path bar, trackpad tap-to-click, +1 more",status:"DONE",createdAt:0},changes:[{id:1,hash:"mock-dock-autohide",filename:"modules/darwin/system-defaults.nix",diff:"",lineCount:5,createdAt:0,ownSummaryId:null,title:"Dock autohide enabled",description:"dock.autohide = true"},{id:2,hash:"mock-finder-pathbar",filename:"modules/darwin/system-defaults.nix",diff:"",lineCount:3,createdAt:0,ownSummaryId:null,title:"Finder shows path bar",description:"finder.ShowPathbar = true"}]}],singles:[{id:3,hash:"mock-key-repeat",filename:"modules/darwin/system-defaults.nix",diff:"",lineCount:2,createdAt:0,ownSummaryId:null,title:"Keyboard (1)",description:"KeyRepeat = 2"}],unsummarizedHashes:[]};function r({storeState:e}){return U.useEffect(()=>{const i=A.getState();if(e?.configDir!==void 0&&i.setConfigDir(e.configDir),e?.hosts!==void 0&&i.setHosts(e.hosts),e?.host!==void 0&&i.setHost(e.host),e?.gitStatus!==void 0&&i.setGitStatus(e.gitStatus),e?.changeMap!==void 0&&i.setChangeMap(e.changeMap),e?.evolvePrompt!==void 0&&i.setEvolvePrompt(e.evolvePrompt),e?.isProcessing!==void 0&&i.setProcessing(e.isProcessing,e.processingAction||null),e?.isGenerating!==void 0&&i.setGenerating(e.isGenerating),e?.settingsOpen!==void 0&&i.setSettingsOpen(e.settingsOpen),e?.error!==void 0&&i.setError(e.error),e?.evolveEvents!==void 0){i.clearEvolveEvents();for(const E of e.evolveEvents)i.appendEvolveEvent(E)}e?.consoleLogs!==void 0&&(i.clearLogs(),i.appendLog(e.consoleLogs))},[e]),o.jsx(b,{})}const a=t.story({render:()=>o.jsx(r,{storeState:{configDir:"",host:"",hosts:[]}})}),d=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"",hosts:["Demo-MacBook-Pro","Work-MacBook"]}})}),c=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:null}})}),m=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],evolvePrompt:"Install vim and configure git with my email"}})}),p=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],evolvePrompt:"Install vim and configure git",isGenerating:!0,isProcessing:!0,processingAction:"evolve",evolveEvents:C,consoleLogs:`> Evolving: "Install vim and configure git"
`}})}),u=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],evolvePrompt:"Install vim and configure git",isGenerating:!0,isProcessing:!0,processingAction:"evolve",evolveEvents:[...C,{eventType:"editing",summary:"Editing default.nix",raw:"Editing file: modules/darwin/default.nix",iteration:3,timestampMs:6e3},{eventType:"buildCheck",summary:"Running build check...",raw:"Running build check for host: Demo-MacBook-Pro",iteration:3,timestampMs:6500}],consoleLogs:`> Evolving: "Install vim and configure git"
`}})}),g=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:n,consoleLogs:`> Evolving: "Install vim"
✓ Evolution complete
`}})}),l=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:n,isProcessing:!0,processingAction:"apply",consoleLogs:`> Running darwin-rebuild switch...
building the system configuration...
`}})}),h=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:n,changeMap:s,consoleLogs:`> Running darwin-rebuild switch...
✓ Apply complete

Changes are now active. Commit to save or discard to revert.
`}})}),k=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:n,isProcessing:!0,processingAction:"commit",consoleLogs:`> Committing: "feat(darwin): add vim and configure git"
`}})}),v=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],error:"Failed to connect to nix daemon. Is the Nix daemon running?"}})}),f=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:{files:[{path:"modules/darwin/default.nix",changeType:"edited"},{path:"modules/home/default.nix",changeType:"edited"},{path:"modules/darwin/vim.nix",changeType:"new"},{path:"modules/darwin/git.nix",changeType:"new"},{path:"modules/darwin/homebrew.nix",changeType:"edited"},{path:"modules/home/shell.nix",changeType:"edited"},{path:"flake.nix",changeType:"edited"},{path:"flake.lock",changeType:"edited"}],diff:`diff --git a/modules/darwin/default.nix b/modules/darwin/default.nix
...`,additions:120,deletions:15},changeMap:s}})}),y=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:n,changeMap:s,consoleLogs:`> Running darwin-rebuild switch...
building the system configuration...
these 3 derivations will be built:
  /nix/store/abc123-darwin-system.drv
  /nix/store/def456-home-manager.drv
  /nix/store/ghi789-user-environment.drv
building '/nix/store/abc123-darwin-system.drv'...
copying path '/nix/store/...'
setting up /etc...
setting up launchd services...
setting up user defaults...
✓ Apply complete

Changes are now active. Commit to save or discard to revert.`}})}),w=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],settingsOpen:!0}})}),M=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:n}})}),S=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:W,changeMap:s}})}),D=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:W,changeMap:s}})}),P=t.story({render:()=>o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"],gitStatus:W,changeMap:s}})});function G(){return o.jsx(r,{storeState:{configDir:"/Users/demo/.darwin",host:"Demo-MacBook-Pro",hosts:["Demo-MacBook-Pro","Work-MacBook"]}})}const B=t.story({render:()=>o.jsx(G,{}),parameters:{layout:"fullscreen"},decorators:[e=>o.jsx("div",{className:"relative h-screen w-full overflow-hidden",children:o.jsx(e,{})})]}),x=t.story({render:()=>o.jsx(I,{onComplete:()=>{j()()}}),parameters:{layout:"fullscreen"},decorators:[e=>o.jsx("div",{className:"h-screen w-full",children:o.jsx(e,{})})]});a.input.parameters={...a.input.parameters,docs:{...a.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "",
    host: "",
    hosts: []
  }} />
})`,...a.input.parameters?.docs?.source},description:{story:"Onboarding - First time setup when no config exists",...a.input.parameters?.docs?.description}}};d.input.parameters={...d.input.parameters,docs:{...d.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"]
  }} />
})`,...d.input.parameters?.docs?.source},description:{story:"Onboarding with directory selected, waiting for host",...d.input.parameters?.docs?.description}}};c.input.parameters={...c.input.parameters,docs:{...c.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: null
  }} />
})`,...c.input.parameters?.docs?.source},description:{story:"Idle - Default state, ready for new evolution",...c.input.parameters?.docs?.description}}};m.input.parameters={...m.input.parameters,docs:{...m.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    evolvePrompt: "Install vim and configure git with my email"
  }} />
})`,...m.input.parameters?.docs?.source},description:{story:"Idle with prompt entered",...m.input.parameters?.docs?.description}}};p.input.parameters={...p.input.parameters,docs:{...p.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    evolvePrompt: "Install vim and configure git",
    isGenerating: true,
    isProcessing: true,
    processingAction: "evolve",
    evolveEvents: mockEvolveEvents,
    consoleLogs: '> Evolving: "Install vim and configure git"\\n'
  }} />
})`,...p.input.parameters?.docs?.source},description:{story:"Generating - AI is generating configuration changes",...p.input.parameters?.docs?.description}}};u.input.parameters={...u.input.parameters,docs:{...u.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    evolvePrompt: "Install vim and configure git",
    isGenerating: true,
    isProcessing: true,
    processingAction: "evolve",
    evolveEvents: [...mockEvolveEvents, {
      eventType: "editing",
      summary: "Editing default.nix",
      raw: "Editing file: modules/darwin/default.nix",
      iteration: 3,
      timestampMs: 6000
    }, {
      eventType: "buildCheck",
      summary: "Running build check...",
      raw: "Running build check for host: Demo-MacBook-Pro",
      iteration: 3,
      timestampMs: 6500
    }],
    consoleLogs: '> Evolving: "Install vim and configure git"\\n'
  }} />
})`,...u.input.parameters?.docs?.source},description:{story:"Generating with detailed progress - shows the streaming events UI with more events",...u.input.parameters?.docs?.description}}};g.input.parameters={...g.input.parameters,docs:{...g.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: mockGitStatus,
    consoleLogs: '> Evolving: "Install vim"\\n✓ Evolution complete\\n'
  }} />
})`,...g.input.parameters?.docs?.source},description:{story:"Evolving - Changes generated, waiting for user action",...g.input.parameters?.docs?.description}}};l.input.parameters={...l.input.parameters,docs:{...l.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: mockGitStatus,
    isProcessing: true,
    processingAction: "apply",
    consoleLogs: "> Running darwin-rebuild switch...\\nbuilding the system configuration...\\n"
  }} />
})`,...l.input.parameters?.docs?.source},description:{story:"Applying - Running darwin-rebuild switch",...l.input.parameters?.docs?.description}}};h.input.parameters={...h.input.parameters,docs:{...h.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: mockGitStatus,
    changeMap: mockChangeMap,
    consoleLogs: "> Running darwin-rebuild switch...\\n✓ Apply complete\\n\\nChanges are now active. Commit to save or discard to revert.\\n"
  }} />
})`,...h.input.parameters?.docs?.source},description:{story:"Preview - Changes applied, waiting for commit",...h.input.parameters?.docs?.description}}};k.input.parameters={...k.input.parameters,docs:{...k.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: mockGitStatus,
    isProcessing: true,
    processingAction: "commit",
    consoleLogs: '> Committing: "feat(darwin): add vim and configure git"\\n'
  }} />
})`,...k.input.parameters?.docs?.source},description:{story:"Committing - Saving changes to git",...k.input.parameters?.docs?.description}}};v.input.parameters={...v.input.parameters,docs:{...v.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    error: "Failed to connect to nix daemon. Is the Nix daemon running?"
  }} />
})`,...v.input.parameters?.docs?.source},description:{story:"Error state - Shows error banner",...v.input.parameters?.docs?.description}}};f.input.parameters={...f.input.parameters,docs:{...f.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: {
      files: [{
        path: "modules/darwin/default.nix",
        changeType: "edited"
      }, {
        path: "modules/home/default.nix",
        changeType: "edited"
      }, {
        path: "modules/darwin/vim.nix",
        changeType: "new"
      }, {
        path: "modules/darwin/git.nix",
        changeType: "new"
      }, {
        path: "modules/darwin/homebrew.nix",
        changeType: "edited"
      }, {
        path: "modules/home/shell.nix",
        changeType: "edited"
      }, {
        path: "flake.nix",
        changeType: "edited"
      }, {
        path: "flake.lock",
        changeType: "edited"
      }],
      diff: "diff --git a/modules/darwin/default.nix b/modules/darwin/default.nix\\n...",
      additions: 120,
      deletions: 15
    },
    changeMap: mockChangeMap
  }} />
})`,...f.input.parameters?.docs?.source},description:{story:"Many changed files",...f.input.parameters?.docs?.description}}};y.input.parameters={...y.input.parameters,docs:{...y.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: mockGitStatus,
    changeMap: mockChangeMap,
    consoleLogs: \`> Running darwin-rebuild switch...
building the system configuration...
these 3 derivations will be built:
  /nix/store/abc123-darwin-system.drv
  /nix/store/def456-home-manager.drv
  /nix/store/ghi789-user-environment.drv
building '/nix/store/abc123-darwin-system.drv'...
copying path '/nix/store/...'
setting up /etc...
setting up launchd services...
setting up user defaults...
✓ Apply complete

Changes are now active. Commit to save or discard to revert.\`
  }} />
})`,...y.input.parameters?.docs?.source},description:{story:"Console with lots of output",...y.input.parameters?.docs?.description}}};w.input.parameters={...w.input.parameters,docs:{...w.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    settingsOpen: true
  }} />
})`,...w.input.parameters?.docs?.source},description:{story:"Settings dialog open",...w.input.parameters?.docs?.description}}};M.input.parameters={...M.input.parameters,docs:{...M.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: mockGitStatus
  }} />
})`,...M.input.parameters?.docs?.source},description:{story:"Evolving with unstaged changes - shows Preview button",...M.input.parameters?.docs?.description}}};S.input.parameters={...S.input.parameters,docs:{...S.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: mockGitStatusAllStaged,
    changeMap: mockChangeMap
  }} />
})`,...S.input.parameters?.docs?.source},description:{story:"Evolving with all changes staged - shows Commit button",...S.input.parameters?.docs?.description}}};D.input.parameters={...D.input.parameters,docs:{...D.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: mockGitStatusAllStaged,
    changeMap: mockChangeMap
  }} />
})`,...D.input.parameters?.docs?.source},description:{story:"Commit Screen - enter commit message",...D.input.parameters?.docs?.description}}};P.input.parameters={...P.input.parameters,docs:{...P.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <StoryWidget storeState={{
    configDir: "/Users/demo/.darwin",
    host: "Demo-MacBook-Pro",
    hosts: ["Demo-MacBook-Pro", "Work-MacBook"],
    gitStatus: mockGitStatusAllStaged,
    changeMap: mockChangeMap
  }} />
})`,...P.input.parameters?.docs?.source},description:{story:"Commit Screen with message entered",...P.input.parameters?.docs?.description}}};B.input.parameters={...B.input.parameters,docs:{...B.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <OnboardingFlowWithPermissions />,
  parameters: {
    layout: "fullscreen"
  },
  decorators: [(Story: React.ComponentType) => <div className="relative h-screen w-full overflow-hidden">
        <Story />
      </div>]
})`,...B.input.parameters?.docs?.source},description:{story:`Full Onboarding Flow with Permissions

This story demonstrates the complete onboarding experience:
1. Setup step - Select config directory and host
2. Permissions step - Grant required system permissions
3. Main console - Ready to use nixmac

Click "Browse" to select a directory, then select a host to proceed
to the permissions screen.`,...B.input.parameters?.docs?.description}}};x.input.parameters={...x.input.parameters,docs:{...x.input.parameters?.docs,source:{originalSource:`meta.story({
  render: () => <PermissionsScreen onComplete={() => {
    fn()();
  }} />,
  parameters: {
    layout: "fullscreen"
  },
  decorators: [(Story: React.ComponentType) => <div className="h-screen w-full">
        <Story />
      </div>]
})`,...x.input.parameters?.docs?.source},description:{story:`Permissions step in onboarding - standalone view

Shows just the permissions screen as it appears during onboarding,
without the widget wrapper.`,...x.input.parameters?.docs?.description}}};const ro=["Onboarding","OnboardingWithDirectory","Idle","IdleWithPrompt","Generating","GeneratingWithProgress","Evolving","Applying","Preview","Committing","WithError","ManyChangedFiles","ConsoleWithOutput","SettingsOpen","EvolvingWithUnstagedChanges","EvolvingReadyToCommit","CommitScreen","CommitScreenWithMessage","OnboardingWithPermissions","OnboardingPermissionsStep"];export{l as Applying,D as CommitScreen,P as CommitScreenWithMessage,k as Committing,y as ConsoleWithOutput,g as Evolving,S as EvolvingReadyToCommit,M as EvolvingWithUnstagedChanges,p as Generating,u as GeneratingWithProgress,c as Idle,m as IdleWithPrompt,f as ManyChangedFiles,a as Onboarding,x as OnboardingPermissionsStep,d as OnboardingWithDirectory,B as OnboardingWithPermissions,h as Preview,w as SettingsOpen,v as WithError,ro as __namedExportsOrder,t as default};
