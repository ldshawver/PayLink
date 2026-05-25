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
  var modal       = document.getElementById('punchModal');
  var modalClose  = document.getElementById('punchModalClose');
  var step1       = document.getElementById('punchStep1');
  var step2In     = document.getElementById('punchStep2In');
  var step2Out    = document.getElementById('punchStep2Out');
  var successStep = document.getElementById('punchModalSuccess');
  var empInput    = document.getElementById('punchEmpNum');
  var pinInput    = document.getElementById('punchPin');
  var error1      = document.getElementById('punchModalError');
  var error2      = document.getElementById('punchModalError2');
  var error3      = document.getElementById('punchModalError3');
  var continueBtn = document.getElementById('punchModalContinue');
  var continueText = document.getElementById('punchModalContinueText');
  var modalIcon   = document.getElementById('punchModalIcon');
  var modalTitle  = document.getElementById('punchModalTitle');
  var modalSub    = document.getElementById('punchModalSub');
  var choiceClockIn = document.getElementById('btnChoiceClockIn');
  var choiceBreakIn = document.getElementById('btnChoiceBreakIn');
  var choiceSignIn = document.getElementById('btnChoiceSignIn');
  var choiceBreakOut = document.getElementById('btnChoiceBreakOut');
  var choiceShiftEnd = document.getElementById('btnChoiceShiftEnd');
  var backIn = document.getElementById('btnBackToStep1In');
  var backOut = document.getElementById('btnBackToStep1Out');
  var successName = document.getElementById('punchModalSuccessName');
  var successMsg = document.getElementById('punchModalSuccessMsg');
  var successCountdown = document.getElementById('punchModalCountdown');
  var API_BASE = window.location.origin;
  var punchMode = 'in';
  var authedWorker = null;
  var authedCompany = null;
  var authedPin = '';
  var closeTimer = null;

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

  /* ── In-hero employee time punch flow ─────────────────────────────────── */
  function setStep(active) {
    if (step1) step1.style.display = active === 'credentials' ? 'block' : 'none';
    if (step2In) step2In.style.display = active === 'inChoices' ? 'block' : 'none';
    if (step2Out) step2Out.style.display = active === 'outChoices' ? 'block' : 'none';
    if (successStep) successStep.style.display = active === 'success' ? 'block' : 'none';
  }

  function setError(target, message) {
    if (target) target.textContent = message || '';
  }

  function setBusy(isBusy) {
    if (!continueBtn) return;
    continueBtn.disabled = isBusy;
    if (continueText) continueText.textContent = isBusy ? 'Checking...' : 'Continue →';
  }

  function setChoiceBusy(isBusy) {
    [choiceClockIn, choiceBreakIn, choiceSignIn, choiceBreakOut, choiceShiftEnd].forEach(function(btn) {
      if (btn) btn.disabled = isBusy;
    });
  }

  function resetModal() {
    clearInterval(closeTimer);
    authedWorker = null;
    authedCompany = null;
    authedPin = '';
    setBusy(false);
    setChoiceBusy(false);
    setError(error1, '');
    setError(error2, '');
    setError(error3, '');
    if (empInput) empInput.value = '';
    if (pinInput) pinInput.value = '';
    if (successCountdown) successCountdown.textContent = '5';
    setStep('credentials');
  }

  function openPunchModal(mode) {
    if (!modal) return;
    punchMode = mode === 'out' ? 'out' : 'in';
    resetModal();
    if (modalIcon) {
      modalIcon.classList.toggle('out', punchMode === 'out');
      modalIcon.innerHTML = punchMode === 'out' ? '&#9632;' : '&#9654;';
    }
    if (modalTitle) modalTitle.textContent = punchMode === 'out' ? 'Clock Out' : 'Clock In';
    if (modalSub) modalSub.textContent = 'Enter your employee number and PIN to continue';
    if (continueBtn) continueBtn.classList.toggle('out', punchMode === 'out');
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(function() {
      if (empInput) empInput.focus();
    }, 50);
  }

  function closePunchModal() {
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
    resetModal();
  }

  function workerName() {
    if (!authedWorker) return 'Employee';
    return ((authedWorker.firstName || '') + ' ' + (authedWorker.lastName || '')).trim() || 'Employee';
  }

  function authenticatePunchUser() {
    if (!empInput || !pinInput) return;
    var employeeNumber = empInput.value.trim();
    var pin = pinInput.value.trim();
    if (!employeeNumber || !pin) {
      setError(error1, 'Please enter both employee number and PIN.');
      return;
    }
    setError(error1, '');
    setBusy(true);

    fetch(API_BASE + '/api/time-clock/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ employeeNumber: employeeNumber, pin: pin })
    })
    .then(function(res) {
      if (!res.ok) {
        return res.json().catch(function() { return {}; }).then(function(body) {
          throw new Error(body.message || 'Invalid employee number or PIN.');
        });
      }
      return res.json();
    })
    .then(function(data) {
      authedWorker = data.worker;
      authedCompany = data.company;
      authedPin = pin;
      setBusy(false);
      if (!authedWorker) throw new Error('Employee record was not returned.');
      setStep(punchMode === 'out' ? 'outChoices' : 'inChoices');
    })
    .catch(function(err) {
      setBusy(false);
      setError(error1, err.message || 'Unable to verify that employee right now.');
      if (pinInput) {
        pinInput.value = '';
        pinInput.focus();
      }
    });
  }

  function submitPunch(punchType, errorTarget) {
    if (!authedWorker) {
      setError(errorTarget, 'Please sign in again.');
      setStep('credentials');
      return;
    }
    setChoiceBusy(true);
    setError(errorTarget, '');
    fetch(API_BASE + '/api/time-clock/punch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        workerId: authedWorker.id,
        companyId: authedWorker.companyId,
        punchType: punchType,
        employeeNumber: authedWorker.employeeNumber,
        pin: authedWorker.pin || authedPin
      })
    })
    .then(function(res) {
      if (!res.ok) {
        return res.json().catch(function() { return {}; }).then(function(body) {
          throw new Error(body.message || 'Punch failed.');
        });
      }
      return res.json();
    })
    .then(function() {
      var labels = {
        clock_in: 'Clocked in successfully.',
        break_end: 'Returned from break successfully.',
        break_start: 'Break started successfully.',
        clock_out: 'Clocked out successfully.'
      };
      showSuccess(labels[punchType] || 'Punch saved.');
    })
    .catch(function(err) {
      setChoiceBusy(false);
      setError(errorTarget, err.message || 'Punch failed.');
    });
  }

  function dashboardSignIn() {
    if (!authedWorker) {
      setError(error2, 'Please sign in again.');
      setStep('credentials');
      return;
    }
    setChoiceBusy(true);
    setError(error2, '');
    fetch(API_BASE + '/api/auth/pin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        employeeNumber: authedWorker.employeeNumber,
        pin: authedWorker.pin || authedPin
      })
    })
    .then(function(res) {
      if (!res.ok) {
        return res.json().catch(function() { return {}; }).then(function(body) {
          throw new Error(body.message || 'Dashboard sign-in failed.');
        });
      }
      window.location.href = '/app';
    })
    .catch(function(err) {
      setChoiceBusy(false);
      setError(error2, err.message || 'Dashboard sign-in failed.');
    });
  }

  function showSuccess(message) {
    setChoiceBusy(false);
    if (successName) successName.textContent = workerName();
    if (successMsg) {
      var companyText = authedCompany && authedCompany.name ? ' for ' + authedCompany.name : '';
      successMsg.textContent = message + companyText;
    }
    setStep('success');
    var remaining = 5;
    if (successCountdown) successCountdown.textContent = String(remaining);
    closeTimer = setInterval(function() {
      remaining -= 1;
      if (successCountdown) successCountdown.textContent = String(Math.max(remaining, 0));
      if (remaining <= 0) closePunchModal();
    }, 1000);
  }

  if (btnIn) {
    btnIn.addEventListener('click', function() {
      openPunchModal('in');
    });
  }

  if (btnOut) {
    btnOut.addEventListener('click', function() {
      openPunchModal('out');
    });
  }

  if (continueBtn) continueBtn.addEventListener('click', authenticatePunchUser);
  if (empInput) empInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && pinInput) pinInput.focus();
  });
  if (pinInput) pinInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') authenticatePunchUser();
  });
  if (modalClose) modalClose.addEventListener('click', closePunchModal);
  if (modal) {
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closePunchModal();
    });
  }
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') closePunchModal();
  });
  if (choiceClockIn) choiceClockIn.addEventListener('click', function() { submitPunch('clock_in', error2); });
  if (choiceBreakIn) choiceBreakIn.addEventListener('click', function() { submitPunch('break_end', error2); });
  if (choiceSignIn) choiceSignIn.addEventListener('click', dashboardSignIn);
  if (choiceBreakOut) choiceBreakOut.addEventListener('click', function() { submitPunch('break_start', error3); });
  if (choiceShiftEnd) choiceShiftEnd.addEventListener('click', function() { submitPunch('clock_out', error3); });
  if (backIn) backIn.addEventListener('click', function() { setStep('credentials'); });
  if (backOut) backOut.addEventListener('click', function() { setStep('credentials'); });

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
