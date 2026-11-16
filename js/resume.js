(function($) {
  "use strict"; // Start of use strict

  // Smooth scrolling using jQuery easing
  $('a.js-scroll-trigger[href*="#"]:not([href="#"])').click(function() {
    if (location.pathname.replace(/^\//, '') == this.pathname.replace(/^\//, '') && location.hostname == this.hostname) {
      var target = $(this.hash);
      target = target.length ? target : $('[name=' + this.hash.slice(1) + ']');
      if (target.length) {
        $('html, body').animate({
          scrollTop: (target.offset().top)
        }, 1000, "easeInOutExpo");
        return false;
      }
    }
  });

  // Closes responsive menu when a scroll trigger link is clicked
  $('.js-scroll-trigger').click(function() {
    $('.navbar-collapse').collapse('hide');
  });

  // Activate scrollspy to add active class to navbar items on scroll
  $('body').scrollspy({
    target: '#sideNav'
  });

  // The last section is shorter than the viewport, so the page bottoms out before
  // it reaches the top and the scrollspy never selects it. Highlight it at the bottom.
  $(window).on('scroll', function() {
    var spy = $('body').data('bs.scrollspy');
    if (!spy || !spy._targets.length) return;
    if (window.innerHeight + window.pageYOffset >= document.documentElement.scrollHeight - 2) {
      spy._activate(spy._targets[spy._targets.length - 1]);
    }
  });

})(jQuery); // End of use strict
