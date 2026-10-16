export const THEME_STORAGE_KEY = "nes-theme";

// Sayfa boyanmadan önce <head> içinde çalışır; kayıtlı tema koyuysa
// <html>'e "dark" sınıfını hemen ekler, böylece açık→koyu yanıp sönmesi olmaz.
export const themeInitScript = `(function(){try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark"){document.documentElement.classList.add("dark")}}catch(e){}})();`;
