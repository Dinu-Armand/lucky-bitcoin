// Rapoarte PDF / CSV / Excel generate din datele PostgreSQL.
import { Router } from 'express';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { query } from '../db.js';
import { authenticate, requireRole, audit } from '../auth.js';
import { asyncH, HttpError } from '../utils.js';

const r = Router();
r.use(authenticate);
const isStaff = (u) => ['ANALYST', 'ADMIN'].includes(u.role);

const L = {
  ro: {
    app: 'Lucky Bitcoin', sub: 'Simulator de tranzacționare BTC/USDC', report: 'Raport sesiune', history: 'Istoric sesiuni', aggregate: 'Raport agregat de performanță',
    generated: 'Generat la', trader: 'Trader', session: 'Sesiune', mode: 'Mod', start: 'Sumă start', end: 'Sumă finală', pnl: 'PnL net', pnlPct: 'PnL %', trades: 'Tranzacții',
    fees: 'Comisioane', status: 'Status', created: 'Creată', score: 'Scor', grade: 'Rating', archetype: 'Arhetip', profile: 'Profil de trader', diagnosis: 'Diagnostic',
    mentor: 'Observații mentor', positions: 'Poziții', side: 'Direcție', lev: 'Levier', entry: 'Intrare', exit: 'Ieșire', margin: 'Marjă', qty: 'Cantitate BTC', reason: 'Motiv închidere',
    opened: 'Deschisă', closed: 'Închisă', sessions: 'Sesiuni', avgScore: 'Scor mediu', name: 'Nume', winRate: 'Win rate %', avgLev: 'Levier mediu', slUsage: 'Utilizare SL %',
    arch: { DISCIPLINED_SNIPER: 'Lunetist disciplinat', HIGH_LEVERAGE_GAMBLER: 'Jucător cu levier mare', IMPULSIVE_SCALPER: 'Scalper impulsiv', RISK_AVERSE_STRATEGIST: 'Strateg prudent',
      REVENGE_TRADER: 'Revenge Trader', BALANCED_OPPORTUNIST: 'Oportunist echilibrat', OBSERVER: 'Observator' },
  },
  en: {
    app: 'Lucky Bitcoin', sub: 'BTC/USDC Trading Simulator', report: 'Session report', history: 'Session history', aggregate: 'Aggregate performance report',
    generated: 'Generated at', trader: 'Trader', session: 'Session', mode: 'Mode', start: 'Start balance', end: 'Final balance', pnl: 'Net PnL', pnlPct: 'PnL %', trades: 'Trades',
    fees: 'Fees', status: 'Status', created: 'Created', score: 'Score', grade: 'Grade', archetype: 'Archetype', profile: 'Trader profile', diagnosis: 'Diagnosis',
    mentor: 'Mentor notes', positions: 'Positions', side: 'Side', lev: 'Leverage', entry: 'Entry', exit: 'Exit', margin: 'Margin', qty: 'Qty BTC', reason: 'Close reason',
    opened: 'Opened', closed: 'Closed', sessions: 'Sessions', avgScore: 'Avg score', name: 'Name', winRate: 'Win rate %', avgLev: 'Avg leverage', slUsage: 'SL usage %',
    arch: { DISCIPLINED_SNIPER: 'Disciplined Sniper', HIGH_LEVERAGE_GAMBLER: 'High-Leverage Gambler', IMPULSIVE_SCALPER: 'Impulsive Scalper', RISK_AVERSE_STRATEGIST: 'Risk-Averse Strategist',
      REVENGE_TRADER: 'Revenge Trader', BALANCED_OPPORTUNIST: 'Balanced Opportunist', OBSERVER: 'Observer' },
  },
};

const n = (v, d = 2) => (v == null ? '' : Number(v).toFixed(d));
const iso = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '');
const ascii = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, ''); // Helvetica (PDF) nu are diacriticele RO

async function sessionBundle(req) {
  const id = parseInt(req.query.session, 10);
  if (!id) throw new HttpError(400, 'session query parameter required', 'INVALID_ID');
  const s = (await query('SELECT s.*, u.username FROM trading_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1', [id])).rows[0];
  if (!s) throw new HttpError(404, 'Session not found', 'NOT_FOUND');
  if (s.user_id !== req.user.id && !isStaff(req.user)) throw new HttpError(403, 'Forbidden', 'FORBIDDEN');
  const positions = (await query('SELECT * FROM positions WHERE session_id=$1 ORDER BY id', [id])).rows;
  const review = (await query('SELECT * FROM trader_reviews WHERE session_id=$1', [id])).rows[0] || null;
  const fees = positions.reduce((a, p) => a + p.opening_fee_usdc + p.closing_fee_usdc, 0);
  const pnl = positions.reduce((a, p) => a + (p.realized_pnl_usdc || 0), 0);
  return { s, positions, review, fees, pnl };
}

async function historyRows(req) {
  const { rows } = await query(
    `SELECT s.*, u.username, COALESCE(p.trades,0)::int trades, COALESCE(p.fees,0) fees, COALESCE(p.pnl,0) pnl, rv.score, rv.grade, rv.archetype
       FROM trading_sessions s JOIN users u ON u.id=s.user_id
       LEFT JOIN (SELECT session_id, COUNT(*) trades, SUM(opening_fee_usdc+closing_fee_usdc) fees, SUM(realized_pnl_usdc) pnl FROM positions WHERE status<>'OPEN' GROUP BY session_id) p ON p.session_id=s.id
       LEFT JOIN trader_reviews rv ON rv.session_id=s.id
      WHERE ($1::boolean OR s.user_id=$2) ORDER BY s.created_at DESC`, [isStaff(req.user), req.user.id]);
  return rows;
}

async function aggregateRows() {
  const { rows } = await query(
    `SELECT u.username, COUNT(DISTINCT s.id)::int sessions, COALESCE(SUM(p.trades),0)::int trades, COALESCE(SUM(p.fees),0) fees, COALESCE(SUM(p.pnl),0) pnl,
            ROUND(AVG(rv.score)::numeric,1) avg_score, ROUND(AVG(rv.win_rate)::numeric,1) win_rate, ROUND(AVG(rv.avg_leverage)::numeric,2) avg_lev, ROUND(AVG(rv.sl_usage_rate)::numeric,1) sl_usage
       FROM users u JOIN roles ro ON ro.id=u.role_id AND ro.name IN ('TRADER','ADMIN')
       JOIN trading_sessions s ON s.user_id=u.id
       LEFT JOIN (SELECT session_id, COUNT(*) trades, SUM(opening_fee_usdc+closing_fee_usdc) fees, SUM(realized_pnl_usdc) pnl FROM positions WHERE status<>'OPEN' GROUP BY session_id) p ON p.session_id=s.id
       LEFT JOIN trader_reviews rv ON rv.session_id=s.id
      GROUP BY u.username ORDER BY pnl DESC`);
  return rows;
}

/* ------------------------------------------------------------- builders */
const csvCell = (v) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows) => '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');

function pdfTable(doc, cols, rows, opts = {}) {
  const rowH = 15;
  const x0 = doc.page.margins.left;
  const draw = (cells, header, colorFn) => {
    if (doc.y + rowH > doc.page.height - 50) { doc.addPage(); doc.y = 50; drawHeader(); }
    const y = doc.y;
    if (header) doc.rect(x0, y - 2, cols.reduce((a, c) => a + c.w, 0), rowH).fill('#181A20');
    let x = x0;
    cells.forEach((cell, i) => {
      doc.fillColor(header ? '#FCD535' : colorFn?.(i, cell) || '#222222').font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5)
        .text(ascii(cell), x + 2, y + 1, { width: cols[i].w - 4, align: cols[i].align || 'left', lineBreak: false });
      x += cols[i].w;
    });
    doc.y = y + rowH;
  };
  const drawHeader = () => draw(cols.map((c) => c.label), true);
  drawHeader();
  rows.forEach((row, idx) => {
    if (idx % 2 === 0) doc.rect(x0, doc.y - 2, cols.reduce((a, c) => a + c.w, 0), rowH).fill('#F4F5F7');
    draw(row, false, opts.color);
  });
  doc.moveDown(0.5);
}

function pdfBase(res, filename, title, subtitle, lbl) {
  const doc = new PDFDocument({ size: 'A4', margin: 36, layout: 'portrait', info: { Title: `Lucky Bitcoin - ${title}`, Author: 'Lucky Bitcoin' } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);
  doc.rect(0, 0, doc.page.width, 70).fill('#0B0E11');
  doc.fillColor('#FCD535').font('Helvetica-Bold').fontSize(22).text('Lucky Bitcoin', 36, 20);
  doc.fillColor('#848E9C').font('Helvetica').fontSize(9).text(ascii(`${lbl.sub}  |  ${title}`), 36, 47);
  doc.fillColor('#848E9C').fontSize(8).text(ascii(`${lbl.generated}: ${iso(new Date())}`), 36, 47, { align: 'right', width: doc.page.width - 72 });
  doc.y = 90;
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(14).text(ascii(subtitle), 36, doc.y);
  doc.moveDown(0.6);
  return doc;
}

const pnlColor = (i, cell) => (/^-/.test(String(cell)) ? '#C0283E' : /^\+/.test(String(cell)) ? '#0A9A64' : null);
const signed = (v, d = 2) => (v == null ? '' : (v > 0 ? '+' : '') + Number(v).toFixed(d));

/* ---------------------------------------------------------------- routes */
r.get('/session', asyncH(async (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'ro';
  const lbl = L[lang];
  const format = ['pdf', 'csv', 'xlsx'].includes(req.query.format) ? req.query.format : 'pdf';
  const { s, positions, review, fees, pnl } = await sessionBundle(req);
  const pct = (pnl / s.initial_balance) * 100;
  const base = `lucky-bitcoin-session-${s.id}`;
  const arch = review ? lbl.arch[review.archetype] || review.archetype : '';
  const feedback = review ? (lang === 'en' ? review.feedback_en : review.feedback_ro) || '' : '';
  await audit(req, 'EXPORT', 'report', s.id, { format, kind: 'session' });

  const summary = [
    [lbl.session, `#${s.id} ${s.name || ''}`], [lbl.trader, s.username], [lbl.mode, s.mode], [lbl.start, n(s.initial_balance)],
    [lbl.end, n(s.final_balance ?? s.current_balance)], [lbl.pnl, signed(pnl)], [lbl.pnlPct, signed(pct, 1) + '%'], [lbl.trades, positions.length], [lbl.fees, n(fees, 4)], [lbl.status, s.status],
  ];
  const head = [lbl.side, lbl.lev, lbl.entry, lbl.exit, lbl.margin, lbl.qty, 'SL', 'TP', lbl.fees, 'PnL', lbl.status, lbl.reason, lbl.opened, lbl.closed];
  const prow = positions.map((p) => [p.side, p.leverage, n(p.entry_price), n(p.exit_price), n(p.margin_usdc, 4), n(p.quantity_btc, 6), n(p.stop_loss), n(p.take_profit),
    n(p.opening_fee_usdc + p.closing_fee_usdc, 4), signed(p.realized_pnl_usdc, 4), p.status, p.close_reason || '', iso(p.opened_at), iso(p.closed_at)]);

  if (format === 'csv') {
    const rows = [['Lucky Bitcoin', lbl.report], [lbl.generated, iso(new Date())], [], ...summary, []];
    if (review) rows.push([lbl.profile], [lbl.score, review.score], [lbl.grade, review.grade], [lbl.archetype, arch], [lbl.winRate, review.win_rate], [lbl.avgLev, review.avg_leverage], [lbl.slUsage, review.sl_usage_rate], []);
    rows.push([lbl.positions], head, ...prow);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(toCsv(rows));
  }

  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Lucky Bitcoin';
    const hdr = (ws) => {
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFCD535' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF181A20' } };
    };
    const w1 = wb.addWorksheet(lbl.report);
    w1.addRow(['Lucky Bitcoin', lbl.report]); hdr(w1);
    w1.addRow([lbl.generated, iso(new Date())]); w1.addRow([]);
    summary.forEach((row) => w1.addRow(row));
    w1.getColumn(1).width = 22; w1.getColumn(2).width = 34;
    if (review) {
      const w2 = wb.addWorksheet(lbl.profile);
      w2.addRow([lbl.profile, '']); hdr(w2);
      [[lbl.score, review.score], [lbl.grade, review.grade], [lbl.archetype, arch], [lbl.winRate, review.win_rate], [lbl.avgLev, review.avg_leverage], [lbl.slUsage, review.sl_usage_rate]].forEach((x) => w2.addRow(x));
      w2.addRow([]); w2.addRow([lbl.diagnosis]); feedback.split('\n').forEach((l) => w2.addRow([l]));
      if (review.mentor_notes) { w2.addRow([]); w2.addRow([lbl.mentor, review.mentor_notes]); }
      w2.getColumn(1).width = 24; w2.getColumn(2).width = 40;
    }
    const w3 = wb.addWorksheet(lbl.positions);
    w3.addRow(head); hdr(w3);
    positions.forEach((p) => w3.addRow([p.side, p.leverage, p.entry_price, p.exit_price, p.margin_usdc, p.quantity_btc, p.stop_loss, p.take_profit,
      p.opening_fee_usdc + p.closing_fee_usdc, p.realized_pnl_usdc, p.status, p.close_reason, iso(p.opened_at), iso(p.closed_at)]));
    w3.columns.forEach((c) => { c.width = 14; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }

  const doc = pdfBase(res, base, lbl.report, `${lbl.session} #${s.id} - ${s.username}`, lbl);
  pdfTable(doc, [{ label: lbl.session, w: 180 }, { label: '', w: 200 }], summary.map((x) => [x[0], String(x[1])]), { color: pnlColor });
  if (review) {
    doc.fillColor('#111111').font('Helvetica-Bold').fontSize(12).text(ascii(lbl.profile));
    doc.moveDown(0.3);
    doc.fillColor('#B8921A').fontSize(26).text(`${review.grade}  ${review.score}/100`, { continued: true });
    doc.fillColor('#444444').fontSize(11).font('Helvetica').text(ascii(`   ${arch}`));
    doc.moveDown(0.3);
    doc.fillColor('#333333').fontSize(9).text(ascii(`${lbl.winRate}: ${review.win_rate}   |   ${lbl.avgLev}: ${review.avg_leverage}   |   ${lbl.slUsage}: ${review.sl_usage_rate}`));
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(10).text(ascii(lbl.diagnosis));
    doc.font('Helvetica').fontSize(9).fillColor('#222222');
    feedback.split('\n').forEach((l) => doc.text(ascii('• ' + l), { width: doc.page.width - 72 }));
    if (review.mentor_notes) { doc.moveDown(0.3); doc.font('Helvetica-Bold').text(ascii(lbl.mentor)); doc.font('Helvetica').text(ascii(review.mentor_notes)); }
    doc.moveDown(0.8);
  }
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(12).text(ascii(`${lbl.positions} (${positions.length})`));
  doc.moveDown(0.3);
  pdfTable(doc,
    [{ label: lbl.side, w: 38 }, { label: 'x', w: 22 }, { label: lbl.entry, w: 52, align: 'right' }, { label: lbl.exit, w: 52, align: 'right' }, { label: lbl.margin, w: 46, align: 'right' },
      { label: 'SL', w: 50, align: 'right' }, { label: 'TP', w: 50, align: 'right' }, { label: lbl.fees, w: 40, align: 'right' }, { label: 'PnL', w: 52, align: 'right' }, { label: lbl.status, w: 60 }, { label: lbl.closed, w: 60 }],
    positions.slice(0, 400).map((p) => [p.side, p.leverage, n(p.entry_price), n(p.exit_price), n(p.margin_usdc, 2), n(p.stop_loss, 0), n(p.take_profit, 0),
      n(p.opening_fee_usdc + p.closing_fee_usdc, 3), signed(p.realized_pnl_usdc, 3), p.status, iso(p.closed_at).slice(0, 16)]),
    { color: (i, cell) => (i === 8 ? pnlColor(i, cell) : null) });
  doc.end();
}));

r.get('/history', asyncH(async (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'ro';
  const lbl = L[lang];
  const format = ['pdf', 'csv', 'xlsx'].includes(req.query.format) ? req.query.format : 'pdf';
  const rows = await historyRows(req);
  await audit(req, 'EXPORT', 'report', null, { format, kind: 'history' });
  const head = ['ID', lbl.trader, lbl.name, lbl.mode, lbl.start, lbl.end, lbl.pnl, lbl.pnlPct, lbl.trades, lbl.fees, lbl.score, lbl.grade, lbl.archetype, lbl.status, lbl.created];
  const data = rows.map((s) => {
    const fin = s.final_balance ?? s.current_balance;
    return [s.id, s.username, s.name || '', s.mode, n(s.initial_balance), n(fin), signed(fin - s.initial_balance), signed(((fin - s.initial_balance) / s.initial_balance) * 100, 1) + '%',
      s.trades, n(s.fees, 4), s.score ?? '', s.grade ?? '', s.archetype ? lbl.arch[s.archetype] || s.archetype : '', s.status, iso(s.created_at)];
  });
  return sendTabular(res, format, `lucky-bitcoin-history`, lbl.history, head, data, lbl, [30, 55, 60, 62, 38, 40, 40, 38, 28, 36, 28], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
}));

r.get('/aggregate', requireRole('ANALYST', 'ADMIN'), asyncH(async (req, res) => {
  const lang = req.query.lang === 'en' ? 'en' : 'ro';
  const lbl = L[lang];
  const format = ['pdf', 'csv', 'xlsx'].includes(req.query.format) ? req.query.format : 'pdf';
  const rows = await aggregateRows();
  await audit(req, 'EXPORT', 'report', null, { format, kind: 'aggregate' });
  const head = [lbl.trader, lbl.sessions, lbl.trades, lbl.pnl, lbl.fees, lbl.avgScore, lbl.winRate, lbl.avgLev, lbl.slUsage];
  const data = rows.map((x) => [x.username, x.sessions, x.trades, signed(x.pnl), n(x.fees, 4), x.avg_score ?? '', x.win_rate ?? '', x.avg_lev ?? '', x.sl_usage ?? '']);
  return sendTabular(res, format, 'lucky-bitcoin-aggregate', lbl.aggregate, head, data, lbl, [70, 45, 45, 55, 55, 55, 55, 55, 55], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
}));

r.get('/stats', requireRole('ANALYST', 'ADMIN'), asyncH(async (req, res) => res.json(await aggregateRows())));

async function sendTabular(res, format, base, title, head, data, lbl, widths) {
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.send(toCsv([['Lucky Bitcoin', title], [lbl.generated, iso(new Date())], [], head, ...data]));
  }
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Lucky Bitcoin';
    const ws = wb.addWorksheet(title.slice(0, 30));
    ws.addRow(['Lucky Bitcoin - ' + title]);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.addRow([lbl.generated, iso(new Date())]);
    ws.addRow([]);
    const h = ws.addRow(head);
    h.font = { bold: true, color: { argb: 'FFFCD535' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF181A20' } };
    data.forEach((row) => ws.addRow(row));
    ws.columns.forEach((c) => { c.width = 16; });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    await wb.xlsx.write(res);
    return res.end();
  }
  const doc = pdfBase(res, base, title, title, lbl);
  // latimile se scaleaza pe pagina; folosim coloane egale ca fallback daca numarul nu corespunde
  const total = doc.page.width - 72;
  const w = widths.length === head.length ? widths : head.map(() => 60);
  const k = total / w.reduce((a, b) => a + b, 0);
  const cols = head.map((hd, i) => ({ label: hd, w: w[i] * k, align: i > 1 ? 'right' : 'left' }));
  // pentru istoric (15 coloane) pastram doar primele 11 in PDF
  const keep = Math.min(head.length, 11);
  const pc = cols.slice(0, keep);
  const kk = total / pc.reduce((a, c) => a + c.w, 0);
  pc.forEach((c) => { c.w *= kk; });
  pdfTable(doc, pc, data.slice(0, 500).map((row) => row.slice(0, keep).map((v) => String(v))), { color: (i, cell) => pnlColor(i, cell) });
  doc.end();
}

export default r;
