/**
 * The one set of product facts all three sketches share:
 * a manual reading for 2026-10-08, 29°C at 15:30, Guangzhou.
 */
(function () {
  var SAMPLE = {
    date: '10月8日 周四',
    dateShort: '10月8日',
    dateLong: '2026年10月8日',
    temp: '29',
    tempValue: 29,
    time: '15:30',
    place: '广州',
    unit: '°C'
  };

  window.SAMPLE = SAMPLE;

  document.querySelectorAll('[data-sample]').forEach(function (el) {
    var key = el.getAttribute('data-sample');
    if (Object.prototype.hasOwnProperty.call(SAMPLE, key)) el.textContent = SAMPLE[key];
  });

  // Position of 29°C on the −10…40 scale, for sketches that draw a rail.
  var ratio = (SAMPLE.tempValue - -10) / (40 - -10);
  document.documentElement.style.setProperty('--temp-ratio', String(ratio));
})();
