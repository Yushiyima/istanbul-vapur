# Vapur — İstanbul

Gerçek İstanbul haritası üstünde iskele kurup vapur hattı işlettiğin bir tarayıcı oyunu.
Tasarım ve yol haritası: [`CLAUDE.md`](CLAUDE.md). Tasarım kararları: [`DECISIONS.md`](DECISIONS.md).

**Durum:** Aşama 1. Harita, su katmanı, tarihi iskeleler, kıyıya yapışan iskele kurma/silme.

## Çalıştırma

Node 22.18+ gerekir (24 önerilir).

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run build      # tip kontrolü + üretim paketi (dist/)
```

İşlenmiş veriler (`data/*.geojson`, `data/places.json`) repoda hazır. Oyunu çalıştırmak için
veri scriptini çalıştırman gerekmez.

## Oynanış (Aşama 1)

- **Gez (G):** haritayı gez. İskeleye tıklayınca bilgisi ve "İskeleyi sil" düğmesi çıkar.
- **İskele (İ):** kıyıya yakın bir yere tıkla. Nokta en yakın kıyı noktasına yapışır.
  Fareyle gezerken yeşil/kırmızı önizleme kuralın tutup tutmadığını gösterir. **Esc** ile çıkılır.
- Kurallar (`src/config/balance.ts`):
  - kıyıdan en fazla 300 m uzağa tıklanabilir,
  - iki iskele arası en az 400 m,
  - `data/no_build.geojson` içindeki bölgelere kurulamaz (şimdilik Dolmabahçe Sarayı önü).
- Yeni iskele en yakın semt/mahalle adını alır (OSM `place=*`). 150 m içinde tarihi iskele
  varsa onun adını alır ve "tarihi iskele" olarak işaretlenir.
- Soluk halkalar tarihi iskelelerdir. Üstüne gelince adları görünür.
- Oyun Eminönü ve Kadıköy iskeleleriyle başlar.

## Veri scripti

```bash
npm run data:coast                       # data/raw/ önbelleği varsa onu kullanır
node scripts/build-coast.mjs --refresh   # Overpass'tan yeniden indirir
npm run data:check-piers                 # tarihi iskelelerin kıyıya uzaklığını listeler
```

`scripts/build-coast.mjs` şunları yapar:

1. `data/region.json` içindeki bbox için Overpass API'den `natural=coastline` yollarını
   (bbox'tan 0,08° geniş) ve `place=*` yer adlarını indirir. Ham yanıtlar `data/raw/` altına
   yazılır (git'e girmez). Sunucu meşgulse başka aynayı dener, bekleme süresini katlayarak tekrar dener.
2. Kıyı yollarını düğüm kimliklerinden zincirler, 4 m toleransla sadeleştirir, bbox'a kırpar.
3. OSM kuralına göre (kara solda, su sağda) kırpılan parçaları bbox kenarı boyunca kapatıp kara
   poligonlarını kurar. Su = bbox − kara (`polygon-clipping`).
4. Çıktılar:
   - `data/coastline.geojson`: kıyı çizgisi (MultiLineString, yön korunur, iskele yapıştırma için)
   - `data/water.geojson`: su poligonu (MultiPolygon)
   - `data/places.json`: semt/mahalle adları

Script idempotenttir. Aynı ham veriyle her çalıştırmada aynı çıktıyı üretir.

## Klasörler

```
data/          şehir paketi (region, kıyı, su, yer adları, tarihi iskeleler, yasak bölgeler)
scripts/       veri hazırlama
src/config/    balance.ts: tüm denge sayıları
src/geo/       saf geometri: mesafe, kıyıya yapışma, poligon içi testi
src/sim/       saf oyun mantığı: iskele kuralları, adlandırma
src/map/       MapLibre kurulumu ve katmanlar
src/ui/        araç çubuğu, toast
```

## Atıf

- Harita karoları: [OpenFreeMap](https://openfreemap.org), [© OpenMapTiles](https://www.openmaptiles.org/)
- Kıyı, su ve yer adı verisi: [© OpenStreetMap katkıcıları](https://www.openstreetmap.org/copyright) (ODbL)
