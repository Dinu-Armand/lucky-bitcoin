// Algoritmul de evaluare a personalitatii de trader (scor, rating, arhetip, diagnostic RO/EN)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const f = (n, d = 2) => Number(n).toFixed(d);
const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);

export function gradeOf(score) {
  return score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : score >= 35 ? 'D' : 'F';
}

export function generateReviewData(session, positions, orders) {
  const init = Number(session.initial_balance);
  const closed = positions.filter((p) => p.status !== 'OPEN');
  const sorted = [...closed].sort((a, b) => new Date(a.closed_at) - new Date(b.closed_at));
  const realized = (p) => Number(p.realized_pnl_usdc ?? 0);
  const gross = (p) =>
    p.status === 'LIQUIDATED'
      ? -p.margin_usdc
      : (p.side === 'LONG' ? p.exit_price - p.entry_price : p.entry_price - p.exit_price) * p.quantity_btc;

  const trades = positions.length;
  const wins = closed.filter((p) => realized(p) > 0).length;
  const winRate = closed.length ? (wins / closed.length) * 100 : 0;
  const grossProfit = sum(closed.filter((p) => realized(p) > 0), realized);
  const grossLoss = Math.abs(sum(closed.filter((p) => realized(p) < 0), realized));
  const profitFactor = grossLoss > 0 ? Math.min(99, grossProfit / grossLoss) : grossProfit > 0 ? 99 : 0;
  const netPnl = sum(closed, realized);
  const netPnlPct = init ? (netPnl / init) * 100 : 0;
  const totalFees = sum(positions, (p) => Number(p.opening_fee_usdc) + Number(p.closing_fee_usdc));
  const grossPos = sum(closed, (p) => Math.max(0, gross(p)));
  const feeBleed = grossPos > 0 ? Math.min(999, (totalFees / grossPos) * 100) : null;

  let bal = init, peak = init, maxDD = 0;
  for (const p of sorted) {
    bal += realized(p);
    peak = Math.max(peak, bal);
    if (peak > 0) maxDD = Math.max(maxDD, ((peak - bal) / peak) * 100);
  }

  const durations = closed
    .filter((p) => p.closed_at && p.opened_at)
    .map((p) => (new Date(p.closed_at) - new Date(p.opened_at)) / 60000);
  const avgDuration = durations.length ? sum(durations, (x) => x) / durations.length : 0;

  const rrList = positions
    .filter((p) => p.stop_loss != null && p.take_profit != null && p.entry_price !== p.stop_loss)
    .map((p) => Math.abs(p.take_profit - p.entry_price) / Math.abs(p.entry_price - p.stop_loss));
  const avgRR = rrList.length ? sum(rrList, (x) => x) / rrList.length : null;

  const slCount = positions.filter((p) => p.stop_loss != null).length;
  const slUsage = trades ? (slCount / trades) * 100 : 0;
  const avgLev = trades ? sum(positions, (p) => p.leverage) / trades : 0;
  const makerRatio = orders.length ? (orders.filter((o) => o.order_type === 'LIMIT').length / orders.length) * 100 : 0;
  const liquidations = closed.filter((p) => p.status === 'LIQUIDATED').length;

  // Revenge trading: pozitie noua la scurt timp dupa o pierdere, cu levier mare fara SL sau marime crescuta
  const byOpen = [...positions].sort((a, b) => new Date(a.opened_at) - new Date(b.opened_at));
  let revenge = 0;
  let revengeNoSl = 0;
  for (let i = 1; i < byOpen.length; i++) {
    const prev = byOpen[i - 1], cur = byOpen[i];
    if (prev.status === 'OPEN' || realized(prev) >= 0 || !prev.closed_at) continue;
    const gap = (new Date(cur.opened_at) - new Date(prev.closed_at)) / 60000;
    if (gap < 0 || gap > 15) continue;
    const bigger = cur.margin_usdc > prev.margin_usdc * 1.5;
    const reckless = cur.leverage >= 5 && cur.stop_loss == null;
    if (bigger || reckless) {
      revenge++;
      if (cur.leverage >= 5 && cur.stop_loss == null) revengeNoSl++;
    }
  }

  // ---- Scor ----
  let score = 50;
  if (trades === 0) {
    score = 50;
  } else {
    score += (winRate - 50) * 0.3;
    score += clamp((profitFactor - 1) * 10, -15, 15);
    score += (slUsage / 100 - 0.5) * 20;
    if (avgLev > 3) score -= Math.min(12, (avgLev - 3) * 1.5);
    if (feeBleed != null) score -= Math.min(10, feeBleed / 3);
    score -= Math.min(25, liquidations * 10);
    score -= Math.min(15, revenge * 5);
    if (avgRR != null) score += avgRR >= 2 ? 8 : avgRR >= 1.5 ? 4 : avgRR < 1 ? -5 : 0;
    score += clamp(netPnlPct * 0.1, -10, 10);
    score += (makerRatio / 100) * 5;
  }
  score = Math.round(clamp(score, 0, 100));
  const grade = gradeOf(score);

  // ---- Arhetip ----
  let archetype = 'BALANCED_OPPORTUNIST';
  if (trades === 0) archetype = 'OBSERVER';
  else if (liquidations >= 1 || (avgLev >= 7 && slUsage < 50)) archetype = 'HIGH_LEVERAGE_GAMBLER';
  else if (revenge >= 2) archetype = 'REVENGE_TRADER';
  else if (trades >= 8 && avgDuration > 0 && avgDuration < 15) archetype = 'IMPULSIVE_SCALPER';
  else if (slUsage >= 80 && avgLev <= 3) archetype = 'RISK_AVERSE_STRATEGIST';
  else if (slUsage >= 70 && avgRR != null && avgRR >= 1.5) archetype = 'DISCIPLINED_SNIPER';

  // ---- Diagnostic narativ ----
  const ro = [], en = [];
  const add = (r, e) => { ro.push(r); en.push(e); };
  if (trades === 0) {
    add('Nu ai executat nicio tranzacție în această sesiune. Observarea pieței este valoroasă, dar fără decizii nu pot evalua comportamentul tău.',
        'You have not executed any trade in this session. Watching the market is valuable, but without decisions your behaviour cannot be assessed.');
  } else {
    if (closed.length) {
      if (winRate >= 55) add(`Win rate bun: ${f(winRate, 1)}% din tranzacțiile închise sunt pe profit.`, `Solid win rate: ${f(winRate, 1)}% of closed trades are profitable.`);
      else if (winRate < 40) add(`Win rate scăzut (${f(winRate, 1)}%). Reevaluează condițiile de intrare și evită tranzacțiile impulsive.`, `Low win rate (${f(winRate, 1)}%). Re-evaluate your entry conditions and avoid impulsive trades.`);
      else add(`Win rate echilibrat (${f(winRate, 1)}%); rezultatul depinde de raportul risc/recompensă.`, `Balanced win rate (${f(winRate, 1)}%); results depend on your risk/reward ratio.`);
      add(`Profit Factor ${f(profitFactor)} (${profitFactor >= 1.5 ? 'foarte bun' : profitFactor >= 1 ? 'pozitiv' : 'sub 1: pierderile depășesc câștigurile'}).`,
          `Profit Factor ${f(profitFactor)} (${profitFactor >= 1.5 ? 'very good' : profitFactor >= 1 ? 'positive' : 'below 1: losses exceed gains'}).`);
    }
    if (slUsage >= 80) add(`Disciplină excelentă: ${f(slUsage, 0)}% din poziții au Stop-Loss.`, `Excellent discipline: ${f(slUsage, 0)}% of positions have a Stop-Loss.`);
    else if (slUsage < 50) add(`Doar ${f(slUsage, 0)}% din poziții au Stop-Loss. Tranzacționarea fără protecție expune contul la pierderi majore.`, `Only ${f(slUsage, 0)}% of positions have a Stop-Loss. Trading unprotected exposes the account to large losses.`);
    else add(`Stop-Loss folosit în ${f(slUsage, 0)}% din poziții; încearcă să ajungi la 100%.`, `Stop-Loss used on ${f(slUsage, 0)}% of positions; aim for 100%.`);
    if (avgLev >= 7) add(`Levierul mediu este x${f(avgLev, 1)}, foarte agresiv: o mișcare mică de preț poate duce la lichidare.`, `Average leverage is x${f(avgLev, 1)}, very aggressive: a small price move can liquidate you.`);
    else if (avgLev <= 3) add(`Levier prudent (x${f(avgLev, 1)} în medie), potrivit pentru supraviețuire pe termen lung.`, `Prudent leverage (x${f(avgLev, 1)} on average), suited for long-term survival.`);
    else add(`Levier mediu moderat (x${f(avgLev, 1)}).`, `Moderate average leverage (x${f(avgLev, 1)}).`);
    if (feeBleed != null && feeBleed >= 10) add(`Comisioanele ți-au consumat ${f(feeBleed, 0)}% din profitul brut; folosește mai des ordine Limit (Maker 0.02% vs Taker 0.05%).`, `Fees consumed ${f(feeBleed, 0)}% of your gross profit; use Limit orders more often (Maker 0.02% vs Taker 0.05%).`);
    else add(`Comisioane totale plătite: ${f(totalFees, 4)} USDC${feeBleed != null ? ` (${f(feeBleed, 1)}% din profitul brut)` : ''}.`, `Total fees paid: ${f(totalFees, 4)} USDC${feeBleed != null ? ` (${f(feeBleed, 1)}% of gross profit)` : ''}.`);
    if (avgRR != null) add(`Raport risc/recompensă mediu ${f(avgRR)}:1${avgRR < 1 ? ' – riști mai mult decât poți câștiga' : avgRR >= 2 ? ' – excelent' : ''}.`, `Average risk/reward ${f(avgRR)}:1${avgRR < 1 ? ' – you risk more than you can win' : avgRR >= 2 ? ' – excellent' : ''}.`);
    else add('Nu ai folosit simultan SL și TP, deci raportul risc/recompensă nu poate fi calculat.', 'You did not use SL and TP together, so the risk/reward ratio cannot be computed.');
    if (revenge > 0) add(`Ai deschis ${revenge} poziții imediat după o pierdere, ${revengeNoSl ? `dintre care ${revengeNoSl} cu levier ≥ x5 fără Stop-Loss, ` : ''}semn de Revenge Trading.`, `You opened ${revenge} positions right after a loss${revengeNoSl ? `, ${revengeNoSl} of them with leverage ≥ x5 and no Stop-Loss,` : ''} – a sign of Revenge Trading.`);
    if (liquidations > 0) add(`${liquidations} poziție/poziții au fost LICHIDATE – marja a fost pierdută integral.`, `${liquidations} position(s) were LIQUIDATED – the margin was lost entirely.`);
    if (maxDD >= 25) add(`Drawdown maxim ${f(maxDD, 1)}% – risc de cont foarte ridicat.`, `Maximum drawdown ${f(maxDD, 1)}% – very high account risk.`);
    else add(`Drawdown maxim ${f(maxDD, 1)}%.`, `Maximum drawdown ${f(maxDD, 1)}%.`);
    if (durations.length) add(`Durata medie a unei poziții: ${f(avgDuration, 0)} minute.`, `Average position duration: ${f(avgDuration, 0)} minutes.`);
    add(`PnL net: ${netPnl >= 0 ? '+' : ''}${f(netPnl, 2)} USDC (${netPnlPct >= 0 ? '+' : ''}${f(netPnlPct, 1)}%).`, `Net PnL: ${netPnl >= 0 ? '+' : ''}${f(netPnl, 2)} USDC (${netPnlPct >= 0 ? '+' : ''}${f(netPnlPct, 1)}%).`);
  }

  return {
    score, grade, archetype,
    win_rate: round2(winRate),
    avg_leverage: round2(avgLev),
    sl_usage_rate: round2(slUsage),
    total_fees_paid: totalFees,
    metrics: {
      trades, closed: closed.length, wins, profitFactor: round2(profitFactor), avgRR: avgRR == null ? null : round2(avgRR),
      feeBleed: feeBleed == null ? null : round2(feeBleed), maxDrawdown: round2(maxDD), avgDurationMin: round2(avgDuration),
      revengeCount: revenge, liquidations, makerRatio: round2(makerRatio), netPnl: round2(netPnl), netPnlPct: round2(netPnlPct),
    },
    feedback_ro: ro.join('\n'),
    feedback_en: en.join('\n'),
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Upsert in trader_reviews (pastreaza notitele existente). `c` = client sau pool. */
export async function saveReview(c, session, positions, orders) {
  const d = generateReviewData(session, positions, orders);
  const { rows } = await c.query(
    `INSERT INTO trader_reviews
       (session_id, user_id, score, grade, archetype, win_rate, avg_leverage, sl_usage_rate, total_fees_paid, metrics, feedback_ro, feedback_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (session_id) DO UPDATE SET
       score=EXCLUDED.score, grade=EXCLUDED.grade, archetype=EXCLUDED.archetype, win_rate=EXCLUDED.win_rate,
       avg_leverage=EXCLUDED.avg_leverage, sl_usage_rate=EXCLUDED.sl_usage_rate, total_fees_paid=EXCLUDED.total_fees_paid,
       metrics=EXCLUDED.metrics, feedback_ro=EXCLUDED.feedback_ro, feedback_en=EXCLUDED.feedback_en, updated_at=now()
     RETURNING *`,
    [session.id, session.user_id, d.score, d.grade, d.archetype, d.win_rate, d.avg_leverage, d.sl_usage_rate,
     d.total_fees_paid, JSON.stringify(d.metrics), d.feedback_ro, d.feedback_en]
  );
  return rows[0];
}
