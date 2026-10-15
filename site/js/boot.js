// Runs in <head> before the first paint: tells the CSS that scripts run, so
// the fade-ins can start hidden. The site's CSP allows no inline script.
document.documentElement.classList.add("js");
