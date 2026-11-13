# Yapılacaklar

Açık işler. Bitince `[x]` yap ya da sil; tasarım kararıysa `DECISIONS.md`'ye bir satır düş.

## Açık

### CLAUDE.md'de olup eksik kalanlar
- [ ] **Arabalı vapur:** sadece belirli iskelelerde çalışsın (ör. Eminönü/Harem, Kabataş/Üsküdar,
  Eskihisar benzeri rampalı iskeleler) ve araç geliri getirsin. Şu an tip olarak var ama farkı
  sadece kapasite/hız.
- [ ] **Hat düzenleme:** hatta iskele ekle/çıkar, sıra değiştir. Şu an kapatıp yeniden açmak gerekiyor.

### Oynanış ve denge
- [ ] **Reddedilen yolcu çift sayılıyor:** aynı grup her kalkışta yeniden "reddedilen" sayılıyor;
  istatistik şişiyor, memnuniyetteki kalabalık puanı sert. Grup başına bir kez saymak daha doğru.
- [ ] **Tur süresi akıntısız:** gereken gemi hesabı Boğaz akıntısını ve sisi hesaba katmıyor.
- [ ] **Yıl uzunluğu:** 12 oyun günü = 1 yıl (bir gün bir ay). Oynanınca kısa/uzun geliyorsa ayarla.
- [ ] **Gece:** 23:30–06:00 arası gece hattı yoksa ekran durgun; isteğe bağlı "geceyi hızlı geç".

### Teknik
- [ ] **Kapsama hesabı** iskele başına ~25 ms (daire − tüm deniz poligonu). Su poligonunu
  bir kez parçalara bölmek hızlandırır.
- [ ] **Mobil/dokunmatik arayüz:** paneller küçük ekranda sıkışık, sürükle-bırak yok.
- [ ] **Yayın:** yerel ağda (`vite --host`) ya da GitHub Pages'te yayınlama.

## Kapandı: İskele (Aşama 1 düzeltmeleri)

- [x] **Kapsama halkası sadece karada kalsın.** *(Aşama 2: daire − su, sadece iskelenin kara bileşeni)* 800 m'lik daire şu an denizi de kapsıyor.
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
