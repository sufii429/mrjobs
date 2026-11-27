/* MrJobs cookie consent banner.
   Shows once per browser until the visitor accepts; the choice is kept in
   localStorage under 'mrjobs-cookie-consent'. MrJobs' own scripts set no
   cookies and do no tracking — see /cookie-policy.html for details. */
(function () {
  var KEY = 'mrjobs-cookie-consent';
  try {
    if (window.localStorage && localStorage.getItem(KEY)) return;
  } catch (e) { /* storage unavailable — show the banner this visit */ }

  function build() {
    if (document.getElementById('cookieConsent')) return;
    var style = document.createElement('style');
    style.textContent =
      '#cookieConsent{position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#ffffff;' +
      'border-top:3px solid #2d849e;box-shadow:0 -2px 14px rgba(0,0,0,.18);padding:14px 16px;' +
      'font-family:inherit;color:#222}' +
      '#cookieConsent .cc-inner{max-width:1100px;margin:0 auto;display:flex;align-items:center;' +
      'gap:14px;flex-wrap:wrap}' +
      '#cookieConsent p{margin:0;flex:1 1 320px;font-size:14px;line-height:1.5}' +
      '#cookieConsent a{color:#2d849e;text-decoration:underline}' +
      '#cookieConsent button{background:#2d849e;color:#fff;border:0;border-radius:6px;' +
      'padding:10px 22px;font-size:14px;font-weight:600;cursor:pointer;min-height:44px}' +
      '#cookieConsent button:hover{background:#236b82}' +
      '@media (max-width:600px){#cookieConsent button{width:100%}}';
    document.head.appendChild(style);

    var bar = document.createElement('div');
    bar.id = 'cookieConsent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Cookie consent');
    bar.innerHTML =
      '<div class="cc-inner">' +
      '<p>We use cookies from Google Analytics and Google AdSense to count visits and ' +
      '(when ads run) to serve ads. MrJobs itself sets no tracking cookies. ' +
      'See our <a href="/cookie-policy">Cookie Policy</a>.</p>' +
      '<button type="button" id="cookieConsentAccept">Accept</button>' +
      '</div>';
    document.body.appendChild(bar);

    document.getElementById('cookieConsentAccept').addEventListener('click', function () {
      try {
        if (window.localStorage) localStorage.setItem(KEY, 'accepted');
      } catch (e) { /* ignore — banner simply returns on the next page */ }
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
