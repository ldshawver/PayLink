document.addEventListener('DOMContentLoaded', function() {
  var timeDigits = document.getElementById('punchTimeDigits');
  var timeSec = document.getElementById('punchTimeSec');
  var timeAmPm = document.getElementById('punchTimeAmPm');
  var dateDisplay = document.getElementById('punchDate');
  var statusLine = document.getElementById('punchStatus');
  var btnIn = document.getElementById('btnClockIn');
  var btnOut = document.getElementById('btnClockOut');
  var cardSlot = document.getElementById('cardSlot');
  var hourHand = document.getElementById('hourHand');
  var minuteHand = document.getElementById('minuteHand');
  var secondHand = document.getElementById('secondHand');

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function updateClock() {
    var now = new Date();
    var h = now.getHours();
    var m = now.getMinutes();
    var s = now.getSeconds();
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;

    if (timeDigits) {
      timeDigits.textContent = h12 + ':' + (m < 10 ? '0' : '') + m;
    }
    if (timeSec) {
      timeSec.textContent = ':' + (s < 10 ? '0' : '') + s;
    }
    if (timeAmPm) {
      timeAmPm.textContent = ampm;
    }
    if (dateDisplay) {
      dateDisplay.textContent = now.toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
      });
    }

    if (hourHand) {
      var hDeg = ((h % 12) + m / 60) * 30;
      hourHand.style.transform = 'rotate(' + hDeg + 'deg)';
    }
    if (minuteHand) {
      var mDeg = (m + s / 60) * 6;
      minuteHand.style.transform = 'rotate(' + mDeg + 'deg)';
    }
    if (secondHand) {
      var sDeg = s * 6;
      secondHand.style.transform = 'rotate(' + sDeg + 'deg)';
    }
  }

  updateClock();
  setInterval(updateClock, 1000);

  function handlePunch(type) {
    var btn = type === 'in' ? btnIn : btnOut;
    if (!btn || btn.disabled) return;

    btn.classList.add('loading');
    btnIn.disabled = true;
    btnOut.disabled = true;

    if (cardSlot && !prefersReducedMotion) {
      cardSlot.classList.remove('punching');
      void cardSlot.offsetWidth;
      cardSlot.classList.add('punching');
    }

    if (statusLine) {
      statusLine.textContent = 'Redirecting to login...';
      statusLine.className = 'clock-status-line';
    }

    setTimeout(function() {
      window.location.href = 'https://mypaylink.app/clock-in';
    }, 800);
  }

  if (btnIn) {
    btnIn.addEventListener('click', function() { handlePunch('in'); });
  }
  if (btnOut) {
    btnOut.addEventListener('click', function() { handlePunch('out'); });
  }

  if (prefersReducedMotion) return;

  var punchHero = document.querySelector('.punch-hero');
  var punchWrap = document.querySelector('.punch-wrap');
  var scrollHint = document.querySelector('.scroll-hint');

  if (punchHero && punchWrap) {
    var ticking = false;

    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(function() {
          var rect = punchHero.getBoundingClientRect();
          var heroH = punchHero.offsetHeight;
          var scrolled = -rect.top;
          var progress = Math.max(0, Math.min(1, scrolled / (heroH * 0.3)));

          var scale = 1 - progress * 0.93;
          var yMove = progress * -420;

          punchWrap.style.transform = 'scale(' + scale + ') translateY(' + yMove + 'px)';

          if (scrollHint) {
            scrollHint.style.opacity = Math.max(0, 1 - progress * 5);
          }

          ticking = false;
        });
        ticking = true;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
  }
});
