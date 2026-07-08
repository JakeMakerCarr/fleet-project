/**
 * wvega/timepicker dropdown: cap to 5 rows and keep within the viewport.
 */
(function ($) {
  const VISIBLE_ROWS = 5;
  const EDGE_PADDING = 8;

  function measureRowHeight($container) {
    const $row = $container.find('.ui-menu-item').first();
    return $row.length ? $row.outerHeight() : 28;
  }

  function applyDropdownSize(input) {
    const $container = $('.ui-timepicker-container:visible');
    if (!$container.length || !input) return;

    const rowHeight = measureRowHeight($container);
    const fiveRowCap = rowHeight * VISIBLE_ROWS;
    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - EDGE_PADDING;
    const spaceAbove = rect.top - EDGE_PADDING;

    let openAbove = false;
    let maxHeight = Math.min(fiveRowCap, spaceBelow);

    if (spaceBelow < fiveRowCap && spaceAbove > spaceBelow) {
      openAbove = true;
      maxHeight = Math.min(fiveRowCap, spaceAbove);
    }

    maxHeight = Math.max(rowHeight * 2, Math.floor(maxHeight));
    const heightPx = maxHeight + 'px';

    $container.css({
      height: heightPx,
      maxHeight: heightPx,
      overflow: 'hidden'
    });
    $container.find('.ui-timepicker').css({
      height: heightPx,
      maxHeight: heightPx,
      overflow: 'hidden'
    });
    $container.find('.ui-timepicker-viewport').css({
      height: heightPx,
      maxHeight: heightPx,
      overflowY: 'auto',
      overflowX: 'hidden'
    });

    const docTop = openAbove
      ? rect.top + window.scrollY - maxHeight - 2
      : rect.bottom + window.scrollY + 2;
    $container.css({ top: docTop });
  }

  function scheduleFit(input) {
    [0, 16, 50, 120].forEach(function (delay) {
      setTimeout(function () {
        applyDropdownSize(input);
      }, delay);
    });
  }

  window.setupFleetTimepicker = function (inputSelector, lockPage, unlockPage) {
    $(inputSelector).on('focus.fleet-tp click.fleet-tp', function () {
      if (lockPage) lockPage();
      scheduleFit(this);
    });

    $(document).on('mousedown.fleet-tp', function (e) {
      if ($(e.target).closest(inputSelector + ', .ui-timepicker-container').length) return;
      if (unlockPage) unlockPage();
    });
  };
})(jQuery);
