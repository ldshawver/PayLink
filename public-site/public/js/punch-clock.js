document.addEventListener('DOMContentLoaded', function() {
  var timeDigits = document.getElementById('punchTimeDigits');
  var timeSec    = document.getElementById('punchTimeSec');
  var timeAmPm   = document.getElementById('punchTimeAmPm');
  var dateDisplay = document.getElementById('punchDate');
  var statusLine = document.getElementById('punchStatus');
  var btnIn      = document.getElementById('btnClockIn');
  var btnOut     = document.getElementById('btnClockOut');
  var cardSlot   = document.getElementById('cardSlot');
  var hourHand   = document.getElementById('hourHand');
  var minuteHand = document.getElementById('minuteHand');
  var secondHand = document.getElementById('secondHand');

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function updateClock() {
    var now = new Date();
    var h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    if (timeDigits) timeDigits.textContent = h12 + ':' + (m < 10 ? '0' : '') + m;
    if (timeSec)    timeSec.textContent = ':' + (s < 10 ? '0' : '') + s;
    if (timeAmPm)   timeAmPm.textContent = ampm;
    if (dateDisplay) dateDisplay.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    if (hourHand)   hourHand.style.transform   = 'rotate(' + (((h % 12) + m / 60) * 30) + 'deg)';
    if (minuteHand) minuteHand.style.transform = 'rotate(' + ((m + s / 60) * 6) + 'deg)';
    if (secondHand) secondHand.style.transform = 'rotate(' + (s * 6) + 'deg)';
  }
  updateClock();
  setInterval(updateClock, 1000);

  /* ── Modal references ─────────────────────────────────────────────────── */
  var modal          = document.getElementById('punchModal');
  var modalClose     = document.getElementById('punchModalClose');
  var modalForm      = document.getElementById('punchModalForm');
  var modalSuccess   = document.getElementById('punchModalSuccess');
  var modalIcon      = document.getElementById('punchModalIcon');
  var modalTitle     = document.getElementById('punchModalTitle');
  var modalSub       = document.getElementById('punchModalSub');
  var modalSubmitBtn = document.getElementById('punchModalSubmit');
  var modalSubmitTxt = document.getElementById('punchModalSubmitText');
  var modalError     = document.getElementById('punchModalError');
  var empFields      = document.getElementById('punchEmpFields');
  var staffFields    = document.getElementById('punchStaffFields');
  var empNumInput    = document.getElementById('punchEmpNum');
  var pinInput       = document.getElementById('punchPin');
  var usernameInput  = document.getElementById('punchUsername');
  var passwordInput  = document.getElementById('punchPassword');
  var modeToggle     = document.getElementById('punchModeToggle');
  var toggleBtn      = document.getElementById('punchToggleBtn');
  var successName    = document.getElementById('punchModalSuccessName');
  var successMsg     = document.getElementById('punchModalSuccessMsg');
  var countdownEl    = document.getElementById('punchModalCountdown');

  var currentType = 'in';   /* 'in' | 'out' */
  var staffMode   = false;  /* employee PIN vs username/password */
  var countdownTimer = null;

  function setStaffMode(on) {
    staffMode = on;
    if (empFields)   empFields.style.display   = on ? 'none' : '';
    if (staffFields) staffFields.style.display = on ? ''     : 'none';
    if (modeToggle)  modeToggle.style.display  = (currentType === 'out') ? 'none' : '';
    if (toggleBtn)   toggleBtn.textContent = on ? 'Employee clock-in / clock-out' : 'Manager / Admin sign in';
    if (modalSub)    modalSub.textContent  = on ? 'Sign in with your username and password'
                                                : (currentType === 'out' ? 'Enter your employee number and PIN'
                                                                         : 'Enter your employee number and PIN');
    if (modalTitle)  modalTitle.textContent = on ? 'Staff Sign In'
                                                 : (currentType === 'out' ? 'Clock Out' : 'Clock In');
    if (modalIcon) {
      modalIcon.className = 'punch-modal-icon' + (currentType === 'out' && !on ? ' out' : '');
      modalIcon.innerHTML = on ? '&#128274;' : (currentType === 'out' ? '&#9632;' : '&#9654;');
    }
    if (modalSubmitBtn) {
      modalSubmitBtn.className = 'punch-modal-submit' + (currentType === 'out' && !on ? ' out' : '');
    }
    if (modalSubmitTxt) modalSubmitTxt.textContent = on ? 'Sign In'
                                                        : (currentType === 'out' ? 'Clock Out' : 'Clock In');
    if (modalError) modalError.textContent = '';
    setTimeout(function() {
      if (on && usernameInput) usernameInput.focus();
      else if (!on && empNumInput) empNumInput.focus();
    }, 60);
  }

  function openModal(type) {
    currentType = type;
    staffMode = false;

    if (empNumInput)  empNumInput.value  = '';
    if (pinInput)     pinInput.value     = '';
    if (usernameInput) usernameInput.value = '';
    if (passwordInput) passwordInput.value = '';
    if (modalError)   modalError.textContent = '';
    if (modalSubmitBtn) modalSubmitBtn.disabled = false;

    if (modeToggle) modeToggle.style.display = type === 'out' ? 'none' : '';

    setStaffMode(false);

    if (modalForm)    modalForm.style.display    = '';
    if (modalSuccess) modalSuccess.style.display = 'none';
    if (modal)        modal.style.display        = 'flex';

    if (cardSlot && !prefersReducedMotion) {
      cardSlot.classList.remove('punching');
      void cardSlot.offsetWidth;
      cardSlot.classList.add('punching');
    }
  }

  function closeModal() {
    if (modal) modal.style.display = 'none';
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (btnIn)  btnIn.disabled  = false;
    if (btnOut) btnOut.disabled = false;
    if (statusLine) {
      statusLine.textContent = 'Employees may clock in or out here';
      statusLine.className = 'clock-status-line';
    }
  }

  function startCountdown() {
    var count = 10;
    if (countdownEl) countdownEl.textContent = count;
    countdownTimer = setInterval(function() {
      count--;
      if (countdownEl) countdownEl.textContent = count;
      if (count <= 0) { clearInterval(countdownTimer); countdownTimer = null; closeModal(); }
    }, 1000);
  }

  function showSuccess(name, type) {
    var isOut   = type === 'out';
    var isStaff = type === 'staff';
    if (successName) {
      successName.textContent = isStaff  ? ('Welcome, ' + (name || 'User') + '!')
                              : (name   ? name + (isOut ? ' — Clocked Out!' : ' — Clocked In!')
                                        : (isOut ? 'Clocked Out!' : 'Clocked In!'));
    }
    if (successMsg) {
      successMsg.textContent = isStaff ? 'Redirecting to your dashboard…'
                             : (isOut  ? 'See you next time!' : 'Have a great shift.');
    }
    if (modalForm)    modalForm.style.display    = 'none';
    if (modalSuccess) modalSuccess.style.display = '';
    if (statusLine) {
      statusLine.textContent = isStaff ? 'Signing in…' : (isOut ? 'Clocked out successfully' : 'Clocked in successfully');
      statusLine.className = 'clock-status-line success';
    }
    if (isStaff) {
      setTimeout(function() { window.location.href = 'https://mypaylink.app/app/dashboard'; }, 1200);
    } else {
      startCountdown();
    }
  }

  function showError(msg) {
    if (modalError) modalError.textContent = msg || 'Something went wrong. Please try again.';
    if (modalSubmitBtn) modalSubmitBtn.disabled = false;
    if (modalSubmitTxt) modalSubmitTxt.textContent = staffMode ? 'Sign In'
                                                               : (currentType === 'out' ? 'Clock Out' : 'Clock In');
  }

  function submitPunch() {
    if (modalSubmitBtn) modalSubmitBtn.disabled = true;
    if (modalSubmitTxt) modalSubmitTxt.textContent = 'Please wait…';
    if (modalError) modalError.textContent = '';

    if (staffMode) {
      /* Username + password login → regular auth endpoint */
      var username = usernameInput ? usernameInput.value.trim() : '';
      var password = passwordInput ? passwordInput.value : '';
      if (!username || !password) { showError('Please enter your username and password.'); return; }

      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username: username, password: password })
      })
      .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
      .then(function(r) {
        if (!r.ok) { showError(r.data.message || 'Invalid username or password.'); return; }
        var u = r.data.user || r.data;
        var name = (u.firstName || u.first_name || '') + ' ' + (u.lastName || u.last_name || '');
        showSuccess(name.trim() || username, 'staff');
      })
      .catch(function() { showError('Network error. Please try again.'); });

    } else {
      /* Employee number + PIN → time clock endpoint */
      var empNum = empNumInput ? empNumInput.value.trim() : '';
      var pin    = pinInput    ? pinInput.value.trim()    : '';
      if (!empNum || !pin) { showError('Please enter your employee number and PIN.'); return; }

      var endpoint = currentType === 'out' ? 'clock-out-session' : 'clock-in-session';
      fetch('/api/time-clock/' + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ employeeNumber: empNum, pin: pin })
      })
      .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
      .then(function(r) {
        if (!r.ok) { showError(r.data.message || 'Invalid employee number or PIN.'); return; }
        var worker = r.data.worker;
        var name = worker ? (worker.firstName + ' ' + worker.lastName) : '';
        showSuccess(name, currentType);
      })
      .catch(function() { showError('Network error. Please try again.'); });
    }
  }

  /* ── Event bindings ───────────────────────────────────────────────────── */
  if (modalClose)  modalClose.addEventListener('click', closeModal);
  if (modal)       modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });
  if (modalSubmitBtn) modalSubmitBtn.addEventListener('click', submitPunch);
  if (toggleBtn)   toggleBtn.addEventListener('click', function() { setStaffMode(!staffMode); });

  if (pinInput) pinInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') submitPunch(); });
  if (empNumInput) empNumInput.addEventListener('keydown', function(e) { if (e.key === 'Enter' && pinInput) pinInput.focus(); });
  if (passwordInput) passwordInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') submitPunch(); });
  if (usernameInput) usernameInput.addEventListener('keydown', function(e) { if (e.key === 'Enter' && passwordInput) passwordInput.focus(); });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') closeModal();
  });

  if (btnIn)  btnIn.addEventListener('click',  function() { openModal('in'); });
  if (btnOut) btnOut.addEventListener('click', function() { openModal('out'); });

  /* ── Scroll animation ────────────────────────────────────────────────── */
  if (prefersReducedMotion) return;

  var punchHero = document.querySelector('.punch-hero');
  var punchWrap = document.querySelector('.punch-wrap');
  var scrollHint = document.querySelector('.scroll-hint');

  if (punchHero && punchWrap) {
    var ticking = false;
    function onScroll() {
      if (!ticking) {
        requestAnimationFrame(function() {
          var rect  = punchHero.getBoundingClientRect();
          var heroH = punchHero.offsetHeight;
          var scrolled  = -rect.top;
          var progress  = Math.max(0, Math.min(1, scrolled / (heroH * 0.3)));
          var scale     = 1 - progress * 0.93;
          var yMove     = progress * -420;
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
