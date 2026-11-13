/**
 * Peron: yolcu paylaşımları. Olaylara ve hat durumuna göre şablonlu, hafif mizahi metinler.
 * Seçim tohumlu üreteçle yapılır (kayıt sonrası aynı akış).
 */
import { FEED } from '../config/balance.ts';
import { nextId, random } from './state.ts';
import type { GameState } from './types.ts';
import type { World } from './world.ts';

export type FeedTopic =
  | 'lodos'
  | 'poyraz'
  | 'sis'
  | 'tanker'
  | 'crowded'
  | 'longWait'
  | 'missed'
  | 'newLine'
  | 'goal'
  | 'gull'
  | 'happy'
  | 'night'
  | 'historic';

const AUTHORS = [
  { name: 'Moda Sakini', handle: '@modali_nese', avatar: '🧕' },
  { name: 'Simitçi', handle: '@simitci_rifat', avatar: '🥯' },
  { name: 'Martı', handle: '@marti_hasan', avatar: '🐦' },
  { name: 'Öğrenci', handle: '@hisarustu_ogrenci', avatar: '🎒' },
  { name: 'Emekli Kaptan', handle: '@kaptan_ahmet', avatar: '⚓' },
  { name: 'Beyaz Yakalı', handle: '@plaza_ebru', avatar: '💼' },
  { name: 'Çaycı', handle: '@vapur_caycisi', avatar: '🫖' },
  { name: 'Turist', handle: '@lost_in_eminonu', avatar: '📷' },
  { name: 'Üsküdarlı', handle: '@uskudarli_ayse', avatar: '🌷' },
  { name: 'Balıkçı', handle: '@galata_oltaci', avatar: '🎣' },
] as const;

const TEMPLATES: Record<FeedTopic, readonly string[]> = {
  lodos: [
    'Lodos yine Adalar seferlerini yedi. Simit elimde, ben iskelede.',
    'Lodos var diye vapur yok. Martılar bile yürüyerek gidiyor.',
    'Annem "lodosta denize çıkılmaz" derdi, vapur da annemi dinliyor.',
  ],
  poyraz: [
    'Poyraz öyle esiyor ki atkım Karadeniz’e gitti, vapur gitmedi.',
    'Poyraz yüzünden sefer iptal. Rüzgârın bile İstanbulkart’ı var galiba.',
  ],
  sis: [
    'Sis o kadar yoğun ki vapurun düdüğünden başka bir şey görünmüyor.',
    'Sisten kaptan da göremiyor, ben de. Ama çay sıcak.',
    'Boğaz’da sis: Kız Kulesi’ni hayal gücümle tamamladım.',
  ],
  tanker: [
    'Tanker geçiyor, vapur bekliyor. Çay söyledim, ikinci bardağa geçtim.',
    'Boğaz’dan koca bir tanker geçti, biz de saygı duruşunda bekledik.',
  ],
  crowded: [
    '{pier} iskelesinde vapura sığamadık. Bir sonrakini balkondan izleyeceğiz.',
    '{pierLoc} vapur o kadar dolu ki martılar bile ayakta.',
    '{pier}: kapı kapandı, ben dışarıda kaldım. Simitçiyle dertleştik.',
  ],
  longWait: [
    '{pierLoc} {wait} dakikadır bekliyorum. Simitçiyle akraba olduk.',
    '{pier} iskelesinde bekleme rekoru: {wait} dakika. Ödül yok mu?',
  ],
  missed: [
    'Vapur kaçtı, simit kaldı.',
    'Sefer iptal olmuş, kimse söylemedi. İskeledeki kedi bile şaşırdı.',
    'Tarifede vapur var, iskelede vapur yok. Klasik.',
  ],
  newLine: [
    'Yeni {line} hattı açılmış! Köprü trafiğine veda ediyorum.',
    '{line} hattının ilk seferine bindim, kaptan el salladı. Duygulandım.',
  ],
  goal: ['Belediye "{goal}" diye pankart asmış. Gerçekten de öyle olmuş!', 'Şehirde vapurla gidemeyeceğim yer kalmıyor. {goal}, tebrikler.'],
  gull: [
    'Martı simidimi kaptı. Vapur değil, martı işletmesi burası.',
    'Bugün de bir martı bana bakıp güldü. Biliyorum, güldü.',
    'Arka güvertede martılara simit atan amcaya bir alkış.',
  ],
  happy: [
    'Vapur tam saatinde kalktı, çay da sıcaktı. 10/10.',
    'İşe vapurla gidince insan başka bir insan oluyor.',
    'Boğaz manzarası + çay + simit = pazartesi sendromuna çare.',
  ],
  night: ['Gece vapuru! Saat ikide Boğaz’da çay içmek paha biçilmez.', 'Gece seferi gelmiş, artık son vapuru kaçırma korkusu yok.'],
  historic: ['{pier} iskelesi yıllar sonra yeniden açıldı. Dedemin anlattığı iskele bu!', 'Tarihi {pier} iskelesi yine vapur görüyor. Gözlerim doldu.'],
};

const BACK_VOWELS = 'aıou';
const FRONT_VOWELS = 'eiöü';
const HARD = 'fstkçşhp';

/** Türkçe bulunma eki: "Kadıköy’de", "Bebek’te", "Balat’ta", "Eminönü’de". Ünlü uyumu + sert ünsüz. */
export function locative(name: string): string {
  const lower = name.toLocaleLowerCase('tr');
  let vowel = 'a';
  for (let i = lower.length - 1; i >= 0; i--) {
    const ch = lower[i]!;
    if (BACK_VOWELS.includes(ch) || FRONT_VOWELS.includes(ch)) {
      vowel = ch;
      break;
    }
  }
  const front = FRONT_VOWELS.includes(vowel);
  const last = lower[lower.length - 1] ?? '';
  const d = HARD.includes(last) ? 't' : 'd';
  return `${name}’${d}${front ? 'e' : 'a'}`;
}

export function pushFeed(state: GameState, _world: World, topic: FeedTopic, vars: Record<string, string | number> = {}): void {
  if (typeof vars.pier === 'string' && vars.pierLoc === undefined) vars = { ...vars, pierLoc: locative(vars.pier) };
  const list = TEMPLATES[topic];
  const tpl = list[Math.floor(random(state) * list.length)]!;
  const author = topic === 'gull' ? AUTHORS[2] : AUTHORS[Math.floor(random(state) * AUTHORS.length)]!;
  const text = tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
  state.feed.unshift({ id: nextId(state, 'post'), at: state.minute, author: `${author.name} ${author.handle}`, avatar: author.avatar, text });
  if (state.feed.length > FEED.maxPosts) state.feed.length = FEED.maxPosts;
}

/** Saat sonu: son saatin durumuna göre paylaşım (her saat değil, olasılıkla). */
export function hourlyFeed(
  state: GameState,
  world: World,
  hour: { denied: number; boardings: number; missed: number; departures: number; avgWait: number; worstPier: string | null; worstWait: number },
): void {
  if (hour.boardings + hour.departures === 0) return;
  if (hour.denied > Math.max(FEED.crowdedMin, hour.boardings * 0.1) && hour.worstPier && random(state) < 0.7) {
    pushFeed(state, world, 'crowded', { pier: hour.worstPier });
  } else if (hour.worstWait >= FEED.longWaitMin && hour.worstPier && random(state) < 0.6) {
    pushFeed(state, world, 'longWait', { pier: hour.worstPier, wait: Math.round(hour.worstWait) });
  } else if (hour.missed > 0 && random(state) < 0.5) {
    pushFeed(state, world, 'missed');
  } else if (random(state) < FEED.gullChance) {
    pushFeed(state, world, 'gull');
  } else if (state.satisfaction > 80 && random(state) < FEED.happyChance) {
    pushFeed(state, world, 'happy');
  }
}
