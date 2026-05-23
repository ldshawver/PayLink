document.addEventListener('DOMContentLoaded', function() {
  /* ── Clock display ─────────────────────────────────────────────────────── */
  var timeDigits  = document.getElementById('punchTimeDigits');
  var timeSec     = document.getElementById('punchTimeSec');
  var timeAmPm    = document.getElementById('punchTimeAmPm');
  var dateDisplay = document.getElementById('punchDate');
  var statusLine  = document.getElementById('punchStatus');
  var btnIn       = document.getElementById('btnClockIn');
  var btnOut      = document.getElementById('btnClockOut');
  var cardSlot    = document.getElementById('cardSlot');
  var hourHand    = document.getElementById('hourHand');
  var minuteHand  = document.getElementById('minuteHand');
  var secondHand  = document.getElementById('secondHand');

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function updateClock() {
    var now = new Date();
    var h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12  = h % 12 || 12;
    if (timeDigits)  timeDigits.textContent  = h12 + ':' + (m < 10 ? '0' : '') + m;
    if (timeSec)     timeSec.textContent      = ':' + (s < 10 ? '0' : '') + s;
    if (timeAmPm)    timeAmPm.textContent     = ampm;
    if (dateDisplay) dateDisplay.textContent  = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    if (hourHand)   hourHand.style.transform   = 'rotate(' + (((h % 12) + m / 60) * 30) + 'deg)';
    if (minuteHand) minuteHand.style.transform = 'rotate(' + ((m + s / 60) * 6) + 'deg)';
    if (secondHand) secondHand.style.transform = 'rotate(' + (s * 6) + 'deg)';
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ── Force background video to play ───────────────────────────────────── */
  var heroVideo = document.querySelector('.hero-video-bg');
  if (heroVideo) {
    heroVideo.muted = true;
    heroVideo.volume = 0;
    heroVideo.setAttribute('playsinline', '');
    heroVideo.setAttribute('muted', '');

    function tryPlay() {
      if (heroVideo.paused) {
        var p = heroVideo.play();
        if (p && p.catch) p.catch(function() {});
      }
    }

    tryPlay();
    heroVideo.addEventListener('canplay', tryPlay);
    heroVideo.addEventListener('loadedmetadata', tryPlay);
    heroVideo.addEventListener('loadeddata', tryPlay);
    setTimeout(tryPlay, 300);
    setTimeout(tryPlay, 1000);

    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) tryPlay();
    });

    document.addEventListener('click', function onFirstClick() {
      tryPlay();
      document.removeEventListener('click', onFirstClick);
    }, { once: true });
  }

  /* ── CTA: Clock In / Clock Out → real private app ─────────────────────── */
  var APP_CLOCK_URL = '/app.html?route=%2Fclock-in';
  var APP_LOGIN_URL = '/app.html?route=%2Flogin';

  if (btnIn) {
    btnIn.addEventListener('click', function() {
      window.location.href = APP_CLOCK_URL;
    });
  }

  if (btnOut) {
    btnOut.addEventListener('click', function() {
      window.location.href = APP_CLOCK_URL;
    });
  }

  /* ── Scroll parallax ─────────────────────────────────────────────────── */
  if (prefersReducedMotion) return;

  var punchHero = document.querySelector('.punch-hero');
  var punchWrap = document.querySelector('.punch-wrap');
  var scrollHint = document.querySelector('.scroll-hint');

  if (punchHero && punchWrap) {
    var ticking = false;
    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(function() {
          var rect    = punchHero.getBoundingClientRect();
          var heroH   = punchHero.offsetHeight;
          var scrolled = -rect.top;
          var progress = Math.max(0, Math.min(1, scrolled / (heroH * 0.3)));
          var scale    = 1 - progress * 0.93;
          var yMove    = progress * -420;
          punchWrap.style.transform = 'scale(' + scale + ') translateY(' + yMove + 'px)';
          if (scrollHint) scrollHint.style.opacity = Math.max(0, 1 - progress * 5);
          ticking = false;
        });
        ticking = true;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
  }
});
