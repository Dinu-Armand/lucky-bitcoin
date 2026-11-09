import { useEffect, useRef } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';

/**
 * Grafic lumanari + volum (TradingView Lightweight Charts).
 * props: candles [{time,open,high,low,close,volume}], lines [{price,color,title}],
 *        live (bool) + timeframe -> WebSocket Binance wss://stream.binance.com:9443/ws/btcusdc@kline_<tf>
 */
export default function Chart({ candles, lines, live, timeframe, onPrice, resetKey }) {
  const box = useRef(null);
  const chartRef = useRef(null);
  const candleS = useRef(null);
  const volS = useRef(null);
  const priceLines = useRef([]);
  const fitted = useRef(null);

  useEffect(() => {
    const chart = createChart(box.current, {
      autoSize: true,
      layout: { background: { color: '#181A20' }, textColor: '#848E9C', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
      grid: { vertLines: { color: '#20252c' }, horzLines: { color: '#20252c' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2B3139' },
      timeScale: { borderColor: '#2B3139', timeVisible: true, secondsVisible: false },
    });
    candleS.current = chart.addCandlestickSeries({
      upColor: '#0ECB81', downColor: '#F6465D', borderVisible: false, wickUpColor: '#0ECB81', wickDownColor: '#F6465D',
    });
    volS.current = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; };
  }, []);

  // date
  useEffect(() => {
    if (!candleS.current) return;
    const data = (candles || []).map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
    candleS.current.setData(data);
    volS.current.setData((candles || []).map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(14,203,129,0.35)' : 'rgba(246,70,93,0.35)' })));
    if (data.length && fitted.current !== resetKey) {
      chartRef.current.timeScale().fitContent();
      fitted.current = resetKey;
    }
  }, [candles, resetKey]);

  // linii orizontale: entry / SL / TP / limit / liquidation
  useEffect(() => {
    const s = candleS.current;
    if (!s) return;
    priceLines.current.forEach((l) => { try { s.removePriceLine(l); } catch { /* ignore */ } });
    priceLines.current = (lines || []).map((l) =>
      s.createPriceLine({ price: l.price, color: l.color, lineWidth: 1, lineStyle: l.solid ? 0 : 2, axisLabelVisible: true, title: l.title })
    );
  }, [lines]);

  // WebSocket Binance (doar Live)
  useEffect(() => {
    if (!live) return undefined;
    let ws;
    let closed = false;
    try {
      ws = new WebSocket(`wss://stream.binance.com:9443/ws/btcusdc@kline_${timeframe}`);
      ws.onmessage = (e) => {
        try {
          const k = JSON.parse(e.data).k;
          if (!k) return;
          const time = Math.floor(k.t / 1000);
          candleS.current?.update({ time, open: +k.o, high: +k.h, low: +k.l, close: +k.c });
          volS.current?.update({ time, value: +k.v, color: +k.c >= +k.o ? 'rgba(14,203,129,0.35)' : 'rgba(246,70,93,0.35)' });
          onPrice?.(+k.c);
        } catch { /* lumanare mai veche decat ultima - ignorata */ }
      };
      ws.onerror = () => {};
    } catch { /* WebSocket indisponibil: se foloseste doar tick-ul serverului */ }
    return () => { closed = true; if (ws && !closed) ws.close(); try { ws?.close(); } catch { /* ignore */ } };
  }, [live, timeframe, onPrice]);

  return <div ref={box} className="w-full h-full" />;
}
