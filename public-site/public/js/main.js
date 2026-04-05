document.addEventListener('DOMContentLoaded', () => {
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
      setTimeout(() => slides[current < slides.length ? current : 0].classList.remove('exit-left'), 400);
      current = idx;
      slides[current].classList.add('active');
      dots[current].classList.add('active');
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

    startAuto();
  }
});
