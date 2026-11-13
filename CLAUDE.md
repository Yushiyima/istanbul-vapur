# Vapur — İstanbul vapur hattı işletme oyunu (çalışma adı)

Gerçek İstanbul haritası üstünde oyuncunun iskele koyup vapur hattı kurduğu, sefer planladığı ve
işlettiği bir tarayıcı oyunu. İlham: metro.yumo.games (gerçek haritada metro işletme). Biz aynı
yaklaşımı denize taşıyoruz: vapur köprüyle ve Marmaray'la yarışır.

Kod tanımlayıcıları İngilizce, arayüz metinleri Türkçe. Kullanıcıyla Türkçe konuş.

---

## 1. Temel döngü

1. Oyuncu kıyıya iskele koyar (para harcar).
2. İskeleler arasında hat çizer, hatta gemi atar, sefer aralığı seçer.
3. İskele çevresindeki nüfus/çekim yolcu üretir; yolcu vapuru ancak kara yolundan hızlıysa seçer.
4. Bilet geliri kasaya girer; yakıt, personel, bakım gideri düşer.
5. Memnuniyet (bekleme, doluluk, iptaller) talebi etkiler.
6. Şehir hedefleri tamamlandıkça ödül gelir, ağ büyür.

## 2. Mekanikler

### İskele (oyuncu koyar)
- Sadece kıyıya konabilir: tıklanan nokta en yakın kıyı noktasına yapışır (snap), yanaşma noktası
  kıyıdan ~30 m su tarafında oluşur.
- Kapsama: 800 m yürüme yarıçapı. Bu alandaki H3 hücrelerinin nüfusu ve çekimi talebi belirler.
- Maliyet = taban + konum çarpanı (yoğun merkez pahalı) + kıyı türü (hazır rıhtım ucuz).
- Yanaşma yeri sayısı sınırlı (başlangıç 2). Dolunca gemiler sırada bekler.
- İki iskele arası minimum mesafe (başlangıç 400 m).
- Yasak bölgeler (`data/no_build.geojson`): ör. Dolmabahçe önü, askeri alanlar, liman sahaları.
- **Tarihi iskeleler** (`data/historic_piers.json`): haritada soluk işaret. Oraya kurulan iskele
  indirimli + küçük memnuniyet bonusu. Zorunlu değil, ipucu.
- Oyun Eminönü ve Kadıköy iskeleleri + aralarında tek hatla başlar (öğretici).

### Hat ve sefer
- Hat = sıralı iskele listesi. Rota sadece suda; iskele çiftleri arası rota su ağı üstünde A* ile
  bulunur ve önbelleğe alınır.
- Sürekli dönüş yerine tarifeli sefer: her hattın sefer aralığı (dk) oyuncu tarafından ayarlanır.
  Atanan gemi sayısı bu aralığı tutturmaya yetmezse uyarı ver.
- Gemi tipleri (değerler `src/config/balance.ts` içinde, ayarlanacak):
  | Tip | Kapasite | Hız | Not |
  |---|---|---|---|
  | Vapur | 1200 | 12 kn | ucuz işletme |
  | Deniz otobüsü | 400 | 25 kn | pahalı, hızlı |
  | Arabalı vapur | 600 + araç | 10 kn | araç geliri, sadece belirli iskeleler |
- Tersane (metro oyunundaki depo karşılığı): gemiler buradan çıkar, kapasitesi sınırlı.

### Talep modeli (oyunun kalbi)
- Hücre bazlı tam OD matrisi hesaplama (15k+ hücre) — ağır. Bunun yerine iskele havzası bazında:
  her iskele için havza nüfusu ve çekimi önceden toplanır.
- İskele çifti (i, j) için potansiyel yolcu: `k * pop_i * att_j / dist_ij^γ` (yer çekimi modeli).
- Mod seçimi (logit): `P_vapur = 1 / (1 + exp(β * (T_vapur - T_kara)))`
  - `T_vapur` = yürüme + ortalama bekleme (sefer aralığı / 2) + deniz yolculuğu (+ aktarma).
  - `T_kara` = kara mesafesi / saatlik kara hızı + köprü cezası. Zirve saatlerinde kara yavaşlar,
    vapur avantaj kazanır. Marmaray koridoru (Sirkeci–Üsküdar) için ayrı, sabit hızlı alternatif.
- Aynı yakadaki iskeleler arası talep düşük çarpanla (Boğaz içi hatlar için).

### Zaman
- Oyun saati gün içinde akar: sabah zirvesi (07–10, Anadolu→Avrupa ağır), akşam zirvesi
  (17–20, ters yön), gece (düşük talep). Hız: duraklat, 1×, 2×, 4×, 8×.
- Yıl sonu: hedef ödülleri ödenir, yıllık özet gösterilir.

### Ekonomi ve memnuniyet
- Gelir: biniş başına bilet. Gider: sefer başına yakıt (hız ve mesafeyle artar), gemi başına
  personel/bakım, iskele başına bakım.
- Memnuniyet: ortalama bekleme, gemi doluluğu (>%100 ayakta/bırakılan yolcu), iptal oranı.
  Memnuniyet talep çarpanını etkiler.

### Olaylar
- **Akıntı:** Boğaz'da kuzeyden güneye. Güneye giden hızlı, kuzeye giden yavaş.
- **Lodos / poyraz:** bazı hatlarda (özellikle açık deniz: Adalar, Bostancı) sefer iptali.
- **Sis:** tüm hatlarda hız düşer.
- **Tanker geçişi:** Boğaz'ı enine kesen hatlar kısa süre bekler.

### Hedefler (ödüllü, her biri bir kez)
- İki yakayı bağla; iki yakayı 3 ayrı yerden bağla
- Adalar'a ulaş; Haliç hattı aç; Boğaz'ı Sarıyer'e kadar bağla
- 5 tarihi iskeleyi yeniden aç
- 5 iskelede metro/Marmaray aktarması
- Kapsanan nüfus %10 / %25
- Bir yılı %95 memnuniyetle kapat
- Gece seferi başlat

### Peron (sosyal akış)
- Yolcu paylaşımları: olaylara ve hat durumuna göre şablonlu, hafif mizahi metinler
  ("Vapur kaçtı, simit kaldı", martı şikayetleri, lodos iptali). Sonraki aşama.

## 3. Teknik mimari

### Stack
- Vite + TypeScript (strict), framework yok veya ince bir UI katmanı (Preact kabul).
- Harita: MapLibre GL JS + OpenFreeMap vektör karoları (`https://tiles.openfreemap.org/styles/...`).
- Hücreler: `h3-js` (çözünürlük 9).
- Hareketli gemiler: harita üstünde ayrı canvas katmanı veya MapLibre custom layer.
- Kayıt: IndexedDB (`idb` paketi).
- Test: Vitest (simülasyon mantığı için).
- Ücretli API, API anahtarı isteyen servis kullanma.

### Klasör yapısı
```
/data              ham ve işlenmiş veri (city pack)
  historic_piers.json
  water.geojson      işlenmiş su poligonu (bbox'a kırpılmış)
  coastline.geojson  kıyı çizgisi (snap için)
  cells.json         H3 hücreleri: id, pop, att
  no_build.geojson
/scripts           veri hazırlama (Node veya Python)
/src
  /config          balance.ts (tüm sayılar burada)
  /map             MapLibre kurulumu, katmanlar
  /nav             su ızgarası, A*, rota sadeleştirme, önbellek
  /sim             saf simülasyon (DOM'a dokunmaz): talep, sefer, ekonomi, olaylar
  /ui              paneller, araç çubuğu
  /save            IndexedDB kayıt/yükleme
```

### Kurallar
- **Simülasyon render'dan ayrı:** `src/sim` saf TypeScript, sabit adımlı tick (ör. oyun içi 1 dk),
  seed'li rastgelelik, birim testi yazılabilir. Render sadece durumu okur.
- **Su üstü rota:** su poligonunu ~50 m ızgaraya rasterleştir, kıyıdan 30 m içeri buffer'la
  daralt, A* ile bul, görüş hattıyla (line-of-sight) sadeleştir. Sonuç iskele çifti başına önbellek.
  Dar geçişlere dikkat: Haliç girişi, Rumeli/Anadolu Kavağı arası.
- **Veri:** su alanı OSM'den (osmdata.openstreetmap.de "water polygons" veya Overpass ile
  bbox'a kırpılmış). Nüfus GHS-POP R2023A'dan H3 hücrelerine toplanır. Veri scriptleri
  tekrar çalıştırılabilir olmalı, büyük ham dosyalar git'e girmez (`/data/raw` gitignore).
- Bbox (yaklaşık): batı 28.85, güney 40.84, doğu 29.15, kuzey 41.24 — Haliç, Boğaz, Adalar dahil.
- Tüm denge sayıları `balance.ts` içinde; kod içine sihirli sayı gömme.
- Atıf: haritada "© OpenStreetMap katkıcıları", OpenFreeMap, GHS-POP kaynakları gösterilir.

## 4. Aşamalar

Her aşama sonunda: proje `npm run dev` ile çalışır, kısa test talimatı yazılır, git commit atılır.
Bir aşamayı bitirmeden sonrakine geçme.

1. **Harita + kıyı + iskele koyma** — harita açılır, su katmanı, tarihi iskeleler soluk,
   tıklayınca kıyıya yapışan iskele konur/silinir, yasak bölge ve minimum mesafe kontrolü.
2. **Su ağı + hat çizme + gemi hareketi** — iskeleleri sırayla seçerek hat çiz, rota suda kalır,
   gemi rotada animasyonla gider, sefer aralığı ayarlanır.
3. **Talep + ekonomi** — H3 nüfus verisi, iskele havzaları, yer çekimi + logit, biniş/iniş,
   kapasite, kasa, memnuniyet, saat ve zirveler, üst bar göstergeleri.
4. **Hedefler + olaylar + kayıt** — hedef paneli, akıntı/lodos/sis/tanker, IndexedDB kayıt.
5. **Cila** — Peron akışı, ses, katmanlar (nüfus/çekim/kapsama/doluluk), denge ayarı.

## 5. Çalışma şekli
- Her aşamaya başlarken önce kısa bir plan yaz, sonra uygula.
- Belirsiz bir tasarım kararı varsa makul olanı seç, `DECISIONS.md` dosyasına bir satır not düş.
- Gereksiz soyutlama yapma; çalışan basit çözüm önce.
- `data/historic_piers.json` koordinatları yaklaşıktır; kıyıya snap ederek doğrula, çok uzaktaysa
  düzelt ve not düş.
- Açık işler `TODO.md`'de. Kullanıcı "şimdi düzeltme, listeye ekle" derse oraya yaz.

### Git / GitHub
- Repo: https://github.com/Yushiyima/istanbul-vapur (public), dal `main`.
- Git ve GitHub tamamen Claude'un kontrolünde: anlamlı her adımda (aşama sonu, düzeltme, belge
  güncellemesi) **kullanıcıya sormadan commit at ve push et.**
- Repo public: secret, API anahtarı, `.env`, kişisel veri asla commit'lenmez. Commit kimliği
  GitHub noreply adresi (repo yerel ayarı), gerçek e-posta değil.
- Büyük ham veri (`data/raw/`), `logs/`, `dist/` git'e girmez.

### Dev logları
- `npm run dev` açıkken tarayıcı uyarı/hataları ve oyun olayları `logs/dev.log` dosyasına yazılır
  (`src/devlog.ts` + `vite.config.ts` eklentisi). Kullanıcı "loglara bak" derse oradan oku.
