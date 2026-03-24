document.addEventListener('DOMContentLoaded', () => {
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

    if (cardSlot) {
      cardSlot.classList.remove('punching');
      void cardSlot.offsetWidth;
      cardSlot.classList.add('punching');
    }

    setTimeout(function() {
      btn.classList.remove('loading');
      btnIn.disabled = false;
      btnOut.disabled = false;

      if (statusLine) {
        if (type === 'in') {
          statusLine.textContent = 'Clock-in recorded';
          statusLine.className = 'clock-status-line clocked-in';
        } else {
          statusLine.textContent = 'Clock-out recorded';
          statusLine.className = 'clock-status-line clocked-out';
        }
      }

      var screen = document.querySelector('.clock-screen');
      if (screen) {
        var flash = document.createElement('div');
        flash.className = 'clock-success-flash';
        screen.appendChild(flash);
        setTimeout(function() { flash.remove(); }, 800);
      }

      window.location.href = 'https://app.mypaylink.app';
    }, 1200);
  }

  if (btnIn) {
    btnIn.addEventListener('click', function() { handlePunch('in'); });
  }
  if (btnOut) {
    btnOut.addEventListener('click', function() { handlePunch('out'); });
  }

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
          var progress = Math.max(0, Math.min(1, scrolled / (heroH * 0.5)));

          var scale = 1 - progress * 0.55;
          var yMove = progress * -200;

          punchWrap.style.transform = 'scale(' + scale + ') translateY(' + yMove + 'px)';

          if (scrollHint) {
            scrollHint.style.opacity = Math.max(0, 1 - progress * 3);
          }

          ticking = false;
        });
        ticking = true;
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
  }
});
