(() => {
  try {
    const theme = localStorage.getItem("call-footprint.theme") === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === "dark" ? "#121018" : "#fbfaf8";
  } catch {
    document.documentElement.dataset.theme = "light";
  }
})();
