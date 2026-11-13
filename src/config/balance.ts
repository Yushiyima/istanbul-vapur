/**
 * Tüm denge sayıları burada. Kod içine sihirli sayı gömme.
 * Mesafeler metre cinsindendir.
 */

export const PIER = {
  /** Tıklanan nokta kıyıdan bundan uzaksa iskele konmaz. */
  maxSnapDistanceM: 300,
  /** İki iskele arası en az mesafe. */
  minSpacingM: 400,
  /** Yanaşma noktası kıyıdan su tarafına bu kadar içeride. */
  dockOffsetM: 30,
  /** Yürüme kapsama yarıçapı. */
  coverageRadiusM: 800,
  /** Yeni iskele bir tarihi iskeleye bu kadar yakınsa onun adını/özelliğini alır. */
  historicMatchRadiusM: 150,
  /** Tarihi iskele koordinatı kıyıdan bundan uzaksa konsola uyarı basılır. */
  historicWarnDistanceM: 150,
  /** Başlangıç yanaşma yeri sayısı (Aşama 2+). */
  initialBerths: 2,
} as const;

export const UI = {
  toastDurationMs: 2600,
  coverageCircleSteps: 64,
} as const;

export const NAV = {
  /** Su ızgarası hücre boyu (m). */
  cellM: 50,
  /** Karaya komşu su hücresinden geçmenin maliyet çarpanı. */
  coastCellCost: 4,
  /** Sadeleştirmede görüş hattı kesildikten sonra kaç nokta daha denensin. */
  smoothLookahead: 30,
} as const;

// ---------------------------------------------------------------- zaman

export const TIME = {
  minutesPerDay: 1440,
  /** Bir oyun günü = bir ay; 12 gün = 1 yıl. */
  daysPerYear: 12,
  /** Oyun 1. gün bu saatte başlar. */
  startMinuteOfDay: 6 * 60,
  /** 1× hızda bir oyun dakikası kaç gerçek milisaniye. */
  realMsPerMinute: 400,
  speeds: [0, 1, 2, 4, 8] as const,
  /** Tek karede en fazla kaç tick (yavaş makinede donmayı önler). */
  maxTicksPerFrame: 40,
  /** "Geceyi hızlı geç" açıkken gece seferi yoksa hız. */
  nightSkipSpeed: 24,
  serviceStartMin: 6 * 60,
  serviceEndMin: 23 * 60 + 30,
} as const;

export const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'] as const;

// ---------------------------------------------------------------- gemiler

/** 1 knot = 1852 m/saat. */
export const KNOT_M_PER_MIN = 1852 / 60;

export const SHIP_TYPES = {
  vapur: { name: 'Vapur', capacity: 1200, speedKn: 12, price: 1_500_000, crewPerDay: 18_000, fuelPerKm: 320 },
  denizOtobusu: { name: 'Deniz otobüsü', capacity: 400, speedKn: 25, price: 2_600_000, crewPerDay: 22_000, fuelPerKm: 780 },
  arabali: { name: 'Arabalı vapur', capacity: 600, speedKn: 10, price: 2_100_000, crewPerDay: 20_000, fuelPerKm: 420, vehicles: 40 },
} as const;

export const LINE = {
  defaultIntervalMin: 20,
  intervalOptions: [5, 10, 15, 20, 30, 45, 60, 90],
  /** Ara iskelede yanaşma süresi. */
  dwellMin: 3,
  /** Terminalde en az dönüş süresi. */
  turnaroundMin: 5,
  /** Gereken gemi hesabında tarifeye denk gelme payı (dk). */
  scheduleSlackMin: 2,
  colors: ['#e8590c', '#1971c2', '#2f9e44', '#9c36b5', '#c2255c', '#0c8599', '#f08c00', '#5c940d', '#3b5bdb', '#a61e4d'],
} as const;

export const TERSANE = {
  name: 'Haliç Tersanesi',
  lat: 41.0352,
  lng: 28.9605,
  /** Başlangıç tersanesinin filo kapasitesi. */
  capacity: 6,
  slots: 2,
  upgradeStep: 4,
  upgradeCost: 2_000_000,
  slotCost: 1_500_000,
  maxSlots: 6,
  /** Yeni tersane. */
  buildCost: 4_000_000,
  buildCapacity: 4,
  buildSlots: 1,
  /** Tersane ile iskele/tersane arası en az mesafe (m). */
  minSpacingM: 400,
  /** Gemi satışında geri dönen oran. */
  resaleRatio: 0.5,
} as const;

// ---------------------------------------------------------------- bakım

export const MAINT = {
  /** Km başına durum kaybı (puan). Vapur günde ~250 km gider. */
  wearPerKm: { vapur: 0.025, denizOtobusu: 0.035, arabali: 0.03 },
  /** Durum 0'da hız bu orana iner. */
  minSpeedFactor: 0.8,
  /** Bu durumun altında arıza riski başlar. */
  breakdownBelow: 30,
  /** Durum 0'da her kalkışta arıza olasılığı. */
  breakdownChanceAtZero: 0.12,
  /** Bakım süresi (dk) ve ücreti (gemi fiyatına oran). */
  durationMin: 8 * 60,
  costRatio: 0.06,
  /** Arızalı gemi çekilirken hız oranı, onarım ücret çarpanı. */
  towSpeedFactor: 0.45,
  breakdownCostMul: 1.6,
  defaultThreshold: 35,
  thresholdOptions: [0, 25, 35, 50],
} as const;

// ---------------------------------------------------------------- ekonomi

export const ECON = {
  startMoney: 9_000_000,
  /** İskele maliyeti = taban + havza nüfusu × birim (yoğun merkez pahalı); tarihi yerde indirim. */
  pierBaseCost: 350_000,
  pierCostPerResident: 6,
  pierCostMax: 1_600_000,
  historicDiscount: 0.4,
  /** İskele silinince geri dönen oran. */
  pierRefundRatio: 0.3,
  berthUpgradeCost: 450_000,
  maxBerths: 4,
  pierMaintPerDay: 6_000,
  ticket: 20,
  /** Arabalı vapurda araç başına bilet; araç rampası kurma bedeli. */
  vehicleTicket: 180,
  rampCost: 700_000,
  /** Arabalı vapurda araç doluluğu (karşıya geçen bacakta). */
  vehicleFill: { peak: 0.9, offpeak: 0.55, night: 0.3 },
  /** Aktarmada ikinci biniş indirimli. */
  transferTicket: 8,
} as const;

// ---------------------------------------------------------------- talep

export const DEMAND = {
  /** Havzada uzak hücrenin ağırlığı: 1 - walkDecay × (d / R). */
  walkDecay: 0.5,
  /** Yer çekimi modeli: yolcu/dk = k × pop_i × att_j / d^γ × saat profili × … */
  k: 1.1e-7,
  gamma: 1.1,
  minDistKm: 1.5,
  /** Aynı yakadaki iskeleler arası talep çarpanı (Boğaz içi hatlar). */
  sameSideFactor: 0.35,
  /** Logit: P_vapur = 1 / (1 + exp(β (T_vapur − T_kara))). */
  betaPerMin: 0.09,
  walkSpeedMPerMin: 75,
  /** Havzada ortalama yürüme mesafesi (her uç). */
  avgWalkM: 420,
  transferPenaltyMin: 8,
  /** Beklemenin algılanan süreye katkısı en fazla bu kadar. */
  maxPerceivedWaitMin: 40,
  landDetour: 1.35,
  /** Kara hızı (km/sa): zirvede trafik. */
  landSpeedKmh: { peak: 13, offpeak: 26, night: 38 },
  bridgePenaltyMin: { peak: 25, offpeak: 8, night: 3 },
  /** Karşıya geçiş noktaları (köprüler, tünel). */
  crossings: [
    { name: '15 Temmuz Şehitler Köprüsü', lat: 41.0455, lng: 29.034 },
    { name: 'FSM Köprüsü', lat: 41.0911, lng: 29.061 },
    { name: 'Yavuz Sultan Selim Köprüsü', lat: 41.2025, lng: 29.112 },
    { name: 'Avrasya Tüneli', lat: 40.996, lng: 28.99 },
  ],
  /** Marmaray: iki yaka arası sabit hızlı raylı alternatif. */
  marmaray: {
    stations: [
      { name: 'Kazlıçeşme', lat: 40.9925, lng: 28.918, side: 'avrupa' },
      { name: 'Yenikapı', lat: 41.0045, lng: 28.9505, side: 'avrupa' },
      { name: 'Sirkeci', lat: 41.0145, lng: 28.9765, side: 'avrupa' },
      { name: 'Üsküdar', lat: 41.0257, lng: 29.0153, side: 'anadolu' },
      { name: 'Ayrılık Çeşmesi', lat: 41.0002, lng: 29.0308, side: 'anadolu' },
    ],
    speedKmh: 45,
    waitMin: 5,
  },
  /** Saatlik talep profili (ortalama ≈ 1). */
  hourly: [0.08, 0.05, 0.03, 0.03, 0.04, 0.15, 0.6, 1.6, 2.2, 1.6, 0.9, 0.85, 0.9, 0.9, 0.9, 1.0, 1.3, 1.9, 2.1, 1.5, 0.9, 0.6, 0.4, 0.2],
  /** Sabah zirvesi Anadolu→Avrupa ağır, akşam ters. */
  peakDirBoost: 1.7,
  peakDirDamp: 0.6,
  morningPeak: [7, 10],
  eveningPeak: [17, 20],
  /** Bu kadar bekleyen yolcu vazgeçer. */
  giveUpMin: 75,
  /** Metro/Marmaray aktarmalı iskelenin çekim çarpanı. */
  railAttBoost: 1.3,
  railTransferRadiusM: 400,
} as const;

// ---------------------------------------------------------------- memnuniyet

export const SATISFACTION = {
  /** Bu kadar bekleme tam puan, worst ve üstü sıfır. */
  waitGoodMin: 6,
  waitWorstMin: 30,
  weights: { wait: 0.45, crowd: 0.3, cancel: 0.25 },
  /** Saatlik güncellemede eski değerin ağırlığı. */
  smoothing: 0.85,
  /** Talep çarpanı: memnuniyet 0 → min, 100 → max. */
  demandMulMin: 0.55,
  demandMulMax: 1.25,
  historicBonusPerPier: 0.6,
  historicBonusMax: 5,
} as const;

// ---------------------------------------------------------------- hedefler

export const GOALS = {
  connectSides: { title: 'İki yakayı bağla', desc: 'Avrupa ve Anadolu yakalarını bir hatla bağla.', reward: 1_000_000 },
  connectSides3: { title: 'Üç ayrı geçiş', desc: 'İki yakayı birbirinden en az 1,5 km uzak 3 ayrı yerden bağla.', reward: 2_500_000 },
  adalar: { title: 'Adalar’a ulaş', desc: 'Bir hattı adalardan birine uzat.', reward: 1_500_000 },
  halic: { title: 'Haliç hattı', desc: 'Haliç’te en az iki iskeleye uğrayan bir hat aç.', reward: 1_000_000 },
  sariyer: { title: 'Boğaz’ı Sarıyer’e bağla', desc: 'Tarihi yarımada / Beşiktaş kıyısından Sarıyer’e (41,16° K) hatlarla ulaşılabilsin.', reward: 2_000_000 },
  historic5: { title: '5 tarihi iskele', desc: 'Başlangıç dışında 5 tarihi iskeleyi yeniden aç.', reward: 1_500_000 },
  rail5: { title: 'Raylı aktarma', desc: 'Hatlı 5 iskelede metro / Marmaray / banliyö aktarması (400 m) olsun.', reward: 2_000_000 },
  coverage10: { title: 'Nüfusun %10’u', desc: 'Hatlı iskeleler nüfusun %10’unu kapsasın.', reward: 1_500_000 },
  coverage25: { title: 'Nüfusun %25’i', desc: 'Hatlı iskeleler nüfusun %25’ini kapsasın.', reward: 4_000_000 },
  satisfaction95: { title: '%95 memnuniyet', desc: 'Bir yılı ortalama %95 memnuniyetle kapat.', reward: 5_000_000 },
  night: { title: 'Gece seferi', desc: 'Bir hatta gece seferi başlat.', reward: 800_000 },
} as const;

// ---------------------------------------------------------------- olaylar

export const EVENTS = {
  /** Aya göre günlük hava olasılıkları (Ocak … Aralık). Lodos kışın sık. */
  weatherByMonth: [
    { lodos: 0.3, poyraz: 0.15, sis: 0.1 },
    { lodos: 0.28, poyraz: 0.15, sis: 0.12 },
    { lodos: 0.22, poyraz: 0.12, sis: 0.18 },
    { lodos: 0.12, poyraz: 0.08, sis: 0.2 },
    { lodos: 0.06, poyraz: 0.06, sis: 0.12 },
    { lodos: 0.04, poyraz: 0.1, sis: 0.05 },
    { lodos: 0.03, poyraz: 0.14, sis: 0.03 },
    { lodos: 0.03, poyraz: 0.14, sis: 0.03 },
    { lodos: 0.06, poyraz: 0.1, sis: 0.1 },
    { lodos: 0.14, poyraz: 0.1, sis: 0.2 },
    { lodos: 0.24, poyraz: 0.12, sis: 0.2 },
    { lodos: 0.3, poyraz: 0.15, sis: 0.12 },
  ],
  duration: {
    lodos: { startHour: [3, 14], hours: [5, 12] },
    poyraz: { startHour: [3, 14], hours: [4, 10] },
    sis: { startHour: [4, 7], hours: [2, 5] },
  },
  /** Rotanın bu oranı açık denizdeyse lodos/poyrazda sefer iptal. */
  exposureThreshold: 0.25,
  fogSpeedFactor: 0.6,
  /** Boğaz akıntısı: kuzeye giden gemi bu oranda yavaş, güneye giden hızlı. */
  currentStrength: 0.15,
} as const;

// ---------------------------------------------------------------- Peron

export const FEED = {
  maxPosts: 40,
  crowdedMin: 150,
  longWaitMin: 22,
  gullChance: 0.12,
  happyChance: 0.15,
} as const;

// ---------------------------------------------------------------- ses

export const SOUND = {
  /** Aynı anda en fazla bu sıklıkta düdük (ms). */
  hornMinGapMs: 2500,
  volume: 0.25,
} as const;

// ---------------------------------------------------------------- Boğaz trafiği

export const TRAFFIC = {
  /** Kanal uçları [lng, lat]: Karadeniz girişi ve Marmara (Ahırkapı açığı). */
  northEnd: [29.135, 41.234],
  southEnd: [28.985, 40.985],
  /** Orta hatta çekim: kıyıya yakın hücre pahalı. */
  centerPull: 8,
  sampleEvery: 4,
  /** Sağdan seyir şeridi kayması (m). */
  laneOffsetM: 110,
  /** Saatte ortalama kaç gemi Boğaz'a girer (gerçekte günde ~110). */
  perHour: 4.5,
  /** Açılışta kanalda kaç gemi olsun. */
  warmCount: 8,
  kinds: {
    tanker: { label: 'Tanker', lengthM: 250, speedKn: 8, safetyM: 420, weight: 3, color: '#c92a2a', names: ['M/T Karadeniz Yıldızı', 'M/T Volga Spirit', 'M/T Anadolu', 'M/T Caspian Dawn', 'M/T Novorossiysk'] } as const,
    konteyner: { label: 'Konteyner', lengthM: 230, speedKn: 12, safetyM: 360, weight: 3, color: '#1864ab', names: ['Marmara Express', 'Bosporus Bridge', 'Odessa Trader', 'Levant Star'] } as const,
    dokme: { label: 'Dökme yük', lengthM: 190, speedKn: 10, safetyM: 320, weight: 3, color: '#795548', names: ['Ege Bulker', 'Danube Grain', 'Kerch Carrier', 'Sinop Ore'] } as const,
    kruvaziyer: { label: 'Kruvaziyer', lengthM: 260, speedKn: 13, safetyM: 380, weight: 1, color: '#f8f9fa', names: ['Aegean Queen', 'Golden Horn Dream', 'Black Sea Pearl'] } as const,
    koster: { label: 'Koster', lengthM: 90, speedKn: 11, safetyM: 200, weight: 2, color: '#495057', names: ['Kaptan Rıza', 'Hacı Bayram', 'Deniz Yıldızı', 'Rize Ekspres'] } as const,
  },
  /** Güvenlik mesafesinin bu katına kadar yavaşlama bölgesi. */
  slowBand: 1.8,
  slowFactor: 0.4,
  /** En fazla yana sapma (m). */
  sidestepM: 140,
  tankerFeedChance: 0.25,
  /** Bu kadar dakika yol veren vapur için Peron paylaşımı. */
  feedAfterMin: 4,
} as const;

export const GOAL_RULES = {
  crossingSeparationM: 1500,
  sariyerLat: 41.16,
  southLat: 41.045,
} as const;
