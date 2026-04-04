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
    var playPromise = heroVideo.play();
    if (playPromise !== undefined) {
      playPromise.catch(function() {
        heroVideo.setAttribute('playsinline', '');
        heroVideo.play().catch(function() {});
      });
    }
  }

  /* ── Modal element references ──────────────────────────────────────────── */
  var modal            = document.getElementById('punchModal');
  var modalClose       = document.getElementById('punchModalClose');
  var step1            = document.getElementById('punchStep1');
  var step2In          = document.getElementById('punchStep2In');
  var step2Out         = document.getElementById('punchStep2Out');
  var modalSuccess     = document.getElementById('punchModalSuccess');
  var modalIcon        = document.getElementById('punchModalIcon');
  var modalTitle       = document.getElementById('punchModalTitle');
  var modalSub         = document.getElementById('punchModalSub');
  var empNumInput      = document.getElementById('punchEmpNum');
  var pinInput         = document.getElementById('punchPin');
  var continueBtn      = document.getElementById('punchModalContinue');
  var continueTxt      = document.getElementById('punchModalContinueText');
  var modalError       = document.getElementById('punchModalError');
  var modalError2      = document.getElementById('punchModalError2');
  var modalError3      = document.getElementById('punchModalError3');
  var btnChoiceClockIn = document.getElementById('btnChoiceClockIn');
  var btnChoiceBreakIn = document.getElementById('btnChoiceBreakIn');
  var btnChoiceSignIn  = document.getElementById('btnChoiceSignIn');
  var btnChoiceBreakOut= document.getElementById('btnChoiceBreakOut');
  var btnChoiceShiftEnd= document.getElementById('btnChoiceShiftEnd');
  var btnBackIn        = document.getElementById('btnBackToStep1In');
  var btnBackOut       = document.getElementById('btnBackToStep1Out');
  var successIcon      = document.getElementById('punchSuccessIcon');
  var successName      = document.getElementById('punchModalSuccessName');
  var successMsg       = document.getElementById('punchModalSuccessMsg');
  var countdownWrap    = document.getElementById('punchCountdownWrap');
  var countdownEl      = document.getElementById('punchModalCountdown');

  var currentType  = 'in';
  var countdownTimer = null;

  /* ── Step helpers ─────────────────────────────────────────────────────── */
  function showStep(stepId) {
    [step1, step2In, step2Out, modalSuccess].forEach(function(el) {
      if (el) el.style.display = 'none';
    });
    var el = document.getElementById(stepId);
    if (el) el.style.display = '';
  }

  function setChoiceBtnsDisabled(disabled) {
    [btnChoiceClockIn, btnChoiceBreakIn, btnChoiceSignIn,
     btnChoiceBreakOut, btnChoiceShiftEnd].forEach(function(b) {
      if (b) b.disabled = disabled;
    });
  }

  function clearErrors() {
    [modalError, modalError2, modalError3].forEach(function(el) {
      if (el) el.textContent = '';
    });
  }

  /* ── Open / close modal ───────────────────────────────────────────────── */
  function openModal(type) {
    currentType = type;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (empNumInput) empNumInput.value = '';
    if (pinInput)    pinInput.value    = '';
    clearErrors();
    if (continueBtn) continueBtn.disabled = false;
    if (continueTxt) continueTxt.textContent = 'Continue \u2192';

    if (modalIcon) {
      modalIcon.className = 'punch-modal-icon' + (type === 'out' ? ' out' : '');
      modalIcon.innerHTML = type === 'out' ? '&#9632;' : '&#9654;';
    }
    if (modalTitle) modalTitle.textContent = type === 'out' ? 'Clock Out' : 'Clock In';
    if (modalSub)   modalSub.textContent   = 'Enter your employee number and PIN to continue';

    showStep('punchStep1');
    if (modal) modal.style.display = 'flex';

    if (cardSlot && !prefersReducedMotion) {
      cardSlot.classList.remove('punching');
      void cardSlot.offsetWidth;
      cardSlot.classList.add('punching');
    }
    setTimeout(function() { if (empNumInput) empNumInput.focus(); }, 60);
  }

  function closeModal() {
    if (modal) modal.style.display = 'none';
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (btnIn)  btnIn.disabled  = false;
    if (btnOut) btnOut.disabled = false;
    if (statusLine) {
      statusLine.textContent = 'Employees may clock in or out here';
      statusLine.className   = 'clock-status-line';
    }
  }

  /* ── Step 1 → Step 2 ─────────────────────────────────────────────────── */
  function handleContinue() {
    var empNum = empNumInput ? empNumInput.value.trim() : '';
    var pin    = pinInput    ? pinInput.value.trim()    : '';
    if (!empNum || !pin) {
      if (modalError) modalError.textContent = 'Please enter your employee number and PIN.';
      return;
    }
    clearErrors();
    showStep(currentType === 'out' ? 'punchStep2Out' : 'punchStep2In');
  }

  /* ── API call helper ──────────────────────────────────────────────────── */
  function callApi(endpoint, errorEl, onSuccess) {
    var empNum = empNumInput ? empNumInput.value.trim() : '';
    var pin    = pinInput    ? pinInput.value.trim()    : '';
    setChoiceBtnsDisabled(true);
    if (errorEl) errorEl.textContent = '';

    fetch('/api/time-clock/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ employeeNumber: empNum, pin: pin })
    })
    .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
    .then(function(r) {
      setChoiceBtnsDisabled(false);
      if (!r.ok) {
        if (errorEl) errorEl.textContent = r.data.message || 'Invalid employee number or PIN.';
        return;
      }
      var worker = r.data.worker;
      var name = worker ? (worker.firstName + ' ' + worker.lastName) : '';
      onSuccess(name);
    })
    .catch(function() {
      setChoiceBtnsDisabled(false);
      if (errorEl) errorEl.textContent = 'Network error. Please try again.';
    });
  }

  /* ── Staff sign-in via username/password ─────────────────────────────── */
  function doSignIn(errorEl) {
    var empNum = empNumInput ? empNumInput.value.trim() : '';
    var pin    = pinInput    ? pinInput.value.trim()    : '';
    setChoiceBtnsDisabled(true);
    if (errorEl) errorEl.textContent = '';

    fetch('/api/time-clock/sign-in', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ employeeNumber: empNum, pin: pin })
    })
    .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
    .then(function(r) {
      setChoiceBtnsDisabled(false);
      if (!r.ok) {
        if (errorEl) errorEl.textContent = r.data.message || 'Sign-in failed. Check your credentials.';
        return;
      }
      var worker = r.data.worker;
      var name   = worker ? (worker.firstName + ' ' + worker.lastName) : '';
      showSuccessState(name, 'sign-in');
    })
    .catch(function() {
      setChoiceBtnsDisabled(false);
      if (errorEl) errorEl.textContent = 'Network error. Please try again.';
    });
  }

  /* ── Show success state ───────────────────────────────────────────────── */
  function showSuccessState(name, type) {
    showStep('punchModalSuccess');

    var isSignIn   = type === 'sign-in';
    var isBreakOut = type === 'break-out';
    var isShiftEnd = type === 'shift-end';
    var stayOnSite = !isSignIn;

    if (successIcon) {
      successIcon.style.background = isSignIn
        ? 'rgba(13,148,136,0.18)'
        : isBreakOut || isShiftEnd
          ? 'rgba(245,158,11,0.18)'
          : 'rgba(16,185,129,0.18)';
      successIcon.style.borderColor = isSignIn
        ? 'rgba(13,148,136,0.5)'
        : isBreakOut || isShiftEnd
          ? 'rgba(245,158,11,0.5)'
          : 'rgba(16,185,129,0.5)';
      successIcon.style.color = isSignIn ? '#0d9488' : isBreakOut || isShiftEnd ? '#f59e0b' : '#10b981';
    }

    var headline = '';
    var sub      = '';
    if (type === 'clock-in') {
      headline = name ? 'Welcome, ' + name + '!' : 'Clocked In!';
      sub      = 'You\'re clocked in. Have a great shift!';
    } else if (type === 'break-in') {
      headline = name ? 'Welcome back, ' + name + '!' : 'Welcome Back!';
      sub      = 'You\'re back on the clock. Let\'s go!';
    } else if (type === 'break-out') {
      headline = name ? 'Enjoy your break, ' + name + '!' : 'Enjoy Your Break!';
      sub      = 'Take a well-deserved rest.';
    } else if (type === 'shift-end') {
      headline = name ? 'Great work, ' + name + '!' : 'Great Work!';
      sub      = 'Your shift is complete. Have a wonderful day!';
    } else if (type === 'sign-in') {
      headline = name ? 'Welcome, ' + name + '!' : 'Signed In!';
      sub      = 'Redirecting to your dashboard\u2026';
    }

    if (successName) successName.textContent = headline;
    if (successMsg)  successMsg.textContent  = sub;

    if (statusLine) {
      statusLine.textContent = isSignIn ? 'Redirecting\u2026' : (isBreakOut || isShiftEnd ? 'Clocked out successfully' : 'Clocked in successfully');
      statusLine.className   = 'clock-status-line success';
    }

    if (isSignIn) {
      if (countdownWrap) countdownWrap.style.display = 'none';
      setTimeout(function() { window.location.href = 'https://mypaylink.app/app/dashboard'; }, 1400);
    } else {
      if (countdownWrap) {
        countdownWrap.style.display = '';
        countdownWrap.innerHTML = 'Closing in <span id="punchModalCountdown">5</span>s';
        countdownEl = document.getElementById('punchModalCountdown');
      }
      var count = 5;
      countdownTimer = setInterval(function() {
        count--;
        if (countdownEl) countdownEl.textContent = count;
        if (count <= 0) { clearInterval(countdownTimer); countdownTimer = null; closeModal(); }
      }, 1000);
    }
  }

  /* ── Event bindings ───────────────────────────────────────────────────── */
  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modal)      modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') closeModal();
  });

  if (continueBtn) continueBtn.addEventListener('click', handleContinue);
  if (pinInput) pinInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') handleContinue(); });
  if (empNumInput) empNumInput.addEventListener('keydown', function(e) { if (e.key === 'Enter' && pinInput) pinInput.focus(); });

  if (btnBackIn)  btnBackIn.addEventListener('click',  function() { clearErrors(); showStep('punchStep1'); setTimeout(function() { if (empNumInput) empNumInput.focus(); }, 60); });
  if (btnBackOut) btnBackOut.addEventListener('click', function() { clearErrors(); showStep('punchStep1'); setTimeout(function() { if (empNumInput) empNumInput.focus(); }, 60); });

  if (btnChoiceClockIn) btnChoiceClockIn.addEventListener('click', function() {
    callApi('clock-in-session', modalError2, function(name) { showSuccessState(name, 'clock-in'); });
  });
  if (btnChoiceBreakIn) btnChoiceBreakIn.addEventListener('click', function() {
    callApi('break-end', modalError2, function(name) { showSuccessState(name, 'break-in'); });
  });
  if (btnChoiceSignIn)  btnChoiceSignIn.addEventListener('click',  function() { doSignIn(modalError2); });
  if (btnChoiceBreakOut) btnChoiceBreakOut.addEventListener('click', function() {
    callApi('break-start', modalError3, function(name) { showSuccessState(name, 'break-out'); });
  });
  if (btnChoiceShiftEnd) btnChoiceShiftEnd.addEventListener('click', function() {
    callApi('clock-out-session', modalError3, function(name) { showSuccessState(name, 'shift-end'); });
  });

  if (btnIn)  btnIn.addEventListener('click',  function() { openModal('in'); });
  if (btnOut) btnOut.addEventListener('click', function() { openModal('out'); });

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
