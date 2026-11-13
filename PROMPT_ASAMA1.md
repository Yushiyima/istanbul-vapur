CLAUDE.md'yi baştan sona oku. Aşama 1'i yapıyoruz. Önce kısa bir plan yaz, sonra uygula.

## Aşama 1: Harita + kıyı + iskele koyma

1. Vite + TypeScript (strict) projesini kur. MapLibre GL, h3-js, idb, vitest ekle.
2. Haritayı CLAUDE.md'deki bbox'a göre aç: Haliç, Boğaz ve Adalar görünsün. OpenFreeMap
   karolarını kullan, sade/açık renkli bir stil seç, su belirgin olsun.
3. `scripts/` altında veri scripti yaz:
   - OSM'den bbox'a kırpılmış su poligonu → `data/water.geojson`
   - Kıyı çizgisi → `data/coastline.geojson`
   - Ham indirmeler `data/raw/` altına gitsin (gitignore).
   - Script tekrar çalıştırılabilir olsun; nasıl çalıştırılacağını README'ye yaz.
4. Su katmanını haritada ayrı katman olarak göster.
5. `data/historic_piers.json`'daki tarihi iskeleleri soluk işaretle göster. Üzerine gelince adı
   görünsün. Koordinatları kıyıya snap ederek kontrol et; 150 m'den uzaktaysa konsola uyarı bas.
6. Araç çubuğunda "İskele" aracı: haritaya tıklayınca
   - nokta en yakın kıyı noktasına yapışsın,
   - kıyıdan 300 m'den uzak tıklamalar reddedilsin,
   - başka iskeleye 400 m'den yakınsa reddedilsin,
   - `data/no_build.geojson` içindeyse reddedilsin (şimdilik Dolmabahçe önüne örnek bir poligon koy),
   - reddedilince kısa bir uyarı (toast) çıksın.
   Konan iskeleye isim olarak en yakın mahalle/semt adını ver (OSM place etiketlerinden).
7. Konan iskelenin çevresinde 800 m kapsama dairesi göster; iskeleye tıklayınca sil seçeneği olsun.
8. Başlangıçta Eminönü ve Kadıköy iskeleleri hazır gelsin (hat yok, Aşama 2'de).
9. Kıyıya yapışma ve mesafe kontrolleri için vitest testleri yaz.
10. Atıfları harita köşesinde göster.

## Bitti sayılır
- `npm run dev` ile açılıyor, harita + su + tarihi iskeleler görünüyor.
- Kıyıya iskele konabiliyor, kurallar çalışıyor, silinebiliyor.
- `npm test` geçiyor.
- README'de veri scriptinin ve projenin nasıl çalıştırılacağı yazıyor.
- Git commit atıldı. Sonunda bana neyi nasıl test edeceğimi 3–5 madde halinde yaz.
