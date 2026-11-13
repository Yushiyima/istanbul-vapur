# Yapılacaklar

Açık işler. Bitince `[x]` yap ya da sil; tasarım kararıysa `DECISIONS.md`'ye bir satır düş.

## İskele (Aşama 1 düzeltmeleri)

- [ ] **Kapsama halkası sadece karada kalsın.** *(Aşama 2: su ızgarasının kara bileşenleriyle)* 800 m'lik daire şu an denizi de kapsıyor.
  Daire − su poligonu (`data/water.geojson`) farkı alınarak çizilmeli. `polygon-clipping` zaten
  bağımlılık olarak var. Aşama 3'teki havza/nüfus hesabı da aynı kara alanını kullanmalı.
  Karşı kıyıya taşan kısım (ör. Boğaz'ın dar yerlerinde) ayrıca düşünülmeli: yürüyerek karşıya
  geçilemez, o parça kapsama sayılmamalı.
- [x] **Oyun alanı dışı tıklama için doğru mesaj.** Bbox dışına tıklayınca "Kıyıya çok uzak"
  yerine "Oyun alanı dışında" desin (ret sebebi: `out-of-bounds`). Örnek log: `40.941, 28.833`
  Yeşilköy batısı, gerçek kıyıya yakın ama kıyı verisi bbox'ta kesildiği için reddediliyor.
- [x] **Tarihi iskelenin adı kapılmasın.** Kurulmamış tarihi iskelelerin adları sıradan
  iskelelere verilmesin. Örnek log: 41.094'teki sıradan iskele "Kanlıca" adını aldı, sonra
  asıl tarihi Kanlıca "Kanlıca 2" oldu.
- [x] **Ad kalitesi.** `locality` türünü yer adlarından çıkar ("Oymak Sitesi", "Tarabya Plajı").
  Yakında bir semt (`suburb`/`quarter`) varsa küçük mahalle (`neighbourhood`) adına tercih et
  ("Camiikebir", "Piri Paşa", "Çıksalın" yerine Hasköy vb.).
- [x] *(düşük öncelik)* Yazım tutarlılığı: tarihi "Rumeli Kavağı" ile OSM "Rumelikavağı" farklı.
  Tarihi iskele adları OSM adlarının yerine geçsin mi, karar ver.
