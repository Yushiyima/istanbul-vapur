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
