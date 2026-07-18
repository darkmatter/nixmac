// Click anywhere in a case-table row → navigate to the case page.
// Skips clicks on real anchors so middle-click / cmd-click still work.
document.addEventListener("click", (e) => {
  if (e.target.closest("a")) return;
  const tr = e.target.closest("tr[data-href]");
  if (!tr) return;
  window.location = tr.dataset.href;
});
