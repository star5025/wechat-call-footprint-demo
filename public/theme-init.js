(() => {
  try {
    const prefix = document.currentScript?.dataset.mode === "pages-demo"
      ? "call-footprint.pages-demo.v1" : "call-footprint";
    const theme = localStorage.getItem(`${prefix}.theme`) === "dark" ? "dark" : "light";
    const appearance = localStorage.getItem(`${prefix}.appearance`) === "github" ? "github" : "default";
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = appearance === "github"
      ? theme === "dark" ? "#0d1117" : "#ffffff"
      : theme === "dark" ? "#121018" : "#fbfaf8";
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
