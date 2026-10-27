(function () {
  'use strict';

  var esc = window.SkyUI.esc;

  function lineChart(points, options) {
    var opts = options || {};
    var data = Array.isArray(points) ? points : [];
    var width = 760;
    var height = opts.height || 240;
    var pad = { top: 20, right: 16, bottom: 36, left: 58 };
    var valueKey = opts.valueKey || 'value';
    var labelKey = opts.labelKey || 'date';
    var format = opts.format || function (value) { return String(value); };
    if (!data.length) return '<div class="chart-empty">No data for this period.</div>';
    var values = data.map(function (point) { return Number(point[valueKey]) || 0; });
    var max = Math.max.apply(null, values.concat([1]));
    var min = 0;
    if (opts.refundKey) {
      var refunds = data.map(function (point) { return Number(point[opts.refundKey]) || 0; });
      max = Math.max(max, Math.max.apply(null, refunds.concat([1])));
    }
    // Round max up for cleaner axis ticks
    var niceMax = max;
    if (max > 0) {
      var magnitude = Math.pow(10, Math.floor(Math.log10(max)));
      niceMax = Math.ceil(max / magnitude) * magnitude;
      if (niceMax < max * 1.05) niceMax = Math.ceil(max / (magnitude / 2)) * (magnitude / 2);
    }
    max = niceMax || 1;
    var plotW = width - pad.left - pad.right;
    var plotH = height - pad.top - pad.bottom;
    function x(i) { return pad.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW); }
    function y(v) { return pad.top + plotH - ((v - min) / (max - min || 1)) * plotH; }
    var delivered = data.map(function (point, index) { return x(index) + ',' + y(Number(point[valueKey]) || 0); }).join(' ');
    var area = 'M' + x(0) + ',' + (pad.top + plotH) + ' L' + delivered.replace(/ /g, ' L') + ' L' + x(data.length - 1) + ',' + (pad.top + plotH) + ' Z';
    var grid = '';
    var yLabels = '';
    for (var g = 0; g <= 4; g += 1) {
      var gy = pad.top + (plotH / 4) * g;
      var gVal = max - (max / 4) * g;
      grid += '<line x1="' + pad.left + '" y1="' + gy + '" x2="' + (width - pad.right) + '" y2="' + gy + '" class="grid-line"/>';
      yLabels += '<text x="' + (pad.left - 6) + '" y="' + (gy + 4) + '" text-anchor="end" class="axis-label">' + esc(format(Math.round(gVal))) + '</text>';
    }
    var circles = data.map(function (point, index) {
      return '<circle cx="' + x(index) + '" cy="' + y(Number(point[valueKey]) || 0) + '" r="3.2" class="dot"><title>'
        + esc(String(point[labelKey])) + ': ' + esc(format(Number(point[valueKey]) || 0)) + '</title></circle>';
    }).join('');
    var refundPath = '';
    if (opts.refundKey) {
      var refundPoints = data.map(function (point, index) { return x(index) + ',' + y(Number(point[opts.refundKey]) || 0); }).join(' ');
      refundPath = '<polyline points="' + refundPoints + '" class="refund-line"/>';
    }
    var labels = '';
    var step = data.length <= 7 ? 1 : Math.ceil(data.length / 7);
    for (var i = 0; i < data.length; i += step) {
      var anchor = i === 0 ? 'start' : i >= data.length - step ? 'end' : 'middle';
      labels += '<text x="' + x(i) + '" y="' + (height - 10) + '" text-anchor="' + anchor + '" class="axis-label">' + esc(String(data[i][labelKey] || '')) + '</text>';
    }
    // Always show last label if not already included
    if (data.length > 1 && (data.length - 1) % step !== 0) {
      labels += '<text x="' + x(data.length - 1) + '" y="' + (height - 10) + '" text-anchor="end" class="axis-label">' + esc(String(data[data.length - 1][labelKey] || '')) + '</text>';
    }
    return '<div class="chart"><svg viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="' + esc(opts.title || 'Trend chart') + '" preserveAspectRatio="xMidYMid meet">'
      + grid
      + yLabels
      + '<path d="' + area + '" class="area-fill"/>'
      + '<polyline points="' + delivered + '" class="data-line"/>'
      + refundPath
      + circles + labels
      + '</svg><div class="chart-legend"><span><i class="key delivered"></i>' + esc(opts.valueLabel || 'Delivered sales') + '</span>'
      + (opts.refundKey ? '<span><i class="key refunded"></i>' + esc(opts.refundLabel || 'Refunds') + '</span>' : '')
      + '</div></div>';
  }

  function barList(items, options) {
    var opts = options || {};
    var rows = Array.isArray(items) ? items : [];
    if (!rows.length) return '<div class="chart-empty">No data for this period.</div>';
    var labelKey = opts.labelKey || 'name';
    var valueKey = opts.valueKey || 'value';
    var format = opts.format || function (value) { return String(value); };
    var max = Math.max.apply(null, rows.map(function (row) { return Number(row[valueKey]) || 0; }).concat([1]));
    return '<div class="bar-list">' + rows.map(function (row) {
      var value = Number(row[valueKey]) || 0;
      var pct = Math.max(2, Math.round((value / max) * 100));
      return '<div class="bar-row"><div class="bar-label"><span>' + esc(String(row[labelKey] || '')) + '</span><strong>' + esc(format(value)) + '</strong></div>'
        + '<div class="bar-track"><span style="width:' + pct + '%"></span></div></div>';
    }).join('') + '</div>';
  }

  function miniBars(values) {
    var rows = Array.isArray(values) ? values : [];
    var max = Math.max.apply(null, rows.concat([1]));
    return '<div class="mini-bars" aria-hidden="true">' + rows.map(function (value) {
      return '<span style="height:' + Math.max(8, Math.round((Number(value) || 0) / max * 100)) + '%"></span>';
    }).join('') + '</div>';
  }

  window.SkyCharts = { lineChart: lineChart, barList: barList, miniBars: miniBars };
})();
