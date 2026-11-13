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

## Aşama 4

- **Bölgeler** (`data/zones.geojson`) elle çizildi: `bogaz` (akıntı, tanker), `halic` (Haliç hedefi), `acik_deniz` (lodos/poyraz), `karadeniz_agzi` (poyraz). Sadece rotaların su kısmında kullanıldığı için karayı da kapsayabiliyorlar.
- **Hava** her gün başında aya göre olasılıkla seçiliyor: lodos kışın %30, yazın %3; sis bahar/sonbahar sabahları. Lodosta rotasının ≥%25'i açık denizde olan bacak kalkamıyor (terminalde kaçan sefer, ara iskelede bekleme). Poyraz Karadeniz ağzını da sayıyor. Sis tüm gemileri %40 yavaşlatıyor.
- **Akıntı:** Boğaz bölgesinde hız × (1 − 0,15 · kuzey bileşeni). Kuzeye giden yavaş, güneye giden hızlı. Tur süresi ve gereken gemi hesabı akıntısız (ortalama) yapılıyor.
- **Tanker:** 06–22 arası saat başı %22 olasılıkla 12–28 dk. İki ucu farklı yakada olan ve orta noktası Boğaz bölgesinde kalan bacaklar kalkamıyor.
- **Hedefler** saat başı kontrol ediliyor, her biri bir kez ödül veriyor. "Üç ayrı geçiş": orta noktaları birbirinden ≥1,5 km uzak yaka geçişi bacakları. "Sarıyer": 41,16° K üstündeki bir iskele, 41,045° K altındaki Avrupa yakası iskelesiyle hatlarla (aktarmalı) bağlı. "%95 memnuniyet" yıl sonunda yıllık ortalamaya bakıyor. Kapsama ve raylı aktarma sadece gemisi olan hatların iskelelerini sayıyor.
- **Yıl sonu** (12. gün sonu): özet penceresi açılıyor, oyun duruyor, kapanınca devam ediyor.
- **Kayıt:** IndexedDB (`idb`), `auto` ve `manual` iki yuva. Her oyun günü sonunda ve sekme gizlenince otomatik kaydediliyor. Açılışta otomatik kayıt varsa yükleniyor. Rastgelelik GameState içindeki mulberry32 durumundan geldiği için yüklenen oyun aynı şekilde devam ediyor (testli).
- **Peron'un temeli** (paylaşım şablonları) bu aşamada geldi, çünkü olaylar ve hedefler paylaşım üretiyor. Saatlik durum paylaşımları Aşama 5'te.

## Aşama 5

- **Peron:** saat sonu durumuna göre olasılıklı paylaşım (kalabalık > biniş %10'u ve 150 kişi, 22 dk'yı aşan bekleme, kaçan sefer, martı, mutlu yolcu). Eylemler de paylaşım üretiyor: tarihi iskele açılışı, yeni hat, gece seferi, hedef. Son 40 paylaşım tutuluyor. Seçim tohumlu üreteçle yapıldığı için kayıttan sonra aynı akıyor.
- **Türkçe ek:** "{pierLoc}" şablonu ünlü uyumu ve sert ünsüzle bulunma eki üretiyor (Kadıköy’de, Bebek’te, Balat’ta).
- **Ses:** dosyasız, WebAudio ile sentezlenmiş iki tonlu düdük. Ekrandaki bir gemi kalktığında çalıyor, en fazla 2,5 sn'de bir. Varsayılan kapalı (tarayıcılar kullanıcı etkileşimi olmadan ses açtırmıyor).
- **Katmanlar:** nüfus ve çekim H3 altıgenleri, 7 sınıflı dilim ölçeği (nüfus mavi-mor, çekim turuncu); hat doluluğu (son kalkışların doluluk ortalaması hat kalınlığına); kapsama alanlarını gizle/göster.
- **Denge** (`node scripts/simulate.ts 12`): başlangıç ağıyla 1 yıl: ~470 bin yolcu, ~10,4 M ₺ gelir, ~2,6 M ₺ gider, ortalama memnuniyet ~%88. %95 hedefi için gemi eklemek gerekiyor. Tanker olasılığı %22'den %12'ye indirildi (günde 3–5 geçiş fazla bildirim üretiyordu).
- **Yapılmayanlar:** arabalı vapurun iskele kısıtı ve araç geliri, hat düzenleme (iskele ekle/çıkar), mobil dokunmatik için ayrı arayüz.

## Bakım, tersaneler, gemi istatistikleri

- **Dalgakıran:** OSM `man_made=breakwater|groyne` (19 çizgi) su ızgarasında kara. Eminönü–Kadıköy rotası mendireğin dışından dolaştığı için 3,7 km'den 5,4 km'ye çıktı (gerçeğe yakın); tur 41 dk, 20 dk aralık için 3 vapur. Başlangıç hattı gereken sayıda gemiyle geliyor.
- **Tur süresi** Boğaz akıntısını hesaba katıyor (rota boyunca 1/hız ortalaması), bacaklar tam dakikaya yuvarlanıyor, gereken gemiye 2 dk tarife payı ekleniyor.
- **Bakım durumu** (0–100) km başına düşüyor (vapur 0,025/km → günde ~6 puan). Durum 0'da hız %80. %30'un altında her kalkışta arıza olasılığı (0'da %12): gemi kalkmaz, yolcular iskelede kalır, gemi %45 hızla tersaneye çekilir, onarım ×1,6.
- **Bakım** tersanede 8 saat, ücreti gemi fiyatının %6'sı. Otomatik eşik (varsayılan %35) altına düşen gemi terminalde yanaşınca tersaneye gider. Oyuncu gemi popup'ından "Bakıma gönder" diyebilir (ilk yanaşmada gider). Yuva doluysa tersanede sırada bekler. Bakım biten gemi daha az gemili terminale döner.
- **Tersaneler** artık oyun durumunda: Haliç Tersanesi (kapasite 6, 2 yuva) başlangıçta var. Oyuncu kıyıya yeni tersane kurabiliyor (4 M ₺, +4 kapasite, 1 yuva). Kurallar iskeleyle aynı, iskele/tersaneye 400 m'den yakın olamaz. Filo kapasitesi = tersanelerin toplamı. Yeni gemi ve bakım en yakın tersaneye gidiyor. Eski kayıtlardaki tek kapasite değeri Haliç Tersanesi'ne aktarılıyor.
- **Gemi istatistikleri:** bugün/toplam sefer, yolcu, gelir, ortalama doluluk, mesafe; yaş; durum çubuğu. Popup gemiyle birlikte hareket ediyor ve canlı güncelleniyor.
- **Gece:** "Geceyi hızlı geç" açıkken gece seferi olan hat yoksa 23:30–06:00 arası 24× hızla geçiliyor.

## Boğaz trafiği

- **Kanal:** Karadeniz girişinden (29,135 D, 41,234 K) Ahırkapı açığına (28,985 D, 40,985 K) A* ile; hücre maliyeti 1 + 8/(1 + karaya uzaklık) olduğu için orta hattan gidiyor. Her 4 hücreden biri örnekleniyor. İki şerit orta hattın 110 m sağında (sağdan seyir); kara çıkarsa kayma azaltılıyor.
- **Gemiler:** tanker (250 m, 8 kn, güvenlik 420 m), konteyner, dökme yük, kruvaziyer, koster. Saatte ortalama 4,5 gemi (gerçekte günde ~110). Açılışta kanalda 8 gemi.
- **Kaçınma:** vapur her dakika önündeki noktaya (bir dakikalık yol, en az 60 m) ve trafik gemisinin bir dakika sonraki konumuna bakıyor. Güvenlik mesafesi içindeyse duruyor, 1,8 katına kadar %40 hızla gidiyor. Çizimde gemiden uzak tarafa en fazla 140 m sapıyor (yumuşak geçişle). Sadece hat seferlerinde; tersane transitleri kaçınmıyor.
- **Eski tanker olayı** kaldırıldı: artık kalkışı engelleyen bir olay yok, etkisi seyirde. Bekleme dakikaları günlük istatistikte (`yieldMinutes`), üst barda "Boğaz: N gemi · M vapur yol veriyor".
- **Ayar:** menüden Boğaz trafiği kapatılabiliyor. Tarife testleri trafiği kapatıp çalışıyor.
