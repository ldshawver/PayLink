document.addEventListener('DOMContentLoaded', function() {
  var cycler = document.getElementById('dashCycler');
  if (!cycler) return;

  var slides = cycler.querySelectorAll('.dash-slide');
  var dots = cycler.querySelectorAll('.dash-dot');
  var progressFill = document.getElementById('dashProgressFill');
  var totalSlides = slides.length;
  var currentSlide = 0;
  var interval = 5000;
  var timer = null;
  var progressTimer = null;
  var paused = false;

  function goToSlide(index) {
    var prev = cycler.querySelector('.dash-slide.active');
    if (prev) {
      prev.classList.remove('active');
      prev.classList.add('exit-left');
      setTimeout(function() { prev.classList.remove('exit-left'); }, 500);
    }

    dots.forEach(function(d) { d.classList.remove('active'); });
    dots[index].classList.add('active');

    slides[index].classList.add('active');
    currentSlide = index;

    startProgress();
  }

  function nextSlide() {
    goToSlide((currentSlide + 1) % totalSlides);
  }

  function startProgress() {
    if (progressFill) {
      progressFill.style.transition = 'none';
      progressFill.style.width = '0%';
      void progressFill.offsetWidth;
      progressFill.style.transition = 'width ' + (interval / 1000) + 's linear';
      progressFill.style.width = '100%';
    }
  }

  function startCycling() {
    if (timer) clearInterval(timer);
    timer = setInterval(function() {
      if (!paused) nextSlide();
    }, interval);
    startProgress();
  }

  dots.forEach(function(dot) {
    dot.addEventListener('click', function() {
      var page = parseInt(dot.getAttribute('data-page'));
      goToSlide(page);
      if (timer) clearInterval(timer);
      startCycling();
    });
  });

  cycler.addEventListener('mouseenter', function() { paused = true; });
  cycler.addEventListener('mouseleave', function() { paused = false; });

  startCycling();
});
