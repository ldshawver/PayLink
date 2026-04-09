document.addEventListener('DOMContentLoaded', () => {

  /* ── Scroll-driven card scale ──────────────────────────────────────────── */
  (function initCardScale() {
    var cards = Array.from(document.querySelectorAll('.feature-card, .ai-card'));
    if (!cards.length || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    function updateCardScales() {
      var vcenter = window.innerHeight / 2;
      cards.forEach(function(card) {
        var rect = card.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        var dist = Math.abs((rect.top + rect.height / 2) - vcenter);
        var t = Math.max(0, 1 - dist / (window.innerHeight * 0.75));
        card.style.setProperty('--scroll-scale', (0.86 + t * 0.14).toFixed(4));
      });
    }
    window.addEventListener('scroll', updateCardScales, { passive: true });
    window.addEventListener('resize', updateCardScales, { passive: true });
    updateCardScales();
  })();

  /* ── Why-number glitch reveal ──────────────────────────────────────────── */
  (function initGlitch() {
    var POOL = '0123456789$%#@!*+&×÷∑§¥€£₿▓░█▒↑↓→←⊕⊗';
    var glitchObs = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        var el = entry.target;
        if (!entry.isIntersecting || el.dataset.glitched) return;
        el.dataset.glitched = '1';
        glitchObs.unobserve(el);
        var target = el.getAttribute('data-val') || el.textContent.trim();
        var duration = 1400, tickMs = 55, start = Date.now();
        el.classList.add('glitching');
        var timer = setInterval(function() {
          var prog = Math.min((Date.now() - start) / duration, 1);
          if (prog >= 1) {
            clearInterval(timer);
            el.classList.remove('glitching');
            el.classList.add('revealed');
            el.textContent = target;
            return;
          }
          var result = '';
          for (var i = 0; i < Math.max(target.length, 2); i++) {
            result += (i < target.length && Math.random() < prog * 1.2)
              ? target[i]
              : POOL[Math.floor(Math.random() * POOL.length)];
          }
          el.textContent = result;
        }, tickMs);
      });
    }, { threshold: 0.6 });
    document.querySelectorAll('.why-number[data-val]').forEach(function(el) {
      glitchObs.observe(el);
    });
  })();

  /* ── Security card terminal entrance ──────────────────────────────────── */
  (function initSecCards() {
    var secCards = document.querySelectorAll('.security-deep-card');
    if (!secCards.length) return;
    var secObs = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        var card = entry.target;
        var delay = parseInt(card.getAttribute('data-sec-delay') || '0', 10);
        setTimeout(function() { card.classList.add('sec-visible'); }, delay);
        secObs.unobserve(card);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    secCards.forEach(function(c) { secObs.observe(c); });
  })();

  const toggle = document.querySelector('.mobile-toggle');
  const mobileMenu = document.querySelector('.mobile-menu');

  if (toggle && mobileMenu) {
    toggle.addEventListener('click', () => {
      mobileMenu.classList.toggle('active');
      toggle.innerHTML = mobileMenu.classList.contains('active') ? '&#x2715;' : '&#9776;';
    });

    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.remove('active');
        toggle.innerHTML = '&#9776;';
      });
    });
  }

  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    if (question) {
      question.addEventListener('click', () => {
        const isActive = item.classList.contains('active');
        faqItems.forEach(i => i.classList.remove('active'));
        if (!isActive) item.classList.add('active');
      });
    }
  });

  const scrollHint = document.querySelector('.scroll-hint');
  if (scrollHint) {
    let hintHidden = false;
    window.addEventListener('scroll', () => {
      if (!hintHidden && window.scrollY > 80) {
        scrollHint.classList.add('faded');
        hintHidden = true;
      } else if (hintHidden && window.scrollY <= 80) {
        scrollHint.classList.remove('faded');
        hintHidden = false;
      }
    }, { passive: true });
  }

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

  document.querySelectorAll('.fade-up').forEach(el => observer.observe(el));

  if (!prefersReduced) {
    const tileObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const parent = entry.target.closest('.features-grid, .why-grid, .security-grid');
          if (parent) {
            const cards = Array.from(parent.children);
            cards.forEach((card, i) => {
              setTimeout(() => {
                card.classList.add('tile-visible');
              }, i * 120);
            });
          }
          tileObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    document.querySelectorAll('.features-grid, .why-grid, .security-grid').forEach(grid => {
      const children = grid.children;
      for (let i = 0; i < children.length; i++) {
        children[i].classList.add('tile-animate');
      }
      if (children.length > 0) {
        tileObserver.observe(children[0]);
      }
    });
  }

  /* ── Dashboard number count-up ─────────────────────────────────────────── */
  function runCountUp(slide) {
    slide.querySelectorAll('.dash-countup:not([data-counted])').forEach(function(el) {
      el.setAttribute('data-counted', '1');
      var target = parseInt(el.getAttribute('data-count') || '0', 10);
      var suffix = el.getAttribute('data-suffix') || '';
      var fmt = el.getAttribute('data-format') === 'comma';
      var dur = Math.min(1200, Math.max(600, target * 5));
      var start = performance.now();
      el.classList.add('counting');
      function tick(now) {
        var prog = Math.min((now - start) / dur, 1);
        var ease = 1 - Math.pow(1 - prog, 3);
        var cur = Math.round(ease * target);
        el.textContent = (fmt ? cur.toLocaleString() : cur) + suffix;
        if (prog < 1) {
          requestAnimationFrame(tick);
        } else {
          el.textContent = (fmt ? target.toLocaleString() : target) + suffix;
          el.classList.remove('counting');
          el.classList.add('done');
        }
      }
      requestAnimationFrame(tick);
    });
  }

  /* ── Check/X matrix animation ───────────────────────────────────────────── */
  (function initCheckMatrix() {
    var MPOOL = ['0','1','|','/','-','\\','■','□','▪','▫','#','@','*','%','$','&'];
    var table = document.querySelector('.comparison-table');
    if (!table) return;
    var done = false;
    var cmpObs = new IntersectionObserver(function(entries) {
      if (done || !entries[0].isIntersecting) return;
      done = true;
      cmpObs.disconnect();
      var cells = table.querySelectorAll('.check-yes, .check-no');
      cells.forEach(function(cell, i) {
        var finalChar = cell.textContent.trim();
        setTimeout(function() {
          var iters = 0, maxIters = 12;
          var timer = setInterval(function() {
            if (iters >= maxIters) {
              clearInterval(timer);
              cell.textContent = finalChar;
              cell.classList.add('ch-matrix');
              setTimeout(function() { cell.classList.remove('ch-matrix'); }, 600);
              return;
            }
            cell.textContent = MPOOL[Math.floor(Math.random() * MPOOL.length)];
            iters++;
          }, 40);
        }, i * 38);
      });
    }, { threshold: 0.2 });
    cmpObs.observe(table);
  })();

  /* ── AI mascot typewriter ────────────────────────────────────────────────── */
  (function initAITypist() {
    var target = document.querySelector('.ai-typewriter-target');
    if (!target) return;
    var textEl = target.querySelector('.ai-typewriter-text');
    var mascot = document.querySelector('.ai-mascot');
    var fullText = target.getAttribute('data-ai-text') || '';
    var triggered = false;
    var twObs = new IntersectionObserver(function(entries) {
      if (triggered || !entries[0].isIntersecting) return;
      triggered = true;
      twObs.disconnect();
      var i = 0;
      textEl.textContent = '';
      if (mascot) mascot.style.filter = 'drop-shadow(0 0 18px rgba(16,185,129,0.8))';
      var timer = setInterval(function() {
        if (i >= fullText.length) {
          clearInterval(timer);
          target.classList.add('tw-done');
          if (mascot) {
            setTimeout(function() {
              mascot.style.filter = 'drop-shadow(0 0 12px rgba(13,148,136,0.5))';
            }, 600);
          }
          return;
        }
        textEl.textContent += fullText[i];
        i++;
      }, 48);
    }, { threshold: 0.5 });
    twObs.observe(target);
  })();

  // ── Dashboard Preview Carousel ──────────────────────────────────────────
  const cycler = document.getElementById('dashCycler');
  if (cycler) {
    const dots = cycler.querySelectorAll('.dash-dot');
    const slides = cycler.querySelectorAll('.dash-slide');
    let current = 0;
    let autoTimer = null;

    function goTo(idx) {
      slides[current].classList.remove('active');
      slides[current].classList.add('exit-left');
      dots[current].classList.remove('active');
      const prev = current;
      setTimeout(() => slides[prev].classList.remove('exit-left'), 400);
      current = idx;
      slides[current].classList.add('active');
      dots[current].classList.add('active');
      runCountUp(slides[current]);
    }

    function startAuto() {
      stopAuto();
      autoTimer = setInterval(() => {
        goTo((current + 1) % slides.length);
      }, 3500);
    }

    function stopAuto() {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
    }

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        goTo(i);
        stopAuto();
        startAuto();
      });
    });

    var dashObs = new IntersectionObserver(function(entries) {
      if (entries[0].isIntersecting) {
        runCountUp(slides[current]);
        dashObs.disconnect();
      }
    }, { threshold: 0.3 });
    dashObs.observe(cycler);

    startAuto();
  }
});
