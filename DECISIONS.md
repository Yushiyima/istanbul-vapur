# Kararlar

Belirsiz tasarım kararları ve gerekçeleri, her biri bir satır.

## Aşama 1

- **Su verisi:** osmdata "water polygons" ~800 MB'lık dünya dosyası. Bunun yerine Overpass'tan bbox'taki `natural=coastline` yollarını indirip su poligonunu kendimiz kuruyoruz (kara solda kuralı + bbox − kara).
- **Göller/dereler:** su katmanında sadece deniz var (kıyı çizgisiyle tanımlı). Haliç dahil. Göller (Küçükçekmece vb.) zaten bbox dışında ya da oyunla ilgisiz.
- **Sadeleştirme:** kıyı 4 m toleransla Douglas–Peucker'dan geçiyor (~4,3 bin nokta, ~95 KB). 150 m²'den küçük adacıklar atılıyor.
- **Atıf:** karo kaynağı "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" atfını kendi ekliyor. Biz ayrıca "© OpenStreetMap katkıcıları" yazıyoruz. GHS-POP atfı nüfus verisi gelince (Aşama 3) eklenecek.
- **Tarihi iskele koordinatları:** 7 iskele kıyıdan 150 m'den uzaktı. Kıyıdaki karşılıkları gerçek iskele yerleriyle uyuştuğu için koordinatları o noktaya göre güncellendi: Beykoz (361 m), Yenikapı (175), Eyüp (192), Kınalıada (284), Burgazada (316), Heybeliada (357), Büyükada (151).
- **Tarihi iskeleler çalışma anında da kıyıya yapıştırılıyor.** İşaret yapışmış noktada gösteriliyor, 150 m'den uzaksa konsola uyarı basılıyor.
- **Tarihi iskele eşleme:** yeni iskele, kıyıya yapışmış bir tarihi iskeleye 150 m içindeyse onun adını ve `historicId`'sini alıyor. O tarihi işaret gizleniyor. İndirim/bonus Aşama 3'te.
- **Mesafe kontrolü** tıklanan noktaya göre değil, kıyıya yapışmış noktaya göre yapılıyor.
- **Yasak bölge kontrolü** hem kıyı noktasına hem 30 m açıktaki yanaşma noktasına bakıyor.
- **Yanaşma noktası** kıyı çizgisinin sağ normaliyle (OSM'de su sağda) hesaplanıyor. Köşeye denk gelirse komşu segmentlerin ortalama yönü kullanılıyor. Gerçek veride tarihi iskelelerin %85'ten fazlasında suya düştüğü test ediliyor. Aşama 2'de su ızgarasıyla doğrulanacak.
- **Ad:** en yakın OSM `place` (suburb/quarter/neighbourhood/town/village/island…). Ad doluysa "Bebek 2".
- **`src/geo/` klasörü:** CLAUDE.md'deki yapıda yoktu. Hem `sim` hem `map` hem scriptler kullandığı için saf geometri ayrı klasörde.
- **MapLibre v6 worker'ı** Vite ön paketlemesinde bulunamıyordu. `?url` ile asset yapılıp `setWorkerUrl` ile veriliyor.
- **Harita sınırı:** bbox dikey, ekranlar yatay. `maxBounds` boylamda ±0,45°, enlemde ±0,12° pay veriyor, yoksa bbox tam sığmıyor.
- **Bbox dışındaki deniz** altlıkta açık mavi. Oyun alanının suyu daha koyu, böylece sınır görünür ama sert değil.
- **Kayıt yok:** Aşama 1'de iskeleler sayfa yenilenince sıfırlanıyor. IndexedDB Aşama 4'te.

## Aşama 1 düzeltmeleri (log incelemesi)

- **Ad ağırlıkları:** etkin mesafe = mesafe / ağırlık. quarter (semt) 1,6 · suburb (mahalle) 1 · island 1,3 · neighbourhood 0,7 · town (ilçe) 0,6. `locality` (site, plaj, çeşme) kullanılmıyor. İstanbul OSM'inde semtler `quarter`, mahalleler `suburb` olarak etiketli.
- **Tarihi ad devri:** tarihi adlar ayrılmıyor, çünkü denendiğinde Kınalıada'daki iskele "Burgaz Adası" oldu. Bunun yerine tarihi iskele kurulunca adı ona geçiyor, adı önceden alan sıradan iskele "X 2" oluyor.
- **Yazım:** OSM adı bir tarihi iskele adına denkse (boşluk ve büyük/küçük harf farkı yok sayılarak) tarihi yazım kullanılıyor ("Rumelikavağı" → "Rumeli Kavağı").
- **Oyun alanı dışı:** bbox dışı tıklama `out-of-bounds` sebebiyle ayrı mesajla reddediliyor.

## Aşama 2

- **Su ızgarası** tarayıcıda yükleme anında kuruluyor (50 m, ~450 bin hücre, tarama satırı doldurma). Ayrı veri dosyası gerekmiyor.
- **Kıyıdan uzak durma:** 30 m'lik daraltma yerine karaya komşu su hücrelerinin A* maliyeti ×4. Böylece Haliç'in dar uçları kapanmıyor ama gemiler açıktan gidiyor. Görüş hattı sadeleştirmesi kıyı hücrelerinden geçmeyi kabul etmiyor.
- **Yaka/ada tespiti:** kara hücrelerinin bağlı bileşenleri. Avrupa = Eminönü'nün bileşeni, Anadolu = Kadıköy'ün, geri kalanı ada. 20 hücreden küçük bileşenler (dalgakıran, mendirek) yok sayılıyor.
- **Kapsama:** 800 m daire − su; sadece iskelenin kendi kara bileşenindeki parçalar kalıyor (Boğaz'ın karşı kıyısı düşüyor). Havza (Aşama 3) aynı kuralı hücre bazında uyguluyor.
- **Sefer modeli:** sarkaç (A→…→B→…→A). Terminalden kalkışlar hat açıldığından beri her `aralık` dakikada bir, iki uçtan da. O anda terminalde hazır gemi yoksa sefer "kaçan" sayılıyor. Gereken gemi = ⌈tur süresi / aralık⌉.
- **Hizmet saatleri** 06:00–23:30. "Gece" işaretli hat 24 saat çalışıyor.
- **Yanaşma:** ara iskelede 3 dk, terminalde en az 5 dk dönüş. Yanaşma yeri doluysa gemi açıkta sırada bekliyor.
- **Tersane:** Haliç Tersanesi. Yeni gemi oradan su yoluyla hattın terminaline gidiyor. Filo kapasitesi 6, para karşılığı +4 büyütülüyor. Hat kapatılınca ya da gemi satılınca fiyatın yarısı geri geliyor.
- **Hat düzenleme yok:** hattın iskeleleri sonradan değiştirilemiyor. Kapatıp yeniden açılıyor (basit tutmak için).
- **Gemi tipi** hat başına tek. Tip değişince mevcut gemiler satılıp aynı sayıda yenisi alınıyor. Arabalı vapurun "sadece belirli iskeleler" kısıtı henüz yok.
- **Çizim:** seyirdeki gemi rotanın 35 m sağına kaydırılıyor (karşılıklı geçişte üst üste binmesin), yanaşmış gemi iskele işaretinin 70 m açığında.

## Aşama 3

- **Nüfus:** GHS-POP R2023A, E2025 tahmini, 3 açısaniye (~90 m) tile R5_C21. Pikseller merkezlerine göre H3 r9 hücrelerine toplanıyor. Bbox içinde 7,65 milyon kişi, 4.727 hücre.
- **Çekim:** nüfusun %30'u + OSM yerleri (ofis ×6, okul/üniversite ×25, hastane ×20, resmi/kültür ×10, yeme-içme ×2, dükkân ×2, müze/otel ×12) × 25. Dükkân sorgusu ağır olduğu için 2×3 parçada çekiliyor.
- **İstasyonlar:** OSM `railway=station` / metro / hafif raylı. Marmaray ağ adından tanınıyor. İskeleye 400 m içinde istasyon varsa çekim ×1,3 (aktarma), Aşama 4'teki hedef için de sayılıyor.
- **Havza:** 800 m içinde, iskeleyle aynı kara bileşenindeki hücreler; ağırlık 1 − 0,5·(d/R).
- **Talep:** `k · pop_i · att_j / max(d, 1,5 km)^1,1`; aynı yakada ×0,35; saatlik profil; sabah Anadolu→Avrupa ×1,7 (ters ×0,6), akşam tersi; memnuniyet çarpanı 0,55–1,25.
- **Mod seçimi:** logit β = 0,09/dk. T_vapur = 2 × 420 m yürüme + yarım aralık bekleme (en fazla 40 dk) + seyir + aktarma cezası 8 dk. T_kara = en iyi köprü/tünel üzerinden yol (zirvede 13 km/sa + 25 dk köprü cezası) ya da Marmaray (istasyona yürüme + 5 dk + 45 km/sa). Adalar arası kara yolu yok, pay = 1.
- **Rota:** en fazla bir aktarma. Doğrudan hat varsa o, yoksa ortak iskeleden aktarmalı en kısa plan.
- **Biniş:** kalkışta, en uzun bekleyen önce. Kapasite dolunca kalanlar "reddedilen" sayılıyor (her kalkışta yeniden). 75 dk bekleyen vazgeçiyor.
- **Ekonomi:** bilet 20 ₺, aktarmalı ikinci biniş 8 ₺. Yakıt kalkışta km başına (vapur 320 ₺/km). Mürettebat günlük (vapur 18 bin), iskele bakımı günlük 6 bin. İskele = 350 bin + havza nüfusu × 6 ₺ (en fazla 1,6 M), tarihi yerde %40 indirim.
- **Memnuniyet:** saatlik; bekleme (6 dk iyi, 30 dk en kötü) %45, kalabalık (reddedilen + vazgeçen) %30, kaçan sefer %25. Üstel düzeltme 0,85. Tarihi iskele başına +0,6 (en fazla +5).
- **Kalibrasyon** (`node scripts/simulate.ts`): başlangıç hattı (20 dk, 2 vapur) günde ~40 bin biniş, ~590 bin ₺ net, akşam memnuniyeti ~%92; zirvede dolu, gemi eklemeye teşvik.
- **Zaman:** 1 oyun günü = 1 ay; 12 gün = 1 yıl. 1× hızda 1 oyun dakikası 0,4 sn.
