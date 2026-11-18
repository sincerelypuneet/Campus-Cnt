(() => {
  const storageKey = "campus-space-theme";
  const savedTheme = window.sessionStorage.getItem(storageKey);
  let currentTheme = savedTheme === "dark" ? "dark" : "light";

  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === "dark" ? "#0e1c2b" : "#f2f7fc";

    const toggle = document.querySelector(".theme-toggle");
    if (toggle) {
      toggle.textContent = theme === "dark" ? "☀ Light mode" : "☾ Dark mode";
      toggle.setAttribute("aria-label", `Switch to ${theme === "dark" ? "light" : "dark"} mode`);
      toggle.setAttribute("aria-pressed", String(theme === "dark"));
    }
  }

  function initializeThemeControl() {
    applyTheme(currentTheme);

    const toggle = document.createElement("button");
    toggle.className = "theme-toggle";
    toggle.type = "button";
    toggle.addEventListener("click", () => {
      const nextTheme = currentTheme === "dark" ? "light" : "dark";
      window.sessionStorage.setItem(storageKey, nextTheme);
      applyTheme(nextTheme);
    });

    const header = document.querySelector("header");
    if (header) header.append(toggle);
    else document.body.append(toggle);

    applyTheme(currentTheme);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeThemeControl, { once: true });
  } else {
    initializeThemeControl();
  }
})();
