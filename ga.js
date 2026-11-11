// Loads Google Analytics on pages that don't run app.js
(function () {
  var id = (window.SPIN_CONFIG || {}).googleAnalytics;
  if (!id || !/^G-[A-Z0-9]{4,}$/i.test(id)) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", id, { anonymize_ip: true });
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
  document.head.appendChild(s);
})();
