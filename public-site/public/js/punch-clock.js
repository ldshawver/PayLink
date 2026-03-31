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

    if (timeDigits) timeDigits.textContent = h12 + ':' + (m < 10 ? '0' : '') + m;
    if (timeSec) timeSec.textContent = ':' + (s < 10 ? '0' : '') + s;
    if (timeAmPm) timeAmPm.textContent = ampm;
    if (dateDisplay) dateDisplay.textContent = now.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    if (hourHand) hourHand.style.transform = 'rotate(' + (((h % 12) + m / 60) * 30) + 'deg)';
    if (minuteHand) minuteHand.style.transform = 'rotate(' + ((m + s / 60) * 6) + 'deg)';
    if (secondHand) secondHand.style.transform = 'rotate(' + (s * 6) + 'deg)';
  }

  updateClock();
  setInterval(updateClock, 1000);

  /* ── Modal elements ───────────────────────────────────────────────────── */
  var modal          = document.getElementById('punchModal');
  var modalClose     = document.getElementById('punchModalClose');
  var modalForm      = document.getElementById('punchModalForm');
  var modalSuccess   = document.getElementById('punchModalSuccess');
  var modalIcon      = document.getElementById('punchModalIcon');
  var modalTitle     = document.getElementById('punchModalTitle');
  var modalSubmitBtn = document.getElementById('punchModalSubmit');
  var modalSubmitTxt = document.getElementById('punchModalSubmitText');
  var modalError     = document.getElementById('punchModalError');
  var empNumInput    = document.getElementById('punchEmpNum');
  var pinInput       = document.getElementById('punchPin');
  var successName    = document.getElementById('punchModalSuccessName');
  var successMsg     = document.getElementById('punchModalSuccessMsg');
  var countdownEl    = document.getElementById('punchModalCountdown');

  var currentType    = 'in';
  var countdownTimer = null;

  function openModal(type) {
    currentType = type;
    var isOut = type === 'out';

    modalIcon.className = 'punch-modal-icon' + (isOut ? ' out' : '');
    modalIcon.innerHTML = isOut ? '&#9632;' : '&#9654;';
    modalTitle.textContent = isOut ? 'Clock Out' : 'Clock In';
    modalSubmitTxt.textContent = isOut ? 'Clock Out' : 'Clock In';
    modalSubmitBtn.className = 'punch-modal-submit' + (isOut ? ' out' : '');

    empNumInput.value = '';
    pinInput.value = '';
    modalError.textContent = '';
    modalForm.style.display = '';
    modalSuccess.style.display = 'none';
    modal.style.display = 'flex';
    setTimeout(function() { empNumInput.focus(); }, 80);

    if (cardSlot && !prefersReducedMotion) {
      cardSlot.classList.remove('punching');
      void cardSlot.offsetWidth;
      cardSlot.classList.add('punching');
    }
  }

  function closeModal() {
    modal.style.display = 'none';
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (btnIn) { btnIn.disabled = false; }
    if (btnOut) { btnOut.disabled = false; }
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
    var isOut = type === 'out';
    successName.textContent = name ? name + (isOut ? ' — Clocked Out!' : ' — Clocked In!') : (isOut ? 'Clocked Out!' : 'Clocked In!');
    successMsg.textContent = isOut ? 'See you next time!' : 'Have a great shift.';
    modalForm.style.display = 'none';
    modalSuccess.style.display = '';
    if (statusLine) {
      statusLine.textContent = isOut ? 'Clocked out successfully' : 'Clocked in successfully';
      statusLine.className = 'clock-status-line success';
    }
    startCountdown();
  }

  function showError(msg) {
    modalError.textContent = msg || 'Something went wrong. Please try again.';
    modalSubmitBtn.disabled = false;
    modalSubmitTxt.textContent = currentType === 'out' ? 'Clock Out' : 'Clock In';
  }

  function submitPunch() {
    var empNum = empNumInput ? empNumInput.value.trim() : '';
    var pin = pinInput ? pinInput.value.trim() : '';
    if (!empNum || !pin) { showError('Please enter your employee number and PIN.'); return; }

    modalSubmitBtn.disabled = true;
    modalSubmitTxt.textContent = 'Please wait…';
    modalError.textContent = '';

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

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });
  if (modalSubmitBtn) modalSubmitBtn.addEventListener('click', submitPunch);
  if (pinInput) pinInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') submitPunch(); });
  if (empNumInput) empNumInput.addEventListener('keydown', function(e) { if (e.key === 'Enter') pinInput && pinInput.focus(); });
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && modal && modal.style.display !== 'none') closeModal(); });

  if (btnIn) btnIn.addEventListener('click', function() { openModal('in'); });
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
