// Candles + volume on TradingView lightweight-charts 5.2.1 (Apache-2.0), the chart engine
// fomo-terminal and solbeam use. Price or market-cap mode; gold markers for buys by wallets on
// your explosive list.
const LWC = window.LightweightCharts;

// lightweight-charts cannot parse oklch(), which the theme uses: paint one pixel with the
// theme colour and read it back as rgba.
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function rgba(color, fallback) {
  if (!color) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
  return `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 100) / 100})`;
}
const css = (v, fallback = '#888') => rgba(getComputedStyle(document.documentElement).getPropertyValue(v).trim(), fallback);

function fmtUsd(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (a >= 1) return `$${v.toFixed(3)}`;
  if (a === 0) return '$0';
  return `$${v.toPrecision(3)}`;
}

export class CoinChart {
  constructor(el) {
    this.el = el;
    this.mode = 'mcap';
    this.supply = 1e9;
    this.data = [];
    this.markers = [];
    if (!LWC) {
      el.append(Object.assign(document.createElement('div'), { className: 'note', textContent: 'Chart library did not load.' }));
      return;
    }
    this.chart = LWC.createChart(el, {
      autoSize: true,
      layout: { background: { type: 'solid', color: css('--bg') || '#101318' }, textColor: css('--ink-3') || '#999', fontFamily: 'Hanken Grotesk, system-ui, sans-serif', attributionLogo: false },
      grid: { vertLines: { color: css('--line-soft') || '#222' }, horzLines: { color: css('--line-soft') || '#222' } },
      rightPriceScale: { borderColor: css('--line') || '#333', scaleMargins: { top: 0.08, bottom: 0.06 } },
      timeScale: { borderColor: css('--line') || '#333', timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: 0 },
      localization: { priceFormatter: fmtUsd },
    });
    const up = css('--up') || '#3c9';
    const down = css('--down') || '#e66';
    this.candles = this.chart.addSeries(LWC.CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceLineColor: css('--gold') || '#cb4', priceFormat: { type: 'custom', formatter: fmtUsd, minMove: 1e-12 } });
    // volume in its own pane under the candles, so the price axis never runs below $0
    this.volume = this.chart.addSeries(LWC.HistogramSeries, { priceFormat: { type: 'custom', formatter: fmtUsd }, lastValueVisible: false, priceLineVisible: false }, 1);
    this.chart.panes()[1]?.setHeight(64);
    this.markerApi = LWC.createSeriesMarkers ? LWC.createSeriesMarkers(this.candles, []) : null;
    this.upWash = up.replace(/[\d.]+\)$/, '0.35)');
    this.downWash = down.replace(/[\d.]+\)$/, '0.35)');
  }

  set({ candles, supply, markers = [] }) {
    if (!this.chart) return;
    this.supply = supply || 1e9;
    const seen = new Set();
    this.data = (candles ?? []).filter((c) => Number.isFinite(c.open) && !seen.has(c.t) && seen.add(c.t)).sort((a, b) => a.t - b.t);
    this.markers = markers;
    this.draw();
    this.chart.timeScale().fitContent();
  }

  setMode(mode) {
    this.mode = mode;
    this.draw();
  }

  draw() {
    const k = this.mode === 'mcap' ? this.supply : 1;
    this.candles.setData(this.data.map((c) => ({ time: c.t, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k })));
    this.volume.setData(this.data.map((c) => ({ time: c.t, value: c.volumeUsd ?? 0, color: c.close >= c.open ? this.upWash : this.downWash })));
    if (this.markerApi && this.data.length) {
      const first = this.data[0].t;
      const last = this.data[this.data.length - 1].t;
      const res = this.data.length > 1 ? this.data[1].t - this.data[0].t : 60;
      const snap = (t) => this.data.reduce((best, c) => (c.t <= t ? c.t : best), first);
      this.markerApi.setMarkers(this.markers
        .filter((m) => m.t >= first - res && m.t <= last + res)
        .map((m) => ({ time: snap(m.t), position: 'belowBar', color: css('--gold', '#cb4'), shape: 'arrowUp', text: m.text }))
        .sort((a, b) => a.time - b.time));
    }
  }

  destroy() {
    this.chart?.remove();
  }
}
