(function() {
  const staffEl = document.getElementById('roi-staff');
  const txnEl = document.getElementById('roi-txn');
  const totalEl = document.getElementById('roi-total');
  const timeEl = document.getElementById('roi-time');
  const errorEl = document.getElementById('roi-error');
  const piutangEl = document.getElementById('roi-piutang');
  if (!staffEl || !txnEl || !totalEl || !timeEl || !errorEl || !piutangEl) return;

  // ─── ASUMSI (konservatif, berbasis observasi UMKM Indonesia) ───
  // TIME: 45 menit/hari hemat per staff via automation
  //   - Hitung kas EOD (manual cross-check → auto rekap): 20 min
  //   - Update stok Excel (manual → real-time sync): 15 min
  //   - Tag piutang jatuh tempo (manual → auto WA reminder): 10 min
  //   26 hari kerja/bulan, Rp 20.000/jam (UMR kasir/admin Jabodetabek)
  // ERROR: baseline selisih kas/kesalahan input ~Rp 200K/bulan untuk 50 txn/hari,
  //   scaled linear to txn volume. Caleo audit trail eliminates ~80% = Rp 160K.
  // PIUTANG: WA reminder mempercepat kolektabilitas ~Rp 350K/bulan cashflow accel
  //   untuk 50 txn/hari, scaled linear.
  // Angka konservatif — real result bisa lebih tinggi untuk toko volume tinggi.

  const MIN_SAVED_PER_STAFF = 45;  // menit/hari
  const WORK_DAYS = 26;
  const WAGE_PER_HOUR = 20000;
  const ERROR_BASE = 160000;    // Rp per bulan pada baseline 50 txn/hari
  const PIUTANG_BASE = 350000;  // Rp per bulan pada baseline 50 txn/hari
  const TXN_BASELINE = 50;

  function fmtRp(n) {
    return 'Rp ' + Math.round(n).toLocaleString('id-ID');
  }
  function fmtCompact(n) {
    if (n >= 1000000) return 'Rp ' + (n / 1000000).toFixed(n >= 10000000 ? 0 : 1) + ' jt';
    return 'Rp ' + Math.round(n / 1000) + 'K';
  }

  function calc() {
    const staff = parseInt(staffEl.value, 10) || 1;
    const txn = parseInt(txnEl.value, 10) || 50;

    // Time savings
    const hoursSaved = Math.round(staff * MIN_SAVED_PER_STAFF * WORK_DAYS / 60);
    const timeSavings = hoursSaved * WAGE_PER_HOUR;

    // Error savings (scaled by txn volume vs baseline)
    const scale = txn / TXN_BASELINE;
    const errorSavings = ERROR_BASE * scale;

    // Piutang recovery (scaled similarly)
    const piutangSavings = PIUTANG_BASE * scale;

    const total = timeSavings + errorSavings + piutangSavings;

    totalEl.textContent = fmtRp(total);
    timeEl.textContent = hoursSaved + ' jam';
    errorEl.textContent = fmtCompact(errorSavings);
    piutangEl.textContent = fmtCompact(piutangSavings);
  }

  staffEl.addEventListener('change', calc);
  txnEl.addEventListener('change', calc);
  calc();
})();

// ═══ PRICING TERM TOGGLE (6mo vs 12mo — real math, no marketing anchor) ═══
(function() {
  const toggle = document.getElementById('term-toggle');
  if (!toggle) return;
  const cards = document.querySelectorAll('.tier-card[data-tier]');

  function fmtPrice(n) {
    if (n >= 1000) return (n / 1000).toFixed(2).replace('.', ',') + ' jt';
    return n + 'K';
  }

  function fmtJt(n) {
    if (n >= 1000) return (n / 1000).toFixed(2).replace('.', ',') + ' jt';
    return Math.round(n) + 'rb';
  }

  function setTerm(t) {
    toggle.querySelectorAll('.term-btn').forEach(b => b.classList.toggle('active', b.dataset.term === t));
    cards.forEach(card => {
      const p6 = parseInt(card.dataset.p6, 10);   // dalam ribuan (509 = Rp 509.000)
      const p12 = parseInt(card.dataset.p12, 10);
      const strike = parseInt(card.dataset.strike, 10); // list price (599 = Rp 599.000)
      const priceEl = card.querySelector('.v-price');
      const strikeEl = card.querySelector('.v-strike');
      const saveEl = card.querySelector('.v-save');
      const commitEl = card.querySelector('.v-commit');

      const currentPrice = t === '6' ? p6 : p12;
      const savedPct = Math.round((1 - currentPrice / strike) * 100);
      const isPremium = card.dataset.tier === 'premium';

      priceEl.textContent = fmtPrice(currentPrice);
      strikeEl.textContent = strike.toLocaleString('id-ID') + '.000';
      saveEl.textContent = (isPremium ? 'INCLUDE AI · ' : '') + 'HEMAT ' + savedPct + '%';

      if (t === '12') {
        const yrSavingsThousand = (p6 - p12) * 12;  // annual saving vs 6mo, dalam ribuan
        commitEl.innerHTML = 'Komit 12 bulan · GRATIS setup · <strong>hemat Rp ' + fmtJt(yrSavingsThousand) + '/tahun</strong> vs pilih 6-bulan';
      } else {
        commitEl.innerHTML = 'Komit 6 bulan · GRATIS setup · <span style="color:var(--gold-2);font-weight:800">💡 Pilih 12-bulan hemat 50% dari harga normal (ekstra Rp ' + fmtJt((p6 - p12) * 12) + '/tahun vs 6-bulan)</span>';
      }
    });
  }

  toggle.querySelectorAll('.term-btn').forEach(b => {
    b.addEventListener('click', () => setTerm(b.dataset.term));
  });
  setTerm('12');  // Default to 12-bulan
})();

// ═══ SCROLL REVEAL (IntersectionObserver — smooth fade-up as sections come into view) ═══
(function() {
  if (!('IntersectionObserver' in window)) return;
  // Auto-tag section titles + stat cards + testi cards + pricing cards
  const selectors = [
    '.s-title', '.stat-card', '.testi-card', '.tier-card',
    '.mod-icon-card', '.aud-card', '.bonus-card', '.deep-row',
    '.faq-item', '.compare-table', '.kantor-card',
    '.pain-card', '.gain-card', '.roi-card', '.proof-card'
  ];
  const nodes = document.querySelectorAll(selectors.join(','));
  nodes.forEach(el => el.classList.add('reveal'));

  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('in-view');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -50px 0px' });

  nodes.forEach(el => io.observe(el));
})();
